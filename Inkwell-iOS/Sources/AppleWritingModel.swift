// INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
//
// 7.34: Apple's own on-device language model (the Foundation Models framework,
// iOS 26 and later, on devices with Apple Intelligence switched on). It runs
// on the device, offline, and is far stronger than any model an app can carry
// in its window. The page reaches it through window.InkwellNative.appleAI.
// On older systems, unsupported devices, or a build made without the
// framework, status() says why and respond() declines; Inkwell then works as
// before (rules engine, and the laptop's model over Wi-Fi).

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum AppleWritingModel {
    /// ["available": Bool, "reason": String]
    static func status() -> [String: Any] {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let availability = SystemLanguageModel.default.availability
            if case .available = availability {
                return ["available": true, "reason": ""]
            }
            return ["available": false, "reason": String(describing: availability)]
        }
        return ["available": false, "reason": "needs iOS 26 or later"]
        #else
        return ["available": false, "reason": "built without Apple's Foundation Models framework"]
        #endif
    }

    /// One answer to one request; a fresh session each time, so no request
    /// sees another's text. done(["text": ...]) or done(["error": ...]).
    static func respond(instructions: String, prompt: String, done: @escaping ([String: Any]) -> Void) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let answer = try await session.respond(to: prompt, options: GenerationOptions(temperature: 0.0))
                    done(["text": answer.content])
                } catch {
                    done(["error": String(describing: error)])
                }
            }
            return
        }
        #endif
        done(["error": "Apple's on-device model is not available here"])
    }
}
