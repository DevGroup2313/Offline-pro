import UIKit

/* The Offline Project for iPhone and iPad: one window holding the web view that runs
   the_offline_project.html (DeskView.swift), built the way Inkwell's iPhone and iPad app
   is built: a plain UIKit app and one view controller.

   The window belongs to a SCENE (ShellScene below, also named in Info.plist
   under UIApplicationSceneManifest). Apple's newest Xcode expects every app
   to use scenes: an app that makes its window in the app delegate alone may
   not open when it is built with that Xcode. */
@main
final class ShellApp: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = ShellScene.self
        return config
    }
}

/// The app's one window, and the desk inside it.
final class ShellScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = DeskViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
