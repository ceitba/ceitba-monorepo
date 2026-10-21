import type { Context } from 'hono';
import type { Deps } from '../deps';
import type { Principal } from './auth/principal';
import type { UserRow } from './auth/repo';

/** Per-request state (the servlet request attributes + SecurityContext). */
export interface RequestState {
  /** Raw request URI path incl. /api, as Tomcat's getRequestURI() (ErrorResponse.path). */
  requestUri: string;
  /** Raw (undecoded) path inside /api: rate limits, API-key scope rules, token endpoints. */
  rawPath: string;
  /** Decoded path inside /api: URL policy and routing. */
  path: string;
  method: string;
  clientIp: string;
  remoteAddr: string;
  principal: Principal;
  /** CurrentUserResolver result, memoized. */
  currentUser?: UserRow | null;
  /** Headers to add to the final response (rate-limit headers...). */
  extraHeaders: Record<string, string>;
}

export interface AppEnv {
  Bindings: { state: RequestState };
  Variables: { state: RequestState; deps: Deps };
}

export type AppContext = Context<AppEnv>;
