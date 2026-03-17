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

source="${urlargs[1]}"
trim_start="${urlargs[2]}"
trim_end="${urlargs[3]}"

# Validate source exists
if [ ! -f "$source" ]; then
  cat << EOF
HTTP/1.0 400 Bad Request
Content-type: application/json

{"status":"error","message":"Source file not found"}
EOF
  exit 0
fi

# Check ffmpeg is available
if ! command -v ffmpeg > /dev/null 2>&1; then
  cat << EOF
HTTP/1.0 500 Internal Server Error
Content-type: application/json

{"status":"error","message":"ffmpeg not installed"}
EOF
  exit 0
fi

# Validate trim range using awk (bc may not be installed)
valid=$(awk -v e="$trim_end" -v s="$trim_start" 'BEGIN { print (e > s) ? 1 : 0 }' 2>/dev/null)
if [ "$valid" != "1" ]; then
  cat << EOF
HTTP/1.0 400 Bad Request
Content-type: application/json

{"status":"error","message":"Invalid trim range"}
EOF
  exit 0
fi

# Get file extension
ext="${source##*.}"
ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

# Trim the file using ffmpeg
tmpfile=$(mktemp "/tmp/trim.XXXXXX.$ext_lower")
ffmpeg_out_opts=()
if [ "$ext_lower" = "wav" ]; then
  ffmpeg_out_opts=(-acodec pcm_s16le)
fi
duration=$(awk -v e="$trim_end" -v s="$trim_start" 'BEGIN { printf "%.3f", e - s }')
if ffmpeg -y -ss "$trim_start" -i "$source" -to "$duration" "${ffmpeg_out_opts[@]}" "$tmpfile" 2>/tmp/ffmpeg_trim.txt
then
  outsize=$(stat -c%s "$tmpfile" 2>/dev/null || echo 0)
  mv "$tmpfile" "$source"

  cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"ok","size":$outsize}
EOF
else
  rm -f "$tmpfile"
  cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"error","message":"Trim failed"}
EOF
fi
