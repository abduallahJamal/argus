---
name: argus
description: Reverse engineer shipped software with plain local CLI tools — no MCP server, no 200 tool definitions. Routes Electron/asar, minified JS, Hermes/React Native, Mach-O, ELF, PE/.NET, Go, Rust, JVM, Android APK, iOS IPA, Unity IL2CPP, Flutter, WASM, SQLite, pcaps, firmware and live processes to the fastest local command, and answers in a fixed evidence format.
---

# argus — route, slice, prove

You already know these tools. This file is routing, budgets and traps. Depth lives in references:
`argus refs` lists them, `argus ref <topic>` prints one, `argus ref <topic> <word>` prints only matching lines.
Load a reference only when the step you are on needs it.

## Rules

1. **Work on a copy.** `cp` the target into `$TMPDIR/argus/<name>/`; never mutate, never run untrusted binaries. Reuse an existing extraction instead of redoing it.
2. **Route before you read.** `argus detect T` (magic bytes + build markers), then `argus plan T` (ordered, budgeted commands), then run. Guessing the file type is the most expensive mistake available.
3. **Turns cost more than bytes.** Aim for 2–5 tool calls: one batched recon, one or two slices, then answer. `argus recon T` performs the whole tier-1 inventory in a single call and writes `recon.json`.
4. **Batch and mark.** Independent probes go in ONE shell call separated by `;` with `echo '--- name'` markers (quote them: zsh expands a bare `==x`). Cap every output with `head`, `-m`, or a line count.
5. **Never `cat` a big file.** Slice it: `rg -o '.{0,250}NEEDLE.{0,250}' F | head -20`. Dump a disassembly once to a file and grep that file from then on.
6. **`rg -uu` on extracted trees.** Bundlers hide code in dot-folders (`.webpack/`, `.vite/`), and `rg` skips hidden and git-ignored paths by default.
7. **Every claim is labelled.** `seen` (cite file:offset, symbol, or channel), `inferred` (say from what), `unknown` (say what would prove it). "Absent" is never a finding from not finding: static reading is not observed execution.
8. **A missing tool is a route change, not a blocker.** `argus doctor` prints the fallback for every absent tool. If a step cannot run, use its fallback or say so — never invent output.
9. **Scope.** Only artifacts you own or are authorised to analyse; no DRM circumvention, no redistribution of extracted third-party code. Say so if a request crosses that line, then continue with what is allowed.

## First move: one call each

Native, Go, Rust, .NET, Flutter, or anything already on disk (does the inventory and picks the route):
```sh
argus recon ./target --budget 32768
```
If `argus` is not installed, read the plan instead and paste one block:
```sh
T=./target; D=$TMPDIR/argus/$(basename "$T"); mkdir -p "$D"; file -b "$T"; strings -a -n 6 "$T" | head -300; nm -gU "$T" 2>/dev/null | head -120; nm -u "$T" 2>/dev/null | tr '\n' ' ' | fold -w 200 | head -10
```

Electron / asar:
```sh
A=./app.asar; X=$TMPDIR/argus/asar; rm -rf "$X"; npx -y @electron/asar extract "$A" "$X" && jq '{name,version,main}' "$X/package.json"; ls "${A}.unpacked/node_modules" 2>/dev/null; rg -uu -n -o '.{0,120}(ipcMain\.(handle|on|once)|ipcRenderer\.(invoke|send|on)|contextBridge\.exposeInMainWorld|preload:|nodeIntegration|contextIsolation|sandbox|\.node\b).{0,160}' "$X" --glob '!node_modules' | head -50; rg -uu -o '"[a-z]+:[a-z0-9:-]+"' "$X" --glob '!node_modules' | sort -u | head -60
```

Mobile (APK/IPA) — read the zip shape before decompiling; it decides the route:
```sh
unzip -l ./app.apk | rg -o 'lib/[^/]+/[^ ]+\.so' | sort -u; unzip -l ./app.apk | rg -c 'classes(2|3)?\.dex'; argus plan ./app.apk --tier 2
```

Web bundle — never read it:
```sh
F=./bundle.js; rg -uu -o 'sourceMappingURL=[^ "'"'"']+' "$F" | head -3; rg -uu -o '.{0,250}NEEDLE.{0,250}' "$F" | head -20
```

## Router

