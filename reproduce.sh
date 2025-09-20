#!/usr/bin/env bash
set -euo pipefail

if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v yarn >/dev/null 2>&1; then
  PM=yarn
else
  PM=npm
fi

if [ "$PM" != "pnpm" ]; then
  echo "本项目使用 pnpm，请安装 pnpm 后重试" >&2
  exit 1
fi

pnpm install

pnpm test

pnpm replay
