# SwipeFi.fun

Swipe to invest.

SwipeFi.fun is a non-custodial, fixed-budget allocation app for Robinhood Chain and Solana. A user selects a chain, sets a daily, weekly, or monthly spending limit, chooses the USDG or USDC amount represented by each decision, receives a ranked asset feed, builds a basket, and explicitly signs the complete basket.

The current product is user-controlled. It does not hold funds, run an autonomous mandate, or let an AI sign transactions. The backend ranks, prepares, and validates. A Privy ERC-4337 smart wallet signs Robinhood operations; the selected Privy-connected Solana wallet signs Solana transactions.

## Current status

The repository currently implements:

- A React/Vite frontend with onboarding, Basket, Portfolio, Activity, Account, and wallet-management surfaces.
- Privy login, an embedded EVM signer and canonical ERC-4337 SwipeFi Wallet on Robinhood Chain (`4663`), plus connected Solana wallets on mainnet-beta.
- Chain selection followed by five-question onboarding for cadence, period limit, ticket size, risk preference, and asset mix, with a required risk acknowledgement.
- Account-scoped chain, execution-provider, ranking-provider, and plan persistence. Returning authenticated users reuse their saved settings until they change them.
- Canonical WETH, Robinhood stock-token, Solana, and opt-in Degen community registries, with bounded recovery of provider-discovered contract or mint identities.
- Live Robinhood contract, asset-status, price/halt, and oracle-pause checks for selected stock tokens during Review.
- Browsable feed discovery that does not spend executable quotes; every selected asset is re-resolved and freshly quoted during Review.
- Deterministic ranking with stable stock/crypto alternation, or optional private ranking through 0G when enabled for the account.
- Ten-candidate feed pages with additional pages loaded as the user approaches the end of the current page.
- Deterministic budget, asset, quote-freshness, price-impact, and plan-hash validation around the ranking model.
- One atomic Robinhood buy operation containing one exact USDG approval followed by all provider swap calls.
- One atomic Solana versioned transaction built from Jupiter or 0x routes, simulated before signing, and bound to a message commitment.
- Submitted-operation reconciliation against Robinhood receipt transfers or confirmed Solana token-balance deltas.
- Alchemy-indexed Robinhood and Solana portfolio balances, cached CoinGecko history, and per-position exits. Robinhood can batch all currently routable exits into one atomic smart-wallet operation; Solana exits remain individual.
- PostgreSQL state in production and in-memory state in demo/local-live modes.

