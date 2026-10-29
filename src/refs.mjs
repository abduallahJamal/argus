// argus/refs.mjs — progressive disclosure: the skill stays tiny, references are pulled on demand.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REF_DIR = path.join(ROOT, "skill", "references");

function parseFront(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    meta[k] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function loadRefs() {
  if (!fs.existsSync(REF_DIR)) return [];
  return fs.readdirSync(REF_DIR).filter(f => f.endsWith(".md")).sort().map(f => {
    const raw = fs.readFileSync(path.join(REF_DIR, f), "utf8");
    const { meta, body } = parseFront(raw);
    return { id: f.replace(/\.md$/, ""), file: path.join(REF_DIR, f), bytes: Buffer.byteLength(raw), meta, body };
  });
}

export function getRef(id) {
  const refs = loadRefs();
  const exact = refs.find(r => r.id === id);
  if (exact) return exact;
  const norm = String(id || "").toLowerCase();
  return refs.find(r => (r.meta.keywords || []).some(k => k.toLowerCase() === norm)) ||
    refs.find(r => r.id.includes(norm)) || null;
}

export function listRefs({ json = false } = {}) {
  const refs = loadRefs().map(r => ({
    id: r.id,
    title: r.meta.title || r.id,
    when: r.meta.when || "",
    keywords: r.meta.keywords || [],
    bytes: r.bytes,
  }));
  if (json) return refs;
  const w = Math.max(...refs.map(r => r.id.length), 8);
  return refs.map(r => `${r.id.padEnd(w)}  ${(r.title || "").padEnd(34)}  ${(r.bytes / 1024).toFixed(1)} KB  ${r.when}`.trimEnd()).join("\n");
}

/** Print one reference, or the section of it that matches `q`. */
export function printRef(id, q) {
  const ref = getRef(id);
  if (!ref) {
    const near = loadRefs().map(r => r.id).filter(x => x.includes(String(id).slice(0, 3)));
    return `no reference "${id}".${near.length ? ` close matches: ${near.join(", ")}` : ` try: argus refs`}`;
  }
  let body = ref.body.trim();
  if (q) {
    const lines = body.split("\n");
    const keep = new Set();
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes(String(q).toLowerCase())) for (let j = Math.max(0, i - 4); j <= Math.min(lines.length - 1, i + 6); j++) keep.add(j);
    });
    if (keep.size) body = [...keep].sort((a, b) => a - b).map(i => lines[i]).join("\n");
    else return `# ${ref.id}: no line matches "${q}". The whole reference is ${(ref.bytes / 1024).toFixed(1)} KB; run \`argus ref ${ref.id}\`.`;
  }
  return `# ref/${ref.id} — ${ref.meta.title || ""}\n# when: ${ref.meta.when || ""}\n\n${body}`;
}
