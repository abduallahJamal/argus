---
title: PE / Windows — imports, resources, signature, .NET
when: the target is a .exe, .dll, .sys, .msi payload, or anything starting with MZ
keywords: [pe, windows, exe, dll, dumpbin, imports, resources, authenticode, dotnet]
---

# PE

## One-call inventory

```sh
T=./app.exe
file -b "$T"
objdump -x "$T" | rg -A40 'The Import Tables' | head -60
objdump -p "$T" | rg 'DLL Name|Time/Date|Subsystem|ImageBase|SizeOfImage' | head -20
strings -a -el "$T" | rg -i 'fileversion|productname|companyname|originalfilename' | head -10   # UTF-16 version block
strings -a "$T" | rg -i 'requestedExecutionLevel|\.pdb|\.rsrc' | head
```

On Windows replace with `dumpbin /headers`, `/imports`, `/exports`, `/disasm`. `llvm-readobj --coff-imports --coff-exports` works everywhere.

Imports worth grepping for:
`WSAStartup/socket/connect` (network), `RegOpenKey*` (persistence/config), `CreateFileW/WriteFile`, `CreateProcessW/ShellExecuteW` (execution), `Crypt*`/`BCrypt*` (crypto), `IsDebuggerPresent/CheckRemoteDebuggerPresent` (anti-analysis), `LoadLibrary/GetProcAddress` (dynamic resolution — hides the real imports).

## Resources: version, manifest, embedded payloads

```sh
wrestool -l "$T" | head -20
wrestool -x -t version "$T" | strings -a -el | head -20
readelf -x .rsrc "$T" 2>/dev/null | head        # raw view
powershell -c "(Get-Item '$T').VersionInfo | Format-List *"     # Windows
```
A manifest with `requestedExecutionLevel level="requireAdministrator"` explains the UAC prompt without any reversing. An oversized `.rsrc` often holds an embedded installer or a second binary — `binwalk` it.

## Signature

```sh
sigcheck -a "$T" | head -15                      # Sysinternals
powershell -c "Get-AuthenticodeSignature '$T' | fl"
osslsigncode verify -in "$T" | head -20
```
Unsigned + packed + a long `.rsrc` is a different answer than signed by a known publisher. Check before drawing conclusions.

## Is it .NET?

```sh
strings -a "$T" | rg -m3 'mscoree.dll|BSJB|System\.Runtime|mscorlib'
```
If yes, stop disassembling: IL decompiles almost perfectly → `argus ref dotnet`. `BSJB` is the metadata signature; `#~` and `#Strings` are the heaps.

NativeAOT / ReadyToRun hide this: you will see `System.Private.CoreLib` strings **and** no CLR import. Then it is a native binary, and the ELF/Mach-O-style plan applies with `objdump -d -M intel`.

## Compiler and language fingerprints

| Seen in strings/sections | Usually means |
|---|---|
| `Go buildinf:` | Go → `argus ref go` |
| `.dep-v0`, `/rustc/` | Rust → `argus ref rust` |
| `Qt5Core.dll`, `QMessageBox` | Qt C++ (RTTI names are gold) |
| `python3.dll`, `PyInstaller` | PyInstaller bundle → extract with pyinstxtractor |
| `Electron` + `.asar` | Electron → `argus ref electron` |
| `MSVCP140`, `std::` mangled | MSVC C++ (use `dumpbin /symbols` if not stripped) |
| `_CorExeMain` | .NET (old) |

## Disassembly

```sh
objdump -d -M intel "$T" > $TMPDIR/argus/dis.txt
rg -n 'call.*<(RegOpenKey|WSAStartup|CreateFile|InternetOpen|IsDebuggerPresent)' $TMPDIR/argus/dis.txt | head -30
```
x64 WinAPI calls: first four args in `rcx, rdx, r8, r9`, the rest on the stack. `WriteProcessMemory` + `VirtualAllocEx` + `CreateRemoteThread` in one function is injection, not compression.

## Traps

- `file` says `PE32+ executable (GUI) x86-64` even for a DLL renamed to `.exe`: check `IMAGE_FILE_DLL` in the characteristics.
- `.NET` assemblies are PE files too — many "reverse this exe" questions are answered entirely in IL.
- Kernel drivers (`.sys`) need `dumpbin /imports` plus the driver's IRP handlers; user-mode tricks do not apply.
- Self-extracting installers: `7z x app.exe` usually unpacks them; that is cheaper than reversing the stub.
