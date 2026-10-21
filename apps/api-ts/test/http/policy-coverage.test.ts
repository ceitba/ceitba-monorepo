// Security guard for src/http/auth/policy.ts. A mismatch there fails OPEN (a
// route whose key is not in METHOD_RULES runs without its @PreAuthorize), so
// this test derives the rules from the Java sources and checks, in both
// directions:
//   1. every METHOD_RULES key is a registered TS route;
//   2. every Java controller method with @PreAuthorize (method- or class-level,
//      class-level @RequestMapping prefixes expanded) has a METHOD_RULES entry,
//      with the same roles / checks / operators;
//   3. every registered TS route without a rule has no @PreAuthorize in Java;
//   4. URL_RULES is SecurityConfig.authorizeHttpRequests, rule for rule, in order.
// apps/api is the specification; while it exists in the repo this test reads it.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_RULES, ruleKey, URL_RULES, type MethodExpr, type UrlRule } from '../../src/http/auth/policy';
import { tsRoutes } from '../../contract/support/routes';

const JAVA = join(import.meta.dir, '..', '..', '..', 'api', 'src', 'main', 'java', 'org', 'ceitba', 'api');
const hasJava = existsSync(JAVA);

// ------------------------------------------------------------- Java source scanning

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Removes comments, keeping string literals intact. */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') {
      // text block or string literal
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        out += src.slice(i, end + 3);
        i = end + 2;
        continue;
      }
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = (end < 0 ? src.length : end) - 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      out += ' ';
      i = end + 1;
    } else out += ch;
  }
  return out;
}

/** Index of the parenthesis closing the one at `open`. */
function closeParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') { i++; while (src[i] !== '"') i += src[i] === '\\' ? 2 : 1; continue; }
    if (ch === "'") { i++; while (src[i] !== "'") i += src[i] === '\\' ? 2 : 1; continue; }
    if (ch === '(' || ch === '{') depth++;
    else if ((ch === ')' || ch === '}') && --depth === 0) return i;
  }
  throw new Error('unbalanced parentheses');
}

