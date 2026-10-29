---
title: Runtime and dynamic analysis — hooks, debuggers, tracing, proxies
when: the question is about behaviour at runtime, or static reading reached its limit
keywords: [runtime, frida, lldb, dtrace, adb, mitmproxy, inspect, tracing, hook]
---

# Runtime

Static analysis says what the code *can* do. Runtime says what it *did*. Use it when a value is computed, downloaded, or decrypted — and when the target is a live app you are authorised to instrument.

## macOS / iOS

```sh
log stream --predicate 'process == "Foo"' --level debug | head -60
sudo fs_usage -w -f filesys Foo | head -40          # file paths it touches
sudo dtrace -n 'pid$target::*:entry {}' -p $(pgrep Foo)   # too noisy without a predicate; use a symbol
lldb -p $(pgrep Foo) -o 'br set -n getRunningInputAudioProcesses' -o continue
```
For an Electron main process, `--inspect` is the cheapest runtime window — but only if the fuses allow it (`argus ref electron`).

## Android

```sh
adb logcat | rg -i 'ReactNativeJS|flutter|chromium' | head -50
adb shell dumpsys package com.example.app | head -40      # exported components, intent filters
frida -U -f com.example.app -l hook.js
```
Hook template:
```js
Java.perform(() => {
  const Cipher = Java.use('javax.crypto.Cipher');
  Cipher.doFinal.overload('[B').implementation = function (b) {
    const out = this.doFinal(b);
    console.log('[cipher] in=' + b.length + ' out=' + out.length + ' alg=' + this.getAlgorithm());
    return out;
  };
});
```

## Network

```sh
mitmproxy -p 8080 --set confdir=$D/mitm        # then point the app/device at it
# macOS app: SSL_CERT_FILE / NODE_EXTRA_CA_CERTS for Electron/Node targets
# Android: user CA is ignored on API 24+; you need a test device with a system CA or Frida-based unpinning
```
Flutter and apps with certificate pinning ignore the proxy: hook `SSL_write`/`SSL_read` or the pinning check instead (`argus ref flutter-dart`).

## What to hook, in order of payoff

1. The narrowest boundary you already found statically: the one native function, channel, or API method.
2. OS primitives: `NSURLSession`, `okhttp3.Request$Builder.url`, `SecItemCopyMatching`, `Cipher.doFinal`, `SharedPreferences.getString`.
3. Encrypted blobs: hook the decrypt function and dump its output, rather than reverse the algorithm.
4. Anti-debug paths: if the app exits under a debugger, hook `ptrace`, `IsDebuggerPresent`, or `sysctl` and return "not traced".

## Traps

- Never instrument a target you are not authorised to run. Hooks change behaviour; note in the answer that the observation is from a modified run.
- Release builds strip logging hooks; absence of a log line is not absence of behaviour.
- Timing: a hook can change the order of events. For protocol questions, capture passively (pcap/proxy) and use hooks only for values.
- Say which evidence is `seen` in a live run versus `inferred` from code — the two are not the same witness.
