---
title: .NET — IL decompilation, attributes, AOT and obfuscation
when: target is a .exe/.dll with BSJB or mscoree.dll, or the question is about a .NET app
keywords: [dotnet, csharp, il, ilspy, dnspy, msil, clr, aot, obfuscation]
---

# .NET

IL is high-level. If the metadata is intact, decompilation gives you the original C# with method names, and there is nothing to reverse — only to read.

## Route

```sh
file -b app.dll; strings -a app.dll | rg -m3 'BSJB|mscoree|System\.Runtime'
dotnet tool install -g ilspycmd      # once
ilspycmd -p -o $D/src app.dll && find $D/src -name '*.cs' | head -30
```
- `-p` = project output (one folder per assembly, with `.csproj`).
- Single type: `ilspycmd -t Namespace.Class app.dll`.
- Type list only: `ilspycmd -l c app.dll | head -60`.

Windows alternatives: dnSpy (debug + edit), dotPeek, ILSpy GUI.

## What to grep in the decompiled tree

```sh
rg -n 'DllImport|Process\.Start|Registry|HttpClient|WebClient|File\.(Write|Read)All|Assembly\.Load|Activator\.CreateInstance|Decrypt|Aes|RSA|Convert\.FromBase64String' $D/src | head -50
rg -n 'InternalsVisibleTo|Obfuscation(Exclude|Feature' $D/src | head
```
- `DllImport` = native calls: note the DLL and the entry point, then route that DLL through `argus ref native-pe`.
- `Assembly.Load(byte[])` = a payload in a resource: look for `.resources` with a base64 or compressed blob.
- Reflection + string encryption together usually means an obfuscator (ConfuserEx, .NET Reactor): names become `A.b.c`.

## Metadata facts without decompiling

```sh
strings -a app.dll | rg -i 'AssemblyVersion|AssemblyFileVersion|TargetFramework|\.NETCoreApp' | head -10
monodis --assembly app.dll | head -20            # if Mono tools are installed
```
`TargetFrameworkAttribute` tells you whether it is .NET Framework 4.x or .NET 6/8/9 — which decides whether `System.Text.Json` or `Newtonsoft.Json` appears, and whether the app can be run with a modern runtime.

## NativeAOT / ReadyToRun / single-file

Signs: `System.Private.CoreLib` strings present, **no** `mscoree.dll` import, and a much larger file. Then IL is gone:
```sh
strings -a app.exe | rg -m3 'System\.Private\.CoreLib|ILCompiler|ReadyToRun'
```
Treat it as a native binary: `argus ref native-pe` for the imports, `argus ref disassembly` for logic. Method names may still appear in the R2R fixup tables or in exception strings.

## Obfuscated assemblies

1. Check `strings` for the obfuscator's marker (`ConfusedByAttribute`, `ObfuscatedByGoliath`, `.NET Reactor`).
2. Run `de4dot` (if available) to strip string encryption and rename symbols, then decompile again.
3. If it is not available, decompile with ilspycmd anyway: control flow is mangled, string literals survive in many cases, and the external calls (P/Invoke, network) are still readable.

## Traps

- Unity games are .NET but the interesting code is IL2CPP-native (`GameAssembly.dll`) — check for `global-metadata.dat` next to it and switch to `argus ref unity-il2cpp`.
- `ilspycmd` fails on mixed-mode assemblies (C++/CLI); use `dumpbin /clrheader` to detect and then treat the native half normally.
- An assembly can be a *launcher*: `Main` calls `Assembly.Load` on an embedded resource. Decompile the launcher, extract the resource, decompile that — do not stop at the launcher.
