# Architecture documentation

These documents are the implementation contract for Finance Hero. A change that
alters a core invariant, privacy boundary, or data ownership rule must update the
relevant document and add or supersede an ADR.

## Recommended reading order

1. `product-requirements.md`
2. `system-architecture.md`
3. `data-architecture.md`
4. `api-and-sync.md`
5. `import-pipeline.md`
6. `frontend-architecture.md`
7. `forecasting-and-alerts.md`
8. `security-and-operations.md`
9. `migration-plan.md`
10. `delivery-plan.md`
11. `development.md`
12. `final-release-checklist.md`

## Decision vocabulary

- **Accepted**: agreed and binding for the initial release.
- **Proposed**: recommended implementation detail that can change during a spike.
- **Deferred**: deliberately outside the initial release.

## Accepted product decisions

- Single user, INR only, with Google identity and paired local devices.
- Mac-hosted, local-first deployment; no public hosting and no 24x7 requirement.
- Unified balanced ledger with separate tracker views.
- Direct Gmail read-only ingestion, forwarded iPhone SMS ingestion, and manual file uploads.
- Review and approval before any candidate reaches the ledger.
- Twelve-month transaction scan and twelve-month forward forecast.
- Debt snowball as the default repayment strategy.
- Daily-expense month cards, one broad-bucket donut chart, and table-based detail views.
- Current baseline salary is Rs 3,00,893 and current total EMI is Rs 1,27,451.

## Documentation ownership

Until multiple contributors exist, the repository owner approves architecture
changes. Security-impacting changes require a threat-model review, migration-impacting
changes require a rollback plan, and accounting changes require invariant tests.
