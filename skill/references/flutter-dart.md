---
title: Flutter — Dart AOT snapshot, snapshot hash, blutter
when: target has libflutter.so, libapp.so, Flutter.framework, or is a Flutter app
keywords: [flutter, dart, aot, libapp, snapshot, blutter, kernel_blob]
---

# Flutter

Flutter apps contain almost no Java/Kotlin/ObjC to read: the app logic is Dart compiled AOT into `libapp.so`. The route is: identify the Dart version from the snapshot hash, then recover names with a tool matched to that version, or fall back to strings.

## Files

| Platform | Artifacts |
|---|---|
| Android | `lib/arm64-v8a/libflutter.so`, `lib/arm64-v8a/libapp.so`, `assets/flutter_assets/` |
| iOS | `Frameworks/App.framework/App` (the AOT snapshot), `Frameworks/Flutter.framework/Flutter` |
| Windows/Linux | `data/app.so` / `app.so` + `libflutter_engine` |

`assets/flutter_assets/kernel_blob.bin` would be *unoptimised* kernel (readable-ish) but it is stripped from release builds — its presence means a debug/profile build, which is a much easier target.

## Step 1 — snapshot hash → Dart version

```sh
python3 - <<'PY'
d = open('libapp.so','rb').read()
i = d.find(bytes.fromhex('f5f5dcdc'))
print('magic at', i)
if i >= 0:
    print('snapshot hash', d[i+20:i+36].hex())
PY
strings -a libapp.so | rg -m3 'Dart VM version|dart:core|_kDartIsolateSnapshot'
```
The 32 hex characters at offset +20 after the magic are the snapshot hash. Match it against the Dart SDK version table (the `dart_snapshot_hash` per release, or the engine table in `flutter/engine`); the hash pins the exact Dart engine, which decides which `blutter`/`reFlutter`/`darter` build you need.

Modern Flutter (2.10+/3.x) also prints a VM version string; when present, prefer it over the hash.

## Step 2 — recover names

```sh
blutter libapp.so $D/blutter | tail -5
rg -n 'package:' $D/blutter/*.txt | head -40      # module paths = feature map
rg -n -i 'NEEDLE' $D/blutter/asm/*.asm | head -20
```
`blutter` needs the matching Dart version and produces `asm/` per class plus a symbol dump. Alternatives: `reFlutter` (patches the engine for traffic capture + dumps), `darter` (older).

## Step 3 — no tool for your version? Strings still work

```sh
strings -a -n 8 libapp.so | rg 'package:[a-z0-9_/]+' | sort -u | head -40
strings -a -n 8 libapp.so | rg -i 'https?://|firebase|graphql|api/|licen|socket' | sort -u | head -40
strings -a -n 8 libapp.so | rg -i 'error|exception|invalid' | head -20
```
Dart AOT keeps string literals and the names of *public* symbols reachable from the entry point. Error strings map closely to code paths: `Error: license key expired` names the check even when the function does not.

## Step 4 — traffic instead of code

Flutter ignores the system proxy by default, so the usual MITM fails "for no reason". Options:
- `reFlutter` patches the engine so it honours the proxy and logs the internal requests.
- Hook `SSL_write`/`SSL_read` (BoringSSL) with Frida instead of the higher-level HTTP client.
- Android: hook `libflutter.so`'s `ssl_crypto_x509_session_verify_cert_chain` to bypass pinning for your own test device.

## Traps

- Two different `libapp.so` files can exist (split APKs / app bundles). Check ABI and size; analyze the one the device actually loads.
- Do not confuse `libflutter.so` (the engine) with `libapp.so` (the app). Only `libapp.so` has the app's snapshot.
- A Flutter app can also ship platform channels with real Kotlin/Swift (battery, Bluetooth): grep the APK/IPA for `MethodChannel("...")` names and read those, they are ordinary Java/Swift.
