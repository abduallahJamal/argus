---
title: Go binaries — buildinfo, modules, symbol recovery
when: target contains "Go buildinf:", or a Go-built CLI/server is the subject
keywords: [go, golang, buildinfo, module, gopclntab, dependency, gh]
---

# Go

A Go binary carries its own manifest. `go version -m` is usually the entire answer, and it works on stripped binaries.

## One call

```sh
go version -m ./gh | head -40
```
Output shape (memorise it, because you will be asked for exactly these fields):
```
./gh: go1.27.1
	path	github.com/cli/cli/v2/cmd/gh
	mod	github.com/cli/cli/v2	v2.80.0
	dep	github.com/cli/go-gh/v2	v2.16.1	h1:...
	build	-buildmode=exe
	build	-ldflags="-s -w"
	build	vcs.revision=...
	build	vcs.modified=false
```
- `go1.27.1` = toolchain; `path` = main package; `mod` = the module and version; `dep` lines = the dependency graph with versions.
- `-ldflags="-s -w"` explains missing symbols (but not missing buildinfo).
- `vcs.revision` + `vcs.modified` = the exact commit, which is a stronger identifier than any hash.

## No Go toolchain? Parse the section

```sh
strings -a T | rg -m1 -A200 'Go buildinf:' | head -40
readelf -x .go.buildinfo T 2>/dev/null | head -20
```
The buildinfo blob is `\xff Go buildinf:` + pointer size + flags, followed by either a pointer pair to (version string, modinfo) or the strings inline (newer Go). A 20-line python script that follows the pointer offset prints the same table; `strings` alone already gives `go1.x.y` and the module list.

## Symbols survive stripping

Go keeps `gopclntab`, which maps PCs to function names:

```sh
go tool nm ./gh 2>/dev/null | rg 'main\.' | head -60
go tool nm -size ./gh | sort -k2 -nr | head -20         # biggest functions = interesting ones
strings -a ./gh | rg -o 'main\.[A-Za-z0-9_.]+' | sort -u | head -60      # no toolchain needed
```

Package paths are a feature map: `internal/ghrepo`, `pkg/cmd/pr/create`, `internal/keyring`. Grep the module list for the domain you were asked about, then find a function with that prefix.

## Reading a function

```sh
go tool objdump -s 'main\.targetFn' ./gh | head -80
objdump -d --no-show-raw-insn ./gh > $D/dis.txt; rg -n 'main\.targetFn' $D/dis.txt | head
```

Go calling convention: arguments and results in registers (ABIInternal), stack growth checks at function entry (`CMPQ SP, 16(R14)`), and `runtime.morestack` prologues. Goroutine and channel calls show up as `runtime.chanrecv`, `runtime.newproc`.

## Traps

- `-buildmode=pie` and `-trimpath` change paths but not the module list.
- Vendored builds show `mod` entries with `=> ./vendor/...` replacement lines: the version you report must be the replacement, not the original.
- CGO binaries are hybrids: the Go manifest tells you the Go half, `readelf -dW | rg NEEDED` gives the C half.
- A binary can embed a *second* Go binary (a helper). Two `Go buildinf:` hits means two programs; say which one you analysed.
