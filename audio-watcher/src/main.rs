// audio-watcher: a tiny event-driven sidecar for windows-mqtt.
//
// Registers a Core Audio IMMNotificationClient and, whenever the default
// playback or recording endpoint changes (plus once at startup), prints the
// device's friendly name to stdout as tab-separated lines:
//
//   playback\t<name>
//   recording\t<name>
//
// The parent (src/modules/audio.js) reads these lines and publishes them to
// MQTT. No polling, ~0% CPU when idle. Exits cleanly when its stdin is closed
// (the parent going away) so it never becomes an orphan.

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{channel, Sender};

use windows::core::{implement, Result, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eCapture, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

// The notification callback runs on a COM-owned thread. To avoid re-entering the
// enumerator from inside the callback, it just nudges the main thread through a
// channel; the main thread does all the querying and printing.
#[implement(IMMNotificationClient)]
struct Notifier {
    tx: Sender<()>,
}

#[allow(non_snake_case)]
impl IMMNotificationClient_Impl for Notifier_Impl {
    fn OnDefaultDeviceChanged(
        &self,
        _flow: EDataFlow,
        _role: ERole,
        _default_device_id: &PCWSTR,
    ) -> Result<()> {
        let _ = self.tx.send(());
        Ok(())
    }

    fn OnDeviceStateChanged(
        &self,
        _device_id: &PCWSTR,
        _new_state: windows::Win32::Media::Audio::DEVICE_STATE,
    ) -> Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _device_id: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> Result<()> {
        Ok(())
    }
}

// Read the default endpoint's friendly name for a given data flow, stripping the
// " (adapter...)" suffix to match the existing PowerShell scripts' output.
fn default_device_name(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Result<String> {
    unsafe {
        // eConsole: the device shown as "Default Device" in Windows sound settings.
        let device = enumerator.GetDefaultAudioEndpoint(flow, windows::Win32::Media::Audio::eConsole)?;
        let store = device.OpenPropertyStore(STGM_READ)?;
        let prop = store.GetValue(&PKEY_Device_FriendlyName)?;
        let pwstr = PropVariantToStringAlloc(&prop)?;
        let mut name = pwstr.to_string().unwrap_or_default();
        // Free the buffer PropVariantToStringAlloc allocated.
        windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.0 as *const _));
        if let Some(idx) = name.find(" (") {
            name.truncate(idx);
        }
        Ok(name)
    }
}

fn print_line(label: &str, name: &str) {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{}\t{}", label, name);
    let _ = lock.flush();
}

fn main() -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }

    let (tx, rx) = channel::<()>();

    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };

    let notifier: IMMNotificationClient = Notifier { tx }.into();
    unsafe { enumerator.RegisterEndpointNotificationCallback(&notifier)? };

    // Exit when the parent closes our stdin (or the pipe breaks), so we don't
    // linger as an orphan process.
    std::thread::spawn(|| {
        let stdin = io::stdin();
        let mut line = String::new();
        loop {
            line.clear();
            match stdin.lock().read_line(&mut line) {
                Ok(0) | Err(_) => std::process::exit(0),
                Ok(_) => {}
            }
        }
    });

    let mut last_playback = String::new();
    let mut last_recording = String::new();

    // Publish once on startup, then on every default-device change.
    loop {
        if let Ok(name) = default_device_name(&enumerator, eRender) {
            if name != last_playback {
                last_playback = name.clone();
                print_line("playback", &name);
            }
        }
        if let Ok(name) = default_device_name(&enumerator, eCapture) {
            if name != last_recording {
                last_recording = name.clone();
                print_line("recording", &name);
            }
        }

        // Block until a change notification arrives. Drain any burst so a single
        // switch (which can fire several callbacks) collapses into one re-query.
        if rx.recv().is_err() {
            break;
        }
        while rx.try_recv().is_ok() {}
    }

    unsafe {
        let _ = enumerator.UnregisterEndpointNotificationCallback(&notifier);
    }
    Ok(())
}
