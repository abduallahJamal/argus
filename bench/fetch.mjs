// argus/bench/fetch.mjs — download the real-world targets declared in fixtures.json.
//
//   node bench/fetch.mjs                # fetch everything missing, warn about unpinned hashes
//   node bench/fetch.mjs --only gh      # one fixture
//   node bench/fetch.mjs --pin          # record/refresh sha256 into fixtures.lock.json
//
// Pinning is the whole point: a benchmark you cannot reproduce on another machine is an anecdote.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.env.ARGUS_BENCH_WORK || path.join(HERE, "work"));
const TARGETS = path.join(WORK, "targets");
const LOCK = path.join(HERE, "fixtures.lock.json");
const argv = process.argv.slice(2);
const has = f => argv.includes(`--${f}`);
const val = (f, d) => (argv.includes(`--${f}`) ? argv[argv.indexOf(`--${f}`) + 1] : d);

const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures.json"), "utf8"));
const lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, "utf8")) : {};
const only = val("only", null);
const PIN = has("pin");

fs.mkdirSync(TARGETS, { recursive: true });

const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex");

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const f of fixtures) {
  if (only && f.id !== only) continue;
  const dest = path.join(TARGETS, f.install);
  const pinned = lock[f.id]?.sha256;
  if (fs.existsSync(dest) && !PIN) {
    const got = sha256(fs.readFileSync(dest));
    const state = pinned ? (pinned === got ? "hash ok" : `HASH MISMATCH (lock ${pinned.slice(0, 12)})`) : "unpinned";
    console.log(`  skip  ${f.id.padEnd(8)} ${path.relative(process.cwd(), dest)}  ${state}`);
    continue;
  }
  try {
    console.log(`  fetch ${f.id.padEnd(8)} ${f.url}`);
    const raw = await download(f.url);
    const expected = pinned;
    if (expected && !PIN) {
      const got = sha256(raw);
      if (got !== expected) throw new Error(`sha256 mismatch: lock ${expected} got ${got}`);
    }
    let out = raw;
    if (f.archive === "tar.gz" && f.member) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-fetch-"));
      const tgz = path.join(tmp, "a.tgz");
      fs.writeFileSync(tgz, raw);
      execFileSync("tar", ["-xzf", tgz, "-C", tmp], { stdio: "ignore" });
      const member = path.join(tmp, f.member);
      if (!fs.existsSync(member)) throw new Error(`member not found in archive: ${f.member}`);
      out = fs.readFileSync(member);
    } else if (f.archive === "zip" && f.member) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-fetch-"));
      const z = path.join(tmp, "a.zip");
      fs.writeFileSync(z, raw);
      execFileSync("unzip", ["-o", "-q", z, "-d", tmp], { stdio: "ignore" });
      out = fs.readFileSync(path.join(tmp, f.member));
    }
    fs.writeFileSync(dest, out, { mode: 0o755 });
    const got = sha256(out);
    if (PIN || !pinned) {
      lock[f.id] = { sha256: got, url: f.url, bytes: out.length, note: f.note, pinned: new Date().toISOString().slice(0, 10) };
      fs.writeFileSync(LOCK, JSON.stringify(lock, null, 1) + "\n");
      console.log(`  pin   ${f.id.padEnd(8)} ${got.slice(0, 16)}…  (${out.length} bytes) -> ${path.basename(LOCK)}`);
    }
  } catch (e) {
    console.error(`  FAIL  ${f.id}: ${e.message}`);
    console.error(`        the benchmark skips tasks whose targets are absent; nothing else breaks`);
  }
}
console.log(`\ntargets: ${TARGETS}`);
console.log(`lock:    ${fs.existsSync(LOCK) ? path.basename(LOCK) : "none yet (run --pin to create)"}`);
