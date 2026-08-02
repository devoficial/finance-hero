# Local Finance Notifications

Finance Hero uses PWA/browser notifications and live local dashboard calculations.

- **Danger alert:** once per month when regular expenses reach at least 60% before day 20.
- **Month-start summary:** once per month on days 1-3, showing available cash and scheduled EMI commitment.

Click **Enable alerts** in the top bar and allow notifications. Checks run when Finance Hero loads, returns to the foreground, or regains focus. Because the app is fully local and the Mac is intentionally not always running, it cannot deliver alerts while both the Mac and PWA are closed. The next app open performs the check and avoids duplicate alerts using local browser storage.
