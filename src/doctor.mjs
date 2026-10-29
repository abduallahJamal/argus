// argus/doctor.mjs — what this machine can and cannot do, and what to use instead.
import { TOOLS, PLATFORM, resolveTool, installHint } from "./tools.mjs";

export function doctor({ json = false } = {}) {
  const rows = TOOLS.map(t => {
    const r = resolveTool(t.id, t);
    return {
      id: t.id, tier: t.tier, why: t.why, present: r.present, path: r.path, version: r.version,
      platforms: t.platforms, install: installHint(t), fallback: t.fallback,
    };
  });
  const core = rows.filter(r => r.tier === "core");
  const missingCore = core.filter(r => !r.present);
  const coverage = {
    core: `${core.length - missingCore.length}/${core.length}`,
    all: `${rows.filter(r => r.present).length}/${rows.length}`,
  };
  if (json) return { platform: PLATFORM, node: process.version, coverage, rows };
  const lines = [];
  lines.push(`argus doctor — platform: ${PLATFORM} · node: ${process.version} · core tools: ${coverage.core} · all: ${coverage.all}`);
  lines.push("");
  const pad = Math.max(...rows.map(r => r.id.length));
  for (const tier of ["core", "alt", "niche"]) {
    const group = rows.filter(r => r.tier === tier);
    if (!group.length) continue;
    lines.push(`[${tier}]`);
    for (const r of group) {
      const mark = r.present ? "ok  " : "--  ";
      const v = r.version ? ` ${r.version.replace(/\s+/g, " ").slice(0, 40)}` : "";
      lines.push(`  ${mark}${r.id.padEnd(pad)}${v}`);
      if (!r.present) {
        const support = r.platforms.includes(PLATFORM) ? "" : ` (not for ${PLATFORM})`;
        lines.push(`        install: ${r.install || "n/a"}${support}`);
        lines.push(`        instead: ${r.fallback}`);
      }
    }
    lines.push("");
  }
  if (missingCore.length) {
    lines.push(`missing core tools change the route, not the answer:`);
    for (const r of missingCore) lines.push(`  - ${r.id}: ${r.fallback}`);
  } else lines.push("all core tools present: plans run as written.");
  return lines.join("\n");
}

/** Which kinds are fully covered by the tools on this machine. */
export function coverageFor(kinds, planFor) {
  const out = [];
  for (const k of kinds) {
    const plan = planFor({ kind: k });
    const t1 = plan.steps.filter(s => s.tier === 1);
    const missing = [...new Set(t1.flatMap(s => s.missing))];
    out.push({ kind: k, tier1: `${t1.length - t1.filter(s => !s.runnable).length}/${t1.length}`, missing });
  }
  return out;
}
