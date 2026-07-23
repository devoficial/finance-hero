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
cp .env.example .env
```

Generate a database key:

```bash
openssl rand -base64 48
```

Open `.env` and replace `replace-with-at-least-32-random-characters` with the
generated value. The `.env` file and `data/` directory are ignored by Git.

Keep this key. The same key is required to open the existing encrypted database.
Changing it does not reset the database; it makes the existing database unreadable.

## Start

```bash
pnpm start:local
```

Wait until the terminal reports both addresses:

- Finance Hero: `http://127.0.0.1:4318/`
- Health check: `http://127.0.0.1:4317/api/v1/health`

The health response must report `"status":"ok"` and `"database":"encrypted"`.

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

Press `Control+C` in the terminal that is running Finance Hero.

Restart with:

```bash
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

If port `4317` or `4318` is already in use, stop the earlier Finance Hero terminal
before starting another process.

If the health endpoint reports `not-configured`, confirm `.env` exists and contains
`FINANCE_HERO_DATABASE_KEY`.

If the database rejects the key, restore the original key used to create `data/`.
Do not delete `data/`, because it contains the encrypted financial records.

If the install button does not appear, reload once after both servers are ready and
confirm that `http://127.0.0.1:4318/manifest.webmanifest` loads.
