import Capacitor
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
    }
}

/// Haptic taps for the web game (src/platform/haptics.ts, which picks them, throttles them and honours Settings >
/// VIBRATION): an impact { style: light | medium | heavy | rigid | soft, intensity: 0...1, count, apart (ms) }, a
/// selection tick, a notification { type: success | warning | error }, and prepare (wake the generators so the next tap
/// lands on time). Fire and forget: each call resolves at once and the tap plays on the main thread.
@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "Haptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
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

    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        let intensity = CGFloat(min(1, max(0, call.getDouble("intensity") ?? 1)))
        let count = max(1, min(3, call.getInt("count") ?? 1))
        let apart = max(0.05, min(0.4, (call.getDouble("apart") ?? 110) / 1000))
        call.resolve()
        DispatchQueue.main.async {
            let g = self.impactGenerator(style)
            g.impactOccurred(intensity: intensity)
            g.prepare()
            for i in 1..<count {
                DispatchQueue.main.asyncAfter(deadline: .now() + apart * Double(i)) {
                    g.impactOccurred(intensity: intensity)
                    g.prepare()
                }
            }
        }
    }

    @objc func selection(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            let g = self.selectionGenerator()
            g.selectionChanged()
            g.prepare()
        }
    }

    @objc func notify(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"
        call.resolve()
        DispatchQueue.main.async {
            let g = self.noticeGenerator()
            let kind: UINotificationFeedbackGenerator.FeedbackType = type == "error" ? .error : type == "warning" ? .warning : .success
            g.notificationOccurred(kind)
            g.prepare()
        }
    }

    @objc func prepare(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
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
        CAPPluginMethod(name: "report", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScores", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboards", returnType: CAPPluginReturnPromise),
    ]

    /// Signs the local player in: Game Center's own sheet the first time, its welcome banner after. Resolves with
    /// whether they are in; a player who says no simply plays on without Game Center.
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let player = GKLocalPlayer.local
            if player.isAuthenticated {
                call.resolve(["signedIn": true])
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
                    call.resolve(["signedIn": GKLocalPlayer.local.isAuthenticated])
                }
            }
        }
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
