// Port of apps/api/src/main/java/org/ceitba/api/service/drive/DriveFolderUrls.java.
//
// Extracts a Drive folder id from what a student pastes:
//   https://drive.google.com/drive/folders/<id>[?usp=sharing]
//   https://drive.google.com/drive/u/1/folders/<id>
//   https://drive.google.com/open?id=<id>   (any URL with ?id=<id>)
//   <id>                                    (bare id)

import { javaSplit, javaTrim, javaUrlDecode } from '../../../lib/javaCompat';
import { javaUriCreate, JavaUriSyntaxError, type JavaUri } from '../../../lib/javaUri';

// Drive ids are URL-safe base64-ish: letters, digits, '-' and '_'.
const ID = /^[A-Za-z0-9_-]{10,128}$/;
const FOLDERS_PATH = /\/folders\/([A-Za-z0-9_-]+)/;

/** DriveFolderUrls.parse: the folder id, or null (Optional.empty()). */
export function parseDriveFolderUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = javaTrim(input);
  if (s.length === 0) return null;
  if (ID.test(s)) return s;

  let uri: JavaUri;
  try {
    uri = javaUriCreate(s.includes('://') ? s : `https://${s}`);
  } catch (e) {
    if (e instanceof JavaUriSyntaxError) return null;
    throw e;
  }
  const host = uri.host;
  if (host == null || !(host === 'drive.google.com' || host === 'docs.google.com')) return null;
  if (uri.rawPath != null) {
    const m = FOLDERS_PATH.exec(uri.rawPath);
    if (m) return valid(m[1]!);
  }
  if (uri.rawQuery != null) {
    for (const pair of javaSplit(uri.rawQuery, /&/)) {
      const eq = pair.indexOf('=');
      if (eq > 0 && pair.slice(0, eq) === 'id') {
        // URLDecoder.decode throws IllegalArgumentException on a bad escape,
        // which DriveFolderUrls does not catch (the caller gets a 500 in Java too).
        return valid(javaUrlDecode(pair.slice(eq + 1)));
      }
    }
  }
  return null;
}

function valid(id: string): string | null {
  return ID.test(id) ? id : null;
}

