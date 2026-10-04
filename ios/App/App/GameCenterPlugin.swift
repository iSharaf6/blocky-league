import Capacitor
import AuthenticationServices
import CoreHaptics
import GameKit
import StoreKit
import UIKit

/// The game's screen: Capacitor's own bridge, plus this app's own plugins. They live in the app target rather than in
/// a package, so they are registered here (SceneDelegate makes this the root view controller).
class GameViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
        bridge?.registerPluginInstance(AppReviewPlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
        bridge?.registerPluginInstance(PurchaseEventsPlugin())
        bridge?.registerPluginInstance(NativeAuthPlugin())
    }
}

/// StoreKit 1 failures survive a deferred order and a process restart. Cordova remains the receipt owner and
/// finishes transactions; this observer only records rejected payments until the web save acknowledges them.
@objc(PurchaseEventsPlugin)
public class PurchaseEventsPlugin: CAPPlugin, CAPBridgedPlugin, SKPaymentTransactionObserver {
    public let identifier = "PurchaseEventsPlugin"
    public let jsName = "PurchaseEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
    ]
    private let storageKey = "blocky-purchase-rejections-v1"
    private var transactionEvents: [ObjectIdentifier: String] = [:]
    // Keep the identity alive until StoreKit removes it, so a later payment cannot reuse its object address.
    private var rejectedTransactions: [ObjectIdentifier: SKPaymentTransaction] = [:]
    private var pending: [[String: String]] {
        get { UserDefaults.standard.array(forKey: storageKey) as? [[String: String]] ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: storageKey) }
    }

    public override func load() { SKPaymentQueue.default().add(self) }
    deinit { SKPaymentQueue.default().remove(self) }

    public func paymentQueue(_ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]) {
        for transaction in transactions where transaction.transactionState == .failed {
            let product = transaction.payment.productIdentifier
            guard product.hasPrefix("bl.") else { continue }
            let object = ObjectIdentifier(transaction)
            let id = transactionEvents[object] ?? UUID().uuidString
            transactionEvents[object] = id
            rejectedTransactions[object] = transaction
            let error = transaction.error as NSError?
            let cancelled = error?.domain == SKErrorDomain && error?.code == SKError.paymentCancelled.rawValue
            let event = ["id": id, "productId": product, "result": cancelled ? "cancelled" : "failed"]
            var events = pending
            if !events.contains(where: { $0["id"] == id }) { events.append(event); pending = events }
            notifyListeners("rejected", data: event, retainUntilConsumed: true)
        }
    }

    public func paymentQueue(_ queue: SKPaymentQueue, removedTransactions transactions: [SKPaymentTransaction]) {
        for transaction in transactions {
            let object = ObjectIdentifier(transaction)
            transactionEvents.removeValue(forKey: object)
            rejectedTransactions.removeValue(forKey: object)
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            for event in self.pending { self.notifyListeners("rejected", data: event, retainUntilConsumed: true) }
            call.resolve()
        }
    }

    @objc public func acknowledge(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Missing event ID"); return }
        DispatchQueue.main.async {
            self.pending = self.pending.filter { $0["id"] != id }
            call.resolve()
        }
    }
}

