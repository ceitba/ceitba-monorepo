#!/usr/bin/env node
// Exports the legacy CEITBA Firestore collections into the JSON document
// accepted by POST /api/v1/sync/import/firestore:
//
//   { "usuarios": [...], "propuestas": [...], "benefits": [...] }
//
// Each entry is the Firestore document's data plus its document id as "id".
// Timestamps become ISO-8601 strings, DocumentReferences their path and
// GeoPoints {latitude, longitude}. FCM tokens are dropped (the API does not
// import them). Read-only: nothing is written to Firestore.
//
// Usage:
//   npm install
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     node export.mjs --out firestore-export.json
//
// With --copy-attachments, every Propuestas filesURL (a Firebase Storage
// download URL) is downloaded and uploaded to the R2 bucket at
// proposals/legacy/{uuid}.{ext}, and the exported filesURL entry becomes that
// key. The API only imports such keys: a raw Firebase URL is dropped with a
// warning, so attachments never depend on the legacy Firebase project. Needs
// R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (the
// same values the API uses). {uuid} is derived from the download URL, whose
// token is secret, so keys are unguessable and a re-run overwrites the same
// objects instead of duplicating them.
//
// The output contains personal data (names, emails): keep it out of git and
// delete it once the import is done.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, DocumentReference, GeoPoint } from 'firebase-admin/firestore';

const COLLECTIONS = {
  usuarios: 'Usuarios',
  propuestas: 'Propuestas',
  benefits: 'Benefits',
};

// Fields never exported, per collection key.
const DROPPED_FIELDS = {
  usuarios: ['fcmTokens'],
};

function parseArgs(argv) {
  const args = { out: 'firestore-export.json', credentials: null, project: null, copyAttachments: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--credentials') args.credentials = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--copy-attachments') args.copyAttachments = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node export.mjs [--out file.json] [--credentials service-account.json] [--project id]'
        + ' [--copy-attachments]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function toJson(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof DocumentReference) return value.path;
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJson(v);
    return out;
  }
  return value;
}

async function exportCollection(db, key, name) {
  const snapshot = await db.collection(name).get();
  const dropped = DROPPED_FIELDS[key] ?? [];
  return snapshot.docs.map((doc) => {
    const data = toJson(doc.data());
    for (const f of dropped) delete data[f];
    return { id: doc.id, ...data };
  });
}

// Content types the API's importer accepts, by the extension it expects.
const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'application/pdf': 'pdf',
};
const TYPES_BY_EXTENSION = Object.fromEntries(
  [...Object.entries(EXTENSIONS), ['image/jpeg', 'jpeg']].map(([type, ext]) => [ext, type]));
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function r2FromEnv() {
  const env = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = env.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`--copy-attachments needs ${missing.join(', ')}`);
    process.exit(2);
  }
  const client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return { client, bucket: process.env.R2_BUCKET };
}

// UUID-shaped (version 4 bits) SHA-256 of the download URL.
function keyUuid(url) {
  const h = createHash('sha256').update(url).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Firebase download URLs encode the object path: .../o/Propuestas%2F1.jpg?...
function extensionFromUrl(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const m = /\.([A-Za-z0-9]+)$/.exec(path.slice(path.lastIndexOf('/') + 1));
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Returns the R2 key, or null when the file could not be copied (the entry
// then stays a URL and the API drops it with a warning).
async function copyAttachment(r2, url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0 || body.length > MAX_ATTACHMENT_BYTES) throw new Error(`unexpected size ${body.length}`);
  const headerType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let ext = EXTENSIONS[headerType];
  if (!ext) {
    const fromUrl = extensionFromUrl(url);
    ext = fromUrl && TYPES_BY_EXTENSION[fromUrl] ? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) : null;
  }
  if (!ext) throw new Error(`unsupported content type ${headerType || '(none)'}`);
  const key = `proposals/legacy/${keyUuid(url)}.${ext}`;
  await r2.client.send(new PutObjectCommand({
    Bucket: r2.bucket, Key: key, Body: body, ContentType: TYPES_BY_EXTENSION[ext],
  }));
  return key;
}

async function copyAttachments(r2, propuestas) {
  let copied = 0;
  let failed = 0;
  for (const doc of propuestas) {
    if (!Array.isArray(doc.filesURL)) continue;
    const out = [];
    for (const url of doc.filesURL) {
      try {
        const key = await copyAttachment(r2, url);
        if (key) copied++;
        else if (url) failed++;
        out.push(key ?? url);
      } catch (err) {
        // Document id only: never the URL (its token grants access).
        console.error(`Propuestas/${doc.id}: attachment not copied (${err.message})`);
        failed++;
        out.push(url);
      }
    }
    doc.filesURL = out;
  }
  console.error(`Attachments: ${copied} copied to R2, ${failed} not copied`);
  return failed;
}

async function main() {
  const args = parseArgs(process.argv);
  const r2 = args.copyAttachments ? r2FromEnv() : null;
  initializeApp({
    credential: args.credentials ? cert(args.credentials) : applicationDefault(),
    ...(args.project ? { projectId: args.project } : {}),
  });
  const db = getFirestore();

  const result = {};
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    result[key] = await exportCollection(db, key, name);
    // Counts only: never print document contents (personal data).
    console.error(`${name}: ${result[key].length} documents`);
  }

  const notCopied = r2 ? await copyAttachments(r2, result.propuestas) : 0;

  writeFileSync(args.out, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.error(`Wrote ${args.out}`);
  if (notCopied > 0) {
    console.error('Some attachments were not copied; re-run before importing or they will be dropped.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Export failed: ${err.message}`);
  process.exit(1);
});
