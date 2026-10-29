---
title: Android — APK, manifest, dex, native libs
when: target is an APK, an XAPK/APKM, a decoded APK tree, or an Android app question
keywords: [android, apk, dex, jadx, apktool, manifest, smali, xapk]
---

# Android

An APK is a zip. The first decision is not "decompile" but "which runtime": Java/Kotlin (dex), Flutter (Dart AOT), React Native (Hermes), Unity (IL2CPP), or a game engine. `lib/` answers that in one line.

## Step 1 — shape

```sh
T=./app.apk
unzip -l "$T" | head -30
unzip -l "$T" | rg -o 'lib/[^/]+/[^ ]+\.so' | sort -u | head -20
unzip -l "$T" | rg -c 'classes[0-9]*\.dex'
unzip -l "$T" | rg 'assets/' | head -20
```

| Seen | Route |
|---|---|
| `libflutter.so` + `libapp.so` | Flutter → `argus ref flutter-dart` |
| `libhermes.so` / `index.android.bundle` | React Native → `argus ref react-native` |
| `libil2cpp.so` + `assets/bin/Data/Managed` | Unity → `argus ref unity-il2cpp` |
| `classes.dex` only | normal Java/Kotlin → continue below |
| Split APKs (`XAPK`, `APKM`, `.apks`) | unzip all, then `adb install-multiple` (or read each split's dex) |

## Step 2 — manifest without full decompilation

```sh
aapt2 dump badging "$T" | head -20        # package, versionName/Code, sdk, launchable-activity
aapt2 dump permissions "$T" | rg 'uses-permission' | head -20
apktool d --no-src -f -o $D/apk "$T" >/dev/null && head -80 $D/apk/AndroidManifest.xml
```
`apkanalyzer manifest print app.apk` is the cleanest if the SDK tools are present.

What you are looking for: `package`, `versionName`, `android:exported` components (attack surface and entry points), `android:networkSecurityConfig` (which domains are trusted), and `<meta-data>` entries (SDK keys, feature flags).

## Step 3 — code

```sh
jadx -d $D/src --show-bad-code "$T" >/dev/null 2>&1
find $D/src -name '*.java' | wc -l
rg -l 'http|socket|Cipher|loadLibrary|getDeviceId' $D/src | head -20
rg -n 'loadLibrary\("([a-z_]+)"\)' $D/src | head          # which native lib is used and where
```
- `--show-bad-code` keeps going where resources break; without it jadx may abort on a bad `resources.arsc`.
- Prefer `--deobf` on obfuscated apps so class names become readable (`a.a.a` → `Config$1`).
- Smali instead of Java when jadx chokes: `apktool d app.apk` then read `smali*/` — verbose but exact.

High-signal greps in a decompiled tree:
```sh
rg -n 'DexClassLoader|PathClassLoader|loadDex|System\.load' $D/src | head
rg -n 'encrypt|decrypt|AES/|RSA/|SecretKeySpec|IvParameterSpec' $D/src | head
rg -n '"https?://[^"]+"' $D/src | sort -u | head -30
```

## Step 4 — native and JNI

```sh
unzip -o -q "$T" 'lib/*' -d $D/lib
for f in $D/lib/*/*.so; do echo "== $f"; argus detect "$f"; done
nm -D $D/lib/arm64-v8a/libfoo.so | rg 'Java_|JNI_OnLoad' | head -30
```
JNI function names encode the Java class and method: `Java_com_example_Main_nativeInit`. That mapping is the fastest way to join Java code to native code.

## Runtime (only if static is not enough)

```sh
adb logcat -s ReactNativeJS:V chromium:V | head -50
frida -U -f com.example.app -l hook.js
```
Hooks that pay off: `java.net.URL` construction, `Cipher.doFinal`, `SharedPreferences.getString`, `okhttp3.Request$Builder.url`.

## Traps

- `versionName` in the manifest can be overridden at runtime; `versionCode` from `aapt2` is the reliable identifier.
- Obfuscated apps rename classes but keep `AndroidManifest.xml` component names — start from exported components and work inward.
- An APK can contain more than one dex with duplicate classes; jadx dedupes, the smali tree does not.
- Do not install an unauthorised APK on a device to "check behaviour": static route first, and say what you could not determine.