/// Native Sign in with Apple avoids a renewable web OAuth client secret on iPhone and iPad.
@objc(NativeAuthPlugin)
public class NativeAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "NativeAuthPlugin"
    public let jsName = "NativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise)]
    private var pendingCall: CAPPluginCall?
    private var authorization: ASAuthorizationController?

    @objc public func signInWithApple(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), nonce.count == 64,
              nonce.allSatisfy({ $0.isHexDigit }) else { call.reject("Invalid nonce"); return }
        DispatchQueue.main.async {
            guard self.pendingCall == nil else { call.reject("Sign-in already in progress"); return }
            guard self.bridge?.viewController?.view.window != nil else { call.reject("Sign-in window unavailable"); return }
            self.pendingCall = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.authorization = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? UIWindow()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization result: ASAuthorization) {
        guard let credential = result.credential as? ASAuthorizationAppleIDCredential,
              let token = credential.identityToken, let idToken = String(data: token, encoding: .utf8) else {
            pendingCall?.reject("Apple did not return an identity token")
            pendingCall = nil; authorization = nil
            return
        }
        var data: [String: Any] = ["idToken": idToken]
        if let name = credential.fullName {
            let fullName = PersonNameComponentsFormatter().string(from: name)
            if !fullName.isEmpty { data["fullName"] = fullName }
        }
        pendingCall?.resolve(data)
        pendingCall = nil; authorization = nil
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as NSError).domain == ASAuthorizationError.errorDomain
            && (error as NSError).code == ASAuthorizationError.canceled.rawValue
        pendingCall?.reject(cancelled ? "Sign-in cancelled" : "Apple sign-in failed", cancelled ? "CANCELED" : "APPLE_AUTH_FAILED")
        pendingCall = nil; authorization = nil
    }
}

