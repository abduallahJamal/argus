# Changelog

All notable changes to **argus** (`@argus-re/cli`) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-29

### Added
- **Multi-agent skill compiler & installer (`argus build` / `argus install`)**: compiles one `8.67 KB` source (`skill/SKILL.md`) + 22 progressive-disclosure references (`73 KB`) into native packages for **OpenCode** (`~/.config/opencode/skills/argus`), **Claude Code** (`~/.claude/skills/argus`), **Codex CLI** (`~/.agents/skills/argus`), **AGENTS.md**, **Cursor** (`.cursor/rules/argus.mdc`), **Gemini CLI** (`GEMINI.md`), **GitHub Copilot** (`.github/copilot-instructions.md`), and a standalone flat prompt.
- **Section-aware binary detection (`src/detect.mjs`)**: parses ELF section headers and Mach-O `LC_SEGMENT_64` load commands via `metadataRegions()` to route large Go, Rust, Flutter, and .NET binaries in milliseconds without blind full-file scans.
- **Bounded reconnaissance runner (`argus recon`)**: executes tier-1 static inventory steps within a strict byte budget, automatically rewrites missing `ripgrep` (`rg`) pipelines into POSIX/GNU `grep` equivalents, and writes structured evidence to `$TMPDIR/argus/<name>/recon.json`.
- **49-tool local capability matrix (`argus doctor`)**: checks host availability, versions, install commands, and concrete fallbacks across macOS, Linux, and Windows.
- **Reproducible benchmark harness (`bench/`)**: 24 synthetic offline fixtures (`bench/mkfixtures.mjs`), 5 isolated benchmark tasks (including compiled `lockdemo.c`), weighted & separator-tolerant answer grading (`argus grade`), negative anti-hallucination keys (`mustNot`), deterministic bootstrap 95% CIs, and automated Markdown + self-contained HTML dashboard generation (`argus report`).
- **Repository integrity & budget gates (`argus check`)**: enforces the `9 KB` core skill cap, `14 KB` per-reference cap, frontmatter completeness, `argus ref` pointer resolution, mandatory `fallback` coverage across all 43 plans, and 24/24 fixture routing in CI.
- **Bilingual documentation**: full English (`README.md`) and Arabic RTL (`README.ar.md`) documentation plus explicit scope & authorization policy (`docs/AUTHORIZATION.md`).
