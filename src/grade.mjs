// argus/grade.mjs — deterministic, weighted grading with tolerant literal matching,
// plus a separate quality rubric so "did it answer" and "was the answer good" are not confused.
import fs from "node:fs";

/** Strip everything that should not matter: case, spacing, separators. */
export function squash(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const META = /[\\^$*+?()[\]{}|]/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when a pattern is only literals (escaped dots allowed), i.e. no real regex syntax. */
function isLiteralPattern(p) {
  const unescaped = String(p).replace(/\\(.)/g, "$1");
  return !META.test(unescaped);
}

/**
 * Build a separator-tolerant regex from a literal: `go1\.27\.1` also matches "Go 1.27.1",
 * and a literal that ends in a digit will not match a longer number ("v2.16.1" ≠ "v2.16.10").
 */
function tolerantRegex(lit) {
  // split into letter and digit runs so "go1.27.1" also matches "Go 1.27.1"
  const parts = (lit.match(/[A-Za-z]+|[0-9]+/g) || []).map(esc);
  if (!parts.length) return null;
  const tail = /\d$/.test(lit) ? "(?![0-9])" : "";
  return new RegExp(parts.join("[\\s._:/-]*") + tail, "i");
}

function matchOne(answer, pat) {
  if (pat instanceof RegExp) return pat.test(answer);
  const p = String(pat);
  // A literal-looking key is matched literally first: running it as a regex would let
  // "v2.16.1" match "v2.16.10" through the wildcard dot.
  if (isLiteralPattern(p)) {
    const lit = p.replace(/\\(.)/g, "$1");
    const rx = tolerantRegex(lit);
    if (rx) return rx.test(answer);            // separator-tolerant, digit-boundary safe
    return squash(answer).includes(squash(lit));
  }
  try {
    if (new RegExp(p, "i").test(answer)) return true;
  } catch { /* not a valid regex: fall back to a plain substring test */ }
  return answer.toLowerCase().includes(p.toLowerCase());
}

export function matches(answer, spec) {
  const a = String(answer || "");
  if (spec.regex !== undefined) return matchOne(a, spec.regex);
  if (spec.literal !== undefined) return matchOne(a, spec.literal);
  if (spec.any !== undefined) return [].concat(spec.any).some(p => matchOne(a, p));
  if (spec.all !== undefined) return [].concat(spec.all).every(p => matchOne(a, p));
  return false;
}

/** Normalize both the legacy `"key": "regex"` form and the weighted object form. */
export function normalizeKey(key) {
  const out = [];
  for (const [id, v] of Object.entries(key || {})) {
    if (typeof v === "string") out.push({ id, weight: 1, kind: "positive", spec: { regex: v } });
    else out.push({ id, weight: v.weight ?? 1, kind: v.mustNot ? "negative" : "positive", spec: v });
  }
  return out;
}

export function gradeAnswer(answer, key) {
  const keys = normalizeKey(key);
  const hits = [];
  const misses = [];
  let points = 0;
  let max = 0;
  for (const k of keys) {
    max += k.weight;
    if (k.kind === "negative") {
      // a point for NOT hallucinating the listed strings
      const clean = !matches(answer, { any: k.spec.mustNot });
      if (clean) { points += k.weight; hits.push(k.id); } else misses.push(k.id);
      continue;
    }
    if (matches(answer, k.spec)) { points += k.weight; hits.push(k.id); } else misses.push(k.id);
  }
  return { points, max, weighted: max ? points / max : 0, hits, misses };
}

/** Quality rubric: separate from accuracy on purpose. Each item is 0..1. */
export function rubric(answer) {
  const a = String(answer || "");
  const files = (a.match(/[\w./-]+\.(?:js|mjs|cjs|ts|tsx|node|so|dylib|exe|dll|py|java|kt|cs|plist|json|asar|wasm)(?::\d+)?/g) || []).length;
  const labelled = /(seen|observed|verified|inferred|unknown\b|not found)/i.test(a);
  const pathsLines = (a.match(/:\d+/g) || []).length;
  const overconfident = /(definitely|certainly|clearly obviously|100% sure)/i.test(a);
  const structured = /(^|\n)\s*(?:[-*]|\d+\.|\|)/m.test(a);
  const length = a.length;
  const parts = {
    cites: Math.min(1, files / 3),
    lineRefs: Math.min(1, pathsLines / 2),
    labelsClaims: labelled ? 1 : 0,
    structured: structured ? 1 : 0,
    calibrated: overconfident ? 0 : 1,
    concise: length < 4000 ? 1 : length < 8000 ? 0.5 : 0,
  };
  const score = Object.values(parts).reduce((x, y) => x + y, 0) / Object.keys(parts).length;
  return { score, parts, files, chars: length };
}

/**
 * Re-grade a results jsonl. Requires rows that kept `answer` (run.py --keep-answers).
 * @returns {{rows:object[], totals:object}}
 */
export function regrade(resultsFile, tasksFile) {
  const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const rows = fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  const out = [];
  for (const r of rows) {
    const task = byId.get(r.task);
    if (!task) { out.push({ ...r, regrade: { error: "task not found" } }); continue; }
    if (typeof r.answer !== "string") {
      out.push({ ...r, regrade: { error: "no answer saved in this row: rerun with BENCH_KEEP_ANSWERS=1" } });
      continue;
    }
    const g = gradeAnswer(r.answer, task.key);
    const q = rubric(r.answer);
    out.push({ ...r, regrade: { ...g, rubric: q } });
  }
  const totals = {};
  for (const r of out) {
    if (!r.regrade?.weighted && r.regrade?.weighted !== 0) continue;
    const arm = r.arm;
    totals[arm] ??= { points: 0, max: 0, rubric: 0, n: 0 };
    totals[arm].points += r.regrade.points;
    totals[arm].max += r.regrade.max;
    totals[arm].rubric += r.regrade.rubric.score;
    totals[arm].n += 1;
  }
  for (const t of Object.values(totals)) {
    t.accuracy = t.max ? t.points / t.max : 0;
    t.quality = t.n ? t.rubric / t.n : 0;
  }
  return { rows: out, totals };
}
