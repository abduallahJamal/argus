// argus/plan.mjs — turn a detected artifact into an ordered, budgeted command plan.
import { PLATFORM, resolveTool } from "./tools.mjs";

const S = (o) => ({ tier: 1, needs: [], gives: "", fallback: "", alt: {}, ...o });

/** Per-kind plans. Tier 1 = inventory (safe, cheap). Tier 2 = targeted. Tier 3 = deep. */
const PLANS = {
  macho: {
    summary: "Native Mach-O: read the import list before any disassembly. Imports are the capability map.",
    steps: [
      S({ id: "arch", title: "Architecture + linked libs", needs: ["lipo", "otool"], gives: "arch, dylibs, minimum OS",
        cmd: "T=$T; file -b \"$T\"; lipo -info \"$T\" 2>/dev/null; otool -L \"$T\" | head -40",
        alt: { linux: "file -b $T; llvm-objdump -p $T | head -40" },
        fallback: "llvm-objdump -p, or python macholib: `python3 -c \"from macholib.MachO import MachO; ...\"`" }),
      S({ id: "exports", title: "Exports (what JS or the loader can call)", needs: ["nm"], gives: "the public surface",
        cmd: "nm -gU \"$T\" 2>/dev/null | head -150", fallback: "llvm-nm -gU, or `dyld_info -exports`" }),
      S({ id: "imports", title: "Imports (what it depends on = what it can do)", needs: ["nm"], gives: "TCC, sockets, crypto, frameworks",
        cmd: "nm -u \"$T\" 2>/dev/null | tr '\\n' ' ' | fold -w 200 | head -20", fallback: "`otool -L` + `strings` inside the __TEXT segment" }),
      S({ id: "strings", title: "Strings, filtered", needs: ["strings"], gives: "channel names, paths, URLs, error text",
        cmd: "strings -a -n 6 \"$T\" | rg -v '^[_$.]' | head -400", fallback: "`rg -a -o '[[:print:]]{6,}' $T | head -400`" }),
      S({ id: "ents", title: "Entitlements + code signature", needs: ["codesign"], gives: "sandbox, TCC usage, hardened runtime",
        cmd: "codesign -d --entitlements :- \"$T\" 2>/dev/null | head -60; codesign -dv \"$T\" 2>&1 | head -12",
        alt: { linux: "otool -s __TEXT __entitlements $T 2>/dev/null | head -20" }, fallback: "`otool -s __TEXT __entitlements` (not on Linux)" }),
      S({ id: "objc", tier: 2, title: "ObjC/Swift classes and selectors", needs: ["otool"], gives: "the class map of the app",
        cmd: "otool -ov \"$T\" 2>/dev/null | rg 'name|meth name' | head -120; xcrun swift-demangle --compact < <(nm -gU \"$T\" | awk '{print $NF}') 2>/dev/null | head -40",
        fallback: "`strings F | rg '^[A-Z][A-Za-z]+$'` gives a rough class list; or Ghidra with the ObjC analyzer" }),
      S({ id: "dis", tier: 3, title: "Disassemble once, grep forever", needs: ["otool"], gives: "one text file you can rg",
        cmd: "otool -tV \"$T\" > $D/dis.txt; wc -l $D/dis.txt; rg -n '^_?[A-Za-z].*:$' $D/dis.txt | head -150",
        alt: { linux: "llvm-objdump -d --no-show-raw-insn -C $T > $D/dis.txt" },
        fallback: "`llvm-objdump -d` or `objdump -d -M intel`" }),
      S({ id: "fn", tier: 3, title: "Read one function only", needs: [],
        cmd: "awk '/^_FUNC:$/{p=1;next} p&&/^[_A-Za-z].*:$/{exit} p' $D/dis.txt | rg 'bl|b\\.|cmp|literal|mov\\s+w2' | head -60",
        why: "otool prints the C++ symbol and the string literal inline at each `bl`, so the call trail reads like pseudo-code",
        fallback: "`r2 -qc 'aaa; pdf @ sym._FUNC' F`, or Ghidra for C" }),
    ],
  },

  "macho-fatal": {
    summary: "Universal binary. Thin it first: analyzing every slice at once wastes the budget.",
    steps: [
      S({ id: "info", title: "List slices", needs: ["lipo"], cmd: "T=$T; lipo -info \"$T\"; lipo -detailed_info \"$T\" | head -30",
        alt: { linux: "llvm-lipo -info $T" }, gives: "arch list", fallback: "`file $T` lists the architectures too" }),
      S({ id: "thin", title: "Thin to the host arch", needs: ["lipo"], cmd: "lipo -thin arm64 -output $D/thin.bin \"$T\" && file -b $D/thin.bin",
        alt: { linux: "llvm-lipo -thin arm64 -o $D/thin.bin $T" }, gives: "one slice under $D", fallback: "`lipo -extract_family arm64` or offset-slice with dd using `lipo -detailed_info` offsets" }),
      S({ id: "then", title: "Re-run argus on the slice", needs: [], cmd: "argus plan $D/thin.bin", gives: "the Mach-O plan", fallback: "read the macho reference directly: `argus ref macho`" }),
    ],
  },

  elf: {
    summary: "ELF: readelf first. Package names in NEEDED and version strings often answer the question outright.",
    steps: [
      S({ id: "head", title: "Type, arch, entry, libs", needs: ["readelf"], cmd: "T=$T; file -b \"$T\"; readelf -hlSW \"$T\" | head -60; echo '--- NEEDED'; readelf -dW \"$T\" | rg NEEDED | head -40",
        alt: { mac: "llvm-readelf -hlSW $T | head -60" }, gives: "shared/static, PIE, needed libs", fallback: "`objdump -p` / `llvm-readobj`" }),
      S({ id: "sym", title: "Dynamic exports", needs: ["nm", "readelf"], cmd: "nm -D --defined-only \"$T\" 2>/dev/null | head -120", fallback: "`readelf -Ws | rg 'GLOBAL.*DEFAULT'`" }),
      S({ id: "strings", title: "Strings", needs: ["strings"], cmd: "strings -a -n 6 \"$T\" | rg -v '^\\.' | head -400", fallback: "`rg -a -o '[[:print:]]{6,}' $T | head -400`" }),
      S({ id: "sec", tier: 2, title: "Interesting sections", needs: ["readelf"], cmd: "readelf -SW \"$T\" | rg -i 'debug|comment|note|dep|go.build|gopclntab'",
        gives: "is it stripped? is there build metadata?", fallback: "`objdump -h`" }),
      S({ id: "dis", tier: 3, title: "Disassemble and grep", needs: ["objdump"], cmd: "objdump -d --no-show-raw-insn -C \"$T\" > $D/dis.txt; rg -n 'call.*<(geteuid|socket|connect|getpeereid|fork|exec)' $D/dis.txt | head -40",
        alt: { mac: "llvm-objdump -d --no-show-raw-insn -C $T > $D/dis.txt" }, fallback: "`r2 -qc 'aaa; afl~!' F`" }),
    ],
  },

  pe: {
    summary: "PE: imports + version resource usually beat disassembly. Check the signature before trusting anything.",
    steps: [
      S({ id: "head", title: "Headers and imports", needs: ["objdump"], cmd: "T=$T; file -b \"$T\"; objdump -x \"$T\" | rg -A40 'The Import Tables' | head -60; objdump -p \"$T\" | rg -A20 'DLL Name'",
        alt: { win: "dumpbin /headers $T | more; dumpbin /imports $T | more" }, fallback: "`llvm-readobj --coff-imports F`; python `pefile` if installed" }),
      S({ id: "ver", title: "Version resource / manifest", needs: ["strings"], gives: "product name, company, requestedExecutionLevel",
        cmd: "strings -a -el \"$T\" | rg -i 'fileversion|productname|companyname|originalfilename' | head -20; strings -a \"$T\" | rg -i 'requestedExecutionLevel|dpiAware' | head",
        alt: { win: "powershell -c \"(Get-Item $T).VersionInfo | Format-List *\"" }, fallback: "`wrestool -x -t version F`" }),
      S({ id: "sig", title: "Authenticode signature", needs: ["sigcheck"], cmd: "sigcheck -a \"$T\" | head -20",
        alt: { win: "powershell -c \"Get-AuthenticodeSignature $T | fl\"" }, fallback: "`osslsigncode verify -in F`" }),
      S({ id: "dotnet", title: "Is it .NET?", needs: [], cmd: "strings -a \"$T\" | rg -m2 'mscoree.dll|BSJB|System\\.Runtime'",
        why: "if yes, jump to the dotnet plan; IL is far easier than x86", fallback: "argus detect already flags it via BSJB/mscoree markers" }),
      S({ id: "dis", tier: 3, title: "Disassemble", needs: ["objdump"], cmd: "objdump -d -M intel \"$T\" > $D/dis.txt; rg -n 'call.*<(WSAStartup|RegOpenKey|CreateFile|InternetOpen)' $D/dis.txt | head -30",
        alt: { win: "dumpbin /disasm $T > dis.txt" }, fallback: "Ghidra headless" }),
    ],
  },

  dotnet: {
    summary: ".NET: IL decompiles almost perfectly. Go straight to ilspycmd, there is nothing to guess.",
    steps: [
      S({ id: "decompile", title: "Decompile to a project", needs: ["ilspycmd"], cmd: "ilspycmd -p -o $D/src \"$T\" >/dev/null && find $D/src -name '*.cs' | head -40",
        gives: "readable C#", fallback: "`dotnet tool install -g ilspycmd`; or dnSpy/dotPeek on Windows; or `monodis`" }),
      S({ id: "search", title: "Search the decompiled tree", needs: [], cmd: "rg -n --type cs 'DllImport|Process\\.Start|Registry|HttpClient|Decrypt|Assembly\\.Load' $D/src | head -60",
        why: "P/Invoke and reflection are where the interesting behaviour hides", fallback: "`grep -rn` on the same tree" }),
      S({ id: "attr", tier: 2, title: "Assembly attributes and version", needs: ["strings"], cmd: "strings -a \"$T\" | rg -i 'AssemblyVersion|TargetFramework|AssemblyFileVersion' | head -10", fallback: "`ilspycmd -l c F` for a type list" }),
      S({ id: "aot", tier: 2, title: "NativeAOT / ReadyToRun check", needs: [], cmd: "strings -a \"$T\" | rg -m3 'System\\.Private\\.CoreLib|ILCompiler|ReadyToRun'",
        why: "if present this is not IL any more: treat it as a native binary", fallback: "argus detect shows both pe and dotnet markers" }),
    ],
  },

  go: {
    summary: "Go: `go version -m` answers version, module, deps and build flags in one call. No Go installed? Parse .go.buildinfo.",
    steps: [
      S({ id: "buildinfo", title: "Build info", needs: ["go"], cmd: "go version -m \"$T\" | head -40",
        gives: "toolchain, main path, deps, build flags (vcs.*, -trimpath)",
        fallback: "`strings -a F | rg -m1 -A200 'Go buildinf'`; or python: read the magic, follow ptrSize, zlib-inflate the strings block" }),
      S({ id: "symbols", title: "Symbols survive stripping", needs: ["go"], cmd: "go tool nm \"$T\" 2>/dev/null | rg 'main\\.|internal/' | head -80",
        why: "Go keeps pclntab, so function names are recoverable even from a stripped binary", fallback: "`rg -a -o 'main\\.[A-Za-z0-9_.]+' F | sort -u | head -60`" }),
      S({ id: "mods", title: "Dependency list from strings", needs: ["strings"], cmd: "strings -a \"$T\" | rg -o '[a-z0-9.-]+\\.[a-z]{2,}/[A-Za-z0-9_./-]+@v[0-9][^ ]*' | sort -u | head -60",
        gives: "module paths even without the Go toolchain", fallback: "`grep -ao` equivalent" }),
      S({ id: "funcs", tier: 3, title: "Locate a function", needs: ["objdump"], cmd: "go tool objdump -s 'main\\.targetFn' \"$T\" 2>/dev/null | head -80 || objdump -d --no-show-raw-insn \"$T\" > $D/dis.txt",
        fallback: "`go tool nm -size F | sort -k2 -n | tail` to find the biggest funcs, then `objdump --start-address`" }),
    ],
  },

  rust: {
    summary: "Rust: cargo-auditable gives a dependency SBOM; rustc commit gives the exact toolchain.",
    steps: [
      S({ id: "deps", title: "Dependency SBOM", needs: ["cargo"], cmd: "cargo audit bin \"$T\" | head -60",
        gives: "crate@version list", fallback: "`objcopy --dump-section .dep-v0=$D/dep.bin F` then `python3 -c 'import zlib;print(zlib.decompress(open(\"$D/dep.bin\",\"rb\").read()[8:]))'`" }),
      S({ id: "toolchain", title: "Toolchain + crate paths", needs: ["strings"], cmd: "strings -a \"$T\" | rg -o '/rustc/[0-9a-f]{40}' | sort -u | head -5; strings -a \"$T\" | rg -o '[a-z0-9_-]+-[0-9]+\\.[0-9]+\\.[0-9]+/src' | sort -u | head -40",
        gives: "rustc commit, crate names with versions", fallback: "`rg -a -o` equivalent" }),
      S({ id: "panic", tier: 2, title: "Panic messages = hidden code paths", needs: ["strings"], cmd: "strings -a \"$T\" | rg 'panicked at|src/.*\\.rs:[0-9]+' | head -40",
        why: "release builds embed file:line for panics, which maps the source layout", fallback: "no good fallback: symbols may be stripped" }),
      S({ id: "sym", tier: 3, title: "Mangled symbols", needs: ["nm"], cmd: "nm -gU \"$T\" 2>/dev/null | rg ' _$?R' | head -40; rustfilt < <(nm \"$T\" | awk '{print $NF}') 2>/dev/null | head -40",
        fallback: "`rustfilt` is `cargo install rustfilt`; otherwise read the mangled names for module paths" }),
    ],
  },

  flutter: {
    summary: "Flutter: libapp.so is Dart AOT. Snapshot hash identifies the exact Dart engine, which picks your tooling.",
    steps: [
      S({ id: "hash", title: "Snapshot hash → Dart version", needs: [], cmd: "strings -a \"$T\" | rg -m1 -o 'Dart VM version: [0-9.]+[^ ]*'; python3 - <<'PY'\nimport sys\nd=open('$T','rb').read()\ni=d.find(bytes.fromhex('f5f5dcdc'))\nprint('snapshot hash', d[i+20:i+36].hex() if i>=0 else 'magic not found')\nPY",
        gives: "exact Dart SDK the AOT snapshot was built for", fallback: "magic 0xF5F5DCDC + 20 bytes = 32 hex chars; search the hash in the engine version table" }),
      S({ id: "blutter", title: "Recover names", needs: ["blutter"], cmd: "blutter \"$T\" $D/blutter | tail -5; rg -n 'package:' $D/blutter/*.txt | head -40",
        gives: "class/method names even though Dart AOT strips them", fallback: "no blutter: `strings F | rg 'package:[a-z_]+/' | sort -u` maps package names to features" }),
      S({ id: "strings", tier: 2, title: "Feature needles", needs: ["strings"], cmd: "strings -a -n 8 \"$T\" | rg -i 'http|firebase|socket|licen|feature' | head -120", fallback: "`rg -a`" }),
    ],
  },

  "web-bundle": {
    summary: "Minified bundle: never read it. Slice it with 250-char context around one needle, or walk the source map.",
    steps: [
      S({ id: "map", title: "Source map?", needs: ["rg", "jq"], cmd: "rg -uu -o 'sourceMappingURL=[^ \\t\"'\\'']+' \"$T\" | head -3; rg -uu -o '.{0,80}sourcesContent.{0,80}' \"$T\" | head -3",
        gives: "original sources, which beats any deobfuscation", fallback: "`grep -ao 'sourceMappingURL=[^ ]*' F`, or `tail -c 400 F`" }),
      S({ id: "pretty", title: "Pretty-print once, read by line", needs: [], cmd: "npx -y prettier --parser babel \"$T\" > $D/pretty.js && wc -l $D/pretty.js",
        gives: "line numbers you can cite", fallback: "`js-beautify`, or `node -e` with a simple brace parser" }),
      S({ id: "needle", title: "Slice the needle", needs: ["rg"], cmd: "rg -uu -o '.{0,250}NEEDLE.{0,250}' \"$T\" | head -20",
        why: "250-char windows keep context without loading a 5 MB file", fallback: "`grep -ao '.\\{0,250\\}NEEDLE.\\{0,250\\}' F | head -20`" }),
      S({ id: "modules", tier: 2, title: "Module boundaries", needs: ["rg"], cmd: "rg -uu -o '[0-9]{2,5}:\\s*function\\s*\\([^)]{0,40}\\)\\s*\\{' \"$T\" | head -40; rg -uu -c '__webpack_require__|webpackChunk' \"$T\"",
        gives: "the module id map you can cite instead of byte offsets", fallback: "`grep -ao`" }),
      S({ id: "runtime", tier: 3, title: "Runtime instead of static", cmd: "node --inspect-brk $SOMETHING  # or Playwright page.on('request')",
        why: "for a packed or encrypted bundle, observe behaviour: it is cheaper than reversing the loader", fallback: "`--remote-debugging-port` on Chrome, then a WS client" }),
    ],
  },

  asar: {
    summary: "Electron: extract with @electron/asar (npx, no install), then sweep for IPC in one rg call.",
    steps: [
      S({ id: "extract", title: "Extract", needs: ["node"], cmd: "A=\"$T\"; X=$D/asar; rm -rf \"$X\"; npx -y @electron/asar extract \"$A\" \"$X\" >/dev/null 2>&1 || node -e 'const a=require(\"fs\"),p=require(\"path\");console.error(\"asar extract failed: try `npx -y @electron/asar`\")'; jq '{name,version,main}' \"$X/package.json\" 2>/dev/null",
        gives: "app tree + entry point", fallback: "`npm i -g @electron/asar` once, about 1 s; the CLI is a thin wrapper over a pickle parser you can reimplement in 40 lines of node" }),
      S({ id: "surface", title: "IPC surface", needs: ["rg"], cmd: "X=$D/asar; rg -uu -n -o '.{0,120}(ipcMain\\.(handle|handleOnce|on|once)|ipcRenderer\\.(invoke|send|sendSync|on)|contextBridge\\.exposeIn(Main|Isolated)World|webPreferences|preload:|nodeIntegration|contextIsolation|sandbox|\\.node\\\\b).{0,160}' \"$X\" --glob '!node_modules' | head -60",
        gives: "every channel registration with its file", fallback: "`grep -rEo` equivalent" }),
      S({ id: "channels", title: "Channel name sweep", needs: ["rg"], cmd: "X=$D/asar; rg -uu -o '\"[a-z]+:[a-z0-9:-]+\"' \"$X\" --glob '!node_modules' | sort -u | head -80",
        why: "wrappers hide ipcMain, but the channel strings cannot hide", fallback: "`strings` the asar itself" }),
      S({ id: "unpacked", title: "Native addons", needs: [], cmd: "ls -R \"${T}.unpacked/node_modules\" 2>/dev/null | head -20; find \"$D/asar\" -name '*.node' | head",
        gives: "the native side that the JS calls", fallback: "`argus plan` on each .node file it finds" }),
      S({ id: "fuses", tier: 2, title: "Electron fuses", cmd: "npx -y @electron/fuses read --app \"$APP\" 2>/dev/null | head -20",
        why: "fuses decide whether --inspect and RunAsNode work, i.e. whether you can debug at runtime", fallback: "strings the Electron Framework for 'RunAsNode' / 'EnableNodeOptionsEnvironmentVariable'" }),
    ],
  },

  "mac-app": {
    summary: "macOS app bundle: Info.plist first (bundle id, URL schemes, privacy strings), then the executable.",
    steps: [
      S({ id: "plist", title: "Info.plist facts", needs: ["plutil", "jq"], cmd: "P=\"$T/Contents/Info.plist\"; plutil -convert json -o - \"$P\" | jq '{CFBundleIdentifier,CFBundleShortVersionString,CFBundleExecutable,LSMinimumSystemVersion,CFBundleURLTypes,NSAppleEventsUsageDescription}'",
        gives: "identity, version, URL schemes, why it asks for permissions", fallback: "`python3 -c 'import plistlib,sys;print(plistlib.load(open(sys.argv[1],\"rb\")))'`" }),
      S({ id: "privacy", title: "Privacy usage strings", needs: ["plutil"], cmd: "plutil -convert json -o - \"$T/Contents/Info.plist\" | jq -r 'keys[]' | rg '^NS.*UsageDescription$'",
        why: "each string is a capability the app must have declared (mic, screen, accessibility)", fallback: "`strings Info.plist | rg UsageDescription`" }),
      S({ id: "bin", title: "Main executable", needs: [], cmd: "B=\"$T/Contents/MacOS/$(plutil -extract CFBundleExecutable raw \"$T/Contents/Info.plist\")\"; file -b \"$B\"; argus plan \"$B\"",
        gives: "delegates to the Mach-O plan", fallback: "list Contents/MacOS and pick the largest file" }),
      S({ id: "helpers", tier: 2, title: "XPC services + embedded frameworks", cmd: "ls \"$T/Contents/XPCServices\" \"$T/Contents/Frameworks\" 2>/dev/null | head -40; plutil -p \"$T/Contents/Library/LoginItems\" 2>/dev/null | head",
        gives: "privileged helpers, which usually hold the interesting IPC", fallback: "`find $T -name '*.xpc'`" }),
      S({ id: "electron", tier: 2, title: "Electron check", cmd: "ls \"$T/Contents/Frameworks/Electron Framework.framework\" >/dev/null 2>&1 && echo electron && ls -l \"$T/Contents/Resources/app.asar\"",
        why: "the same bundle has two totally different routes", fallback: "`argus plan $T/Contents/Resources/app.asar`" }),
    ],
  },

  apk: {
    summary: "APK is a zip. Manifest facts in one line, then jadx, then grep. Flutter/Hermes/Unity needs a different route.",
    steps: [
      S({ id: "entries", title: "Shape of the zip", needs: ["unzip"], cmd: "unzip -l \"$T\" | head -40; unzip -l \"$T\" | rg -o 'lib/[^/]+/[^ ]+\\.so' | sort -u | head -20",
        gives: "is there libflutter/libhermes/libil2cpp (which changes the plan)", fallback: "`python3 -m zipfile -l F`" }),
      S({ id: "manifest", title: "Manifest facts", needs: ["aapt2", "apktool"], cmd: "aapt2 dump badging \"$T\" 2>/dev/null | head -20 || apktool d --no-src -f -o $D/apk \"$T\" >/dev/null && head -60 $D/apk/AndroidManifest.xml",
        gives: "package, version, permissions, exported components", fallback: "`apkanalyzer manifest print F`" }),
      S({ id: "jadx", title: "Decompile to Java", needs: ["jadx"], cmd: "jadx -d $D/src --show-bad-code \"$T\" >/dev/null 2>&1; find $D/src -name '*.java' | wc -l; rg -l 'http|socket|Cipher|loadLibrary' $D/src | head -20",
        gives: "readable Java", fallback: "`dex2jar` + `cfr`, or `baksmali` for smali" }),
      S({ id: "native", tier: 2, title: "Native libs inside", cmd: "unzip -o -q \"$T\" 'lib/*' -d $D/lib && for f in $D/lib/*/*.so; do argus detect \"$f\"; done | head -20",
        fallback: "extract with `unzip -j`, then run the elf plan on each .so" }),
      S({ id: "flutter-route", tier: 3, title: "Flutter route (if libflutter.so)", cmd: "unzip -o -q \"$T\" lib/*/libapp.so -d $D/lib && argus plan $D/lib/*/libapp.so",
        why: "there is almost no Java to read in a Flutter app", fallback: "`strings libapp.so | rg 'package:'`" }),
    ],
  },

  ipa: {
    summary: "IPA is a zip with Payload/App.app. Info.plist, then the Mach-O inside. Encryption check before anything else.",
    steps: [
      S({ id: "unpack", title: "Unpack", needs: ["unzip"], cmd: "unzip -o -q \"$T\" -d $D/ipa; APP=$(find $D/ipa/Payload -maxdepth 1 -name '*.app' | head -1); echo \"$APP\"; argus plan \"$APP\"",
        fallback: "`7z x F -o$D/ipa`" }),
      S({ id: "crypt", title: "FairPlay encryption check", needs: ["otool"], cmd: "BIN=\"$APP/$(plutil -extract CFBundleExecutable raw \"$APP/Info.plist\")\"; otool -l \"$BIN\" | rg -A4 'LC_ENCRYPTION_INFO' | rg 'cryptid' ",
        why: "cryptid 1 means the binary is encrypted: static analysis gives junk until you decrypt it", fallback: "`grep -a -m3 cryptid` is not enough; use `otool -l` or `rabin2 -I`" }),
      S({ id: "swift", tier: 2, title: "Swift/ObjC class map", needs: ["nm"], cmd: "nm -gU \"$BIN\" 2>/dev/null | awk '{print $NF}' | xcrun swift-demangle --compact 2>/dev/null | rg '^_\\$s' | head -60", fallback: "`strings $BIN | rg '^_TtC'` gives Swift class names (mangled)" }),
    ],
  },

  jar: {
    summary: "JVM: decompile with CFR/vineflower. Obfuscation shows up as a/b/c classes; the strings still tell the story.",
    steps: [
      S({ id: "list", title: "Package shape", needs: ["unzip"], cmd: "unzip -l \"$T\" | head -30; unzip -p \"$T\" META-INF/MANIFEST.MF 2>/dev/null | head -20",
        gives: "Main-Class, versions, fat-jar layout", fallback: "`python3 -m zipfile -l F`" }),
      S({ id: "decompile", title: "Decompile", needs: ["java"], cmd: "mkdir -p $D/s; unzip -o -q \"$T\" -d $D/s; java -jar $D/cfr.jar $D/s -o $D/src --outputdir $D/src >/dev/null 2>&1; find $D/src -name '*.java' | head -20",
        gives: "readable Java", fallback: "`javap -p -c -constants` on a single .class, which is enough for one method" }),
      S({ id: "grep", tier: 2, title: "Interesting calls", cmd: "rg -n 'Runtime\\.exec|ProcessBuilder|Cipher|HttpClient|Class\\.forName|loadLibrary' $D/src | head -40", fallback: "`strings` the class files" }),
    ],
  },

  hermes: {
    summary: "React Native Hermes bytecode. Not JavaScript: decompile with hermes-dec, or hook at runtime.",
    steps: [
      S({ id: "ver", title: "Header", needs: [], cmd: "python3 - <<'PY'\nd=open('$T','rb').read(64)\nimport struct\nmagic,ver,hash_,filelen=struct.unpack('<IIII', d[:16])\nprint('magic',hex(magic),'hbc version',ver,'compliant',(ver>>16)&0xff,'funcs',struct.unpack('<I',d[40:44])[0])\nPY", gives: "HBC version, which picks the disassembler build", fallback: "`xxd -l 32 F` and read magic + version by hand" }),
      S({ id: "dec", title: "Disassemble", needs: ["hermes-dec"], cmd: "hermes-disasm \"$T\" > $D/hbc.txt 2>/dev/null || hbc-decompiler \"$T\" $D/hbc.txt; head -40 $D/hbc.txt",
        fallback: "no tool: `strings F | rg 'package:|/src/' | sort -u` still gives module paths and feature names" }),
      S({ id: "frida", tier: 2, title: "Runtime route", cmd: "frida -U -f com.app -l hook.js  # hook HermesRuntime::executeInModule / callFunction",
        why: "for a recent HBC version, runtime observation is faster than chasing the disassembler", fallback: "`adb logcat` for the JS console output" }),
    ],
  },

  "unity-metadata": {
    summary: "Unity IL2CPP: global-metadata.dat (names) + libil2cpp.so (code). Il2CppDumper joins them.",
    steps: [
      S({ id: "dump", title: "Dump metadata + symbols", needs: [], cmd: "Il2CppDumper/lib/Il2CppDumper global-metadata.dat libil2cpp.so $D/il2cpp | tail -5; ls $D/il2cpp | head",
        gives: "dump.cs with real class and method names", fallback: "`Il2CppInspector` (works without symbols), or `Cpp2IL`" }),
      S({ id: "grep", title: "Find the feature", needs: ["rg"], cmd: "rg -n -i 'NEEDLE' $D/il2cpp/dump.cs | head -20", gives: "class + method + RVA", fallback: "`grep -n`" }),
      S({ id: "lib", tier: 2, title: "Then the native plan", cmd: "argus plan libil2cpp.so", gives: "to read the real code at that RVA", fallback: "`rabin2 -I libil2cpp.so`" }),
    ],
  },

  wasm: {
    summary: "WASM: the import/export table is the API, and wasm-decompile output is close to readable C.",
    steps: [
      S({ id: "sections", title: "Imports and exports", needs: ["wasm2wat"], cmd: "wasm-objdump -x \"$T\" | rg -A20 'Import|Export' | head -60", fallback: "`wasm2wat` then grep `(import` / `(export`" }),
      S({ id: "dec", title: "Decompile", needs: [], cmd: "wasm-decompile \"$T\" -o $D/w.dcmp && rg -n 'function ' $D/w.dcmp | head -40", gives: "C-like pseudo-code", fallback: "`wasm2wat` + read the exported function bodies" }),
      S({ id: "strings", tier: 2, title: "Data section strings", cmd: "strings -a -n 6 \"$T\" | head -120", fallback: "`rg -a -o '[[:print:]]{6,}' F`" }),
    ],
  },

  sqlite: {
    summary: "SQLite: copy the db and the -wal first. Then .schema, then a few SELECTs. Never edit the original.",
    steps: [
      S({ id: "copy", title: "Copy with sidecars", needs: [], cmd: "cp \"$T\" $D/db.sqlite; [ -f \"${T}-wal\" ] && cp \"${T}-wal\" $D/db.sqlite-wal; ls -l $D/db.sqlite*",
        why: "opening a live db can checkpoint the WAL and destroy evidence", fallback: "`sqlite3 'file:F?mode=ro&immutable=1'` read-only URI" }),
      S({ id: "schema", title: "Schema and row counts", needs: ["sqlite3"], cmd: "sqlite3 \"file:$D/db.sqlite?mode=ro\" '.schema' | head -80; sqlite3 \"file:$D/db.sqlite?mode=ro\" \"select name from sqlite_master where type='table'\" | head -40",
        gives: "the whole data model", fallback: "`python3 -c 'import sqlite3;c=sqlite3.connect(\"file:$D/db.sqlite?mode=ro\",uri=True);print(c.execute(\"select sql from sqlite_master\").fetchall())'`" }),
      S({ id: "rows", tier: 2, title: "Sample rows", needs: ["sqlite3"], cmd: "sqlite3 -header -column \"file:$D/db.sqlite?mode=ro\" 'select * from T limit 20'", fallback: "the same python snippet" }),
    ],
  },

  "plist-binary": {
    summary: "Plist: plutil -p is enough. Convert to JSON when you want jq.",
    steps: [
      S({ id: "print", title: "Print as JSON", needs: ["plutil", "jq"], cmd: "plutil -convert json -o - \"$T\" | jq . | head -80", fallback: "`python3 -c 'import plistlib,sys,json;print(json.dumps(plistlib.load(open(sys.argv[1],\"rb\")),indent=1,default=str))' F`" }),
      S({ id: "keys", tier: 2, title: "Which keys matter", needs: ["jq"], cmd: "plutil -convert json -o - \"$T\" | jq -r 'paths(scalars) | join(\".\")' | head -80", gives: "flattened key list", fallback: "`strings` the plist for key names" }),
    ],
  },

  "xml-plist": {
    summary: "XML plist: same route as binary plist, no conversion needed.",
    steps: [
      S({ id: "print", title: "Read it", needs: [], cmd: "rg -n '<key>|<string>|<integer>' \"$T\" | head -60", fallback: "`grep -n`" }),
    ],
  },

  pcap: {
    summary: "pcap: conversations first, then DNS/SNI, then reassembled HTTP. Do not read packets one by one.",
    steps: [
      S({ id: "conv", title: "Conversations", needs: ["tshark"], cmd: "tshark -r \"$T\" -q -z conv,tcp 2>/dev/null | head -30; tshark -r \"$T\" -q -z io,phs 2>/dev/null | head -30",
        gives: "who talks to whom, and with what protocol", fallback: "`tcpdump -r F -nn | head -40` (no reassembly)" }),
      S({ id: "names", title: "Hostnames (incl. TLS SNI)", needs: ["tshark"], cmd: "tshark -r \"$T\" -T fields -e dns.qry.name -e tls.handshake.extensions_server_name 2>/dev/null | rg -v '^\\s*$' | sort -u | head -40",
        gives: "the domains, even when TLS hides the content", fallback: "`tcpdump -r F -nn -A | rg -o '[a-z0-9.-]+\\.(com|net|io|org)'`" }),
      S({ id: "http", tier: 2, title: "Request lines", needs: ["tshark"], cmd: "tshark -r \"$T\" -T fields -e http.request.method -e http.request.full_uri -e http.host 2>/dev/null | rg -v '^\\s*$' | head -40", fallback: "`tshark -x` around a stream index, or scapy" }),
    ],
  },

  pcapng: { summary: "pcapng: same as pcap (tshark reads both).", steps: [] },

  firmware: {
    summary: "Unknown blob: measure entropy, find filesystems, extract, then re-route each piece through argus.",
    steps: [
      S({ id: "entropy", title: "Entropy + magic scatter", needs: [], cmd: "python3 - <<'PY'\nimport math,collections\nd=open('$T','rb').read(4<<20)\nc=collections.Counter(d)\ne=-sum(v/len(d)*math.log2(v/len(d)) for v in c.values())\nprint(f'first 4MB entropy {e:.2f} bits/byte (7.9+ = compressed or encrypted)')\nfor magic,name in [(b'hsqs','squashfs'),(b'UBI#','UBI'),(b'\\x27\\x05\\x19\\x56','uImage'),(b'\\x85\\x19\\x03\\x20','JFFS2'),(b'\\x1f\\x8b\\x08','gzip'),(b'FDT\\xd0\\x0d\\xfe','dtb')]:\n    i=d.find(magic); print(name, i) if i>=0 else None\nPY", gives: "compressed? which fs? where?", fallback: "`ent F` (or `binwalk -E`) for the entropy plot; `xxd | grep` for magic" }),
      S({ id: "extract", title: "Extract", needs: ["binwalk", "unblob"], cmd: "unblob -e $D/fw \"$T\" 2>/dev/null | tail -5 || binwalk -e --run-as=root -C $D/fw \"$T\" | tail -10",
        gives: "_extracted/ tree", fallback: "`7z x` handles most images; squashfs needs `unsquashfs`, UBI needs `ubireader_extract_images`" }),
      S({ id: "reroute", tier: 2, title: "Route each piece", cmd: "find $D/fw -type f -size +100k | head -20 | while read f; do echo \"== $f\"; argus detect \"$f\"; done",
        why: "one blob is never one artifact", fallback: "`file` each extracted file" }),
    ],
  },

  "binary-unknown": {
    summary: "Unrecognised binary: check for a packer before anything else, then fall back to strings and entropy.",
    steps: [
      S({ id: "pack", title: "Packed?", needs: [], cmd: "strings -a \"$T\" | rg -m3 'UPX!|MPRESS|ASPack|Themida|VMProtect|Enigma'; xxd -l 64 \"$T\"",
        why: "packed binaries give meaningless symbols; unpack first or say so", fallback: "`upx -d F` if UPX; otherwise entropy per section with `binwalk -E`" }),
      S({ id: "str", title: "Strings anyway", needs: ["strings"], cmd: "strings -a -n 8 \"$T\" | head -200", fallback: "`rg -a -o '[[:print:]]{8,}' F | head -200`" }),
      S({ id: "ask", tier: 2, title: "Narrow the platform", cmd: "xxd -l 16 \"$T\"; file \"$T\"; argus detect \"$T\" --deep",
        why: "a truncated or encrypted header is not a new format: say `unknown` and cite the header bytes", fallback: "compare against `magic` database if installed" }),
    ],
  },

  pyinstaller: {
    summary: "PyInstaller: extract with pyinstxtractor, then decompile .pyc with a version-matched decompiler.",
    steps: [
      S({ id: "extract", title: "Extract", needs: ["python3"], cmd: "python3 pyinstxtractor.py \"$T\" | tail -5; ls \"${T}_extracted\" | head -20",
        fallback: "`pyinstxtractor-ng` (pip) handles newer PyInstaller versions" }),
      S({ id: "pyc", title: "Decompile entry pyc", needs: [], cmd: "python3 -m pip install -q decompyle3 2>/dev/null; decompyle3 $D/extracted/*.pyc 2>&1 | head -40",
        why: "the pyc magic gives the exact Python version, which picks the decompiler", fallback: "`uncompyle6` (<=3.8), `pycdc` (any version, C++ build), or `dis` on the code object" }),
    ],
  },

  "node-addon": {
    summary: "Native Node addon: the N-API export table is the JS surface. Start there, not at main().",
    steps: [
      S({ id: "exports", title: "JS-callable exports", needs: ["nm", "strings"], cmd: "nm -gU \"$T\" 2>/dev/null | head -80; strings -a \"$T\" | rg -o 'napi_define_class|napi_create_function|napi_set_named_property' | sort | uniq -c",
        gives: "which N-API calls build the surface", fallback: "`rg -a -o 'napi_[a-z_]+' F | sort | uniq -c`" }),
      S({ id: "names", title: "Exported names", needs: ["strings"], cmd: "strings -a \"$T\" | rg -v '^_|^\\$' | rg '^[A-Za-z_][A-Za-z0-9_]{3,40}$' | head -80",
        why: "napi_set_named_property takes the JS name as a C string, so names are in the binary", fallback: "read the Mach-O plan's strings step" }),
      S({ id: "host", tier: 2, title: "Host frameworks", needs: ["nm"], cmd: "nm -u \"$T\" | rg -i 'TCC|CoreAudio|IOKit|Security|sqlite' | head -20",
        gives: "the OS capabilities it touches (permission checks live here)", fallback: "`otool -L`" }),
    ],
  },

  "js-source": {
    summary: "Readable JS: go from the entry point, then follow imports. Cheap and exact.",
    steps: [
      S({ id: "entry", title: "Entry + shape", needs: ["rg"], cmd: "jq '{name,version,main,scripts}' \"$(dirname $T)/package.json\" 2>/dev/null; wc -l \"$T\"; rg -n 'module.exports|export ' \"$T\" | head -20", fallback: "`grep -n`" }),
      S({ id: "needle", title: "Feature search", needs: ["rg"], cmd: "rg -n -C2 'NEEDLE' \"$PWD\" --glob '!node_modules' | head -60", fallback: "`grep -rn`" }),
    ],
  },

  html: {
    summary: "A website is a runtime target: fetch, then observe. Static HTML alone rarely answers behaviour questions.",
    steps: [
      S({ id: "fetch", title: "Fetch and list scripts", needs: [], cmd: "curl -sL -A 'Mozilla/5.0' '$URL' | rg -o '<script[^>]*src=\"[^\"]+\"' | head -20; curl -sL -A 'Mozilla/5.0' '$URL' | rg -o '/api/[a-z0-9/_-]+' | sort -u | head -20",
        gives: "the JS bundle list and API surface", fallback: "`wget -qO-`" }),
      S({ id: "observe", tier: 2, title: "Observe behaviour", needs: ["playwright"], cmd: "node -e 'const {chromium}=require(\"playwright\");(async()=>{const b=await chromium.launch();const p=await b.newPage();p.on(\"request\",r=>{if(r.resourceType()===\"xhr\"||r.resourceType()===\"fetch\")console.log(r.method(),r.url())});await p.goto(process.argv[1],{waitUntil:\"networkidle\"});await b.close()})()' '$URL'",
        why: "the request log is the real API contract, and it is cheap", fallback: "Chrome `--remote-debugging-port=9222` + curl the JSON endpoint" }),
    ],
  },

  text: { summary: "Plain text: read it with ranges.", steps: [S({ id: "read", title: "Shape it", needs: [], cmd: "wc -l \"$T\"; head -40 \"$T\"", fallback: "`sed -n '1,40p'`" })] },
  json: { summary: "JSON: jq the shape, then the leaves.", steps: [S({ id: "shape", title: "Keys and depth", needs: ["jq"], cmd: "jq -r 'paths(scalars) | join(\".\")' \"$T\" | head -60", fallback: "`node -e` or `python3 -m json.tool`" })] },
  directory: { summary: "Directory: list shape, then route each interesting file.", steps: [S({ id: "ls", title: "Inventory", needs: [], cmd: "find \"$T\" -maxdepth 2 -type f | head -40; du -sh \"$T\"", fallback: "`ls -R | head`" })] },
  "node-project": { summary: "Node project: package.json, then the entry, then node_modules only if needed.", steps: [S({ id: "pkg", title: "Manifest", needs: ["jq"], cmd: "jq '{name,version,scripts,dependencies}' \"$T/package.json\" | head -40", fallback: "`head -40 package.json`" })] },
};

