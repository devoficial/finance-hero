# Device pairing QA

Finance Hero pairs a phone directly with the local Mac service. Pairing does not create a
cloud account and does not send financial data to a remote service.

## Automated coverage

The device-pairing service tests verify:

- a pairing code is single-use and cannot be replayed;
- a code expires after ten minutes;
- five invalid or malformed attempts invalidate the active code;
- revocation immediately invalidates the device token and repeated revocation is harmless;
- malformed local device storage is treated as empty and can be recovered safely;
- only the SHA-256 token hash is persisted, while list responses omit the hash; and
- blank device names receive the safe `iPhone` fallback.

Run the focused checks with:

```bash
pnpm --filter @finance-hero/server test -- device-pairing-service.test.ts
```

## Manual iPhone verification

1. Start phone mode and keep the Mac and iPhone on the same trusted Wi-Fi network.
2. Confirm the local CA profile is installed and fully trusted on the iPhone.
3. Open the HTTPS phone URL shown by `pnpm setup:phone` and verify there is no certificate warning.
4. Generate a pairing code on the Mac, pair the iPhone once, and confirm it appears in the paired-device list.
5. Refresh a protected phone page to confirm the issued token authenticates normally.
6. Try the same pairing code again and confirm it is rejected as invalid or expired.
7. Generate another code, wait more than ten minutes, and confirm it is rejected.
8. Revoke the iPhone on the Mac, then refresh the phone and confirm access is denied.
9. Pair again only if continued phone access is required.

## Release evidence

- Pairing storage remains under the Mac data directory with mode `0600`.
- Raw bearer tokens are shown only once at pairing and are never written to disk.
- Tests require no browser automation or Playwright dependency.
- Device pairing is local-only and independent of OpenAI and Gmail.