/// Haptics for the web game (src/platform/haptics.ts, which picks them, throttles them and honours Settings >
/// VIBRATION): an impact { style: light | medium | heavy | rigid | soft, intensity: 0...1, count, apart (ms),
/// duration (ms): a continuous buzz that long under the tap }, a pattern { name: goal | win | super | post | whistle |
/// sub | concede }, a selection tick, a notification { type: success | warning | error }, and prepare (wake the engine
/// so the next one lands on time). Fire and forget: each call resolves at once and plays on the main thread.
///
/// The owner, on his iPhone: "i cant fel the vibration in full". A lone transient is easy to miss with a thumb on the
/// glass, so contacts (a shot, a tackle, a save) are short continuous buzzes at full strength, and the big moments are
/// patterns with a shape of their own: the goal a 0.6 s rumble rising through four thumps into a heavy double.
@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "Haptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pattern", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
    ]

    // (Made on the main thread on first use, and kept prepared after every tap so the next one has no lag.)
    private var impacts: [String: UIImpactFeedbackGenerator] = [:]
    private var selector: UISelectionFeedbackGenerator?
    private var notice: UINotificationFeedbackGenerator?

    private func impactGenerator(_ style: String) -> UIImpactFeedbackGenerator {
        if let g = impacts[style] { return g }
        let kind: UIImpactFeedbackGenerator.FeedbackStyle
        switch style {
        case "heavy": kind = .heavy
        case "medium": kind = .medium
        case "rigid": kind = .rigid
        case "soft": kind = .soft
        default: kind = .light
        }
        let g = UIImpactFeedbackGenerator(style: kind)
        impacts[style] = g
        return g
    }

    private func selectionGenerator() -> UISelectionFeedbackGenerator {
        if selector == nil { selector = UISelectionFeedbackGenerator() }
        return selector!
    }

    private func noticeGenerator() -> UINotificationFeedbackGenerator {
        if notice == nil { notice = UINotificationFeedbackGenerator() }
        return notice!
    }

    // Core Haptics first: the engine games use. It plays crisp, strong taps and buzzes with set intensity and
    // sharpness. The UIKit generators above provide the fallback when a custom pattern cannot play. Hardware
    // support and iOS vibration settings still apply; neither API can override the user's settings. The engine
    // idles off by itself and restarts on the next tap.
    private var engine: CHHapticEngine?
    private let supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    private func hapticEngine() -> CHHapticEngine? {
        guard supportsHaptics, UIApplication.shared.applicationState == .active else { return nil }
        do {
            if let e = engine {
                try e.start()
                return e
            }
            let e = try CHHapticEngine()
            e.playsHapticsOnly = true
            e.isAutoShutdownEnabled = true
            // (After an interruption, a call or the app going to the background, the engine resets: start it again.)
            e.resetHandler = { [weak e] in
                DispatchQueue.main.async {
                    guard UIApplication.shared.applicationState == .active else { return }
                    try? e?.start()
                }
            }
            try e.start()
            engine = e
            return e
        } catch {
            // Calls, ads and app suspension can make startup fail temporarily. Keep the hardware capability
            // separate: the next user-initiated contact must retry rather than disabling haptics for the session.
            return nil
        }
    }

    /// One piece of a pattern, `at` s from its start: a transient tap (`dur` 0) or a continuous buzz `dur` s long,
    /// at `level` (intensity 0...1) and `sharp` (0 a dull thud ... 1 a crisp click).
    private struct Beat {
        let at: Double
        let dur: Double
        let level: Float
        let sharp: Float

        static func tap(_ at: Double, _ level: Float, _ sharp: Float) -> Beat {
            return Beat(at: at, dur: 0, level: level, sharp: sharp)
        }

        static func buzz(_ at: Double, _ dur: Double, _ level: Float, _ sharp: Float) -> Beat {
            return Beat(at: at, dur: dur, level: level, sharp: sharp)
        }
    }

    /// Play `beats`, the whole pattern's strength following `ramp` (time s, 0...1) when one is given: a crescendo, a
    /// ring dying away. False when Core Haptics can't, so the caller falls back to the UIKit generators.
    private func play(_ beats: [Beat], ramp: [(Double, Float)] = []) -> Bool {
        guard let e = hapticEngine() else { return false }
        let events: [CHHapticEvent] = beats.map { b in
            let params = [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: min(1, max(0, b.level))),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: min(1, max(0, b.sharp))),
            ]
            if b.dur > 0 {
                return CHHapticEvent(eventType: .hapticContinuous, parameters: params, relativeTime: b.at, duration: b.dur)
            }
            return CHHapticEvent(eventType: .hapticTransient, parameters: params, relativeTime: b.at)
        }
        do {
            let pattern: CHHapticPattern
            if ramp.isEmpty {
                pattern = try CHHapticPattern(events: events, parameters: [])
            } else {
                let points = ramp.map { CHHapticParameterCurve.ControlPoint(relativeTime: $0.0, value: $0.1) }
                let curve = CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: points, relativeTime: 0)
                pattern = try CHHapticPattern(events: events, parameterCurves: [curve])
            }
            let player = try e.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            return true
        } catch {
            return false
        }
    }

    /// Each style's strength and feel: a light tap is clearly felt, a heavy one thumps, rigid is crisp.
    private static let feel: [String: (Float, Float)] = [
        "light": (0.8, 0.6), "medium": (0.95, 0.5), "heavy": (1.0, 0.3), "rigid": (1.0, 1.0), "soft": (0.8, 0.1),
    ]

    /// The patterns, by name (src/platform/haptics.ts HapticPattern), each with a shape of its own.
    private static func beats(_ name: String) -> (beats: [Beat], ramp: [(Double, Float)])? {
        switch name {
        case "goal":
            // 0.6 s of rumble growing under four thumps that climb, then a heavy double and its tail.
            return ([
                .buzz(0, 0.62, 1, 0.35),
                .tap(0, 0.7, 0.4), .tap(0.16, 0.8, 0.45), .tap(0.32, 0.9, 0.5), .tap(0.46, 1, 0.55),
                .tap(0.62, 1, 0.3), .tap(0.75, 1, 0.3), .buzz(0.62, 0.2, 1, 0.2),
            ], [(0, 0.4), (0.3, 0.65), (0.55, 1), (0.95, 1)])
        case "win":
            // Three rising thumps, then a long buzz dying away.
            return ([
                .tap(0, 0.8, 0.5), .tap(0.14, 0.9, 0.6), .tap(0.28, 1, 0.7), .buzz(0.28, 0.52, 1, 0.3),
            ], [(0, 1), (0.3, 1), (0.8, 0.3)])
        case "super":
            // A sharp wind-up, the slam, its aftershock.
            return ([
                .buzz(0, 0.16, 1, 0.85), .tap(0.17, 1, 0.25), .buzz(0.17, 0.14, 1, 0.15), .tap(0.36, 0.9, 0.2),
            ], [(0, 0.35), (0.16, 1), (0.6, 1)])
        case "post":
            // The crack of the woodwork, ringing on.
            return ([
                .tap(0, 1, 1), .buzz(0, 0.22, 0.9, 1), .tap(0.09, 0.7, 1),
            ], [(0, 1), (0.08, 0.8), (0.22, 0.2)])
        case "whistle":
            // Two short blasts and a long one.
            return ([
                .buzz(0, 0.09, 0.8, 0.95), .buzz(0.15, 0.09, 0.8, 0.95), .buzz(0.32, 0.34, 0.95, 0.95),
            ], [])
        case "sub":
            // The high five: a quick double tap, the second firmer.
            return ([
                .tap(0, 0.75, 0.8), .tap(0.11, 0.95, 0.8), .buzz(0.11, 0.06, 0.7, 0.5),
            ], [])
        case "concede":
            // A low rumble sinking away.
            return ([
                .tap(0, 0.8, 0.1), .buzz(0, 0.3, 0.9, 0.05),
            ], [(0, 1), (0.3, 0.25)])
        default:
            return nil
        }
    }

    /// The UIKit fallback: `taps` impacts of `style`, `apart` s apart.
    private func fallback(_ style: String, _ level: Double, _ taps: Int, _ apart: Double) {
        let g = impactGenerator(style)
        g.impactOccurred(intensity: CGFloat(level))
        g.prepare()
        guard taps > 1 else { return }
        for i in 1..<taps {
            DispatchQueue.main.asyncAfter(deadline: .now() + apart * Double(i)) {
                g.impactOccurred(intensity: CGFloat(level))
                g.prepare()
            }
        }
    }

    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        let level = min(1, max(0, call.getDouble("intensity") ?? 1))
        let count = max(1, min(3, call.getInt("count") ?? 1))
        let apart = max(0.05, min(0.4, (call.getDouble("apart") ?? 110) / 1000))
        // A continuous buzz under the tap (40 to 120 ms asked for; never over 200).
        let buzz = max(0, min(0.2, (call.getDouble("duration") ?? 0) / 1000))
        call.resolve()
        DispatchQueue.main.async {
            let (base, sharp) = HapticsPlugin.feel[style] ?? (0.8, 0.6)
            // (A floor of 55% of the style's strength, so the soft end of a range is still felt.)
            let strength = min(1, base * Float(0.55 + 0.45 * level))
            var beats: [Beat] = (0..<count).map { i in Beat.tap(apart * Double(i), strength, sharp) }
            if buzz > 0 {
                beats.append(.buzz(0, buzz, strength, sharp))
            } else if style == "heavy" && count > 1 {
                beats.append(.buzz(0, apart * Double(count) + 0.12, 0.6, 0.15))
            }
            if self.play(beats) { return }
            self.fallback(style, level, buzz > 0 ? max(count, 2) : count, buzz > 0 ? 0.05 : apart)
        }
    }

    @objc func pattern(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        guard let p = HapticsPlugin.beats(name) else {
            call.reject("Unknown haptic pattern")
            return
        }
        call.resolve()
        DispatchQueue.main.async {
            if self.play(p.beats, ramp: p.ramp) { return }
            // Without Core Haptics: the system's own notification where one fits, and heavy impacts.
            switch name {
            case "goal", "win":
                let g = self.noticeGenerator()
                g.notificationOccurred(.success)
                g.prepare()
                self.fallback("heavy", 1, 3, 0.14)
            case "super":
                self.fallback("heavy", 1, 2, 0.12)
            case "post":
                self.fallback("rigid", 1, 2, 0.08)
            case "whistle":
                self.fallback("light", 1, 3, 0.15)
            case "sub":
                self.fallback("medium", 0.9, 2, 0.11)
            default:
                self.fallback("soft", 1, 1, 0.1)
            }
        }
    }

    @objc func selection(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            // A crisp tick under a menu button: firm enough to feel through a thumb.
            if self.play([.tap(0, 0.8, 0.95)]) { return }
            let g = self.selectionGenerator()
            g.selectionChanged()
            g.prepare()
        }
    }

    @objc func notify(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"
        call.resolve()
        DispatchQueue.main.async {
            let beats: [Beat] = type == "error"
                ? [.tap(0, 1, 0.8), .tap(0.1, 1, 0.8), .tap(0.2, 1, 0.8)]
                : type == "warning"
                    ? [.tap(0, 0.95, 0.6), .tap(0.16, 0.75, 0.4)]
                    : [.tap(0, 0.85, 0.5), .tap(0.12, 1, 0.7), .buzz(0.12, 0.08, 0.9, 0.5)]
            if self.play(beats) { return }
            let g = self.noticeGenerator()
            let kind: UINotificationFeedbackGenerator.FeedbackType = type == "error" ? .error : type == "warning" ? .warning : .success
            g.notificationOccurred(kind)
            g.prepare()
        }
    }

    @objc func prepare(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            if self.hapticEngine() != nil { return }
            for style in ["light", "medium", "heavy", "rigid", "soft"] { self.impactGenerator(style).prepare() }
            self.selectionGenerator().prepare()
            self.noticeGenerator().prepare()
        }
    }
}

