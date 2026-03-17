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

cd "$DOCUMENT_ROOT/${urlargs[0]}" 2>/dev/null || exit 1

destdir="${urlargs[1]:-Boombox}"

if [ "$REQUEST_METHOD" = "POST" ] && [ "$CONTENT_LENGTH" -gt 0 ]
then
  # Save uploaded zip to temp file
  tmpfile=$(mktemp /tmp/soundpack.XXXXXX.zip)
  cat > "$tmpfile"

  # Validate it's actually a zip
  if file "$tmpfile" | grep -qi "zip"
  then
    # Extract only audio files, skip anything else
    imported=""
    count=0
    while IFS= read -r entry; do
      lower=$(echo "$entry" | tr '[:upper:]' '[:lower:]')
      case "$lower" in
        *.wav|*.mp3|*.m4a|*.flac|*.ogg)
          # Extract this file into the destination (flatten directories)
          if unzip -o -j "$tmpfile" "$entry" -d "$destdir/" 2>/dev/null; then
            bname=$(basename "$entry")
            imported="${imported}\"${bname}\","
            ((count++))
          fi
          ;;
      esac
    done < <(unzip -Z1 "$tmpfile" 2>/dev/null)

    rm -f "$tmpfile"

    # Remove trailing comma
    imported="${imported%,}"

    cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"ok","count":${count},"files":[${imported}]}
EOF
    exit 0
  fi

  rm -f "$tmpfile"
fi

cat << EOF
HTTP/1.0 400 Bad Request
Content-type: application/json

{"status":"error","message":"Invalid or missing zip file"}
EOF
