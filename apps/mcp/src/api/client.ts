// Thin fetch wrapper around the CEITBA API (apps/api). One instance per
// caller: it carries that caller's credential and client IP.
//
// Auth: a user API key (ceitba_..., scoped: read/write/staff) is sent as
// X-Api-Key. A bearer JWT is only used during the OAuth bridge, to mint that
// key. Nothing here ever logs either credential.
//
// Client IP: the API rate-limits most routes per IP and trusts the right-most
// X-Forwarded-For entry from private peers (ClientIp.java). In production this
// server reaches the API over the private Docker network, so forwarding the
// end user's IP keeps one user's limits from being shared by everyone.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly path: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface ApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  bearer?: string;
  forwardedFor?: string;
  userAgent?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class CeitbaApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  get authenticated(): boolean {
    return Boolean(this.opts.apiKey || this.opts.bearer);
  }

  withCredentials(creds: { apiKey?: string; bearer?: string }): CeitbaApi {
    return new CeitbaApi({ ...this.opts, apiKey: creds.apiKey, bearer: creds.bearer });
  }

  // Same credentials, requests attributed to another end-user IP.
  withForwardedFor(ip: string | undefined): CeitbaApi {
    return new CeitbaApi({ ...this.opts, forwardedFor: ip });
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>(method, path, { body, query });
  }

  async request<T>(method: string, path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.opts.userAgent ?? "ceitba-mcp"
    };
    if (this.opts.apiKey) headers["X-Api-Key"] = this.opts.apiKey;
    else if (this.opts.bearer) headers["Authorization"] = `Bearer ${this.opts.bearer}`;
    if (this.opts.forwardedFor) headers["X-Forwarded-For"] = this.opts.forwardedFor;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000)
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ApiError(timeout ? "The CEITBA API did not answer in time" : "Could not reach the CEITBA API",
        0, timeout ? "Timeout" : "NetworkError", path);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try { json = JSON.parse(text); } catch { json = undefined; }
    }
    if (!res.ok) {
      const errBody = (json ?? {}) as { error?: string; message?: string };
      throw new ApiError(errBody.message ?? `HTTP ${res.status}`, res.status, errBody.error ?? `HTTP_${res.status}`, path);
    }
    return (json ?? text) as T;
  }
}
