# Run Finance Hero locally

Finance Hero runs entirely on the Mac. The Mac hosts the PWA and local API, and the
encrypted SQLite database stays in `data/`.

## Requirements

- macOS
- Node.js 22 or newer
- pnpm 10.28.2

Check the installed versions:

```bash
node --version
pnpm --version
```

## First-time setup

From the repository root:

```bash
pnpm install
pnpm setup:local
```

`setup:local` stores the database key in the current macOS user's Keychain under
`finance-hero.database` / `primary`. The key is never written to the repository,
logs, browser storage, or the runtime status file.

For a new installation, setup generates a random key. If `data/finance-hero.db`
already exists, setup never generates or stores a replacement: it asks for the
existing key using hidden Terminal input and verifies that the key opens the
database before saving it.

An existing `.env` or `FINANCE_HERO_DATABASE_KEY` can be migrated by running
`pnpm setup:local`; setup validates and imports that key into Keychain.

## Start

```bash
pnpm start:local
```

The secure launcher prevents duplicate local servers, starts Finance Hero in the
background, waits for both services to become healthy, and then returns control to
Terminal.

- Finance Hero: `http://127.0.0.1:4318/`
- Health check: `http://127.0.0.1:4317/api/v1/health`

The health response must report `"status":"ok"` and `"database":"encrypted"`.
The database key is read directly from Keychain by the API process.

Check status or inspect local logs:

```bash
pnpm status:local
pnpm logs:local
```

Finder users can double-click:

- `scripts/Set Up Finance Hero.command`
- `scripts/Start Finance Hero.command`
- `scripts/Stop Finance Hero.command`

## Install the PWA on this Mac

1. Open `http://127.0.0.1:4318/` in Chrome or Edge.
2. Select **Install app** in Finance Hero.
3. Accept the browser installation prompt.

Safari users can use **File > Add to Dock** on supported macOS versions. If a
browser does not expose its native prompt, the in-app **Install app** button shows
the available installation instructions.

The development server enables the service worker on loopback, so the local address
is installable. iPhone installation requires the later LAN HTTPS and device-pairing
work; `127.0.0.1` on an iPhone refers to the iPhone itself, not this Mac.

## Stop and restart

Stop and restart with:

```bash
pnpm stop:local
pnpm start:local
```

Finance Hero does not need to run continuously. When the Mac is off, the local API
is unavailable; it can catch up after the next start.

## Verify the workspace

```bash
pnpm check
```

This runs formatting checks, TypeScript, tests, and the production PWA build.

## Troubleshooting

If port `4317` or `4318` is already in use by an older manually started process,
stop that process with `Control+C`. The secure launcher refuses to kill processes
it did not start.

If the health endpoint reports `not-configured`, run `pnpm setup:local`, then
`pnpm stop:local` and `pnpm start:local`.

If setup rejects the key, use the original key that created `data/finance-hero.db`.
Never delete `data/` to fix a key problem because it contains the encrypted
financial records.

If the install button does not appear, reload once after both servers are ready and
confirm that `http://127.0.0.1:4318/manifest.webmanifest` loads.
