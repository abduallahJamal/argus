---
title: Mach-O — headers, symbols, entitlements, ObjC/Swift
when: the target is a Mach-O, a .dylib, a .node, or a macOS/iOS executable
keywords: [macho, otool, lipo, dyld, entitlements, codesign, objc, swift, macos]
---

# Mach-O

Order matters: architecture → linked libs → imports → strings → entitlements → (rarely) disassembly.

## One-call inventory

```sh
T=./bin; D=$TMPDIR/argus/$(basename "$T"); mkdir -p "$D"
file -b "$T"; lipo -info "$T" 2>/dev/null
otool -L "$T" | head -30
echo '--- EXPORTS'; nm -gU "$T" 2>/dev/null | head -150
echo '--- IMPORTS'; nm -u "$T" 2>/dev/null | rg -v '^__Z|napi_' | tr '\n' ' ' | fold -w 200 | head -10
echo '--- STRINGS'; strings -a -n 6 "$T" | rg -v '^[_$.]' | head -300
```

Imports are the capability map: `socket`, `getpeereid`, `CCKeyDerivationPBKDF`, `TCCAccessPreflight`, `NSWorkspace`, `AVCaptureDevice`.

## Structure worth reading

```sh
otool -l "$T" | rg -A4 'LC_BUILD_VERSION|LC_RPATH|LC_ENCRYPTION_INFO|LC_MAIN' | head -40
codesign -d --entitlements :- "$T" 2>/dev/null | head -40      # sandbox, device access, JIT
codesign -dv "$T" 2>&1 | head -12                              # team id, flags, hardened runtime
xcrun dyld_info -exports -imports "$T" 2>/dev/null | head -40   # faster than otool -L on big files
```

- `LC_ENCRYPTION_INFO` with `cryptid 1` = FairPlay-encrypted (App Store IPA): static analysis yields junk until decrypted. Say so instead of guessing.
- `LC_BUILD_VERSION` gives the minimum OS, which dates the SDK.
- Entitlements are the highest-signal 40 lines in the whole file: `com.apple.security.device.audio-input`, `com.apple.security.cs.allow-jit`, `com.apple.security.app-sandbox` answer capability questions outright.

## Universal binaries

```sh
lipo -info T; lipo -detailed_info T | head -20
lipo -thin arm64 -output $TMPDIR/argus/thin T   # then re-plan on the slice
```
Analyzing a fat file directly doubles every output and confuses offsets. Thin first, always.

## ObjC and Swift

```sh
otool -ov "$T" 2>/dev/null | rg 'name |meth name' | head -80    # classes + selectors
nm -gU "$T" | awk '{print $NF}' | xcrun swift-demangle --compact 2>/dev/null | rg '^_?\$s' | head -40
strings -a "$T" | rg '^_TtC|^_TtV' | head -20                   # Swift class names (mangled)
```

`otool -ov` is verbose; grep for `meth name` and you get the selector list, which reads like a class API. In disassembly, ObjC calls appear as `objc_msgSend` followed by the selector string in the following `bl`/literal comment.

## Reading code cheaply

```sh
otool -tV "$T" > $D/dis.txt
rg -n '^_?[A-Za-z][A-Za-z0-9_$.:-]*:$' $D/dis.txt | head -150      # function labels
rg -n 'literal pool for: "(getRunning|start|stop)' $D/dis.txt      # who uses a string
```
otool annotates each `bl` with the target symbol and string literals inline, so a function body reads like pseudo-code. For real C, use Ghidra (`analyzeHeadless`) or `r2 -qc 'aaa; pdc @ sym._foo'`.

ARM64 shape to recognise: `adrp`+`add` builds an address (a string or a global), `bl` calls, `ldr w2, [x0, #8]` reads a struct field, `cbz/cbnz` is a nil/zero check, and the return value goes through `w0/x0`.

## Traps

- `nm -gU` shows only external symbols. On a stripped binary it is empty — use `otool -Iv` for indirect symbols and `strings` for names.
- `strings` on ObjC/Swift emits a lot of `__TEXT` junk; filter with `rg -v '^[_$.]'` and `-n 6`.
- On Linux, `otool`/`lipo`/`codesign` do not exist: use `llvm-objdump -p`, `llvm-lipo`, and `llvm-objdump --macho --private-headers`. `plutil` → python `plistlib`.
- A "Mach-O" that fails `otool -L` may be a kernel extension, a `.a` archive, or a file with a wrong `file` result. Check the magic yourself.
