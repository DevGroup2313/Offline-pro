/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
import Foundation
import WebKit

/// Answers every request to inkwell://localhost/ from the app's own "web"
/// folder (Inkwell.html and vendor/), so the page never needs the network and
/// its origin, and therefore its storage, never changes.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "inkwell"
    static let host = "localhost"
    static let startURL = URL(string: "inkwell://localhost/Inkwell.html")!

    private let root = Bundle.main.bundleURL.appendingPathComponent("web", isDirectory: true)

    static func isSafePath(_ p: String) -> Bool {
        if p.isEmpty || p.hasPrefix("/") || p.contains("..") || p.contains("\\") { return false }
        return p.range(of: "^[A-Za-z0-9._\\-/]+$", options: .regularExpression) != nil
    }

    static func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html", "htm": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "wasm": return "application/wasm"
        case "json", "webmanifest": return "application/json"
        case "css": return "text/css"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "txt": return "text/plain"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/Inkwell.html" }
        let relative = String(path.dropFirst())
        guard AssetSchemeHandler.isSafePath(relative),
              let data = try? Data(contentsOf: root.appendingPathComponent(relative), options: .mappedIfSafe) else {
            respond(task, url: url, status: 404, mime: "text/plain", data: Data())
            return
        }
        respond(task, url: url, status: 200, mime: AssetSchemeHandler.mimeType(for: relative), data: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // every answer is sent at once in start, so there is nothing to cancel
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        var type = mime
        if mime.hasPrefix("text/") || mime == "application/json" || mime == "image/svg+xml" {
            type += "; charset=utf-8"
        }
        let headers = [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
