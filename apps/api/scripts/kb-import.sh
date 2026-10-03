#!/usr/bin/env bash
# Imports subject wiki pages into a LOCAL API (docs/SUBJECT-WIKI.md).
#
#   scripts/kb-import.sh <dir> [baseUrl]
#
# <dir> holds one folder per subject id (e.g. <dir>/61.12/index.md, ...).
# baseUrl is the API base including /api/v1 (default: ${BASE:-http://localhost:8081}/api/v1,
# the docker-compose.drive.yml stack). Signs in through dev login (needs the
# dev profile + AUTH_DEV_LOGIN_ENABLED=true) as a STAFF user
# (KB_STAFF_EMAIL, default kb-import@itba.edu.ar), then POSTs every subject
# folder with replace=${KB_REPLACE:-true} and prints accepted/rejected/removed.
# Needs curl and python3 (no jq).
set -euo pipefail

DIR="${1:?usage: scripts/kb-import.sh <dir> [baseUrl]}"
API="${2:-${BASE:-http://localhost:8081}/api/v1}"
API="${API%/}"
EMAIL="${KB_STAFF_EMAIL:-kb-import@itba.edu.ar}"
REPLACE="${KB_REPLACE:-true}"

[[ -d "$DIR" ]] || { echo "kb-import: $DIR is not a directory" >&2; exit 1; }

JAR="$(mktemp)"
BODY="$(mktemp)"
OUT="$(mktemp)"
trap 'rm -f "$JAR" "$BODY" "$OUT"' EXIT

status=$(curl -sS -o "$OUT" -w '%{http_code}' -c "$JAR" -X POST "$API/auth/dev-login" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"$EMAIL\",\"name\":\"KB import\",\"staff\":true}")
if [[ "$status" != "204" ]]; then
  echo "kb-import: dev login failed ($status): $(cat "$OUT")" >&2
  echo "  (is the API running with SPRING_PROFILES_ACTIVE=dev and AUTH_DEV_LOGIN_ENABLED=true?)" >&2
  exit 1
fi

failed=0
found=0
for subject_dir in "$DIR"/*/; do
  subject="$(basename "$subject_dir")"
  shopt -s nullglob
  files=("$subject_dir"*.md)
  shopt -u nullglob
  [[ ${#files[@]} -gt 0 ]] || continue
  found=1

  python3 - "$subject_dir" "$REPLACE" > "$BODY" <<'PY'
import json, os, sys
folder, replace = sys.argv[1], sys.argv[2].lower() == "true"
pages = []
for name in sorted(os.listdir(folder)):
    if name.endswith(".md"):
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            pages.append({"path": name, "content": f.read()})
json.dump({"pages": pages, "replace": replace}, sys.stdout, ensure_ascii=False)
PY

  status=$(curl -sS -o "$OUT" -w '%{http_code}' -b "$JAR" -X POST \
    "$API/staff/kb/subjects/$subject/import" \
    -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$BODY")
  if [[ "$status" != "200" ]]; then
    echo "[$subject] HTTP $status: $(cat "$OUT")"
    failed=1
    continue
  fi
  python3 - "$subject" "$OUT" <<'PY' || failed=1
import json, sys
subject, path = sys.argv[1], sys.argv[2]
r = json.load(open(path, encoding="utf-8"))
print(f"[{subject}] accepted {len(r['accepted'])}, rejected {len(r['rejected'])}, removed {len(r['removed'])}")
for slug in r["accepted"]:
    print(f"  + {slug}")
for slug in r["removed"]:
    print(f"  - {slug} (removed)")
for rej in r["rejected"]:
    print(f"  ! {rej['slug']}")
    for e in rej["errors"]:
        print(f"      {e}")
sys.exit(1 if r["rejected"] else 0)
PY
done

[[ $found -eq 1 ]] || { echo "kb-import: no <subjectId>/*.md folders under $DIR" >&2; exit 1; }
exit $failed
