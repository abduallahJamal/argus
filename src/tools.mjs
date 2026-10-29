// argus/tools.mjs — tool registry: who exists, what it is for, how to get it, what to do without it.
import { execFileSync } from "node:child_process";

export const PLATFORM = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

/**
 * tier: core = needed for tier-1 inventory, alt = needed for deeper tiers, niche = rare targets
 * fallback: what to use when the tool is absent (never a dead end)
 */
export const TOOLS = [
  // --- universal / core
  { id: "file", bin: "file", tier: "core", why: "route by magic bytes", platforms: ["mac", "linux"], install: { mac: "brew install file", linux: "apt install file" }, fallback: "argus detect already reads magic bytes; `xxd -l 16 F` shows the header" },
  { id: "shasum", bin: "sha256sum", tier: "core", why: "identify a build by hash", platforms: ["linux"], install: { linux: "coreutils" }, fallback: "`shasum -a 256 F` on macOS, `certutil -hashfile F SHA256` on Windows" },
  { id: "strings", bin: "strings", tier: "core", why: "strings are the cheapest capability map", platforms: ["mac", "linux"], install: { mac: "xcode-select --install", linux: "apt install binutils" }, fallback: "`rg -a -o '[[:print:]]{6,}' F`, or python one-liner re.findall on the bytes" },
  { id: "rg", bin: "rg", tier: "core", why: "slicing bundles and extracted trees (respects .gitignore unless -uu)", platforms: ["mac", "linux", "win"], install: { mac: "brew install ripgrep", linux: "apt install ripgrep", win: "winget install BurntSushi.ripgrep.MSVC" }, fallback: "`grep -a` / `findstr`; slower but same shape" },
  { id: "jq", bin: "jq", tier: "core", why: "read package.json, source maps, HAR, plists-as-json", platforms: ["mac", "linux", "win"], install: { mac: "brew install jq", linux: "apt install jq", win: "winget install jqlang.jq" }, fallback: "`node -e 'console.log(JSON.stringify(require(\"./f.json\"),null,1))'`" },
  { id: "node", bin: "node", tier: "core", why: "run npx tools, parse JS, scripted extraction", platforms: ["mac", "linux", "win"], install: {}, fallback: "python3 for parsing; some npx tools have pip ports" },
  { id: "python3", bin: "python3", tier: "core", why: "pefile, macholib, capstone, frida bindings", platforms: ["mac", "linux"], install: { mac: "brew install python", linux: "apt install python3" }, fallback: "node + a pure-JS parser, or `xxd`-level manual parsing" },

  // --- native / Mach-O
  { id: "otool", bin: "otool", tier: "core", why: "Mach-O headers, libs, ObjC, inline string literals", platforms: ["mac"], install: { mac: "xcode-select --install" }, fallback: "Linux: `llvm-otool`/`llvm-objdump -p`; or parse with python macholib; `rabin2 -I`" },
  { id: "nm", bin: "nm", tier: "core", why: "exports (`-gU`) and imports (`-u`) = capability map", platforms: ["mac", "linux"], install: { mac: "xcode-select --install", linux: "binutils" }, fallback: "`objdump -T` / `readelf -Ws` / `llvm-nm`" },
  { id: "lipo", bin: "lipo", tier: "alt", why: "thin a universal binary to one arch", platforms: ["mac"], install: { mac: "xcode-select --install" }, fallback: "`llvm-lipo -thin arm64`" },
  { id: "dyld_info", bin: "dyld_info", tier: "alt", why: "exports/imports/chained fixups, faster than otool", platforms: ["mac"], install: { mac: "xcode-select --install" }, fallback: "`otool -L` + `nm -m`" },
  { id: "codesign", bin: "codesign", tier: "alt", why: "entitlements reveal sandbox, TCC and helper permissions", platforms: ["mac"], install: { mac: "xcode-select --install" }, fallback: "`otool -s __TEXT __entitlements` + `plutil`" },
  { id: "plutil", bin: "plutil", tier: "core", why: "plists: bundle id, URL schemes, privacy strings", platforms: ["mac"], install: { mac: "xcode-select --install" }, fallback: "`python3 -c 'import plistlib,sys;print(plistlib.load(open(sys.argv[1],\"rb\")))' F`" },

  // --- native / ELF & PE
  { id: "readelf", bin: "readelf", tier: "core", why: "ELF headers, NEEDED libs, sections, symbols", platforms: ["linux"], install: { linux: "binutils" }, fallback: "`llvm-readelf`, or `objdump -p`" },
  { id: "objdump", bin: "objdump", tier: "core", why: "disassembly without a decompiler (`-d -M intel`)", platforms: ["mac", "linux"], install: { mac: "brew install binutils", linux: "binutils" }, fallback: "`llvm-objdump -d --no-show-raw-insn -C`" },
  { id: "objcopy", bin: "objcopy", tier: "alt", why: "extract a section (e.g. .dep-v0, __DATA) to a file", platforms: ["mac", "linux"], install: { linux: "binutils" }, fallback: "`llvm-objcopy --dump-section .dep-v0=dep.bin F`" },
  { id: "checksec", bin: "checksec", tier: "alt", why: "NX/PIE/RELRO/canary in one line", platforms: ["linux"], install: { linux: "apt install checksec" }, fallback: "`readelf -hW\\|rg 'Type:'` + `readelf -lW\\|rg GNU_STACK`" },
  { id: "llvm-objdump", bin: "llvm-objdump", tier: "alt", why: "one disassembler for Mach-O, ELF and PE, demangles C++", platforms: ["mac", "linux"], install: { mac: "brew install llvm", linux: "apt install llvm" }, fallback: "`objdump` / `otool -tV`" },
  { id: "dumpbin", bin: "dumpbin", tier: "core", why: "PE headers, exports, imports on Windows", platforms: ["win"], install: { win: "Visual Studio Build Tools" }, fallback: "`objdump -x` from Git-Bash, or `llvm-readobj --coff-exports`" },
  { id: "sigcheck", bin: "sigcheck", tier: "alt", why: "PE signature, version resources, entropy", platforms: ["win"], install: { win: "sysinternals" }, fallback: "`powershell Get-AuthenticodeSignature`" },

  // --- decompilers / heavy
  { id: "ghidra", bin: "analyzeHeadless", tier: "alt", why: "pseudocode when disassembly is not enough", platforms: ["mac", "linux", "win"], install: { mac: "brew install --cask ghidra", linux: "apt install ghidra", win: "winget install NationalSecurityAgency.Ghidra" }, fallback: "`r2 -qc 'aaa; pdc @ sym.X' F` if radare2 exists, else read the call sequence" },
  { id: "r2", bin: "r2", tier: "alt", why: "fast function listing, xrefs, one-off decompile", platforms: ["mac", "linux", "win"], install: { mac: "brew install radare2", linux: "apt install radare2" }, fallback: "`objdump -d` + `nm`" },
  { id: "frida", bin: "frida", tier: "alt", why: "runtime hooks, arguments and return values at the boundary", platforms: ["mac", "linux", "win"], install: { mac: "pipx install frida-tools" }, fallback: "lldb breakpoints + `po`/`expr`; or `log stream` on macOS" },
  { id: "lldb", bin: "lldb", tier: "alt", why: "breakpoints and memory inspection on a live process", platforms: ["mac", "linux"], install: { mac: "xcode-select --install" }, fallback: "`gdb` (Linux), `cdb`/WinDbg (Windows)" },

  // --- JS / Electron
  { id: "asar", bin: "asar", tier: "alt", why: "extract app.asar without npm (npx also works)", platforms: ["mac", "linux", "win"], install: { mac: "npm i -g @electron/asar" }, fallback: "`npx -y @electron/asar extract app.asar X` (no install needed)" },
  { id: "prettier", bin: "prettier", tier: "alt", why: "pretty-print a minified bundle to line numbers", platforms: ["mac", "linux", "win"], install: {}, fallback: "`npx -y prettier --parser babel F > F.pretty.js`; or `node --experimental-strip-types`-free js-beautify" },
  { id: "sourcemap", bin: "source-map-resolve", tier: "niche", why: "map a bundle offset back to original file:line", platforms: ["mac", "linux", "win"], install: {}, fallback: "`jq -r '.sources[]' map` when `sourcesContent` is present (then no mapping needed)" },

  // --- language runtimes
  { id: "go", bin: "go", tier: "alt", why: "`go version -m` prints toolchain, module, deps, build flags", platforms: ["mac", "linux", "win"], install: { mac: "brew install go", linux: "apt install golang" }, fallback: "`strings -a F\\|rg -m1 -A200 'Go buildinf'`, or read .go.buildinfo with python" },
  { id: "cargo", bin: "cargo", tier: "alt", why: "`cargo audit bin` reads cargo-auditable deps", platforms: ["mac", "linux", "win"], install: { mac: "brew install cargo-audit" }, fallback: "dump .dep-v0 with objcopy and zlib-inflate it in python" },
  { id: "ilspycmd", bin: "ilspycmd", tier: "alt", why: ".NET decompilation to a buildable project", platforms: ["mac", "linux", "win"], install: { mac: "dotnet tool install -g ilspycmd" }, fallback: "`dnspy`/`dotPeek` (Windows), or `monodis`" },
  { id: "dotnet", bin: "dotnet", tier: "alt", why: "run ilspycmd, read assembly attributes", platforms: ["mac", "linux", "win"], install: { mac: "brew install dotnet" }, fallback: "`strings F\\|rg 'System\\.|Version='` for a shallow answer" },
  { id: "java", bin: "java", tier: "alt", why: "run CFR / procyon / jadx jar builds", platforms: ["mac", "linux", "win"], install: { mac: "brew install openjdk" }, fallback: "`javap -p -c` from the JDK; `unzip -p F.class` + `strings`" },
  { id: "jadx", bin: "jadx", tier: "alt", why: "APK/DEX to Java", platforms: ["mac", "linux"], install: { mac: "brew install jadx", linux: "apt install jadx" }, fallback: "`jadx` jar via java, or `dex2jar` + `cfr`, or `baksmali`" },
  { id: "apktool", bin: "apktool", tier: "alt", why: "resources + manifest round-trip (jadx skips bad resources)", platforms: ["mac", "linux"], install: { mac: "brew install apktool" }, fallback: "`aapt2 dump badging` / `unzip -l` + `axml2xml`" },
  { id: "aapt2", bin: "aapt2", tier: "alt", why: "manifest facts in one line: package, version, permissions", platforms: ["mac", "linux"], install: { linux: "apt install aapt" }, fallback: "`apktool d --no-src` then read AndroidManifest.xml" },
  { id: "blutter", bin: "blutter", tier: "niche", why: "Dart AOT: recover class and function names from libapp.so", platforms: ["mac", "linux"], install: {}, fallback: "`strings libapp.so\\|rg 'package:'` + the snapshot hash route" },
  { id: "hermes-dec", bin: "hermes-dec", tier: "niche", why: "disassemble Hermes HBC bytecode (Android RN bundles)", platforms: ["mac", "linux"], install: {}, fallback: "`hbc-decompiler`, or runtime hooks with frida" },

  // --- files, containers, network
  { id: "binwalk", bin: "binwalk", tier: "alt", why: "find and extract embedded filesystems in firmware", platforms: ["mac", "linux"], install: { mac: "brew install binwalk", linux: "apt install binwalk" }, fallback: "`unblob -e X F` (better on modern formats), or `ent` + manual offsets" },
  { id: "unblob", bin: "unblob", tier: "alt", why: "safer firmware extraction than binwalk", platforms: ["linux"], install: { linux: "pipx install unblob" }, fallback: "`binwalk -e`" },
  { id: "7z", bin: "7z", tier: "core", why: "open every archive, including MSI, DMG, ISO", platforms: ["mac", "linux", "win"], install: { mac: "brew install sevenzip", linux: "apt install p7zip-full" }, fallback: "`unzip`/`tar`/`bsdtar -xf`" },
  { id: "unzip", bin: "unzip", tier: "core", why: "list APK/IPA/JAR entries before extracting", platforms: ["mac", "linux"], install: {}, fallback: "`python3 -m zipfile -l F`" },
  { id: "sqlite3", bin: "sqlite3", tier: "core", why: ".schema plus a few SELECTs answer most local-db questions", platforms: ["mac", "linux"], install: { mac: "brew install sqlite", linux: "apt install sqlite3" }, fallback: "`python3 -c 'import sqlite3...'`; always copy the db and the -wal file first" },
  { id: "tshark", bin: "tshark", tier: "alt", why: "protocol hierarchy, conversations, SNI/DNS in a pcap", platforms: ["mac", "linux"], install: { mac: "brew install --cask wireshark", linux: "apt install tshark" }, fallback: "`tcpdump -r C -nn` (no reassembly), or python scapy" },
  { id: "wasm2wat", bin: "wasm2wat", tier: "alt", why: "WAT text is readable; wasm-decompile gives C-like output", platforms: ["mac", "linux"], install: { mac: "brew install wabt", linux: "apt install wabt" }, fallback: "`wasm-objdump -x` for the section list, or `strings` for the import names" },
  { id: "assetutil", bin: "assetutil", tier: "niche", why: "enumerate Assets.car (icons, colours)", platforms: ["mac"], install: {}, fallback: "`acextract`/`cartool`, or `strings Assets.car`" },
  { id: "jpackage", bin: "jpackage", tier: "niche", why: "inspect .pkg payloads", platforms: ["mac"], install: {}, fallback: "`pkgutil --expand-full F.pkg X`" },
  { id: "upx", bin: "upx", tier: "niche", why: "unpack UPX-packed binaries before analysis", platforms: ["mac", "linux", "win"], install: { mac: "brew install upx", linux: "apt install upx-ucl" }, fallback: "no good fallback: report `packed` and stop, or unpack in a VM" },
  { id: "playwright", bin: "playwright", tier: "niche", why: "runtime behaviour of a website: requests, DOM, storage", platforms: ["mac", "linux", "win"], install: { mac: "npm i -g playwright && npx playwright install chromium" }, fallback: "Chrome `--remote-debugging-port` + a WS client" },
  { id: "pip", bin: "pip3", tier: "alt", why: "pefile, pyelftools, capstone, macholib, dnfile", platforms: ["mac", "linux"], install: {}, fallback: "node equivalents: `pe-library`, `elfy`, `capstone-js`" },
];

