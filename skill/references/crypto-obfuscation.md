---
title: Crypto, packing and obfuscation — identify before reversing
when: the target is packed, strings look like garbage, or the question is about keys, hashes and checks
keywords: [crypto, packing, upx, themida, vmprotect, obfuscation, aes, keychain, hashing]
---

# Crypto, packing, obfuscation

Most "the binary is encrypted" conclusions are wrong. Order of operations: identify the packer, identify the crypto primitive, find where the key comes from. Only then try to reverse anything.

## Packed?

```sh
strings -a "$T" | rg -m3 'UPX!|MPRESS|ASPack|Themida|VMProtect|Enigma|Obsidium|PECompact'
readelf -SW "$T" 2>/dev/null | head -20        # section names like .upx0/.upx1, high entropy .text
otool -l "$T" 2>/dev/null | rg -A2 'sectname' | head -20
```
- UPX: `upx -d "$T" -o $D/unpacked` and continue. Nothing else to say about UPX.
- Themida/VMProtect/Enigma: unpacking is a research project. Report `packed: <name>`, say the static evidence is limited, and offer the runtime route (hook after unpacking, dump memory once the process is running on a test machine).
- Custom packer: entry point in the last section, a `VirtualAlloc` + `memcpy` + indirect jump loop. Confirm with the entropy of `.text` vs `.rdata`.

## Which primitive?

```sh
nm -u "$T" 2>/dev/null | rg -i 'CCKeyDerivation|CCCrypt|SecKey|SecItem|EVP_|BCrypt|Crypt|AES|SHA|PBKDF|scrypt|argon'
strings -a "$T" | rg -i 'aes-?(128|256)|chacha20|hmac-sha|pbkdf2|argon2|bcrypt|scrypt|base64' | head -20
```
Library call names are the answer to "what crypto": `CCCrypt` with `kCCAlgorithmAES` is AES-CBC/ECB, `CCKeyDerivationPBKDF` with `kCCPRFHmacAlgSHA256` is PBKDF2-HMAC-SHA256, `EVP_aes_256_gcm` is AES-GCM, `CryptoKit`/`swift-crypto` shows as `Crypto` symbols.

## Where does the key come from?

This is the only question that matters, and it has five common answers:

| Seen | Key source |
|---|---|
| `SecItemCopyMatching`, `kSecClassGenericPassword` | OS Keychain — not in the binary. The answer is "key stored in the Keychain under service X". |
| `SecRandomCopyBytes`, `RAND_bytes` at startup | random per-install key, stored somewhere (look for a file write right after) |
| a hardcoded 16/32-byte array with `EVP_DecryptInit` next to it | hardcoded key: dump the bytes, they are the finding |
| `PBKDF2(password, salt)` with a user-visible password | derived from user input, iteration count visible in the disassembly |
| key exchange (`ECDH`, `X25519`, `TLS`) | not extractable by design; say so |

## Obfuscation that is not crypto

- Base64/hex blobs that decode to text: decode them, do not reverse the decoder.
- XOR with a single byte or a repeating key: recover the key from known plaintext (`{"`, `http`, `PK`), then decrypt.
- String encryption with a per-string index: find the decrypt function, reimplement it in 10 lines, dump the whole table.
- Control-flow flattening: not worth undoing to answer a feature question. Name the API calls instead — they keep their names.

## Traps

- A "hash" that is 32 hex characters may be MD5; check length (32 hex = MD5, 40 = SHA-1, 64 = SHA-256) before asserting.
- Do not claim a key is hardcoded from a random-looking string: confirm it is fed into the crypto call.
- macOS/Windows disk encryption, Keychain, DPAPI and keystores are designed so the answer is "the OS holds it, user-scoped". That is a complete finding, not a failure.
- Refuse to help remove licence checks, DRM or anti-cheat for software you do not own; explain the mechanism at a conceptual level instead.
