# British Auction RFQ System

This repository contains a complete reference solution for GoComet's British Auction RFQ assignment. It is intentionally built with Node.js 24's built-in `node:sqlite` module so the reviewer can run the app without pulling a framework or ORM dependency tree.

## What is included

- RFQ creation form with British Auction configuration
- Auction listing page with current lowest bid, close time, forced close time, and status
- Auction detail page with:
  - all bids sorted by price
  - live supplier ranking (`L1`, `L2`, `L3`, ...)
  - quote breakdown details
  - activity log for bid submissions and time extensions
- Automatic extension engine covering:
  - bid received in last `X` minutes
  - any supplier rank change in last `X` minutes
  - lowest bidder change in last `X` minutes
- Forced-close guardrail that prevents extensions past the hard stop
- SQLite schema and seeded demo data
- JSON API endpoints for backend review
- HLD and schema design documents in `docs/`
- Node test coverage for the core extension logic

## Tech choices

- Runtime: Node.js 24+
- Database: SQLite via built-in `node:sqlite`
- Backend: server-rendered HTTP app with JSON endpoints
- Frontend: semantic HTML, custom CSS, small vanilla JS enhancements

This keeps the project easy to evaluate while still showing backend design, domain modeling, and frontend polish.

## Run locally

1. Make sure Node.js `24.x` or newer is installed.
2. Start the app:

```bash
node server.js
```

3. Open [http://localhost:3000](http://localhost:3000)

For development with auto-reload:

```bash
node --watch server.js
```

## Run tests

```bash
node --test
```

## API endpoints

- `GET /api/health`
- `GET /api/auctions`
- `GET /api/auctions/:id`
- `POST /api/rfqs`
- `POST /api/auctions/:id/bids`

Example RFQ creation payload:

```json
{
  "referenceId": "RFQ-BA-9001",
  "name": "Hyderabad to Ahmedabad electronics movement",
  "bidStartAt": "2026-04-26T10:00:00",
  "bidCloseAt": "2026-04-26T12:00:00",
  "forcedBidCloseAt": "2026-04-26T12:30:00",
  "serviceDate": "2026-04-28",
  "triggerWindowMinutes": 10,
  "extensionDurationMinutes": 5,
  "triggerTypes": [
    "BID_RECEIVED",
    "ANY_RANK_CHANGE",
    "LOWEST_BIDDER_CHANGE"
  ]
}
```

## Project structure

```text
server.js                 HTTP server and routing
src/domain/               Auction engine and trigger logic
src/server/               Persistence and page rendering
src/utils/                Formatting helpers
public/                   CSS and browser-side behavior
docs/                     HLD and schema design
tests/                    Auction engine tests
```

## Notes and assumptions

- `service_date` and `quote_valid_until` are stored as date-only values.
- Rankings are based on the latest bid from each supplier.
- Suppliers can only submit a new bid if their new total is lower than their own latest standing quote.
- Timezones use the server's local timezone for form entry and display.

## Deliverables map

- HLD with architecture diagram: [docs/architecture.md](./docs/architecture.md)
- Schema design: [docs/schema-design.md](./docs/schema-design.md)
- Backend code: `server.js`, `src/domain/`, `src/server/`
- Frontend code: `src/server/pages.js`, `public/styles.css`, `public/client.js`
