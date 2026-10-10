import type { Request, Response } from "express";

// Consent page and browser binding for /authorize.
//
// Any dynamically registered client can build an authorize link, so without
// these a third party could send a student its own link: the student would
// only see Google's account chooser, and the code (plus a CEITBA API key)
// would go to that third party's redirect URI (the "confused deputy" case of
// the MCP authorization spec). So:
//   - /authorize shows which client is asking and where it will send the
//     user back, and the user has to approve it;
//   - /authorize sets a random cookie whose hash is kept with the pending
//     request. The approval POST and the Google callback must come with it,
//     so the flow can only be finished in the browser that started it.
// The cookie is SameSite=Lax: sent on Google's top-level redirect back to us,
// never on a cross-site POST, so it also protects the approval form.

const COOKIE_PREFIX = "mcp_oauth_";

export const bindingCookieName = (pendingId: string): string => COOKIE_PREFIX + pendingId;

export function setBindingCookie(res: Response, pendingId: string, value: string, path: string, secure: boolean, maxAgeMs: number): void {
  res.cookie(bindingCookieName(pendingId), value, { httpOnly: true, secure, sameSite: "lax", path, maxAge: maxAgeMs });
}

export function clearBindingCookie(res: Response, pendingId: string, path: string, secure: boolean): void {
  res.clearCookie(bindingCookieName(pendingId), { httpOnly: true, secure, sameSite: "lax", path });
}

// No cookie-parser: read the one cookie we need from the header.
export function readBindingCookie(req: Request, pendingId: string): string | undefined {
  const name = bindingCookieName(pendingId);
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface ConsentView {
  pendingId: string;
  clientName: string;
  redirectUri: string;
  action: string; // POST target, e.g. /mcp/oauth/consent
}

// Spanish first, then English, like the rest of the server's own text.
export function renderConsent(v: ConsentView): string {
  const client = escapeHtml(v.clientName);
  let host = v.redirectUri;
  try {
    host = new URL(v.redirectUri).host || v.redirectUri;
  } catch { /* keep the raw value */ }
  const dest = escapeHtml(host);
  const full = escapeHtml(v.redirectUri);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar con CEITBA</title>
<style>
  :root { color-scheme: light dark; --bg: #faf7f2; --fg: #2b2620; --muted: #6b6258; --card: #fff; --line: #e6dfd4; --accent: #8a3b12; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d1a17; --fg: #f1ebe3; --muted: #b3a99c; --card: #26221e; --line: #3a342e; --accent: #e69a6b; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 3rem auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
  h1 { font-size: 1.3rem; margin: 0 0 12px; }
  p { margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: .9rem; }
  code { word-break: break-all; }
  .actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
  button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>¿Conectar <strong>${client}</strong> con tu cuenta de CEITBA?</h1>
    <p><strong>${client}</strong> va a poder leer tus datos de CEITBA (perfil, horarios guardados, grupos de estudio,
      propuestas, Apuntes) y, si sos staff o moderador, usar las herramientas de staff.</p>
    <p>Después de iniciar sesión con Google vas a volver a <strong>${dest}</strong>.</p>
    <p class="muted">Continuá solo si vos empezaste esta conexión desde ese asistente. Si alguien te mandó este
      link, cancelá.</p>
    <hr>
    <p lang="en"><strong>Connect ${client} to your CEITBA account?</strong> It will be able to read your CEITBA data
      and, if you are staff or a moderator, use the staff tools. After signing in with Google you will be sent back to
      <strong>${dest}</strong>. Only continue if you started this connection yourself.</p>
    <p class="muted">Redirect URI: <code>${full}</code></p>
    <form method="post" action="${escapeHtml(v.action)}">
      <input type="hidden" name="pending" value="${escapeHtml(v.pendingId)}">
      <div class="actions">
        <button class="primary" type="submit" name="decision" value="allow">Continuar con Google / Continue</button>
        <button type="submit" name="decision" value="deny">Cancelar / Cancel</button>
      </div>
    </form>
  </div>
</main>
</body>
</html>`;
}

// The page must not be framed (clickjacking the approve button) or cached.
export function sendConsent(res: Response, html: string): void {
  res.status(200)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
    })
    .send(html);
}
