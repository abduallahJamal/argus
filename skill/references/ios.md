---
title: iOS — IPA, encryption, plists, Swift
when: target is an .ipa, a Payload/*.app, or an iOS app question
keywords: [ios, ipa, fairplay, cryptid, plist, swift, objc, framework]
---

# iOS

## Step 1 — unpack and identify

```sh
unzip -o -q app.ipa -d $D/ipa
APP=$(find $D/ipa/Payload -maxdepth 1 -name '*.app' | head -1); echo "$APP"
plutil -convert json -o - "$APP/Info.plist" | jq '{CFBundleIdentifier,CFBundleShortVersionString,CFBundleExecutable,MinimumOSVersion,CFBundleURLTypes}'
BIN="$APP/$(plutil -extract CFBundleExecutable raw "$APP/Info.plist")"
file -b "$BIN"
ls "$APP/Frameworks" 2>/dev/null | head -20
```

## Step 2 — encryption check before anything else

```sh
otool -l "$BIN" | rg -A4 LC_ENCRYPTION_INFO | rg 'cryptid| cryptoff'
```
- `cryptid 0` = decrypted (a debug/enterprise build, or already dumped). Proceed.
- `cryptid 1` = FairPlay-encrypted App Store binary. `__TEXT` is encrypted; strings and disassembly of the text segment are garbage. State that plainly, and offer the options: a decrypted dump from an authorised device, runtime analysis on a jailbroken test device, or dynamic hooks at the Objective-C/Swift boundary which still work because the runtime decrypts pages in memory.

Also check for a Mach-O universal: `lipo -info "$BIN"`.

## Step 3 — the app itself

```sh
argus plan "$BIN"                       # Mach-O plan with iOS-specific notes
nm -gU "$BIN" | awk '{print $NF}' | xcrun swift-demangle --compact | rg '^_?\$s' | head -40
strings -a "$BIN" | rg '^_TtC' | head -20          # Swift class names (mangled)
otool -ov "$BIN" 2>/dev/null | rg 'meth name' | head -60   # ObjC selectors
codesign -d --entitlements :- "$BIN" 2>/dev/null | head -30
```

Entitlements on iOS are unusually informative: `aps-environment`, `com.apple.developer.associated-domains`, `keychain-access-groups`, `com.apple.security.application-groups`.

## Step 4 — the rest of the bundle

```sh
ls "$APP" | head -40
find "$APP" -name '*.dylib' -o -name '*.framework' | head -20
strings -a "$APP/Assets.car" 2>/dev/null | head -10
find "$APP" -name '*.plist' | head -20
```
- Frameworks are separate Mach-O files: route each one with `argus plan`.
- `PlugIns/*.appex` = extensions, often holding the interesting feature (share sheet, widgets).
- `assetutil --info Assets.car` (macOS) lists image and colour assets.
- A `*.bundle` folder often contains JS/HTML (React Native, Cordova, or a WebView feature) — grep it like a web bundle.

## Step 5 — runtime on a test device

```sh
frida -U -f com.example.app -l hook.js
```
Hooks that work despite encryption: `-[NSURLSession dataTaskWithRequest:]`, `SecItemCopyMatching`, `CCKeyDerivationPBKDF`, and Swift methods by demangled name.

## Traps

- An IPA is a zip but it is not a copy of `/Applications/...` from a device: it includes `Payload` only, no `Documents`, no prefs. User data questions cannot be answered from the IPA.
- `cryptid` can be 1 in the header while the app still runs on a jailbroken device with a dumper; do not confuse "encrypted on disk" with "unreadable".
- Bitcode is gone (Xcode 15+), so do not look for `.bc` files.
- App Store thinning means the Mach-O you get may be arm64-only and include `__LLVM` segments: one slice, not the full app.
