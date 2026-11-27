import UIKit
import BackgroundTasks
import UserNotifications
import JavaScriptCore
import Security
import CryptoKit
import Capacitor
import zlib

enum BirdNotificationPersistence {
    private static let jsonTag = Data("BCP1j:".utf8)
    private static let gzipTag = Data("BCP1z:".utf8)
    private static let maximumBytes = 64 * 1024 * 1024

    private enum Failure: LocalizedError {
        case invalid, storage
        var errorDescription: String? {
            switch self {
            case .invalid: return "The saved notification data is invalid."
            case .storage: return "The notification data could not be saved and verified."
            }
        }
    }

    private static func gzip(_ input: Data, decoding: Bool) throws -> Data {
        var stream = z_stream()
        let initialized = decoding
            ? inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            : deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8,
                           Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard initialized == Z_OK else { throw Failure.invalid }
        defer {
            if decoding { inflateEnd(&stream) }
            else { deflateEnd(&stream) }
        }
        return try input.withUnsafeBytes { bytes in
            stream.next_in = UnsafeMutablePointer(mutating: bytes.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uInt(input.count)
            var result = Data()
            var buffer = [UInt8](repeating: 0, count: 16_384)
            while true {
                let capacity = buffer.count
                let status = buffer.withUnsafeMutableBytes { output in
                    stream.next_out = output.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(capacity)
                    return decoding ? inflate(&stream, Z_NO_FLUSH) : deflate(&stream, Z_FINISH)
                }
                let count = capacity - Int(stream.avail_out)
                guard result.count + count <= maximumBytes else { throw Failure.invalid }
                result.append(contentsOf: buffer.prefix(count))
                if status == Z_STREAM_END {
                    guard stream.avail_in == 0 else { throw Failure.invalid }
                    return result
                }
                guard status == Z_OK, count > 0 else { throw Failure.invalid }
            }
        }
    }

    static func pack<T: Encodable>(_ value: T) throws -> Data {
        let json = try JSONEncoder().encode(value)
        guard json.count <= maximumBytes else { throw Failure.invalid }
        if json.count >= 256 {
            let compressed = try gzip(json, decoding: false)
            if compressed.count < json.count { return gzipTag + compressed }
        }
        return jsonTag + json
    }

    static func unpack<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        guard data.count <= maximumBytes + jsonTag.count else { throw Failure.invalid }
        let json: Data
        if data.starts(with: gzipTag) {
            json = try gzip(Data(data.dropFirst(gzipTag.count)), decoding: true)
        } else if data.starts(with: jsonTag) {
            json = Data(data.dropFirst(jsonTag.count))
        } else {
            json = data
        }
        return try JSONDecoder().decode(type, from: json)
    }

    private static func isTagged(_ data: Data) -> Bool {
        data.starts(with: jsonTag) || data.starts(with: gzipTag)
    }

    static func readFile<T: Codable>(_ url: URL, as type: T.Type,
                                     onMigrationFailure: (() -> Void)? = nil) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let value = try unpack(data, as: type)
        if !isTagged(data) {
            do { try writeFile(value, to: url) }
            catch { onMigrationFailure?() }
        }
        return value
    }

    static func writeFile<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try pack(value)
        #if os(iOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        #else
        let options: Data.WritingOptions = [.atomic]
        #endif
        try data.write(to: url, options: options)
        var resource = url
        var properties = URLResourceValues()
        properties.isExcludedFromBackup = true
        try resource.setResourceValues(properties)
        guard try Data(contentsOf: url) == data else { throw Failure.storage }
    }

    static func readDefaults<T: Codable>(_ defaults: UserDefaults, key: String, as type: T.Type,
                                         onMigrationFailure: (() -> Void)? = nil) throws -> T? {
        guard let stored = defaults.object(forKey: key) else { return nil }
        guard let data = stored as? Data else { throw Failure.invalid }
        let value = try unpack(data, as: type)
        if !isTagged(data) {
            do { try writeDefaults(value, to: defaults, key: key) }
            catch { onMigrationFailure?() }
        }
        return value
    }

    static func writeDefaults<T: Encodable>(_ value: T, to defaults: UserDefaults, key: String) throws {
        let data = try pack(value)
        defaults.set(data, forKey: key)
        guard defaults.data(forKey: key) == data else { throw Failure.storage }
    }
}

private let birdGenNotificationPendingOpenKey = "birdgen-notification-open-v1"

