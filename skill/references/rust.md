---
title: Rust binaries — auditable deps, toolchain, panic strings
when: target contains ".dep-v0" or "/rustc/", or a Rust CLI/server is the subject
keywords: [rust, cargo, auditable, dep-v0, rustc, crates, panic]
---

# Rust

Rust release builds are stripped by default, but three cheap signals survive: the toolchain commit, the crate list (if cargo-auditable was used), and panic location strings.

## One-call inventory

```sh
T=./bin
strings -a "$T" | rg -o '/rustc/[0-9a-f]{40}' | sort -u | head -3      # exact compiler commit
strings -a "$T" | rg -o '[a-z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/src' | sort -u | head -40   # crate paths from debug info
strings -a "$T" | rg -o 'cargo/registry/src/[^/]+/([a-z0-9_-]+-[0-9][^/]*)' | sort -u | head -40
```

## Dependency SBOM (cargo-auditable)

```sh
cargo audit bin "$T" | head -60
```
If that reports "no dependency information", the build did not use `-C link-arg=-Wl,--build-id` + `cargo auditable build`. Then extract the section yourself:

```sh
readelf -SW "$T" | rg 'dep-v0'                # section name: .dep-v0
objcopy --dump-section .dep-v0=$D/dep.bin "$T"
python3 - <<'PY'
import zlib, json
d = open('$D/dep.bin','rb').read()
print(d[:8])                       # \x00dep-v0 + version
print(json.dumps(json.loads(zlib.decompress(d[8:])), indent=1)[:1500])
PY
```
macOS: the section is `__DATA,__dep`.

## Panic strings are a source map

```sh
strings -a "$T" | rg 'panicked at|src/[a-z0-9_/]+\.rs:[0-9]+' | head -40
```
`panicked at src/server/lock.rs:214` gives file and line for the code path that can fail. Sorted and deduped, it reconstructs the project layout, and any module name is a search key in the crate list.

## Symbols

```sh
nm "$T" 2>/dev/null | rg '_ZN' | head -20
cargo install rustfilt 2>/dev/null; nm "$T" | awk '{print $NF}' | rustfilt | head -40
```
Legacy mangling (`_ZN...17h<hash>E`) is readable by hand: `_ZN6myapp5store3get17h...E` = `myapp::store::get`. New v0 mangling (`_R...`) needs `rustfilt` or `rustc-demangle`.

## Traps

- `strip = true` in the release profile removes symbols but not panic strings, and not `.dep-v0` if auditable was used.
- Rust binaries link statically by default: `readelf -dW | rg NEEDED` may show only `libc`/`libgcc`, which tells you nothing about crypto or TLS — look for crate names instead (`ring`, `rustls`, `openssl-sys`).
- Async code is state-machine soup. Find the `async fn` name first (`rg 'poll'` around it) before reading anything.
- Two `.dep-v0` sections (or `.comment` with two rustc hashes) = a linked staticlib. Report each crate set separately.
