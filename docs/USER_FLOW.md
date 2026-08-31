# Current user flow

This document describes the user-visible flow implemented in the current codebase. It is not the original hackathon pitch or a future roadmap.

## Navigation model

Before onboarding completes, the header exposes the SwipeFi.fun home action and Privy wallet connection. After authentication and plan activation, the primary navigation contains:

- **Basket** — ranked cards, selected budget, and basket review.
- **Portfolio** — Alchemy-indexed wallet balances, available price context, and supported exits.
- **Activity** — the latest submitted or terminal basket receipt available to this browser session.
- **Account** — active execution wallet, stablecoin balance, chain/provider settings, plan settings, and developer controls where applicable.

On Robinhood Chain, the wallet menu exposes the SwipeFi smart wallet, connected funding wallet, top-up, send, copy-address, and logout actions. The funding wallet can fund the SwipeFi Wallet; it is not the live atomic-buy executor. On Solana, the selected Privy-connected wallet is both the funding and execution wallet.

## 1. Landing and plan creation

The unauthenticated page first lets the user choose Robinhood Chain or Solana, then starts **Build your investment guardrails**.

The user answers five questions:

1. **Investment period** — daily, weekly, or monthly cadence.
2. **Period limit** — maximum USDG or USDC spend for each cadence epoch; custom values range from `10.00` to `100.00`.
3. **Decision size** — chain stablecoin amount represented by one add action; custom values range from `0.10` to the chosen period limit.
4. **Risk preference** — conservative, balanced, or degen. This changes ranking and whether community assets may enter discovery; it does not bypass deterministic safety checks.
5. **Asset mix** — crypto, tokenized stocks, or both.

The review step shows the plan and requires the user to acknowledge that ranking is not financial advice, assets can lose value, stock-token routes depend on eligibility/permission checks, and every trade requires wallet approval.

Selecting **Save plan & connect** records the completed plan, active chain, and provider choices for the authenticated Privy user after authentication succeeds. Robinhood starts with 0x execution and deterministic ranking. Solana starts with Jupiter execution and 0G ranking; the current Solana onboarding path therefore requires 0G to be configured or a previously saved deterministic preference. The Account screen can change the execution provider and toggle 0G versus deterministic ranking; saving either change invalidates unsigned prepared executions. Returning users with stored preferences resume at wallet activation instead of answering the questions again. **Change my answers** clears the stored plan for that account.

## 2. Privy and SwipeFi Wallet activation

The wallet stage can perform several actions depending on the selected chain and user state:

- Open Privy login.
- For Robinhood, create an embedded EVM signer when needed, obtain the smart-wallet client for chain `4663`, and confirm its canonical SwipeFi Wallet address.
- For Solana, select or connect an embedded/external Solana wallet and confirm its mainnet address.

The server receives a short-lived Privy access token, chain header, execution-wallet address, and EVM `txOrigin` where applicable. For live requests, it verifies the token and confirms that the chain-specific wallet belongs to the authenticated Privy user.

## 3. Session and feed generation

After wallet activation:

1. `POST /api/sessions/open` creates or returns a session for the selected cadence.
2. Demo and local-live modes add a basket nonce, making new baskets repeatable within the same cadence period.
3. Production uses the cadence epoch directly, enforcing its persistent wallet/epoch boundary.
4. `POST /api/sessions/:sessionId/feed` derives an exact base-unit budget from the period limit and ticket size.
5. Candidate discovery uses the selected chain and execution provider, then filters by asset classes and risk mode.
6. The browsable Robinhood feed is limited to CoinGecko-listed assets with safe icons. It does not request executable quotes or run the full onchain route preflight for every card.
7. Solana discovery uses the selected Jupiter or 0x provider and preserves canonical mint identities across preparation.
8. The ranking provider receives only the bounded candidate packet and preferences. Deterministic ranking stably alternates crypto and stock tokens when both are available; deterministic policy validates provider choice, returned asset IDs, commitments, budgets, and market-data availability.

The first response contains up to ten candidates. As the user approaches the final three cards, the client requests another page while excluding already seen and selected assets. Loading stops when discovery returns no additional eligible page.

Full Robinhood contract, registry, market, oracle, permission, and executable-quote validation happens after the user selects assets and opens Review. Production rejects stale Robinhood price evidence at that boundary; local-live can tolerate off-hours timestamps while retaining the other checks.

## 4. Building a basket

Each card shows the asset, chain-stablecoin ticket amount, current market reference price, history when available, ranking reason, proof details, and normalized category tags. Tags are descriptive metadata and do not relax execution policy.

- **Skip** advances without allocating budget.
- **Add** includes the asset when another ticket still fits inside the period limit.
- **Review basket** becomes available after at least one asset is selected.

No funds move during card decisions. The budget rail shows selected count, ticket size, remaining USDG or USDC, cadence, chain, execution provider, and whether execution is demo or live.

## 5. Review and quote refresh

Opening review automatically prepares the basket:

