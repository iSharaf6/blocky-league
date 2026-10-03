import Capacitor
import GameKit
import UIKit

/// The game's screen: Capacitor's own bridge, plus this app's own plugins. They live in the app target rather than in
/// a package, so they are registered here (SceneDelegate makes this the root view controller).
class GameViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}

/// Game Center for the web game (src/platform/gameCenter.ts): sign the player in, report achievement progress
/// (src/meta/achievements.ts, ids as in App Store Connect), and show Apple's achievements screen.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "report", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
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

    /// Apple's Game Center achievements screen, over the game.
    @objc func showAchievements(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated, let host = self.bridge?.viewController else {
                call.resolve(["shown": false])
                return
            }
            let screen = GKGameCenterViewController(state: .achievements)
            screen.gameCenterDelegate = self
            host.present(screen, animated: true)
            call.resolve(["shown": true])
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
