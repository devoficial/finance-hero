# ADR 0001: Local-first with Mac as authority

- Status: Accepted
- Date: 2026-07-18

## Context

The owner wants a private PWA usable on Mac and iPhone without paid hosting. The Mac is not kept
running continuously, permanent storage must remain on it, and exact 24x7 automation is unnecessary.

## Decision

Run a modular monolith and encrypted SQLite database on the Mac. Treat it as canonical. Install an
offline-capable iPhone PWA with a bounded cache and mutation outbox. Synchronize over paired local
HTTPS when the Mac is reachable. Persist scheduled work and catch up on next launch.

## Consequences

- No application-cloud operating cost and a small privacy boundary.
- The phone remains useful for cached viewing and capture while disconnected.
- Exact-time push and synchronization cannot be guaranteed while the Mac is off.
- The owner is responsible for Mac availability and backup durability.
- Local CA installation, mDNS discovery, pairing, and conflict handling become core product work.

## Rejected alternatives

- Public hosted backend: conflicts with fully local storage and ongoing service dependency.
- Phone as authority: weakens permanent backup/attachment/parser operation and cross-device control.
- Peer-to-peer multi-master: disproportionate accounting conflict and recovery complexity.
