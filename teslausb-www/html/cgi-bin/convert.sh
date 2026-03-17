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

# Generate output filename: same name but .wav extension
basename=$(basename "$source")
nameonly="${basename%.*}"
dirpart=$(dirname "$source")
dest="${dirpart}/${nameonly}.wav"

# Don't overwrite if dest already exists with same name
if [ -f "$dest" ] && [ "$source" != "$dest" ]; then
  dest="${dirpart}/${nameonly}_converted.wav"
fi

# Convert to Tesla lock chime format: 16-bit PCM WAV, 44.1kHz, mono
# Limit duration to ~22 seconds to stay under 1MB
tmpfile=$(mktemp /tmp/convert.XXXXXX.wav)
if ffmpeg -y -i "$source" -acodec pcm_s16le -ar 44100 -ac 1 -t 22 "$tmpfile" 2>/tmp/ffmpeg_out.txt
then
  outsize=$(stat -c%s "$tmpfile" 2>/dev/null || echo 0)

  # If still over 1MB, reject
  if [ "$outsize" -gt 1048576 ]; then
    rm -f "$tmpfile"
    cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"error","message":"Converted file exceeds 1MB limit"}
EOF
    exit 0
  fi

  mv "$tmpfile" "$dest"
  outname=$(basename "$dest")

  cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"ok","output":"$outname","size":$outsize}
EOF
else
  rm -f "$tmpfile"
  cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"error","message":"Conversion failed"}
EOF
fi
