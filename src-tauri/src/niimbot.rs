//! Bluetooth Low Energy link to a NIIMBOT printer. The print protocol stays in
//! the web layer; these commands only scan, connect, write, and return
//! notifications.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde::Serialize;
use tauri::async_runtime::spawn;
use uuid::Uuid;

const CHARACTERISTIC: &str = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";

#[derive(Serialize)]
pub(crate) struct NiimbotDevice {
    id: String,
    name: String,
}

struct Live {
    peripheral: Peripheral,
    characteristic: btleplug::api::Characteristic,
    incoming: Arc<Mutex<VecDeque<Vec<u8>>>>,
}

struct Hub {
    manager: Option<Manager>,
    adapter: Option<Adapter>,
    found: HashMap<String, Peripheral>,
    live: Option<Live>,
}

fn hub() -> &'static tokio::sync::Mutex<Hub> {
    static HUB: std::sync::OnceLock<tokio::sync::Mutex<Hub>> = std::sync::OnceLock::new();
    HUB.get_or_init(|| {
        tokio::sync::Mutex::new(Hub {
            manager: None,
            adapter: None,
            found: HashMap::new(),
            live: None,
        })
    })
}

fn bluetooth_error(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("unauthorized") {
        "Allow Bluetooth for PartsBin in System Settings, then try again.".to_string()
    } else if lower.contains("powered off") || lower.contains("bluetooth is off") {
        "Turn Bluetooth on, then try again.".to_string()
    } else {
        message.to_string()
    }
}

async fn ensure_adapter(hub: &mut Hub) -> Result<(), String> {
    if hub.adapter.is_some() {
        return Ok(());
    }
    let manager = Manager::new()
        .await
        .map_err(|e| bluetooth_error(&e.to_string()))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|e| bluetooth_error(&e.to_string()))?;
    let Some(adapter) = adapters.into_iter().next() else {
        return Err("Turn Bluetooth on, then try again.".to_string());
    };
    hub.manager = Some(manager);
    hub.adapter = Some(adapter);
    Ok(())
}

#[tauri::command]
pub async fn niimbot_scan() -> Result<Vec<NiimbotDevice>, String> {
    let mut hub = hub().lock().await;
    ensure_adapter(&mut hub).await?;
    let adapter = hub.adapter.as_ref().expect("adapter");
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| bluetooth_error(&e.to_string()))?;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let _ = adapter.stop_scan().await;
    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|e| bluetooth_error(&e.to_string()))?;
    hub.found.clear();
    let mut devices = Vec::new();
    for peripheral in peripherals {
        let Ok(Some(props)) = peripheral.properties().await else {
            continue;
        };
        let Some(name) = props.local_name else { continue };
        if !name.to_uppercase().starts_with("D11") {
            continue;
        }
        let id = peripheral.id().to_string();
        devices.push(NiimbotDevice {
            id: id.clone(),
            name,
        });
        hub.found.insert(id, peripheral);
    }
    Ok(devices)
}

#[tauri::command]
pub async fn niimbot_connect(id: String) -> Result<(), String> {
    let peripheral = {
        let hub = hub().lock().await;
        hub.found
            .get(&id)
            .cloned()
            .ok_or_else(|| "That printer is no longer nearby. Look again.".to_string())?
    };
    if hub().lock().await.live.is_some() {
        niimbot_disconnect().await?;
    }
    peripheral
        .connect()
        .await
        .map_err(|e| bluetooth_error(&e.to_string()))?;
    peripheral
        .discover_services()
        .await
        .map_err(|_| "The printer did not offer a print service.".to_string())?;
    let characteristic_id = Uuid::parse_str(CHARACTERISTIC).map_err(|e| e.to_string())?;
    let characteristic = peripheral
        .characteristics()
        .into_iter()
        .find(|item| item.uuid == characteristic_id)
        .ok_or_else(|| "The printer did not offer a print service.".to_string())?;
    peripheral
        .subscribe(&characteristic)
        .await
        .map_err(|_| "The printer did not start sending replies.".to_string())?;
    let mut stream = peripheral
        .notifications()
        .await
        .map_err(|_| "The printer did not start sending replies.".to_string())?;
    let incoming = Arc::new(Mutex::new(VecDeque::new()));
    let queue = Arc::clone(&incoming);
    spawn(async move {
        while let Some(note) = stream.next().await {
            if let Ok(mut inbox) = queue.lock() {
                inbox.push_back(note.value);
            }
        }
    });
    hub().lock().await.live = Some(Live {
        peripheral,
        characteristic,
        incoming,
    });
    Ok(())
}

#[tauri::command]
pub async fn niimbot_write(bytes: Vec<u8>) -> Result<(), String> {
    let (peripheral, characteristic) = {
        let hub = hub().lock().await;
        let live = hub
            .live
            .as_ref()
            .ok_or_else(|| "The printer is not connected.".to_string())?;
        (live.peripheral.clone(), live.characteristic.clone())
    };
    for chunk in bytes.chunks(180) {
        peripheral
            .write(&characteristic, chunk, WriteType::WithoutResponse)
            .await
            .map_err(|e| bluetooth_error(&e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn niimbot_read(timeout_ms: u64) -> Result<Option<Vec<u8>>, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let incoming = {
            let hub = hub().lock().await;
            let Some(live) = hub.live.as_ref() else {
                return Err("The printer is not connected.".to_string());
            };
            Arc::clone(&live.incoming)
        };
        let next = incoming
            .lock()
            .map_err(|error| error.to_string())?
            .pop_front();
        if let Some(bytes) = next {
            return Ok(Some(bytes));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tauri::command]
pub async fn niimbot_disconnect() -> Result<(), String> {
    let live = hub().lock().await.live.take();
    if let Some(live) = live {
        let _ = live.peripheral.disconnect().await;
    }
    Ok(())
}
