# Authorized use

argus is a static-analysis router. It reads files you already have and tells an agent which local
command to run next. Like `objdump`, `strings` or `tshark`, it is a general-purpose tool; whether a
particular use is legitimate depends on what you point it at.

## In scope

- Software you own or wrote, including your own release builds.
- Software you have written permission to analyse (a client engagement, a bug-bounty scope, a vendor NDA).
- Analysis permitted by law where you are, for interoperability, security research, education, or
  investigating software running on hardware you control.
- Open-source software, under its licence terms.

## Out of scope

- Removing licence checks, activation, DRM or anti-cheat from software you do not own.
- Extracting credentials, keys or user data from other people's devices or accounts.
- Republishing extracted third-party code, assets or proprietary logic.
- Anything that would break a law in your jurisdiction or a contract you signed.

The skill states this in its rules on purpose: an agent asked to "crack this app" should explain the
mechanism at a conceptual level and decline the circumvention step. That behaviour is a feature.

## What argus does not do

- It never executes a target. `detect` and `plan` read bytes only. `recon` runs *inventory* commands
  (readelf, nm, strings, otool, strings-like tools) — not the artifact itself.
- It does not include sample proprietary binaries. Benchmark targets are generated in this repo, compiled
  from sources in this repo, or open-source releases pinned by hash and downloaded at your request.
- It does not bundle crackers, keygen tooling or anti-anti-debugging payloads. It does document runtime
  tracing (Frida, lldb) because that is standard security-research tooling.

## Reporting

If you believe some part of this repository crosses a line, open an issue describing which part and why.
Security-relevant reports about argus itself should go through the repository's security advisories.
