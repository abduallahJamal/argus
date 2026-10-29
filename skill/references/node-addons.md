---
title: Native Node addons (.node) — N-API surface
when: target is a .node addon, or an Electron/RN app calls a native module
keywords: [node, napi, addon, node-gyp, native, electron, abi]
---

# Native Node addons

A `.node` file is a shared library whose exported JS surface is created at load time by N-API calls. The exports list is often empty-looking; the **construction calls** are the real inventory.

## Inventory in one call

```sh
T=./mac_utils.node
file -b "$T"; otool -L "$T" 2>/dev/null | head       # macOS; readelf -dW on Linux
strings -a "$T" | rg -o 'napi_[a-z_]+' | sort | uniq -c | sort -rn | head -20
nm -gU "$T" 2>/dev/null | head -40
```

`napi_define_class`, `napi_create_function`, `napi_set_named_property`, `napi_create_object` tell you *how* the surface is built. Then get the names, which are C strings passed at registration:

```sh
strings -a -n 4 "$T" | rg '^[A-Za-z_][A-Za-z0-9_]{2,40}$' | sort -u | head -80
strings -a "$T" | rg -i 'Node-API|napi_version|NAPI_MODULE|NODE_MODULE_INIT'
```

For context-aware addons (`NODE_MODULE_INIT`), the init function is exported as `napi_register_module_v1`; its body is a short sequence of `napi_create_function(name, NAPI_AUTO_LENGTH, cb)` calls. Read the names in order and you have the API in declaration order.

## What the exports do

The import list is the capability map, and for macOS apps it is where permission checks show up:

```sh
nm -u "$T" | rg -i 'TCC|CoreAudio|IOKit|CoreGraphics|Security|SecItem|sqlite|CFPreferences'
```

`TCCAccessPreflight`, `TCCAccessRequest`, `CGPreflightScreenCaptureAccess`, `AXIsProcessTrusted` all mean "this module asks the OS for permission X". The service string next to the call (`kTCCServiceAudioCapture`, `kTCCServiceScreenCapture`) names X.

## Calling pattern

Wrappers are thin: each export converts JS args with `napi_get_value_*`, calls a C/C++ helper, then `napi_create_*` the result. To answer "how does `isWindowOccluded` work", read just that callback:

```sh
otool -tV "$T" > $TMPDIR/argus/dis.txt
rg -n 'napi_create_function|literal pool for: "isWindowOccluded"' $TMPDIR/argus/dis.txt | head
# then the call sequence inside the enclosing function:
awk '/^_FUNC:$/{p=1;next} p&&/^[_A-Za-z].*:$/{exit} p' $TMPDIR/argus/dis.txt | rg 'bl|call' | head -40
```

## Single-instance locks, IPC and sockets

Many desktop apps implement `requestSingleInstanceLock` in the addon: a unix domain socket, a JSON or length-prefixed message, and a peer authentication call. Look for:
```sh
strings -a "$T" | rg -i 'singleinstance|\.sock|/tmp/|getpeereid|SO_PEERCRED'
nm -u "$T" | rg -i 'socket|bind|connect|listen|getpeereid|recv|send'
```
`getpeereid` = the first instance validates the caller's uid/gid on the socket; `SO_PEERCRED` is the Linux equivalent. A path like `/tmp/<bundle-id>.singleinstance.<euid>.<hash>.sock` decomposes into bundle id, effective uid, and a hash of something (often the executable path) — verify each part against the disassembly before asserting it.

## Traps

- A `.node` addon cannot be loaded by a different Node ABI (Electron uses its own). For dynamic analysis, run it under the app's own Electron with `ELECTRON_RUN_AS_NODE=1` — and check the fuses first, because `runAsNode` is often disabled.
- `nm -gU` on a stripped addon may print nothing; use `otool -Iv` (indirect symbols) and `strings` instead.
- `napi_*` names appear in the export table only if linked dynamically; static N-API is inlined, so count them in `strings`, not in `nm`.