const cache = new Map();

/** Resolve a tool to {present, path, version}. Cached per process. */
export function resolveTool(id, tool = TOOLS.find(t => t.id === id)) {
  if (!tool) return { id, present: false, path: null, version: null };
  if (cache.has(id)) return cache.get(id);
  let out = { id, present: false, path: null, version: null };
  const probe = tool.bin;
  for (const cmd of ["which", "where"]) {
    try {
      const p = execFileSync(cmd, [probe], { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().split("\n")[0].trim();
      if (p) { out.present = true; out.path = p; break; }
    } catch { /* try next */ }
  }
  if (!out.present) {
    // `which` sometimes misses shell builtins or PATH-odd installers; ask the shell.
    try {
      const p = execFileSync(process.platform === "win32" ? "cmd" : "sh",
        process.platform === "win32" ? ["/c", `where ${probe}`] : ["-c", `command -v ${probe}`],
        { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().split("\n")[0].trim();
      if (p) { out.present = true; out.path = p; }
    } catch { /* genuinely absent */ }
  }
  if (out.present) {
    const flags = ["--version", "-version", "version", "-V"];
    for (const f of flags) {
      try {
        const v = execFileSync(tool.bin, [f], { stdio: ["ignore", "pipe", "ignore"], timeout: 4000 })
          .toString().split("\n")[0].trim();
        if (v) { out.version = v.slice(0, 80); break; }
      } catch { /* next flag */ }
    }
  }
  cache.set(id, out);
  return out;
}

export function installHint(tool) {
  const p = PLATFORM;
  if (!tool.platforms.includes(p)) return `not used on ${p}`;
  const line = tool.install?.[p];
  return line || "see the project's install docs";
}

/**
 * Rewrite `rg` invocations into equivalent GNU grep calls.
 * Portability beats purity: a step that cannot run because ripgrep is absent is a dead end.
 * Returns { cmd, rewrites } — rewrites is a human note for the evidence file.
 */
export function rewriteRg(cmd) {
  const SEG = /([\s\S]*?)(\|\||&&|;|\|(?![|])|&(?![&])|$)/g;
  const out = [];
  let rewrites = 0;
  for (const m of String(cmd).matchAll(SEG)) {
    const seg = m[1];
    const sep = m[2] || "";
    if (!seg.trim()) { out.push(seg + sep); continue; }
    if (!/^\s*rg\b/.test(seg)) { out.push(seg + sep); continue; }
    const toks = seg.trim().split(/\s+/).slice(1);
    const flags = new Set(["-a"]);
    const pos = [];
    let extended = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === "--glob" ) { const v = toks[++i] || ""; const name = v.replace(/^!/, "").replace(/^\*\*\//, "");
        if (v.startsWith("!")) flags.add(`--exclude-dir=${name.replace(/\/$/, "")}`); continue; }
      if (/^--glob=/.test(t)) continue;
      if (/^-[A-Za-z]+$/.test(t)) {
        for (const c of t.slice(1)) {
          if (c === "u") { flags.add("-r"); continue; }
          if (c === "o") { flags.add("-o"); extended = true; continue; }
          if (["n", "i", "v", "c", "l", "w", "s", "H"].includes(c)) { flags.add("-" + c); continue; }
          if (c === "E") { extended = true; continue; }
          if (c === "F") { flags.add("-F"); continue; }
          if (c === "A" || c === "B" || c === "C" || c === "m") { /* handled by the numeric token next */ }
        }
        continue;
      }
      if (/^-\d+$/.test(t)) { flags.add("-A" + t.slice(1)); continue; }
      if (["-A", "-B", "-C", "-m", "-g", "-e", "-t", "-j"].includes(t) && toks[i + 1] !== undefined) {
        out.push; flags.add(t); flags.add(toks[++i]); continue;
      }
      pos.push(t);
    }
    // alternation needs -E; GNU grep -o without -E is still valid but inconsistent with rg
    if (pos.length && /\|/.test(pos[0]) && !pos[0].includes("\\|")) extended = true;
    if (extended && !flags.has("-F")) flags.add("-E");
    const ordered = [...flags].filter(f => /^--/.test(f)).concat([...flags].filter(f => !/^--/.test(f)));
    out.push(`grep ${ordered.join(" ")} ${pos.join(" ")}`.trim() + sep);
    rewrites++;
  }
  return { cmd: out.join(""), rewrites };
}

/**
 * Which binaries a shell command needs that are not on this machine.
 * Only registry tools are checked, so an unknown binary is never a false alarm.
 */
export function findMissingBins(cmd) {
  const words = new Set(String(cmd).split(/[\s|;&()<>]+/).map(w => w.replace(/^.*\//, "")));
  const missing = [];
  for (const t of TOOLS) {
    if (!words.has(t.bin)) continue;
    const r = resolveTool(t.id, t);
    if (!r.present) missing.push({ id: t.id, bin: t.bin, fallback: t.fallback });
  }
  return missing;
}
