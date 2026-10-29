---
title: SQLite, plists, LevelDB, protobuf, HAR, pcap
when: the question is about local data, stored state, wire format, or captured traffic
keywords: [sqlite, plist, leveldb, protobuf, har, pcap, tshark, database, cache]
---

# Local data and captured traffic

## SQLite

Copy the database **and** its sidecars before opening it. Opening a live database can checkpoint the WAL and destroy the evidence.

```sh
cp "$T" $D/db.sqlite; [ -f "${T}-wal" ] && cp "${T}-wal" $D/db.sqlite-wal; [ -f "${T}-shm" ] && cp "${T}-shm" $D/db.sqlite-shm
sqlite3 "file:$D/db.sqlite?mode=ro" '.schema' | head -80
sqlite3 "file:$D/db.sqlite?mode=ro" "select name, (select count(*) from sqlite_master) from sqlite_master where type='table'" | head -40
sqlite3 -header -column "file:$D/db.sqlite?mode=ro" 'select * from T limit 20'
```
- `mode=ro` refuses writes; `immutable=1` also skips locking (use only on a copy).
- No sqlite3 binary: `python3 -c 'import sqlite3;c=sqlite3.connect("file:...?mode=ro",uri=True);print(c.execute("select sql from sqlite_master").fetchall())'`.
- Deleted rows often survive in free pages: `strings db.sqlite | rg -i 'NEEDLE'` and `.recover` (sqlite3 3.29+) find them.
- Chrome/Electron `History`, `Cookies`, `Login Data` are SQLite; values may be encrypted with an OS key (`v10` prefix) — say so instead of guessing.

## plists

```sh
plutil -convert json -o - F.plist | jq . | head -60
plutil -p F.plist | head -60
python3 -c 'import plistlib,sys,json;print(json.dumps(plistlib.load(open(sys.argv[1],"rb")),indent=1,default=str))' F.plist
```

## LevelDB / IndexedDB / Chrome storage

```sh
ls "$DIR" | head; strings -a "$DIR"/*.ldb 2>/dev/null | head -40
ldb --db="$DIR" dump 2>/dev/null | head -40      # if `ldb` is installed
```
Electron apps keep `Local Storage/leveldb`, `IndexedDB`, and `Session Storage` here. Keys and values are usually plain inside `.ldb`/`.log` files; JSON values survive `strings`.

## protobuf / gRPC without a schema

```sh
protoc --decode_raw < msg.bin | head -40
python3 -c 'import sys;d=open(sys.argv[1],"rb").read();print(d[:64].hex())' msg.bin
```
Without `protoc`, read the wire format directly: field 1 varint (`08`), field 2 length-delimited (`12`), strings are visible in `strings`.

For gRPC over HTTP/2, capture with tshark and read the `:path` header — that names the RPC (`/pkg.Service/Method`) even when the body is binary:
```sh
tshark -r cap.pcap -Y http2 -T fields -e http2.headers.path | sort | uniq -c | sort -rn | head -20
```

## HAR

```sh
jq -r '.log.entries[] | .request.method + " " + .request.url' F.har | head -40
jq -r '.log.entries[] | select(.response.content.mimeType|test("json")) | .request.url' F.har | head
jq -r '.log.entries[0] | {url: .request.url, req: .request.postData.text, res: .response.content.text}' F.har | head -40
```

## pcap / pcapng

```sh
tshark -r cap.pcap -q -z conv,tcp | head -30
tshark -r cap.pcap -q -z io,phs | head -30
tshark -r cap.pcap -T fields -e dns.qry.name -e tls.handshake.extensions_server_name | rg -v '^\s*$' | sort -u | head -40
tshark -r cap.pcap -T fields -e http.request.method -e http.request.full_uri | rg -v '^\s*$' | head -40
```
- TLS means no payload unless you have the key log (`SSLKEYLOGFILE` + `-o tls.keylog_file:keys.log`).
- Follow one stream: `tshark -r cap.pcap -q -z follow,tcp,ascii,3`.

## Traps

- Timestamps are usually UTC in pcap; local-time assumptions produce wrong conclusions about ordering.
- A "SQLite" file with a `-wal` containing most of the data looks empty without the WAL: the copy step is not optional.
- `strings` on LevelDB gives keys and values but not their pairing; pair them by proximity in one `.ldb` block, not across files.
