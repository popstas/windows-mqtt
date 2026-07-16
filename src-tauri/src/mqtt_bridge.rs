use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

#[derive(Clone, Debug)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub client_id: String,
}

#[derive(Debug, Clone)]
pub enum MqttEvent {
    Message { topic: String, payload: String },
    Connected,
    Disconnected(String),
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

        loop {
            match event_loop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    was_connected = true;
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
                        let _ = tx
                            .send(MqttEvent::Disconnected(e.to_string()))
                            .await;
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
}
