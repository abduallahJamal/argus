import test from "node:test";
import assert from "node:assert/strict";
import { median, quantile, bootstrapCI, normalizeRow, summarize, toMarkdown, toHtml } from "../src/report.mjs";

const rows = [
  { arm: "a", task: "t1", wall_s: 10, turns: 4, cost: 0.1, tokens: 1000, weighted: 1 },
  { arm: "a", task: "t1", wall_s: 12, turns: 5, cost: 0.2, tokens: 1200, weighted: 0.8 },
  { arm: "a", task: "t2", wall_s: 30, turns: 9, cost: 0.4, tokens: 3000, weighted: 0.6 },
  { arm: "b", task: "t1", wall_s: 20, turns: 8, cost: 0.3, tokens: 2000, weighted: 0.5 },
  { arm: "b", task: "t2", wall_s: 40, turns: 12, cost: 0.6, tokens: 4000, weighted: 0.4 },
].map(normalizeRow);

test("median and quantiles", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test("bootstrap CI is deterministic and brackets the median", () => {
  const xs = [10, 12, 30];
  const a = bootstrapCI(xs, { seed: 7 });
  const b = bootstrapCI(xs, { seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a[0] <= median(xs) + 1e-9 && a[1] >= median(xs) - 1e-9);
});

test("legacy '5/5' score rows are normalised", () => {
  const r = normalizeRow({ arm: "x", task: "t", wall_s: 1, turns: 1, cost: 0, score: "5/5" });
  assert.equal(r.points, 5);
  assert.equal(r.accuracy, 1);
});

test("summaries sort best accuracy first and keep n", () => {
  const s = summarize(rows);
  assert.equal(s[0].key, "a");
  assert.equal(s[0].n, 3);
  assert.ok(s[0].accuracy.median > s[1].accuracy.median);
});

test("markdown and html are generated from the data, not hand typed", () => {
  const md = toMarkdown(rows, { baseline: "b" });
  assert.match(md, /\| arm \| runs \|/);
  assert.match(md, /Deltas against `b`/);
  assert.match(md, /Per task/);
  const html = toHtml(rows);
  assert.match(html, /<!doctype html>/);
  assert.ok(!/https?:\/\//.test(html.replace(/http-equiv="Content-Type"/g, "")), "no external resources in the dashboard");
});
