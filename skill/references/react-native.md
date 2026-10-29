---
title: React Native — Hermes bytecode, bridge, native side
when: the target is a React Native app, index.android.bundle, or a .hbc/.jsc file
keywords: [react-native, hermes, hbc, bytecode, bridge, metro, jsc, bundle]
---

# React Native

RN ships JavaScript that has already been compiled (Hermes bytecode) or snapshotted (JSC `.bundle`). Android: `assets/index.android.bundle`. iOS: `main.jsbundle` or `index.ios.bundle`.

## Step 1 — what format is it?

```sh
python3 - <<'PY'
import struct
d=open('index.android.bundle','rb').read(64)
magic,ver=struct.unpack('<II', d[:8])
print('magic', hex(magic), 'hbc', ver, 'compliant', (ver>>16)&0xff)
print('functionCount', struct.unpack('<I', d[40:44])[0])
PY
```

| Magic | Meaning | Route |
|---|---|---|
| `c6 1f bc 03` | Hermes HBC | hermes-dec / hbc-decompiler, or runtime hooks |
| `de c0 ad de` (zlib header `1f 8b`) | gzip of a JS bundle | gunzip then treat as JS |
| printable JS | plain JS bundle | `argus ref js-bundles` |
| `cafebabe`-like `.jsc` | bytenode V8 cache | **not decompilable** — strings + runtime only |

The HBC version (`ver`) must match your disassembler's supported range; a mismatch produces garbage, not an error. Check the tool's README table before trusting output.

## Step 2 — Hermes

```sh
pipx install hermes-dec            # if not present
hermes-disasm index.android.bundle > $TMPDIR/argus/hbc.txt   # or:
hbc-decompiler index.android.bundle $TMPDIR/argus/hbc.txt
head -30 $TMPDIR/argus/hbc.txt
```

Useful greps in the output:
```sh
rg -n 'CreateClosure|Call\d|GetById|NewObject' $TMPDIR/argus/hbc.txt | head -20   # shape
rg -n -i 'https?://|/api/|token|socket' $TMPDIR/argus/hbc.txt | head -30
```

Hermes keeps a **string table** intact even when function names are stripped. That table answers most "what does it talk to" questions:

```sh
strings -a -n 6 index.android.bundle | rg -i 'https?://|wss?://|/api/|firebase|graphql' | sort -u | head -40
strings -a index.android.bundle | rg -o 'package:[a-z0-9_./]+' | sort -u | head -40   # module paths = feature map
```

Module paths are the highest-value output: `package:myapp/features/meeting` tells you the feature exists and how it is named, even with no code.

## Step 3 — runtime (often faster than the bytecode)

```sh
adb shell pidof com.example.app
frida -U -f com.example.app -l hook.js
```
```js
// hook.js — log every string that reaches a fetch/WebSocket
Java.perform(() => {
  const OkHttp = Java.use('okhttp3.Request$Builder');
  OkHttp.url.overload('java.lang.String').implementation = function (u) {
    console.log('[url] ' + u); return this.url(u);
  };
});
```
- `adb logcat | rg -i 'ReactNativeJS|console'` shows the app's own logs — RN dev logs often survive in release builds for errors.
- If the app is debuggable, attach Chrome DevTools via `adb forward tcp:8081 tcp:8081`; for release builds this is disabled (`android:debuggable="false"`).

## Step 4 — native side of the bridge

A native module is registered by name: search the JS bundle for `NativeModules.<Name>` and the native binary for that exact string.

```sh
unzip -l app.apk | rg 'lib/.*\.so'
strings -a lib/arm64-v8a/libapp.so | rg -i 'NativeModules|RCTBridgeModule|getConstants'
nm -D lib/arm64-v8a/libapp.so | rg -i 'Java_com_.*_<Name>|OBJC_CLASS.*<Name>'
```

## Traps

- `index.android.bundle` in the APK is usually *not* the one the app runs if OTA updates (CodePush/Expo) are enabled: look in `/data/data/<pkg>/` or the app's cache for the newer bundle.
- A `.jsc` or a Hermes bundle inside an `.ipa` cannot be decompiled to readable JS; state that, then give the string-table and runtime evidence.
- Do not assume RN's dev server is reachable; production builds drop the dev menu entirely.