/// Apple's own "Enjoying Blocky League?" rating prompt (src/platform/review.ts asks at a happy moment, rarely).
/// Apple decides whether it really shows (at most three times a year) and never tells the app the rating.
@objc(AppReviewPlugin)
public class AppReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppReviewPlugin"
    public let jsName = "AppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
    ]

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.resolve(["asked": false])
                return
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve(["asked": true])
        }
    }
}

/// Game Center for the web game (src/platform/gameCenter.ts): sign the player in, report achievement progress
/// (src/meta/achievements.ts) and leaderboard scores (src/meta/leaderboards.ts), ids as in App Store Connect, and
/// show Apple's achievements and leaderboards screens.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "identity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "report", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScores", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboards", returnType: CAPPluginReturnPromise),
    ]

    /// Signs the local player in: Game Center's own sheet the first time, its welcome banner after. Resolves with
    /// whether they are in (and, when they are, `playerId`: the team-scoped id, so the game notices another player on
    /// this device); a player who says no simply plays on without Game Center.
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let player = GKLocalPlayer.local
            if player.isAuthenticated {
                call.resolve(["signedIn": true, "playerId": player.teamPlayerID])
                return
            }
            var answered = false
            player.authenticateHandler = { [weak self] viewController, _ in
                if let sheet = viewController {
                    self?.bridge?.viewController?.present(sheet, animated: true)
                    return
                }
                if !answered {
                    answered = true
                    let local = GKLocalPlayer.local
                    call.resolve(["signedIn": local.isAuthenticated, "playerId": local.isAuthenticated ? local.teamPlayerID : ""])
                }
            }
        }
    }

    /// The signed-in player's identity, for the game's own account (src/platform/signin.ts sends it to the gc-login
    /// edge function, which checks Apple's signature before it trusts the player id). No password, no email, no name:
    /// { publicKeyUrl, signature (base64), salt (base64), timestamp (ms, a decimal string), teamPlayerId, bundleId }.
    /// Rejects when the player isn't signed in to Game Center or Apple can't be reached.
    @objc func identity(_ call: CAPPluginCall) {
        let player = GKLocalPlayer.local
        guard player.isAuthenticated else {
            call.reject("not_signed_in")
            return
        }
        player.fetchItems(forIdentityVerificationSignature: { publicKeyURL, signature, salt, timestamp, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard let publicKeyURL = publicKeyURL, let signature = signature, let salt = salt else {
                call.reject("no_identity")
                return
            }
            call.resolve([
                "publicKeyUrl": publicKeyURL.absoluteString,
                "signature": signature.base64EncodedString(),
                "salt": salt.base64EncodedString(),
                // (A string: all 64 bits survive the trip through JavaScript.)
                "timestamp": String(timestamp),
                "teamPlayerId": player.teamPlayerID,
                "bundleId": Bundle.main.bundleIdentifier ?? "",
            ])
        })
    }

    /// Reports achievement progress: { achievements: [{ id, percent }] }. Game Center shows its own banner when one
    /// completes and keeps the best percent it has seen.
    @objc func report(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["reported": 0])
            return
        }
        let list = call.getArray("achievements", JSObject.self) ?? []
        let achievements: [GKAchievement] = list.compactMap { item in
            guard let id = item["id"] as? String, !id.isEmpty else { return nil }
            let achievement = GKAchievement(identifier: id)
            let percent = (item["percent"] as? NSNumber)?.doubleValue ?? 100
            achievement.percentComplete = min(100, max(0, percent))
            achievement.showsCompletionBanner = true
            return achievement
        }
        if achievements.isEmpty {
            call.resolve(["reported": 0])
            return
        }
        GKAchievement.report(achievements) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["reported": achievements.count])
            }
        }
    }

    /// Submits leaderboard scores: { scores: [{ id, value }] }, whole numbers, each to its own board. Game Center
    /// keeps a player's best (on a recurring board, the best of the running occurrence). Resolves with the ids it
    /// took ({ submitted: [id] }), so a board not yet in App Store Connect doesn't hold the others back; rejects
    /// only when none went up.
    @objc func submitScores(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["submitted": [String]()])
            return
        }
        let list = call.getArray("scores", JSObject.self) ?? []
        let scores: [(id: String, value: Int)] = list.compactMap { item in
            guard let id = item["id"] as? String, !id.isEmpty, let number = item["value"] as? NSNumber else { return nil }
            let value = number.doubleValue
            guard value.isFinite, value >= 0, value < 9e15 else { return nil }
            return (id, Int(value))
        }
        if scores.isEmpty {
            call.resolve(["submitted": [String]()])
            return
        }
        let tally = ScoreTally()
        let group = DispatchGroup()
        for score in scores {
            group.enter()
            GKLeaderboard.submitScore(score.value, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [score.id]) { error in
                tally.record(score.id, error)
                group.leave()
            }
        }
        group.notify(queue: .main) {
            if tally.submitted.isEmpty, let error = tally.failure {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["submitted": tally.submitted])
            }
        }
    }

    /// Apple's Game Center achievements screen, over the game.
    @objc func showAchievements(_ call: CAPPluginCall) {
        present(.achievements, call)
    }

    /// Apple's Game Center leaderboards screen, over the game.
    @objc func showLeaderboards(_ call: CAPPluginCall) {
        present(.leaderboards, call)
    }

    /// Shows one of Game Center's own screens; resolves with whether it could.
    private func present(_ state: GKGameCenterViewControllerState, _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated, let host = self.bridge?.viewController else {
                call.resolve(["shown": false])
                return
            }
            let screen = GKGameCenterViewController(state: state)
            screen.gameCenterDelegate = self
            host.present(screen, animated: true)
            call.resolve(["shown": true])
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}

/// What each leaderboard submission said. GameKit answers on threads of its own, so the tally keeps a lock.
private final class ScoreTally: @unchecked Sendable {
    private let lock = NSLock()
    private var ids: [String] = []
    private var firstError: Error?

    var submitted: [String] {
        lock.lock()
        defer { lock.unlock() }
        return ids
    }

    var failure: Error? {
        lock.lock()
        defer { lock.unlock() }
        return firstError
    }

    func record(_ id: String, _ error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        if let error = error {
            if firstError == nil { firstError = error }
        } else {
            ids.append(id)
        }
    }
}
