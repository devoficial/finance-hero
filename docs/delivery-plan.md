# Delivery plan and engineering strategy

## 1. Delivery approach

Build in vertical slices that prove accounting correctness, local deployment, and phone sync
before adding broad automation. Every phase ends in a usable increment and an explicit gate.

## 2. Proposed repository layout

```text
finance-hero/
  apps/
    web/                  # React PWA
    server/               # Fastify API and job host
    parser-worker/        # Local Python extraction/OCR process
  packages/
    domain/               # Money, ledger, budgets, debts, goals, projects
    application/          # Commands, queries, ports
    contracts/            # Zod/OpenAPI and generated client types
    database/             # Drizzle schema, repositories, migrations
    sync/                 # Change feed, idempotency, conflict policy
    import-core/          # Candidate model, matching, classification
    ui/                   # Design tokens and shared components
    test-fixtures/        # Redacted deterministic samples
  docs/
    adr/
  tooling/
    local-ca/
    packaging/
    migration/
  pnpm-workspace.yaml
  turbo.json
```

Dependency direction is `apps/adapters -> application -> domain`. `domain` has no React,
Fastify, database, filesystem, or network imports.

## 3. Phase 0: risk spikes and scaffold

Deliver:

- pnpm/Turborepo strict TypeScript workspace and CI checks;
- minimal React PWA and Fastify health endpoint;
- SQLCipher binding/keychain spike, WAL backup/restore spike;
- local CA, Bonjour discovery, iPhone install/pairing spike;
- Dexie offline outbox and one idempotent sync command;
- parser process sandbox/protocol spike with one redacted PDF and CSV;
- architecture conformance tests and developer setup guide.

Gate: install the PWA on the actual iPhone, create data offline, sync exactly once to encrypted
SQLite, restart Mac, and restore a verified backup. Do not proceed if local HTTPS or SQLCipher is
unreliable.

## 4. Phase 1: ledger foundation and manual tracking

Deliver:

- account/category management and balanced journal domain;
- manual transaction, split, transfer, card purchase/payment, loan payment, reversal/replacement;
- ledger table, search, filters, attachments metadata, audit trail;
- dashboard foundations and account balances;
- offline quick-add and conflict handling;
- INR/date formatting and accessibility baseline.

Gate: golden accounting fixtures and property tests pass; posted entries cannot become unbalanced
through API, sync, or UI.

## 5. Phase 2: workbook migration and three tracker views

Deliver:

- immutable workbook export/staging tools and dry-run report;
- liabilities/EMI tracker;
- daily-expense year/month cards, donut, category budget, and month ledger;
- reusable projects engine and Home Construction view;
- historical scenario/reference import;
- migration sign-off and verified snapshot.

Gate: the reconciliation report matches accepted baselines and the owner signs off the migrated
views. No historical aggregate is presented as transaction-level evidence.

## 6. Phase 3: import review and statements

Status: underway. The local quarantine, content-hash deduplication, CSV/TSV parser,
editable review queue, multi-select approval/rejection, and audited ledger posting are implemented.
PDF/Excel parser plug-ins, merge/split, reconciliation, and redacted institution fixtures remain.

Deliver:

- upload/quarantine pipeline for PDF, protected/scanned PDF, CSV, XLS/XLSX;
- generic parser plus institution plug-in contract;
- candidate review, edit, multi-select, merge, split, approve/reject;
- deterministic classification rules, merchant aliases, duplicate/transfer matching;
- statement reconciliation and detailed-history aggregate replacement.

Gate: redacted fixtures produce balanced candidates, hostile files are contained, and duplicate
cross-source approval creates one transaction.

## 7. Phase 4: Gmail and iPhone message ingestion

Deliver:

- Google OAuth owner restriction and Gmail readonly connector;
- 12-month initial scan, two-day 08:00 schedule, startup catch-up, manual Sync;
- Gmail history/fallback cursor and attachment discovery;
- iOS Shortcut package/instructions, signed local hook, offline queue;
- source health and retry UX.

Gate: revocation, cursor expiry, Mac-off catch-up, and Gmail/SMS duplicate scenarios pass without
lost or duplicated transactions.

## 8. Phase 5: planning modules

