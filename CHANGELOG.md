# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.5.8] - 2026-08-10

### Fixed
- The session cookie no longer sets the `Secure` attribute on plain-HTTP requests. Browsers reject `Secure` cookies on non-HTTPS origins, so on the self-hosted deployment (reached over `http://<lan-ip>:3000`) the login succeeded but the cookie was dropped and every subsequent API call returned `401 Niet ingelogd`, leaving the UI empty. HTTPS deployments are unaffected: `Secure` is still set when the request arrives over HTTPS, determined from `X-Forwarded-Proto` when present and the request URL otherwise

### Removed
- Automatic deployment to Cloudflare Pages. The maintainer's Pages project and D1 database have been decommissioned in favour of the self-hosted Express server, so the workflow (renamed `deploy.yml` → `ci.yml`) now only runs lint and tests. Cloudflare hosting remains supported as an installation option — see the Cloudflare hosting section in the README to set it up against your own account
- The maintainer-specific `database_id` in `wrangler.toml`, replaced by a `<your-d1-database-id>` placeholder as the README already instructs

---

## [1.5.7] - 2026-06-22

### Fixed
- A recurring cost with an `omschrijving_patroon` (description pattern) is no longer matched via the amount fallback. Previously, if the pattern did not match a transaction's description, the cost could still be matched to an unrelated transaction that happened to share the same amount and a nearby expected day (e.g. a "Tesla Premium" cost matching a "Zakgeld Joey" transfer). A cost with an explicit description pattern now matches only on that pattern, never blindly on amount — mirroring the existing IBAN exclusion

---

## [1.5.6] - 2026-06-22

### Fixed
- The "~" marker (amount accepted once) now disappears after the deviating amount is accepted as the new defined amount. Previously the marker stayed because it was driven solely by the stored flag, ignoring whether the payment still differed from the defined amount; the marker is now only shown while an actual deviation remains
- Frontend version label and asset cache-busting query strings now reflect 1.5.6 (previously left at 1.5.5, so the app kept showing the old version and could serve cached assets)

---

## [1.5.5] - 2026-05-08

### Fixed
- A recurring cost with an IBAN configured is no longer matched via amount fallback when the transaction has no counter-account — previously this could cause unrelated transactions with the same amount to be incorrectly matched (e.g. a €13.30 restaurant transaction matched to an insurance cost)

---

## [1.5.4] - 2026-05-08

### Changed
- Rematch (hermatch) now only touches unlinked transactions — already-matched transactions are never unlinked or re-evaluated
- After a successful rematch, only the affected row is updated in the DOM; no full dashboard reload required

---

## [1.5.3] - 2026-05-08

### Fixed
- Boundary transactions (from an adjacent period) are now only moved during rematch if the transaction date is within 15 days of the expected payment day — prevents IBAN/description matches from pulling transactions that are clearly in the wrong period (e.g. an April 7 transaction matched to a May 5 cost)

---

## [1.5.2] - 2026-05-08

### Fixed
- Reverted forward boundary in automatic rematch — only the manual transaction search (Zoek transactie) now looks 5 days into the next period; automatic rematch stays backward-only to prevent transactions being incorrectly pulled across period boundaries

---

## [1.5.1] - 2026-05-08

### Fixed
- Transactions moved to the next period by a previous rematch (e.g. a payment on the salary day) are now visible and rematchable from the current period — the boundary search window now also looks forward up to 5 days into the next period

### Changed
- CI workflow now supports manual deploys to Cloudflare via `workflow_dispatch` — useful for testing against the live D1 database from a feature branch

---

## [1.5.0] - 2026-05-08

### Added
- Activate button in the `•••` actions menu for period-inactive recurring costs — activates the cost for the selected period and all following periods in the same year

---

## [1.4.0] - 2026-05-08

### Added
- Full internationalisation (EN/NL/DE) — language preference saved in browser
- Sparkasse (DE) CSV import support with automatic format detection
- Local server mode — run the app on your own machine without a Cloudflare account (Node 22+, `npm start`)
- App screenshot in README

### Changed
- App renamed from "Vaste Lasten" to "Fixed Expenses"
- README rewritten in English with installation options overview and separate Cloudflare hosting section
- License updated to MIT
- Clone URL updated to renamed GitHub repository `fixed-expenses`

### Fixed
- ESLint i18n globals declared so Cloudflare deploy no longer fails after adding i18n

---

## [1.3.0] - 2026-05-05

### Changed
- Amount field is no longer required when adding a recurring expense with "Variable amount" checked
- Deleting a recurring expense is now permanent — replaces the old deactivate/reactivate flow
- Transaction matching now works across period boundaries: transactions up to 20 days before a period start are matched to that period (fixes matching failures for payments on the last day before a new period)
- Hermatchen (re-match) and manual transaction search now include transactions from adjacent periods within 20 days of the period boundary
- Coupling a transaction from another period automatically moves it to the target period
- Renamed `migrate_vanaf_datum.sql` to `migrate_from_date.sql`

### Fixed
- Duplicate period labels in the period dropdown (e.g. two entries for the same date range)
- Period deletion via settings now works correctly (previously the delete button did nothing for duplicate periods)

### Removed
- Ability to deactivate and reactivate recurring expenses
- "Not active this year" section on the dashboard
- Unused variables and dead code (`allLastenSelectOptions`, `MAANDEN`, `updateLastenSelect()`)

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
