#!/bin/zsh
set -u

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

if ! pnpm setup:local; then
  echo
  read -k 1 "?Setup failed. Press any key to close."
fi
