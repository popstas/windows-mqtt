// audio-watcher: a tiny event-driven sidecar for windows-mqtt.
//
// Watches the Windows default audio endpoints via Core Audio and prints
// tab-separated lines to stdout whenever something changes (and once at
// startup):
//
//   playback\t<device name>
//   recording\t<device name>
//   volume\t<0..100>
//   mute\t<0|1>
//
// - Device changes come from an IMMNotificationClient.
// - Volume/mute changes come from an IAudioEndpointVolumeCallback registered on
//   the default *render* endpoint (rebound when the default device changes).
//
// The parent (src/modules/audio.js) reads these lines and publishes them to
// MQTT. No polling, ~0% CPU when idle, and crucially no per-tick child process
// spawns (the `loudness` npm package shelled out an .exe on every read). Exits
// cleanly when its stdin is closed so it never becomes an orphan.

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{channel, Sender};

use windows::core::{implement, Result, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, AUDIO_VOLUME_NOTIFICATION_DATA, EDataFlow, ERole, IMMDevice,
    IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

// What woke the main loop up. Callbacks only send these (cheap); the main thread
// does all the COM querying and printing.
#[derive(Clone, Copy)]
enum Event {
    Device, // default endpoint changed -> re-read names, rebind volume callback
    Volume, // volume/mute changed on the current render endpoint
}

// --- IMMNotificationClient: fires on default-device changes ---------------
#[implement(IMMNotificationClient)]
struct Notifier {
    tx: Sender<Event>,
}

#[allow(non_snake_case)]
impl IMMNotificationClient_Impl for Notifier_Impl {
    fn OnDefaultDeviceChanged(
        &self,
        _flow: EDataFlow,
        _role: ERole,
        _default_device_id: &PCWSTR,
    ) -> Result<()> {
        let _ = self.tx.send(Event::Device);
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

    fn OnPropertyValueChanged(&self, _device_id: &PCWSTR, _key: &PROPERTYKEY) -> Result<()> {
        Ok(())
    }
}

// --- IAudioEndpointVolumeCallback: fires on volume/mute changes ------------
#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback {
    tx: Sender<Event>,
}

#[allow(non_snake_case)]
impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        let _ = self.tx.send(Event::Volume);
        Ok(())
    }
}

// Read the default endpoint's friendly name for a data flow, stripping the
// " (adapter...)" suffix to match the original PowerShell scripts' output.
fn default_device_name(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Result<String> {
    unsafe {
        // eConsole: the device shown as "Default Device" in Windows sound settings.
        let device = enumerator.GetDefaultAudioEndpoint(flow, eConsole)?;
        let store = device.OpenPropertyStore(STGM_READ)?;
        let prop = store.GetValue(&PKEY_Device_FriendlyName)?;
        let pwstr = PropVariantToStringAlloc(&prop)?;
        let mut name = pwstr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(pwstr.0 as *const _));
        if let Some(idx) = name.find(" (") {
            name.truncate(idx);
        }
        Ok(name)
    }
}

fn print_line(label: &str, value: &str) {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{}\t{}", label, value);
    let _ = lock.flush();
}

// Re-query the default render/capture device names, printing any that changed.
fn refresh_devices(
    enumerator: &IMMDeviceEnumerator,
    last_playback: &mut String,
    last_recording: &mut String,
) {
    if let Ok(name) = default_device_name(enumerator, eRender) {
        if name != *last_playback {
            *last_playback = name.clone();
            print_line("playback", &name);
        }
    }
    if let Ok(name) = default_device_name(enumerator, eCapture) {
        if name != *last_recording {
            *last_recording = name.clone();
            print_line("recording", &name);
        }
    }
}

// Point the volume callback at the current default render endpoint, dropping any
// previous registration. Returns the endpoint volume interface (kept alive so we
// can read from it and later unregister). None if there is no render device.
fn rebind_volume(
    enumerator: &IMMDeviceEnumerator,
    tx: &Sender<Event>,
    current: &mut Option<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)>,
) {
    unsafe {
        if let Some((iface, cb)) = current.take() {
            let _ = iface.UnregisterControlChangeNotify(&cb);
        }

        let device: IMMDevice = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            Ok(d) => d,
            Err(_) => return, // no default playback device (e.g. nothing connected)
        };
        let iface: IAudioEndpointVolume = match device.Activate(CLSCTX_ALL, None) {
            Ok(i) => i,
            Err(_) => return,
        };
        let cb: IAudioEndpointVolumeCallback = VolumeCallback { tx: tx.clone() }.into();
        if iface.RegisterControlChangeNotify(&cb).is_ok() {
            *current = Some((iface, cb));
        }
    }
}

// Read master volume (0..100) + mute from the bound endpoint, printing changes.
fn publish_volume(
    current: &Option<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)>,
    last_volume: &mut Option<u32>,
    last_mute: &mut Option<u32>,
) {
    let Some((iface, _)) = current else { return };
    unsafe {
        if let Ok(scalar) = iface.GetMasterVolumeLevelScalar() {
            let volume = (scalar * 100.0).round().clamp(0.0, 100.0) as u32;
            if *last_volume != Some(volume) {
                *last_volume = Some(volume);
                print_line("volume", &volume.to_string());
            }
        }
        if let Ok(muted) = iface.GetMute() {
            let mute = if muted.as_bool() { 1 } else { 0 };
            if *last_mute != Some(mute) {
                *last_mute = Some(mute);
                print_line("mute", &mute.to_string());
            }
        }
    }
}

fn main() -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }

    let (tx, rx) = channel::<Event>();

    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };

    let notifier: IMMNotificationClient = Notifier { tx: tx.clone() }.into();
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
    let mut last_volume: Option<u32> = None;
    let mut last_mute: Option<u32> = None;
    let mut volume: Option<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)> = None;

    // Initial snapshot.
    refresh_devices(&enumerator, &mut last_playback, &mut last_recording);
    rebind_volume(&enumerator, &tx, &mut volume);
    publish_volume(&volume, &mut last_volume, &mut last_mute);

    loop {
        let first = match rx.recv() {
            Ok(e) => e,
            Err(_) => break,
        };
        // Collapse a burst of callbacks (a single switch or slider drag can fire
        // several) into one refresh.
        let mut device_changed = matches!(first, Event::Device);
        let mut volume_changed = matches!(first, Event::Volume);
        while let Ok(e) = rx.try_recv() {
            match e {
                Event::Device => device_changed = true,
                Event::Volume => volume_changed = true,
            }
        }

        if device_changed {
            refresh_devices(&enumerator, &mut last_playback, &mut last_recording);
            // The default render endpoint may have changed; rebind and re-read.
            rebind_volume(&enumerator, &tx, &mut volume);
            volume_changed = true;
        }
        if volume_changed {
            publish_volume(&volume, &mut last_volume, &mut last_mute);
        }
    }

    unsafe {
        if let Some((iface, cb)) = volume.take() {
            let _ = iface.UnregisterControlChangeNotify(&cb);
        }
        let _ = enumerator.UnregisterEndpointNotificationCallback(&notifier);
    }
    Ok(())
}
