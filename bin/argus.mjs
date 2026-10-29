#!/usr/bin/env node
// argus — hundred eyes, zero MCP.  Route a shipped artifact to the fastest local command.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detect } from "../src/detect.mjs";
import { planFor, renderShell, PLANS } from "../src/plan.mjs";
import { recon, formatRecon } from "../src/recon.mjs";
import { doctor } from "../src/doctor.mjs";
import { getRef, listRefs, printRef, ROOT } from "../src/refs.mjs";
import { build, LIMITS } from "../src/build.mjs";
import { check } from "../src/check.mjs";
import { loadRuns, summarize, toMarkdown, toHtml } from "../src/report.mjs";
import { regrade, gradeAnswer } from "../src/grade.mjs";
import { PLATFORM } from "../src/tools.mjs";

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// ---------- tiny arg parser ----------
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq > 0) { out.flags[key.slice(0, eq)] = key.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { out.flags[key] = next; i++; } else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `argus ${VERSION} — hundred eyes, zero MCP (${PLATFORM})

USAGE
  argus <command> [target] [flags]

ROUTING
  detect <file|dir>        magic bytes + build markers -> kind (JSON with --json)
  plan <file|dir>          ordered, budgeted commands for that kind
      --shell              one paste-and-run block (\${T} = target)
      --tier N             include steps up to tier N (default 1: inventory only)
      --json               machine-readable plan
  recon <file>             run the tier-1 inventory, bounded, and save evidence
      --budget BYTES       evidence budget (default 49152)
      --tier N --timeout MS --dry --allow-empty
  doctor                   which tools exist here, and the fallback for each missing one
      --json

KNOWLEDGE (progressive disclosure)
  refs                     list reference topics with sizes
  ref <topic> [query]      print one reference, or only the lines matching a query

DELIVERY
  build                    generate dist/ for OpenCode, Claude Code, Codex, AGENTS.md, Cursor, Gemini, Copilot, flat
      --out DIR
  install [--agent NAME]   copy the built skill into a user-level location
      agents: claude-code | opencode | codex | agents | cursor | gemini | copilot | all (default claude-code)
      --dir DIR            install root (default: home)
  check [--fixtures]       enforce size budgets, reference integrity, no dead ends

BENCHMARK
  report <results.jsonl>   median + IQR + bootstrap CI, markdown and/or HTML
      --md FILE --html FILE --baseline ARM --title TEXT
  grade <results.jsonl>    re-grade saved answers with tolerant + weighted keys
      --tasks FILE --json
  verify <file>            print the sha256 of a target (pins a fixture by hash)

EXAMPLES
  argus detect ./App.app && argus plan ./App.app --tier 2
  argus recon ./bin/tool --budget 32768
  argus ref electron ipc
  argus report bench/results/run.jsonl --html bench/dashboard.html

No target is executed by detect/plan. recon runs only declared inventory steps,
only when their tools exist, and writes its evidence under $TMPDIR/argus/.
`;

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const target = _[1];

  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;

    case "version":
    case "-v":
      console.log(VERSION);
      return 0;

    case "detect": {
      if (!target) return fail("detect needs a file or directory");
      if (!fs.existsSync(target)) return fail(`no such file or directory: ${target}`);
      const d = detect(target, { deep: flags.deep !== "false" });
      if (flags.json) { console.log(JSON.stringify(d, null, 1)); return 0; }
      const L = [
        `${d.path}`,
        `kind:       ${d.kind}${d.subtype ? "/" + d.subtype : ""}  (${d.label})`,
        `confidence: ${d.confidence}`,
        `size:       ${d.size} bytes (${(d.size / 1024).toFixed(1)} KB)`,
      ];
      if (d.builds.length) L.push(`built with: ${d.builds.map(b => `${b.label} @0x${b.offset.toString(16)}`).join(", ")}`);
      for (const e of d.evidence) L.push(`evidence:   ${e.note}${e.bytes ? ` [${e.bytes}]` : ""}${e.offset != null ? ` @${e.offset}` : ""}`);
      for (const h of d.hints) L.push(`hint:       ${h}`);
      console.log(L.join("\n"));
      return 0;
    }

    case "plan": {
      if (!target) return fail("plan needs a file or directory");
      if (!fs.existsSync(target)) return fail(`no such file or directory: ${target}`);
      const det = detect(target);
      const plan = planFor(det);
      const tier = Number(flags.tier || 1);
      if (flags.shell) {
        const dir = path.join(os.tmpdir(), "argus");
        console.log(renderShell(det.path, plan, { dir, tier }));
        return 0;
      }
      if (flags.json) {
        console.log(JSON.stringify({ detection: det, plan }, null, 1));
        return 0;
      }
      const L = [`${det.path}`, `kind: ${det.kind} (${det.label}, ${det.confidence})`, `route: ${plan.summary}`, ""];
      for (const s of plan.steps) {
        if (s.tier > tier) continue;
        const mark = s.tier === 1 ? "1" : String(s.tier);
        L.push(`[tier ${mark}] ${s.title}${s.gives ? `  -> ${s.gives}` : ""}`);
        if (s.why) L.push(`   why: ${s.why}`);
        L.push(`   $ ${s.cmd.split("\n")[0].slice(0, 160)}${s.cmd.includes("\n") ? " …" : ""}`);
        if (!s.runnable) L.push(`   missing: ${s.missing.join(", ")} -> instead: ${s.fallback}`);
      }
      const hidden = plan.steps.filter(s => s.tier > tier).length;
      if (hidden) L.push("", `(${hidden} deeper step${hidden > 1 ? "s" : ""} hidden: --tier ${tier + 1})`);
      L.push("", "run it:  argus plan " + det.path + " --shell   |   argus recon " + det.path);
      console.log(L.join("\n"));
      return 0;
    }

    case "recon": {
      if (!target) return fail("recon needs a file");
      const { report, outFile } = recon(target, {
        tier: Number(flags.tier || 1),
        budget: flags.budget ? Number(flags.budget) : undefined,
        timeout: flags.timeout ? Number(flags.timeout) : undefined,
        dry: !!flags.dry,
        allowEmpty: !!flags["allow-empty"],
        outDir: flags["out-dir"],
      });
      const text = formatRecon({ report }, { maxOutput: flags["max-output"] ? Number(flags["max-output"]) : 1200 });
      console.log(text);
      console.error(`\nreport: ${outFile}`);
      return 0;
    }

    case "doctor": {
      const d = doctor({ json: !!flags.json });
      console.log(typeof d === "string" ? d : JSON.stringify(d, null, 1));
      return 0;
    }

    case "refs": {
      const list = listRefs({ json: !!flags.json });
      console.log(typeof list === "string" ? `argus reference library\n\n${list}` : JSON.stringify(list, null, 1));
      return 0;
    }

    case "ref": {
      if (!target) return fail("ref needs a topic (try: argus refs)");
      console.log(printRef(target, _[2] || flags.grep));
      return 0;
    }

    case "build": {
      const m = build({ outDir: flags.out ? path.resolve(flags.out) : undefined });
      console.log(`build ok: skill ${m.skillKB} KB / ${LIMITS.skillKB} KB, ${m.refs} references (${m.refsKB} KB)`);
      for (const f of m.files) console.log(`  ${String(f.bytes).padStart(7)} B  ${f.sha}  ${f.rel}`);
      if (!m.ok) { for (const p of m.problems) console.error(`  ! ${p}`); return 1; }
      return 0;
    }

    case "install": {
      const agent = flags.agent || "claude-code";
      const root = flags.dir ? path.resolve(flags.dir) : os.homedir();
      const outDir = path.join(ROOT, "dist");
      build({ outDir });
      const map = {
        "claude-code": [".claude/skills/argus", "claude-code/.claude/skills/argus"],
        opencode: [".config/opencode/skills/argus", "opencode/.config/opencode/skills/argus"],
        codex: [".agents/skills/argus", "codex/.agents/skills/argus"],
        agents: ["AGENTS.md", "agents/AGENTS.md"],
        cursor: [".cursor/rules/argus.mdc", "cursor/.cursor/rules/argus.mdc"],
        gemini: ["GEMINI.md", "gemini/GEMINI.md"],
        copilot: [".github/copilot-instructions.md", "copilot/.github/copilot-instructions.md"],
      };
      const wanted = agent === "all" ? Object.keys(map) : [agent];
      for (const a of wanted) {
        if (!map[a]) return fail(`unknown agent "${a}". options: ${Object.keys(map).join(", ")}, all`);
        const [dest, src] = map[a];
        const from = path.join(outDir, src);
        const to = path.join(root, dest);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(from, to, { recursive: true, force: true });
        console.log(`installed ${a}: ${to}`);
      }
      return 0;
    }

    case "check": {
      const r = check({ fixtures: !!flags.fixtures });
      for (const n of r.notes) console.log(`  ok ${n}`);
      for (const p of r.problems) console.error(`  ! ${p}`);
      console.log(r.ok ? "check passed" : `check failed: ${r.problems.length} problem(s)`);
      return r.ok ? 0 : 1;
    }

    case "report": {
      if (!target) return fail("report needs a results jsonl");
      const rows = loadRuns(target);
      if (flags.json) { console.log(JSON.stringify(summarize(rows), null, 1)); return 0; }
      const md = toMarkdown(rows, { baseline: flags.baseline || "none", title: flags.title || "argus benchmark" });
      if (flags.html) {
        const out = path.resolve(flags.html);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, toHtml(rows, { title: flags.title || "argus benchmark" }));
        console.error(`html: ${out}`);
      }
      if (flags.md) {
        const out = path.resolve(flags.md);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, md + "\n");
        console.error(`markdown: ${out}`);
      }
      if (!flags.md && !flags.html) console.log(md);
      return 0;
    }

    case "grade": {
      if (!target) return fail("grade needs a results jsonl");
      const tasksFile = flags.tasks || path.join(ROOT, "bench", "tasks.json");
      const { rows, totals } = regrade(target, tasksFile);
      if (flags.json) { console.log(JSON.stringify({ totals, rows }, null, 1)); return 0; }
      console.log(`regraded ${rows.length} rows from ${path.basename(target)} (keys: ${path.basename(tasksFile)})`);
      console.log("");
      console.log("| arm | weighted accuracy | quality rubric | n |");
      console.log("|---|---|---|---|");
      for (const [arm, t] of Object.entries(totals)) {
        console.log(`| ${arm} | ${(t.accuracy * 100).toFixed(1)}% (${t.points}/${t.max}) | ${(t.quality * 100).toFixed(0)}/100 | ${t.n} |`);
      }
      const broken = rows.filter(r => r.regrade?.error);
      if (broken.length) console.log(`\n${broken.length} rows could not be regraded: ${[...new Set(broken.map(r => r.regrade.error))].join("; ")}`);
      const flips = rows.filter(r => r.regrade && typeof r.score === "string" && r.regrade.weighted !== undefined &&
        Math.abs(r.regrade.weighted - (Number(String(r.score).split("/")[0]) / Number(String(r.score).split("/")[1]))) > 0.001);
      if (flips.length) console.log(`\n${flips.length} rows changed under tolerant matching (this is the regex fragility the harness used to hide):`);
      for (const f of flips.slice(0, 10)) console.log(`  ${f.arm}/${f.task}/${f.rep}: recorded ${f.score} -> regraded ${f.regrade.points}/${f.regrade.max}`);
      return 0;
    }

    case "verify": {
      if (!target) return fail("verify needs a file");
      const crypto = await import("node:crypto");
      const hash = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      console.log(`${hash}  ${target}`);
      return 0;
    }

    case "kinds": {
      console.log(Object.keys(PLANS).sort().join("\n"));
      return 0;
    }

    default:
      console.error(`unknown command "${cmd}"\n`);
      console.log(HELP);
      return 2;
  }
}

function fail(msg) {
  console.error(`argus: ${msg}`);
  return 2;
}

main().then(code => process.exit(code ?? 0)).catch(e => {
  console.error("argus: " + (e?.stack || e));
  process.exit(1);
});
