import Foundation
import UIKit

/* writes the bytes to a temporary file and hands it to the system share sheet;
   the reader saves it into Files from there (or AirDrops or prints it). The
   one true path for downloads out of a web view on iPhone and iPad. */
enum SaveSheet {
    static func safeFileName(_ name: String) -> String {
        var n = name.replacingOccurrences(of: "[\\\\/:*?\"<>|\\x00-\\x1f]", with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if n.count > 120 { n = String(n.suffix(120)) }
        return n.isEmpty ? "the_offline_project" : n
    }

    /// a fresh folder per file, so two saves with one name never collide
    static func temporaryFile(named name: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(safeFileName(name))
    }

    static func present(data: Data, name: String, from presenter: UIViewController) {
        let url = temporaryFile(named: name)
        do { try data.write(to: url, options: .atomic) } catch { return }
        present(file: url, from: presenter)
    }

    static func present(file url: URL, from presenter: UIViewController) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = presenter.view
            pop.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }
}
