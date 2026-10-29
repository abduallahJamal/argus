// argus/bench/run.mjs — one benchmark cell, or a full sweep.
//
//   node bench/run.mjs --arm argus --task asar --rep 1
//   node bench/run.mjs --dry --reps 3               # harness self-test: no model, no API key
//   node bench/run.mjs --arms none,skill,argus --reps 3 --shuffle
//
// Design decisions that fix what earlier harnesses got wrong:
//  * each task runs in its own folder containing ONLY its targets (no cross-task leakage)
//  * the answer is saved, and the grader re-runs from the saved answer (never from a summary)
//  * arm order is shuffled per rep, and cells run sequentially by default (--parallel to override)
//  * a row records model, tasks.json hash, git sha and the exact agent command line
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gradeAnswer } from "../src/grade.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const WORK = path.resolve(process.env.ARGUS_BENCH_WORK || path.join(HERE, "work"));
const OUT = path.join(HERE, "results", DRY_SOON() ? "dry.jsonl" : "run.jsonl");
function DRY_SOON() { return process.argv.includes("--dry"); }

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const ARM = flag("arm", null);
const TASK = flag("task", null);
const REP = Number(flag("rep", 1));
const REPS = Number(flag("reps", 0));
const ARMS = String(flag("arms", "none,skill,argus")).split(",");
const DRY = !!flag("dry", false);
const MODEL = process.env.ARGUS_BENCH_MODEL || flag("model", "sonnet");
const MAX_TASKS = Number(flag("tasks-limit", 0));
const KEEP = !flag("no-answers", false);

const tasks = JSON.parse(fs.readFileSync(path.join(HERE, "tasks.json"), "utf8"));
const tasksHash = crypto.createHash("sha256").update(JSON.stringify(tasks)).digest("hex").slice(0, 12);

// ---------- helpers ----------
const now = () => new Date().toISOString();
function gitSha(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}
const SHA = gitSha(ROOT);

/** deterministic PRNG so a dry run is reproducible */
function rng(seedStr) {
  let s = crypto.createHash("sha256").update(seedStr).digest().readUInt32LE(0) || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function shuffled(arr, seed) {
  const r = rng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepareWorkspace(arm, task, rep) {
  const ws = path.join(WORK, "runs", `${arm}-${task.id}-${rep}`);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const src = path.join(WORK, "targets", task.id);
  if (!fs.existsSync(src)) throw new Error(`run setup first: node bench/setup.mjs (missing ${src})`);
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(ws, f));

  // the arm decides what the agent gets
  if (arm === "argus" || arm === "skill") {
    const skills = path.join(ws, ".claude", "skills");
    fs.mkdirSync(skills, { recursive: true });
    fs.cpSync(path.join(ROOT, "skill"), path.join(skills, "argus"), { recursive: true });
  }
  if (arm === "argus") {
    // a real CLI on PATH, built from this repo, so the arm measures skill + tool together
    const bin = path.join(ws, ".argus-bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "argus"),
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, "bin", "argus.mjs")}" "$@"\n`, { mode: 0o755 });
  }
  return ws;
}

function agentCmd(ws, prompt) {
  const custom = process.env.ARGUS_BENCH_AGENT_CMD; // e.g. "codex exec --json {prompt}"
  if (custom) {
    const [cmd, ...args] = custom.replace("{prompt}", "\0PROMPT\0").split(" ");
    return { cmd, args: args.map(a => a.replace("\0PROMPT\0", prompt)), stdin: prompt };
  }
  return {
    cmd: "claude",
    args: ["-p", "--model", MODEL, "--output-format", "stream-json", "--verbose",
      "--strict-mcp-config", "--no-session-persistence", "--max-budget-usd", process.env.ARGUS_BENCH_BUDGET || "4",
      "--allowedTools", "Bash,Read,Grep,Glob,Write,Edit,Skill"],
    stdin: prompt,
  };
}

function parseStream(stdout) {
  const out = { answer: "", turns: 0, cost: 0, tokens: { in: 0, cache_w: 0, cache_r: 0, out: 0 }, tools: [], error: false };
  for (const line of String(stdout).split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "result") {
      out.answer = ev.result || out.answer;
      out.turns = ev.num_turns ?? out.turns;
      out.cost = ev.total_cost_usd ?? out.cost;
      out.error = !!ev.is_error;
      const u = ev.usage || {};
      out.tokens = { in: u.input_tokens || 0, cache_w: u.cache_creation_input_tokens || 0, cache_r: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 };
    }
    if (ev.type === "assistant") {
      for (const c of ev.message?.content || []) {
        if (c.type === "tool_use") out.tools.push(c.name + (c.name === "Bash" ? ":" + String(c.input?.command || "").trim().split(/\s+/)[0] : ""));
      }
    }
  }
  return out;
}

/** Dry mode: a synthetic answer that exercises the grader with known hits and misses. */
function dryAnswer(arm, task) {
  const keys = Object.entries(task.key);
  const r = rng(`${arm}-${task.id}`);
  const missRate = arm === "argus" ? 0.08 : arm === "skill" ? 0.18 : 0.35;
  const lines = ["**Findings** — dry run (synthetic answer, for harness testing only)", ""];
  for (const [id, spec] of keys) {
    const positive = !spec.mustNot;
    const hit = positive ? r() > missRate : r() > 0.9;
    if (!hit) continue;
    const value = positive
      ? (spec.literal || (spec.regex || "").replace(/\\(.)/g, "$1").replace(/\[\^?[^\]]*\]|\|.*$/g, ""))
      : "(no contradiction)";
    lines.push(`- ${id}: ${value} — seen: dry-fixture:1`);
  }
  lines.push("", "**Route** — dry mode: no commands were run.");
  return lines.join("\n");
}

