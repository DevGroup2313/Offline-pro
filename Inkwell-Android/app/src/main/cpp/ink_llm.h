// INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
// No licence is granted. See LICENCE.txt.
//
// 7.35: the writing model on the tablet itself. A small wrapper around
// llama.cpp (MIT licence) that loads one GGUF model and answers one request
// at a time, exactly as llama-server does for Inkwell's measurements: the
// model's own chat template (Jinja), no hidden "thinking" pass, greedy
// decoding (temperature 0), a fresh context for every request. It has no
// Android code, so the same file is built and tested on a computer.
#pragma once

#include <functional>
#include <mutex>
#include <string>

struct llama_model;
struct llama_context;
struct common_chat_templates;

namespace ink {

struct LlmOptions {
    int n_ctx = 4096;     // tokens of text the model sees at once
    int n_threads = 4;    // processor threads
    int n_batch = 512;    // prompt tokens decoded per step
};

class Llm {
public:
    Llm();
    ~Llm();
    Llm(const Llm &) = delete;
    Llm & operator=(const Llm &) = delete;

    // Load a model; on failure returns false and sets *err.
    bool load(const std::string & path, const LlmOptions & opt, std::string * err);
    void unload();
    bool loaded() const;
    std::string describe() const;

    // One request: a system instruction and the user's text. on_piece
    // receives the answer as it grows (whole UTF-8 characters only) and may
    // return false to stop. Returns false on error (and sets *err).
    bool chat(const std::string & system, const std::string & user, int max_tokens,
              const std::function<bool(const std::string &)> & on_piece,
              std::string * out, std::string * err);

    // Tokens a text would take, for callers that split long documents.
    int count_tokens(const std::string & text);

private:
    mutable std::mutex mu_;
    llama_model * model_ = nullptr;
    llama_context * ctx_ = nullptr;
    common_chat_templates * tmpls_ = nullptr;
    LlmOptions opt_;
    std::string path_;
};

// Process-wide start: load the processor variants from dir (the app's
// native library folder on Android; empty on a computer) and start llama.cpp.
void backend_init(const std::string & dir);

// The longest prefix of s that ends on a whole UTF-8 character.
size_t utf8_complete_prefix(const std::string & s);

// The answer without any <think>...</think> block, trimmed.
std::string strip_think(const std::string & s);

}  // namespace ink
