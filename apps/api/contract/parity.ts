// Test parity: every Java test method (@Test / @ParameterizedTest under
// apps/api/src/test/java, tests inherited from abstract base classes expanded
// into each subclass) must have a TS counterpart with the same name, in a file
// that names its Java class (header comment, describe(), or the IN-PROCESS.md
// row), under contract/tests or test/. The agents kept Java method names as
// test names. A Java test that is intentionally not ported is listed with its
// reason in contract/parity-exclusions.json ("Class#method" or "Class#*").
//
//   bun contract/parity.ts            # summary + every unmatched test
//   bun contract/parity.ts --list     # also every match
//   bun contract/parity.ts --check    # exit 1 when a test is neither matched nor excluded
//
// The Java app is gone: its test list is frozen in test/fixtures/java-tests.json
// (written from apps/api/src/test/java with UPDATE_JAVA_TESTS=1 while it existed).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const JAVA_TESTS = join(ROOT, '..', 'api', 'src', 'test', 'java');
const TS_DIRS = [join(ROOT, 'contract', 'tests'), join(ROOT, 'test')];
const EXCLUSIONS = join(import.meta.dir, 'parity-exclusions.json');
const SNAPSHOT = join(ROOT, 'test', 'fixtures', 'java-tests.json');
const IN_PROCESS = join(import.meta.dir, 'IN-PROCESS.md');

function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

// ------------------------------------------------------------- Java

interface JavaClass { name: string; file: string; abstract: boolean; parent: string | null; methods: string[] }

/** Removes comments, leaving string and char literals alone ("/v1/auth/**" is not a comment). */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'") {
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        out += src.slice(i, end + 3);
        i = end + 2;
        continue;
      }
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = (end < 0 ? src.length : end) - 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = (end < 0 ? src.length : end + 2) - 1;
      out += ' ';
    } else out += ch;
  }
  return out;
}