function dryMetrics(arm, task, rep) {
  const r = rng(`${arm}-${task.id}-${rep}-metrics`);
  const f = { argus: 1, skill: 1.25, none: 1.7 }[arm] ?? 1.4;
  const base = { asar: 36, native: 40, lock: 42, bundle: 18, go: 13 }[task.id] || 30;
  return {
    wall_s: Math.round(base * f * (0.85 + r() * 0.3)),
    turns: Math.round(({ argus: 4, skill: 6, none: 9 }[arm] ?? 7) * (0.8 + r() * 0.4)),
    cost: Number((0.15 * f * (0.9 + r() * 0.2)).toFixed(3)),
    tokens: { in: 10, cache_w: Math.round(30000 * f), cache_r: Math.round(150000 * f * (0.8 + r() * 0.4)), out: Math.round(2500 * f) },
    tools: ["dry:no-tools"],
  };
}

function runCell(arm, task, rep) {
  const ws = prepareWorkspace(arm, task, rep);
  const prompt = (arm === "argus" || arm === "skill") ? `/argus ${task.prompt}` : task.prompt;
  const t0 = Date.now();
  let parsed, cmdDesc = "dry";

  if (DRY) {
    parsed = { answer: dryAnswer(arm, task), error: false, ...dryMetrics(arm, task, rep) };
  } else {
    const { cmd, args, stdin } = agentCmd(ws, prompt);
    cmdDesc = [cmd, ...args].join(" ").replace(/\s+/g, " ");
    const env = { ...process.env };
    if (arm === "argus") env.PATH = `${path.join(ws, ".argus-bin")}:${env.PATH}`;
    const p = spawnSync(cmd, args, { cwd: ws, input: stdin, encoding: "utf8", timeout: 1_500_000, env });
    parsed = parseStream(p.stdout || "");
    if (!parsed.answer) {
      parsed.answer = (p.stdout || "") + (p.stderr || "");
      parsed.error = true;
    }
  }

  const wall = DRY ? parsed.wall_s : (Date.now() - t0) / 1000;
  const usage = parsed.tokens || { in: 0, cache_w: 0, cache_r: 0, out: 0 };
  const tokens = usage.in + usage.cache_w + usage.cache_r + usage.out;
  // grade at record time, from the saved answer, with the same code `argus grade` uses later
  const g = gradeAnswer(parsed.answer || "", task.key);
  const row = {
    ts: now(), dry: DRY || undefined, arm, task: task.id, rep,
    model: DRY ? "dry" : MODEL, wall_s: Number(Number(wall).toFixed(1)), turns: parsed.turns ?? 0,
    cost: parsed.cost ?? 0, tokens, usage,
    points: g.points, max: g.max, weighted: Number(g.weighted.toFixed(4)),
    score: `${g.points}/${g.max}`, miss: g.misses, hits: g.hits,
    tools: parsed.tools || [], err: !!parsed.error, ws: path.relative(ROOT, ws),
    meta: { git: SHA, tasksHash, cmd: cmdDesc, node: process.version, platform: process.platform },
  };
  if (KEEP) row.answer = parsed.answer;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  const summary = `[${arm}/${task.id}/${rep}] ${row.wall_s}s turns=${row.turns} cost=$${row.cost} score=${row.score} chars=${(row.answer || "").length}${row.err ? " ERROR" : ""}`;
  console.log(summary);
  return row;
}

// ---------- main ----------
if (!fs.existsSync(path.join(WORK, "targets"))) {
  console.error("no targets: run node bench/setup.mjs first");
  process.exit(2);
}

let available = tasks.filter(t => {
  const dir = path.join(WORK, "targets", t.id);
  if (!fs.existsSync(dir)) return false;
  return t.targets.every(f => fs.existsSync(path.join(dir, f)));
});
if (MAX_TASKS) available = available.slice(0, MAX_TASKS);

const sweep = REPS > 0 || (!ARM && !TASK);
if (!sweep) {
  const task = available.find(t => t.id === TASK);
  if (!task) { console.error(`task ${TASK} is not available (see node bench/setup.mjs)`); process.exit(2); }
  runCell(ARM, task, REP);
  process.exit(0);
}

const reps = REPS || 1;
let n = 0;
for (let rep = 1; rep <= reps; rep++) {
  for (const task of available) {
    const order = DRY ? ARMS : shuffled(ARMS, `${task.id}-${rep}`);
    console.log(`-- rep ${rep} · ${task.id} · order: ${order.join(" -> ")}`);
    for (const arm of order) { runCell(arm, task, rep); n++; }
  }
}
console.log(`\n${n} cells written to ${path.relative(ROOT, OUT)}`);
console.log(`next: argus report ${path.relative(ROOT, OUT)} --html bench/dashboard.html && argus grade ${path.relative(ROOT, OUT)}`);
