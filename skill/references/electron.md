---
title: Electron apps — asar, IPC, preload, fuses
when: target is an Electron app, an app.asar, or a desktop app with a Chromium runtime
keywords: [electron, asar, ipc, preload, contextbridge, fuses, renderer, main]
---

# Electron

An Electron app is three layers in one bundle: native (`.node` / Electron Framework), main process (Node + Electron APIs), renderer (web bundle). The feature you were asked about crosses all three, so walk it in that order — native → main → IPC → preload → renderer.

## Where the code lives

| Path | What it is |
|---|---|
| `<App>.app/Contents/Resources/app.asar` | the app's JS, JSON and entry point (macOS) |
| `resources/app.asar` (Windows/Linux) | same |
| `app.asar.unpacked/` | native addons and files that cannot live inside asar (`.node`, helpers) |
| `Contents/Frameworks/Electron Framework.framework` | the runtime itself — version, fuses, Node options |
| `Contents/Resources/*.lproj`, `Assets.car` | localisation and icons, rarely interesting |

## Extract (no install needed)

```sh
A=./app.asar; X=$TMPDIR/argus/asar; rm -rf "$X"
npx -y @electron/asar extract "$A" "$X"
jq '{name,version,main,build}' "$X/package.json"
find "$X" -path '*/node_modules' -prune -o -type f \( -name '*.js' -o -name '*.node' \) -print | head -60
```

Traps:
- `npx -y` is the whole install. Do not add `npm i -g` unless it is called repeatedly.
- Some apps ship `app.asar` with an integrity field; `@electron/asar` ignores it, REA-style tools refuse until you pass a policy flag. If extraction "fails on integrity", you are on the right path — ignore the integrity block, it is not encryption.
- `node_modules` inside the app is huge. Prune it first; the app's own code is usually 1–3 MB.
- If `app.asar` is missing, look for `app/` (unpacked dev build) or `resources/app.asar.unpacked` only.

## IPC: the surface sweep

```sh
X=$TMPDIR/argus/asar
rg -uu -n -o '.{0,120}(ipcMain\.(handle|handleOnce|on|once)|ipcRenderer\.(invoke|send|sendSync|on)|contextBridge\.exposeIn(Main|Isolated)World|webPreferences|preload:|nodeIntegration|contextIsolation|sandbox|\.node\b).{0,160}' "$X" --glob '!node_modules' | head -60
```

If that returns nothing useful, the app wraps IPC in its own client. Channel strings still cannot hide:

```sh
rg -uu -o '"[a-z]+:[a-z0-9:._-]+"' "$X" --glob '!node_modules' | sort | uniq -c | sort -rn | head -60
rg -uu -l 'sendSync|invoke\(' "$X" --glob '!node_modules' | head -20
```

Then read one registration and one caller, not all of them:
```sh
rg -n -C8 'ipcMain.handle\("CHANNEL"' "$X/main"* | head -60
rg -n -C4 'invoke\("CHANNEL"|send\("CHANNEL"' "$X" | head -40
```

Channel naming conventions pay off: `<app>:<domain>:<action>`, and broadcast events often end in `-changed`, `-updated`, `-event`, `-v2`. When a v2 channel exists the v1 is usually dead but still registered — check which one the preload actually exposes.

## preload + contextBridge

```sh
rg -uu -n -C3 'exposeInMainWorld|contextBridge' "$X" --glob '!node_modules' | head -60
```

`exposeInMainWorld('api', {...})` is the real public API of the app. It tells you the renderer's vocabulary, and it is the shortest path from "a button does X" to "which channel carries X".

## Fuses decide your runtime options

```sh
npx -y @electron/fuses read --app "/Applications/Foo.app" | head -20
```

- `runAsNode: false` → no `ELECTRON_RUN_AS_NODE`, so you cannot use the bundled Electron as plain Node to require app modules.
- `enableNodeOptionsEnvironmentVariable: false` → `NODE_OPTIONS`/`--inspect` is blocked; use `lldb` or a Frida agent instead.
- `onlyLoadAppFromAsar: true` → repacking a modified `app/` will not load; patch inside the asar instead.

## The native boundary

```sh
find "$X" -name '*.node' | head; ls -R "${A}.unpacked/node_modules" 2>/dev/null | head -20
argus plan <file>.node        # then argus ref node-addons
```

The JS side usually calls a thin wrapper such as `macUtils.getRunningInputAudioProcesses()`. The exported name in the binary is the exact needle you search for in `strings`.

## Reading a feature end to end

1. Find the user-visible string or menu label in the renderer bundle; the handler is one hop away.
2. Follow to `invoke(channel)`; note the channel and the payload shape.
3. Find `ipcMain.handle(channel)`; read the main-process method it calls.
4. If that method calls a `.node` export, `argus ref node-addons` and read the native names.
5. Broadcasts go the other way: `webContents.send(channel2)` → renderer `on(channel2)`. Both directions are worth one line each in the answer.
