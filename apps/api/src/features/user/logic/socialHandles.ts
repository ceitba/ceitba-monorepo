// Port of apps/api/src/main/java/org/ceitba/api/service/user/SocialHandles.java.
//
// Normalizes the social handles on the profile. Each accepts a bare handle, an
// @handle or a profile URL (with or without scheme / www.) and returns the bare
// handle, lower-cased. Anything that does not reduce to a valid handle is a
// ValidationError (400 ValidationError "Validation failed for field ...").

import { ValidationError } from '../../../http/errors';
import { JavaIllegalArgument, javaEqualsIgnoreCase, javaSplit, javaTrim, javaUrlDecode } from '../../../lib/javaCompat';

// LinkedIn custom URLs: 3-100 letters, digits or hyphens (code points, like Java).
const LINKEDIN = /^[\p{L}\p{N}-]{3,100}$/u;
// Instagram usernames: 1-30 of a-z, 0-9, '.' and '_'.
const INSTAGRAM = /^[a-z0-9._]{1,30}$/;
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts']);
// Discord: current usernames 2-32 of a-z, 0-9, '.' and '_'; legacy "Name#1234"
// with single inner spaces, no other whitespace, control or format characters.
const DISCORD = /^[a-z0-9._]{2,32}$/;
// [^\p{Z}\p{javaWhitespace}\p{Cc}\p{Cf}@#:`]: javaWhitespace is inside Z + Cc.
const LEGACY_CHAR = '[^\\p{Z}\\p{Cc}\\p{Cf}@#:`]';
// Java's `.` excludes \n \r \u0085 \u2028 \u2029.
const DISCORD_LEGACY = new RegExp(`^(?=[^\\n\\r\\u0085\\u2028\\u2029]{2,32}#)${LEGACY_CHAR}+(?: ${LEGACY_CHAR}+)*#\\d{4}$`, 'u');

export function linkedin(raw: string): string {
  let v = stripAt(raw);
  const path = urlPath(v, 'linkedin.com');
  if (path != null) {
    // Only personal profiles: linkedin.com/in/<slug>[/...]
    const seg = javaSplit(path, /\//);
    if (seg.length < 2 || !javaEqualsIgnoreCase('in', seg[0]!)) {
      throw invalid('linkedin', raw, 'must be a linkedin.com/in/<handle> URL or a handle');
    }
    // Browsers percent-encode non-ASCII slugs (jos%C3%A9-p%C3%A9rez).
    try {
      v = javaUrlDecode(seg[1]!);
    } catch (e) {
      if (e instanceof JavaIllegalArgument) throw invalid('linkedin', raw, 'must be 3-100 letters, digits or hyphens');
      throw e;
    }
  }
  v = v.toLowerCase();
  if (!LINKEDIN.test(v)) throw invalid('linkedin', raw, 'must be 3-100 letters, digits or hyphens');
  return v;
}

export function instagram(raw: string): string {
  let v = stripAt(raw);
  const path = urlPath(v, 'instagram.com');
  if (path != null) {
    // Only profiles: instagram.com/<handle>[/], never a post, reel, story or other page.
    const seg = javaSplit(path, /\//);
    if (seg.length !== 1 || INSTAGRAM_RESERVED.has(seg[0]!.toLowerCase())) {
      throw invalid('instagram', raw, 'must be an instagram.com/<handle> URL or a handle');
    }
    v = seg[0]!;
  }
  v = v.toLowerCase();
  if (!INSTAGRAM.test(v)) throw invalid('instagram', raw, "must be 1-30 letters, digits, '.' or '_'");
  return v;
}

export function discord(raw: string): string {
  let v = stripAt(raw);
  if (DISCORD_LEGACY.test(v)) return v;
  v = v.toLowerCase();
  if (!DISCORD.test(v)) throw invalid('discord', raw, "must be a Discord username (2-32 of a-z, 0-9, '.', '_')");
  return v;
}

function stripAt(raw: string): string {
  const v = javaTrim(raw);
  return v.startsWith('@') ? javaTrim(v.slice(1)) : v;
}

/** Path (no leading slash, no query/fragment) when `v` is a URL on `domain` or a subdomain; null otherwise. */
function urlPath(v: string, domain: string): string | null {
  const rest = v.replace(/^https?:\/\//i, '');
  const slash = rest.indexOf('/');
  const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  const path = slash < 0 ? '' : rest.slice(slash + 1);
  // replaceFirst("[?#].*$", ""): Java's `.` stops at line terminators and `$` also matches before a final one.
  return path.replace(/[?#][^\n\r\u0085\u2028\u2029]*(?=(?:\r\n|[\n\r\u0085\u2028\u2029])?$)/, '');
}

function invalid(field: string, value: string, reason: string): ValidationError {
  return new ValidationError(field, value, reason);
}
