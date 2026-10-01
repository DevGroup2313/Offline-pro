/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
import Foundation

/// The on-disk copy of the library, one file per key (docs.json, notes.json...),
/// as in the Android app. The page writes through to it on every save, so a
/// fresh web view store can boot from it. Writes are atomic. A store that holds
/// documents is never replaced by one that holds none.
final class Store {
    private let dir: URL
    private let queue = DispatchQueue(label: "studio.inkwell.store")

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("store", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    static func isSafeKey(_ key: String) -> Bool {
        return key.range(of: "^[A-Za-z0-9_]{1,40}$", options: .regularExpression) != nil
    }

    static func isEmptyList(_ value: String) -> Bool {
        let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t == "[]" || t == "null"
    }

    func put(_ key: String, _ value: String) {
        guard Store.isSafeKey(key) else { return }
        queue.async {
            let file = self.dir.appendingPathComponent(key + ".json")
            let existing = (try? Data(contentsOf: file))?.count ?? 0
            if key == "docs" && Store.isEmptyList(value) && existing > 2 { return }
            try? Data(value.utf8).write(to: file, options: .atomic)
        }
    }

    func readAll() -> [String: String] {
        return queue.sync {
            var out: [String: String] = [:]
            let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
            for file in files where file.pathExtension == "json" {
                let key = file.deletingPathExtension().lastPathComponent
                // an unreadable entry is skipped, never fatal
                guard Store.isSafeKey(key), let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
                out[key] = text
            }
            return out
        }
    }
}
