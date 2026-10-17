use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

#[derive(Clone, Debug)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    /// `None` — голый TCP; `Some` — TLS и то, чему в нём верить.
    pub tls: Option<TlsRoots>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub client_id: String,
}

impl MqttConfig {
    /// `scheme://host:port` для логов — без логина и пароля.
    pub fn endpoint(&self) -> String {
        endpoint(self.tls.is_some(), &self.host, self.port)
    }
}

#[derive(Debug, Clone)]
pub enum MqttEvent {
    Message { topic: String, payload: String },
    Connected,
    Disconnected(String),
    /// Подключиться не вышло ни разу с последнего успеха — DNS, отказ TLS,
    /// неверный пароль. Раньше такие ошибки не видел никто: Disconnected
    /// шлётся лишь после того, как связь уже была.
    ConnectFailed(String),
}

// --- адрес брокера ---
//
// Правило общее для трёх репозиториев связки (ccfzf-picker, windows11-manager,
// windows-mqtt) и для двух клиентов здесь — Rust-моста и node-клиента
// безоконного режима (`src/mqtt-broker.js`). Расходиться им нельзя: один и тот
// же config.yml читают оба.
//
// `mqtt.host` — голый хост, `mqtt://h[:port][/]` или `mqtts://h[:port][/]`.
// TLS — только при схеме mqtts, голый хост остаётся прежним mqtt. Порт:
// из адреса > ключ `mqtt.port` > умолчание схемы. Всё прочее — ошибка
// конфига, а не догадка: подключиться не туда хуже, чем не подключиться.

/// Куда подключаться, с уже разрешённым портом.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Broker {
    pub host: String,
    pub port: u16,
    pub tls: bool,
}

impl Broker {
    pub fn endpoint(&self) -> String {
        endpoint(self.tls, &self.host, self.port)
    }
}

fn endpoint(tls: bool, host: &str, port: u16) -> String {
    format!("{}://{}:{}", if tls { "mqtts" } else { "mqtt" }, host, port)
}

const PLAIN_PORT: u16 = 1883;
const TLS_PORT: u16 = 8883;

fn valid_port(port: u64) -> Option<u16> {
    u16::try_from(port).ok().filter(|p| *p != 0)
}

/// Разобрать `mqtt.host` и `mqtt.port` в адрес брокера.
///
/// Тексты ошибок не цитируют исходную строку целиком: в userinfo
/// (`mqtts://user:pass@h`) мог стоять пароль, а ошибка уходит в лог.
pub fn parse_broker(raw: &str, port_key: Option<u64>) -> Result<Broker, String> {
    let raw = raw.trim();
    let (tls, authority) = match raw.split_once("://") {
        Some((scheme, rest)) => {
            let tls = match scheme.to_ascii_lowercase().as_str() {
                "mqtt" => false,
                "mqtts" => true,
                _ => {
                    return Err(format!(
                        "mqtt.host: unsupported scheme '{scheme}://', use mqtt:// or mqtts://"
                    ))
                }
            };
            (tls, rest.strip_suffix('/').unwrap_or(rest))
        }
        // Голый `h` или `h:port` — прежний mqtt, как и у соседей по связке.
        None => (false, raw),
    };

    if authority.contains('@') {
        return Err("mqtt.host: credentials in the address are not supported, \
                    use mqtt.user and mqtt.password"
            .into());
    }
    if let Some(c) = authority
        .chars()
        .find(|c| matches!(c, '/' | '?' | '#') || c.is_whitespace())
    {
        return Err(format!(
            "mqtt.host: unexpected '{c}' — the address takes only a host and a port"
        ));
    }

    let (host, url_port) = match authority.split_once(':') {
        Some((host, port)) => {
            let port = (!port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()))
                .then(|| port.parse::<u64>().ok())
                .flatten()
                .and_then(valid_port)
                .ok_or_else(|| format!("mqtt.host: invalid port '{port}'"))?;
            (host, Some(port))
        }
        None => (authority, None),
    };
    if host.is_empty() {
        return Err("mqtt.host: empty host".into());
    }

    let port = match (url_port, port_key) {
        (Some(port), _) => port,
        (None, Some(key)) => {
            valid_port(key).ok_or_else(|| format!("mqtt.port: {key} is out of range 1..65535"))?
        }
        (None, None) if tls => TLS_PORT,
        (None, None) => PLAIN_PORT,
    };

    Ok(Broker {
        host: host.to_string(),
        port,
        tls,
    })
}

// --- TLS ---

/// Чему верить в TLS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TlsRoots {
    /// Корни Mozilla, вшитые в бинарь (`webpki-roots`). Не системное
    /// хранилище: Windows заполняет его лениво, и ISRG Root X1 там может не
    /// оказаться — ровно на этом `mosquitto_pub --tls-use-os-certs` с ноутбука
    /// и падает с «certificate verify failed».
    Webpki,
    /// PEM из `mqtt.ca` — и ничего, кроме него.
    Ca(Vec<u8>),
}