The original hackathon research and implementation brief remains in [investmade_fun.md](./investmade_fun.md). It contains historical options and sponsor-track ideas; the current runtime source of truth is this README, [docs/USER_FLOW.md](./docs/USER_FLOW.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and the code.

## Real user flow

1. The user selects Robinhood Chain or Solana and answers five questions:
   cadence, period limit, ticket size, risk preference, and allowed asset classes.
2. The user reviews the plan, accepts the disclosure, and selects **Save plan & connect**.
3. Privy authenticates the user and activates the chain-specific execution wallet: the SwipeFi smart wallet on chain `4663`, or the selected Solana wallet on mainnet-beta.
4. The backend opens the cadence epoch and generates the first ranked feed page.
5. The user skips or adds cards. Adding a card reserves one ticket inside the selected period limit; it does not move funds.
6. **Review basket** re-resolves and refreshes the selected routes and displays wallet balance, input, estimated output, minimum output, price impact, remaining budget, quote lifetime, and ranking proof.
7. For a live basket, the app preflights one complete ERC-4337 operation or Solana versioned transaction and opens one Privy confirmation. All buy legs succeed together or the complete transaction reverts.
8. The backend stores the submitted operation hash or Solana signature and polls the selected chain until the result is terminal.
9. Activity displays `SUBMITTED`, `SETTLED`, `PARTIAL`, or `FAILED` evidence. A quote or hash alone is never displayed as settlement.
10. Portfolio reads indexed balances and can prepare fresh asset-to-stablecoin exits. Robinhood uses USDG and can submit all routable exits atomically in one smart-wallet operation. Solana uses USDC and signs each exit separately.

See [docs/USER_FLOW.md](./docs/USER_FLOW.md) for screen states, recovery paths, and mode-specific differences.

## Runtime modes

| Mode | Configuration | State and ranking | Market and execution behavior |
|---|---|---|---|
| Demo | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=false` | In-memory sessions; fixture candidates; deterministic or configured 0G ranking | Simulated basket and settlement; no broadcast |
| Local live | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=true` | In-memory, repeatable cadence sessions; live chain-specific candidates; saved ranking-provider choice | Real Robinhood or Solana quotes, signing, submission, and reconciliation; prohibited with `NODE_ENV=production` |
| Production | `INVESTMADE_DEMO_MODE=false` | PostgreSQL; one session/execution boundary per wallet and cadence epoch; configured deterministic or verified 0G ranking | Live chain-specific validation, atomic buy submission, and onchain reconciliation |

`GET /api/config` and `GET /api/health` expose the active public mode. Local and production browser sessions are origin-scoped, so being connected on `localhost` does not authenticate the production domain.

## Run locally

```bash
npm ci --cache .npm-cache
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The default `.env.example` configuration is demo mode and never broadcasts.

Run the project checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## Local-live smoke testing

Local-live is for developer-controlled mainnet testing without production persistence. Robinhood execution requires at least one configured provider:

```dotenv
INVESTMADE_DEMO_MODE=true
LOCAL_LIVE_EXECUTION=true
ZERO_EX_API_KEY=...
# Optional, but required for the indexed Robinhood portfolio:
ROBINHOOD_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/...
```

Use `UNISWAP_API_KEY` instead of, or alongside, `ZERO_EX_API_KEY` to expose Uniswap as a Robinhood execution option. Solana additionally requires:

```dotenv
JUPITER_API_KEY=...
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/...
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/...
```

Jupiter is the initial Solana provider; 0x becomes selectable for Solana when both the Solana stack and `ZERO_EX_API_KEY` are configured. Privy authentication and wallet signing are real. Sessions remain in memory and ranking can be deterministic or 0G-backed. This mode must not run with `NODE_ENV=production`.

Public RPC URLs are sufficient for supported RPC calls, but the portfolio screens require Alchemy-shaped Robinhood and Solana RPC URLs so the server can derive the corresponding Portfolio API endpoint.

## Production configuration

Production requires:

- `INVESTMADE_DEMO_MODE=false`
- `DATABASE_URL`
- at least one of `ZERO_EX_API_KEY` or `UNISWAP_API_KEY` for Robinhood execution
- `COINGECKO_API_KEY`
- `ZG_ROUTER_API_KEY`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- a production-length `SESSION_SECRET`

To enable Solana, also configure `JUPITER_API_KEY`, `SOLANA_RPC_URL`, and `SOLANA_WS_URL`. To enable indexed portfolio balances, use Alchemy RPC URLs for each enabled chain.

CoinGecko batch prices, chart history, and icons are market-data enrichment paths.

```bash
npm run db:migrate
npm run build
npm start
```

In Privy, enable smart wallets for all users and configure Robinhood Chain `4663` with working bundler/paymaster infrastructure. Use a dedicated production RPC rather than the public Robinhood endpoint for normal traffic.

Privy is configured to create both Ethereum and Solana embedded wallets and to surface Solana external-wallet connectors such as Phantom. Solana uses USDC as the budget asset. Jupiter or 0x route instructions are composed into one versioned transaction. The backend simulates that complete transaction, locks its message commitment, submits only the matching signed transaction, and reconciles confirmed token-balance changes before settlement.

## Buy execution boundaries

### Robinhood Chain

For each reviewed live basket, the backend:

1. Regenerates selected candidates and requests fresh exact-input 0x AllowanceHolder routes.
2. Revalidates the exact ticket size, period limit, selected asset IDs, quote freshness, price impact, authenticated smart wallet and embedded-owner `txOrigin`, chain, tokens, and calldata.
3. Requires one shared AllowanceHolder spender, returns one exact-total USDG approval followed by the swap calls, and binds every call to the authorized plan.
4. Lets the browser verify that the prepared plan still matches the visible review basket.
5. Prepares the complete ERC-4337 user operation.
6. Opens one Privy confirmation and submits one atomic operation.
7. Reconciles the terminal receipt, exact USDG spend, and output-token transfers.

An HTTP success, quote response, wallet acknowledgement, or transaction hash is not settlement proof.

### Solana

For each reviewed live basket, the backend and client:

1. Re-resolve the selected mints and verify the wallet has enough USDC before route construction.
2. Request fresh Jupiter or 0x instructions for each exact-input leg.
3. Compose and simulate one versioned transaction, reject unexpected signers or oversized packets, and bind the compiled message to the prepared plan.
4. Let Privy sign that exact transaction once.
5. Submit the signed transaction through the selected server-side provider.
6. Poll the signature to a terminal state and reconcile every expected mint delta, including native SOL rent handling.

Transient rate limits and one route-specific build or simulation failure receive bounded retries. Insufficient USDC, SOL, rent, or fee balance fails explicitly and is not disguised as a liquidity reroute.

## Portfolio and exits

Portfolio is independent of the buy-session gate:

- It reads non-zero balances through the Alchemy Portfolio API when the configured chain RPC is Alchemy-backed.
- Robinhood keeps only supported assets that can be matched to the current candidate catalog; Solana can display indexed tokens while exits remain limited to provider-supported assets.
- It values holdings with the latest candidate unit price.
- It uses cached CoinGecko history when enough data exists; otherwise the UI labels history as unavailable.
- **Get exit quote** requests a fresh exact-input route to USDG on Robinhood or USDC on Solana.
- Robinhood **Confirm sell** preflights and submits all calls for one position as one smart-wallet operation.
- Robinhood **Exit all positions** prepares every currently routable holding and submits the combined call set atomically; holdings without a current route are skipped before signing.
- Solana exits are signed and reconciled one position at a time. The UI does not offer a multi-position Solana exit.

## Live 0x verification

The read-only verifier discovers active chain-4663 stocks from Robinhood, requests representative 0x AllowanceHolder quotes, checks a reverse route, and verifies that two buy routes share one approval spender. Put a stock already held by the verification wallet first in `ZERO_EX_VERIFY_SYMBOLS` so its reverse simulation can succeed. It reports route readiness only when the buy, reverse, and two-asset 0x quote simulations are complete for the supplied funded smart wallet. Full live readiness additionally requires the browser's two-asset `prepareUserOperation` preflight to succeed.

Run the read-only check without printing the API key:

```bash
set -a
source .env
set +a
npm run verify:0x
```

The script does not broadcast.

`ZERO_EX_VERIFY_WALLET`, `ZERO_EX_VERIFY_TX_ORIGIN`, `ZERO_EX_VERIFY_SYMBOLS`, and `ZERO_EX_VERIFY_USDG_AMOUNT` are verifier inputs only; they do not configure normal application execution.

## Production readiness

The codebase contains the production path, but public-mainnet readiness still requires operator evidence:

- A funded SwipeFi Wallet with USDG. Gas sponsorship remains a separate Privy/paymaster acceptance test and must not be described as gasless until verified with no ETH.
- Dedicated production RPC and operational monitoring.
- A live 0G response with `tee_verified: true`.
- Successful small atomic buy and supported-position exit tests.
- Database backup/restore, alerting, key rotation, incident response, and legal review.

Use [docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md) as the release gate.
Use [docs/LIVE_EXECUTION_TEST_MATRIX.md](./docs/LIVE_EXECUTION_TEST_MATRIX.md) to distinguish automated checks and provider preflight from confirmed onchain settlement.

## Important files

- `src/client/App.tsx` — top-level UI state and navigation.
- `src/client/components/Onboarding.tsx` — real onboarding and wallet activation flow.
- `src/client/components/ReviewScreen.tsx` — quote refresh, review, preflight, signing, and reconciliation.
- `src/client/components/ReceiptScreen.tsx` — submitted and terminal activity evidence.
- `src/client/components/PositionsScreen.tsx` — holdings, history, and exit flow.
- `src/server/bootstrap.ts` — mode-dependent provider and storage wiring.
- `src/server/app.ts` — API, auth, session, feed, execution, and reconciliation routes.
- `src/server/adapters/live-candidates.ts` — live registry, state, permission, and quote discovery.
- `src/server/adapters/zero-ex.ts` — 0x price/quote validation, exact approvals, and swap calldata.
- `src/server/adapters/jupiter.ts` — Solana discovery, transaction composition, simulation, submission, exits, and reconciliation.
- `src/server/adapters/zero-ex-solana.ts` — 0x Solana route normalization and bounded rate-limit handling.
- `src/server/adapters/zero-g.ts` — strict private inference.
- `src/domain/policy.ts` — deterministic feed and execution rules.
- `src/domain/asset-tag-config.ts` — user-visible market-category labels, filtering, and tones.
- `migrations/001_initial.sql` — production session and execution constraints.

## Security

See [SECURITY.md](./SECURITY.md). Provider credentials, wallet signatures, and raw private inference must remain out of logs and browser-visible configuration.

## References

- [0x supported chains](https://docs.0x.org/docs/introduction/supported-chains)
- [0x contract guidance](https://docs.0x.org/docs/core-concepts/contracts)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview)
