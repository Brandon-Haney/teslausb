#!/bin/bash

declare -a urlargs
IFS='&' read -r -a urlargs <<<"$QUERY_STRING"

declare -i len=${#urlargs[@]}
for ((i=0; i<${len}; i++ ))
do
  val="${urlargs[i]//+/ }"
  urlargs[i]="$(echo -e "${val//%/\\x}")"
done

cd "$DOCUMENT_ROOT/${urlargs[0]}"

cat << EOF
HTTP/1.0 200 OK
Content-type: text/plain

EOF

src="${urlargs[1]}"
dst="${urlargs[2]}"

# Ensure destination doesn't already exist
if [ -e "$dst" ]; then
  echo "EXISTS"
elif mv "$src" "$dst" &> /dev/null; then
  echo "OK"
else
  echo "FAILED"
fi
