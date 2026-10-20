import UIKit
import WebKit

/* The desk is the bundled the_offline_project.html, served from the app's own bundle at a
   fixed app scheme (ShellSchemeHandler.swift): a stable origin whose storage
   persists on the device, no network, no browser, ever.

   What the page needs from its window, as Inkwell's and Ingenium's iPhone and
   iPad apps give it:
   - alert, confirm and prompt (a web view on iOS shows none of them unless the
     app does, and confirm() would always answer "Cancel");
   - links to other sites open in Safari, never inside the app;
   - saving a file opens the share sheet (Save to Files, AirDrop, Print);
   - the microphone for the app's own page only;
   - if iOS ends the page's process to free memory, the page comes back;
   - the strip behind the status bar takes the page's own colour;
   - 9s58: its own menu's Paste and Copy reach the clipboard (ShellClipboard). */

final class DeskViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                WKScriptMessageHandler, WKDownloadDelegate {

    static let appScheme = "carpe-app"
    static let entryURL = URL(string: "carpe-app://desk/the_offline_project.html")!

    /// started by the cloud build with -shell_pagetest: the page reports back once
    static let pageTest = ProcessInfo.processInfo.arguments.contains("-shell_pagetest")

    private var webView: WKWebView!
    private let topFill = UIView()
    private var lightTop = true
    private var pageTestSent = false
    private var downloadTargets: [ObjectIdentifier: URL] = [:]

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(ShellSchemeHandler(), forURLScheme: DeskViewController.appScheme)
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let scripts = config.userContentController
        scripts.add(self, name: "pySaveFile")
        scripts.add(self, name: "shellEdge")
        scripts.add(self, name: "shellLog")
        // 9s58: the clipboard for the page's own menu, with a reply (ShellClipboard, below)
        scripts.addScriptMessageHandler(ShellClipboard(), contentWorld: .page, name: "shellClipboard")
        scripts.addUserScript(WKUserScript(source: DeskViewController.bridge,
                                           injectionTime: .atDocumentStart, forMainFrameOnly: false))
        scripts.addUserScript(WKUserScript(source: DeskViewController.edgeScript,
                                           injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        if DeskViewController.pageTest {
            scripts.addUserScript(WKUserScript(source: DeskViewController.errorCatcher,
                                               injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = true
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        webView.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari's Develop menu on a Mac can inspect the page
        }

        let root = UIView()
        root.backgroundColor = .systemBackground
        webView.backgroundColor = .systemBackground
        topFill.backgroundColor = .systemBackground
        topFill.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(topFill)
        root.addSubview(webView)
        let guide = root.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            topFill.topAnchor.constraint(equalTo: root.topAnchor),
            topFill.bottomAnchor.constraint(equalTo: guide.topAnchor),
            topFill.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            topFill.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            // as before: under the status bar, and down to the very bottom edge
            // (the page keeps its own keys clear of the home indicator)
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: DeskViewController.entryURL))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return lightTop ? .darkContent : .lightContent
    }

    /* --------------------------------------------- what the page is given */

    /* the shell surfaces the app already knows to look for:
       window.pywebview.api.save_file(name, mime, b64)  - the Mac/Windows bridge's signature
       window.CarpeNative.saveFile(name, mime, b64)     - the family bridge name
       Both hand the bytes to the share sheet, so Save-a-copy lands in Files. */
    static let bridge = """
    (function () {
      var send = function (name, mime, b64) {
        try {
          window.webkit.messageHandlers.pySaveFile.postMessage({ name: name, mime: mime, b64: b64 });
          return true;
        } catch (e) { return false; }
      };
      window.CarpeNative = { saveFile: send };
      window.InkwellNative = window.InkwellNative || { saveFile: send };
      window.pywebview = window.pywebview || {};
      window.pywebview.api = window.pywebview.api || {};
      window.pywebview.api.save_file = send;
    })();
    """

    /// the page's background colour, now and whenever its theme changes
    static let edgeScript = """
    (function () {
      if (window.__shellEdge) return; window.__shellEdge = 1;
      var last = '', t = 0;
      function colour() {
        var els = [document.body, document.documentElement];
        for (var i = 0; i < els.length; i++) {
          var e = els[i]; if (!e) continue;
          var m = /rgba?\\(([^)]+)\\)/.exec(getComputedStyle(e).backgroundColor || '');
          if (!m) continue;
          var p = m[1].split(',').map(parseFloat);
          if (p.length > 3 && p[3] < 0.5) continue;
          return 'rgb(' + Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]) + ')';
        }
        return '';
      }
      function send() {
        var c = colour(); if (!c || c === last) return; last = c;
        try { window.webkit.messageHandlers.shellEdge.postMessage(c); } catch (e) {}
      }
      // at most one look per change, then again as any colour transition ends
      // (a page that rewrites its style attribute often must not keep postponing it)
      function soon() {
        if (t) return;
        t = setTimeout(function () { t = 0; send(); setTimeout(send, 600); setTimeout(send, 1500); }, 120);
      }
      try {
        var mo = new MutationObserver(soon);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      } catch (e) {}
      send(); setTimeout(send, 1500);
    })();
    """

    /// only in the cloud build's check: the page's own errors are counted
    static let errorCatcher = """
    window.__shellErrors = [];
    window.addEventListener('error', function (e) {
      try { if (e && e.message) window.__shellErrors.push(String(e.message) + ' (line ' + (e.lineno || 0) + ')'); } catch (_) {}
    });
    window.addEventListener('unhandledrejection', function (e) {
      try { window.__shellErrors.push('promise: ' + String(e && e.reason && (e.reason.message || e.reason))); } catch (_) {}
    });
    """

    /// only in the cloud build's check: what the page looks like six seconds in.
    /// 9s58: then, after that report, the clipboard bridge once: a line written
    /// and read back (SHELL_PAGETEST CLIP ...), shown with what the app said.
    static let pageTestJS = """
    (function () { setTimeout(function () {
      var b = document.body, errs = window.__shellErrors || [];
      var hs = window.webkit && window.webkit.messageHandlers;
      var r = { title: document.title, text: ((b && b.innerText) || '').length, errors: errs.length, first: errs.slice(0, 3),
        bridge: !!(window.pywebview && window.pywebview.api && window.pywebview.api.save_file && window.CarpeNative),
        clipHandler: !!(hs && hs.shellClipboard),
        storage: (function () { try { localStorage.setItem('__shell_check', '1'); var ok = localStorage.getItem('__shell_check') === '1';
          localStorage.removeItem('__shell_check'); return ok; } catch (e) { return false; } })() };
      var log = function (line) { try { window.webkit.messageHandlers.shellLog.postMessage(line); } catch (e) {} };
      log('SHELL_PAGETEST PAGE ' + JSON.stringify(r));
      try {
        var word = 'clip check 9s58';
        hs.shellClipboard.postMessage({ op: 'write', text: word, html: '<b>' + word + '</b>' }).then(function (ok) {
          return hs.shellClipboard.postMessage({ op: 'read' }).then(function (v) {
            var good = ok === true && v && v.text === word && String(v.html || '').indexOf(word) >= 0;
            log('SHELL_PAGETEST CLIP ' + (good ? 'ok: written and read back, text and html' :
              'unexpected ' + JSON.stringify({ wrote: ok, read: v }).slice(0, 200)));
          });
        }).catch(function (e) { log('SHELL_PAGETEST CLIP refused: ' + String((e && e.message) || e)); });
      } catch (e) { log('SHELL_PAGETEST CLIP missing: ' + String((e && e.message) || e)); }
    }, 6000); })();
    """

    /* --------------------------------------------- what the page may call */

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "pySaveFile":
            guard let body = message.body as? [String: Any],
                  let b64 = body["b64"] as? String,
                  let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { return }
            let name = (body["name"] as? String) ?? "the_offline_project"
            SaveSheet.present(data: data, name: name, from: topController())
        case "shellEdge":
            if let css = message.body as? String { applyEdge(css) }
        case "shellLog":
            if let text = message.body as? String { print(text) }
        default:
            break
        }
    }

    /// "rgb(r,g,b)" from the page -> a colour; nil if it is not one
    static func colour(_ css: String) -> UIColor? {
        let nums = css.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard css.hasPrefix("rgb"), nums.count >= 3 else { return nil }
        return UIColor(red: CGFloat(nums[0]) / 255, green: CGFloat(nums[1]) / 255,
                       blue: CGFloat(nums[2]) / 255, alpha: 1)
    }

    private func applyEdge(_ css: String) {
        guard let c = DeskViewController.colour(css) else { return }
        topFill.backgroundColor = c
        view.backgroundColor = c
        webView.backgroundColor = c
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        let light = 0.299 * r + 0.587 * g + 0.114 * b > 0.6
        if light != lightTop {
            lightTop = light
            setNeedsStatusBarAppearanceUpdate()
        }
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

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if mainFrame && ["http", "https", "mailto", "tel"].contains(scheme) {
            UIApplication.shared.open(url)   // other sites open in Safari, never inside the app
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let file = SaveSheet.temporaryFile(named: suggestedFilename)
        downloadTargets[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let file = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
            SaveSheet.present(file: file, from: topController())
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        showMessage("The file could not be saved: \(error.localizedDescription)")
    }

    /// A link that asks for a new window opens in Safari instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if DeskViewController.pageTest && !pageTestSent {
            pageTestSent = true
            webView.evaluateJavaScript(DeskViewController.pageTestJS, completionHandler: nil)
        }
    }

    /// If iOS ends the page's process to free memory, load the page again
    /// rather than leave a blank window. Your work is safe in storage.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: DeskViewController.entryURL))
    }

    /* ---------------------------------------------------------- microphone */

    /// Dictation and recordings: granted to the app's own page only. iOS itself
    /// then asks once, with the text in NSMicrophoneUsageDescription.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let own = origin.protocol == DeskViewController.appScheme
        decisionHandler(own && type == .microphone ? .grant : .deny)
    }

    /* ------------------------------------- alert, confirm and prompt dialogs */

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