Deliver:

- debt schedules, prepayment simulation, snowball default, avalanche comparison;
- savings/investment assets and manual valuations;
- goal allocations and forecasts;
- people receivable/payable ledger and prepared reminder text;
- Pluxee restricted wallet and recurring monthly benefit;
- twelve-month cash flow, project, debt, goal, and net-worth forecasts.

Gate: scenario calculations match independent spreadsheet fixtures to paise/month tolerances and
all forecast assumptions are visible.

## 9. Phase 6: alerts, hardening, and packaging

Deliver:

- 60%-before-day-20 danger alert and monthly close summary;
- in-app inbox and best-effort iPhone push;
- backup rotation/restore UI, retention jobs, diagnostics bundle;
- CSP/security headers, rate limits, dependency and parser hardening;
- Mac launcher/packaging, guided local CA and recovery-key setup;
- performance, accessibility, upgrade, and disaster-recovery tests.

Gate: release checklist, restore drill, device-loss drill, and security review pass on production-like
Mac/iPhone devices.

## 10. Testing strategy

### Domain tests

- Example and property-based tests for journal balancing and account sign conventions.
- Credit-card payment, transfer, investment, loan split, receivable/payable, refund, reversal.
- Budget inclusion/exclusion and threshold boundaries.
- Snowball schedules, rounding, final partial payment, zero/changed rates.
- Goal allocation cap and project forecast formulas.

### Persistence and migration tests

- Repository contract tests against encrypted SQLite.
- Forward migration and restore-from-prior-version fixtures.
- Workbook mappers with exact row/cell provenance and reconciliation snapshots.
- Database crash/WAL recovery and backup verification.

### Import tests

- Redacted fixtures per institution and format.
- Indian amount/date variants, year rollover, debit/credit signs, multiline descriptions.
- Duplicate, transfer, refund, and reversal matching precision.
- Password memory/logging tests and malicious/oversized document limits.

### API and sync tests

- OpenAPI schema compatibility and generated-client tests.
- Idempotent retries, out-of-order network responses, cursor paging, stale versions.
- Offline queue, interrupted push/pull, snapshot resync, revocation.
- Authorization and CSRF/Origin controls for all mutations.

### UI and device tests

- Playwright desktop/mobile journeys and visual regression for critical tables/cards.
- Keyboard, screen-reader landmarks, reduced motion, contrast, chart alternatives.
- Real Safari/iPhone installation, offline launch, Face ID, horizontal tables, background limits.

### Operational tests

- Gmail token revocation/history expiry and catch-up schedules.
- Parser crash, database lock/corruption, low disk, certificate rotation.
- Backup restore to a clean app directory and audit/attachment verification.

## 11. Quality gates in CI

- formatting and lint;
- TypeScript strict compilation;
- unit/property tests and coverage on critical domain modules;
- API contract and database migration tests;
- parser tests in a locked dependency environment;
- Playwright smoke flows;
- dependency/license/secret scan;
- documentation link and Mermaid syntax check.

CI may use synthetic data only. Personal workbook exports, Gmail payloads, statements, database,
certificates, and keys must be excluded by `.gitignore` and secret scanning.

## 12. Definition of done

A feature is done only when:

- accounting behavior and edge cases are specified;
- domain/API/UI tests pass;
- offline and stale-data behavior are explicit;
- audit and source evidence are present where applicable;
- accessibility and responsive states are verified;
- failure/retry behavior and operational health are visible;
- documentation and migration implications are updated;
- no personal data appears in fixtures, logs, commits, or screenshots.

## 13. Initial engineering backlog

1. Scaffold workspace, lint/test/build pipelines, and package boundaries.
2. Prove SQLCipher + Keychain + verified online backup.
3. Prove local HTTPS/mDNS/PWA install/pairing on the actual iPhone.
4. Implement `Money`, account classification, journal/posting invariants, and golden fixtures.
5. Implement one manual transaction vertical slice through offline sync.
6. Build migration profiler and immutable workbook-export workflow.
7. Implement ledger, daily-expense month model, liabilities, and project projections.
8. Add file quarantine/parser protocol and review queue.

This order deliberately addresses the highest architectural risks before broad feature work.
