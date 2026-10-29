---
title: Evidence and answer format — how to report a reverse-engineering finding
when: you are about to write the answer, or the question is "how sure are you"
keywords: [evidence, seen, inferred, unknown, confidence, report, answer, citations]
---

# Evidence

The deliverable is not "I looked at the binary". It is a set of claims that another person could re-derive in the same number of steps.

## The three labels

| Label | Means | Requires |
|---|---|---|
| **seen** | directly observed | a citation: `file:line`, symbol name, channel string, offset, captured request |
| **inferred** | a conclusion from seen facts | the facts it rests on, and the reasoning in one clause |
| **unknown** | not established | what would establish it (a specific method or tool) |

Two rules that prevent most bad answers:
1. **Not found ≠ absent.** "I did not find a permission check" is `unknown`, unless you can show the code path that would have to contain it.
2. **Static ≠ observed.** Reading `socket()+bind()` proves the capability, not that a socket was opened in the run you were asked about.

## Answer skeleton

```
**Findings** — one sentence: what the feature does, mechanically.
- claim — seen: <path:line | symbol | channel | offset>
- claim — seen: ...
- claim — inferred from <seen fact>
- open question — unknown; would need <method>

**Route** — <kind> → <commands actually run, in order>
```

Why the route line matters: it makes the answer reproducible, it lets the reader check that you actually ran something, and it is the difference between a guess and work.

## Calibration

| Situation | Write |
|---|---|
| one run, one build | "on build X, the only build I had" |
| version-dependent facts | give the version you saw it in |
| a string that implies a behaviour | quote the string, label `inferred` |
| a disassembled constant | give the constant and the call it feeds |
| two candidate channels exist | report both; say which one the preload actually exposes |
| obfuscated names | quote the obfuscated name so the reader can find it again |

## What makes an answer useless

- "The app uses AES encryption" — with no mode, no key source, no call site.
- A channel list without saying which direction each channel flows.
- Claims without paths; paths without line numbers when the file was readable.
- Restating the question as a finding.
- Padding to look thorough: 300 honest words beat 1200 hedged ones.

## Checking your own answer before sending

1. Does every bullet have a label and a citation?
2. Is there at least one thing you could not determine, stated as `unknown`? If not, you probably did not look closely enough — or the task was trivial.
3. Could someone repeat the route line and reach the same facts?
4. Did you answer the question that was asked, in the order it was asked?
