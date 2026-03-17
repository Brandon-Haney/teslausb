#!/bin/bash

# Flush filesystem changes to a USB gadget LUN so the car/PC sees them immediately.
# Usage: flush-gadget.sh?<disk_image_path>
# e.g.   flush-gadget.sh?/backingfiles/boombox_disk.bin

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

disk_image="${urlargs[0]}"

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

# Validate the disk image path
if [ -z "$disk_image" ] || [ ! -e "$disk_image" ]; then
  echo '{"status":"error","message":"disk image not found"}'
  exit 0
fi

# Step 1: Flush filesystem writes through the loop device to the backing image.
# sync writes dirty pages; blockdev --flushbufs forces the loop device to drop
# its buffer cache so the gadget driver re-reads fresh blocks from the image.
sync

# Find and flush the loop device that has this disk image mounted
loop_dev=$(losetup -j "$disk_image" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$loop_dev" ] && [ -b "$loop_dev" ]; then
  sudo blockdev --flushbufs "$loop_dev" 2>/dev/null || true
fi

# Step 2: Find the gadget root
configfs_root=$(findmnt -o TARGET -n configfs 2>/dev/null) || true
gadget_root="$configfs_root/usb_gadget/teslausb"

if [ ! -d "$gadget_root/functions/mass_storage.0" ]; then
  echo '{"status":"ok","message":"flushed (no gadget active)"}'
  exit 0
fi

# Step 3: Find which LUN has this disk image and force a full reconnect.
# Writing "" to the file completely detaches the backing store (stronger than
# forced_eject which only sends a SCSI media-change hint that Windows ignores).
for lun_dir in "$gadget_root"/functions/mass_storage.0/lun.*; do
  if [ -f "$lun_dir/file" ]; then
    current_file=$(cat "$lun_dir/file")
    if [ "$current_file" = "$disk_image" ]; then
      # Detach the backing store entirely
      sudo sh -c "echo '' > '$lun_dir/file'" 2>/dev/null || true
      # Give the host time to process the LUN disappearing
      sleep 1.5
      # Re-attach the backing store — host re-enumerates and reads fresh FAT
      sudo sh -c "echo '$disk_image' > '$lun_dir/file'" 2>/dev/null || true
      echo '{"status":"ok","message":"flushed and reloaded"}'
      exit 0
    fi
  fi
done

echo '{"status":"ok","message":"flushed (lun not found)"}'
