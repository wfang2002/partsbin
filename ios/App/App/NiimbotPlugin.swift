import Capacitor
import CoreBluetooth
import Foundation

/// Bluetooth Low Energy link to a NIIMBOT printer. The print protocol stays in
/// the web layer; this only scans, connects, writes, and returns notifications.
@objc(NiimbotPlugin)
public class NiimbotPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "NiimbotPlugin"
    public let jsName = "Niimbot"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]

    private let serviceId = CBUUID(string: "e7810a71-73ae-499d-8c15-faa9aef0c3f2")
    private let characteristicId = CBUUID(string: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f")

    private var central: CBCentralManager?
    private var whenReady: ((CBCentralManager) -> Void)?
    private var found: [UUID: CBPeripheral] = [:]
    private var names: [UUID: String] = [:]
    private var scanCall: CAPPluginCall?
    private var scanTimer: DispatchWorkItem?
    private var connectCall: CAPPluginCall?
    private var connectTimer: DispatchWorkItem?
    private var peripheral: CBPeripheral?
    private var characteristic: CBCharacteristic?
    private var inbox: [Data] = []
    private var reader: ((Data?) -> Void)?
    private var readToken = 0

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.scanCall?.resolve(["devices": []])
            self.scanCall = call
            self.found = [:]
            self.names = [:]
            self.withCentral { central in
                guard central.state == .poweredOn else {
                    self.finishScan(error: self.bluetoothMessage(central.state))
                    return
                }
                central.scanForPeripherals(withServices: nil, options: nil)
                let timer = DispatchWorkItem { self.finishScan(error: nil) }
                self.scanTimer = timer
                DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: timer)
            }
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("id"), let uuid = UUID(uuidString: id), let target = self.found[uuid] else {
                call.reject("That printer is no longer nearby. Look again.")
                return
            }
            guard let central = self.central, central.state == .poweredOn else {
                call.reject("Turn Bluetooth on, then try again.")
                return
            }
            self.connectCall = call
            self.peripheral = target
            self.characteristic = nil
            self.inbox = []
            target.delegate = self
            central.stopScan()
            central.connect(target, options: nil)
            let timer = DispatchWorkItem { [weak self] in
                guard let self, self.connectCall === call else { return }
                central.cancelPeripheralConnection(target)
                self.failConnect("Could not connect to the printer.")
            }
            self.connectTimer = timer
            DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timer)
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let peripheral = self.peripheral, let characteristic = self.characteristic else {
                call.reject("The printer is not connected.")
                return
            }
            guard let numbers = call.getArray("bytes", NSNumber.self) else {
                call.reject("Missing print data.")
                return
            }
            let data = Data(numbers.map { UInt8(truncating: $0) })
            let chunk = max(peripheral.maximumWriteValueLength(for: .withoutResponse), 20)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunk, data.count)
                peripheral.writeValue(data.subdata(in: offset..<end), for: characteristic, type: .withoutResponse)
                offset = end
            }
            call.resolve()
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let timeout = call.getInt("timeoutMs") ?? 500
            if !self.inbox.isEmpty {
                let data = self.inbox.removeFirst()
                call.resolve(["bytes": data.map { Int($0) }])
                return
            }
            self.readToken += 1
            let token = self.readToken
            self.reader = { data in
                if let data {
                    call.resolve(["bytes": data.map { Int($0) }])
                } else {
                    call.resolve(["bytes": NSNull()])
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeout)) { [weak self] in
                guard let self, self.readToken == token else { return }
                self.reader = nil
                call.resolve(["bytes": NSNull()])
            }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.dropLink()
            call.resolve()
        }
    }

    private func withCentral(_ ready: @escaping (CBCentralManager) -> Void) {
        if let central, central.state != .unknown && central.state != .resetting {
            ready(central)
            return
        }
        whenReady = ready
        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main)
        }
    }

    private func bluetoothMessage(_ state: CBManagerState) -> String {
        switch state {
        case .unauthorized:
            return "Allow Bluetooth for PartsBin in Settings, then try again."
        case .poweredOff:
            return "Turn Bluetooth on, then try again."
        case .unsupported:
            return "This iPhone has no Bluetooth."
        default:
            return "Bluetooth is not ready. Try again."
        }
    }

    private func finishScan(error: String?) {
        central?.stopScan()
        scanTimer?.cancel()
        let call = scanCall
        scanCall = nil
        if let error {
            call?.reject(error)
            return
        }
        let devices = names.compactMap { id, name -> [String: String]? in
            guard name.uppercased().hasPrefix("D11") else { return nil }
            return ["id": id.uuidString, "name": name]
        }
        call?.resolve(["devices": devices])
    }

    private func failConnect(_ message: String) {
        connectTimer?.cancel()
        let call = connectCall
        connectCall = nil
        call?.reject(message)
    }

    private func dropLink() {
        connectTimer?.cancel()
        readToken += 1
        reader = nil
        inbox = []
        characteristic = nil
        if let peripheral, let central {
            central.cancelPeripheralConnection(peripheral)
        }
        peripheral = nil
    }

    private func deliver(_ data: Data) {
        if let reader {
            readToken += 1
            self.reader = nil
            reader(data)
        } else {
            inbox.append(data)
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state != .unknown && central.state != .resetting else { return }
        let ready = whenReady
        whenReady = nil
        ready?(central)
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi: NSNumber
    ) {
        let advertised = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        if let name = advertised ?? peripheral.name {
            names[peripheral.identifier] = name
            found[peripheral.identifier] = peripheral
        }
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([serviceId])
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        failConnect("Could not connect to the printer.")
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == serviceId }) else {
            failConnect("The printer did not offer a print service.")
            return
        }
        peripheral.discoverCharacteristics([characteristicId], for: service)
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        guard error == nil, let characteristic = service.characteristics?.first(where: { $0.uuid == characteristicId }) else {
            failConnect("The printer did not offer a print service.")
            return
        }
        self.characteristic = characteristic
        peripheral.setNotifyValue(true, for: characteristic)
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard connectCall != nil else { return }
        if error != nil || !characteristic.isNotifying {
            failConnect("The printer did not start sending replies.")
            return
        }
        connectTimer?.cancel()
        let call = connectCall
        connectCall = nil
        call?.resolve()
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard error == nil, let value = characteristic.value, !value.isEmpty else { return }
        deliver(value)
    }
}
