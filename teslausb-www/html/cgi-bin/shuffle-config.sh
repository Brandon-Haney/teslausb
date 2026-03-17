#!/bin/bash

# GET: returns shuffle state
# POST: toggles shuffle on/off based on request body

SHUFFLE_FLAG="/mutable/shuffle_lockchime"

cat << 'HTTPEOF'
HTTP/1.0 200 OK
Content-type: application/json

HTTPEOF

if [ "$REQUEST_METHOD" = "POST" ]; then
  body=$(cat)
  action=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enabled',''))" 2>/dev/null)

  if [ "$action" = "True" ] || [ "$action" = "true" ]; then
    sudo touch "$SHUFFLE_FLAG" 2>/dev/null
    echo '{"enabled":true}'
  else
    sudo rm -f "$SHUFFLE_FLAG" 2>/dev/null
    echo '{"enabled":false}'
  fi
else
  if [ -f "$SHUFFLE_FLAG" ]; then
    echo '{"enabled":true}'
  else
    echo '{"enabled":false}'
  fi
fi
