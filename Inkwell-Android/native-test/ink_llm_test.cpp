// INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
// No licence is granted. See LICENCE.txt.
//
// Tests the tablet's model core on a computer, with the same llama.cpp:
//   ink_llm_test <model.gguf> <inputs.txt> <outputs.jsonl> [threads]
// Each line of inputs.txt is one text to proofread with Inkwell's
// copy-editor instruction; each output line is {"in":..., "out":..., "ms":...}.
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>

#include "ink_llm.h"

static std::string jq(const std::string & s) {
    std::string r = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"': r += "\\\""; break;
            case '\\': r += "\\\\"; break;
            case '\n': r += "\\n"; break;
            case '\r': r += "\\r"; break;
            case '\t': r += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); r += b; }
                else r += (char) c;
        }
    }
    return r + "\"";
}

int main(int argc, char ** argv) {
    if (argc < 4) { std::cerr << "usage: ink_llm_test model.gguf inputs.txt outputs.jsonl [threads]\n"; return 2; }
    const std::string PROOF =
        "You are a careful copy editor. Correct only errors of grammar, spelling and punctuation in the user's text. "
        "Change as little as possible: keep every word that is already correct, keep the writer's meaning, register and "
        "voice, keep names, numbers, quotations and citations exactly. If the text is already correct, return it unchanged. "
        "Output only the corrected text, with no explanation.";
    ink::backend_init("");
    ink::Llm llm;
    ink::LlmOptions o;
    o.n_threads = argc > 4 ? std::atoi(argv[4]) : 4;
    std::string err;
    auto t0 = std::chrono::steady_clock::now();
    if (!llm.load(argv[1], o, &err)) { std::cerr << "load failed: " << err << "\n"; return 1; }
    auto t1 = std::chrono::steady_clock::now();
    std::cerr << "loaded " << llm.describe() << " in "
              << std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count() << " ms\n";
    std::ifstream in(argv[2]);
    std::ofstream out(argv[3]);
    std::string line;
    int n = 0, streamed_ok = 0;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        std::string ans, streamed;
        auto a = std::chrono::steady_clock::now();
        bool ok = llm.chat(PROOF, line, 160, [&](const std::string & p) { streamed += p; return true; }, &ans, &err);
        auto b = std::chrono::steady_clock::now();
        if (!ok) { std::cerr << "chat failed: " << err << "\n"; return 1; }
        if (ink::strip_think(streamed) == ans) streamed_ok++;
        out << "{\"in\":" << jq(line) << ",\"out\":" << jq(ans) << ",\"ms\":"
            << std::chrono::duration_cast<std::chrono::milliseconds>(b - a).count() << "}\n";
        n++;
    }
    // the streamed pieces must add up to the answer exactly
    std::cerr << n << " answers; streamed text equal to the answer in " << streamed_ok << "\n";
    // a request that is too long must be refused, not crash
    std::string longtext(200000, 'a');
    std::string e2, sink;
    bool r = llm.chat(PROOF, longtext, 10, nullptr, &sink, &e2);
    std::cerr << "too-long request refused: " << (!r ? "yes (" + e2 + ")" : "NO") << "\n";
    return 0;
}
