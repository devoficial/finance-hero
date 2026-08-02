# iPhone Message Import

Finance Hero cannot bulk-read Apple's Messages database. iOS does allow a personal Shortcut automation to forward future bank-alert messages to Finance Hero while the Mac is running. Every forwarded message enters the existing **Imports** approval queue; nothing posts automatically.

## 1. Enable trusted phone access

On the Mac:

```bash
brew install mkcert
pnpm setup:phone
pnpm stop:local
pnpm start:phone
```

`pnpm setup:phone` prints the local HTTPS URL and the path to `rootCA.pem`. Transfer that certificate to the iPhone, install the downloaded profile, then enable it under **Settings > General > About > Certificate Trust Settings**. Use this only on a trusted home network.

The database API continues to listen only on `127.0.0.1`; the phone reaches it through the HTTPS PWA proxy.

## 2. Pair the iPhone

Create a temporary pairing code on the Mac:

```bash
curl -k -X POST https://YOUR_MAC_IP:4318/api/v1/devices/pairing-code
```

Exchange the returned six-digit code within ten minutes:

```bash
curl -k -H 'Content-Type: application/json' \
  -d '{"code":"123456","name":"Debasis iPhone"}' \
  https://YOUR_MAC_IP:4318/api/v1/devices/pair
```

Keep the returned `token` in the Shortcut only. It is shown once; Finance Hero stores only its SHA-256 hash.

## 3. Create the Shortcut automation

1. Open **Shortcuts > Automation > New Automation > Message**.
2. Select the bank and card senders you want to capture and choose **Run Immediately**.
3. Add **Get Details of Messages** actions for content, sender and date.
4. Add **Get Contents of URL** with method `POST` and URL:

   `https://YOUR_MAC_IP:4318/api/v1/import-hooks/ios-message`

5. Add header `Authorization` with value `Bearer YOUR_PAIRING_TOKEN`.
6. Send a JSON request body like:

```json
{
  "stableId": "message-date-sender-contents",
  "sentAt": "2026-08-02T08:00:00+05:30",
  "sender": "AXISBK",
  "body": "Your account was debited by INR 470 at APPLE MED"
}
```

Use a combination of message date, sender and content for `stableId`. Duplicate messages are rejected by content hash. You may add `accountId` when one sender always maps to a specific Finance Hero account; otherwise choose the account during review.

## 4. Review

Open **Imports > Pending**, verify the date, amount, account and category, then approve or reject. The parser deliberately assigns moderate confidence because SMS formats vary.

## Security and operation

- The Mac and Finance Hero must be awake and running when the automation sends the message.
- Pairing codes expire after ten minutes and lock after five failed attempts.
- Stop LAN access with `pnpm stop:local`.
- Revoke a device with `DELETE /api/v1/devices/:id`, or remove `data/paired-devices.json` while Finance Hero is stopped.
