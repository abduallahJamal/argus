<div align="center">

<img src="assets/banner.svg" alt="argus — Hundred Eyes, Zero MCP: Static-Analysis Router CLI & Multi-Agent Reverse-Engineering Skill" width="100%"/>

<br/>

**Hundred eyes, zero MCP. A zero-dependency routing CLI plus an `8.7 KB` multi-agent skill that tells an AI coding agent the fastest local command for any shipped artifact — Electron, minified JS, Mach-O, ELF, PE/.NET, Go, Rust, JVM, Android, iOS, Unity IL2CPP, Flutter, Hermes, WASM, SQLite, pcaps, and firmware — while hiding `73 KB` of deep tradecraft behind 22 on-demand references.**

[![CI](https://github.com/abduallahJamal/argus/actions/workflows/ci.yml/badge.svg?label=CI)](https://github.com/abduallahJamal/argus/actions/workflows/ci.yml)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Dependencies: 0](https://img.shields.io/badge/Dependencies-Zero-00E5FF)](#why-another-one-of-these)
[![Plans & Refs](https://img.shields.io/badge/Plans-43_%C2%B7_22_Refs-818CF8)](#progressive-disclosure-with-a-cli)
[![Agents](https://img.shields.io/badge/Agents-OpenCode_%7C_Claude_%7C_Codex_%7C_Cursor-38BDF8)](#install)
[![Security](https://img.shields.io/badge/Domain-Reverse_Engineering-22C55E)](docs/AUTHORIZATION.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B.svg)](LICENSE)
[![Arabic Docs](https://img.shields.io/badge/%D8%A7%D9%84%D8%AA%D9%88%D8%AB%D9%8A%D9%82-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9-1E293B)](README.ar.md)

**🇬🇧 English** · **[🇪🇬 العربية](README.ar.md)**

</div>

---

No MCP server. No 200 tool definitions. No 25 MB install. Just `argus`, a shell, and the tools you already have.

```console
$ argus detect ./Foo.app/Contents/Resources/app.asar
kind:       asar  (Electron asar)
confidence: high
evidence:   Electron asar signature [04 00 00 00 b5 00 00 00 b1 00 00 00] @0
hint:       Electron app: also check app.asar.unpacked/ for .node addons

$ argus plan ./gh
kind: go (Go binary, high)
route: Go: `go version -m` answers version, module, deps and build flags in one call.
[tier 1] Build info  -> toolchain, main path, deps, build flags
   $ go version -m "$T" | head -40
[tier 1] Dependency list from strings
   $ strings -a "$T" | rg -o '[a-z0-9.-]+\.[a-z]{2,}/[A-Za-z0-9_./-]+@v[0-9][^ ]*' | sort -u | head -60
```

---

## 📌 Why another one of these

The idea of replacing a heavy reverse-engineering tool-server with a short note is right. What such a note usually lacks is *machinery*: it cannot detect what it is looking at, cannot tell the agent what is missing on this machine, cannot keep itself small, and cannot prove any of its claims. **argus** is the same idea with those four gaps closed.

| Dimension | A skill file alone | A big MCP server | **`argus`** |
| :--- | :--- | :--- | :--- |
| **What gets installed** | One markdown file | npm package + background server | **One zero-dependency CLI + an `8.7 KB` skill** |
| **Routing** | The model guesses from the filename | Tool names | **Magic bytes, container structure, section tables, build markers** |
| **Depth** | All of it, or none | All tool schemas upfront | **22 references, pulled one slice at a time (`argus ref electron ipc`)** |
| **Missing tool** | The agent stalls | The server fails | **`argus doctor` prints the fallback; `recon` rewrites `rg` → `grep`** |
| **Cross-platform** | Usually one OS | Usually one OS | **macOS / Linux / Windows alternatives per step** |
| **Size discipline** | Grows forever | Grows forever | **Enforced by `argus check` in CI (`9 KB` skill, `14 KB` / reference)** |
| **Dead ends** | The agent improvises | The server errors | **CI fails if any plan step across 43 plans has no fallback** |
| **Benchmark** | A paragraph | A paragraph | **Weighted keys, saved answers, re-grading, bootstrap CI, generated tables, dry mode** |

---

## 🚀 Install

```sh
git clone https://github.com/abduallahJamal/argus.git && cd argus
npm link                                  # puts `argus` on PATH (zero dependencies, nothing to install)
argus build                               # generate dist/ for every agent format

# Install for your preferred AI coding agent:
argus install --agent opencode            # ~/.config/opencode/skills/argus
argus install --agent claude-code         # ~/.claude/skills/argus
argus install --agent codex               # ~/.agents/skills/argus
argus install --agent all                 # OpenCode, Claude Code, Codex, AGENTS.md, Cursor, GEMINI.md, Copilot
```

Manual install is a single copy:

```sh
# OpenCode
mkdir -p ~/.config/opencode/skills && cp -R skill ~/.config/opencode/skills/argus

# Claude Code
mkdir -p ~/.claude/skills && cp -R skill ~/.claude/skills/argus

# Codex CLI
mkdir -p ~/.agents/skills && cp -R skill ~/.agents/skills/argus
```

Use it inside an agent session:

```text
/argus How does meeting detection work in this app? Cite the files.
```

---

## ⌨️ Commands

| Command | What it does |
| :--- | :--- |
| `argus detect T` | Magic bytes + container structure + build markers → kind, confidence, evidence, hints (`--json`) |
| `argus plan T` | Ordered commands for that kind, with tiers, budgets, per-OS alternatives and a fallback for every step (`--shell`, `--tier 2`, `--json`) |
| `argus recon T` | Runs the tier-1 inventory in one call: only steps whose tools exist, fair output quota per step, evidence saved to `$TMPDIR/argus/<name>/recon.json` |
| `argus doctor` | Checks which of 49 local RE tools exist on this host, versions, install line, and **what to use instead** for each missing one |
| `argus refs` / `argus ref X [word]` | List the 22-topic reference library, print one topic, or slice only lines matching `word` |
| `argus build` | Single source of truth → OpenCode, Claude Code, Codex CLI, `AGENTS.md`, Cursor `.mdc`, `GEMINI.md`, Copilot instructions, and a flat prompt |
| `argus install --agent …` | Copy the compiled package where that agent discovers skills (`opencode`, `claude-code`, `codex`, `agents`, `cursor`, `gemini`, `copilot`, `all`) |
| `argus check [--fixtures]` | Enforces size budgets, reference frontmatter & pointer integrity, fallback coverage across all 43 plans, and 24-fixture routing |
| `argus report R.jsonl` | Median, IQR, deterministic bootstrap CI, weighted accuracy, per-task tables → Markdown **and** a self-contained HTML dashboard |
| `argus grade R.jsonl` | Re-grade saved answers with weighted keys, separator-tolerant matching, and a separate evidence-quality rubric |
| `argus verify F` | Print SHA-256 of a target binary/archive for pinning benchmark fixtures |

---

## 🧭 What "routing" means here

Detection is never a naive filename extension check. It inspects magic bytes first, then container internals, then targeted binary metadata sections:

```text
zip    → contains AndroidManifest.xml + classes.dex?            → apk
       → Payload/*.app? (and Frameworks/Flutter.framework?)     → ipa / ipa-flutter
       → META-INF/MANIFEST.MF or *.class?                       → jar
elf    → .go.buildinfo section?                                 → go
       → .dep-v0 section / /rustc/<sha>?                        → rust
       → f5 f5 dc dc (Dart AOT magic)?                          → flutter
macho  → .node extension or NODE_MODULE?                        → native addon
pe     → BSJB / mscoree.dll / System.Private.CoreLib?           → dotnet (or AOT: native)
any    → af 1b b1 fa?                                           → Unity global-metadata
       → c6 1f bc 03?                                           → Hermes bytecode
       → high entropy, no magic, UPX!/Themida?                  → packed (report, don't guess)
```

Large binaries are not scanned blindly: `metadataRegions()` parses the ELF section header table (or Mach-O `LC_SEGMENT_64` load commands) and reads only sections capable of holding build metadata. That routes a `55 MB` Go binary accurately in milliseconds instead of scanning `12 MB` and giving up.

If nothing matches, `argus` reports `binary-unknown` and prints the header bytes — an honest `unknown` beats a confident wrong route.

---

## 📚 Progressive disclosure, with a CLI

The core skill (`skill/SKILL.md`) is **`8.7 KB`** (hard-capped at `9 KB` in CI): operational rules, a 25-row router table, four copy-paste inventory blocks, and the fixed citation answer format. Everything deep lives in **22 references** averaging `3.3 KB`:

```console
$ argus refs
android             Android — APK, manifest, dex, native libs            3.6 KB
crypto-obfuscation  Crypto, packing and obfuscation                     3.4 KB
disassembly         Reading disassembly without burning context        3.5 KB
dotnet              .NET — IL decompilation, AOT and obfuscation       3.2 KB
electron            Electron apps — asar, IPC, preload, fuses          4.5 KB
...

$ argus ref electron ipc     # only the matching slice, ~40 lines instead of 4.5 KB
```

Why this differs from stuffing a giant system prompt: the agent decides *when* to pull depth, and `argus` decides *how much* to print. `argus ref electron ipc` returns a 40-line answer to a 40-line question.

**22 Reference Topics:** `electron` · `js-bundles` · `react-native` · `node-addons` · `native-macho` · `native-elf` · `native-pe` · `disassembly` · `go` · `rust` · `dotnet` · `jvm` · `android` · `ios` · `unity-il2cpp` · `flutter-dart` · `firmware` · `formats-db` · `runtime-dynamic` · `crypto-obfuscation` · `wasm` · `evidence`

---

## 🛡️ No dead ends

Every step in every plan carries an explicit `fallback`. `argus check` fails CI if even one step omits it. At runtime:

```console
$ argus doctor
argus doctor — platform: linux · core tools: 10/16 · all: 13/49
[core]
  ok  readelf      GNU readelf
  --  rg
        install: apt install ripgrep
        instead: `grep -a` / `findstr`; slower but same shape
```

And `argus recon` goes beyond reporting missing tools — when `ripgrep` is absent it rewrites pipeline steps into equivalent GNU `grep` invocations, logs `rg->grep x2` in the JSON evidence report, and completes the inventory:

```console
$ argus recon /bin/ls --budget 16384
kind: elf (high) · evidence kept: 9872 B of 49152 B
[ok] head — Type, arch, entry, libs  (4472 B, 7 ms)
[ok] sym — Dynamic exports  (614 B, 7 ms)
[ok] strings — Strings  (4786 B, 4 ms)
```

---

## 📊 Benchmark harness

`bench/` is an auditable harness, not a marketing claim. It ships with five tasks, isolated per-task workspaces, saved raw answers, weighted keys, a negative anti-hallucination key per task, and a `--dry` mode so the entire reporting and grading pipeline is verifiable offline without an API key.

```sh
node bench/mkfixtures.mjs                 # 24 synthetic fixtures: every format, zero downloads
node bench/setup.mjs                      # isolated per-task target folders + compiled C target
node bench/fetch.mjs                      # optional real OSS targets (gh, ripgrep, jq, F-Droid APK), SHA-256 pinned
node bench/run.mjs --dry --reps 3         # offline harness self-test
node bench/run.mjs --arms none,skill,argus --reps 3 --shuffle
argus report bench/results/run.jsonl --html bench/dashboard.html
argus grade  bench/results/run.jsonl
```

What this harness fixes compared to a typical *"one model, one machine, three reps"* write-up:

- **Isolation** — each run sees only its own task's target files; zero cross-task leakage or answer keys in the workspace.
- **Saved answers** — every JSONL row stores the verbatim answer so `argus grade` can re-score deterministically at any time.
- **Tolerant yet strict matching** — `"Go 1.27.1"` satisfies `go1\.27\.1`, while `v2.16.1` does *not* satisfy `v2.16.10`. Literal keys match literally, never as accidental wildcard regexes.
- **Weighted accuracy** — tasks carry fact weights so a 5-fact task never outvotes a 24-fact binary task.
- **Negative (`mustNot`) keys** — every task penalises plausible hallucinations (invented IPC channels, false UPX packing claims, base64 framing).
- **Non-parametric statistics** — median with IQR and deterministic bootstrap 95% confidence intervals rather than noisy means over `n=3`.
- **Shuffled sequential execution** — arms shuffle per repetition and run sequentially so CPU contention never skews wall-clock measurements.
- **Honesty about `--dry` rows** — synthetic harness self-test rows carry `"dry": true` and trigger an explicit banner warning. `bench/SELF_TEST.md` and `bench/dashboard.html` are generated from dry rows on purpose to verify pipeline output shape — **this repository ships no pre-baked model claims**.

| Task | Target | Ground-truth questions |
| :--- | :--- | :--- |
| `asar` | Synthetic Electron app + native addon | Native fn → main class → start channel → broadcast channel → preload bridge |
| `native` | Synthetic `.node` addon | Exported symbols, TCC framework/function/service, peer authentication |
| `lock` | `bench/targets/lockdemo.c` (compiled) | Unix socket path format, wire framing, peer UID check |
| `bundle` | Synthetic minified JS bundle | API endpoint, token storage key + auth header, feature flag, global namespace |
| `go` | `gh` release binary (hash-pinned) | Go toolchain version, main module path, exact dependency versions |

---

## 🗂️ Repository layout

```text
bin/argus.mjs        CLI entrypoint (zero runtime dependencies, Node >= 18 ESM)
src/detect.mjs       Magic bytes, container inspection, ELF/Mach-O section tables, build markers
src/plan.mjs         43 per-kind static-analysis plans: tiers, budgets, OS alternatives, fallbacks
src/tools.mjs        49-tool local RE registry + automatic rg -> grep rewriting
src/doctor.mjs       Host capability matrix & fallback advisor
src/recon.mjs        Bounded tier-1 inventory runner & JSON evidence recorder
src/refs.mjs         Progressive-disclosure reference loader & frontmatter/keyword slicer
src/build.mjs        Single source -> OpenCode, Claude Code, Codex, AGENTS.md, Cursor, Gemini, Copilot, flat
src/check.mjs        Repository linter (size budgets, pointers, no-dead-end plans, 24 fixtures)
src/report.mjs       Median / IQR / deterministic bootstrap CI -> Markdown + self-contained HTML
src/grade.mjs        Weighted, separator-tolerant, rubric-separated answer grader
skill/SKILL.md       8.7 KB core skill (CI budget: 9 KB)
skill/references/    22 deep reverse-engineering topics, 73 KB total (CI budget: 14 KB each)
bench/               Synthetic fixture generator, tasks, C target, runner, self-test outputs
test/                Automated test suite (node:test)
```

---

## 💻 Platform support

| Capability | macOS | Linux | Windows |
| :--- | :---: | :---: | :---: |
| Routing, plans, refs, build, install, report, grade | Yes | Yes | Yes |
| `argus recon` bounded inventory | Yes | Yes | Yes (POSIX shell steps via Git Bash or WSL) |
| Native binary plans | `otool` / `lipo` / `codesign` | `readelf` / `objdump` | `dumpbin` / `llvm-readobj` |
| Documented fallbacks when tools are missing | Per step | Per step | Per step |

---

## ⚖️ Authorization & scope

`argus` is built strictly for artifacts you own, have written authorization to audit, or are legally entitled to examine (interoperability, defensive security research, bug-bounty scope, and your own release builds). It never executes target binaries (`detect` and `plan` only read bytes; `recon` runs read-only inspection utilities), is not for bypassing licence checks, DRM, or anti-cheat, and never redistributes extracted proprietary code. Read [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md).

---

## 🤝 Contributing & credit

Contributions are welcome — especially new artifact plans (`src/plan.mjs`), concise reference guides (`skill/references/*.md`), and synthetic fixtures (`bench/mkfixtures.mjs`). Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR (`npm test` and `node bin/argus.mjs check --fixtures` must pass).

Design comparison points: [REA](https://github.com/morluto/rea) (a comprehensive reverse-engineering MCP server) and [leanrea](https://github.com/aicodeking/leanrea) (the 8 KB experiment showing the MCP layer is unnecessary). **argus** builds the missing local machinery around that insight: binary/container detection, host capability reporting, cross-platform fallbacks, CI-enforced context budgets, multi-agent packaging, and a reproducible benchmark harness. Not affiliated with either project.

---

## 📄 License

Released under the [MIT License](LICENSE).
