---
title: JVM — jars, class files, Kotlin, obfuscation
when: target is a .jar, .war, .class, or a Java/Kotlin/Scala app or server
keywords: [java, jar, class, jvm, kotlin, cfr, javap, obfuscation, android-free]
---

# JVM

A jar is a zip of class files. Class files decompile nearly perfectly unless an obfuscator renamed things — and even then, string literals and library calls stay readable.

## Shape first

```sh
unzip -l app.jar | head -30
unzip -p app.jar META-INF/MANIFEST.MF | head -20         # Main-Class, versions, build tool
unzip -l app.jar | rg -c '\.class$'
unzip -p app.jar META-INF/maven/*/*/pom.properties 2>/dev/null | head -20
```

`Main-Class` names the entry point; a `META-INF/maven` or `BOOT-INF/` layout means Spring Boot (fat jar, `BOOT-INF/classes` holds the app code and `BOOT-INF/lib` the dependencies).

## Decompile

```sh
mkdir -p $D/s && unzip -o -q app.jar -d $D/s
# CFR (single jar, no deps):
java -jar cfr.jar $D/s --outputdir $D/src >/dev/null 2>&1
# or vineflower / procyon; or jadx if you also have Android in play
find $D/src -name '*.java' | wc -l
```

One function instead of everything (fast, always available in a JDK):
```sh
javap -p -c -constants -classpath $D/s com.example.Target | head -80
```

## Grep the right things

```sh
rg -n 'Runtime\.getRuntime\(\)\.exec|ProcessBuilder|URLClassLoader|defineClass|Cipher\.getInstance|Keystore|MessageDigest|HttpURLConnection|OkHttp|Socket\(' $D/src | head -50
rg -n 'System\.getProperty|System\.getenv' $D/src | head -20
```
`Base64.getDecoder()` next to a long literal is a payload; `defineClass` next to a byte array is a class loader trick.

## Kotlin and Scala

Kotlin compiles to normal class files but adds `kotlin.Metadata`; CFR often produces ugly but correct code with `$$` synthetic names and default-argument bridges. Scala adds `scala.` namespaces and `$` separators. Both are readable if you look at the `@Metadata`-free parts first (data classes, plain methods).

## Obfuscation

Signs: class names `a`, `a$a`, `b/c/d`, and string decryption stubs (`String f(int)` with a switch).

1. `java -jar deobf.jar` style tools (procyon + threadtear) can undo string encryption.
2. Renaming is not recoverable, but the *call graph* still is: library calls keep their names (`java.net.Socket`, `javax.crypto.Cipher`), so the behaviour is legible even with meaningless class names.
3. Decompile the string-decryptor class literally (it is usually one static method), reimplement it in 10 lines of Java, and dump the table.

## Traps

- A jar can carry native libraries in `/lib` or inside a nested jar (`lib/*.jar`) — recurse once, then route the `.so`/`.dll` with the native plans.
- Jars with `signature` files (`META-INF/*.SF`, `*.RSA`) must be unzipped and re-zipped before modification; otherwise the JVM refuses to load them.
- `java -jar` runs unknown code: do not execute a target you were not authorised to run. Static reading is enough for "how does it work".
