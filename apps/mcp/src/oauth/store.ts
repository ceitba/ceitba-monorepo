import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// Persistent OAuth state (SQLite, one file on a Docker volume).
//   clients   dynamically registered MCP clients (RFC 7591); registration is
//             open, so clients that never complete a sign-in are swept after a
//             day, and ones without a sign-in for STALE_CLIENT_MS too
//   pending   /authorize requests waiting for consent and the Google round trip
//             (10 min), bound to the starting browser by a cookie hash
//   codes     authorization codes (5 min, single use)
//   grants    one per user login: the encrypted, scoped CEITBA API key
//   tokens    access/refresh tokens, stored as SHA-256 hashes only

export interface PendingAuth {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
  nonce: string;
  // SHA-256 of the browser-binding cookie set by /authorize (oauth/consent.ts).
  bindingHash: string;
  // Set when the user approves the consent page.
  approved: boolean;
  expiresAt: number;
}

export interface Grant {
  id: string;
  clientId: string;
  userId: string;
  scopes: string[];
  apiKeySealed: string;
  apiKeyId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthCode {
  codeHash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
  expiresAt: number;
}

export interface TokenRow {
  tokenHash: string;
  kind: "access" | "refresh";
  grantId: string;
  clientId: string;
  expiresAt: number;
}

const now = () => Date.now();

const DAY_MS = 86_400_000;
// Registered but never used for a sign-in: gone after a day.
const UNUSED_CLIENT_MS = DAY_MS;
// Used, but no sign-in left and none for this long: gone too.
const STALE_CLIENT_MS = 180 * DAY_MS;

export class OAuthStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    // Pending rows live 10 minutes, so a pending table from before the consent
    // page (no binding_hash) is simply recreated.
    const pendingCols = this.db.query<{ name: string }, []>("PRAGMA table_info(pending)").all().map(c => c.name);
    if (pendingCols.length > 0 && !pendingCols.includes("binding_hash")) this.db.exec("DROP TABLE pending");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY, info TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS pending (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL,
        state TEXT, scopes TEXT NOT NULL, resource TEXT, nonce TEXT NOT NULL, binding_hash TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, scopes TEXT NOT NULL,
        api_key_sealed TEXT NOT NULL, api_key_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS codes (
        code_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, resource TEXT,
        expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (
        token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tokens_grant ON tokens(grant_id);
      CREATE INDEX IF NOT EXISTS grants_user ON grants(user_id);
      CREATE INDEX IF NOT EXISTS grants_client ON grants(client_id);
    `);
    // Stores from before client sweeping: their clients count as used now.
    const clientCols = this.db.query<{ name: string }, []>("PRAGMA table_info(clients)").all().map(c => c.name);
    if (!clientCols.includes("used_at")) {
      this.db.exec("ALTER TABLE clients ADD COLUMN used_at INTEGER");
      this.db.query("UPDATE clients SET used_at = ?").run(now());
    }
  }

  // ---- clients
  getClient(id: string): OAuthClientInformationFull | undefined {
    const row = this.db.query<{ info: string }, [string]>("SELECT info FROM clients WHERE client_id = ?").get(id);
    return row ? (JSON.parse(row.info) as OAuthClientInformationFull) : undefined;
  }

  saveClient(info: OAuthClientInformationFull): void {
    this.db.query("INSERT OR REPLACE INTO clients (client_id, info, created_at) VALUES (?, ?, ?)")
      .run(info.client_id, JSON.stringify(info), now());
  }

  countClients(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM clients").get()!.n;
  }

  // ---- pending authorizations
  savePending(p: PendingAuth): void {
    this.db.query(`INSERT INTO pending (id, client_id, redirect_uri, code_challenge, state, scopes, resource, nonce,
                                        binding_hash, approved, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.id, p.clientId, p.redirectUri, p.codeChallenge, p.state, JSON.stringify(p.scopes), p.resource, p.nonce,
        p.bindingHash, p.approved ? 1 : 0, p.expiresAt);
  }

  getPending(id: string): PendingAuth | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM pending WHERE id = ?").get(id);
    return row ? this.pendingFrom(row) : undefined;
  }

  approvePending(id: string): void {
    this.db.query("UPDATE pending SET approved = 1 WHERE id = ?").run(id);
  }

  // Single use: returns and deletes.
  takePending(id: string): PendingAuth | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("DELETE FROM pending WHERE id = ? RETURNING *").get(id);
    return row ? this.pendingFrom(row) : undefined;
  }

  private pendingFrom(row: Record<string, unknown>): PendingAuth | undefined {
    if ((row.expires_at as number) < now()) return undefined;
    return {
      id: row.id as string, clientId: row.client_id as string, redirectUri: row.redirect_uri as string,
      codeChallenge: row.code_challenge as string, state: (row.state as string) ?? null,
      scopes: JSON.parse(row.scopes as string), resource: (row.resource as string) ?? null,
      nonce: row.nonce as string, bindingHash: row.binding_hash as string, approved: row.approved === 1,
      expiresAt: row.expires_at as number
    };
  }