fileprivate struct BirdNotificationConfiguration: Codable {
    let profileId: String
    let context: String
    let label: String
    let apiKey: String
    let profileJSON: String
    let paceMs: Int

    func validate() throws {
        guard !profileId.isEmpty, profileId.count <= 80,
              !context.isEmpty, context.count <= 4000,
              !apiKey.isEmpty, apiKey.count <= 200,
              !label.isEmpty, label.count <= 200,
              profileJSON.utf8.count <= 100_000,
              (1200...30_000).contains(paceMs) else {
            throw BirdNotificationError("The saved notification scope or request pace is invalid.")
        }
    }
}

private struct BirdNotificationConfigurations: Codable {
    var activeProfile: String?
    var profiles: [String: BirdNotificationConfiguration] = [:]
}

fileprivate struct BirdNotificationEvent: Codable {
    let id: String
    let title: String
    let body: String
    let observedAt: Double
}

private struct BirdNotificationState: Codable {
    var foregroundBaseline = false
    var backgroundBaseline = false
    var enabledAt: Double
    var ledger: [String: Double] = [:]
    var lastRefresh: Double?
    var lastCoverage: String?
    var lastError: String?
    var retryUntil: Double?
}

final class BirdNotificationTrace {
    enum Stage: String, Codable {
        case schedule, launch, acquisition, qualification, publication, completion, lifecycle, storage
    }
    enum Outcome: String, Codable {
        case started, submitted, accepted, completed, cancelled, expired, failed, skipped
        case baseline, noEvents, permissionBlocked, notConfigured, notRegistered, busy, partial, ok
    }
    enum Count: String, Codable {
        case sources, planned, events, accepted, failures, rows, httpStatus, earliestMs, retryUntilMs
    }
    private struct Entry: Codable {
        let at: Double
        let attempt: UUID
        let stage: Stage
        let outcome: Outcome
        let background: Bool
        let counts: [String: Int]
    }
    static let marker = "BC_BIRDGEN_TRACE_V1"
    private let defaults: UserDefaults
    private let key = "birdgen-stage-trace-v1"
    private var entries: [Entry] = []
    private var attempt = UUID()
    private(set) var storageFailed = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        do {
            if let stored = try BirdNotificationPersistence.readDefaults(defaults, key: key, as: [Entry].self,
                    onMigrationFailure: { self.storageFailed = true }) {
                entries = Array(stored.suffix(64))
                attempt = entries.last?.attempt ?? UUID()
            }
        } catch {
            record(.storage, .failed, background: false)
        }
    }

    func beginAttempt() { attempt = UUID() }

    func record(_ stage: Stage, _ outcome: Outcome, background: Bool, counts: [Count: Int] = [:]) {
        let safeCounts = Dictionary(uniqueKeysWithValues: counts.map { ($0.key.rawValue, max(0, $0.value)) })
        entries.append(Entry(at: Date().timeIntervalSince1970 * 1000, attempt: attempt,
            stage: stage, outcome: outcome, background: background, counts: safeCounts))
        entries = Array(entries.suffix(64))
        do {
            try BirdNotificationPersistence.writeDefaults(entries, to: defaults, key: key)
            storageFailed = false
        } catch {
            storageFailed = true
        }
        if storageFailed { NSLog("%@ storage failed", Self.marker) }
    }

    func snapshot() -> [[String: Any]] {
        return entries.map { entry in
            let allowed = Set([Count.sources, .planned, .events, .accepted, .failures, .rows,
                .httpStatus, .earliestMs, .retryUntilMs].map(\.rawValue))
            return [
                "at": entry.at, "attempt": entry.attempt.uuidString,
                "stage": entry.stage.rawValue, "outcome": entry.outcome.rawValue,
                "background": entry.background,
                "counts": entry.counts.filter { allowed.contains($0.key) && $0.value >= 0 }
            ]
        }
    }
}

private struct BirdNotificationFeed: Codable {
    let file: String
    let kind: String
    let src: String
    let at: Double
    let rowsJSON: String
    let capped: Bool
    var failed: Bool
}

private struct BirdNotificationJob: Decodable {
    let file: String
    let kind: String
    let src: String
    let path: String
}

private struct BirdNotificationPlan: Decodable {
    let jobs: [BirdNotificationJob]
}

private struct BirdNotificationEvaluation: Decodable {
    let events: [BirdNotificationEvent]
    let complete: Bool
    let sources: Int
    let planned: Int
    let errors: [BirdNotificationRowError]
}

private struct BirdNotificationRowError: Decodable {
    let file: String
    let index: Int
    let reason: String
}