function javaClasses(): Map<string, JavaClass> {
  if (!existsSync(JAVA_TESTS)) {
    const frozen = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as JavaClass[];
    return new Map(frozen.map((c) => [c.name, c]));
  }
  const out = new Map<string, JavaClass>();
  for (const file of walk(JAVA_TESTS, '.java')) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const cls = /^(?:public\s+|final\s+|abstract\s+)*(abstract\s+)?(?:public\s+|final\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?/m.exec(src);
    if (!cls) continue;
    const methods: string[] = [];
    for (const m of src.matchAll(/@(?:org\.junit\.jupiter\.api\.)?(?:Test|ParameterizedTest)\b[\s\S]*?\bvoid\s+(\w+)\s*\(/g)) methods.push(m[1]!);
    out.set(cls[2]!, { name: cls[2]!, file: relative(JAVA_TESTS, file), abstract: /\babstract\s+class\b/.test(cls[0]), parent: cls[3] ?? null, methods });
  }
  if (process.env.UPDATE_JAVA_TESTS) {
    const sorted = [...out.values()].sort((a, b) => a.file.localeCompare(b.file));
    writeFileSync(SNAPSHOT, `${JSON.stringify(sorted, null, 1)}\n`);
  }
  return out;
}

/** Runnable tests: concrete classes with their own and inherited methods. */
function javaTests(classes: Map<string, JavaClass>): { cls: string; method: string; inheritedFrom: string | null }[] {
  const out: { cls: string; method: string; inheritedFrom: string | null }[] = [];
  for (const c of classes.values()) {
    if (c.abstract) continue;
    const seen = new Set<string>();
    for (let k: JavaClass | undefined = c; k; k = k.parent ? classes.get(k.parent) : undefined) {
      for (const m of k.methods) {
        if (seen.has(m)) continue; // overridden
        seen.add(m);
        out.push({ cls: c.name, method: m, inheritedFrom: k === c ? null : k.name });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- TS

interface TsFile { file: string; text: string; tests: Set<string> }

function stringArg(src: string, from: number): string | null {
  const q = src[from];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let i = from + 1;
  let s = '';
  while (i < src.length && src[i] !== q) {
    if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
    s += src[i++];
  }
  return s;
}

function tsFiles(): TsFile[] {
  return TS_DIRS.flatMap((d) => walk(d, '.ts')).map((file) => {
    const text = readFileSync(file, 'utf8');
    const tests = new Set<string>();
    // test('x'), test.skipIf(c)('x'), test.if(c)('x'), it('x'), test.each(...)('x'), test.todo('x')
    for (const m of text.matchAll(/\b(?:test|it)(?:\.(?:skipIf|if|each|todo|skip|only|failing)\s*\((?:[^()]|\([^()]*\))*\))?\s*\(\s*/g)) {
      const name = stringArg(text, m.index! + m[0].length);
      if (name != null) tests.add(name);
    }
    // Table-driven ports: arrays of ['javaMethodName', ...] fed to test.each.
    for (const m of text.matchAll(/\[\s*'([a-z]\w+)'\s*,/g)) if (/test\.each|\.each\(/.test(text)) tests.add(m[1]!);
    return { file, text, tests };
  });
}

/** Names a TS test may carry for Java method `m`: exactly `m`, or `m` followed by a qualifier ("m (part)", "m: x"). */
function hasTest(f: TsFile, m: string): boolean {
  if (f.tests.has(m)) return true;
  for (const t of f.tests) if (t.startsWith(m) && /^[\s:(\-—,/[]/.test(t.slice(m.length))) return true;
  return false;
}

// ------------------------------------------------------------- matching

const classes = javaClasses();
const tests = javaTests(classes);
const files = tsFiles();
const inProcess = existsSync(IN_PROCESS) ? readFileSync(IN_PROCESS, 'utf8') : '';
const exclusions = (existsSync(EXCLUSIONS) ? JSON.parse(readFileSync(EXCLUSIONS, 'utf8')) : {}) as Record<string, string>;

/** Files associated with a Java class: they name it (word match), or IN-PROCESS.md maps it to them. */
const assoc = new Map<string, TsFile[]>();
for (const c of classes.keys()) {
  const re = new RegExp(`\\b${c}\\b`);
  const fromDoc = inProcess.split('\n').filter((l) => re.test(l)).flatMap((l) => [...l.matchAll(/`(test\/[^`]+?\.ts)`/g)].map((x) => x[1]!));
  assoc.set(c, files.filter((f) => re.test(f.text) || fromDoc.some((d) => join(ROOT, d) === f.file)));
}

const javaCount = new Map<string, number>();
for (const t of tests) javaCount.set(t.method, (javaCount.get(t.method) ?? 0) + 1);

type Status = 'matched' | 'matched-by-name' | 'excluded' | 'unmatched';
const rows = tests.map((t) => {
  const key = `${t.cls}#${t.method}`;
  const strong = (assoc.get(t.cls) ?? []).filter((f) => hasTest(f, t.method));
  // Inherited tests may live in the base class's port.
  const viaBase = t.inheritedFrom ? (assoc.get(t.inheritedFrom) ?? []).filter((f) => hasTest(f, t.method)) : [];
  let status: Status;
  let where: string[] = [];
  if (strong.length || viaBase.length) { status = 'matched'; where = [...strong, ...viaBase].map((f) => relative(ROOT, f.file)); }
  else if (exclusions[key] ?? exclusions[`${t.cls}#*`]) { status = 'excluded'; where = [exclusions[key] ?? exclusions[`${t.cls}#*`]!]; }
  else {
    // A unique method name found anywhere (the class name is only missing from the file).
    const anywhere = javaCount.get(t.method) === 1 ? files.filter((f) => hasTest(f, t.method)) : [];
    if (anywhere.length) { status = 'matched-by-name'; where = anywhere.map((f) => relative(ROOT, f.file)); }
    else status = 'unmatched';
  }
  return { key, ...t, status, where };
});

const args = process.argv.slice(2);
const count = (s: Status) => rows.filter((r) => r.status === s).length;
const unusedExclusions = Object.keys(exclusions).filter((k) => !rows.some((r) => r.key === k || (k.endsWith('#*') && r.cls === k.slice(0, -2))));

const own = [...classes.values()].reduce((n, c) => n + c.methods.length, 0);
console.log(`Java tests: ${rows.length} runnable (${own} @Test/@ParameterizedTest methods in ${new Set(rows.map((r) => r.cls)).size} classes; `
  + `${rows.filter((r) => r.inheritedFrom).length} of the runnable ones inherited from an abstract base)`);
console.log(`  matched (class + name):  ${count('matched')}`);
console.log(`  matched (unique name):   ${count('matched-by-name')}`);
console.log(`  intentionally not ported: ${count('excluded')}`);
console.log(`  unmatched:               ${count('unmatched')}`);
if (unusedExclusions.length) console.log(`\nStale exclusions (no such Java test): ${unusedExclusions.join(', ')}`);
const show = (s: Status, title: string) => {
  const rs = rows.filter((r) => r.status === s);
  if (!rs.length) return;
  console.log(`\n${title}:`);
  for (const r of rs) console.log(`  ${r.key}${r.inheritedFrom ? ` (from ${r.inheritedFrom})` : ''}${r.where.length ? `  -> ${r.where.join(', ')}` : ''}`);
};
show('unmatched', 'Unmatched');
if (args.includes('--list')) {
  show('matched-by-name', 'Matched by unique name only');
  show('excluded', 'Intentionally not ported');
  show('matched', 'Matched');
}
if (args.includes('--check') && (count('unmatched') > 0 || unusedExclusions.length > 0)) process.exit(1);
