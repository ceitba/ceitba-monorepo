// A small RFC 822 / MIME reader for tests (stands in for jakarta.mail's
// MimeMessage parser in GmailApiEmailSenderTest): unfolded headers, RFC 2047
// encoded words, multipart bodies, base64 / quoted-printable transfer encodings.

export interface MimePart {
  headers: [string, string][];
  header(name: string): string | null;
  contentType: string;
  body: string;
  parts: MimePart[];
  subject: string | null;
  leaves(): MimePart[];
}

const utf8 = new TextDecoder();

function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, _cs: string, enc: string, text: string) => {
    if (enc.toUpperCase() === 'B') return utf8.decode(Buffer.from(text, 'base64'));
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (c === '_') bytes.push(0x20);
      else if (c === '=') {
        bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(c.charCodeAt(0));
    }
    return utf8.decode(new Uint8Array(bytes));
  });
}

function decodeBody(body: string, encoding: string | null): string {
  const enc = (encoding ?? '').toLowerCase();
  if (enc === 'base64') return utf8.decode(Buffer.from(body.replace(/\s+/g, ''), 'base64'));
  if (enc === 'quoted-printable') {
    const soft = body.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    const raw = Buffer.from(soft, 'latin1');
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x3d && i + 2 < raw.length + 1) {
        bytes.push(parseInt(String.fromCharCode(raw[i + 1]!, raw[i + 2]!), 16));
        i += 2;
      } else bytes.push(raw[i]!);
    }
    return utf8.decode(new Uint8Array(bytes));
  }
  return utf8.decode(Buffer.from(body, 'latin1'));
}

export function parseMime(input: Uint8Array | string): MimePart {
  const text = typeof input === 'string' ? input : Buffer.from(input).toString('latin1');
  const split = text.search(/\r?\n\r?\n/);
  const head = split < 0 ? text : text.slice(0, split);
  const rest = split < 0 ? '' : text.slice(split).replace(/^\r?\n\r?\n/, '');
  const headers: [string, string][] = [];
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  const header = (name: string) => {
    const h = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return h ? decodeWords(Buffer.from(h[1], 'latin1').toString('utf8')) : null;
  };
  const contentType = header('Content-Type') ?? 'text/plain';
  const parts: MimePart[] = [];
  let body = '';
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (/^multipart\//i.test(contentType) && boundary) {
    const chunks = rest.split(`--${boundary}`);
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith('--')) break;
      parts.push(parseMime(chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, '')));
    }
  } else {
    body = decodeBody(rest, header('Content-Transfer-Encoding'));
  }
  const part: MimePart = {
    headers, header, contentType, body, parts, subject: header('Subject'),
    leaves: () => (parts.length === 0 ? [part] : parts.flatMap((p) => p.leaves())),
  };
  return part;
}
