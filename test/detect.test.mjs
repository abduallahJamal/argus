import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { detect } from "../src/detect.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIX = path.join(ROOT, "bench", "fixtures");

test("fixtures exist (run bench/mkfixtures.mjs in pretest if not)", () => {
  if (!fs.existsSync(path.join(FIX, "expected.json"))) {
    execFileSync(process.execPath, [path.join(ROOT, "bench", "mkfixtures.mjs")], { stdio: "ignore" });
  }
  assert.ok(fs.existsSync(path.join(FIX, "expected.json")));
});

test("every fixture routes to its expected kind", () => {
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8"));
  for (const [file, want] of Object.entries(expected)) {
    const got = detect(path.join(FIX, file));
    const kinds = Array.isArray(want.kind) ? want.kind : [want.kind];
    assert.ok(kinds.includes(got.kind), `${file}: expected ${kinds.join("|")}, got ${got.kind}`);
    assert.ok(got.evidence.length > 0, `${file}: detection must cite evidence`);
  }
});

test("detection never executes and never mutates the target", () => {
  const f = path.join(FIX, "demo.elf");
  const before = fs.readFileSync(f);
  detect(f);
  assert.deepEqual(fs.readFileSync(f), before);
});

test("unknown high-entropy blobs are labelled, not guessed", () => {
  const d = detect(path.join(FIX, "blob.bin"));
  assert.equal(d.kind, "binary-unknown");
  assert.equal(d.confidence, "low");
});

test("a directory target is recognised (app bundle / project)", () => {
  const d = detect(path.join(ROOT, "skill"));
  assert.equal(d.kind, "directory");
  assert.equal(d.confidence, "medium");
});
