// The List-Id phrase of an organization's announcement
// (OrgAnnouncementService.listIdPhrase in apps/api/.../service/orgmail).
//
// The org's name, which any member can edit, goes into a header as is, so
// control characters (CR/LF would start a new header, e.g. a Bcc) and <>" are
// dropped and non-ASCII text ("Robótica") goes out as an RFC 2047 encoded word
// (jakarta.mail MimeUtility.encodeText(s, "UTF-8", "Q"), ported below).
//
// TODO(orgmail-service): the rest of OrgAnnouncementService / Sender is
// repository + delivery code; the header is
//   List-Id: `${listIdPhrase(name, slug)} <${slug}.orgs.ceitba.org.ar>`.

import { javaStrip, javaUtf8 } from '../../../lib/javaCompat';

export function listIdPhrase(name: string | null | undefined, slug: string): string {
  // [\p{Cntrl}<>"] (Java \p{Cntrl} = ASCII controls) -> ' ', then \s+ (ASCII) -> ' ', strip.
  const s = name == null ? '' : javaStrip(name.replace(/[\x00-\x1F\x7F<>"]/g, ' ').replace(/[ \t\n\x0B\f\r]+/g, ' '));
  if (s.length === 0) return slug;
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return mimeEncodeTextQ(s, 'UTF-8');
}

// QEncoderStream with encodingWord=false (encodeText): only "=_?" are specials.
const TEXT_SPECIALS = '=_?';
const HEX = '0123456789ABCDEF';

function qEncodedLength(bytes: Uint8Array): number {
  let len = 0;
  for (const c of bytes) len += c < 0x20 || c >= 0x7f || TEXT_SPECIALS.includes(String.fromCharCode(c)) ? 3 : 1;
  return len;
}

function qEncode(bytes: Uint8Array): string {
  let out = '';
  for (const c of bytes) {
    if (c === 0x20) out += '_';
    else if (c < 0x20 || c >= 0x7f || TEXT_SPECIALS.includes(String.fromCharCode(c))) out += `=${HEX[c >> 4]}${HEX[c & 0xf]}`;
    else out += String.fromCharCode(c);
  }
  return out;
}

/**
 * MimeUtility.encodeText(text, charset, "Q") for a non-ASCII `text`: encoded
 * words of at most 75 chars, split in halves (never inside a surrogate pair)
 * and joined with a space (mail.mime.foldencodedwords=false).
 */
export function mimeEncodeTextQ(text: string, charset: string): string {
  const avail = 75 - 7 - charset.length;
  const prefix = `=?${charset}?Q?`;
  let out = '';
  const doEncode = (s: string, first: boolean): void => {
    const bytes = javaUtf8(s);
    const len = qEncodedLength(bytes);
    if (len > avail && s.length > 1) {
      let split = Math.floor(s.length / 2);
      const hi = s.charCodeAt(split - 1);
      if (hi >= 0xd800 && hi <= 0xdbff) split--;
      if (split > 0) doEncode(s.slice(0, split), first);
      doEncode(s.slice(split), false);
    } else {
      if (!first) out += ' ';
      out += `${prefix}${qEncode(bytes)}?=`;
    }
  };
  doEncode(text, true);
  return out;
}