/// Решить, нужен ли TLS и чему в нём верить. `ca` при голом mqtt не читается
/// вовсе; нечитаемый `ca` при mqtts — ошибка, а не тихий откат на вшитые корни.
pub fn tls_roots_for(tls: bool, ca: Option<&Path>) -> Result<Option<TlsRoots>, String> {
    if !tls {
        return Ok(None);
    }
    let Some(path) = ca else {
        return Ok(Some(TlsRoots::Webpki));
    };
    let pem = std::fs::read(path)
        .map_err(|e| format!("mqtt.ca: cannot read {}: {e}", path.display()))?;
    // Разбирает PEM сам rumqttc, но уже при подключении, и ошибка его тонет в
    // цикле переподключений. Явно негодный файл ловится здесь, при чтении конфига.
    if !pem
        .windows(b"-----BEGIN CERTIFICATE-----".len())
        .any(|w| w == b"-----BEGIN CERTIFICATE-----")
    {
        return Err(format!(
            "mqtt.ca: {} has no PEM certificate",
            path.display()
        ));
    }
    Ok(Some(TlsRoots::Ca(pem)))
}

pub fn webpki_root_store() -> rustls::RootCertStore {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    roots
}

/// Транспорт rumqttc. Не `TlsConfiguration::default()`: тот читает системное
/// хранилище и паникует (`expect`), если прочитать не вышло.
pub fn transport_for(tls: &Option<TlsRoots>) -> Transport {
    match tls {
        None => Transport::Tcp,
        Some(TlsRoots::Webpki) => {
            let config = rustls::ClientConfig::builder()
                .with_root_certificates(webpki_root_store())
                .with_no_client_auth();
            Transport::Tls(TlsConfiguration::Rustls(Arc::new(config)))
        }
        Some(TlsRoots::Ca(pem)) => Transport::Tls(TlsConfiguration::Simple {
            ca: pem.clone(),
            alpn: None,
            client_auth: None,
        }),
    }
}

pub struct MqttBridge {
    client: AsyncClient,
    subscriptions: Arc<Mutex<HashSet<String>>>,
}

/// Decide the MQTT credentials to send.
///
/// A username alone is enough to authenticate: brokers commonly accept a
/// username with an empty password. Requiring both (the old behaviour) silently
/// dropped username-only credentials, so the client connected anonymously.
fn credentials_for(config: &MqttConfig) -> Option<(&str, &str)> {
    config
        .username
        .as_deref()
        .map(|user| (user, config.password.as_deref().unwrap_or("")))
}

impl MqttBridge {
    pub fn new(config: &MqttConfig) -> (Self, mpsc::Receiver<MqttEvent>) {
        let mut opts = MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(std::time::Duration::from_secs(30));
        opts.set_clean_session(false);
        opts.set_transport(transport_for(&config.tls));

        if let Some((user, pass)) = credentials_for(config) {
            opts.set_credentials(user, pass);
        }

        let (client, event_loop) = AsyncClient::new(opts, 256);

        let subscriptions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let (tx, rx) = mpsc::channel(512);

        let subs_clone = subscriptions.clone();
        let client_clone = client.clone();

        // MqttBridge::new is called from Tauri's setup() (no ambient tokio
        // runtime there) — tauri::async_runtime provides the runtime handle
        tauri::async_runtime::spawn(Self::run_event_loop(
            event_loop,
            tx,
            subs_clone,
            client_clone,
        ));

        (
            Self {
                client,
                subscriptions,
            },
            rx,
        )
    }

