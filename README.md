# Finance Hero

Finance Hero is a private, local-first personal finance PWA for one household. It
combines a unified accounting ledger with familiar tracker views for liabilities,
daily expenses, and home construction.

The Mac is the primary server and permanent data store. An installed iPhone PWA
can work from an encrypted local cache and synchronize when the Mac is reachable.
No hosted application or paid service is required.

## Project status

Phase 2 tracker implementation is underway. The repository contains an installable React
PWA, a local Fastify API, an encrypted SQLite ledger, shared contracts, an offline-cache
skeleton, and balanced-ledger domain tests. The dashboard and ledger now read the accepted
opening snapshot from encrypted storage, and manual transactions are persisted through the
same balanced journal. Dedicated dashboard, 12-month expenses, ledger, and liability views
project that data without duplicating storage. Full workbook migration and automated importing
remain later phases.

See [development setup](docs/development.md) to install, run, and verify the workspace.
For the shortest owner-focused instructions, use [Run Finance Hero locally](LOCAL_SETUP.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [Documentation index](docs/README.md) | Reading order and decision status |
| [Product requirements](docs/product-requirements.md) | Scope, rules, user journeys, and acceptance criteria |
| [System architecture](docs/system-architecture.md) | Components, stack, boundaries, and runtime topology |
| [Data architecture](docs/data-architecture.md) | Ledger model, entities, invariants, and retention |
| [API and sync](docs/api-and-sync.md) | Local API, offline behavior, conflicts, and pairing |
| [Import pipeline](docs/import-pipeline.md) | Gmail, SMS, files, review queue, and classification |
| [Frontend architecture](docs/frontend-architecture.md) | PWA information architecture and responsive behavior |
| [Forecasting and alerts](docs/forecasting-and-alerts.md) | Predictions, snowball planning, and notifications |
| [Security and operations](docs/security-and-operations.md) | Threat model, keys, backups, and local operation |
| [Migration plan](docs/migration-plan.md) | Google Sheet mapping and reconciliation |
| [Delivery plan](docs/delivery-plan.md) | Phases, tests, gates, and proposed repository layout |
| [Development setup](docs/development.md) | Install, run, verification, and current limitations |
| [Local startup guide](LOCAL_SETUP.md) | Start, stop, install, and troubleshoot the local PWA |
| [Architecture decisions](docs/adr/README.md) | Accepted architectural decision records |

## Non-negotiable principles

- Store monetary values as integer paise and display them in INR.
- Make the Mac database authoritative; the phone cache is never a backup.
- Record all approved financial activity in one balanced ledger.
- Never add an imported candidate to the ledger without explicit approval.
- Preserve source evidence and an audit trail for every imported or edited item.
- Prefer deterministic, explainable calculations over opaque predictions.
- Remain usable without the Mac and reconcile safely when it returns.

## Proposed technology baseline

- Monorepo: `pnpm` workspaces and Turborepo
- PWA: React, TypeScript, Vite, TanStack Router/Query/Table, Dexie
- Mac API: Node.js LTS, Fastify, Zod, Drizzle ORM
- Storage: SQLite with SQLCipher; keys held in macOS Keychain
- Background work: persistent database-backed job queue
- Parsing: Node orchestration with a local Python document worker
- Testing: Vitest, Playwright, testcontainers where useful

Exact versions will be pinned when Phase 0 scaffolding begins.

## License

[MIT](LICENSE)