const ARCHIVE = { summary: "Archive: list first, extract into $D, then re-route each file that matters.",
  steps: [
    S({ id: "list", title: "List", needs: ["7z", "unzip"], cmd: "7z l \"$T\" 2>/dev/null | head -40 || unzip -l \"$T\" 2>/dev/null | head -40 || tar tvf \"$T\" | head -40", fallback: "`bsdtar -tf F`" }),
    S({ id: "x", title: "Extract", needs: ["7z"], cmd: "7z x -o$D/x \"$T\" >/dev/null 2>&1 || tar xf \"$T\" -C $D/x", gives: "$D/x tree", fallback: "`unzip`/`tar`/`python3 -m zipfile -e`" }),
    S({ id: "route", tier: 2, title: "Route", cmd: "find $D/x -type f -size +50k | head -20 | while read f; do argus detect \"$f\"; done", fallback: "`file` each" }),
  ] };

for (const k of ["zip", "gzip", "xz", "zstd", "bzip2", "7z", "rar", "tar", "dmg", "deb", "appimage"]) PLANS[k] = ARCHIVE;

const GENERIC = {
  summary: "No specific route: identify the container, then come back to argus with a narrower target.",
  steps: [
    S({ id: "id", title: "Identify", needs: ["file"], cmd: "file -b \"$T\"; xxd -l 32 \"$T\"; ls -l \"$T\"", fallback: "`argus detect` already did this from magic bytes" }),
    S({ id: "hash", title: "Hash it", needs: ["shasum"], cmd: "shasum -a 256 \"$T\" 2>/dev/null || sha256sum \"$T\"", why: "a hash is how you prove two builds differ", fallback: "`certutil -hashfile F SHA256` on Windows" }),
  ],
};

