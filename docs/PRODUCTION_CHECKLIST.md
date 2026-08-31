# Production release checklist

This checklist matches the current multi-chain atomic-buy, exit, and PostgreSQL production paths. A passing automated gate or provider simulation is not live-settlement evidence; record that separately in [LIVE_EXECUTION_TEST_MATRIX.md](./LIVE_EXECUTION_TEST_MATRIX.md).

## Automated gate

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] Database migration succeeds against both a clean database and an existing database.
- [ ] `/api/health` reports `mode: "live"`; `/api/config` reports Robinhood chain `4663`, the intended Solana availability, and no server secrets.

## Deployment configuration

- [ ] `NODE_ENV=production`
- [ ] `INVESTMADE_DEMO_MODE=false`
- [ ] `LOCAL_LIVE_EXECUTION=false`
- [ ] `DATABASE_URL`, `COINGECKO_API_KEY`, `ZG_ROUTER_API_KEY`, Privy credentials, a production session secret, and at least one Robinhood execution-provider key are present in the deployment secret store.
- [ ] Dedicated Robinhood Chain RPC is configured; use an Alchemy URL when the Robinhood portfolio index is enabled.
- [ ] When Solana is enabled, `JUPITER_API_KEY`, `SOLANA_RPC_URL`, and `SOLANA_WS_URL` are configured; use Alchemy endpoints when the Solana portfolio index is enabled.
- [ ] 0x is exposed as a Solana execution option only when both the Solana stack and `ZERO_EX_API_KEY` are configured.
- [ ] Production and preview origins are allowed by Privy and CSP.
- [ ] CoinGecko batch prices and chart history are configured with honest reference-price labels.

## Identity and wallet

- [ ] Privy email and supported external-wallet login flows succeed on the production origin.
- [ ] A new Robinhood user receives an embedded signer and canonical SwipeFi smart-wallet address.
- [ ] A new Solana user can select or create a Solana wallet, and the API rejects a wallet/chain pair not owned by that Privy user.
- [ ] Smart wallets are enabled for all users in Privy.
- [ ] Robinhood Chain `4663` has working bundler/paymaster configuration.
- [ ] Missing, expired, malformed, or wrong-app Privy access tokens fail.
- [ ] A valid token paired with a smart-wallet address not owned by that Privy user fails.
- [ ] An external wallet can fund the SwipeFi Wallet but cannot replace it as the atomic-buy executor.
- [ ] The selected Solana wallet remains both the funding and execution wallet; Robinhood top-up controls are not shown for Solana.
- [ ] Logout returns the UI to onboarding and clears active in-memory product state.

## Candidate discovery and ranking

- [ ] The browsable Robinhood feed keeps only CoinGecko-listed assets with safe icons and does not request executable provider quotes for every card.
- [ ] WETH and at least one stock token appear in the ranking pool with canonical identity and CoinGecko market data.
- [ ] Review preparation for a selected stock token rechecks deployed code, active registry/deployment, non-halted price, oracle pause, wallet permission, and fresh executable liquidity.
- [ ] Stale stock price evidence fails during production execution preparation.
- [ ] A provider-discovered Robinhood contract ID and Solana mint ID can be re-resolved after a provider/cache restart without accepting a malformed identity.
- [ ] An excluded or already-seen asset does not return in the next feed page.
- [ ] Community assets appear only for Degen risk mode.
- [ ] Missing CoinGecko identity or icon excludes a Robinhood live card; missing contract code, inactive deployment, halted market, paused oracle, denied permission, or missing route excludes execution preparation.
- [ ] Deterministic ranking alternates crypto and stock tokens when both groups are available and remains stable for the same committed input.
- [ ] 0G catalog/model preflight passes.
- [ ] 0G response reports `tee_verified: true`.
- [ ] The stored requested ranking provider matches the effective provider; missing/false TEE verification, malformed output, invented asset, duplicate asset, commitment mismatch, and over-budget output fail closed.

## Onboarding and feed UX

- [ ] All five questions validate their current ranges.
- [ ] Robinhood/Solana selection sets the expected stablecoin, wallet flow, initial execution provider, and initial ranking provider.
- [ ] Ticket size cannot exceed the period limit.
- [ ] Disclosure acknowledgement is required.
- [ ] Saved preferences resume for the same Privy user and can be reset with **Change my answers**.
- [ ] Basket Add disables when another ticket would exceed the period limit.
- [ ] Feed pagination preserves selected cards and does not duplicate assets.
- [ ] Changing execution or ranking provider invalidates unsigned prepared executions and opens a matching new feed/session boundary.
- [ ] Demo, local-live, and production labels accurately describe the active mode.

## Atomic buy — Robinhood Chain

- [ ] Review automatically refreshes selected candidates and quotes.
- [ ] Removing an asset invalidates prepared calldata.
- [ ] Near-expiry and expired quotes require refresh.
- [ ] Every returned call has the expected chain, sender, target, value, and non-empty calldata.
- [ ] Prepared authorized-plan hash matches the visible basket.
- [ ] Full approval/Permit2/swap call order passes `prepareUserOperation`.
- [ ] The user sees one Privy confirmation for the complete basket.
- [ ] Server rejects submitted buys without `batched: true`.
- [ ] A deliberately reverting leg reverts the complete basket.
- [ ] A second, different basket in the same production cadence epoch is rejected or recovers to the existing terminal receipt.
- [ ] One small USDG → WETH atomic basket reaches terminal settlement.
- [ ] One stock-token atomic basket reaches terminal settlement.

