---
title: Reading disassembly — x86-64 and ARM64 without burning context
when: you need actual code logic: a protocol, a check, a string transform, a key derivation
keywords: [disassembly, arm64, x86, ghidra, radare, decompile, xref, function]
---

# Reading code

Disassembly is the most expensive form of evidence. Exhaust the cheap layers first: strings, imports, symbol names, the call graph, then one function.

## Get the dump once

```sh
# pick one, write it to disk, then only ever grep the file
otool -tV T > $D/dis.txt                      # Mach-O
objdump -d --no-show-raw-insn -C T > $D/dis.txt   # ELF
llvm-objdump -d --no-show-raw-insn -C T > $D/dis.txt   # any, demangles
objdump -d -M intel T.exe > $D/dis.txt        # PE
wc -l $D/dis.txt
```

## Find the function

```sh
rg -n '^_?[A-Za-z][A-Za-z0-9_$.:<>,-]*:$' $D/dis.txt | head -120     # labelled functions
rg -n 'literal pool for: "NEEDLE"' $D/dis.txt                         # Mach-O: string → address
rg -n 'NEEDLE' $D/dis.txt                                             # ELF/PE: string in .rodata + its xref
```
For a string found in `.rodata`, the xref is an instruction whose immediate is that address: `lea rdi,[rip+0x1234]` (x86-64) or `adrp x0, ...; add x0, x0, #...` (ARM64). Read the few instructions before it inside the same function to see the whole call setup.

## Read the call sequence, not every instruction

```sh
awk '/^_targetFunc:$/{p=1;next} p&&/^[_A-Za-z].*:$/{exit} p' $D/dis.txt | rg 'bl|call|literal|cmp' | head -60
```
A sequence such as `geteuid → snprintf → socket → bind → listen` already tells you: a per-user unix socket server. You do not need the arithmetic.

## Recognise the shape

| Pattern | Meaning |
|---|---|
| `cmp`/`cbz` right after a call | error check or nil check; the interesting branch is the other one |
| `getpeereid` / `SO_PEERCRED` | peer credential check: the server authenticates the caller by uid/gid |
| `read` into a buffer, then a 4-byte field used as a length | length-prefixed framing |
| `snprintf("%s.%u.%s", path, geteuid(), hash)` | the socket path format, answered exactly |
| `CCKeyDerivationPBKDF` / `EVP_KDF` / `PKCS5_PBKDF2` | key derivation with visible iteration count |
| `SecItemCopyMatching`, `CryptUnprotectData` | OS keystore access: the value is not in the binary |
| `json_parse` / `NSJSONSerialization` / `serde_json` | the wire format is JSON; look for the field names |
| `IsDebuggerPresent`, `ptrace(PT_DENY_ATTACH)` | anti-analysis: expect early exits under a debugger |

## Decompile only when you must

```sh
r2 -qc 'aaa; afl~target; pdc @ sym._target' T | head -120          # fast, crude pseudocode
analyzeHeadless $D gh -import T -postScript DecompileAll.java      # Ghidra: the real thing
```
Both are slow on big binaries. Use them for one function, with the address already known from `nm`/xrefs.

## Traps

- Do not trust "the function" boundary in optimised code: inlining and tail calls mean one label can contain three logical functions, and a second copy exists elsewhere.
- Compiler-generated noise (`__stack_chk_fail`, `swift_retain`, `_objc_release`, `std::__1`) dominates the line count. Filter it out before reading.
- Offsets change between builds. Cite the symbol name plus the surrounding string/call, not a raw offset, when you want the finding to survive a version bump.
- Static reading is not observed execution: if the answer depends on a runtime value (a token, a downloaded config), say `unknown` and name the hook that would prove it.
