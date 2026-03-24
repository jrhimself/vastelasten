# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.2.7] - 2026-03-24

### Changed
- CI workflow split into three separate jobs: `lint`, `test`, and `deploy` — lint and test now run in parallel, deploy waits for both to pass

---

## [1.2.6] - 2026-03-24

### Fixed
- Version number in sidebar and cache-busting strings were not updated to v1.2.5 — corrected to v1.2.6

---

## [1.2.5] - 2026-03-24

### Added
- `CHANGELOG.md` — version history is now tracked and updated with every PR
- ESLint v9 with flat config (`eslint.config.js`) — lints `app.js`, `functions/`, `lib/` and `test/`
- Lint step added to CI pipeline (runs before tests; deploy is blocked on lint errors)

### Fixed
- Removed unused imports `splitCSVRow` and `detectDelimiter` from `functions/api/[[route]].js`
- Removed unnecessary escape characters (`\/`) in regex patterns in `lib/csv.js`
- Implemented missing `geselecteerdeItems()` function in `app.js` (was called but never defined)

---

## [1.2.4] - 2026-03-24

### Fixed
- Inactive status from a previous period no longer leaks into later periods — overzicht endpoint now filters `vaste_last_periode_actief` on current period only (`WHERE periode_id=?` instead of `WHERE p.start_datum <= ?`)
- Race condition on page load causing intermittent wrong period data — `filterPeriodesByJaar()` no longer triggers an extra `laadDashboard()` call during `startApp()` initialisation

---

## [1.2.3] - 2026-03-24

### Fixed
- Hermatchen now respects skipped (`periode_overgeslagen`) and deactivated (`vaste_last_periode_actief`) expenses per period — previously these could be re-matched after running hermatchen

---

## [1.2.2] - 2026-03-24

### Fixed
- Version number in sidebar and cache-busting strings (`app.js?v=`, `style.css?v=`) was stuck on v1.1.0 — corrected to v1.2.2

---

## [1.2.1] - 2026-03-24

### Changed
- README updated to reflect all changes from v1.1.0 and v1.2.0: deviation highlighting, debit-only matching, Vitest, `lib/` and `test/` structure, CI test → deploy order, versioning workflow and branch protection

---

## [1.2.0] - 2026-03-24

### Added
- Unit tests for `autoMatch` and CSV parsing with Vitest (37 tests); pure functions extracted to `lib/automatch.js` and `lib/csv.js`
- CI test job in GitHub Actions — deploy only runs if all tests pass
- Branch protection on `main` — requires PR and passing `test` check before merging
- PR template (`.github/pull_request_template.md`) with fixed structure for changes and test plan

---

## [1.1.0] - 2026-03-24

### Added
- Version number visible in sidebar at all times (sticky sidebar, `v1.1.0` shown at bottom)
- Cache-busting query strings on `app.js` and `style.css` (`?v=X.Y.Z`) to prevent stale browser cache after deploys
- Semver branch naming convention (`feature/vX.Y.Z`)

### Changed
- Bedrag input fields always show 2 decimal places (e.g. `9.50`); placeholder is `0.00`

### Fixed
- Auto-match now only matches afschrijvingen (debits) — bijschrijvingen (credits) are never matched to vaste lasten

---

## [1.0.1] - 2026-03-24

### Fixed
- Modals no longer close when swiping outside the window — can only be closed via Opslaan or Annuleren button

---

## [1.0.0] - 2026-03-24

### Added
- Dashboard with vaste lasten per period (status: betaald, open, overgeslagen)
- Yellow row highlight when actual transaction amount differs from expected amount
- CSV import for ING, ABN AMRO and Rabobank with automatic bank detection
- Auto-match transactions to vaste lasten based on IBAN, description pattern or amount
- Budget periods based on salary date, auto-generatable per year
- Categories with pie chart and bar chart statistics
- Password-based authentication with 90-day session cookie (HMAC-signed, HttpOnly)
