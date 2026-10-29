// argus/bench/report.mjs — render the generated tables and the HTML dashboard from a results file.
//   node bench/report.mjs [--results results/run.jsonl] [--baseline none] [--out dashboard.html]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuns, toMarkdown, toHtml } from "../src/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const argv = process.argv.slice(2);
const val = (f, d) => (argv.includes(`--${f}`) ? argv[argv.indexOf(`--${f}`) + 1] : d);

const results = path.resolve(val("results", path.join(HERE, "results", "run.jsonl")));
if (!fs.existsSync(results)) {
  console.error(`no results file at ${results}\nrun: node bench/setup.mjs && node bench/run.mjs --reps 3`);
  process.exit(2);
}
const rows = loadRuns(results);
const title = val("title", `argus benchmark — ${path.basename(results)}`);
const md = toMarkdown(rows, { baseline: val("baseline", "none"), title });
const mdOut = path.resolve(val("md", path.join(HERE, "RESULTS.md")));
const htmlOut = path.resolve(val("out", path.join(HERE, "dashboard.html")));
fs.writeFileSync(mdOut, md + "\n");
fs.writeFileSync(htmlOut, toHtml(rows, { title }));
console.log(`runs: ${rows.length}`);
console.log(`markdown: ${path.relative(ROOT, mdOut)}`);
console.log(`html:     ${path.relative(ROOT, htmlOut)}`);
const dry = rows.filter(r => r.dry).length;
if (dry) console.warn(`warning: ${dry}/${rows.length} rows are synthetic dry rows — not model results`);
