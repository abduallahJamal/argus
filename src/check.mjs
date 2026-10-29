// argus/check.mjs — the lints that keep this repo honest: size budgets, reference integrity,
// "no dead ends" in plans, and detection against committed fixtures.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadRefs, getRef } from "./refs.mjs";
import { PLANS } from "./plan.mjs";
import { LIMITS } from "./build.mjs";
import { detect } from "./detect.mjs";

export function check({ fixtures = false } = {}) {
  const problems = [];
  const notes = [];
  const refs = loadRefs();

  // 1. size budgets
  const skill = fs.readFileSync(path.join(ROOT, "skill", "SKILL.md"), "utf8");
  const skillKB = Buffer.byteLength(skill) / 1024;
  if (skillKB > LIMITS.skillKB) problems.push(`skill/SKILL.md is ${skillKB.toFixed(2)} KB > ${LIMITS.skillKB} KB: move detail into references`);
  else notes.push(`skill/SKILL.md ${skillKB.toFixed(2)} KB / ${LIMITS.skillKB} KB`);
  for (const r of refs) {
    const kb = r.bytes / 1024;
    if (kb > LIMITS.refKB) problems.push(`reference ${r.id} is ${kb.toFixed(1)} KB > ${LIMITS.refKB} KB: split it`);
  }

  // 2. reference frontmatter
  for (const r of refs) {
    if (!r.meta.title) problems.push(`reference ${r.id}: missing "title" in frontmatter`);
    if (!r.meta.when) problems.push(`reference ${r.id}: missing "when" in frontmatter`);
    if (!r.meta.keywords) problems.push(`reference ${r.id}: missing "keywords" in frontmatter`);
    if (r.body.trim().length < 200) problems.push(`reference ${r.id}: body is too thin to be useful`);
    if (/\bTODO\b|\bFIXME\b/.test(r.body)) problems.push(`reference ${r.id}: contains TODO/FIXME`);
  }

  // 3. every `argus ref <id>` pointer resolves
  const pointers = new Set();
  const scan = text => { for (const m of text.matchAll(/argus ref ([a-z0-9-]+)/g)) pointers.add(m[1]); };
  scan(skill);
  refs.forEach(r => scan(r.body));
  for (const p of pointers) if (!getRef(p)) problems.push(`dangling pointer: \`argus ref ${p}\` has no reference file`);
  notes.push(`${pointers.size} reference pointers, ${refs.length} references`);

  // 4. plans: no dead ends, every step has a fallback, unique ids
  for (const [kind, plan] of Object.entries(PLANS)) {
    const ids = new Set();
    for (const s of plan.steps) {
      if (!s.fallback) problems.push(`plan ${kind}: step ${s.id} has no fallback (a missing tool would block the agent)`);
      if (!s.cmd) problems.push(`plan ${kind}: step ${s.id} has no command`);
      if (ids.has(s.id)) problems.push(`plan ${kind}: duplicate step id ${s.id}`);
      ids.add(s.id);
    }
    if (!plan.summary) problems.push(`plan ${kind}: missing summary`);
  }
  notes.push(`${Object.keys(PLANS).length} plans checked`);

  // 5. the router in SKILL.md must cover every plan family
  const routerRows = (skill.match(/^\|/gm) || []).length;
  if (routerRows < 10) problems.push(`SKILL.md router looks too small (${routerRows} table rows)`);

  // 6. detection fixtures
  if (fixtures) {
    const dir = path.join(ROOT, "bench", "fixtures");
    const expFile = path.join(dir, "expected.json");
    if (!fs.existsSync(expFile)) problems.push("bench/fixtures/expected.json missing: run `node bench/mkfixtures.mjs`");
    else {
      const expected = JSON.parse(fs.readFileSync(expFile, "utf8"));
      let pass = 0;
      for (const [file, want] of Object.entries(expected)) {
        const f = path.join(dir, file);
        if (!fs.existsSync(f)) { problems.push(`fixture missing: ${file}`); continue; }
        const got = detect(f);
        const ok = Array.isArray(want.kind) ? want.kind.includes(got.kind) : got.kind === want.kind;
        if (!ok) problems.push(`fixture ${file}: expected ${JSON.stringify(want.kind)} got ${got.kind}`);
        else pass++;
      }
      notes.push(`fixtures: ${pass}/${Object.keys(expected).length} routed correctly`);
    }
  }

  return { ok: problems.length === 0, problems, notes };
}
