# SetClick

The whole app is `metronome.html` (no build step). `sw.js` makes it work offline and shows the "Update available" bar. `npm test` runs the Playwright suite in headless Chromium.

## Merging pull requests

- **Never merge a PR on a Saturday or Sunday.** Weekend PRs need extra validation, and the owner merges them by hand. Get the PR green and mergeable, then say it is ready for them to merge. Go by the owner's local time; if it is unknown, treat it as a weekend whenever it is Saturday or Sunday in any US time zone.
- On weekdays, merge only when the owner asks, and only once CI is green.