export function planFor(detected) {
  const kind = detected.kind;
  const p = PLANS[kind] || PLANS[kind.replace(/-.*/, "")] || GENERIC;
  const steps = p.steps.map(s => {
    const cmd = (PLATFORM !== "mac" && s.alt?.[PLATFORM]) || s.cmd;
    const tools = (s.needs || []).map(id => ({ id, ...resolveTool(id) }));
    return {
      ...s,
      cmd,
      tools,
      runnable: tools.every(t => t.present),
      missing: tools.filter(t => !t.present).map(t => t.id),
    };
  });
  return { kind, summary: p.summary || GENERIC.summary, steps };
}

/** Render a tier-1 batch: one paste-and-run block with markers and output caps. */
export function renderShell(target, plan, { dir = "$TMPDIR/argus", tier = 1 } = {}) {
  const lines = [
    `# argus plan — ${target}  (kind: ${plan.kind})`,
    `# ${plan.summary}`,
    `T="${target}"`,
    `D="${dir}/$(basename "$T")"; mkdir -p "$D"`,
  ];
  for (const s of plan.steps.filter(s => s.tier <= tier)) {
    lines.push(`echo '--- ${s.id}: ${s.title.replace(/'/g, "")}'  # gives: ${(s.gives || s.why || "").slice(0, 90)}`);
    lines.push(s.cmd); // $T and $D are already defined at the top of the block
  }
  return lines.join("\n") + "\n";
}

export { PLANS, GENERIC };
