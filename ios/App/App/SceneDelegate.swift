import UIKit
import WebKit
import Capacitor

/// Registers the sign-in view used when Box redirects to https://app.box.com.
class PartsBinViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OAuthSessionPlugin())
        bridge?.registerPluginInstance(NiimbotPlugin())
    }
}

private func isBoxReturn(_ url: URL) -> Bool {
    guard url.scheme == "https", url.host == "app.box.com" else { return false }
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    return items.contains { $0.name == "code" || $0.name == "error" }
}

private final class BoxSignInController: UIViewController, WKNavigationDelegate {
    private let start: URL
    private let done: (Result<String, Error>) -> Void
    private var finished = false

    init(start: URL, done: @escaping (Result<String, Error>) -> Void) {
        self.start = start
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(cancelTapped)
        )
        let web = WKWebView(frame: view.bounds)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        view.addSubview(web)
        web.load(URLRequest(url: start))
    }

    @objc private func cancelTapped() {
        finish(nil)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url, isBoxReturn(url) {
            decisionHandler(.cancel)
            finish(url.absoluteString)
            return
        }
        decisionHandler(.allow)
    }

    private func finish(_ callback: String?) {
        guard !finished else { return }
        finished = true
        dismiss(animated: true) { self.done(callback.map(Result.success) ?? .failure(CancellationError())) }
    }
}

@objc(OAuthSessionPlugin)
public class OAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OAuthSessionPlugin"
    public let jsName = "OAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "browse", returnType: CAPPluginReturnPromise),
    ]

    @objc func browse(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("Missing sign-in address")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("Sign-in could not open.")
                return
            }
            let signIn = BoxSignInController(start: url) { result in
                switch result {
                case .success(let callback):
                    call.resolve(["url": callback])
                case .failure:
                    call.reject("Sign-in was cancelled.")
                }
            }
            let nav = UINavigationController(rootViewController: signIn)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PartsBinViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