private struct BirdNotificationTransition: Decodable {
    let ledger: [String: Double]
    let added: [BirdNotificationEvent]
}

private struct BirdNotificationError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private struct BirdNotificationSourceError: LocalizedError {
    let status: Int
    let retryUntil: Double
    var errorDescription: String? { "Native eBird source returned HTTP \(status); further requests were paused." }
}

private final class BirdNotificationSessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private final class BirdNotificationEngine {
    private let context: JSContext

    init() throws {
        guard let context = JSContext() else {
            throw BirdNotificationError("The on-device notification rule engine is unavailable.")
        }
        self.context = context
        context.evaluateScript("var window = this;")
        for name in ["build-info", "logic", "birdgen-notifications"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "public") else {
                throw BirdNotificationError("A bundled notification rule module is missing.")
            }
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
            if context.exception != nil {
                throw BirdNotificationError("The bundled notification rule module could not load.")
            }
        }
        guard let info = context.objectForKeyedSubscript("__BUILD_INFO__")?.toObject() else {
            throw BirdNotificationError("The native notification build identity is missing.")
        }
        let _: Bool = try call("validateBuild", [info, Date().timeIntervalSince1970 * 1000], as: Bool.self)
    }

    func call<T: Decodable>(_ method: String, _ arguments: [Any], as type: T.Type) throws -> T {
        guard let module = context.objectForKeyedSubscript("BirdGenNotifications"),
              let result = module.invokeMethod(method, withArguments: arguments) else {
            throw BirdNotificationError("The on-device notification rule evaluation failed.")
        }
        if let exception = context.exception {
            throw BirdNotificationError(exception.toString() ?? "The native notification rule evaluation failed.")
        }
        guard context.exception == nil, let jsonModule = context.objectForKeyedSubscript("JSON"),
              let json = jsonModule.invokeMethod("stringify", withArguments: [result])?.toString(),
              let data = json.data(using: .utf8) else {
            throw BirdNotificationError("The on-device notification rules returned invalid data.")
        }
        return try JSONDecoder().decode(type, from: data)
    }

    func profile(_ config: BirdNotificationConfiguration) throws -> Any {
        guard let data = config.profileJSON.data(using: .utf8) else {
            throw BirdNotificationError("The notification profile cannot be read.")
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    func feeds(_ cache: [String: BirdNotificationFeed], planning: Bool = false) throws -> [[String: Any]] {
        var remaining = 10_000
        return try cache.values.filter { !planning || $0.kind != "species" }
            .sorted { $0.file < $1.file }.map { feed in
            guard let data = feed.rowsJSON.data(using: .utf8),
                  let rows = try JSONSerialization.jsonObject(with: data) as? [Any] else {
                throw BirdNotificationError("The native notification source cache is invalid.")
            }
            let selected = Array(rows.prefix(remaining))
            remaining -= selected.count
            return [
                "file": feed.file, "kind": feed.kind, "src": feed.src, "at": feed.at,
                "rows": selected, "capped": feed.capped || selected.count < rows.count, "failed": feed.failed
            ]
        }
    }
}

@MainActor
final class BirdGenNotificationService: NSObject, UNUserNotificationCenterDelegate, NotificationHandlerProtocol {
    static let shared = BirdGenNotificationService()
    static let taskIdentifier = "com.birdchaser.app.birdgen.refresh"
    private let service = "BirdChaser.BirdGenNotifications"
    private let account = "profiles-v1"
    private let prefix = "birdgen-v1."
    private let errorKey = "birdgen-notification-error-v1"
    private var backgroundWork: Task<Void, Never>?
    private var processing = false
    private var registered = false
    private var observers: [NSObjectProtocol] = []
    private var lifecycleSequence = 0
    private var lifecycleEvents: [[String: Any]] = []
    private let diagnostics = BirdNotificationTrace()
    weak var plugin: BirdGenNotificationsPlugin?

    static func install() {
        let instance = shared
        UNUserNotificationCenter.current().delegate = instance
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            Task { @MainActor in instance.start(task) }
        }
        instance.registered = registered
        instance.diagnostics.record(.lifecycle, registered ? .ok : .notRegistered, background: false)
        if !registered {
            UserDefaults.standard.set("iOS rejected Bird Gen background task registration.", forKey: instance.errorKey)
        }
        instance.observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { _ in
            let at = Date().timeIntervalSince1970 * 1000
            let uptime = ProcessInfo.processInfo.systemUptime * 1000
            Task { @MainActor in
                instance.noteLifecycle("foreground", at: at, uptime: uptime)
                if instance.backgroundWork != nil {
                    instance.diagnostics.record(.lifecycle, .cancelled, background: true)
                }
                instance.backgroundWork?.cancel()
            }
        })
        instance.observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { _ in
            let at = Date().timeIntervalSince1970 * 1000
            let uptime = ProcessInfo.processInfo.systemUptime * 1000
            Task { @MainActor in
                instance.noteLifecycle("background", at: at, uptime: uptime)
                do { try await instance.schedule() }
                catch { instance.record(error) }
            }
        })
    }

    private func noteLifecycle(_ phase: String, at: Double, uptime: Double) {
        lifecycleSequence += 1
        lifecycleEvents.append(["sequence": lifecycleSequence, "phase": phase,
                                "at_ms": at, "uptime_ms": uptime])
        if lifecycleEvents.count > 12 { lifecycleEvents.removeFirst(lifecycleEvents.count - 12) }
        plugin?.notifyListeners("lifecycle", data: lifecycleState())
    }

    func lifecycleState() -> [String: Any] {
        ["events": lifecycleEvents, "clock": "native-wall-and-system-uptime"]
    }

    private func record(_ error: Error) {
        UserDefaults.standard.set(error.localizedDescription, forKey: errorKey)
    }

    private func keychainQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func configurations() throws -> BirdNotificationConfigurations {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return BirdNotificationConfigurations() }
        guard status == errSecSuccess, let data = result as? Data else {
            throw BirdNotificationError("The native notification credentials are unavailable (Keychain \(status)).")
        }
        return try JSONDecoder().decode(BirdNotificationConfigurations.self, from: data)
    }

    private func saveConfigurations(_ value: BirdNotificationConfigurations) throws {
        let data = try JSONEncoder().encode(value)
        let query = keychainQuery()
        let status = SecItemUpdate(query as CFDictionary, [
            kSecValueData as String: data
        ] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
                throw BirdNotificationError("Unable to save notification credentials in the device Keychain.")
            }
        } else if status != errSecSuccess {
            throw BirdNotificationError("Unable to update notification credentials (Keychain \(status)).")
        }
    }

    private func activeConfiguration() throws -> BirdNotificationConfiguration? {
        let store = try configurations()
        guard let profile = store.activeProfile else { return nil }
        return store.profiles[profile]
    }

    private func digest(_ text: String) -> String {
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func fileURL(_ config: BirdNotificationConfiguration, _ suffix: String) throws -> URL {
        let directory = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("BirdGenNotifications", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(digest(config.context) + "." + suffix + ".json")
    }

    private func read<T: Codable>(_ config: BirdNotificationConfiguration, _ suffix: String, as type: T.Type) throws -> T? {
        let url = try fileURL(config, suffix)
        return try BirdNotificationPersistence.readFile(url, as: type, onMigrationFailure: {
            self.diagnostics.record(.storage, .failed, background: self.backgroundWork != nil)
        })
    }

    private func write<T: Encodable>(_ value: T, _ config: BirdNotificationConfiguration, _ suffix: String) throws {
        let url = try fileURL(config, suffix)
        try BirdNotificationPersistence.writeFile(value, to: url)
    }

    private func clearFiles(_ config: BirdNotificationConfiguration) throws {
        for suffix in ["state", "cache"] {
            let url = try fileURL(config, suffix)
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    private func schedule() async throws {
        diagnostics.beginAttempt()
        diagnostics.record(.schedule, .started, background: true)
        do {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
            guard try activeConfiguration() != nil else {
                diagnostics.record(.schedule, .notConfigured, background: true)
                return
            }
            guard registered else {
                diagnostics.record(.schedule, .notRegistered, background: true)
                throw BirdNotificationError("The native Bird Gen background task was not registered at launch.")
            }
            _ = try BirdNotificationEngine()
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                diagnostics.record(.schedule, .permissionBlocked, background: true)
                return
            }
            let request = BGAppRefreshTaskRequest(identifier: Self.taskIdentifier)
            let config = try activeConfiguration()
            let retry = try config.flatMap { try read($0, "state", as: BirdNotificationState.self)?.retryUntil } ?? 0
            request.earliestBeginDate = Date(timeIntervalSince1970: max(
                Date().timeIntervalSince1970 + 30 * 60, retry / 1000
            ))
            try BGTaskScheduler.shared.submit(request)
            diagnostics.record(.schedule, .submitted, background: true, counts: [
                .earliestMs: Int((request.earliestBeginDate?.timeIntervalSince1970 ?? 0) * 1000),
                .retryUntilMs: Int(retry)
            ])
        } catch {
            diagnostics.record(.schedule, .failed, background: true)
            throw error
        }
    }

    private func cancelNotifications() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }.filter { $0.hasPrefix(prefix) })
    }

    fileprivate func configure(_ config: BirdNotificationConfiguration, requestPermission: Bool) async throws -> [String: Any] {
        var store = try configurations()
        if !requestPermission && store.profiles[config.profileId] == nil {
            return try await pause(config.profileId)
        }
        try config.validate()
        let engine = try BirdNotificationEngine()
        let _: BirdNotificationPlan = try engine.call("plan", [try engine.profile(config), []], as: BirdNotificationPlan.self)
        let center = UNUserNotificationCenter.current()
        if requestPermission {
            let granted = try await center.requestAuthorization(options: [.alert, .sound])
            if !granted { throw BirdNotificationError("Notifications are not allowed. Enable them in iPhone Settings before trying again.") }
        }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            throw BirdNotificationError("Notifications are blocked in iPhone Settings.")
        }
        if let previous = store.profiles[config.profileId], previous.context != config.context {
            try clearFiles(previous)
        }
        if try read(config, "state", as: BirdNotificationState.self) == nil {
            try write(BirdNotificationState(enabledAt: Date().timeIntervalSince1970 * 1000), config, "state")
        }
        if let previous = store.profiles[config.profileId], previous.apiKey != config.apiKey,
           var state = try read(config, "state", as: BirdNotificationState.self) {
            state.retryUntil = nil
            try write(state, config, "state")
        }
        backgroundWork?.cancel()
        if store.activeProfile != config.profileId || store.profiles[config.profileId]?.context != config.context {
            await cancelNotifications()
        }
        store.profiles[config.profileId] = config
        store.activeProfile = config.profileId
        try saveConfigurations(store)
        UserDefaults.standard.removeObject(forKey: errorKey)
        try await schedule()
        return try await status(config.profileId)
    }

    fileprivate func pause(_ profile: String) async throws -> [String: Any] {
        backgroundWork?.cancel()
        var store = try configurations()
        store.activeProfile = nil
        try saveConfigurations(store)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
        await cancelNotifications()
        return try await status(profile)
    }

    fileprivate func disable(_ profile: String) async throws -> [String: Any] {
        let pending = backgroundWork
        pending?.cancel()
        var store = try configurations()
        let previous = store.profiles.removeValue(forKey: profile)
        if store.activeProfile == profile { store.activeProfile = nil }
        try saveConfigurations(store)
        // Drain cancellation before removing files/notifications: an awaited
        // delivery can otherwise complete after the cleanup it raced.
        if let pending { await pending.value }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
        await cancelNotifications()
        if let previous { try clearFiles(previous) }
        UserDefaults.standard.removeObject(forKey: errorKey)
        return try await status(profile)
    }

    fileprivate func status(_ profile: String) async throws -> [String: Any] {
        let store = try configurations()
        let config = store.profiles[profile]
        let state = try config.flatMap { try read($0, "state", as: BirdNotificationState.self) }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return [
            "enabled": config != nil,
            "active": config != nil && store.activeProfile == profile,
            "permissionAllowed": settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
            "backgroundRefreshAvailable": UIApplication.shared.backgroundRefreshStatus == .available,
            "lastRefresh": state?.lastRefresh ?? 0,
            "trace": diagnostics.snapshot(),
            "traceStorageFailed": diagnostics.storageFailed,
            "coverage": state?.lastCoverage ?? "No native background refresh has completed yet.",
            "error": UserDefaults.standard.string(forKey: errorKey) ?? state?.lastError ?? ""
        ]
    }

    fileprivate func synchronize(_ context: String, events: [BirdNotificationEvent]) async throws {
        guard let config = try activeConfiguration(), config.context == context else {
            throw BirdNotificationError("The notification profile or region changed; this result was ignored.")
        }
        try await publish(config, events: events, background: false)
    }

    private func publish(_ config: BirdNotificationConfiguration, events: [BirdNotificationEvent], background: Bool) async throws {
        diagnostics.record(.publication, .started, background: background, counts: [.events: events.count])
        guard !processing else {
            diagnostics.record(.publication, .busy, background: background)
            throw BirdNotificationError("Another native notification update is still finishing.")
        }
        processing = true
        defer { processing = false }
        do {
            guard var state = try read(config, "state", as: BirdNotificationState.self) else {
                throw BirdNotificationError("The native notification baseline is missing; turn notifications off and on again.")
            }
            let permission = await UNUserNotificationCenter.current().notificationSettings()
            guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional else {
                diagnostics.record(.publication, .permissionBlocked, background: background)
                throw BirdNotificationError("Notifications are blocked in iPhone Settings.")
            }
            try Task.checkCancellation()
            let baseline = background ? !state.backgroundBaseline : !state.foregroundBaseline
            let engine = try BirdNotificationEngine()
            let input = try JSONSerialization.jsonObject(with: JSONEncoder().encode(events))
            let now = Date().timeIntervalSince1970 * 1000
            let next: BirdNotificationTransition = try engine.call(
                "transition", [state.ledger, input, now, baseline], as: BirdNotificationTransition.self
            )
            let fresh = next.added.filter { $0.observedAt >= state.enabledAt }
            diagnostics.record(.publication, baseline ? .baseline : fresh.isEmpty ? .noEvents : .ok,
                background: background, counts: [.events: events.count])
            if !fresh.isEmpty {
                guard try activeConfiguration()?.context == config.context else { throw CancellationError() }
                if background && UIApplication.shared.applicationState == .active { throw CancellationError() }
                try Task.checkCancellation()
                let content = UNMutableNotificationContent()
                content.title = fresh.count == 1 ? fresh[0].title : "\(fresh.count) new Bird Gen alerts"
                content.body = fresh.count == 1 ? fresh[0].body : fresh.prefix(3).map(\.title).joined(separator: " · ")
                content.sound = .default
                content.userInfo = ["birdGenContext": digest(config.context)]
                let identifier = prefix + digest(config.context + "|" + fresh.map(\.id).sorted().joined(separator: "|"))
                try await UNUserNotificationCenter.current().add(
                    UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
                )
                diagnostics.record(.publication, .accepted, background: background,
                    counts: [.accepted: 1, .events: fresh.count])
            }
            try Task.checkCancellation()
            guard try activeConfiguration()?.context == config.context else { throw CancellationError() }
            state.ledger = next.ledger
            if background { state.backgroundBaseline = true } else { state.foregroundBaseline = true }
            try write(state, config, "state")
        } catch is CancellationError {
            diagnostics.record(.publication, .cancelled, background: background)
            throw CancellationError()
        } catch {
            diagnostics.record(.publication, .failed, background: background)
            throw error
        }
    }

    private func start(_ task: BGTask) {
        diagnostics.record(.launch, .started, background: true)
        guard backgroundWork == nil else {
            diagnostics.record(.launch, .busy, background: true)
            task.setTaskCompleted(success: false)
            return
        }
        task.expirationHandler = { [weak self] in
            Task { @MainActor in
                self?.diagnostics.record(.completion, .expired, background: true)
                self?.backgroundWork?.cancel()
            }
        }
        backgroundWork = Task {
            var success = false
            do {
                try await refresh()
                success = true
            } catch is CancellationError {
                diagnostics.record(.completion, .cancelled, background: true)
                record(BirdNotificationError("The native refresh was interrupted; cached evidence was retained."))
            } catch {
                diagnostics.record(.completion, .failed, background: true)
                record(error)
            }
            if success { diagnostics.record(.completion, .completed, background: true) }
            task.setTaskCompleted(success: success)
            backgroundWork = nil
            do { try await schedule() } catch { record(error) }
        }
    }

    private func refresh() async throws {
        diagnostics.record(.acquisition, .started, background: true)
        guard let config = try activeConfiguration() else {
            diagnostics.record(.acquisition, .notConfigured, background: true)
            return
        }
        guard UIApplication.shared.applicationState != .active else {
            diagnostics.record(.acquisition, .cancelled, background: true)
            throw CancellationError()
        }
        if let state = try read(config, "state", as: BirdNotificationState.self),
           let retry = state.retryUntil, retry > Date().timeIntervalSince1970 * 1000 {
            diagnostics.record(.acquisition, .skipped, background: true, counts: [.retryUntilMs: Int(retry)])
            throw BirdNotificationError("Native eBird requests remain paused after a server/authentication response.")
        }
        let permission = await UNUserNotificationCenter.current().notificationSettings()
        guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional else {
            diagnostics.record(.acquisition, .permissionBlocked, background: true)
            throw BirdNotificationError("Native refresh skipped because notification permission is blocked.")
        }
        let deadline = Date(timeIntervalSinceNow: 25)
        let engine = try BirdNotificationEngine()
        let profile = try engine.profile(config)
        var cache = try read(config, "cache", as: [String: BirdNotificationFeed].self) ?? [:]
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.timeoutIntervalForRequest = 8
        sessionConfiguration.timeoutIntervalForResource = 10
        sessionConfiguration.httpShouldSetCookies = false
        sessionConfiguration.httpCookieStorage = nil
        sessionConfiguration.urlCredentialStorage = nil
        let session = URLSession(
            configuration: sessionConfiguration, delegate: BirdNotificationSessionDelegate(), delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var attempted = Set<String>()
        var failures = 0
        while Date() < deadline {
            try Task.checkCancellation()
            guard try activeConfiguration()?.context == config.context else { throw CancellationError() }
            let plan: BirdNotificationPlan = try engine.call("plan", [profile, try engine.feeds(cache, planning: true)], as: BirdNotificationPlan.self)
            let now = Date().timeIntervalSince1970 * 1000
            guard let job = plan.jobs.first(where: {
                !attempted.contains($0.file) && (cache[$0.file] == nil || cache[$0.file]!.failed || now - cache[$0.file]!.at > 30 * 60 * 1000)
            }) else { break }
            attempted.insert(job.file)
            guard job.path.hasPrefix("data/obs/"), !job.path.contains(".."),
                  let url = URL(string: "https://api.ebird.org/v2/" + job.path),
                  url.host == "api.ebird.org" else {
                throw BirdNotificationError("The native feed planner returned an invalid eBird request.")
            }
            var request = URLRequest(url: url)
            request.setValue(config.apiKey, forHTTPHeaderField: "X-eBirdApiToken")
            request.timeoutInterval = min(8, max(1, deadline.timeIntervalSinceNow))
            var stop = false
            do {
                let (data, response) = try await session.data(for: request)
                try Task.checkCancellation()
                guard let http = response as? HTTPURLResponse else {
                    throw BirdNotificationError("Native eBird source returned a non-HTTP response.")
                }
                if [401, 403, 429].contains(http.statusCode) {
                    let raw = http.value(forHTTPHeaderField: "Retry-After") ?? ""
                    let formatter = DateFormatter()
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                    let wait = Double(raw) ?? formatter.date(from: raw)?.timeIntervalSinceNow ?? 15 * 60
                    let seconds = wait.isFinite ? max(60, wait) : 15 * 60
                    throw BirdNotificationSourceError(
                        status: http.statusCode, retryUntil: Date().addingTimeInterval(seconds).timeIntervalSince1970 * 1000
                    )
                }
                guard (200...299).contains(http.statusCode) else {
                    throw BirdNotificationError("Native eBird source returned HTTP \(http.statusCode).")
                }
                guard data.count <= 3 * 1024 * 1024,
                      let rows = try JSONSerialization.jsonObject(with: data) as? [Any],
                      let json = String(data: data, encoding: .utf8) else {
                    throw BirdNotificationError("Native eBird source returned invalid observation rows.")
                }
                cache[job.file] = BirdNotificationFeed(
                    file: job.file, kind: job.kind, src: job.src,
                    at: Date().timeIntervalSince1970 * 1000, rowsJSON: json,
                    capped: rows.count >= 1000, failed: false
                )
                diagnostics.record(.acquisition, .ok, background: true, counts: [.rows: rows.count])
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                failures += 1
                diagnostics.record(.acquisition, .failed, background: true, counts: [.failures: failures])
                if var previous = cache[job.file] {
                    previous.failed = true
                    cache[job.file] = previous
                }
                record(error)
                if let source = error as? BirdNotificationSourceError,
                   var state = try read(config, "state", as: BirdNotificationState.self) {
                    state.retryUntil = source.retryUntil
                    try write(state, config, "state")
                    stop = true
                }
            }
            try write(cache, config, "cache")
            if stop { break }
            if Date().addingTimeInterval(Double(config.paceMs) / 1000) >= deadline { break }
            try await Task.sleep(nanoseconds: UInt64(config.paceMs) * 1_000_000)
        }
        let finalPlan: BirdNotificationPlan = try engine.call(
            "plan", [profile, try engine.feeds(cache, planning: true)], as: BirdNotificationPlan.self
        )
        let allowed = Set(finalPlan.jobs.map(\.file))
        cache = cache.filter { allowed.contains($0.key) }
        try write(cache, config, "cache")
        let result: BirdNotificationEvaluation = try engine.call(
            "evaluate", [profile, try engine.feeds(cache), Date().timeIntervalSince1970 * 1000],
            as: BirdNotificationEvaluation.self
        )
        diagnostics.record(.qualification, result.complete ? .ok : .partial, background: true,
            counts: [.sources: result.sources, .planned: result.planned, .events: result.events.count])
        guard result.sources > 0 else {
            throw BirdNotificationError("No fresh native sources were available; no absence or empty-baseline claim was made.")
        }
        try await publish(config, events: result.events, background: true)
        guard var state = try read(config, "state", as: BirdNotificationState.self) else {
            throw BirdNotificationError("The native notification state could not be read after evaluation.")
        }
        state.lastRefresh = Date().timeIntervalSince1970 * 1000
        state.lastCoverage = "\(result.sources)/\(result.planned) fresh sources; "
            + (result.complete ? "planned coverage complete" : "partial/capped coverage; Crowd held back")
            + "; \(failures) source failures; \(result.errors.count) sampled malformed rows. Background categories: Celebrity and Crowd only."
        state.lastError = failures > 0 ? "Some native sources failed; successful evidence was retained."
            : result.errors.isEmpty ? nil : "Malformed rows skipped: " + result.errors.prefix(10).map {
                "\($0.file) row \($0.index + 1): \($0.reason)"
            }.joined(separator: "; ")
        try write(state, config, "state")
        if failures == 0 { UserDefaults.standard.removeObject(forKey: errorKey) }
    }

    fileprivate func takeOpen() throws -> [String: Any] {
        guard let hash = UserDefaults.standard.string(forKey: birdGenNotificationPendingOpenKey) else {
            return ["context": ""]
        }
        let store = try configurations()
        let context = store.profiles.values.first { digest($0.context) == hash }?.context
        UserDefaults.standard.removeObject(forKey: birdGenNotificationPendingOpenKey)
        return ["context": context ?? "outdated-notification-scope"]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        didReceive(response: response)
        completionHandler()
    }

    nonisolated func didReceive(response: UNNotificationResponse) {
        guard let context = response.notification.request.content.userInfo["birdGenContext"] as? String else { return }
        UserDefaults.standard.set(context, forKey: birdGenNotificationPendingOpenKey)
        Task { @MainActor in
            plugin?.notifyListeners("open", data: [:], retainUntilConsumed: true)
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(willPresent(notification: notification))
    }

    nonisolated func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        return [.banner, .sound]
    }
}

