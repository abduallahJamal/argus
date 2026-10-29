// argus/detect.mjs — route an artifact to a plan by magic bytes and structure.
// No dependencies. Reads at most `maxScan` bytes. Never executes the target.
import fs from "node:fs";
import path from "node:path";

const hex = (b, n = 16) => b.subarray(0, n).toString("hex").replace(/(..)/g, "$1 ").trim();
const ascii = (b, n = 32) =>
  b.subarray(0, n).toString("latin1").replace(/[^\x20-\x7e]/g, ".");

/** Byte signatures, checked in order. First match wins. */
const SIGNATURES = [
  { kind: "macho", label: "Mach-O (32-bit)", test: b => b.readUInt32BE(0) === 0xfeedface },
  { kind: "macho", label: "Mach-O (64-bit)", test: b => b.readUInt32BE(0) === 0xfeedfacf },
  { kind: "macho-fatal", label: "Mach-O universal", test: b => b.readUInt32BE(0) === 0xcafebabe || b.readUInt32BE(0) === 0xbebafeca },
  { kind: "elf", label: "ELF", test: b => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) },
  { kind: "pe", label: "PE / COFF", test: b => b[0] === 0x4d && b[1] === 0x5a },
  { kind: "wasm", label: "WebAssembly", test: b => b.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])) },
  { kind: "dex", label: "Dalvik DEX", test: b => b.subarray(0, 4).toString("latin1") === "dex\n" },
  { kind: "hermes", label: "Hermes bytecode (HBC)", test: b => isHermes(b) },
  { kind: "zip", label: "ZIP container", test: b => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) },
  { kind: "sqlite", label: "SQLite 3", test: b => b.subarray(0, 16).toString("latin1") === "SQLite format 3\u0000" },
  { kind: "plist-binary", label: "Apple binary plist", test: b => b.subarray(0, 8).toString("latin1") === "bplist00" },
  { kind: "pcapng", label: "pcapng", test: b => b.readUInt32LE(0) === 0x0a0d0d0a },
  { kind: "pcap", label: "pcap", test: b => [0xd4c3b2a1, 0xa1b2c3d4, 0x4d3cb2a1, 0xa1b23c4d].includes(b.readUInt32LE(0)) },
  { kind: "gzip", label: "gzip", test: b => b[0] === 0x1f && b[1] === 0x8b },
  { kind: "xz", label: "xz", test: b => b.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) },
  { kind: "zstd", label: "zstd", test: b => b.readUInt32LE(0) === 0xfd2fb528 },
  { kind: "bzip2", label: "bzip2", test: b => b.subarray(0, 3).toString("latin1") === "BZh" },
  { kind: "7z", label: "7-Zip", test: b => b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) },
  { kind: "rar", label: "RAR", test: b => b.subarray(0, 4).toString("latin1") === "Rar!" },
  { kind: "tar", label: "tar", test: b => b.subarray(257, 262).toString("latin1") === "ustar" },
  { kind: "dmg", label: "Apple disk image", test: b => b.subarray(0, 2).toString("latin1") === "koly" || b.readUInt32BE(0) === 0x78617221 },
  { kind: "unity-metadata", label: "Unity IL2CPP global-metadata", test: b => b.readUInt32LE(0) === 0xfab11baf },
  { kind: "pdf", label: "PDF", test: b => b.subarray(0, 4).toString("latin1") === "%PDF" },
  { kind: "png", label: "PNG", test: b => b.readUInt32BE(0) === 0x89504e47 },
  { kind: "jpeg", label: "JPEG", test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: "asar", label: "Electron asar", test: (b, p) => isAsar(b, p) },
  // text families are resolved later, from decoded content
];

function isHermes(b) {
  // HBC magic differs per version: accept 0xc61fbc03 (v1/2) and 0x1b c6 ... newer nets.
  const be = b.readUInt32BE(0);
  const le = b.readUInt32LE(0);
  return be === 0xc61fbc03 || le === 0xc61fbc03 || be === 0xc61fbc0c;
}

