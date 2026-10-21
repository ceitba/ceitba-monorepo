// jakarta.mail.internet.InternetAddress(address, strict = true), the parts the
// mail code relies on: `Name <addr>`, `"Quoted name" <addr>` or a bare `addr`,
// whose address part must pass InternetAddress.checkAddress (an @, a non-empty
// local part and domain, no unquoted specials or whitespace, no empty domain
// labels). Returns the address part; throws AddressError otherwise.

import { javaTrim } from '../../../lib/javaCompat';

export class AddressError extends Error {}

const SPECIALS = /[\s()<>,;:\\"[\]@]/;

function checkAddress(addr: string, original: string): void {
  if (addr.length === 0) throw new AddressError(`Empty address in string \`\`${original}''`);
  const at = addr.lastIndexOf('@');
  if (at < 0) throw new AddressError(`Missing final '@domain' in string \`\`${original}''`);
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (local.length === 0) throw new AddressError(`Missing local name in string \`\`${original}''`);
  if (domain.length === 0) throw new AddressError(`Missing domain in string \`\`${original}''`);
  const quotedLocal = /^"(?:[^"\\\r\n]|\\.)*"$/.test(local);
  if (!quotedLocal) {
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) throw new AddressError(`Local address starts or ends with '.' in string \`\`${original}''`);
    if (SPECIALS.test(local)) throw new AddressError(`Local address contains illegal character in string \`\`${original}''`);
  }
  if (domain.startsWith('[')) {
    if (!/^\[[^[\]\\\s]*\]$/.test(domain)) throw new AddressError(`Domain contains illegal character in string \`\`${original}''`);
    return;
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) throw new AddressError(`Domain starts or ends with '.' in string \`\`${original}''`);
  if (SPECIALS.test(domain)) throw new AddressError(`Domain contains illegal character in string \`\`${original}''`);
}

export function parseStrictAddress(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  if (s.length === 0) throw new AddressError('Empty address');
  const angle = /^(?:(?:"(?:[^"\\]|\\.)*"|[^"<>]*)\s*)?<([^<>]*)>$/.exec(s);
  const addr = angle ? angle[1]!.trim() : s;
  checkAddress(addr, s);
  return addr;
}

/** "CEITBA <ceitba@itba.edu.ar>" -> the address (InternetAddress.getAddress). */
export function addressOf(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  return javaTrim(m ? m[1]! : from);
}
