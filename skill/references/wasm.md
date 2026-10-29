---
title: WebAssembly — imports, exports, decompilation
when: the target starts with \0asm, is a .wasm module, or a web app loads a wasm blob
keywords: [wasm, webassembly, wat, wabt, wasm2wat, emscripten, wasm-decompile]
---

# WASM

The import/export table is the API surface, and it is readable in one command. Function bodies are stack machine code; `wasm-decompile` renders them as C-like pseudo-code that is usually good enough.

## Table first

```sh
wasm-objdump -x app.wasm | rg -A30 'Import\[' | head -40
wasm-objdump -x app.wasm | rg -A30 'Export\[' | head -40
wasm-objdump -x app.wasm | rg 'Custom|Name|producers' | head
```
- Imports named `env.*` are the JS↔wasm boundary; `wasi_snapshot_preview1.*` means a WASI runtime; `__wbindgen_*` means Rust + wasm-bindgen; `_embind_*`/`_emscripten_*` means Emscripten C/C++.
- The `name` custom section, if present, has real function names — check it before decompiling anything.
- The `producers` section names the original language and toolchain version.

## Decompile

```sh
wasm2wat app.wasm -o $D/app.wat && wc -l $D/app.wat
wasm-decompile app.wasm -o $D/app.dcmp && rg -n '^function ' $D/app.dcmp | head -40
rg -n -C3 'NEEDLE' $D/app.dcmp | head -40
```

## Data and strings

```sh
strings -a -n 6 app.wasm | head -120
wasm-objdump -x app.wasm | rg -A5 'Data\['
```
Error messages and URLs live in the data section as plain bytes. In minimal-runtime builds the JS glue is also a primary source: fetch the loader script, it declares every import.

Emscripten split output (`app.js` + `app.wasm`) is the easy case: the JS names every exported function and its signature.

## Recover the JS side

```sh
rg -n -o '.{0,100}(WebAssembly\.instantiate|\.exports\.\w+|wasmModule).{0,100}' bundle.js | head -40
```
That gives the call sites and the argument shapes, which is usually faster than reading wasm bodies.

## Traps

- Three valid binaries, one meaning: `.wasm` can be built by Emscripten, Rust, or AssemblyScript — the import names tell you which, and that decides how readable `wasm-decompile` output is.
- Without the `name` section, functions are numeric and `wasm-decompile` output is hard to navigate; start from exports and work backwards through `call` targets.
- WASM SIMD and bulk-memory instructions confuse older tooling: use a current WABT build.
