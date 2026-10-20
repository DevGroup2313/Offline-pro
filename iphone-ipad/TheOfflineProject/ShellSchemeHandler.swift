import Foundation
import WebKit

/* serves the bundled www folder at the app scheme (carpe-app, kept for
   every app made by The Forge: it names where the app stores your work) */
final class ShellSchemeHandler: NSObject, WKURLSchemeHandler {

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let last = url.path.split(separator: "/").last.map(String.init) ?? "the_offline_project.html"
        let base = (last as NSString).deletingPathExtension
        let ext  = (last as NSString).pathExtension
        guard let fileURL = Bundle.main.url(forResource: base, withExtension: ext, subdirectory: "www"),
              let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(url: url,
                                   mimeType: Self.mimeType(for: ext),
                                   expectedContentLength: data.count,
                                   textEncodingName: "utf-8")
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html"
        case "css":         return "text/css"
        case "js":          return "text/javascript"
        case "json", "webmanifest": return "application/json"
        case "png":         return "image/png"
        case "svg":         return "image/svg+xml"
        case "ico":         return "image/x-icon"
        default:            return "application/octet-stream"
        }
    }
}
