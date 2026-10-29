// argus/recon.mjs — run the tier-1 inventory for a target, bounded, and keep the evidence.
// Design rules: never run a step whose tools are missing, cap every output, never modify the target.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { detect } from "./detect.mjs";
import { planFor } from "./plan.mjs";
import { findMissingBins, rewriteRg, resolveTool } from "./tools.mjs";

const DEFAULT_BUDGET = 48 * 1024; // bytes of evidence kept in the report
const DEFAULT_TIMEOUT = 40_000;

/**
 * @param {string} target
 * @param {{tier?:1|2|3, budget?:number, timeout?:number, allowEmpty?:boolean,
 *          dry?:boolean, outDir?:string, keep?:number}} opts
 */
export function recon(target, opts = {}) {
  const tier = opts.tier ?? 1;
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const det = detect(target);
  const plan = planFor(det);
  const workDir = opts.outDir || path.join(os.tmpdir(), "argus", path.basename(det.path));
  fs.mkdirSync(workDir, { recursive: true });

  const steps = plan.steps.filter(s => s.tier <= tier);
  // Fair share per step: one verbose step must not starve the inventory that follows it.
  const quota = Math.max(2048, Math.floor(budget / Math.max(1, steps.length)));
  const results = [];
  let spent = 0;

  for (const s of steps) {
    let cmdToRun = s.cmd;
    let rewriteNote;
    if (!resolveTool("rg").present && /\brg\b/.test(cmdToRun)) {
      const r = rewriteRg(cmdToRun);
      if (r.rewrites) { cmdToRun = r.cmd; rewriteNote = `rg->grep x${r.rewrites}`; }
    }
    const absent = findMissingBins(cmdToRun);
    const skipReason = !s.runnable
      ? `missing: ${s.missing.join(", ")}`
      : absent.length
        ? `missing: ${absent.map(a => a.id).join(", ")}`
        : (!s.needs.length && !opts.allowEmpty ? "no declared tools (may fetch from the network); pass --allow-empty" : null);
    if (skipReason) {
      const why = absent.length ? absent.map(a => `${a.id}: ${a.fallback}`).join(" | ") : s.fallback;
      results.push({ id: s.id, title: s.title, status: "skipped", reason: skipReason, fallback: why });
      continue;
    }
    if (opts.dry) {
      results.push({ id: s.id, title: s.title, status: "would-run", cmd: s.cmd });
      continue;
    }
    if (spent >= budget) {
      results.push({ id: s.id, title: s.title, status: "skipped", reason: `budget ${budget}B exhausted` });
      continue;
    }
    // The target and work dir are passed as environment variables, so the plan text
    // stays exactly what a human would paste. Only the self-assignment scaffolding is stripped.
    const cmd = cmdToRun.replace(/^\s*T=\$T;\s*/, "").replace(/\bT=\$T;\s*/g, "");
    const t0 = Date.now();
    let out = "";
    let status = "ok";
    let note = "";
    try {
      out = execSync(cmd, {
        shell: "/bin/sh",
        cwd: path.dirname(det.path),
        timeout,
        maxBuffer: Math.max(1024 * 1024, budget * 4),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LC_ALL: "C", T: det.path, D: workDir, APP: det.path },
      }).toString();
    } catch (e) {
      out = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
      status = e.killed ? "timeout" : "error";
      note = String(e.message || "").split("\n")[0].slice(0, 200);
    }
    const room = Math.max(0, Math.min(quota, budget - spent));
    const clipped = out.length > room ? out.slice(0, room) : out;
    spent += clipped.length;
    results.push({
      id: s.id, title: s.title, status, note,
      gives: s.gives, why: s.why,
      cmd, rewritten: rewriteNote, bytes: clipped.length, truncated: clipped.length < out.length,
      ms: Date.now() - t0, output: clipped,
      fallback: status === "ok" ? undefined : s.fallback,
    });
  }

  const report = {
    target: det.path, size: det.size, kind: det.kind, label: det.label,
    confidence: det.confidence, subtype: det.subtype,
    hints: det.hints, builds: det.builds, evidence: det.evidence,
    workDir, tier, budget, spent, plan: plan.summary, results,
    generated: new Date().toISOString(),
  };
  const outFile = path.join(workDir, "recon.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  return { report, outFile };
}

export function formatRecon({ report }, { maxOutput = 1200 } = {}) {
  const L = [];
  L.push(`argus recon — ${report.target}`);
  L.push(`kind: ${report.kind}${report.subtype ? "/" + report.subtype : ""} (${report.confidence}) · size: ${report.size} B · evidence kept: ${report.spent} B of ${report.budget} B`);
  if (report.hints.length) for (const h of report.hints) L.push(`hint: ${h}`);
  if (report.builds.length) L.push(`built with: ${report.builds.map(b => b.label).join(", ")}`);
  L.push(`plan: ${report.plan}`);
  L.push("");
  for (const r of report.results) {
    const head = `[${r.status}] ${r.id} — ${r.title}`;
    if (r.status !== "ok") { L.push(`${head}\n  reason: ${r.reason || r.note || ""}\n  instead: ${(r.fallback || "").slice(0, 160)}`); continue; }
    L.push(`${head}  (${r.bytes} B, ${r.ms} ms${r.truncated ? ", truncated" : ""})`);
    const body = r.output.trim();
    if (!body) { L.push("  (no output)"); continue; }
    const clipped = body.length > maxOutput ? body.slice(0, maxOutput) + `\n  … ${body.length - maxOutput} more bytes in recon.json` : body;
    L.push(clipped.split("\n").map(l => "  " + l).join("\n"));
  }
  return L.join("\n");
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
