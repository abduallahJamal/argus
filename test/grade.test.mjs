import test from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer, matches, rubric, squash } from "../src/grade.mjs";

test("version matching tolerates spacing and separator style", () => {
  assert.ok(matches("built with Go 1.27.1", { regex: "go1\\.27\\.1" }));
  assert.ok(matches("go1.27.1", { regex: "go1\\.27\\.1" }));
  assert.ok(matches("v2_16_1", { literal: "v2.16.1" }));
});

test("a longer number does not satisfy a shorter version key", () => {
  assert.equal(matches("v2.16.10", { literal: "v2.16.1" }), false);
});

test("mustNot keys award a point only when the answer is clean", () => {
  const key = { ok: { literal: "getpeereid", weight: 3 }, clean: { mustNot: ["base64"], weight: 2 } };
  const good = gradeAnswer("the peer is checked with getpeereid", key);
  assert.deepEqual([good.points, good.max], [5, 5]);
  const bad = gradeAnswer("getpeereid, and the body is base64", key);
  assert.deepEqual([bad.points, bad.max, bad.misses], [3, 5, ["clean"]]);
});

test("weights change the score, counts do not", () => {
  const key = { a: { literal: "one", weight: 3 }, b: { literal: "two", weight: 1 } };
  assert.equal(gradeAnswer("one", key).weighted, 0.75);
  assert.equal(gradeAnswer("two", key).weighted, 0.25);
});

test("rubric rewards citations and labels, and flags overconfidence", () => {
  const weak = rubric("It definitely uses AES.");
  const strong = rubric("**Findings**\n- calls TCCAccessPreflight — seen: mac_utils.node:1204\n- inferred from the TCC service string\n- unknown; would need a runtime hook");
  assert.ok(strong.score > weak.score);
  assert.equal(weak.parts.calibrated, 0);
  assert.ok(strong.parts.cites > 0);
});

test("squash removes every separator", () => {
  assert.equal(squash("Go 1.27.1-beta"), "go1271beta");
});