/** `"a" + "b" + CONST` -> the concatenated text (constants from the same file). */
function evalStringExpr(expr: string, consts: Map<string, string>): string {
  let out = '';
  for (const part of expr.split(/\+(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const p = part.trim();
    if (!p) continue;
    const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(p);
    if (lit) out += lit[1]!.replace(/\\(.)/g, '$1');
    else {
      const name = p.split('.').pop()!;
      const v = consts.get(name) ?? GLOBAL_CONSTS.get(name);
      if (v === undefined) throw new Error(`unknown constant ${p}`);
      out += v;
    }
  }
  return out;
}

function stringConstants(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of src.matchAll(/static\s+final\s+String\s+(\w+)\s*=\s*([^;]+);/g)) {
    try { m.set(x[1]!, evalStringExpr(x[2]!, m)); } catch { /* not a plain literal */ }
  }
  return m;
}

const GLOBAL_CONSTS = new Map<string, string>();

interface Annotation { name: string; args: string; start: number; end: number }

function annotations(src: string): Annotation[] {
  const out: Annotation[] = [];
  const re = /@(\w+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    // skip `@` inside strings (SpEL `@orgAccess`): they never follow a word boundary outside quotes here
    let end = m.index + m[0].length;
    let args = '';
    let k = end;
    while (src[k] === ' ') k++;
    if (src[k] === '(') {
      const close = closeParen(src, k);
      args = src.slice(k + 1, close);
      end = close + 1;
    }
    out.push({ name: m[1]!, args, start: m.index, end });
    re.lastIndex = end;
  }
  return out;
}

/** Splits `a, b = {x, y}, c` at top-level commas. */
function topLevelSplit(s: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') { let j = i + 1; while (s[j] !== '"') j += s[j] === '\\' ? 2 : 1; cur += s.slice(i, j + 1); i = j; continue; }
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

/** The value of attribute `name` (or the bare first value for `value`). */
function attr(args: string, names: string[]): string | undefined {
  for (const part of topLevelSplit(args)) {
    const kv = /^(\w+)\s*=\s*([\s\S]*)$/.exec(part);
    if (kv) { if (names.includes(kv[1]!)) return kv[2]!.trim(); }
    else if (names.includes('value')) return part;
  }
  return undefined;
}

function stringList(v: string | undefined, consts: Map<string, string>): string[] {
  if (v === undefined) return [''];
  const t = v.trim();
  if (t.startsWith('{')) return topLevelSplit(t.slice(1, -1)).map((x) => evalStringExpr(x, consts));
  return [evalStringExpr(t, consts)];
}

const MAPPINGS: Record<string, string> = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE' };

interface JavaEndpoint { key: string; preAuthorize: string | null; where: string }

function javaEndpoints(): JavaEndpoint[] {
  const files = walk(JAVA).filter((f) => /\/web\/.*Controller\.java$/.test(f));
  for (const f of walk(JAVA).filter((x) => x.endsWith('.java'))) {
    for (const [k, v] of stringConstants(stripComments(readFileSync(f, 'utf8')))) if (!GLOBAL_CONSTS.has(k)) GLOBAL_CONSTS.set(k, v);
  }
  const out: JavaEndpoint[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const consts = stringConstants(src);
    const anns = annotations(src);
    // Group consecutive annotations (only whitespace between them).
    const groups: { anns: Annotation[]; after: string }[] = [];
    for (const a of anns) {
      const g = groups[groups.length - 1];
      if (g && /^\s*$/.test(src.slice(g.anns[g.anns.length - 1]!.end, a.start))) g.anns.push(a);
      else groups.push({ anns: [a], after: '' });
    }
    for (const g of groups) g.after = src.slice(g.anns[g.anns.length - 1]!.end, g.anns[g.anns.length - 1]!.end + 200).trim();
    const classGroup = groups.find((g) => /^(public\s+|final\s+|abstract\s+)*(class|interface)\s/.test(g.after));
    if (!classGroup || !classGroup.anns.some((a) => a.name === 'RestController' || a.name === 'Controller')) continue;
    const classMapping = classGroup.anns.find((a) => a.name === 'RequestMapping');
    const prefixes = classMapping ? stringList(attr(classMapping.args, ['value', 'path']), consts) : [''];
    const classPre = classGroup.anns.find((a) => a.name === 'PreAuthorize');
    const classRule = classPre ? evalStringExpr(attr(classPre.args, ['value'])!, consts) : null;
    for (const g of groups) {
      if (g === classGroup) continue;
      for (const a of g.anns) {
        let methods: string[];
        if (MAPPINGS[a.name]) methods = [MAPPINGS[a.name]!];
        else if (a.name === 'RequestMapping') {
          const m = attr(a.args, ['method']);
          methods = m ? [...m.matchAll(/RequestMethod\.(\w+)/g)].map((x) => x[1]!) : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        } else continue;
        const pre = g.anns.find((x) => x.name === 'PreAuthorize');
        const rule = pre ? evalStringExpr(attr(pre.args, ['value'])!, consts) : classRule;
        const name = /\s(\w+)\s*\(/.exec(g.after)?.[1] ?? '?';
        for (const prefix of prefixes) {
          for (const p of stringList(attr(a.args, ['value', 'path']), consts)) {
            const path = (prefix + p) || '/';
            for (const m of methods) out.push({ key: ruleKey(m, path), preAuthorize: rule, where: `${file.slice(JAVA.length + 5)}#${name}` });
          }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- rule normalization

/** SpEL -> "hasRole(STAFF) or @orgAccess.canEditOrg(slug)" (no parentheses, no `authentication`). */
function normalizeSpel(spel: string): string {
  return spel
    .replace(/authentication\s+instanceof\s+T\([\w.]*JwtAuthenticationToken\)/g, 'JWT')
    .replace(/hasRole\('(\w+)'\)/g, 'hasRole{$1}')
    .replace(/@(\w+)\.(\w+)\(([^()]*(?:\(\))?[^()]*)\)/g, (_m, bean: string, fn: string, args: string) => {
      const as = topLevelSplit(args).filter((x) => x !== 'authentication').map((x) => x.replace(/^#/, '').replace(/^\w+\.(\w+)\(\)$/, '$1'));
      return `@${bean}.${fn}{${as.join(',')}}`;
    })
    .replace(/[()]/g, '')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderRule(e: MethodExpr): string {
  if ('role' in e) return `hasRole(${e.role})`;
  if ('jwtSession' in e) return 'JWT';
  if ('check' in e) return `@${e.check}(${e.args.map((a) => a.replace(/^(path|body)\./, '')).join(',')})`;
  if ('or' in e) return e.or.map(renderRule).join(' or ');
  return e.and.map(renderRule).join(' and ');
}

// ------------------------------------------------------------- SecurityConfig

function javaUrlRules(): UrlRule[] {
  const src = stripComments(readFileSync(join(JAVA, 'config', 'SecurityConfig.java'), 'utf8'));
  const start = src.indexOf('.authorizeHttpRequests(');
  const block = src.slice(start, closeParen(src, src.indexOf('(', start)));
  const consts = new Map([['PATH', GLOBAL_CONSTS.get('PATH') ?? '/v1/auth/dev-login']]);
  const rules: UrlRule[] = [];
  const re = /(if\s*\(devLogin\)\s*reg)?\.(requestMatchers|anyRequest)\(/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(block, open);
    const args = topLevelSplit(block.slice(open + 1, close));
    const accessM = /^\s*\.(permitAll|hasRole|access)\(/.exec(block.slice(close + 1));
    if (!accessM) throw new Error(`no access after matcher at ${m.index}`);
    const aOpen = close + 1 + accessM[0].length - 1;
    const aArgs = block.slice(aOpen + 1, closeParen(block, aOpen)).trim();
    let method: string | undefined;
    if (args[0]?.startsWith('HttpMethod.')) method = args.shift()!.slice('HttpMethod.'.length);
    const patterns = m[2] === 'anyRequest' ? ['/**'] : args.map((a) => evalStringExpr(a.replace(/^\w+\.PATH$/, 'PATH'), consts));
    let access: UrlRule['access'];
    if (accessM[1] === 'permitAll') access = 'permitAll';
    else if (accessM[1] === 'hasRole') access = { role: evalStringExpr(aArgs, consts) as never };
    else if (/^authenticatedAndAllowlisted$/.test(aArgs)) access = 'authenticatedAllowlisted';
    else {
      const r = /hasRole\("(\w+)"\)\s*,\s*emailAllowlisted/.exec(aArgs);
      if (!r) throw new Error(`unknown access ${aArgs}`);
      access = { role: r[1] as never, allowlisted: true };
    }
    rules.push({ ...(m[1] ? {} : {}), method: method as never, patterns, access, ...(m[1] ? { enabledWhen: 'devLogin' as const } : {}) });
  }
  return rules;
}

const normUrlRule = (r: UrlRule) => JSON.stringify({ method: r.method ?? null, patterns: r.patterns, access: r.access, enabledWhen: r.enabledWhen ?? null });

// ------------------------------------------------------------- tests

describe('policy.ts coverage', () => {
  test('every METHOD_RULES key matches a registered route', async () => {
    const keys = new Set((await tsRoutes()).map((r) => ruleKey(r.method, r.path)));
    const orphans = Object.keys(METHOD_RULES).filter((k) => !keys.has(k));
    expect(orphans).toEqual([]);
  });

  test.skipIf(!hasJava)('every Java @PreAuthorize endpoint has the same METHOD_RULES rule', () => {
    const endpoints = javaEndpoints();
    expect(endpoints.length).toBeGreaterThan(250);
    const protectedOnes = endpoints.filter((e) => e.preAuthorize);
    expect(protectedOnes.length).toBeGreaterThan(150);
    const missing = protectedOnes.filter((e) => !METHOD_RULES[e.key]).map((e) => `${e.key} (${e.where})`);
    expect(missing).toEqual([]);
    const different = protectedOnes
      .filter((e) => METHOD_RULES[e.key] && normalizeSpel(e.preAuthorize!) !== renderRule(METHOD_RULES[e.key]!))
      .map((e) => `${e.key}: java "${normalizeSpel(e.preAuthorize!)}" vs ts "${renderRule(METHOD_RULES[e.key]!)}"`);
    expect(different).toEqual([]);
    const extra = Object.keys(METHOD_RULES).filter((k) => !protectedOnes.some((e) => e.key === k));
    expect(extra).toEqual([]);
  });

  test.skipIf(!hasJava)('every registered route maps to a Java endpoint, and routes without a rule have none in Java', async () => {
    const java = new Map(javaEndpoints().map((e) => [e.key, e]));
    const routes = await tsRoutes();
    const unknown = routes.filter((r) => r.feature !== 'core' && !java.has(ruleKey(r.method, r.path))).map((r) => `${r.feature}: ${ruleKey(r.method, r.path)}`);
    expect(unknown).toEqual([]);
    const unguarded = routes
      .filter((r) => !METHOD_RULES[ruleKey(r.method, r.path)] && java.get(ruleKey(r.method, r.path))?.preAuthorize)
      .map((r) => ruleKey(r.method, r.path));
    expect(unguarded).toEqual([]);
  });

  test.skipIf(!hasJava)('URL_RULES is SecurityConfig.authorizeHttpRequests in the same order', () => {
    javaEndpoints(); // loads the global constants (DevLoginController.PATH)
    expect(URL_RULES.map(normUrlRule)).toEqual(javaUrlRules().map(normUrlRule));
  });
});
