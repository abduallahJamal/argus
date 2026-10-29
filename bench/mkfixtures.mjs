// argus/bench/mkfixtures.mjs — synthetic fixtures so detection and routing are testable offline.
// Every file here is generated: no downloads, no third-party code, safe to commit-run in CI.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const w = (name, buf) => { fs.writeFileSync(path.join(DIR, name), buf); return name; };
const B = (...xs) => Buffer.concat(xs.map(x => (Buffer.isBuffer(x) ? x : Buffer.from(x))));

// ---- minimal zip writer (stored, no compression) -------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameB = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameB, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

// ---- binary builders -----------------------------------------------------
const macho64 = (extra = Buffer.alloc(0)) => {
  const h = Buffer.alloc(32);
  h.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64 (little-endian on arm64 & x86_64)
  h.writeUInt32LE(0x0100000c, 4); // arm64
  h.writeUInt32LE(2, 12);
  return B(h, extra, Buffer.alloc(64));
};

const pe = (extra = Buffer.alloc(0), clr = false) => {
  const buf = Buffer.alloc(0x400);
  buf.write("MZ", 0, "latin1");
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write("PE\u0000\u0000", 0x80, "latin1");
  buf.writeUInt16LE(0x8664, 0x84);
  if (clr) buf.write("mscoree.dll\u0000\x00BSJB\u0000", 0x100, "latin1");
  return B(buf, extra);
};

const elf = (extra = Buffer.alloc(0)) => {
  const h = Buffer.alloc(0x120);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(h, 0);
  h[4] = 2; h[5] = 1; h[6] = 1;
  h.writeUInt16LE(2, 16); // ET_EXEC
  h.writeUInt16LE(0x3e, 18); // x86-64
  return B(h, extra, Buffer.alloc(128));
};

const goBuildinfo = () => B([0xff, 0xff, 0xff, 0xff, 0x00, 0x00], "\ufffd Go buildinf:\x08\x00", "libc\0go1.27.1\0path\tgithub.com/cli/cli/v2/cmd/gh\0mod\tgithub.com/cli/cli/v2\tv2.80.0\0");
const zipapk = () => zip({
  "AndroidManifest.xml": "<manifest package=\"com.example.app\"/>",
  "classes.dex": B("dex\n035\u0000", Buffer.alloc(96)),
  "resources.arsc": Buffer.alloc(32),
  "lib/arm64-v8a/libflutter.so": Buffer.alloc(64),
  "lib/arm64-v8a/libapp.so": B(Buffer.alloc(64), Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]), Buffer.alloc(40, 7)),
});
const zipipa = () => zip({
  "Payload/Demo.app/Info.plist": Buffer.concat([Buffer.from("bplist00"), Buffer.alloc(64)]),
  "Payload/Demo.app/Demo": macho64(),
  "Payload/Demo.app/Frameworks/Flutter.framework/Flutter": Buffer.alloc(48),
});
const zipjar = () => zip({
  "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\nMain-Class: com.example.Main\r\n\r\n",
  "com/example/Main.class": B([0xca, 0xfe, 0xba, 0xbe], Buffer.alloc(96)),
});
const asar = () => {
  const header = '{"files":{"main.js":{"size":12,"offset":"0"}}}';
  const pickle = Buffer.alloc(4);
  pickle.writeUInt32LE(header.length, 0);
  const payload = B(pickle, header);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(payload.length, 4);
  return B(sizes, payload, Buffer.from("console.log(1)"));
};

const fixtures = {};
const expect = {};
const add = (name, buf, kinds, note) => {
  fixtures[name] = w(name, buf);
  expect[name] = { kind: kinds, note };
};

