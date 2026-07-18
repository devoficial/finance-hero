# Frontend architecture

## 1. Experience direction

Finance Hero should feel like a focused financial control room, not a generic admin
template. The dashboard is visual and decisive; detailed trackers retain the compact,
table-oriented density that makes the current workbook useful.

Design principles:

- lead with decisions and exceptions, not decorative totals;
- use consistent accounting language and sign conventions;
- make source, status, and forecast uncertainty visible;
- preserve fast keyboard/table workflows on Mac;
- use cards for month navigation, then tables for detail;
- keep visualizations few, legible, and directly actionable.

## 2. Information architecture

```text
Home
Ledger
Expenses
  Year / month cards
  Month detail
Imports
  Sync review
  Uploads and source health
Liabilities
  Loans and EMI
  Credit cards
  Snowball planner
Savings & Investments
  Accounts and holdings
  Goals
Projects
  Home Construction
People
Forecasts
Settings
  Accounts, categories, rules, integrations, devices, backup, security
```

Mac uses a persistent left rail and command/search bar. iPhone uses a bottom bar for
Home, Ledger, Sync, Trackers, and More. Route names and domain terms are shared.

## 3. Home dashboard composition

1. **Status strip**: last sync, pending review count, backup age, and data freshness.
2. **Command area**: Sync, add transaction, upload statement, privacy toggle.
3. **Current month**: income, regular spend, budget percentage, projected close.
4. **Cash-flow chart**: actual history plus twelve-month forecast and confidence band.
5. **Debt row**: principal, EMI, next due, snowball target, estimated debt-free date.
6. **Wealth row**: savings, investments, net worth, goal funding.
7. **Project and people**: construction status and outstanding receivables/payables.
8. **Alerts and actions**: danger alert, stale balances, overdue review, month close.

Amounts are visible after authentication. Privacy mode replaces amounts with aligned
placeholders while preserving layout and stays active until explicitly disabled.

## 4. Daily-expense view

### Year level

- Year selector defaults to 2026.
- Twelve month slots are shown; months without data use an empty state.
- Previous years remain collapsed until selected.
- July 2026 starts as active after migration; Sep 2025-Jun 2026 start closed.

### Month card

Each card contains:

- month/year and state (`Open`, `Closed`, `Needs Review`);
- regular expense, total outflow, budget, remaining, and projected regular spend;
- budget progress with danger threshold marker;
- one broad-bucket donut with numeric total and accessible tabular alternative;
- comparison with prior month and same month where data exists;
- pending candidate count and data-quality badge.

Broad buckets are fixed for the first release:

1. Regular expenses
2. EMIs and debt costs
3. Construction and projects
4. Savings and investments
5. Lending and other

### Month detail

The month route opens summary, category budget table, and transaction ledger. Filters
and table state are encoded in the URL. Closing a month requires resolving or
explicitly deferring pending candidates and records a close snapshot.

## 5. Table behavior

All tracker detail remains table-based on Mac and iPhone.

- Mac: sticky header, sortable/resizable columns, density modes, keyboard navigation,
  bulk actions, column visibility, and virtualized long lists.
- iPhone: first column frozen, horizontal scrolling, compact rows, tap-to-open detail,
  and bulk-selection mode.
- Money aligns right and uses tabular numerals and Indian grouping.
- Destructive or accounting-significant actions require clear consequence text.
- Inline editing is limited to drafts/candidates; posted ledger corrections use a form.

Tables expose an accessible list/card alternative where frozen scrolling would block
screen-reader navigation.

## 6. Feature screens

### Liabilities

Table columns: lender/account, type, original amount, statement principal, projected
principal, EMI, rate, due date, status, freshness, and snowball order. Selecting a
row opens terms history, payment schedule, statement evidence, prepayment simulator,
and balance reconciliation.

### Savings and goals

Accounts and holdings show actual balance/value and last valuation. Goal cards show
target, allocated actual funds, gap, monthly requirement, projected date, and status.
Allocation UI prevents accidental double allocation.

### Construction/projects

The project summary combines project table and decision cards: budget, estimate,
committed, paid, pending, available, forecast, freshness. Tabs show expenses, vendors,
phases, commitments, milestones, and attachments. The migrated project prominently
shows `Needs Update` until reconciled.

### Sync review

Desktop uses a dense candidate table plus source/posting preview panel. Mobile uses
selectable rows and a full-screen review sheet. `Select all` applies only to the
visible filtered result and shows the exact candidate count before approval.

## 7. Client state boundaries

- TanStack Query owns server/cache state.
- Dexie repositories persist the offline snapshot and outbox.
- React component state owns transient UI only.
- URL search params own shareable filters, active tabs, and selected month/year.
- Forms own drafts through React Hook Form; domain schemas validate before enqueue.
- No global store duplicates server entities.

## 8. Offline states

Every screen declares one of:

- `fresh`: connected and caught up;
- `cached`: offline, with last-sync timestamp;
- `pending`: local changes waiting to sync;
- `conflict`: server rejected one or more local changes;
- `unavailable offline`: operation requires Mac, such as statement parsing or backup.

Offline-capable actions include viewing cached dashboards/history, quick-add draft,
editing local drafts, categorizing downloaded candidates, and queuing SMS payloads.
Approval may be prepared offline but final posting occurs on the Mac.

## 9. PWA behavior

- App shell and static assets use cache-first with versioned precache.
- API data uses IndexedDB, never the browser HTTP cache as source of truth.
- Service-worker update is announced and activated after outbox safety checks.
- Install manifest uses standalone display, INR-oriented shortcuts, and explicit icons.
- Push notifications deep-link to the relevant month, alert, or review filter.
- Background sync is opportunistic; foreground sync is the reliable path on iOS.

## 10. Visual system

The initial visual direction is warm paper and ink with ledger-green positive states,
vermilion risk states, and saffron planning accents. It avoids default purple SaaS
styling and dark-mode-first design. Typography should pair an expressive financial
display face with a highly legible condensed/table face; final font licensing must
allow local bundling.

CSS custom properties define semantic colors, spacing, density, radii, shadows, and
chart palette. Charts never rely on color alone. Motion is limited to page reveal,
sync progress, forecast transitions, and meaningful state changes, with reduced-motion
support.

## 11. Accessibility and localization

- WCAG 2.2 AA target.
- Full keyboard operation on Mac and visible focus states.
- Screen-reader labels for chart values, account masks, statuses, and signs.
- Minimum 44px touch targets for mobile actions.
- `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` at display edges.
- Domain stores paise; formatting and date localization happen only at presentation.
- Never encode positive/negative meaning using color alone.

## 12. Performance budgets

- Initial PWA JavaScript under 250 KB gzip excluding lazy chart/parser-independent routes.
- Largest Contentful Paint under 2.5 seconds on a recent iPhone over local Wi-Fi.
- Virtualize tables beyond 200 rows.
- Month card data returned as one precomputed read model, not N+1 requests.
- Charts lazy-load after critical totals and navigation become interactive.
