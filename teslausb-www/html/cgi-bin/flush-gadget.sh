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

# Unmount any autofs mount of this image to flush writes
# autofs mounts under /var/www/html/fs/
sync
for mountpoint in /var/www/html/fs/Boombox /var/www/html/fs/LightShow /var/www/html/fs/Music; do
  if mountpoint -q "$mountpoint" 2>/dev/null; then
    # Check if this mountpoint uses our disk image
    mount_src=$(findmnt -n -o SOURCE "$mountpoint" 2>/dev/null)
    if [ "$mount_src" = "$disk_image" ]; then
      sudo umount "$mountpoint" 2>/dev/null || true
    fi
  fi
done
sync

# Find the gadget root
configfs_root=$(findmnt -o TARGET -n configfs 2>/dev/null) || true
gadget_root="$configfs_root/usb_gadget/teslausb"

if [ ! -d "$gadget_root/functions/mass_storage.0" ]; then
  echo '{"status":"ok","message":"flushed (no gadget active)"}'
  exit 0
fi

# Find which LUN has this disk image and trigger a media change
for lun_dir in "$gadget_root"/functions/mass_storage.0/lun.*; do
  if [ -f "$lun_dir/file" ]; then
    current_file=$(cat "$lun_dir/file")
    if [ "$current_file" = "$disk_image" ]; then
      # Ensure LUN is marked as removable so the host honors media changes
      sudo sh -c "echo 1 > '$lun_dir/removable'" 2>/dev/null || true
      # Force eject, pause for host to process, then re-insert
      sudo sh -c "echo 1 > '$lun_dir/forced_eject'" 2>/dev/null || true
      sleep 0.5
      sudo sh -c "echo '$disk_image' > '$lun_dir/file'" 2>/dev/null || true
      echo '{"status":"ok","message":"flushed and reloaded"}'
      exit 0
    fi
  fi
done

echo '{"status":"ok","message":"flushed (lun not found)"}'
