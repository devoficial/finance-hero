# Development setup

## Prerequisites

- macOS on Apple Silicon or Intel
- Node.js 22 or newer
- pnpm 10.28.2 through Corepack or a local installation
- Xcode Command Line Tools if the encrypted SQLite prebuild is unavailable

## Install

```bash
pnpm install
pnpm setup:local
```

The local setup command generates or validates the database key and stores it in
macOS Keychain. Existing `.env` and `FINANCE_HERO_DATABASE_KEY` values are accepted
only as migration inputs and are verified against an existing database before being
stored.

Never commit `.env`, databases, certificates, statements, exports, or personal fixtures.

## Run

```bash
pnpm start:local
```

- PWA: `http://127.0.0.1:4318`
- Local API: `http://127.0.0.1:4317`
- Health contract: `http://127.0.0.1:4317/api/v1/health`
- Dashboard: `http://127.0.0.1:4317/api/v1/dashboard?month=2026-07`
- Ledger: `http://127.0.0.1:4317/api/v1/ledger?month=2026-07`
- Expense year: `http://127.0.0.1:4317/api/v1/expenses/year?year=2026`
- Liabilities: `http://127.0.0.1:4317/api/v1/liabilities`
- Liability update: `PATCH /api/v1/liabilities/:id`
- Financial accounts: `http://127.0.0.1:4317/api/v1/accounts`
- Create/update financial account: `POST /api/v1/accounts`, `PATCH /api/v1/accounts/:id`
- Reference data: `http://127.0.0.1:4317/api/v1/reference-data`
- Manual transaction: `POST /api/v1/transactions/manual`
- Audited reversal: `POST /api/v1/transactions/:id/reverse`
- Audited correction: `POST /api/v1/transactions/:id/replace`
- Import queue: `GET /api/v1/imports`
- Statement upload: `POST /api/v1/statement-uploads?filename=&accountId=`
- Candidate edit: `PATCH /api/v1/candidates/:id`
- Candidate approval/rejection: `POST /api/v1/candidate-actions/approve`, `POST /api/v1/candidate-actions/reject`

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

`MacOSKeychainDatabaseKeyProvider` is active in local runtime configuration.
`pnpm setup:local` owns Keychain creation and migration. Do not add, print, or
replace the Keychain item manually; setup verifies the key against existing data
before updating it.

## Current limitations

- Monthly `Overall Total Expenses` cash outflows from September 2025 through July 2026 are
  reconciled in the encrypted ledger, including debt payments, construction, savings, repayment,
  and emergency-fund rows. Full transaction-by-transaction Google Sheet migration is still pending.
- Dashboard totals, category spending, institutional debts, personal payables, receivables, financial accounts,
  and the ledger are live database queries. Personal balances can be created with
  `POST /api/v1/personal-balances` and edited or settled with `PATCH /api/v1/personal-balances/:id`.
- Manual expenses, income, splits, transfers, card purchases, and debt payments are supported with audited
  reversals and replacements.
- Savings, investments, food-only wallets, financial goals, allocations, and deterministic completion forecasts
  are live. Emergency-cover goals recalculate from active EMIs plus the latest applicable regular expense budget.
  Asset valuations remain manual until statement and market-value imports are implemented.
- Debt snowball/avalanche scenarios and the twelve-month forecast are deterministic browser calculations over
  current API data. Forecast assumptions remain editable and construction commitments are disclosed but excluded
  until their payment dates are known.
- Google login, device pairing, LAN HTTPS, Gmail, SMS, and binary statement parsing are not connected yet.
- Local CSV/TSV statement extraction and review are connected. Uploaded PDF/XLS/XLSX files are preserved in
  `data/imports/quarantine` and explicitly marked `needs_parser`; they are never presented as parsed data.
- Institution-specific PDF/Excel extraction, statement balance reconciliation, merge/split review actions,
  Gmail discovery, and iPhone Shortcut ingestion remain pending.
- IndexedDB contains only metadata and mutation-outbox tables; cache encryption is not complete.
- PWA SVG branding is sufficient for development; release-quality iOS PNG icons are pending.
