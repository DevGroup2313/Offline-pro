/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
import AVFoundation
import UIKit
import WebKit

/// Inkwell for iPhone and iPad: one web view showing Inkwell.html from the
/// app's own files at a fixed address, with the microphone, the on-disk copy
/// of the library and file saving wired to the system. It mirrors the Android
/// app (Inkwell-Android/.../MainActivity.java), so the page sees the same
/// bridge on both.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply,
                               WKScriptMessageHandler, WKDownloadDelegate {
    static let build = "7.34"

    private var webView: WKWebView!
    private let store = Store()
    private var downloadTargets: [ObjectIdentifier: URL] = [:]
    /// 7.30: the areas above and below the safe area (status bar, home
    /// indicator) take the page's own edge colours instead of a grey band.
    private let topFill = UIView()
    private let bottomFill = UIView()
    private var lightTop = true

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AssetSchemeHandler(), forURLScheme: AssetSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "inkwell")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "inkwellReply")
        config.userContentController.addUserScript(
            WKUserScript(source: bootScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari's Develop menu can inspect the page
        }

        let root = UIView()
        let paper = UIColor(red: 0xFF / 255.0, green: 0xFE / 255.0, blue: 0xF8 / 255.0, alpha: 1)
        root.backgroundColor = paper
        webView.isOpaque = false
        webView.backgroundColor = paper
        for fill in [topFill, bottomFill] {
            fill.backgroundColor = paper
            fill.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(fill)
        }
        root.addSubview(webView)
        let guide = root.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            topFill.topAnchor.constraint(equalTo: root.topAnchor),
            topFill.bottomAnchor.constraint(equalTo: guide.topAnchor),
            topFill.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            topFill.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            bottomFill.topAnchor.constraint(equalTo: guide.bottomAnchor),
            bottomFill.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            bottomFill.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bottomFill.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        ])
        view = root
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return lightTop ? .darkContent : .lightContent
    }

    /// "#rrggbb" from the page -> a colour; nil if it is not one.
    static func colour(_ hex: String) -> UIColor? {
        let h = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                       blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    static func isLight(_ c: UIColor) -> Bool {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.299 * r + 0.587 * g + 0.114 * b > 0.6
    }

    private func applyEdges(top: String, bottom: String) {
        guard let t = WebViewController.colour(top), let b = WebViewController.colour(bottom) else { return }
        topFill.backgroundColor = t
        bottomFill.backgroundColor = b
        view.backgroundColor = t
        webView.backgroundColor = t
        let light = WebViewController.isLight(t)
        if light != lightTop {
            lightTop = light
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: AssetSchemeHandler.startURL))
    }

    /* ------------------------------------------------ what the page is given */

    private static func json(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    private func hostInfo() -> [String: Any] {
        return [
            "launcher": WebViewController.build + "-ios",
            "platform": "ios",
            "native_host": true,
            "mic_handler": true,
            "mic_permission": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
            "speech_service": false,
            "webview": "",
        ]
    }

    /// Runs before the page's own scripts: the on-disk copy of the library and
    /// the bridge the page already knows from the desktop and Android apps
    /// (window.pywebview.api and window.InkwellNative). start_server is absent
    /// on purpose: there is no engine on a phone or tablet.
    private func bootScript() -> String {
        let storeJSON = WebViewController.json(store.readAll())
        let edgeFile = Bundle.main.bundleURL.appendingPathComponent("web/ink-host/edge-colours.js")
        let edgeSource = (try? String(contentsOf: edgeFile, encoding: .utf8)) ?? ""
        let edgeCall = edgeSource.isEmpty ? "" : edgeSource
            + "(function(t,b){try{window.webkit.messageHandlers.inkwell.postMessage({op:'edges',top:t,bottom:b});}catch(e){}});"
        let hostJSON = WebViewController.json(hostInfo())
        return """
        window.__inkBridgeStore=\(storeJSON);
        window.__inkBridgeStoreAtLaunch=\(storeJSON);
        window.__inkIOSHost=\(hostJSON);
        (function(){var H=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.inkwell;if(!H)return;
         function P(v){return Promise.resolve(v);}
         function post(m){try{H.postMessage(m);return true;}catch(e){return false;}}
         window.InkwellNative={saveFile:function(n,m,b){return post({op:'saveFile',name:String(n),mime:String(m||'application/octet-stream'),data:String(b)});}};
         var R=window.webkit.messageHandlers.inkwellReply;
         if(R)window.InkwellNative.http=function(m,u,h,b){return R.postMessage({op:'http',method:String(m||'GET'),url:String(u),headers:h||{},body:b==null?'':String(b)})
          .then(function(r){return r||{status:0,text:'no answer'};},function(e){return {status:0,text:String(e)};});};
         if(R)window.InkwellNative.appleAI={
          status:function(){return R.postMessage({op:'aiStatus'}).then(function(r){return r||{available:false,reason:'no answer'};},function(e){return {available:false,reason:String(e)};});},
          respond:function(i,p){return R.postMessage({op:'aiRespond',instructions:String(i||''),prompt:String(p||'')}).then(function(r){return r||{error:'no answer'};},function(e){return {error:String(e)};});}};
         window.pywebview={api:{
          save_file:function(n,m,b){return P(window.InkwellNative.saveFile(n,m,b));},
          storage_set:function(k,v){return P(post({op:'storageSet',key:String(k),value:String(v)}));},
          rescue_offer:function(){try{var st=window.__inkBridgeStoreAtLaunch||{};if(!st.docs)return P('');
           var o={docs:JSON.parse(st.docs),active:st.active?JSON.parse(st.active):null,notes:st.notes?JSON.parse(st.notes):[],snaps:st.snaps?JSON.parse(st.snaps):{}};
           return P(o.docs&&o.docs.length?JSON.stringify(o):'');}catch(e){return P('');}},
          host_info:function(){return P(window.__inkIOSHost||null);},
          mark_booted:function(){return P(true);},
          report_error:function(d){post({op:'log',message:'page: '+String(d).slice(0,2000)});return P(true);},
          bake_icon:function(){return P(false);}
         }};
         document.addEventListener('DOMContentLoaded',function(){try{window.dispatchEvent(new Event('pywebviewready'));}catch(e){}});
        })();
        \(edgeCall)
        """
    }

    /* --------------------------------------------- what the page may call */

    /// 7.31: requests to the laptop's model over the home Wi-Fi, made by the
    /// app itself. The page's own requests from inkwell://localhost to a plain
    /// http address on the network may be blocked as mixed or local-network
    /// content; the app's are not. The answer returns as the promise's value.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        /* 7.34: Apple's on-device model (AppleWritingModel.swift) */
        if let body = message.body as? [String: Any], let op = body["op"] as? String, op == "aiStatus" || op == "aiRespond" {
            if op == "aiStatus" { replyHandler(AppleWritingModel.status(), nil); return }
            AppleWritingModel.respond(instructions: (body["instructions"] as? String) ?? "",
                                      prompt: (body["prompt"] as? String) ?? "") { answer in
                DispatchQueue.main.async { replyHandler(answer, nil) }
            }
            return
        }
        guard let body = message.body as? [String: Any], (body["op"] as? String) == "http",
              let urlText = body["url"] as? String, let url = URL(string: urlText),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            replyHandler(["status": 0, "text": "not a web address"], nil)
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 240)
        request.httpMethod = (body["method"] as? String) ?? "GET"
        if let headers = body["headers"] as? [String: Any] {
            for (k, v) in headers { request.setValue(String(describing: v), forHTTPHeaderField: k) }
        }
        if let text = body["body"] as? String, !text.isEmpty, request.httpMethod != "GET" {
            request.httpBody = Data(text.utf8)
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? (error?.localizedDescription ?? "")
            DispatchQueue.main.async { replyHandler(["status": status, "text": text], nil) }
        }.resume()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        switch op {
        case "storageSet":
            if let key = body["key"] as? String, let value = body["value"] as? String {
                store.put(key, value)
            }
        case "saveFile":
            if let name = body["name"] as? String, let base64 = body["data"] as? String,
               let bytes = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) {
                saveFile(name: name, data: bytes)
            }
        case "edges":
            if let top = body["top"] as? String, let bottom = body["bottom"] as? String {
                applyEdges(top: top, bottom: bottom)
            }
        case "log":
            NSLog("Inkwell %@", (body["message"] as? String) ?? "")
        default:
            break
        }
    }

    /* ------------------------------------------------------ saving files */

    static func safeFileName(_ name: String) -> String {
        var n = name.replacingOccurrences(of: "[\\\\/:*?\"<>|\\x00-\\x1f]", with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if n.count > 120 { n = String(n.suffix(120)) }
        return n.isEmpty ? "inkwell-export" : n
    }

    private func temporaryFile(named name: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(WebViewController.safeFileName(name))
    }

    private func saveFile(name: String, data: Data) {
        let file = temporaryFile(named: name)
        do {
            try data.write(to: file, options: .atomic)
            presentExport(file)
        } catch {
            showMessage("The file could not be saved: \(error.localizedDescription)")
        }
    }

    /// Apple's own "Save to Files" dialog, which is how an app hands a file to
    /// the user on iPhone and iPad.
    private func presentExport(_ file: URL) {
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        topController().present(picker, animated: true)
    }

    private func topController() -> UIViewController {
        var top: UIViewController = self
        while let next = top.presentedViewController { top = next }
        return top
    }

    private func showMessage(_ text: String) {
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        topController().present(alert, animated: true)
    }

    /* ------------------------------------------------ links and downloads */

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        if mainFrame && ["http", "https", "mailto", "tel"].contains(scheme) {
            UIApplication.shared.open(url)   // other sites open in Safari, never inside Inkwell
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let file = temporaryFile(named: suggestedFilename)
        downloadTargets[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let file = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
            presentExport(file)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        showMessage("The download failed: \(error.localizedDescription)")
    }

    /// A link that asks for a new window opens in Safari instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) {
            UIApplication.shared.open(url)
        }
        return nil
    }

    /// If the web view's content process is ended by the system, reload rather
    /// than leave a blank window. The library is safe in storage and on disk.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: AssetSchemeHandler.startURL))
    }

    /* ---------------------------------------------------------- microphone */

    /// Scriba's microphone: granted to Inkwell's own pages only. iOS itself
    /// then asks the user once, with the text in NSMicrophoneUsageDescription.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let own = origin.protocol == AssetSchemeHandler.scheme && origin.host == AssetSchemeHandler.host
        decisionHandler(own && type == .microphone ? .grant : .deny)
    }

    /* ------------------------------------- alert, confirm and prompt dialogs */
    // A web view on iOS shows none of these unless the app does it. Inkwell
    // asks with confirm() before recovering documents, so they matter.

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        topController().present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        topController().present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { field in field.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        topController().present(alert, animated: true)
    }
}
