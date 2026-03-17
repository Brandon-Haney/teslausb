#!/bin/bash

declare -a urlargs
IFS='&' read -r -a urlargs <<<"$QUERY_STRING"

declare -i len=${#urlargs[@]}
for ((i=0; i<${len}; i++ ))
do
  val="${urlargs[i]//+/ }"
  urlargs[i]="$(echo -e "${val//%/\\x}")"
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
if ! which ffmpeg > /dev/null 2>&1; then
  cat << EOF
HTTP/1.0 500 Internal Server Error
Content-type: application/json

{"status":"error","message":"ffmpeg not installed"}
EOF
  exit 0
fi

# Validate trim range using awk (bc may not be installed)
valid=$(awk "BEGIN { print ($trim_end > $trim_start) ? 1 : 0 }" 2>/dev/null)
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
if [ "$ext_lower" = "wav" ]; then
  ffmpeg_out_opts="-acodec pcm_s16le"
else
  ffmpeg_out_opts=""
fi
if ffmpeg -y -ss "$trim_start" -i "$source" -to "$(awk "BEGIN { printf \"%.3f\", $trim_end - $trim_start }")" $ffmpeg_out_opts "$tmpfile" 2>/tmp/ffmpeg_trim.txt
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
