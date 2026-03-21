# Vaste Lasten Tracker

Een persoonlijke financiële web-app om vaste lasten bij te houden, bankafschriften te importeren en je budget per salarisperiode te beheren.

## Features

- **Dashboard** — Overzicht van je vaste lasten per periode met status (betaald, open, overgeslagen)
- **Bankimport** — CSV-import van ING, ABN AMRO en Rabobank met automatische herkenning
- **Automatische matching** — Transacties worden gekoppeld aan vaste lasten op basis van IBAN, omschrijving of bedrag
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
| CI/CD | GitHub Actions |

## Projectstructuur

```
├── functions/api/[[route]].js   # API handler (serverless)
├── public/
│   ├── index.html               # Single-page app
│   ├── app.js                   # Frontend logica
│   ├── style.css                # Styling
│   └── chart.min.js             # Chart.js library
├── schema.sql                   # Database schema
├── wrangler.toml                # Cloudflare configuratie
└── .github/workflows/deploy.yml # Deploy pipeline
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

## Deployment

De app wordt automatisch gedeployd naar Cloudflare Pages bij een push naar `master`. De GitHub Actions workflow:

1. Installeert dependencies (`npm ci`)
2. Deployt via `wrangler-action@v3` naar Cloudflare Pages

**Vereiste GitHub Secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

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