add("demo.elf", elf(Buffer.from("\u0000geteuid\u0000getpeereid\u0000/tmp/demo.sock\u0000")), "elf", "ELF executable");
add("demo-go.elf", elf(goBuildinfo()), "go", "ELF with Go buildinfo");
add("demo-rust.elf", elf(Buffer.from("\u0000/rustc/9fda7ceec16ce1b2cb8e00d7b4d9e2e0b1f0a2c3\u0000demo-0.1.0/src/main.rs\u0000dep-v0\u0000")), "rust", "ELF with rustc path + dep-v0");
add("demo.node", macho64(Buffer.from("\u0000napi_define_class\u0000isWindowOccluded\u0000NODE_MODULE\u0000")), ["macho", "node-addon"], "Mach-O node addon");
add("Demo.dylib", macho64(), "macho", "Mach-O dylib");
add("demo.exe", pe(), "pe", "PE executable");
add("demo-dotnet.exe", pe(Buffer.alloc(0), true), "dotnet", "PE with .NET metadata");
add("app.asar", asar(), "asar", "electron asar");
add("app.apk", zipapk(), "apk", "zip with manifest + dex + flutter libs");
add("demo.ipa", zipipa(), ["ipa", "ipa-flutter"], "zip with Payload/*.app");
add("demo.jar", zipjar(), "jar", "zip with manifest + class");
add("index.android.bundle", B([0xc6, 0x1f, 0xbc, 0x03], Buffer.alloc(120, 0x11)), "hermes", "Hermes HBC header");
add("app.wasm", B([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], Buffer.alloc(32)), "wasm", "wasm magic");
add("global-metadata.dat", B([0xaf, 0x1b, 0xb1, 0xfa], Buffer.alloc(96)), "unity-metadata", "IL2CPP metadata magic");
add("state.sqlite", B("SQLite format 3\u0000", Buffer.alloc(200)), "sqlite", "sqlite header");
add("Info.plist", B("bplist00", Buffer.alloc(64)), "plist-binary", "binary plist");
add("capture.pcap", B([0xd4, 0xc3, 0xb2, 0xa1], Buffer.alloc(60)), "pcap", "pcap global header");
add("bundle.js", Buffer.from(
  "!function(e){var t={};function n(r){if(t[r])return t[r].exports;var o=t[r]={i:r,l:!1,exports:{}};" +
  "ipcMain.handle(\"app:start-detection\",()=>{});contextBridge.exposeInMainWorld(\"api\",{});" +
  "//# sourceMappingURL=bundle.js.map\n"), "web-bundle", "minified bundle with IPC + sourcemap");
add("blob.bin", Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) & 0xff)), "binary-unknown", "high-entropy unrecognised blob");
add("archive.gz", zlib.gzipSync(Buffer.from("plain payload")), "gzip", "gzip stream");

// ---- benchmark targets: small, realistic, and owned by this repo ----------
// These exist so the benchmark harness can be run and graded without downloading anything.
const BENCH = path.join(DIR, "bench");
fs.mkdirSync(BENCH, { recursive: true });

const mainJs = `const { app, ipcMain, BrowserWindow } = require("electron");
const macUtils = require("./mac_utils.node");

class AudioController {
  constructor() { this.timer = null; this.mode = "poll"; }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const procs = macUtils.getRunningInputAudioProcesses();
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send("demo:detect:changed-v2", procs);
      }
    }, 2000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

const controller = new AudioController();
ipcMain.handle("demo:detect:start", () => { controller.start(); return { ok: true, mode: "poll" }; });
ipcMain.handle("demo:detect:stop", () => { controller.stop(); return { ok: true }; });
app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { preload: require("path").join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } });
  win.loadFile("renderer.html");
});
`;

const preloadJs = `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("demoApi", {
  start: () => ipcRenderer.invoke("demo:detect:start"),
  stop: () => ipcRenderer.invoke("demo:detect:stop"),
  onChanged: (cb) => ipcRenderer.on("demo:detect:changed-v2", (_e, v) => cb(v)),
});
`;

const rendererJs = `(function(){var t=window.demoApi;var b=document.getElementById("toggle");var s=document.getElementById("state");b.addEventListener("click",function(){t.start().then(function(){s.textContent="on"})});t.onChanged(function(v){s.textContent=v.length+" apps"});})();`;