    async fn run_event_loop(
        mut event_loop: rumqttc::EventLoop,
        tx: mpsc::Sender<MqttEvent>,
        subscriptions: Arc<Mutex<HashSet<String>>>,
        client: AsyncClient,
    ) {
        let mut was_connected = false;
        // Ошибка подключения сообщается один раз на серию: цикл повторяет
        // попытку раз в секунду, и лог иначе утонул бы в одинаковых строках.
        let mut failure_reported = false;

        loop {
            match event_loop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    was_connected = true;
                    failure_reported = false;
                    let _ = tx.send(MqttEvent::Connected).await;

                    // Replay subscriptions on reconnect
                    let subs = subscriptions.lock().await;
                    for topic in subs.iter() {
                        let _ = client.subscribe(topic, QoS::AtMostOnce).await;
                    }
                }
                Ok(Event::Incoming(Packet::Publish(publish))) => {
                    let topic = publish.topic.clone();
                    let payload = String::from_utf8_lossy(&publish.payload).to_string();
                    let _ = tx
                        .send(MqttEvent::Message { topic, payload })
                        .await;
                }
                Ok(_) => {}
                Err(e) => {
                    if was_connected {
                        was_connected = false;
                        failure_reported = true;
                        let _ = tx
                            .send(MqttEvent::Disconnected(e.to_string()))
                            .await;
                    } else if !failure_reported {
                        failure_reported = true;
                        let _ = tx.send(MqttEvent::ConnectFailed(e.to_string())).await;
                    }
                    // rumqttc will auto-reconnect; brief pause to avoid tight loop
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }

    pub async fn subscribe(&self, topics: &[String]) {
        let mut subs = self.subscriptions.lock().await;
        for topic in topics {
            subs.insert(topic.clone());
            let _ = self.client.subscribe(topic, QoS::AtMostOnce).await;
        }
    }

    pub async fn unsubscribe(&self, topics: &[String]) {
        let mut subs = self.subscriptions.lock().await;
        for topic in topics {
            subs.remove(topic);
            let _ = self.client.unsubscribe(topic).await;
        }
    }

    pub async fn publish(&self, topic: &str, payload: &str, retain: bool, qos: QoS) {
        let _ = self
            .client
            .publish(topic, qos, retain, payload.as_bytes().to_vec())
            .await;
    }

    pub async fn disconnect(&self) {
        let _ = self.client.disconnect().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(username: Option<&str>, password: Option<&str>) -> MqttConfig {
        MqttConfig {
            host: "localhost".into(),
            port: 1883,
            tls: None,
            username: username.map(str::to_string),
            password: password.map(str::to_string),
            client_id: "test".into(),
        }
    }

    #[test]
    fn credentials_with_username_and_password() {
        let cfg = config(Some("user"), Some("pass"));
        assert_eq!(credentials_for(&cfg), Some(("user", "pass")));
    }

    #[test]
    fn credentials_with_username_only() {
        let cfg = config(Some("user"), None);
        assert_eq!(credentials_for(&cfg), Some(("user", "")));
    }

    #[test]
    fn credentials_with_username_and_empty_password() {
        let cfg = config(Some("user"), Some(""));
        assert_eq!(credentials_for(&cfg), Some(("user", "")));
    }

    #[test]
    fn no_credentials_without_username() {
        let cfg = config(None, None);
        assert_eq!(credentials_for(&cfg), None);
    }

    #[test]
    fn no_credentials_with_password_only() {
        // A password without a username cannot authenticate — send nothing.
        let cfg = config(None, Some("pass"));
        assert_eq!(credentials_for(&cfg), None);
    }
    // --- адрес брокера: схема, хост, порт ---

    fn ok(host: &str, port: Option<u64>) -> Broker {
        parse_broker(host, port).unwrap_or_else(|e| panic!("{host:?} отвергнут: {e}"))
    }

    fn broker(host: &str, port: u16, tls: bool) -> Broker {
        Broker { host: host.into(), port, tls }
    }

    #[test]
    fn bare_host_is_plain_mqtt_on_1883() {
        assert_eq!(ok("broker.example", None), broker("broker.example", 1883, false));
    }

    #[test]
    fn bare_host_takes_the_port_key() {
        // Старый конфиг домашней машины (`host` + `port: 1883`) обязан
        // работать как раньше.
        assert_eq!(ok("broker.example", Some(1883)), broker("broker.example", 1883, false));
    }

    #[test]
    fn mqtt_scheme_without_port() {
        assert_eq!(ok("mqtt://broker.example", None), broker("broker.example", 1883, false));
    }

    #[test]
    fn mqtt_scheme_with_port() {
        assert_eq!(ok("mqtt://broker.example:1884", None), broker("broker.example", 1884, false));
    }

    #[test]
    fn bare_host_with_port_is_plain_mqtt() {
        // Так же разбирают ccfzf-picker и windows11-manager: голый `h:port`
        // — прежний mqtt, порт из адреса бьёт ключ.
        assert_eq!(ok("broker.example:1884", None), broker("broker.example", 1884, false));
        assert_eq!(ok("broker.example:1884", Some(1883)), broker("broker.example", 1884, false));
    }

    #[test]
    fn mqtts_defaults_to_8883() {
        assert_eq!(ok("mqtts://broker.example", None), broker("broker.example", 8883, true));
    }

    #[test]
    fn url_port_beats_port_key() {
        assert_eq!(
            ok("mqtts://broker.example:8884", Some(1883)),
            broker("broker.example", 8884, true)
        );
    }

    #[test]
    fn port_key_beats_scheme_default() {
        assert_eq!(ok("mqtts://broker.example", Some(9883)), broker("broker.example", 9883, true));
    }

    #[test]
    fn scheme_is_case_insensitive() {
        assert_eq!(ok("MQTTS://broker.example", None), broker("broker.example", 8883, true));
        assert_eq!(ok("Mqtt://broker.example", None), broker("broker.example", 1883, false));
    }

    #[test]
    fn trailing_slash_is_allowed() {
        assert_eq!(ok("mqtts://broker.example/", None), broker("broker.example", 8883, true));
        assert_eq!(ok("mqtts://broker.example:8883/", None), broker("broker.example", 8883, true));
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        assert_eq!(ok("  mqtts://broker.example  ", None), broker("broker.example", 8883, true));
    }

    #[test]
    fn rejects_malformed_addresses() {
        for bad in [
            "ws://broker.example",
            "http://broker.example",
            "mqtts://user:pass@broker.example",
            "mqtts://broker.example/path",
            "mqtts://broker.example?x=1",
            "mqtts://broker.example#frag",
            "mqtts://broker.example:99999",
            "mqtts://broker.example:0",
            "mqtts://broker.example:abc",
            "mqtts://broker.example:",
            "mqtts://",
            "mqtts:///",
            "mqtts://:8883",
            "",
            "   ",
            "broker.example:",
            "broker.example:99999",
            "broker.example/",
            "user@broker.example",
            "mqtts://broker example",
        ] {
            assert!(parse_broker(bad, None).is_err(), "{bad:?} должен быть отвергнут");
        }
    }

    #[test]
    fn rejects_out_of_range_port_key() {
        assert!(parse_broker("broker.example", Some(0)).is_err());
        assert!(parse_broker("broker.example", Some(70000)).is_err());
    }

    #[test]
    fn rejection_never_echoes_the_userinfo() {
        // В userinfo может стоять пароль, а ошибка уходит в лог.
        let err = parse_broker("mqtts://user:s3cret@broker.example", None).unwrap_err();
        assert!(!err.contains("s3cret"), "пароль утёк в ошибку: {err}");
    }

    #[test]
    fn endpoint_names_scheme_host_and_port() {
        assert_eq!(broker("broker.example", 8883, true).endpoint(), "mqtts://broker.example:8883");
        assert_eq!(broker("broker.example", 1883, false).endpoint(), "mqtt://broker.example:1883");
    }

    // --- транспорт ---

    fn tmp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("wmqtt-ca-{}-{name}", std::process::id()));
        std::fs::write(&path, content).unwrap();
        path
    }

