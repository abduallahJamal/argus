---
title: Unity IL2CPP — metadata + libil2cpp
when: target has global-metadata.dat, libil2cpp.so, GameAssembly.dll, or is a Unity game
keywords: [unity, il2cpp, global-metadata, gameassembly, il2cppdumper, cpp2il, game]
---

# Unity IL2CPP

Unity converts C# to C++ and then to native code. The names are stripped from the code but kept in a separate file: `global-metadata.dat`. Joining the two recovers class and method names for the whole game.

## Files

| Platform | Code | Metadata |
|---|---|---|
| Android | `lib/arm64-v8a/libil2cpp.so` | `assets/bin/Data/Managed/Metadata/global-metadata.dat` |
| Windows | `GameAssembly.dll` | `<Game>_Data/il2cpp_data/Metadata/global-metadata.dat` |
| macOS | `Contents/Frameworks/GameAssembly.dylib` | `Contents/Resources/Data/il2cpp_data/Metadata/global-metadata.dat` |
| iOS | `Frameworks/UnityFramework.framework/UnityFramework` | `Data/Managed/Metadata/global-metadata.dat` |

Check the metadata magic: `xxd -l 4 global-metadata.dat` → `af 1b b1 fa`. A different magic means an older (pre-19) or encrypted metadata file.

## Dump

```sh
Il2CppDumper/lib/Il2CppDumper global-metadata.dat libil2cpp.so $D/il2cpp | tail -5
ls $D/il2cpp          # dump.cs, il2cpp.h, script.json, stringliteral.json, DummyDll/
```
- `dump.cs` = every class, field and method with its RVA. This is the answer to "how does the game do X" 90% of the time.
- `script.json` feeds IDA/Ghidra scripts so the method RVAs get names.
- `DummyDll/` = recompilable stubs, useful if you want to reference types from a C# tool.

If Il2CppDumper fails on a newer Unity version, use **Cpp2IL** (`Cpp2IL --game-path ...`) or **Il2CppInspector** — they do not need a global-metadata match and handle obfuscated/encrypted metadata.

## Find the feature

```sh
rg -n -i 'NEEDLE' $D/il2cpp/dump.cs | head -20
rg -n 'class .*Player|void Update|IEnumerator' $D/il2cpp/dump.cs | head -20
```
Then read the method body:
```sh
# RVA from dump.cs -> address in libil2cpp.so
python3 - <<'PY'
rva = 0x123456        # paste the RVA printed in dump.cs for that method
base = 0x0            # readelf -SW libil2cpp.so | rg ' .text '
print(hex(base + rva))
PY
objdump -d --start-address=0x... --stop-address=0x... libil2cpp.so | head -60
```
In practice Ghidra with the Il2CppDumper script applied is far faster than raw objdump for IL2CPP code, because the generated struct offsets match `il2cpp.h`.

## Strings and assets

```sh
python3 - <<'PY'
import json
data = json.load(open('$D/il2cpp/stringliteral.json'))
for e in data[:200]:
    print(e.get('value'))
PY
```
Unity asset bundles: `AssetStudio` / `AssetRipper` open `.assets`, `.bundle` and `.unity3d` files and extract textures, text assets and MonoBehaviour data.

## Traps

- Encrypted or modified metadata is a known anti-cheat measure (some protections re-encrypt `global-metadata.dat` per build). If the magic is wrong and the app runs, do not claim the metadata is missing — say it is obfuscated.
- `libil2cpp.so` also needs the ELF plan for its own imports/entitlements; IL2CPP is C++ code with a name table, not a different instruction set.
- Mono builds (`Managed/Assembly-CSharp.dll` present as a real .NET assembly) are much easier: straight to `argus ref dotnet`, no IL2CPP.
