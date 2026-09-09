#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile

if [[ ! -f apps/backend/.env ]]; then
  cp apps/backend/.env.example apps/backend/.env
fi

docker compose -f infrastructure/docker/compose.yaml up -d postgres coturn
pnpm --filter @beacon/backend db:migrate

cat <<'NOTICE'
Beacon SecureView Codespace is ready.
Start the application with: pnpm dev
The forwarded web viewer is on port 5173; the backend is on port 3000.
NOTICE
