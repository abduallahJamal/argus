# Contributing to argus

Three kinds of contribution matter, in this order.

## 1. A new plan (a new artifact kind)

`src/plan.mjs` maps a kind to ordered steps. A step must have:

- `tier` — 1 = safe cheap inventory, 2 = targeted, 3 = deep
- `cmd` — what a human would actually paste (`$T` = target, `$D` = work dir)
- `gives` or `why` — what it buys the agent
- **`fallback`** — what to do when the tool is missing. `argus check` fails without this.
- `alt` — per-platform commands (`mac` / `linux` / `win`) when they differ
- `needs` — tool ids from `src/tools.mjs`, so `doctor` and `recon` can reason about them

Then add a fixture in `bench/mkfixtures.mjs` and an entry in `expected.json` so routing is tested offline.

## 2. A new reference topic

`skill/references/<id>.md`, with frontmatter:

```
---
title: What it covers
when: the one-sentence trigger for loading it
keywords: [word, another, third]
---
```

Rules:

- Under 14 KB (`argus check` enforces it), ideally 2–4 KB.
- Commands must be real and copy-pasteable, with the traps named next to them.
- Do not repeat the router table from `SKILL.md`.
- Any `argus ref <id>` you mention must resolve.
- No `TODO`/`FIXME` — a half-written reference is worse than none.

**Never add depth to `SKILL.md`.** The 9 KB budget is the product. If a fact does not fit, it belongs in a reference.

## 3. A benchmark task or fixture

- Targets must be open: a file this repo generates, a compiled source file in `bench/targets/`, or an open-source release pinned by sha256 in `fixtures.lock.json`.
- Never commit third-party binaries or extracted app bundles.
- Keys must be weighted, and literal keys must match literally (`{"literal": "..."}`), not as loose regexes.
- Include at least one `mustNot` key per task: something a plausible-but-wrong answer would say.
- If you publish numbers: put the results file in the PR, plus the model, git sha and `tasks.json` hash. Numbers without a results file will not be merged.

## Before you open a PR

```sh
node bench/mkfixtures.mjs
node --test test/*.test.mjs
node bin/argus.mjs check --fixtures
node bin/argus.mjs build
node bench/run.mjs --dry --reps 2        # the harness must still work end to end
```

All five must be clean. If you changed the skill or references, say so in the PR description along with the new sizes.

## Style

- Zero dependencies. If a feature needs a package, it needs a better design.
- No target is ever executed by `detect`/`plan`. New code must keep that property.
- Output that an agent reads should be capped by construction (`head`, a budget, a quota), not by hope.
- Prefer a recorded `unknown` to a confident guess, in code comments and in docs alike.
