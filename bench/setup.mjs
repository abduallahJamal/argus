// argus/bench/setup.mjs — build isolated per-task target folders. No network, no third-party code.
// Usage: node bench/setup.mjs [--work DIR] [--force]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const args = process.argv.slice(2);
const WORK = path.resolve(args.includes("--work") ? args[args.indexOf("--work") + 1] : path.join(HERE, "work"));

const tasks = JSON.parse(fs.readFileSync(path.join(HERE, "tasks.json"), "utf8"));
const FIX = path.join(HERE, "fixtures");

// 1. fixtures (synthetic, deterministic)
if (!fs.existsSync(path.join(FIX, "expected.json")) || args.includes("--force")) {
  execFileSync(process.execPath, [path.join(HERE, "mkfixtures.mjs")], { stdio: "inherit" });
}

// 2. the compiled native target
const targetDir = path.join(WORK, "targets");
fs.mkdirSync(targetDir, { recursive: true });
const src = path.join(HERE, "targets", "lockdemo.c");
const out = path.join(targetDir, "lockdemo");
let compiled = fs.existsSync(out);
if (!compiled) {
  for (const cc of ["cc", "gcc", "clang"]) {
    try {
      execFileSync(cc, ["-O2", "-o", out, src], { stdio: "pipe" });
      compiled = true;
      break;
    } catch { /* try the next compiler */ }
  }
}

// 3. per-task isolated target folders (the agent never sees another task's files)
const summary = [];
for (const t of tasks) {
  const dir = path.join(targetDir, t.id);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const name of t.targets) {
    const from = path.join(FIX, "bench", name);
    const alt = path.join(targetDir, name);
    const srcPath = fs.existsSync(from) ? from : alt;
    if (!fs.existsSync(srcPath)) { copied.push(`${name} (MISSING)`); continue; }
    fs.copyFileSync(srcPath, path.join(dir, name));
    copied.push(name);
  }
  // the addon sits next to the asar the way a real app ships it
  if (t.targets.includes("electron-demo.asar")) {
    const addon = path.join(FIX, "bench", "mac_utils.node");
    if (fs.existsSync(addon)) fs.copyFileSync(addon, path.join(dir, "mac_utils.node"));
  }
  t._dir = dir;
  t._available = !copied.some(c => c.includes("MISSING")) && (t.requires ? fs.existsSync(path.join(targetDir, t.requires)) : true);
  summary.push({ task: t.id, available: t._available, files: copied });
}

if (!compiled) console.error("warning: no C compiler found; the `lock` task will be skipped");

console.log(`work dir: ${WORK}`);
for (const s of summary) console.log(`  ${s.available ? "ready  " : "SKIP   "} ${s.task.padEnd(8)} ${s.files.join(", ")}`);
console.log(`
next:
  node bench/run.mjs --arm none --task asar --rep 1        # one cell
  node bench/run.mjs --dry --reps 3                        # harness self-test, no API key
  node bench/run_all.sh                                    # 3 arms x 5 tasks x 3 reps
  argus report bench/results/run.jsonl --html bench/dashboard.html`);