1. The backend regenerates the selected candidates using current live data.
2. It requests fresh exact-input routes from the saved chain/provider: 0x or Uniswap on Robinhood; Jupiter or 0x on Solana.
3. It verifies that selected assets, amounts, period limit, and policy still match.
4. The UI displays wallet stablecoin balance, total input, remainder, estimated and minimum output, price impact, quote lifetime, execution-wallet readiness, and ranking proof.

Changing or removing an asset makes the existing prepared calldata unusable. While the execution is still unsigned, refresh atomically replaces that prepared plan under the previous authorized-plan hash; submitted or terminal executions cannot be replaced. Expired or nearly expired quotes require refresh before signing. A session-not-found response triggers a bounded recovery that opens a new local/demo session and retains still-available selections.

## 6. Live buy signing

Both live paths require one prepared plan and one wallet confirmation.

For Robinhood Chain:

1. The client checks that the prepared plan hash still matches the visible review basket.
2. The client prepares the complete ERC-4337 user operation containing all approval-reset, approval, Permit2, and swap calls.
3. Privy displays one confirmation for the total basket.
4. `sendTransaction({ calls })` submits one operation.
5. The browser reports the single hash to `POST /api/executions/:executionId/submitted` with the atomic-batch marker.
6. The app polls reconciliation until terminal or until the bounded polling window ends.

All live buy calls execute atomically. The backend does not offer sequential EOA submission as a fallback.

For Solana:

1. The server rejects an insufficient USDC balance before provider route construction.
2. Jupiter or 0x instructions are composed into one versioned transaction and simulated as a complete basket.
3. The prepared message commitment, expected balance changes, and visible basket must still match.
4. Privy signs that exact transaction once; the server submits it through the saved provider.
5. The app polls the signature and reconciles each expected output mint before showing settlement.

Unexpected signers, malformed transactions, oversized packets, and unrecovered simulations fail before signing. Provider rate limits and one transient route failure receive bounded retries.

In demo mode, the same review surface calls the demo-settle endpoint and clearly labels the result as simulated.

## 7. Activity and recovery

Activity renders:

- `SUBMITTED` — operation exists but settlement is not yet terminal; the user can check again.
- `SETTLED` — exact Robinhood USDG transfers or expected Solana token-balance deltas were verified.
- `PARTIAL` — supported by the receipt model for non-atomic or legacy records; the current atomic buy path should normally settle or fail as a whole.
- `FAILED` — the operation or its verified outputs failed.

The receipt includes the chain/provider, authorized plan hash, policy hash, ranking output commitment, terminal state, and per-asset output records. Live Robinhood transactions link to Blockscout; Solana signatures link to Solana Explorer.

The last execution ID and selected-card snapshot are stored locally per SwipeFi Wallet so a submitted operation can be reloaded after a browser refresh. This browser persistence is origin-specific.

## 8. Portfolio and exits

Portfolio reads non-zero balances from the Alchemy Portfolio API for the active execution wallet and values them when current price evidence exists. Robinhood keeps assets matched to the supported candidate catalog. Solana can display indexed tokens, while exit preparation remains limited to assets supported by the active provider. Portfolio indexing requires an Alchemy-shaped chain RPC URL.

For one position:

1. **Get exit quote** requests a fresh exact-input route to USDG on Robinhood or USDC on Solana.
2. The UI shows the minimum stablecoin output and a 60-second freshness label.
3. Robinhood **Confirm sell** preflights and submits the position's complete call set through the matching Privy smart wallet.
4. Solana **Confirm sell** signs one prepared versioned transaction, submits it, and polls the exit status until terminal.
5. Solana waits for terminal signature status. Robinhood currently clears the row after the smart-wallet send promise resolves; that acknowledgement is not independent receipt proof.

Robinhood **Exit all positions** prepares all holdings, removes those without a current route, and submits every remaining call in one atomic smart-wallet operation: all submitted exits succeed or none do. The UI treats the resolved send promise as completion, while the production release gate still requires receipt and post-exit balance evidence. Solana intentionally exposes only individual exits.

## 9. Account and funding

Account shows:

- Active execution-wallet address and copy action.
- Connected Robinhood funding-wallet address when present.
- Live USDG or USDC balance.
- Chain, execution provider, feed-ranking provider, cadence, period limit, ticket size, risk mode, and asset classes.
- Save-plan action that invalidates unsigned preparation and regenerates the feed with the updated settings.
- Local developer reset controls when running local-live.

Robinhood top-up sends USDG from the linked external funding wallet to the SwipeFi Wallet. It does not deposit into a server-controlled account. Solana uses the selected wallet directly and does not expose the Robinhood top-up flow.

## Mode differences visible to users

| Surface | Demo | Local live | Production |
|---|---|---|---|
| Privy wallet | Real | Real | Real |
| Feed candidates | Fixtures with market prices | Live candidates for the selected chain/provider | Same |
| Ranking proof | Deterministic or configured 0G | Saved deterministic/0G choice | Saved deterministic/verified-0G choice; 0G is configured |
| Buy signing | Simulated | Real | Real |
| Session persistence | Memory, repeatable | Memory, repeatable | PostgreSQL, cadence-bound |
| Portfolio | Available only when an Alchemy RPC URL is configured | Same | Same |
| Receipt | Explicit demo receipt | Chain-specific live receipt | Chain-specific live receipt |