| Target (how you know) | Fastest first move | Depth |
|---|---|---|
| Electron app (`*.app/Contents/Resources/app.asar`, or `app.asar` in `resources/`) | asar extract → `jq .main` → IPC sweep → `app.asar.unpacked/*.node` | `argus ref electron` |
| Minified JS / `sourceMappingURL` | dump `sourcesContent` if the map has it; else prettier once, then slice by needle | `argus ref js-bundles` |
| Hermes HBC (`c6 1f bc 03`, `index.android.bundle`) | header → HBC version → `hermes-dec`, or hook at runtime | `argus ref react-native` |
| Browser website | `curl -sL` the HTML, list script srcs, then Playwright request log | `argus ref runtime-dynamic` |
| Mach-O (`file` says Mach-O) | `lipo -info`; `otool -L`; `nm -gU`; `nm -u`; strings; entitlements | `argus ref native-macho` |
| Mach-O universal | `lipo -thin arm64`, then re-plan on the slice | `argus ref native-macho` |
| ELF | `readelf -hlSW`; `readelf -dW \| rg NEEDED`; `nm -D`; strings | `argus ref native-elf` |
| PE (`MZ`) | `objdump -x \| rg -A40 'Import Tables'`; version resource; signature | `argus ref native-pe` |
| .NET (`BSJB`, `mscoree.dll`) | `ilspycmd -p -o src T` then grep the C# | `argus ref dotnet` |
| Go (`Go buildinf:`) | `go version -m T` — toolchain, main path, deps, flags | `argus ref go` |
| Rust (`.dep-v0`, `/rustc/`) | `cargo audit bin T`; rustc hash; panic strings | `argus ref rust` |
| Need real code logic | dump `otool -tV`/`objdump -d` once, grep; decompile only one function | `argus ref disassembly` |
| APK | `unzip -l` for `lib/*/*.so`; `aapt2 dump badging`; `jadx -d` | `argus ref android` |
| IPA | `unzip` → Info.plist → **cryptid check first** → Mach-O plan | `argus ref ios` |
| Unity IL2CPP (`global-metadata.dat`, `libil2cpp.so`) | Il2CppDumper → `dump.cs` → grep → RVA into the ELF plan | `argus ref unity-il2cpp` |
| Flutter (`libflutter.so`, `libapp.so`, magic `f5 f5 dc dc`) | snapshot hash → Dart version → blutter, or `strings \| rg 'package:'` | `argus ref flutter-dart` |
| Native Node addon (`.node`) | N-API call census, then the exported JS names, then host frameworks | `argus ref node-addons` |
| JVM (`.jar`, `META-INF/MANIFEST.MF`, `dex`-free `class`) | `unzip -p … MANIFEST.MF`; CFR/vineflower; `javap -p -c` for one method | `argus ref jvm` |
| SQLite (`SQLite format 3`) | copy db **and `-wal`**, read-only URI, `.schema`, sample rows | `argus ref formats-db` |
| plist / `Assets.car` / LevelDB | `plutil -convert json -o -`, `assetutil --info`, LevelDB via `ldb` | `argus ref formats-db` |
| pcap / HAR | `tshark -q -z conv,tcp`; DNS + SNI; then request lines | `argus ref formats-db` |
| Firmware / unknown blob | entropy + magic scatter → unblob/binwalk → re-route each piece | `argus ref firmware` |
| Packed or obfuscated (`UPX!`, Themida, VMProtect) | report packed; `upx -d` if UPX; else runtime route | `argus ref crypto-obfuscation` |
| WASM (`\0asm`) | `wasm-objdump -x` for the import/export table; `wasm-decompile` | `argus ref wasm` |
| Live process / runtime question | `frida`, `lldb`, `dtrace`/`log stream`, `--inspect`, `adb logcat`, mitmproxy | `argus ref runtime-dynamic` |

## Slice, don't read

- Bundle/binary needle: `rg -a -o '.{0,250}NEEDLE.{0,250}' F | head -20`
- Who uses a string: in `otool -tV` output, `rg -n 'literal pool for: "X'` then read the label above it.
- Call trail of one function: `awk '/^_FUNC:$/{p=1;next} p&&/^[_A-Za-z].*:$/{exit} p' dis.txt | rg 'bl|call|cmp|literal'`
- Hidden channels in Electron: the wrapper hides `ipcMain`, the string cannot hide — sweep `"[a-z]+:[a-z0-9:-]+"`.
- Version comparison: diff inventories (`nm`, module lists, `go version -m`, `.dep-v0`) before diffing any code.
- Rebuild a feature: write the minimal reimplementation, then run it against the original and compare outputs.

## Answer format

Answer in this shape, nothing else. It is what makes the work checkable:

```
**Findings** — <one line: what the feature does>
- <claim> — seen: <file:line | symbol | channel | offset>
- <claim> — seen: ...
- <claim> — inferred from <evidence>
- <what you could not determine> — unknown; would need <method>

**Route** — <kind> → <commands actually run> (so the next person can repeat it)
```

Keep it under ~300 words unless asked to go deep. Full rubric: `argus ref evidence`. Cite paths you really read, with line numbers when you have them. One claim per bullet, no padding, no summary of the summary.

## CLI

```sh
argus detect T            # magic bytes + build markers, --json
argus plan T --shell      # one paste-and-run block, budgets included
argus recon T             # run the tier-1 inventory, bounded, saves evidence
argus refs / argus ref X  # pull depth only when needed
argus doctor              # what this machine has, and the fallback for each gap
```

## Install tools (only on request)

`brew install jadx apktool radare2 binwalk wabt wireshark ghidra ripgrep` · `npm i -g @electron/asar` · `dotnet tool install -g ilspycmd` · `cargo install cargo-audit` · `pipx install unblob frida-tools`
