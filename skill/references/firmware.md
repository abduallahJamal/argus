---
title: Firmware and unknown blobs — entropy, extraction, re-routing
when: the target is a firmware image, a router/IoT dump, an installer payload, or an unrecognised blob
keywords: [firmware, binwalk, unblob, squashfs, ubi, entropy, iot, router, blob]
---

# Firmware and unknown blobs

An unknown blob is rarely one artifact. Measure it, cut it, then send each piece back through the router.

## Step 1 — measure before extracting

```sh
python3 - <<'PY'
import math, collections
d = open('fw.bin','rb').read(4<<20)
c = collections.Counter(d)
e = -sum(v/len(d)*math.log2(v/len(d)) for v in c.values())
print(f'entropy {e:.2f} bits/byte  (>7.9 ~ compressed/encrypted, <6 ~ structured)')
for magic, name in [(b'hsqs','squashfs'),(b'sqsh','squashfs-be'),(b'UBI#','UBI'),(b'\x27\x05\x19\x56','uImage'),
                    (b'\x85\x19\x03\x20','JFFS2'),(b'\x1f\x8b\x08','gzip'),(b'BZh','bzip2'),(b'\xfd7zXZ','xz'),
                    (b'D0\x0d\xfe\xed','dtb'),(b'cramfs','cramfs'),(b'\x00\x00\x00\x00hsqs','?')]:
    i = d.find(magic)
    if i >= 0: print(f'{name:12s} at 0x{i:x}')
PY
```
A block-aligned scatter of filesystem magics = a partitioned image. Uniform 7.99 entropy with no magics = compressed or encrypted: look for a header that names the algorithm, or a vendor-specific signature before the payload.

## Step 2 — extract

```sh
unblob -e $D/fw fw.bin 2>/dev/null | tail -5 || binwalk -e --run-as=root -C $D/fw fw.bin | tail -10
ls -R $D/fw | head -30
```
`unblob` is safer and handles more formats than binwalk; use it first. Per-format tools when they fail:

| Format | Tool |
|---|---|
| squashfs | `unsquashfs -d $D/rootfs fw.squashfs` (add `-no-xattrs` if it errors) |
| UBI | `ubireader_extract_images`, then `ubireader_extract_files` |
| JFFS2 | `jefferson -d $D/rootfs fw.jffs2` |
| cramfs | `cramfsck -x $D/rootfs fw.cramfs` |
| uImage/kernel | `binwalk -e` on it again (gzip inside) |
| encrypted vendor container | look for the decryption tool in the vendor's update utility, or a known key in the firmware's own updater |

## Step 3 — re-route every piece

```sh
find $D/fw -type f -size +100k | head -20 | while read f; do echo "== $f"; argus detect "$f"; done
```

Typical findings and where they lead:
- ELF binaries with `busybox`-style names → `argus ref native-elf`, and check `readelf -dW | rg NEEDED` for the vendor SDK.
- `etc/init.d/`, `etc/rc.d/` → startup behaviour and enabled services; read these before reversing any binary.
- `passwd`/`shadow` (hashes), `dropbear` keys, `nginx.conf` with certs → the security posture, and often the actual answer.
- Web UI under `www/` → treat as a web bundle: `rg -n 'cgi|/api/' www | head`.
- `lib*.so` with vendor prefixes → the real logic usually lives in a single proprietary library.

## Step 4 — verify with strings, not guesses

```sh
strings -a $D/fw/rootfs/lib/libvendor.so | rg -i 'version|usage|error' | head -20
readelf -hW $D/fw/rootfs/bin/httpd | rg 'Machine|Type'
```
Architecture matters early: an ARM32 big-endian binary needs a different objdump target and different struct offsets. `file` on each ELF gives it.

## Traps

- Never mount or execute firmware filesystems as root on your workstation. Work on the extracted copy.
- `binwalk -e` can produce dozens of false-positive cuts on high-entropy data; confirm each candidate by magic bytes before trusting the tree.
- Nested images (a squashfs inside an encrypted container inside a UBI) need one extra round: re-run the entropy/magic step on each extracted file, not just at the top.
- A single `squashfs` with no binaries is normal — the logic may be in a web UI or a Lua/Python bundle. Say what you found, do not force a native analysis.
