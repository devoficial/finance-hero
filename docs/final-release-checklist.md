# Final release checklist

This is the release gate for the local-only Finance Hero application. A release
is complete only when every required row below passes on the same commit.

## Scope

- Gmail discovery is parked. Existing Gmail code and credentials remain intact,
  but Gmail work is not part of this release gate.
- Release checks must not mutate the live encrypted database unless a verified
  backup has been created first.
- All financial calculations remain INR-only and use the encrypted local store
  as their source of truth.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Recovery | Backup verification passes; an offline restore can be staged and activated atomically with rollback. |
| Browser cache | Pending mutations and cached metadata are AES-GCM encrypted in IndexedDB; legacy plaintext cache is removed. |
| Imports | Supported statement fixtures parse deterministically; protected PDFs fail safely and can be retried after unlock. |
| Historical data | Migration/reconciliation audit reports imbalances and duplicates without silently changing live records. |
| Security | Sensitive routes use safe headers, local admin operations require pairing, rate limits are enforced, and logs/errors do not expose secrets. |
| Devices | Desktop and phone HTTPS startup, pairing, route persistence, responsive layouts, and PWA install flow are documented and tested. |
| Assistant | Finance answers are grounded in local data, distinguish facts from suggestions, and pass the evaluation set. |
| Diagnostics | Local doctor reports database, backup, TLS, ports, and required configuration without printing secrets. |
| Release | Lint, typecheck, unit tests, production build, and PWA validation all pass. |

## Final commands

Run from the repository root:

```bash
pnpm doctor:local
pnpm check
git status --short
```

For phone verification, use the documented secure LAN flow:

```bash
pnpm stop:local
pnpm start:phone
```

Verify the app from the paired iPhone, then stop the local processes when the
Mac is no longer being used. The app is not intended to run 24x7.

## Data-safety rule

Before a restore drill or migration that writes records:

1. Stop the local app.
2. Create and verify a timestamped encrypted backup.
3. Stage the restore without replacing the live database.
4. Activate only after verification succeeds.
5. Keep the pre-activation backup until the restored app passes health checks.

## Sign-off

Record the commit SHA, date, backup verification result, `pnpm check` result,
desktop result, and iPhone result in the release notes. Any failed item blocks
the release rather than becoming an undocumented exception.
