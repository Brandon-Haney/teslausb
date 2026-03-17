#!/bin/bash

cat << 'EOF'
HTTP/1.0 200 OK
Content-type: application/json

EOF

if which ffmpeg > /dev/null 2>&1
then
  echo '{"available":true}'
else
  echo '{"available":false}'
fi
