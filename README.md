# Invoice Manager

Invoice generator and management dashboard on top of an existing MongoDB database.

- **server/** — Express + Mongoose API, PDF rendering (pdfkit)
- **client/** — React + Vite dashboard
- **shared/** — billing rule, totals and formatting used by both

## Requirements

- Node.js 22+
- A running MongoDB instance

## Setup

```bash
npm run setup                          # install server + client dependencies
cp server/.env.example server/.env     # then set MONGODB_URI and collection names
npm run build                          # build the UI
npm start                              # http://127.0.0.1:5050
```

Development (live reload): run `npm run dev:server` and `npm run dev:client` in two terminals, then open
http://localhost:5173 (it proxies `/api` to the server).

## Data

| Collection | Access | Notes |
|---|---|---|
| `CUSTOMER_COLLECTION` (default `customers`) | read-only | fields auto-detected; override with `CUSTOMER_FIELD_*` |
| `SERVICE_COLLECTION` (default `services`) | read-only | fields auto-detected; override with `SERVICE_FIELD_*` |
| `invoices` | read/write | snapshots of customer + service details, unique `invoiceNumber`, unique `billingKeys` |
| `invoice_settings` | read/write | business details, currency, tax, logo |

## Business rules

- The invoice date is always the **1st of the month after the (latest) billing month**: services for
  February 2025 are invoiced on 01 March 2025. Enforced on the server for manual and bulk invoices.
- One invoice per customer + service + billing month (unique index on `billingKeys`).
  Cancelling an invoice frees its period.
- Invoice numbers are `INV-` + 6 random digits, checked before insert and guarded by a unique index
  (retried on collision).
- Totals are always recalculated on the server, in integer cents.
- Only pending, unpaid invoices can be deleted; others must be cancelled (kept for history).

## Spreadsheet import

```bash
npm run import:sample -- "path/to/record.xlsx" --from 2025-02 --to 2026-12 --rate 2500 --customer "Name"
```

Creates one invoice per billing month (dated the 1st of the next month) with that month's task list and
hours. Add `--dry-run yes` to preview without writing. Re-running skips months already invoiced.

## Tests

```bash
npm test          # unit tests (billing rule, totals, keys)
npm run test:api  # end-to-end API tests against the running server (cleans up after itself)
```

The server binds to 127.0.0.1 by default because the app has no login.