function isAsar(b, p) {
  if (p && p.endsWith(".asar")) return true;
  // 04 00 00 00 | headerSize | stringLen | {"files"
  return b.length > 20 && b.readUInt32LE(0) === 4 && b.subarray(12, 19).toString("latin1") === '{"files"';
}

function zipFlavor(buf, name) {
  const s = buf.toString("latin1");
  const has = needle => s.includes(needle);
  if (has("AndroidManifest.xml") && (has("classes.dex") || has("resources.arsc"))) return "apk";
  if (has("Payload/") && has(".app/")) {
    if (has(".app/Frameworks/Flutter.framework")) return "ipa-flutter";
    return "ipa";
  }
  if (has("META-INF/MANIFEST.MF") || has(".class")) {
    if (has("META-INF/maven/") || has(".jar")) return "jar";
    if (/\.class/.test(s)) return "jar";
  }
  if (has("AppRun") || has(".DirIcon") || name.endsWith(".AppImage")) return "appimage";
  if (has("usr/lib/") && has("debian-binary")) return "deb";
  return "zip";
}

const TEXT_MARKERS = [
  { kind: "web-bundle", weight: 3, re: /sourceMappingURL|__webpack_require__|webpackJsonp|\bparcelRequire\b/ },
  { kind: "web-bundle", weight: 2, re: /ipcMain\.(handle|on)|contextBridge\.exposeInMainWorld|webPreferences\s*:/ },
  { kind: "js-source", weight: 1, re: /^\s*(import|export)\s+[\w{*]/m },
  { kind: "html", weight: 3, re: /^\s*(<!doctype html|<html[\s>])/i },
  { kind: "xml-plist", weight: 3, re: /<\?xml[^>]*>\s*<!DOCTYPE plist|<plist[\s>]/ },
  { kind: "json", weight: 2, re: /^\s*[{[]\s*["}\]]/ },
  { kind: "shell", weight: 1, re: /^#!.*\b(bash|sh|zsh)\b/ },
  { kind: "python-source", weight: 1, re: /^#!.*python|^\s*(import|from)\s+\w+\s*(import|$)/m },
];

function looksBinary(buf) {
  let n = 0;
  const lim = Math.min(buf.length, 8192);
  for (let i = 0; i < lim; i++) if (buf[i] === 0) n++;
  return n > 0;
}

/** Deep markers: what a binary was built with, found by scanning its bytes. */
const BUILD_MARKERS = [
  { id: "go", re: Buffer.from("Go buildinf:"), label: "Go buildinfo", kind: "go" },
  { id: "rust-audit", re: Buffer.from("dep-v0"), label: "cargo-auditable (.dep-v0)", kind: "rust" },
  { id: "rustc-hash", re: Buffer.from("/rustc/"), label: "rustc commit path", kind: "rust" },
  { id: "dotnet", re: Buffer.from("BSJB"), label: ".NET metadata (BSJB)", kind: "dotnet" },
  { id: "mscoree", re: Buffer.from("mscoree.dll"), label: "CLR import (mscoree.dll)", kind: "dotnet" },
  { id: "flutter", re: Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]), label: "Dart AOT snapshot magic", kind: "flutter" },
  { id: "node-addon", re: Buffer.from("NODE_MODULE"), label: "N-API module init", kind: "node-addon" },
  { id: "unity-il2cpp", re: Buffer.from("il2cpp_init"), label: "IL2CPP runtime", kind: "unity" },
  { id: "pyinstaller", re: Buffer.from("MEI\x0c\x0b\x0a\x0b\x0e"), label: "PyInstaller cookie", kind: "pyinstaller" },
  { id: "upx", re: Buffer.from("UPX!"), label: "UPX packed section", kind: "packed" },
];

const SCAN_WHOLE_BELOW = 256 * 1024 * 1024; // scan the whole file under this size
const EDGE = 8 * 1024 * 1024;                // otherwise: head, tail, and the section table

/**
 * Ask the container where build metadata lives instead of scanning 50 MB of code.
 * Returns [{start, len}] regions worth reading, derived from the ELF section table or the
 * Mach-O segment commands. Unknown containers return [] and get the head/tail treatment.
 */
export function metadataRegions(file, kind) {
  const regions = [];
  const head = readHead(file, 64 * 1024);
  const b = head.buf;
  try {
    if (kind === "elf" || kind === "binary-unknown" || kind === "go" || kind === "rust" || kind === "flutter") {
      if (!(b[0] === 0x7f && b[1] === 0x45)) return regions;
      const is64 = b[4] === 2;
      const shoff = is64 ? Number(b.readBigUInt64LE(0x28)) : b.readUInt32LE(0x20);
      const shentsize = is64 ? b.readUInt16LE(0x3a) : b.readUInt16LE(0x2e);
      const shnum = is64 ? b.readUInt16LE(0x3c) : b.readUInt16LE(0x30);
      const shstrndx = is64 ? b.readUInt16LE(0x3e) : b.readUInt16LE(0x32);
      if (!shoff || !shnum || shnum > 4096) return regions;
      const table = readAt(file, shoff, shentsize * shnum);
      const strHdr = table.subarray(shstrndx * shentsize, (shstrndx + 1) * shentsize);
      const strOff = is64 ? Number(strHdr.readBigUInt64LE(0x18)) : strHdr.readUInt32LE(0x10);
      const strSize = is64 ? Number(strHdr.readBigUInt64LE(0x20)) : strHdr.readUInt32LE(0x14);
      if (!strOff || !strSize || strSize > 1 << 20) return regions;
      const strtab = readAt(file, strOff, strSize);
      for (let i = 0; i < shnum; i++) {
        const e = table.subarray(i * shentsize, (i + 1) * shentsize);
        if (e.length < (is64 ? 0x28 : 0x18)) continue;
        const nameOff = e.readUInt32LE(0);
        const name = readCStr(strtab, nameOff);
        if (!/buildinfo|dep-v0|note\.go|gopclntab/i.test(name)) continue;
        const off = is64 ? Number(e.readBigUInt64LE(0x18)) : e.readUInt32LE(0x10);
        const size = is64 ? Number(e.readBigUInt64LE(0x20)) : e.readUInt32LE(0x14);
        if (off > 0 && size > 0) regions.push({ start: off, len: Math.min(size + 64, 4 << 20), why: name });
      }
    } else if (kind === "macho" || kind === "macho-fatal") {
      const ncmds = b.readUInt32LE(16);
      let off = 32;
      for (let i = 0; i < ncmds && off + 8 <= b.length; i++) {
        const cmd = b.readUInt32LE(off);
        const cmdsize = b.readUInt32LE(off + 4);
        if (!cmdsize) break;
        if (cmd === 0x19) { // LC_SEGMENT_64
          const nsects = b.readUInt32LE(off + 64);
          for (let j = 0; j < nsects; j++) {
            const so = off + 72 + j * 80;
            if (so + 80 > b.length) break;
            const sect = readCStr(b.subarray(so, so + 16), 0);
            if (!/_go_buildinfo|__dep|__gopclntab/i.test(sect)) continue;
            const size = Number(b.readBigUInt64LE(so + 40));
            const offset = b.readUInt32LE(so + 48);
            if (offset && size) regions.push({ start: offset, len: Math.min(size + 64, 4 << 20), why: sect });
          }
        }
        off += cmdsize;
      }
    }
  } catch { /* a malformed header is not a reason to stop: fall back to head/tail */ }
  return regions;
}

function readAt(file, start, len) {
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  return buf;
}

function readCStr(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(off, end).toString("latin1");
}

export function readHead(file, n = 64 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(n, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return { buf, size };
  } finally {
    fs.closeSync(fd);
  }
}

export function scanMarkers(file, size, regions) {
  const found = [];
  const chunk = 1024 * 1024;
  const overlap = 64;
  const spans = regions && regions.length
    ? regions
    : size <= SCAN_WHOLE_BELOW
      ? [{ start: 0, len: size }]
      : [{ start: 0, len: EDGE }, { start: Math.max(0, size - EDGE), len: EDGE }];
  const fd = fs.openSync(file, "r");
  try {
    for (const span of spans) {
      const end = Math.min(size, span.start + span.len);
      let off = Math.max(0, span.start);
      let tail = Buffer.alloc(0);
      while (off < end) {
        const want = Math.min(chunk, end - off);
        if (want <= 0) break;
        const buf = Buffer.alloc(want);
        fs.readSync(fd, buf, 0, want, off);
        const hay = tail.length ? Buffer.concat([tail, buf]) : buf;
        const base = off - tail.length;
        for (const m of BUILD_MARKERS) {
          if (found.some(f => f.id === m.id)) continue;
          const i = hay.indexOf(m.re);
          if (i >= 0) found.push({ id: m.id, label: m.label, kind: m.kind || null, offset: base + i, region: span.why || null });
        }
        tail = buf.subarray(Math.max(0, buf.length - overlap));
        off += want;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return found;
}

/**
 * @param {string} file
 * @param {{deep?: boolean}} [opts]
 * @returns {{path:string,size:number,kind:string,label:string,subtype:string|null,
 *   confidence:"high"|"medium"|"low",evidence:object[],builds:object[],hints:string[]}}
 */
export function detect(file, opts = {}) {
  const abs = path.resolve(file);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    return detectDirectory(abs, st);
  }
  const { buf, size } = readHead(abs);
  const evidence = [];
  const hints = [];
  let kind = null;
  let label = "unknown";
  let subtype = null;
  let confidence = "low";

  for (const sig of SIGNATURES) {
    let ok = false;
    try { ok = buf.length >= 8 && sig.test(buf, abs); } catch { ok = false; }
    if (ok) {
      kind = sig.kind;
      label = sig.label;
      confidence = "high";
      evidence.push({ offset: 0, bytes: hex(buf, 12), ascii: ascii(buf, 12), note: `${sig.label} signature` });
      break;
    }
  }

  if (kind === "zip") {
    const edge = 8 * 1024 * 1024;
    const full = size <= 2 * edge
      ? readSlice(abs, size, 0, size)
      : Buffer.concat([readSlice(abs, size, 0, edge), readSlice(abs, size, size - edge, edge)]);
    subtype = zipFlavor(full, abs);
    if (subtype !== "zip") { kind = subtype; label = zipLabel(subtype); evidence.push({ offset: null, note: `zip entries match ${subtype}` }); }
  }

  if (kind === "pe") {
    // PE: read e_lfanew, confirm "PE\0\0", then look for CLR metadata.
    const lfanew = buf.readUInt32LE(0x3c);
    if (buf.length > lfanew + 4 && buf.subarray(lfanew, lfanew + 4).toString("latin1") === "PE\u0000\u0000") {
      confidence = "high";
      evidence.push({ offset: 0x3c, bytes: `e_lfanew=${lfanew}`, note: "PE header confirmed" });
    } else {
      confidence = "low";
      hints.push("MZ without PE header: could be a DOS stub, a .mod or a delphi binary");
    }
  }

  if (kind === "macho-fatal") {
    subtype = "fat";
    evidence.push({ offset: 0, bytes: hex(buf, 8), note: "universal binary; thin it before disassembling" });
  }

  if (kind === "plist-binary") subtype = "binary";
  if (kind === "macho" && abs.endsWith(".node")) { subtype = "node-addon"; hints.push(".node addon: start from N-API exports, not from main()"); }

  if (!kind) {
    if (looksBinary(buf)) {
      kind = "binary-unknown"; label = "unrecognised binary"; confidence = "low";
      evidence.push({ offset: 0, bytes: hex(buf, 16), ascii: ascii(buf, 16), note: "no known magic; header bytes above are the only evidence" });
    }
    else {
      const text = buf.toString("utf8");
      let best = { kind: "text", label: "text", weight: 0 };
      for (const m of TEXT_MARKERS) if (m.weight > best.weight && m.re.test(text)) best = m;
      kind = best.kind; label = best.kind; confidence = best.weight >= 2 ? "medium" : "low";
      if (kind === "web-bundle") {
        const lines = text.split("\n");
        const avg = text.length / Math.max(1, lines.length);
        hints.push(avg > 400 ? "minified (avg line > 400 chars): slice, never read whole" : "not minified: read with line ranges");
        evidence.push({ offset: null, note: `avg line length ${Math.round(avg)}` });
      }
    }
  }

  const regions = opts.deep === false ? [] : metadataRegions(abs, kind === "macho-fatal" ? "macho" : kind);
  const builds = opts.deep === false ? [] : scanMarkers(abs, size, regions);
  for (const b of builds) evidence.push({ offset: b.offset, note: b.label });

  // Refine with build markers.
  const has = id => builds.some(b => b.id === id);
  if ((kind === "elf" || kind === "macho" || kind === "pe" || kind === "binary-unknown")) {
    if (has("go")) { kind = "go"; label = "Go binary"; subtype = subtype || null; }
    else if (has("dotnet")) { kind = "dotnet"; label = ".NET assembly"; }
    else if (has("flutter")) { kind = "flutter"; label = "Flutter app (Dart AOT)"; }
    else if (has("pyinstaller")) { kind = "pyinstaller"; label = "PyInstaller bundle"; }
    else if (has("rust-audit") || has("rustc-hash")) { kind = "rust"; label = "Rust binary"; }
  }
  if (has("upx")) hints.push("UPX-packed: unpack with `upx -d` before any analysis; symbols are fake until then");
  if (kind === "unity-metadata") hints.push("pair with libil2cpp.so / UnityFramework, then Il2CppDumper");
  if (kind === "asar") hints.push("Electron app: also check app.asar.unpacked/ for .node addons");

  return {
    path: abs,
    size,
    kind,
    label,
    subtype,
    confidence,
    evidence: evidence.slice(0, 12),
    builds: builds.map(b => ({ id: b.id, label: b.label, offset: b.offset })),
    hints,
  };
}

function zipLabel(t) {
  return {
    apk: "Android APK", ipa: "iOS IPA", "ipa-flutter": "iOS IPA (Flutter)",
    jar: "JVM archive (jar/class)", appimage: "AppImage", deb: "Debian package", zip: "ZIP archive",
  }[t] || t;
}

function readSlice(file, size, start, len) {
  const n = Math.max(0, Math.min(len, size - start));
  const buf = Buffer.alloc(n);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buf, 0, n, start); } finally { fs.closeSync(fd); }
  return buf;
}

function detectDirectory(dir, st) {
  const entries = fs.readdirSync(dir);
  const hints = [];
  let kind = "directory";
  let subtype = null;
  let label = "directory";
  const has = (...p) => p.every(x => fs.existsSync(path.join(dir, ...x)));

  if (dir.endsWith(".app") || has("Contents", "Info.plist")) {
    kind = "mac-app"; label = "macOS app bundle"; subtype = "app";
    const res = path.join(dir, "Contents", "Resources");
    if (fs.existsSync(path.join(res, "app.asar"))) hints.push("Electron app: Contents/Resources/app.asar");
    if (fs.existsSync(path.join(res, "app.asar.unpacked"))) hints.push("native addons in app.asar.unpacked/");
  } else if (has("package.json") && (has("node_modules") || has("package-lock.json"))) {
    kind = "node-project"; label = "Node project";
  } else if (has("AndroidManifest.xml") || has("apktool.yml")) {
    kind = "apk-decoded"; label = "decoded APK tree";
  } else if (has("index.android.bundle") || has("assets", "index.android.bundle")) {
    kind = "react-native"; label = "React Native bundle tree";
  } else if (has("Payload")) {
    kind = "ipa"; label = "decoded IPA tree";
  }
  return {
    path: path.resolve(dir), size: st.size, kind, label, subtype, confidence: "medium",
    evidence: [{ offset: null, note: `directory with ${entries.length} entries` }],
    builds: [], hints,
  };
}

export { BUILD_MARKERS };
