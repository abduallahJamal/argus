// argus/build.mjs — one source of truth, many agent formats. Keeps the skill small by construction.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadRefs } from "./refs.mjs";

export const LIMITS = { skillKB: 9, flatKB: 26, refKB: 14 };

const sha = b => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);

function write(outDir, rel, content) {
  const p = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return { rel, bytes: Buffer.byteLength(content), sha: sha(content) };
}

function refIndexTable(refs) {
  const rows = refs.map(r => `| \`${r.id}\` | ${r.meta.title} | ${r.meta.when} |`);
  return ["| ref | topic | pull it when |", "|---|---|---|", ...rows].join("\n");
}

export function build({ outDir = path.join(ROOT, "dist"), quiet = false } = {}) {
  const skillPath = path.join(ROOT, "skill", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf8");
  const refs = loadRefs();
  const skillKB = Buffer.byteLength(skill) / 1024;
  const oversize = skillKB > LIMITS.skillKB ? refIndex() : null;
  const files = [];

  // 1. Claude Code / OpenCode / Codex skills layouts (SKILL.md + on-demand references/)
  for (const [prefix, dir] of [
    ["claude-code", ".claude/skills/argus"],
    ["opencode", ".config/opencode/skills/argus"],
    ["codex", ".agents/skills/argus"],
  ]) {
    files.push(write(outDir, `${prefix}/${dir}/SKILL.md`, skill));
    for (const r of refs) {
      files.push(write(outDir, `${prefix}/${dir}/references/${r.id}.md`, fs.readFileSync(r.file)));
    }
  }

  // 2. AGENTS.md (Codex, opencode, aider, anything that reads a repo file)
  const agents = `${skill.trim()}\n\n## Reference library\n\nThe core above is deliberately small. When a step needs depth, pull one reference:\n\n\`\`\`sh\nargus refs                 # list topics\nargus ref electron         # full reference\nargus ref electron --grep ipc   # only the matching slice\n\`\`\`\n\n${refIndexTable(refs)}\n`;
  files.push(write(outDir, "agents/AGENTS.md", agents));

  // 3. Cursor rule (MDC frontmatter)
  const cursor = `---\ndescription: Argus — route any shipped artifact (Electron, native, Go, Rust, .NET, JVM, Android, iOS, Unity, Flutter) to the fastest local command. Use when reverse engineering a binary, bundle or app.\nglobs: ["**/*"]\nalwaysApply: false\n---\n\n${skill.trim()}\n\nReference topics: ${refs.map(r => `\`${r.id}\``).join(", ")}. Run \`argus ref <topic>\` to load one.\n`;
  files.push(write(outDir, "cursor/.cursor/rules/argus.mdc", cursor));

  // 4. Gemini CLI
  files.push(write(outDir, "gemini/GEMINI.md", skill.trim() + "\n\n" + `Reference topics (\`argus ref <topic>\`): ${refs.map(r => r.id).join(", ")}.\n`));

  // 5. Copilot instructions
  files.push(write(outDir, "copilot/.github/copilot-instructions.md", `# Reverse engineering with argus\n\n${skill.trim()}\n\nRun \`argus ref <topic>\` for depth; topics: ${refs.map(r => r.id).join(", ")}.\n`));

  // 6. Flat, self-contained prompt for agents with no CLI and no skill support.
  //    Router + rules + the top-5 bullets of every reference, capped.
  const condensed = refs.map(r => {
    const bullets = r.body.split("\n").filter(l => /^\s*[-*|]/.test(l)).slice(0, 4).join("\n");
    return `### ${r.id} — ${r.meta.title}\n${bullets}`;
  }).join("\n\n");
  let flat = `${skill.trim()}\n\n## Condensed reference appendix\n\n${condensed}\n`;
  if (Buffer.byteLength(flat) / 1024 > LIMITS.flatKB) {
    flat = flat.slice(0, LIMITS.flatKB * 1024) + `\n\n[truncated at ${LIMITS.flatKB} KB — install argus for the full references]\n`;
  }
  files.push(write(outDir, "flat/argus-flat.md", flat));

  const manifest = {
    generated: new Date().toISOString(),
    limits: LIMITS,
    skillKB: Number(skillKB.toFixed(2)),
    refs: refs.length,
    refsKB: Number((refs.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1)),
    files,
    ok: !oversize,
    problems: oversize ? [oversize] : [],
  };
  files.push(write(outDir, "manifest.json", JSON.stringify(manifest, null, 1)));
  return manifest;
}

function refIndex() {
  return `skill/SKILL.md exceeds the ${LIMITS.skillKB} KB budget: move detail into skill/references/ and link it with \`argus ref <id>\`. The size cap is the product.`;
}
