// INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
// No licence is granted. See LICENCE.txt.
#include "ink_llm.h"

#include <algorithm>
#include <vector>

#include "chat.h"
#include "common.h"
#include "ggml-backend.h"
#include "llama.h"

namespace ink {

void backend_init(const std::string & dir) {
    static std::once_flag once;
    std::call_once(once, [&]() {
        if (!dir.empty()) ggml_backend_load_all_from_path(dir.c_str());
        else ggml_backend_load_all();
        llama_backend_init();
    });
}

size_t utf8_complete_prefix(const std::string & s) {
    // walk back over a trailing, incomplete multi-byte character
    size_t n = s.size();
    size_t i = n;
    int back = 0;
    while (i > 0 && back < 4) {
        unsigned char c = (unsigned char) s[i - 1];
        if ((c & 0xC0) != 0x80) {  // a lead byte or plain ASCII
            int need = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
            return (n - (i - 1) >= (size_t) need) ? n : i - 1;
        }
        --i;
        ++back;
    }
    return n;
}

std::string strip_think(const std::string & s) {
    std::string r = s;
    for (;;) {
        size_t a = r.find("<think>");
        if (a == std::string::npos) break;
        size_t b = r.find("</think>", a);
        if (b == std::string::npos) { r.erase(a); break; }
        r.erase(a, b + 8 - a);
    }
    size_t f = r.find_first_not_of(" \t\r\n");
    if (f == std::string::npos) return "";
    size_t l = r.find_last_not_of(" \t\r\n");
    return r.substr(f, l - f + 1);
}

Llm::Llm() = default;
Llm::~Llm() { unload(); }

bool Llm::loaded() const {
    std::lock_guard<std::mutex> lk(mu_);
    return model_ != nullptr && ctx_ != nullptr;
}

void Llm::unload() {
    std::lock_guard<std::mutex> lk(mu_);
    if (tmpls_) { common_chat_templates_free(tmpls_); tmpls_ = nullptr; }
    if (ctx_) { llama_free(ctx_); ctx_ = nullptr; }
    if (model_) { llama_model_free(model_); model_ = nullptr; }
    path_.clear();
}

bool Llm::load(const std::string & path, const LlmOptions & opt, std::string * err) {
    unload();
    std::lock_guard<std::mutex> lk(mu_);
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;  // the processor only: the tablet's graphics are not used
    llama_model * model = llama_model_load_from_file(path.c_str(), mp);
    if (!model) {
        if (err) *err = "the model file could not be read (damaged, incomplete, or not a GGUF model)";
        return false;
    }
    llama_context_params cp = llama_context_default_params();
    int n_ctx = opt.n_ctx;
    const int trained = llama_model_n_ctx_train(model);
    if (trained > 0 && n_ctx > trained) n_ctx = trained;
    cp.n_ctx = (uint32_t) n_ctx;
    cp.n_batch = (uint32_t) opt.n_batch;
    cp.n_ubatch = (uint32_t) opt.n_batch;
    cp.n_threads = opt.n_threads;
    cp.n_threads_batch = opt.n_threads;
    llama_context * ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        if (err) *err = "there was not enough memory to start the model";
        return false;
    }
    common_chat_templates_ptr t = common_chat_templates_init(model, "");
    if (!t) {
        llama_free(ctx);
        llama_model_free(model);
        if (err) *err = "the model has no chat template";
        return false;
    }
    model_ = model;
    ctx_ = ctx;
    tmpls_ = t.release();
    opt_ = opt;
    opt_.n_ctx = n_ctx;
    path_ = path;
    return true;
}

std::string Llm::describe() const {
    std::lock_guard<std::mutex> lk(mu_);
    if (!model_) return "";
    char buf[256];
    llama_model_desc(model_, buf, sizeof buf);
    return std::string(buf);
}

int Llm::count_tokens(const std::string & text) {
    std::lock_guard<std::mutex> lk(mu_);
    if (!model_) return -1;
    return (int) common_tokenize(llama_model_get_vocab(model_), text, false, false).size();
}

bool Llm::chat(const std::string & system, const std::string & user, int max_tokens,
               const std::function<bool(const std::string &)> & on_piece,
               std::string * out, std::string * err) {
    std::lock_guard<std::mutex> lk(mu_);
    if (!model_ || !ctx_ || !tmpls_) {
        if (err) *err = "no model is loaded";
        return false;
    }
    const llama_vocab * vocab = llama_model_get_vocab(model_);

    // the prompt, formatted by the model's own template, as llama-server does
    common_chat_templates_inputs in;
    common_chat_msg ms;
    ms.role = "system";
    ms.content = system;
    common_chat_msg mu;
    mu.role = "user";
    mu.content = user;
    if (!system.empty()) in.messages.push_back(ms);
    in.messages.push_back(mu);
    in.add_generation_prompt = true;
    in.use_jinja = true;
    in.enable_thinking = false;
    std::string prompt;
    try {
        prompt = common_chat_templates_apply(tmpls_, in).prompt;
    } catch (const std::exception & e) {
        if (err) *err = std::string("the chat template failed: ") + e.what();
        return false;
    }
    std::vector<llama_token> toks = common_tokenize(vocab, prompt, true, true);
    if (toks.empty()) {
        if (err) *err = "empty prompt";
        return false;
    }
    if ((int) toks.size() + std::max(1, max_tokens) > opt_.n_ctx) {
        if (err) *err = "the text is too long for the model at once (" + std::to_string(toks.size()) + " tokens)";
        return false;
    }

    // a fresh start for every request: nothing from one request reaches another
    llama_memory_clear(llama_get_memory(ctx_), true);
    for (size_t i = 0; i < toks.size(); i += (size_t) opt_.n_batch) {
        const int n = (int) std::min(toks.size() - i, (size_t) opt_.n_batch);
        if (llama_decode(ctx_, llama_batch_get_one(toks.data() + i, n)) != 0) {
            if (err) *err = "the model could not read the text";
            return false;
        }
    }

    llama_sampler * smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    std::string text, pending;
    bool ok = true;
    for (int k = 0; k < max_tokens; ++k) {
        llama_token t = llama_sampler_sample(smpl, ctx_, -1);
        if (llama_vocab_is_eog(vocab, t)) break;
        pending += common_token_to_piece(vocab, t, false);
        const size_t whole = utf8_complete_prefix(pending);
        if (whole > 0) {
            const std::string piece = pending.substr(0, whole);
            pending.erase(0, whole);
            text += piece;
            if (on_piece && !on_piece(piece)) break;
        }
        if (llama_decode(ctx_, llama_batch_get_one(&t, 1)) != 0) {
            ok = false;
            if (err) *err = "the model stopped while writing";
            break;
        }
    }
    text += pending;
    llama_sampler_free(smpl);
    if (out) *out = strip_think(text);
    return ok;
}

}  // namespace ink
