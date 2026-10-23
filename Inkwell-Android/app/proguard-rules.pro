# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# 7.50: the release build is shrunk and its names obscured. What must keep
# its name: the bridge the page calls (every @JavascriptInterface method and
# its class), the native methods llama.cpp's wrapper binds by name, the
# callback the native code looks up (NativeLlm.Pieces.onPiece), the service
# and the activity the manifest names, and the line numbers for crash logs.
-keepattributes JavascriptInterface, SourceFile, LineNumberTable, Signature, *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class studio.inkwell.app.MainActivity$Bridge { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
-keep class studio.inkwell.app.NativeLlm { *; }
-keep class studio.inkwell.app.NativeLlm$* { *; }
-keep interface studio.inkwell.app.NativeLlm$Pieces { *; }
-keep class studio.inkwell.app.ModelService { *; }
-keep class studio.inkwell.app.MainActivity { *; }
-keep class studio.inkwell.app.MainActivity$PdfBytesAdapter { *; }
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
