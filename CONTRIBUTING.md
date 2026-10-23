# Contributing

Open Casino is a free play-money project. Game coins have no monetary value and may only be used inside the games.

## Non-negotiable economic policy

Do not add any of the following:

- Real-money payments, coin purchases, top-ups, or deposits
- Withdrawals, cash-outs, currency exchange, gift cards, or other cash-equivalent rewards
- Integrations with payment, money-transfer, or financial services that enable those features
- Environment variables, administrator tools, or other overrides that enable those features

Free game credits and moving chips between a player's wallet and a game table must remain separate from real-money payments. There is no real-money feature in the code, and none should be added.

Changes that violate this policy will not be accepted, whether submitted as code, configuration, documentation, or tests.

## Development

```bash
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run check
```

See [README.md](README.md) for integration tests, builds, and deployment notes. Never commit secrets, production data, or local `.env` files.