@objc(BirdGenNotificationsPlugin)
public final class BirdGenNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BirdGenNotificationsPlugin"
    public let jsName = "BirdGenNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lifecycle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeOpen", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        Task { @MainActor in BirdGenNotificationService.shared.plugin = self }
    }

    @objc public func lifecycle(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(BirdGenNotificationService.shared.lifecycleState()) }
    }

    @objc public func configure(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let object = call.getObject("configuration") else {
                    throw BirdNotificationError("The notification configuration is missing.")
                }
                let data = try JSONSerialization.data(withJSONObject: object)
                let config = try JSONDecoder().decode(BirdNotificationConfiguration.self, from: data)
                call.resolve(try await BirdGenNotificationService.shared.configure(
                    config, requestPermission: call.getBool("requestPermission") == true
                ))
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func disable(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let profile = call.getString("profileId") else { throw BirdNotificationError("The notification profile is missing.") }
                call.resolve(try await BirdGenNotificationService.shared.disable(profile))
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func pause(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let profile = call.getString("profileId") else { throw BirdNotificationError("The notification profile is missing.") }
                call.resolve(try await BirdGenNotificationService.shared.pause(profile))
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func status(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let profile = call.getString("profileId") else { throw BirdNotificationError("The notification profile is missing.") }
                call.resolve(try await BirdGenNotificationService.shared.status(profile))
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func sync(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let context = call.getString("context"), let events = call.getArray("events") else {
                    throw BirdNotificationError("The notification events or scope are missing.")
                }
                let data = try JSONSerialization.data(withJSONObject: events)
                let decoded = try JSONDecoder().decode([BirdNotificationEvent].self, from: data)
                guard decoded.count <= 500 else { throw BirdNotificationError("Too many notification candidates.") }
                try await BirdGenNotificationService.shared.synchronize(context, events: decoded)
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func takeOpen(_ call: CAPPluginCall) {
        Task { @MainActor in
            do { call.resolve(try BirdGenNotificationService.shared.takeOpen()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
}
