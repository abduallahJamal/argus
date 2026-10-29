import test from "node:test";
import assert from "node:assert/strict";
import { PLANS, planFor, renderShell } from "../src/plan.mjs";

test("every plan step has a fallback (no dead ends) and a command", () => {
  for (const [kind, plan] of Object.entries(PLANS)) {
    assert.ok(plan.summary, `${kind}: summary`);
    for (const s of plan.steps) {
      assert.ok(s.cmd, `${kind}/${s.id}: cmd`);
      assert.ok(s.fallback, `${kind}/${s.id}: fallback`);
      assert.ok([1, 2, 3].includes(s.tier), `${kind}/${s.id}: tier`);
    }
  }
});

test("renderShell emits one paste-and-run block with markers and a work dir", () => {
  const plan = planFor({ kind: "elf" });
  const sh = renderShell("/tmp/x", plan, { dir: "$TMPDIR/argus", tier: 1 });
  assert.match(sh, /^# argus plan/);
  assert.match(sh, /echo '--- /);
  assert.match(sh, /T="\/tmp\/x"/);
  assert.match(sh, /mkdir -p "\$D"/);
  assert.equal(sh.split("\n").filter(l => /^echo '--- /.test(l)).length, plan.steps.filter(s => s.tier <= 1).length);
});

test("an unknown kind still gets a route", () => {
  const plan = planFor({ kind: "no-such-kind" });
  assert.ok(plan.steps.length >= 2);
  assert.match(plan.summary, /identify/i);
});

test("tier filtering is respected", () => {
  const plan = planFor({ kind: "macho" });
  const t1 = plan.steps.filter(s => s.tier === 1).length;
  const sh = renderShell("T", plan, { tier: 1 });
  assert.equal(sh.split("\n").filter(l => /^echo '--- /.test(l)).length, t1);
});
