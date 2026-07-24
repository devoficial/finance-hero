#!/bin/zsh
set -u

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

if ! pnpm stop:local; then
  echo
  read -k 1 "?Shutdown failed. Press any key to close."
fi
