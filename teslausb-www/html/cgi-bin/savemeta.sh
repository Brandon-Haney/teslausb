#!/bin/bash

declare -a urlargs
IFS='&' read -r -a urlargs <<<"$QUERY_STRING"

declare -i len=${#urlargs[@]}
for ((i=0; i<${len}; i++ ))
do
  val="${urlargs[i]//+/ }"
  urlargs[i]="$(echo -e "${val//%/\\x}")"
done

# Reject path traversal attempts
for arg in "${urlargs[@]}"; do
  case "$arg" in
    *../*|*/../*|..*)
      printf 'HTTP/1.0 403 Forbidden\r\nContent-type: text/plain\r\n\r\nForbidden\n'
      exit 0
      ;;
  esac
done

cd "$DOCUMENT_ROOT/${urlargs[0]}" 2>/dev/null || cd "$DOCUMENT_ROOT/fs/Boombox" 2>/dev/null

# Read POST body (JSON with path and category)
read -r body

metafile="Boombox/.soundmeta.json"

# Parse the incoming path, category, and favorite
input_path=$(echo "$body" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
input_category=$(echo "$body" | sed -n 's/.*"category"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
input_favorite=$(echo "$body" | sed -n 's/.*"favorite"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p')

# Reject path traversal in input_path
case "$input_path" in
  *../*|*/../*|..*)
    cat << 'HTTPEOF'
HTTP/1.0 403 Forbidden
Content-type: application/json

{"status":"error","message":"Invalid path"}
HTTPEOF
    exit 1
    ;;
esac

# Validate category (allow empty for favorite-only toggles)
case "$input_category" in
  lock|horn|sentry|fun|"") ;;
  *)
    cat << 'HTTPEOF'
HTTP/1.0 400 Bad Request
Content-type: application/json

{"status":"error","message":"Invalid category"}
HTTPEOF
    exit 1
    ;;
esac

# Default favorite to false if not provided
if [ -z "$input_favorite" ]; then
  input_favorite="false"
fi

# Use python3 to read existing metadata, merge fields, and write back
tmpfile=$(mktemp)

if META_FILE="$metafile" META_PATH="$input_path" META_CAT="$input_category" META_FAV="$input_favorite" META_TMP="$tmpfile" \
python3 -c "
import json, os
metafile = os.environ['META_FILE']
path = os.environ['META_PATH']
cat = os.environ['META_CAT']
fav = os.environ['META_FAV'] == 'true'
tmpfile = os.environ['META_TMP']
try:
    with open(metafile, 'r') as f:
        data = json.load(f)
except:
    data = {}
# Read existing entry, upgrading string format to object
existing = data.get(path, {})
if isinstance(existing, str):
    existing = {'category': existing, 'favorite': False}
# Merge: only update fields that were provided
if cat:
    existing['category'] = cat
if 'category' not in existing:
    existing['category'] = ''
existing['favorite'] = fav
data[path] = existing
with open(tmpfile, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null; then
  :
else
  # Fallback: just write the single entry
  printf '{"%s": {"category": "%s", "favorite": %s}}\n' "$input_path" "$input_category" "$input_favorite" > "$tmpfile"
fi

mv "$tmpfile" "$metafile"

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

echo '{"status":"ok"}'
