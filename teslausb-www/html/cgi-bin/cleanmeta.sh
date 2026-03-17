#!/bin/bash

# Removes entries from .soundmeta.json for files that no longer exist on disk.

declare -a urlargs
IFS='&' read -r -a urlargs <<<"$QUERY_STRING"

declare -i len=${#urlargs[@]}
for ((i=0; i<${len}; i++ ))
do
  val="${urlargs[i]//+/ }"
  urlargs[i]="$(echo -e "${val//%/\\x}")"
done

cd "$DOCUMENT_ROOT/${urlargs[0]}" 2>/dev/null || cd "$DOCUMENT_ROOT/fs/Boombox" 2>/dev/null

metafile="Boombox/.soundmeta.json"

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

if [ ! -f "$metafile" ]; then
  echo '{"status":"ok","removed":0}'
  exit 0
fi

# Remove entries whose files no longer exist
META_FILE="$metafile" python3 -c "
import json, os
metafile = os.environ['META_FILE']
try:
    with open(metafile) as f:
        data = json.load(f)
    before = len(data)
    data = {k: v for k, v in data.items() if os.path.isfile('Boombox/' + k)}
    removed = before - len(data)
    with open(metafile, 'w') as f:
        json.dump(data, f, indent=2)
    print(json.dumps({'status': 'ok', 'removed': removed}))
except Exception as e:
    print(json.dumps({'status': 'error', 'message': str(e)}))
" 2>/dev/null || echo '{"status":"error","message":"python3 failed"}'
