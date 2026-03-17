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

# If source is already a WAV, write compressed version to a temp name
# so we don't overwrite the original
if [ "$source" = "$dest" ]; then
  dest="${dirpart}/${nameonly}_compressed.wav"
elif [ -f "$dest" ]; then
  dest="${dirpart}/${nameonly}_converted.wav"
fi

# Convert to Tesla lock chime format: 16-bit PCM WAV, mono
# Try 44.1kHz first; if over 1MB, retry at 22.05kHz for more compression
tmpfile=$(mktemp /tmp/convert.XXXXXX.wav)
if ffmpeg -y -i "$source" -acodec pcm_s16le -ar 44100 -ac 1 "$tmpfile" 2>/tmp/ffmpeg_out.txt
then
  outsize=$(stat -c%s "$tmpfile" 2>/dev/null || echo 0)

  # If over 1MB at 44.1kHz, retry at 22.05kHz (halves file size)
  if [ "$outsize" -gt 1048576 ]; then
    ffmpeg -y -i "$source" -acodec pcm_s16le -ar 22050 -ac 1 "$tmpfile" 2>/tmp/ffmpeg_out.txt
    outsize=$(stat -c%s "$tmpfile" 2>/dev/null || echo 0)
  fi

  # If still over 1MB, reject
  if [ "$outsize" -gt 1048576 ]; then
    rm -f "$tmpfile"
    cat << EOF
HTTP/1.0 200 OK
Content-type: application/json

{"status":"error","message":"File too long for lock chime (over 1MB even at 22kHz)"}
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
