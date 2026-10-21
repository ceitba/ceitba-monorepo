// The generated content of FakeDriveClient (external/drive/FakeDriveClient.java):
// a Doc's application/zip export (HTML + images/*), one-page PDFs with a line
// of Helvetica text, and the 1x1 PNG. Java builds the PDFs with PDFBox (whose
// output differs on every call: a random /ID), so only their text matters, not
// their bytes; ZIP entries are STORED (nothing hashes the zip itself).

const enc = new TextEncoder();

// ------------------------------------------------------------------- CRC-32

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------- ZIP (stored)

/** A ZIP archive of STORED entries, in the given order (UTF-8 names). */
export function storedZip(entries: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, n.length, true);
    chunks.push(new Uint8Array(local.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return concat([...chunks, ...central, new Uint8Array(end.buffer)]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------------- PDF

/** latin1(): chars 32..255 except 127 kept, everything else '?'. */
function latin1(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    // Java iterates UTF-16 chars: a surrogate pair becomes "??".
    if (ch.length === 2) out += '??';
    else out += c >= 32 && c <= 255 && c !== 127 ? ch : '?';
  }
  return out;
}

/** A one-page PDF (US Letter) with `text` in Helvetica 11 at (50, 700), WinAnsiEncoding (Latin-1 only). */
export function fakePdf(text: string): Uint8Array {
  const lit = latin1(text).replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT\n/F1 11 Tf\n50 700 Td\n(${lit}) Tj\nET\n`;
  const contentBytes = Uint8Array.from(content, (c) => c.charCodeAt(0));
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /MediaBox [0 0 612 792] /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    pos += b.length;
  };
  const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  push(ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  objs.forEach((o, i) => {
    offsets.push(pos);
    if (o === null) {
      push(ascii(`${i + 1} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`));
      push(contentBytes);
      push(ascii('endstream\nendobj\n'));
    } else {
      push(ascii(`${i + 1} 0 obj\n${o}\nendobj\n`));
    }
  });
  const xref = pos;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) x += `${String(off).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(ascii(x));
  return concat(parts);
}

/** 1x1 transparent PNG. */
export function tinyPng(): Uint8Array {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
}

export const utf8 = (s: string) => enc.encode(s);
