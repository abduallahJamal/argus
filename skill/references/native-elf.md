---
title: ELF — sections, symbols, libs, hardening
when: the target is an ELF, a .so, a Linux/Android native binary, or a firmware binary
keywords: [elf, readelf, objdump, so, linux, android, checksec, symbols, plt]
---

# ELF

`readelf` answers more per byte than any disassembler. Symbol recovery is routine even on "stripped" binaries: `.dynsym`, `.gnu.hash`, and language runtimes keep names.

## One-call inventory

```sh
T=./bin
file -b "$T"; readelf -hW "$T" | rg 'Class|Type|Machine|Entry'
echo '--- NEEDED'; readelf -dW "$T" | rg NEEDED | head -30
echo '--- SECTIONS'; readelf -SW "$T" | rg -i 'debug|symtab|comment|note|dep|buildinfo|gopclntab' | head -20
echo '--- EXPORTS'; nm -D --defined-only "$T" 2>/dev/null | head -120
echo '--- STRINGS'; strings -a -n 6 "$T" | rg -v '^\.' | head -300
```

`Type: EXEC` = fixed-address, `DYN` = PIE or a shared object (check `readelf -dW | rg SONAME`), `REL` = relocatable object (a piece, not an app).

## Imports and dynamic linking

```sh
readelf -Ws "$T" | rg 'UND' | awk '{print $8}' | sort -u | head -60
objdump -T "$T" | rg '\*UND\*' | head -40
readelf -rW "$T" | head -30          # relocations: which GOT slot binds to what
objdump -d -j .plt "$T" | head -40   # PLT = every libc/lib call the binary can make
```

`NEEDED` names (`libssl.so.3`, `libflutter.so`, `libil2cpp.so`, `libhermes.so`) often answer the whole question in one line — a Flutter app is not a Java app.

## Stripped binaries are not blind

```sh
readelf -SW "$T" | rg 'symtab|debug'        # absent on stripped builds
nm -D --defined-only "$T" | head            # dynamic symbols usually survive
readelf -Ws "$T" | rg -v 'UND' | head -40   # includes local symbols if present
```
- C++ names in `.dynsym` still show classes and namespaces; demangle with `objdump -C` or `c++filt`.
- Go/Rust keep function name tables (pclntab / panic strings): see `argus ref go` and `argus ref rust`.
- A `.gnu_debuglink` section names a separate debug file; if the vendor shipped it (`/usr/lib/debug/...`), you get everything back.

## Hardening, for context not for grading

```sh
readelf -lW "$T" | rg -A1 'GNU_STACK|GNU_RELRO'
readelf -dW "$T" | rg -i 'BIND_NOW'
readelf -hW "$T" | rg Type
checksec --file="$T" 2>/dev/null
```

## Disassemble once, grep forever

```sh
objdump -d --no-show-raw-insn -C "$T" > $TMPDIR/argus/dis.txt
wc -l $TMPDIR/argus/dis.txt
rg -n 'call.*<(geteuid|getpeereid|socket|connect|bind|listen|fork|execve|system|dlopen)' $TMPDIR/argus/dis.txt | head -40
rg -n 'lea\s+0x[0-9a-f]+\(%rip\)' $TMPDIR/argus/dis.txt | head -20     # string/global references
```
On x86-64 a string address is a `lea rXX, [rip+0x…]` whose target you can resolve from the section offsets in `readelf -SW`. On ARM64 it is `adrp`+`add`.

## Android `.so` specifics

- `lib/*/libapp.so` = Flutter (Dart AOT) → `argus ref flutter-dart`.
- `libhermes.so` + `libjsc.so` = React Native → `argus ref react-native`.
- `libil2cpp.so` + `global-metadata.dat` = Unity → `argus ref unity-il2cpp`.
- JNI entry points are named `Java_<package>_<Class>_<method>`; `nm -D | rg Java_` gives you the whole native bridge.

## Traps

- `readelf -S` on a huge firmware `.so` can be slow; `-W` (no wrapping) makes grep reliable, always use it.
- `objdump -d` output for a 100 MB library is gigabytes: always `--start-address`/`--stop-address` around the function you found in `nm`, or grep the dump from disk.
- `file` says "ELF 32-bit MSB" on big-endian MIPS firmware; endianness changes how you read every immediate.
