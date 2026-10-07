// INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
// No licence is granted. See LICENCE.txt.
//
// The Java side of the tablet's model (studio.inkwell.app.NativeLlm). Text
// crosses as UTF-8 byte arrays, so every character arrives exactly, emoji
// and symbols outside the basic plane included.
#include <jni.h>
#include <android/log.h>

#include <string>

#include "ink_llm.h"
#include "llama.h"

#define LOG_TAG "InkwellModel"

namespace {

struct Handle {
    ink::Llm llm;
    std::string last_error;
};

std::string from_bytes(JNIEnv * env, jbyteArray a) {
    if (!a) return "";
    const jsize n = env->GetArrayLength(a);
    std::string s((size_t) n, '\0');
    if (n > 0) env->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte *>(&s[0]));
    return s;
}

jbyteArray to_bytes(JNIEnv * env, const std::string & s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    if (a && !s.empty()) env->SetByteArrayRegion(a, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    return a;
}

std::string from_jstring(JNIEnv * env, jstring j) {
    if (!j) return "";
    const char * c = env->GetStringUTFChars(j, nullptr);
    std::string s = c ? c : "";
    if (c) env->ReleaseStringUTFChars(j, c);
    return s;
}

void log_to_android(enum ggml_log_level level, const char * text, void *) {
    int p = level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR
          : level == GGML_LOG_LEVEL_WARN ? ANDROID_LOG_WARN : ANDROID_LOG_DEBUG;
    if (p == ANDROID_LOG_DEBUG) return;  // keep the log to warnings and errors
    __android_log_print(p, LOG_TAG, "%s", text);
}

}  // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_studio_inkwell_app_NativeLlm_nativeInit(JNIEnv * env, jclass, jstring libDir) {
    llama_log_set(log_to_android, nullptr);
    ink::backend_init(from_jstring(env, libDir));
}

JNIEXPORT jlong JNICALL
Java_studio_inkwell_app_NativeLlm_nativeCreate(JNIEnv *, jclass) {
    return reinterpret_cast<jlong>(new Handle());
}

JNIEXPORT void JNICALL
Java_studio_inkwell_app_NativeLlm_nativeDestroy(JNIEnv *, jclass, jlong h) {
    delete reinterpret_cast<Handle *>(h);
}

JNIEXPORT jstring JNICALL
Java_studio_inkwell_app_NativeLlm_nativeLoad(JNIEnv * env, jclass, jlong h, jstring path, jint nCtx, jint nThreads) {
    Handle * H = reinterpret_cast<Handle *>(h);
    if (!H) return env->NewStringUTF("no handle");
    ink::LlmOptions o;
    if (nCtx > 0) o.n_ctx = nCtx;
    if (nThreads > 0) o.n_threads = nThreads;
    std::string err;
    if (!H->llm.load(from_jstring(env, path), o, &err)) {
        H->last_error = err;
        return env->NewStringUTF(err.empty() ? "the model did not start" : err.c_str());
    }
    return env->NewStringUTF("");
}

JNIEXPORT void JNICALL
Java_studio_inkwell_app_NativeLlm_nativeUnload(JNIEnv *, jclass, jlong h) {
    Handle * H = reinterpret_cast<Handle *>(h);
    if (H) H->llm.unload();
}

JNIEXPORT jstring JNICALL
Java_studio_inkwell_app_NativeLlm_nativeDescribe(JNIEnv * env, jclass, jlong h) {
    Handle * H = reinterpret_cast<Handle *>(h);
    return env->NewStringUTF(H ? H->llm.describe().c_str() : "");
}

JNIEXPORT jstring JNICALL
Java_studio_inkwell_app_NativeLlm_nativeLastError(JNIEnv * env, jclass, jlong h) {
    Handle * H = reinterpret_cast<Handle *>(h);
    return env->NewStringUTF(H ? H->last_error.c_str() : "");
}

JNIEXPORT jint JNICALL
Java_studio_inkwell_app_NativeLlm_nativeCountTokens(JNIEnv * env, jclass, jlong h, jbyteArray text) {
    Handle * H = reinterpret_cast<Handle *>(h);
    return H ? H->llm.count_tokens(from_bytes(env, text)) : -1;
}

// Returns the answer as UTF-8, or null on error (then nativeLastError says why).
// cb.onPiece(byte[]) receives the answer as it grows; returning false stops it.
JNIEXPORT jbyteArray JNICALL
Java_studio_inkwell_app_NativeLlm_nativeChat(JNIEnv * env, jclass, jlong h, jbyteArray system, jbyteArray user,
                                             jint maxTokens, jobject cb) {
    Handle * H = reinterpret_cast<Handle *>(h);
    if (!H) return nullptr;
    jmethodID onPiece = nullptr;
    if (cb) {
        jclass k = env->GetObjectClass(cb);
        onPiece = env->GetMethodID(k, "onPiece", "([B)Z");
        env->DeleteLocalRef(k);
        if (!onPiece) { env->ExceptionClear(); cb = nullptr; }
    }
    std::string out, err;
    const bool ok = H->llm.chat(from_bytes(env, system), from_bytes(env, user), maxTokens,
        [&](const std::string & piece) -> bool {
            if (!cb) return true;
            jbyteArray a = to_bytes(env, piece);
            jboolean go = env->CallBooleanMethod(cb, onPiece, a);
            env->DeleteLocalRef(a);
            if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
            return go == JNI_TRUE;
        },
        &out, &err);
    if (!ok) {
        H->last_error = err;
        return nullptr;
    }
    H->last_error.clear();
    return to_bytes(env, out);
}

JNIEXPORT jstring JNICALL
Java_studio_inkwell_app_NativeLlm_nativeSystemInfo(JNIEnv * env, jclass) {
    return env->NewStringUTF(llama_print_system_info());
}

}  // extern "C"
