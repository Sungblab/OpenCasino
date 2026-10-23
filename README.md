# Open Casino

> **Play-money only. Do not add real-money deposits, top-ups, withdrawals, cash-outs, coin purchases, or payment processing.**
> Coins are free game credits with no monetary value and no redemption path. This rule applies to code, configuration, documentation, and contributions.

Open Casino is a real-time casino and board-game platform powered by a double-entry coin ledger. It includes baccarat, lightning baccarat, dragon tiger, blackjack, Texas hold'em, sutda, go-stop, and other multiplayer games.

- **Server-authoritative games:** The server determines cards, outcomes, and settlements; clients render server snapshots.
- **Double-entry ledger:** Every coin movement is recorded as a balanced ledger transaction. Database triggers verify ledger balance and cached wallet balances. Betting commands are idempotent by `requestId`.

## Project layout

| Path | Contents |
| --- | --- |
| `apps/api` | Express, Socket.IO, PostgreSQL API, real-time rooms, and ledger |
| `apps/api/src/database` | Connection pool, migrations, and seed data |
| `apps/api/test-integration` | Integration tests using PostgreSQL and a real API process |
| `apps/web` | React and Vite web client |
| `packages/contracts` | Shared TypeScript types and Zod schemas |
| `packages/game-core` | Pure game rules, separate from the database and network |
| `scripts/` | Build and load-test scripts |

## Requirements

- Node.js 22
- PostgreSQL 16 or later (Docker Compose starts PostgreSQL 17)
- Docker, if you want to use the bundled database commands

## Run locally

```bash
npm ci
cp .env.example .env
npm run db:up               # Optional: start PostgreSQL with Docker
npm run db:migrate
npm run db:seed
npm run dev                 # API on :5100 and web app on :5173
```

The API reads `apps/api/.env` or shell environment variables. The web development server reads `apps/web/.env.local` or the root `.env`. The defaults in `.env.example` are for local development only.

The seed command creates game rooms and system wallets; it does not create a user. Sign up in the app, then grant local administrator access with:

```bash
psql -h 127.0.0.1 -U opencasino opencasino \
  -c "UPDATE users SET role='admin', approved=true WHERE username='YOUR_USERNAME'"
```

Check migration status with `npm run db:migrate:status`.

## Play-money policy

This project is permanently limited to free play-money credits. There are no deposit, withdrawal, exchange, transfer, or wagering-requirement features in the code.

- Coins cannot be purchased, redeemed, exchanged for cash, or transferred through a payment provider.
- Free coins come from the daily coin allowance, missions, and administrator grants.
- Hold'em buy-ins and in-game chip replenishment move free game credits between the wallet and a table; they are not account top-ups or payments.
- Do not add real-money features or any switch that enables them.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy.

## Checks and tests

```bash
npm run typecheck
npm test
npm run test:integration    # Requires PostgreSQL
npm run test:load -- --clients 40 --rounds 3
npm run build -w @opencasino/web
```

Integration tests use `INTEGRATION_DATABASE_URL` (defaults to a local PostgreSQL URL), create temporary databases for the test run, and remove them afterward. The load test starts an API process and a temporary database; see `scripts/load/bet-load.mjs` for options. CI runs type checks, unit tests, integration tests, and builds on pushes and pull requests.

## Database migrations

Add schema changes as numbered files under `apps/api/src/database/migrations/` and register each migration in `migrations/index.ts`. Do not edit a migration after it has been applied; add a new migration instead. Keep migrations backward-compatible so deployments can roll forward safely.

```bash
npm run db:migrate
npm run db:migrate:status
npm run test:integration
```

## Build and deployment

`npm run build -w @opencasino/api` bundles the API into `apps/api/dist/`; `Dockerfile.api` builds the API image used by `docker-compose.yml`.
## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
