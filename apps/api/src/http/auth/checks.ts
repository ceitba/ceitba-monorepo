// Evaluation of METHOD_RULES (@PreAuthorize) and the registry of named checks
// that features implement (the `@orgAccess` bean in Java).

import type { Deps } from '../../deps';
import { InternalServerError } from '../errors';
import type { MethodExpr } from './policy';
import { hasRole, type Principal } from './principal';

export interface AccessCheckContext {
  deps: Deps;
  principal: Principal;
}

/** A check receives the resolved arguments (path variables / body fields) in rule order. */
export type AccessCheck = (ctx: AccessCheckContext, ...args: unknown[]) => Promise<boolean> | boolean;

export class AccessChecks {
  private readonly checks = new Map<string, AccessCheck>();
  /** Called from a feature's routes.ts, e.g. register('orgAccess.canEditOrg', (ctx, slug) => ...). */
  register(name: string, fn: AccessCheck): void {
    this.checks.set(name, fn);
  }
  get(name: string): AccessCheck | undefined {
    return this.checks.get(name);
  }
  names(): string[] {
    return [...this.checks.keys()].sort();
  }
}

export interface RuleArgs {
  params: Record<string, unknown>;
  body: unknown;
}

function argValue(spec: string, a: RuleArgs): unknown {
  if (spec.startsWith('path.')) return a.params[spec.slice(5)] ?? null;
  if (spec.startsWith('body.')) {
    const b = a.body as Record<string, unknown> | null | undefined;
    return b ? (b[spec.slice(5)] ?? null) : null;
  }
  throw new Error(`Bad rule argument ${spec}`);
}

/** Spring SpEL semantics: `or`/`and` short-circuit left to right. */
export async function evaluateRule(expr: MethodExpr, ctx: AccessCheckContext, args: RuleArgs): Promise<boolean> {
  if ('role' in expr) return hasRole(ctx.principal, expr.role);
  if ('jwtSession' in expr) return ctx.principal.kind === 'jwt';
  if ('or' in expr) {
    for (const e of expr.or) if (await evaluateRule(e, ctx, args)) return true;
    return false;
  }
  if ('and' in expr) {
    for (const e of expr.and) if (!(await evaluateRule(e, ctx, args))) return false;
    return true;
  }
  const fn = ctx.deps.accessChecks.get(expr.check);
  if (!fn) {
    ctx.deps.log.error(`Access check ${expr.check} is not registered (its feature must call deps.accessChecks.register)`);
    throw new InternalServerError();
  }
  return Boolean(await fn(ctx, ...expr.args.map((s) => argValue(s, args))));
}
