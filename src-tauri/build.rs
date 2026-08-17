use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Каждый вход сборки вне пакета объявляется руками: любая директива
    // `cargo:rerun-if-*` отменяет умолчание «пересобирать скрипт на любую
    // правку», а его всё равно отменяет `tauri_build::build()` своими. Забыть
    // строку — получить штамп прошлой выкатки, то есть враньё ровно там, куда
    // пришли за правдой.
    println!("cargo:rerun-if-env-changed=WINDOWS_MQTT_RELEASE");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    // Работу делает node, а не этот крейт: обновлённый `src/` — такая же новая
    // сборка, как правка в `main.rs`.
    println!("cargo:rerun-if-changed=../src");
    // frontendDist из tauri.conf.json; `scripts/prepare-frontend.js` кладёт
    // сюда index.html и about.html перед каждой сборкой.
    println!("cargo:rerun-if-changed=../frontend");

    // Признак релиза — переменная окружения, а не `debug_assertions`: выкатка
    // собирает `--release`, и на профиле штамп пропал бы ровно там, где нужен.
    // Переменную выставляет CI на сборке под тегом; нет CI — штамп есть везде.
    let stamp = if std::env::var_os("WINDOWS_MQTT_RELEASE").is_some() {
        0
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    };
    println!("cargo:rustc-env=WINDOWS_MQTT_BUILD_UNIX={stamp}");

    tauri_build::build()
}
