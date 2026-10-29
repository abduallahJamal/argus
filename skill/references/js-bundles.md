---
title: Minified JS, source maps, and deobfuscation
when: the target is a web/app JS bundle, minified or obfuscated, or a source map
keywords: [javascript, webpack, vite, minified, sourcemap, prettier, obfuscator, bundle]
---

# JS bundles

A bundle is a graph plus a length. Offset arithmetic in it is a waste of turns; there are four things that actually work, in this order.

## 1. Source map (best case)

```sh
F=./bundle.js
rg -uu -o 'sourceMappingURL=[^ "'"'"']+' "$F" | head -3
tail -c 300 "$F"
```

- If the map is inline (`data:application/json;base64,…`), decode it: `rg -o 'base64,(.*)' -r '$1' F | base64 -d > map.json`.
- If the map has `sourcesContent`, you have the original files and there is nothing left to reverse:
  ```sh
  jq -r '.sources | length' map.json
  jq -r '.sourcesContent[]' map.json | rg -n 'NEEDLE' -C2 | head -40
  jq -r '[.sources, .sourcesContent] | transpose[] | @tsv' map.json | rg 'NEEDLE' | head
  ```
- Without `sourcesContent` you still get `sources` (paths = module names) and `mappings`; a mapping decode is worth it only if you must name a function.

## 2. Prettify once, then cite line numbers

```sh
npx -y prettier --parser babel "$F" > $TMPDIR/argus/pretty.js
wc -l $TMPDIR/argus/pretty.js
```
Now every finding has a stable `file:line`. Never prettify twice (it changes line numbers if the tool version changes) and never read the pretty file top to bottom.

## 3. Slice the needle

```sh
rg -uu -o '.{0,250}NEEDLE.{0,250}' "$F" | head -20
rg -uu -c 'NEEDLE' "$F"                    # count first: 400 hits means a worse needle
rg -uu -o '\w{2,30}\.NEEDLE\b' "$F" | sort -u | head   # who calls it
```

Good needles: a user-visible string from the UI, an API path, an IPC channel, an error message, a storage key. Bad needles: `function`, `this`, `data`.

## 4. Module graph (webpack / vite / esbuild)

```sh
rg -uu -o '[0-9]{2,5}:\s*\(?[a-z, ]*\)?\s*=>\s*\{' "$F" | head -40        # webpack module ids
rg -uu -o '__webpack_require__\(\s*[0-9]+' "$F" | sort | uniq -c | sort -rn | head
rg -uu -o 'webpackChunk[A-Za-z0-9_]*' "$F" | sort -u
rg -uu -o 'import\("[^"]+"\)' "$F" | sort -u | head -30                    # lazily loaded chunks
```
- Webpack production builds keep module ids but drop names. Vite/Rollup output is often readable-ish (`chunk-XXXX.js` + real variable names).
- A lazily imported chunk is where a rarely used feature lives; grep the chunk name in the HTML/manifest and fetch that file instead of the main bundle.

## Obfuscation (javascript-obfuscator, Jscrambler)

Signs: string arrays with a rotation function, `_0x1a2b[0x3](...)`, control-flow flattening with a `switch` on a counter, and a self-defending IIFE that breaks formatting.

Cheap wins, in order:
1. **Run it.** Load the page with Playwright and log requests, `localStorage`, and console output. Behaviour beats obfuscation for questions of the form "what does it send".
2. **Deobfuscate the string array only.** The array plus its decoder is self-contained: extract the array literal, call the decoder in Node, and you have plaintext strings even when the code is unreadable.
   ```sh
   node -e 'const s=require("fs").readFileSync("F","utf8");
     const m=s.match(/\[\s*("[^"]{3,}"|"[^"]{3,}"\s*,){20,}[^\]]*\]/);
     console.log(m ? m[0].slice(0,400) : "no string array")'
   ```
3. **sourcemap?** Some sites ship `.map` publicly for obfuscated code by mistake: try `F.map`, `F.js.map`, and `/sourcemaps/`.

## Traps

- `rg` skips hidden and ignored paths: use `-uu` inside extracted trees, and `--no-ignore` if there is a `.gitignore` in the tree.
- Escaped unicode in strings (`\x68\x74\x74\x70`) decodes to the needle you are missing. Try a second pass on `\\x[0-9a-f]{2}` runs.
- `eval(atob("…"))` payloads: decode the literal, do not trace the eval.
- Minified names collide (`e`, `t`, `n`). Always quote a 250-char slice, and reference the enclosing function name if you can find it once.