    const PEM: &[u8] = b"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

    #[test]
    fn webpki_root_store_is_not_empty() {
        assert!(!webpki_root_store().is_empty());
    }

    #[test]
    fn plain_mqtt_needs_no_tls() {
        assert_eq!(tls_roots_for(false, None).unwrap(), None);
    }

    #[test]
    fn plain_mqtt_ignores_ca() {
        let missing = std::path::Path::new("/nonexistent/wmqtt-ca.pem");
        assert_eq!(tls_roots_for(false, Some(missing)).unwrap(), None);
    }

    #[test]
    fn mqtts_without_ca_uses_bundled_roots() {
        assert_eq!(tls_roots_for(true, None).unwrap(), Some(TlsRoots::Webpki));
    }

    #[test]
    fn mqtts_with_ca_trusts_only_that_file() {
        let path = tmp_file("ok.pem", PEM);
        let roots = tls_roots_for(true, Some(&path));
        let _ = std::fs::remove_file(&path);
        assert_eq!(roots.unwrap(), Some(TlsRoots::Ca(PEM.to_vec())));
    }

    #[test]
    fn unreadable_ca_is_an_error_not_a_fallback() {
        let missing = std::path::Path::new("/nonexistent/wmqtt-ca.pem");
        assert!(tls_roots_for(true, Some(missing)).is_err());
    }

    #[test]
    fn ca_without_pem_certificate_is_an_error() {
        let path = tmp_file("junk.pem", b"not a certificate");
        let roots = tls_roots_for(true, Some(&path));
        let _ = std::fs::remove_file(&path);
        assert!(roots.is_err());
    }

    #[test]
    fn transport_for_plain_is_tcp() {
        assert!(matches!(transport_for(&None), Transport::Tcp));
    }

    #[test]
    fn transport_for_bundled_roots_is_injected_rustls_config() {
        assert!(matches!(
            transport_for(&Some(TlsRoots::Webpki)),
            Transport::Tls(TlsConfiguration::Rustls(_))
        ));
    }

    #[test]
    fn transport_for_ca_is_simple_with_that_pem() {
        match transport_for(&Some(TlsRoots::Ca(PEM.to_vec()))) {
            Transport::Tls(TlsConfiguration::Simple { ca, alpn: None, client_auth: None }) => {
                assert_eq!(ca, PEM)
            }
            _ => panic!("ожидался TlsConfiguration::Simple"),
        }
    }
}
