# South Hill Fund website — improved

Website for Ithaca College School of Business's student-managed funds
(Equity Fund, Fixed Income Fund, CTC Fund), with a live scrolling ticker
tape and live-updating fund/holdings values.

## Run it locally

Requires Node.js 18 or newer (for built-in `fetch`).

```
npm install
npm start
```

Then open http://localhost:3000

## How the live data works

Yahoo Finance does not offer an official, supported public API. This site
uses the same unauthenticated endpoints Yahoo's own website calls — which
means:

- It can change or stop working without notice. This is normal for
  unofficial data sources and not a bug in this codebase.
- Quote requests must run **server-side** (see `server.js`), because Yahoo
  does not return CORS headers that would let a browser call it directly.
- The server caches quotes for 30 seconds so the page can poll frequently
  without hammering Yahoo.
- If a symbol (or all of them) can't be fetched, the site falls back to
  the last known good price, and if there's no live price at all yet, it
  falls back to the account's month-end statement value so the page never
  shows a broken or misleadingly-low number.

**For a permanent production deployment, we'd recommend replacing
`fetchQuotes()` in `server.js` with a licensed market-data provider**
(e.g., IEX Cloud, Polygon.io, Alpha Vantage, or a broker's own data feed).
That is a drop-in swap — nothing else in the app needs to change, since
everything else just calls `GET /api/quotes`.

## Updating fund holdings

Holdings, cash balances, and statement totals live in `data/holdings.json`.
This should be updated whenever a new month-end brokerage statement comes
in. There's no database — it's a single JSON file, edited directly.

Fields per fund:
- `cash` — cash & money market balance from the statement
- `endingValue` / `beginningValue` — statement month ending/beginning values
- `ytdBeginningValue` — value at the start of the calendar year
- `unrealizedGain` — from the statement's Gain/Loss summary
- `holdings` — array of `{ symbol, name, qty, type }` (`type` is
  `equity`, `etf`, or `reit`)
- `treasuries` (Fixed Income Fund only) — directly held Treasury notes,
  which don't have a live quote, so they're carried at the statement's
  market value until the next statement updates them

## Adding new photo albums (each semester)

The Photos tab is organized into dated albums (e.g., "IAB Presentation —
Fall 2024"). To add a new one:

1. Create a new folder under `public/img/gallery/`, e.g.
   `public/img/gallery/iab-presentation-spring-2025/`
2. Drop the photos in there, named simply (e.g. `photo-01.jpg`, `photo-02.jpg`)
3. In `public/index.html`, inside `<main id="view-gallery">`, copy one of
   the existing `<div class="album">...</div>` blocks, update:
   - the `<h3 class="album-title">` text (e.g. "IAB Presentation — Spring 2025")
   - each photo's `href`/`src` path and `alt` text
4. Save, restart the server, hard-refresh the browser

Naming convention used so far: December presentations are labeled by
**Fall** of that year (e.g., a Dec 2025 event is "Fall 2025"); May
presentations are labeled **Spring** of that year.

Current albums: Trading Room (general photos), IAB Presentation — Fall
2024, Spring 2024 (video), Fall 2025, FI Presentation — Spring 2023,
FI Presentation — Spring 2026.

**Avoiding duplicates:** before adding a new batch of photos, it's worth
checking they aren't already on the site — the same event sometimes gets
uploaded twice under a different file name. A quick way to check:
```
md5sum public/img/gallery/**/*.jpg
```
and compare against the new files' checksums — identical hashes mean
identical files, regardless of filename.

## Project structure

```
server.js            Express server + Yahoo Finance proxy (/api/quotes)
data/holdings.json    Fund holdings, cash, and statement totals
public/
  index.html          Single-page site (Overview + 3 fund detail views)
  css/style.css        Design system
  js/app.js            Rendering + live-quote polling (every 30s)
```

## Deploying at IC

This is a standard Node/Express app — deploy it anywhere that runs Node
18+ (a campus server, Render, Railway, Vercel with a Node runtime, etc.).
No database or environment variables are required to run it as-is.


## Design refresh

The 2026 refresh keeps the original live-data architecture and portfolio information, while adding:
- a stronger institutional hero and clearer program positioning;
- prominent calls to explore the funds and student experience;
- a market-data status strip;
- a four-step experiential-learning section (Research → Pitch → Manage → Communicate);
- cleaner, lighter portfolio cards and more readable holdings tables;
- improved keyboard accessibility for interactive fund cards;
- responsive navigation and mobile layouts.

The data model and `/api/holdings` / `/api/quotes` endpoints are unchanged.
