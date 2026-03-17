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

# Refresh the filesystem cache so we see changes made by the USB host.
# Find the loop device for the boombox disk image and flush its buffers.
loop_dev=$(losetup -j /backingfiles/boombox_disk.bin 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$loop_dev" ] && [ -b "$loop_dev" ]; then
  sudo blockdev --flushbufs "$loop_dev" 2>/dev/null || true
fi

cd "$DOCUMENT_ROOT/${urlargs[0]}" 2>/dev/null || cd "$boombox_mount" 2>/dev/null

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

# Get md5 of current LockChime.wav if it exists
lockchime_md5=""
if [ -f "Boombox/LockChime.wav" ]; then
  lockchime_md5=$(md5sum "Boombox/LockChime.wav" 2>/dev/null | cut -d' ' -f1)
fi

# Read user-assigned category metadata
declare -A soundmeta
if [ -f "Boombox/.soundmeta.json" ]; then
  while IFS='=' read -r key val; do
    soundmeta["$key"]="$val"
  done < <(python3 -c "
import json
try:
    with open('Boombox/.soundmeta.json') as f:
        data = json.load(f)
    for k, v in data.items():
        print(f'{k}={v}')
except:
    pass
" 2>/dev/null)
fi

# Build JSON with file listing and md5 hashes for wav files under 1MB
echo "{"
echo "  \"lockchime_md5\": \"$lockchime_md5\","
echo "  \"sounds\": ["

first=true
while read -r filepath; do
  filename=$(basename "$filepath")
  filesize=$(stat -c%s "$filepath" 2>/dev/null || echo 0)
  ext="${filename##*.}"
  ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

  # Get md5 for wav files under 1MB (potential lock chimes)
  file_md5=""
  if [ "$ext_lower" = "wav" ] && [ "$filesize" -le 1048576 ]; then
    file_md5=$(md5sum "$filepath" 2>/dev/null | cut -d' ' -f1)
  fi

  # Determine category from path
  relpath="${filepath#Boombox/}"
  dirpart="${relpath%/*}"
  if [ "$dirpart" = "$relpath" ]; then
    dirpart=""
  fi

  if [ "$first" = true ]; then
    first=false
  else
    echo ","
  fi

  # Escape filename for JSON
  escaped_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
  escaped_path=$(echo "$relpath" | sed 's/\\/\\\\/g; s/"/\\"/g')
  escaped_dir=$(echo "$dirpart" | sed 's/\\/\\\\/g; s/"/\\"/g')

  # Look up user-assigned category
  user_cat="${soundmeta[$relpath]:-}"

  printf '    {"name":"%s","path":"%s","dir":"%s","size":%s,"ext":"%s","md5":"%s","category":"%s"}' \
    "$escaped_name" "$escaped_path" "$escaped_dir" "$filesize" "$ext_lower" "$file_md5" "$user_cat"
done < <(find Boombox -maxdepth 3 -type f \( -iname "*.wav" -o -iname "*.mp3" -o -iname "*.m4a" -o -iname "*.flac" -o -iname "*.ogg" \) 2>/dev/null | LC_ALL=C sort -f)

echo ""
echo "  ]"
echo "}"