/* ------------------------------------------------------------- clipboard */

/* 9s58: THE CLIPBOARD, for the page's own menu (Paste, Paste as plain text,
   Copy, Cut), so a link copied in any other app pastes from it:
     window.webkit.messageHandlers.shellClipboard.postMessage({op: "read"})
       -> a Promise of {text, html}
     window.webkit.messageHandlers.shellClipboard.postMessage({op: "write", text, html})
       -> a Promise of true or false
   Added in the page's own world (addScriptMessageHandler(_:contentWorld:name:),
   iOS 14 and later); WebKit calls it on the main thread, where UIPasteboard is
   used. Only the app's own page (the carpe-app origin, in any of its frames)
   is answered.
   The first time the page reads what another app copied, iOS 16 and later
   asks "Allow Paste?" itself: that question is the system's. The answer can
   be changed later in Settings, under this app, Paste from Other Apps. Asking
   which KINDS are on the clipboard (hasStrings, hasURLs, contains) is not
   reading it, so an empty clipboard asks nothing. When something was there
   and nothing came back, which is what "Don't Allow Paste" gives, the Promise
   is rejected: the page then tries its next way rather than say the
   clipboard is empty. */
final class ShellClipboard: NSObject, WKScriptMessageHandlerWithReply {

    static let textType = "public.utf8-plain-text"
    static let htmlType = "public.html"

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.securityOrigin.protocol == DeskViewController.appScheme,
              let body = message.body as? [String: Any],
              let op = body["op"] as? String else {
            replyHandler(nil, "not available here")
            return
        }
        let board = UIPasteboard.general
        switch op {
        case "read":
            let hasHTML = board.contains(pasteboardTypes: [ShellClipboard.htmlType])
            guard board.hasStrings || board.hasURLs || hasHTML else {
                replyHandler(["text": "", "html": ""], nil)
                return
            }
            var text = board.string ?? ""
            if text.isEmpty, let url = board.url {
                text = url.absoluteString        // a link copied on its own
            }
            var html = ""
            if hasHTML, let data = board.data(forPasteboardType: ShellClipboard.htmlType) {
                html = String(decoding: data, as: UTF8.self)
            }
            if text.isEmpty && html.isEmpty {
                replyHandler(nil, "the clipboard was not shared")
                return
            }
            replyHandler(["text": text, "html": html], nil)
        case "write":
            let text = body["text"] as? String ?? ""
            let html = body["html"] as? String ?? ""
            var item: [String: Any] = [ShellClipboard.textType: text]
            if !html.isEmpty {
                item[ShellClipboard.htmlType] = Data(html.utf8)
            }
            board.setItems([item], options: [:])
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown request")
        }
    }
}