## Atomic buy — Solana

- [ ] Review rejects insufficient USDC before requesting execution candidates or building routes.
- [ ] Jupiter and 0x provider selection persists with the session and cannot change under a prepared basket.
- [ ] Every selected mint receives a fresh exact-input route; one rejected leg prevents partial preparation.
- [ ] The composed versioned transaction contains only expected account keys and the selected wallet as the only required signer.
- [ ] The complete transaction simulates, fits the Solana packet limit, and is bound to the prepared message commitment.
- [ ] A stale or different signed message is rejected.
- [ ] The user sees one Privy confirmation and the server submits one signature for the complete basket.
- [ ] Jupiter and 0x rate limits receive only bounded retries; insufficient funds remain a distinct terminal preparation error.
- [ ] A deliberately failing leg prevents the complete transaction from settling.
- [ ] One small Jupiter USDC basket reaches terminal settlement and reconciles every output mint.
- [ ] One small 0x Solana USDC basket reaches terminal settlement and reconciles every output mint.

## Reconciliation and Activity

- [ ] `SUBMITTED` is displayed as pending, never settled.
- [ ] Refresh/reopen restores the last execution and selected-card snapshot for the same browser origin.
- [ ] Robinhood verifies exact total USDG spend and output transfers from receipt logs.
- [ ] Solana verifies signature state and every expected token-balance delta, including native SOL rent handling.
- [ ] Every successful leg has an output amount meeting its minimum.
- [ ] Missing output transfer fails reconciliation.
- [ ] Reverted atomic operation is displayed as failed, not partial or settled.
- [ ] Blockscout or Solana Explorer link resolves to the stored chain-specific hash/signature.
- [ ] Activity remains honest when the local card snapshot is unavailable.

## Portfolio and exits

- [ ] Robinhood and Solana portfolio endpoints paginate the Alchemy Portfolio API and return non-zero balances without exposing the RPC key.
- [ ] Robinhood filters indexed balances to supported candidate assets; Solana labels indexed assets even when an exit route is unavailable.
- [ ] Price/history sources are labeled accurately and unavailable data is not presented as live history.
- [ ] Per-position exit uses a fresh reverse quote and shows minimum USDG or USDC output.
- [ ] A Robinhood single-position exit preflights and submits one smart-wallet call set.
- [ ] Robinhood **Exit all positions** excludes unroutable holdings before signing, then submits all remaining calls atomically in one smart-wallet operation.
- [ ] A reverting Robinhood exit leg reverts every submitted exit in the combined operation.
- [ ] A Solana exit signs one prepared versioned transaction and remains pending until its signature status is terminal.
- [ ] Multi-position Solana exit remains unavailable unless it receives its own atomic design and tests.
- [ ] Buy-session state never blocks preparation of a supported exit.

## Operations and privacy

- [ ] HTTPS, CSP, rate limiting, request-size limits, and proxy trust are verified.
- [ ] Privy, WalletConnect, Robinhood RPC, Solana RPC/WebSocket, 0x, Jupiter, Alchemy Portfolio, and 0G flows pass without CSP violations.
- [ ] `ZERO_EX_VERIFY_WALLET` and `ZERO_EX_VERIFY_TX_ORIGIN` identify the same Privy user's smart wallet and embedded owner, and `npm run verify:0x` reports `routeReadinessPassed: true`.
- [ ] A funded two-asset basket passes the browser's Privy `prepareUserOperation` preflight before any live-readiness claim.
- [ ] A funded Solana two-asset basket passes the complete transaction simulation and Privy signing preview before any live-readiness claim.
- [ ] Request-body/APM capture is disabled for auth, 0G, and execution routes.
- [ ] Database backup and restore drill passes.
- [ ] Metrics cover provider latency/error rate, candidate rejection reasons, prepared/submitted/terminal counts, and reconciliation backlog without sensitive payloads.
- [ ] Alerts cover Privy auth failures, quote outage, 0G verification failure, failed atomic operations, and reconciliation backlog.
- [ ] Key rotation, incident response, and rollback have named owners.
- [ ] Product disclosures and tokenized-stock legal/permission boundaries receive legal review.

## Stop conditions

Do not launch when:

- production reports demo or local-live mode;
- a request for 0G silently falls back to local ranking;
- the stored requested ranking provider differs from the effective provider;
- a selected stock route bypasses registry, market, oracle, permission, or quote checks;
- a Solana transaction introduces an unexpected signer, diverges from its message commitment, or skips output-delta reconciliation;
- the reviewed basket can diverge from the prepared plan;
- a live buy can submit sequentially instead of atomically;
- a hash or HTTP acknowledgement is shown as settlement;
- Robinhood **Exit all positions** can partially submit its prepared call set;
- Solana individual exits are described as a multi-position atomic exit.
