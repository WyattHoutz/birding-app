import UIKit
import BackgroundTasks
import UserNotifications
import JavaScriptCore
import Security
import CryptoKit
import Capacitor

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
    weak var plugin: BirdGenNotificationsPlugin?

    static func install() {
        let instance = shared
        UNUserNotificationCenter.current().delegate = instance
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            Task { @MainActor in instance.start(task) }
        }
        instance.registered = registered
        if !registered {
            UserDefaults.standard.set("iOS rejected Bird Gen background task registration.", forKey: instance.errorKey)
        }
        instance.observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in instance.backgroundWork?.cancel() }
        })
        instance.observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in
                do { try await instance.schedule() }
                catch { instance.record(error) }
            }
        })
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

    private func read<T: Decodable>(_ config: BirdNotificationConfiguration, _ suffix: String, as type: T.Type) throws -> T? {
        let url = try fileURL(config, suffix)
        if !FileManager.default.fileExists(atPath: url.path) { return nil }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }

    private func write<T: Encodable>(_ value: T, _ config: BirdNotificationConfiguration, _ suffix: String) throws {
        let url = try fileURL(config, suffix)
        try JSONEncoder().encode(value).write(
            to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
        var resource = url
        var properties = URLResourceValues()
        properties.isExcludedFromBackup = true
        try resource.setResourceValues(properties)
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
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
        guard try activeConfiguration() != nil else { return }
        guard registered else {
            throw BirdNotificationError("The native Bird Gen background task was not registered at launch.")
        }
        _ = try BirdNotificationEngine()
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.taskIdentifier)
        let config = try activeConfiguration()
        let retry = try config.flatMap { try read($0, "state", as: BirdNotificationState.self)?.retryUntil } ?? 0
        request.earliestBeginDate = Date(timeIntervalSince1970: max(
            Date().timeIntervalSince1970 + 30 * 60, retry / 1000
        ))
        try BGTaskScheduler.shared.submit(request)
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
        backgroundWork?.cancel()
        var store = try configurations()
        let previous = store.profiles.removeValue(forKey: profile)
        if store.activeProfile == profile { store.activeProfile = nil }
        try saveConfigurations(store)
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
        guard !processing else { throw BirdNotificationError("Another native notification update is still finishing.") }
        processing = true
        defer { processing = false }
        guard var state = try read(config, "state", as: BirdNotificationState.self) else {
            throw BirdNotificationError("The native notification baseline is missing; turn notifications off and on again.")
        }
        let permission = await UNUserNotificationCenter.current().notificationSettings()
        guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional else {
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
        }
        try Task.checkCancellation()
        guard try activeConfiguration()?.context == config.context else { throw CancellationError() }
        state.ledger = next.ledger
        if background { state.backgroundBaseline = true } else { state.foregroundBaseline = true }
        try write(state, config, "state")
    }

    private func start(_ task: BGTask) {
        guard backgroundWork == nil else {
            task.setTaskCompleted(success: false)
            return
        }
        task.expirationHandler = { [weak self] in
            Task { @MainActor in self?.backgroundWork?.cancel() }
        }
        backgroundWork = Task {
            var success = false
            do {
                try await refresh()
                success = true
            } catch is CancellationError {
                record(BirdNotificationError("The native refresh was interrupted; cached evidence was retained."))
            } catch {
                record(error)
            }
            task.setTaskCompleted(success: success)
            backgroundWork = nil
            do { try await schedule() } catch { record(error) }
        }
    }

    private func refresh() async throws {
        guard let config = try activeConfiguration() else { return }
        guard UIApplication.shared.applicationState != .active else { throw CancellationError() }
        if let state = try read(config, "state", as: BirdNotificationState.self),
           let retry = state.retryUntil, retry > Date().timeIntervalSince1970 * 1000 {
            throw BirdNotificationError("Native eBird requests remain paused after a server/authentication response.")
        }
        let permission = await UNUserNotificationCenter.current().notificationSettings()
        guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional else {
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
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                failures += 1
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
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeOpen", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        Task { @MainActor in BirdGenNotificationService.shared.plugin = self }
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
