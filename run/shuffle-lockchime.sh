#!/bin/bash

# Randomly selects a lock chime from sounds tagged as "lock" category
# in .soundmeta.json and copies it to Boombox/LockChime.wav.
#
# Usage: shuffle-lockchime.sh [--flush]
#   --flush  Also notify USB host of the change (use when gadget is active)

BOOMBOX_MOUNT="/var/www/html/fs/Boombox"
SHUFFLE_FLAG="/mutable/shuffle_lockchime"

# Check if shuffle is enabled
if [ ! -f "$SHUFFLE_FLAG" ]; then
  exit 0
fi

# Access boombox via autofs mount
cd "$BOOMBOX_MOUNT" 2>/dev/null || exit 0

# Get list of lock chime candidates using the same logic as the UI:
# 1. Files explicitly tagged as "lock" in .soundmeta.json
# 2. WAV files under 1MB that aren't tagged as something else
candidates=$(python3 -c "
import json, os
meta = {}
try:
    with open('Boombox/.soundmeta.json') as f:
        meta = json.load(f)
except:
    pass

for f in os.listdir('Boombox'):
    if f.lower() == 'lockchime.wav' or f.startswith('.'):
        continue
    path = os.path.join('Boombox', f)
    if not os.path.isfile(path):
        continue
    cat = meta.get(f, '')
    if cat == 'lock':
        print(f)
    elif cat == '':
        # Auto-detect: WAV under 1MB defaults to lock (matches UI logic)
        if f.lower().endswith('.wav') and os.path.getsize(path) <= 1048576:
            print(f)
" 2>/dev/null)

if [ -z "$candidates" ]; then
  exit 0
fi

# Pick a random candidate
count=$(echo "$candidates" | wc -l)
pick=$((RANDOM % count + 1))
chosen=$(echo "$candidates" | sed -n "${pick}p")

if [ -z "$chosen" ] || [ ! -f "Boombox/$chosen" ]; then
  exit 0
fi

# Copy the chosen file as the active lock chime
cp "Boombox/$chosen" "Boombox/LockChime.wav"
sync

if [ -n "${LOG_FILE:-}" ]; then
  echo "$(date): Shuffled lock chime to: $chosen" >> "$LOG_FILE" 2>/dev/null || true
fi

# If --flush is passed, notify the USB host
if [ "${1:-}" = "--flush" ]; then
  disk_image="/backingfiles/boombox_disk.bin"
  loop_dev=$(losetup -j "$disk_image" 2>/dev/null | head -1 | cut -d: -f1)
  if [ -n "$loop_dev" ] && [ -b "$loop_dev" ]; then
    blockdev --flushbufs "$loop_dev" 2>/dev/null || true
  fi

  configfs_root=$(findmnt -o TARGET -n configfs 2>/dev/null) || true
  gadget_root="$configfs_root/usb_gadget/teslausb"

  if [ -d "$gadget_root/functions/mass_storage.0" ]; then
    for lun_dir in "$gadget_root"/functions/mass_storage.0/lun.*; do
      if [ -f "$lun_dir/file" ]; then
        current_file=$(cat "$lun_dir/file")
        if [ "$current_file" = "$disk_image" ]; then
          echo '' > "$lun_dir/file" 2>/dev/null || true
          sleep 1.5
          echo "$disk_image" > "$lun_dir/file" 2>/dev/null || true
          break
        fi
      fi
    done
  fi
fi
