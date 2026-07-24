#!/bin/zsh
set -u

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

if pnpm start:local; then
  open "http://127.0.0.1:4318/"
else
  echo
  read -k 1 "?Startup failed. Press any key to close."
fi