  // ---- grants
  saveGrant(g: Grant): void {
    this.db.query(`INSERT INTO grants (id, client_id, user_id, scopes, api_key_sealed, api_key_id, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(g.id, g.clientId, g.userId, JSON.stringify(g.scopes), g.apiKeySealed, g.apiKeyId, g.createdAt, g.expiresAt);
    this.db.query("UPDATE clients SET used_at = ? WHERE client_id = ?").run(now(), g.clientId);
  }

  // A new grant and its first authorization code, atomically.
  saveGrantWithCode(g: Grant, c: AuthCode): void {
    this.db.transaction(() => {
      this.saveGrant(g);
      this.saveCode(c);
    })();
  }

  getGrant(id: string): Grant | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM grants WHERE id = ?").get(id);
    if (!row) return undefined;
    return {
      id: row.id as string, clientId: row.client_id as string, userId: row.user_id as string,
      scopes: JSON.parse(row.scopes as string), apiKeySealed: row.api_key_sealed as string,
      apiKeyId: row.api_key_id as string, createdAt: row.created_at as number, expiresAt: row.expires_at as number
    };
  }

  deleteGrant(id: string): void {
    this.db.query("DELETE FROM grants WHERE id = ?").run(id);
  }

  // ---- codes
  saveCode(c: AuthCode): void {
    this.db.query(`INSERT INTO codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.codeHash, c.grantId, c.clientId, c.redirectUri, c.codeChallenge, c.resource, c.expiresAt);
  }

  getCode(codeHash: string): AuthCode | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM codes WHERE code_hash = ?").get(codeHash);
    return row ? this.codeFrom(row) : undefined;
  }

  takeCode(codeHash: string): AuthCode | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("DELETE FROM codes WHERE code_hash = ? RETURNING *").get(codeHash);
    return row ? this.codeFrom(row) : undefined;
  }

  private codeFrom(row: Record<string, unknown>): AuthCode {
    return {
      codeHash: row.code_hash as string, grantId: row.grant_id as string, clientId: row.client_id as string,
      redirectUri: row.redirect_uri as string, codeChallenge: row.code_challenge as string,
      resource: (row.resource as string) ?? null, expiresAt: row.expires_at as number
    };
  }

  // ---- tokens
  saveToken(t: TokenRow): void {
    this.db.query("INSERT INTO tokens (token_hash, kind, grant_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(t.tokenHash, t.kind, t.grantId, t.clientId, t.expiresAt);
  }

  getToken(tokenHash: string): TokenRow | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM tokens WHERE token_hash = ?").get(tokenHash);
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash as string, kind: row.kind as TokenRow["kind"], grantId: row.grant_id as string,
      clientId: row.client_id as string, expiresAt: row.expires_at as number
    };
  }

  // Single use (refresh rotation): returns and deletes, atomically, so two
  // concurrent refreshes can't both get the row.
  takeToken(tokenHash: string): TokenRow | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("DELETE FROM tokens WHERE token_hash = ? RETURNING *").get(tokenHash);
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash as string, kind: row.kind as TokenRow["kind"], grantId: row.grant_id as string,
      clientId: row.client_id as string, expiresAt: row.expires_at as number
    };
  }

  deleteToken(tokenHash: string): void {
    this.db.query("DELETE FROM tokens WHERE token_hash = ?").run(tokenHash);
  }

  // Drops everything past its expiry, plus grants that never got (or no longer
  // have) a code or token, e.g. a login abandoned after the Google step.
  // Returns those grants so their API keys can be revoked.
  sweep(at = now(), orphanAfterMs = 15 * 60_000): Grant[] {
    this.db.query("DELETE FROM pending WHERE expires_at < ?").run(at);
    this.db.query("DELETE FROM codes WHERE expires_at < ?").run(at);
    this.db.query("DELETE FROM tokens WHERE expires_at < ?").run(at);
    const ids = this.db.query<{ id: string }, [number, number]>(`
      SELECT id FROM grants g WHERE g.expires_at < ?
         OR (g.created_at < ?
             AND NOT EXISTS (SELECT 1 FROM tokens t WHERE t.grant_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM codes c WHERE c.grant_id = g.id))`).all(at, at - orphanAfterMs);
    const gone = ids.map(r => this.getGrant(r.id)).filter((g): g is Grant => Boolean(g));
    for (const g of gone) this.deleteGrant(g.id);
    // Clients with no sign-in and none in progress: never used after a day,
    // or idle for STALE_CLIENT_MS. Keeps open registration from filling the
    // table up to the cap for good.
    this.db.query(`
      DELETE FROM clients WHERE
        (CASE WHEN used_at IS NULL THEN created_at < ? ELSE used_at < ? END)
        AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.client_id = clients.client_id)
        AND NOT EXISTS (SELECT 1 FROM pending p WHERE p.client_id = clients.client_id)`)
      .run(at - UNUSED_CLIENT_MS, at - STALE_CLIENT_MS);
    return gone;
  }

  close(): void {
    this.db.close();
  }
}
