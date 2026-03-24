# Vaste Lasten Tracker

Een persoonlijke financiële web-app om vaste lasten bij te houden, bankafschriften te importeren en je budget per salarisperiode te beheren.

## Features

- **Dashboard** — Overzicht van je vaste lasten per periode met status (betaald, open, overgeslagen)
- **Afwijkingsmarkering** — Rijen worden geel gemarkeerd als het afgeschreven bedrag afwijkt van het verwachte bedrag
- **Bankimport** — CSV-import van ING, ABN AMRO en Rabobank met automatische herkenning
- **Automatische matching** — Transacties worden gekoppeld aan vaste lasten op basis van IBAN, omschrijving of bedrag (alleen afschrijvingen)
- **Periodes** — Budgetperiodes op basis van je salarisdag, automatisch genereerbaar per jaar
- **Categorieën** — Groepeer je vaste lasten en bekijk de verdeling in grafieken
- **Statistieken** — Taartdiagram per categorie en staafdiagram per periode

## Tech Stack

| Laag | Technologie |
|------|-------------|
| Frontend | Vanilla HTML/CSS/JS, Chart.js |
| Backend | Cloudflare Workers (Pages Functions) |
| Database | Cloudflare D1 (SQLite) |
| Hosting | Cloudflare Pages |
| CI/CD | GitHub Actions (lint → test → deploy) |
| Tests | Vitest |
| Linting | ESLint v9 |

## Projectstructuur

```
├── functions/api/[[route]].js   # API handler (serverless)
├── lib/
│   ├── automatch.js             # Match-logica (geëxporteerd voor tests)
│   └── csv.js                  # CSV parsing (geëxporteerd voor tests)
├── public/
│   ├── index.html               # Single-page app
│   ├── app.js                   # Frontend logica
│   ├── style.css                # Styling
│   └── chart.min.js             # Chart.js library
├── test/
│   ├── automatch.test.js        # Unit tests voor match-logica
│   └── csv.test.js              # Unit tests voor CSV parsing
├── schema.sql                   # Database schema
├── wrangler.toml                # Cloudflare configuratie
├── eslint.config.js             # ESLint configuratie
├── CHANGELOG.md                 # Versiehistorie
└── .github/
    ├── workflows/deploy.yml     # CI/CD pipeline (lint → test → deploy)
    └── pull_request_template.md # PR template
```

## Lokaal ontwikkelen

```bash
npm install
npx wrangler pages dev public/ --d1 DB=vaste-lasten-db
```

Dit start een lokale dev-server met een lokale D1-database. Bij de eerste keer moet je het schema toepassen:

```bash
npx wrangler d1 execute vaste-lasten-db --local --file=schema.sql
```

## Tests

```bash
npm test
```

Draait 37 unit tests met Vitest voor de match-logica en CSV parsing.

## Deployment

De app wordt automatisch gedeployd naar Cloudflare Pages bij een push naar elke branch. De GitHub Actions workflow:

1. **lint** en **test** — Draaien parallel: ESLint check + 37 unit tests
2. **deploy** — Deployt via `wrangler-action@v3` naar Cloudflare Pages (alleen als lint én test slagen)

Feature branches krijgen een preview URL (`https://feature-vX-Y-Z.vaste-lasten.pages.dev`). Mergen naar `main` vereist een PR en een geslaagde `test` check.

**Vereiste GitHub Secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Versioning

Semantische versienummering (semver). Feature branches worden aangemaakt als `feature/vX.Y.Z`. Alle wijzigingen worden bijgehouden in [`CHANGELOG.md`](CHANGELOG.md).

- **PATCH** (1.0.x) — Bug fixes
- **MINOR** (1.x.0) — Nieuwe features
- **MAJOR** (x.0.0) — Breaking changes

De huidige versie is zichtbaar onderaan het sidebar-menu in de app.

## API Endpoints

| Methode | Pad | Beschrijving |
|---------|-----|-------------|
| `GET` | `/api/lasten` | Alle vaste lasten ophalen |
| `POST` | `/api/lasten` | Nieuwe vaste last aanmaken |
| `PUT` | `/api/lasten/:id` | Vaste last bewerken |
| `DELETE` | `/api/lasten/:id` | Vaste last verwijderen |
| `GET` | `/api/periodes` | Alle periodes ophalen |
| `POST` | `/api/periodes` | Nieuwe periode aanmaken |
| `POST` | `/api/periodes/genereer/:jaar` | Periodes genereren voor een jaar |
| `GET` | `/api/periodes/:id/overzicht` | Periode-overzicht met koppelingen |
| `POST` | `/api/import/preview` | CSV-bestand previewed |
| `POST` | `/api/import/opslaan` | Geïmporteerde transacties opslaan |
| `GET` | `/api/statistieken` | Grafiekdata ophalen |
| `GET` | `/api/transacties` | Transacties zoeken |
| `GET/PUT` | `/api/instellingen` | Instellingen beheren |

## Database

Zes tabellen in Cloudflare D1 (SQLite):

- **vaste_lasten** — Vaste lasten met naam, bedrag, categorie, IBAN en omschrijvingspatroon
- **periodes** — Salarisperiodes met start/einddatum en salarisbedrag
- **bank_transacties** — Geïmporteerde banktransacties met koppeling aan last en periode
- **periode_overgeslagen** — Overgeslagen lasten per periode
- **vaste_last_periode_actief** — Per-periode activering van lasten
- **instellingen** — Key-value instellingen (o.a. salarisdag)

## Licentie

Private project.