const benchAsar = (() => {
  const header = JSON.stringify({
    files: {
      "package.json": { size: 68, offset: "0" },
      "main.js": { size: mainJs.length, offset: String(68) },
      "preload.js": { size: preloadJs.length, offset: String(68 + mainJs.length) },
      "renderer.min.js": { size: rendererJs.length, offset: String(68 + mainJs.length + preloadJs.length) },
    },
  });
  const pkg = JSON.stringify({ name: "demo-desktop", version: "1.2.3", main: "main.js" }).padEnd(68, " ");
  const body = Buffer.from(pkg + mainJs + preloadJs + rendererJs);
  const pickle = Buffer.alloc(4);
  pickle.writeUInt32LE(header.length, 0);
  const payload = B(pickle, header);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(payload.length, 4);
  return B(sizes, payload, body);
})();
w("bench/electron-demo.asar", benchAsar);

// A native addon stub: real Mach-O header, with the strings that matter for the answer key.
w("bench/mac_utils.node", macho64(Buffer.from(
  "\u0000napi_define_class\u0000napi_create_function\u0000getRunningInputAudioProcesses\u0000" +
  "getProcessesAccessingSpeakersWithResult\u0000isSchemeHandlerPresent\u0000TCCAccessPreflight\u0000" +
  "kTCCServiceAudioCapture\u0000getpeereid\u0000/tmp/demo.singleinstance.\u0000NODE_MODULE\u0000")));

const benchBundle = Buffer.from(
  "!function(e){function t(n){return e[n]}var r={endpoint:\"/api/v2/meetings?limit=50\",tokenKey:\"demo.session.token\"," +
  "flag:\"enable-meeting-detection\",cdn:\"https://cdn.demo.example/assets/v3/\"};" +
  "function n(){var o=window.localStorage.getItem(r.tokenKey);return fetch(r.endpoint,{headers:{authorization:\"Bearer \"+o}})}" +
  "function i(){return window.__DEMO_FLAGS__&&window.__DEMO_FLAGS__[r.flag]===!0}" +
  "window.demoClient={load:n,meetingsEnabled:i,config:r};}({});" +
  "//# sourceMappingURL=bench-bundle.js.map\n");
w("bench/bench-bundle.js", benchBundle);

expect["bench/electron-demo.asar"] = { kind: "asar", note: "benchmark target: synthetic Electron app" };
expect["bench/mac_utils.node"] = { kind: ["macho", "node-addon"], note: "benchmark target: native addon stub" };
expect["bench/bench-bundle.js"] = { kind: "web-bundle", note: "benchmark target: minified bundle" };

fs.writeFileSync(path.join(DIR, "expected.json"), JSON.stringify(expect, null, 1));

// Optional: a real native binary compiled on this host (ELF on Linux, Mach-O on macOS), if a compiler exists.
try {
  const src = path.join(DIR, "hello.c");
  fs.writeFileSync(src, "#include <stdio.h>\n#include <unistd.h>\nint main(void){ printf(\"%d\\n\", geteuid()); return 0; }\n");
  execFileSync("gcc", ["-O1", "-o", path.join(DIR, "real.elf"), src], { stdio: "ignore" });
  expect["real.elf"] = {
    kind: process.platform === "darwin" ? ["macho"] : process.platform === "win32" ? ["pe"] : ["elf"],
    note: "compiled on this machine with gcc/clang",
  };
  fs.writeFileSync(path.join(DIR, "expected.json"), JSON.stringify(expect, null, 1));
} catch { /* no compiler: synthetic fixtures are enough */ }

const files = Object.keys(expect);
console.log(`fixtures: ${files.length} generated in ${path.relative(process.cwd(), DIR)}`);
for (const f of files) console.log(`  ${String(expect[f].kind).padEnd(20)} ${f}`);
