# Development setup

## Prerequisites

- macOS on Apple Silicon or Intel
- Node.js 22 or newer
- pnpm 10.28.2 through Corepack or a local installation
- Xcode Command Line Tools if the encrypted SQLite prebuild is unavailable

## Install

```bash
pnpm install
cp .env.example .env
```

Generate a development-only database key with at least 32 random characters and set
`FINANCE_HERO_DATABASE_KEY` in the shell or `.env`. The current server reads environment
variables from the launching shell; automatic `.env` loading will be added with the Mac launcher.

Never commit `.env`, databases, certificates, statements, exports, or personal fixtures.

## Run

```bash
FINANCE_HERO_DATABASE_KEY="your-development-key-of-at-least-32-characters" pnpm dev
```

- PWA: `http://127.0.0.1:4318`
- Local API: `http://127.0.0.1:4317`
- Health contract: `http://127.0.0.1:4317/api/v1/health`
- Dashboard: `http://127.0.0.1:4317/api/v1/dashboard?month=2026-07`
- Ledger: `http://127.0.0.1:4317/api/v1/ledger?month=2026-07`
- Expense year: `http://127.0.0.1:4317/api/v1/expenses/year?year=2026`
- Liabilities: `http://127.0.0.1:4317/api/v1/liabilities`
- Liability update: `PATCH /api/v1/liabilities/:id`
- Reference data: `http://127.0.0.1:4317/api/v1/reference-data`

Development binds only to loopback. LAN HTTPS, Bonjour discovery, and iPhone certificate
installation remain a Phase 0 spike and must not be simulated by exposing the HTTP server.

## Verify

```bash
pnpm check
```

The check runs Biome, strict TypeScript, Vitest, and production builds. The database test
creates an encrypted temporary database, verifies persistence with the correct key, and
verifies that a wrong key cannot read it.

## Workspace map

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React PWA, service worker, responsive shell, and IndexedDB cache |
| `apps/server` | Local Fastify API and process composition |
| `packages/contracts` | Runtime-validated API contracts |
| `packages/domain` | Framework-free accounting rules |
| `packages/database` | Encrypted SQLite and key-provider boundary |
| `packages/sync` | Idempotent sync primitives |
| `packages/ui` | Shared presentation utilities and future design system |

## Database keys

Production will use `MacOSKeychainDatabaseKeyProvider`. To create a manual development entry:

```bash
security add-generic-password \
  -U \
  -s finance-hero.database \
  -a primary \
  -w "$(openssl rand -base64 48)"
```

Do not paste or print the resulting key. The Mac launcher will create this entry during guided
setup and will not use a checked-in environment variable.

## Current limitations

- Monthly `Current expenses Total` aggregates from September 2025 through July 2026 are reconciled
  in the encrypted ledger. Full transaction-by-transaction Google Sheet migration is still pending.
- Dashboard totals, category spending, institutional debts, personal payables, receivables, and the ledger are live
  database queries. Personal balances can be created with `POST /api/v1/personal-balances` and edited or settled
  with `PATCH /api/v1/personal-balances/:id`.
  Manual income and expense transactions are supported; transfers and split entries are next.
- Google login, device pairing, LAN HTTPS, Gmail, SMS, and statement parsing are not connected yet.
- IndexedDB contains only metadata and mutation-outbox tables; cache encryption is not complete.
- PWA SVG branding is sufficient for development; release-quality iOS PNG icons are pending.
