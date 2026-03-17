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

# Parse the incoming path and category
input_path=$(echo "$body" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
input_category=$(echo "$body" | sed -n 's/.*"category"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

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

# Validate category
case "$input_category" in
  lock|horn|sentry|fun) ;;
  *)
    cat << 'HTTPEOF'
HTTP/1.0 400 Bad Request
Content-type: application/json

{"status":"error","message":"Invalid category"}
HTTPEOF
    exit 1
    ;;
esac

# Read existing metadata or start fresh
if [ -f "$metafile" ]; then
  existing=$(cat "$metafile")
else
  existing="{}"
fi

# Use a simple approach: read existing JSON, update the key, write back
# Build new JSON by removing old entry and adding new one
# We use a temp file approach for safety

tmpfile=$(mktemp)

# If jq is available, use it; otherwise use sed-based approach
if command -v jq >/dev/null 2>&1; then
  if ! echo "$existing" | jq --arg path "$input_path" --arg cat "$input_category" \
    '. + {($path): $cat}' > "$tmpfile" 2>/dev/null; then
    echo "{\"$input_path\": \"$input_category\"}" > "$tmpfile"
  fi
else
  # Use python3 with env vars to avoid shell injection
  if META_FILE="$metafile" META_PATH="$input_path" META_CAT="$input_category" META_TMP="$tmpfile" \
  python3 -c "
import json, os
metafile = os.environ['META_FILE']
path = os.environ['META_PATH']
cat = os.environ['META_CAT']
tmpfile = os.environ['META_TMP']
try:
    with open(metafile, 'r') as f:
        data = json.load(f)
except:
    data = {}
data[path] = cat
with open(tmpfile, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null; then
    :
  else
    # Last resort: just write the single entry
    printf '{"%s": "%s"}\n' "$input_path" "$input_category" > "$tmpfile"
  fi
fi

mv "$tmpfile" "$metafile"

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

echo '{"status":"ok"}'
