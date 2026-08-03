#!/bin/zsh
set -u

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

PHONE_CONFIG="$ROOT/data/local-tls/phone-access.json"

if [[ -f "$PHONE_CONFIG" ]]; then
  START_COMMAND=(pnpm start:phone)
  APP_URL="https://127.0.0.1:4318/"
else
  START_COMMAND=(pnpm start:local)
  APP_URL="http://127.0.0.1:4318/"
fi

if "${START_COMMAND[@]}"; then
  open "$APP_URL"
else
  echo
  read -k 1 "?Startup failed. Press any key to close."
fi
