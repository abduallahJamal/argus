import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, "bin", "argus.mjs"), ...args], { encoding: "utf8" });

test("help and version", () => {
  assert.match(cli("help"), /USAGE/);
  assert.match(cli("version"), /^\d+\.\d+\.\d+/);
});

test("detect --json is valid JSON with evidence", () => {
  const out = JSON.parse(cli("detect", path.join(ROOT, "bench", "fixtures", "app.apk"), "--json"));
  assert.equal(out.kind, "apk");
  assert.ok(Array.isArray(out.evidence) && out.evidence.length);
});

test("refs and ref work, and a bad topic is not a crash", () => {
  assert.match(cli("refs"), /electron/);
  assert.match(cli("ref", "electron"), /asar/);
  assert.match(cli("ref", "nope-not-a-topic"), /no reference/);
});

test("check passes on a clean tree", () => {
  const out = cli("check", "--fixtures");
  assert.match(out, /check passed/);
});

test("build writes every agent format and stays under budget", () => {
  const out = cli("build");
  assert.match(out, /build ok/);
  assert.match(out, /claude-code\/\.claude\/skills\/argus\/SKILL\.md/);
  assert.match(out, /opencode\/\.config\/opencode\/skills\/argus\/SKILL\.md/);
  assert.match(out, /codex\/\.agents\/skills\/argus\/SKILL\.md/);
  assert.match(out, /AGENTS\.md/);
  assert.match(out, /argus\.mdc/);
  assert.match(out, /GEMINI\.md/);
  assert.match(out, /copilot-instructions\.md/);
  assert.match(out, /argus-flat\.md/);
});

test("install --agent all installs every target into a clean directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-install-test-"));
  try {
    const out = cli("install", "--agent", "all", "--dir", tmp);
    assert.match(out, /installed claude-code:/);
    assert.match(out, /installed opencode:/);
    assert.match(out, /installed codex:/);
    assert.ok(fs.existsSync(path.join(tmp, ".claude/skills/argus/SKILL.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".claude/skills/argus/references/electron.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".config/opencode/skills/argus/SKILL.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".config/opencode/skills/argus/references/dotnet.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".agents/skills/argus/SKILL.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".agents/skills/argus/references/native-elf.md")));
    assert.ok(fs.existsSync(path.join(tmp, "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".cursor/rules/argus.mdc")));
    assert.ok(fs.existsSync(path.join(tmp, "GEMINI.md")));
    assert.ok(fs.existsSync(path.join(tmp, ".github/copilot-instructions.md")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
