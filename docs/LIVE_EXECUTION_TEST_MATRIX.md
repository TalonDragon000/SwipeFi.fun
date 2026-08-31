# Live execution test matrix

Live provider evidence last verified: 2026-08-05 (Europe/Lisbon)

Automated repository gate last verified: 2026-08-06 (Europe/Lisbon)

This matrix separates automated behavior checks, live provider preflight, and
confirmed on-chain settlement. A quote or simulation is not treated as proof
that a purchase settled.

| Area | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| Feed | Solana feed resolves current Jupiter-routable candidates | Browser loaded live cbBTC and PUMP cards from `http://localhost:5173/` | Pass |
| Provider preflight | Robinhood assets are active, healthy, canonical, and exactly quotable | `npm run verify:0x` selected AAPL and TSLA from the live chain-4663 registry | Pass |
| Feed boundary | Robinhood browsing does not spend executable quotes; Review performs the fresh route check | `tests/live-candidates.test.ts` and `tests/api.test.ts` | Pass |
| Jupiter preparation | Two selected legs compile into one versioned Solana transaction | Browser review showed cbBTC + PUMP, `Atomic Solana transaction: Ready`, and one `Sign & invest` action | Pass |
| Jupiter settlement | One signature buys the complete basket and reconciles every output | Requires fresh quote, explicit transaction confirmation, signature, and confirmed RPC receipt | Pending |
| 0x SVM feed | Solana feed retains only exact-size 0x-routable candidates | Browser loaded live cbBTC, PUMP, and TBB cards with 0x selected | Pass |
| 0x SVM preparation | Two selected legs compile and simulate as one versioned Solana transaction | Browser prepared cbBTC + PUMP and showed `Atomic Solana transaction: Ready` after bounded 429 retry | Pass |
| 0x SVM settlement | One signature buys the complete Solana basket and reconciles every output | Requires fresh quote, explicit transaction confirmation, signature, and confirmed RPC receipt | Pending |
| 0x preparation | Two quotes share one allowance spender and form approval + two swaps | `npm run verify:0x`: `twoAssetPreparationPassed: true` and `twoAssetQuoteSimulationPassed: true` | Pass |
| 0x settlement | One smart-account confirmation executes approval + all swaps atomically | Requires browser `prepareUserOperation`, confirmation, receipt, and output reconciliation | Pending |
| Funds | Solana basket is rejected before routing when USDC is insufficient | `tests/api.test.ts`: live-balance guard test; browser also rejected a 1.90 USDC basket against 1.862917 USDC | Pass |
| Funds | 0x execution rejects balance deficiencies while feed browsing remains available | `tests/zero-ex.test.ts`: browsing warnings accepted, execution balance deficiency rejected | Pass |
| Provider rejection | 0x unauthorized leg fails the entire basket without partial calls | `tests/zero-ex.test.ts` and `tests/api.test.ts` | Pass |
| Provider retry | Jupiter retries one transient build rejection | `tests/jupiter.test.ts` | Pass |
| Route retry | Jupiter retries a route-specific simulation failure with a smaller account budget | `tests/jupiter.test.ts` | Pass |
| Rate limit | Jupiter retries a rate-limited route instead of silently dropping a card | `tests/jupiter.test.ts` | Pass |
| Rate limit | 0x SVM retries HTTP 429 and reports temporary provider failure instead of claiming it is unconfigured | `tests/zero-ex-solana.test.ts`; repeated browser preparation succeeded | Pass |
| Oversized basket | Jupiter fails only after the compiled transaction exceeds Solana's packet limit | `tests/jupiter.test.ts` | Pass |
| Invalid transaction | Unexpected Jupiter signer and malformed 0x transaction are rejected | `tests/jupiter.test.ts`, `tests/zero-ex.test.ts` | Pass |
| Stale plan | Changing the basket after preparation blocks signing | `tests/review-safety.test.ts`; server plan-hash conflict coverage in `tests/api.test.ts` | Pass |
| Unsigned refresh | Changing an unsigned basket atomically replaces only its `PREPARED` plan | `tests/api.test.ts` and `tests/store.test.ts` | Pass |
| Atomic approval | 0x approves exactly the basket total, never the Settler address | `tests/zero-ex.test.ts` | Pass |
| Reconciliation | Jupiter validates per-asset token deltas, including native SOL rent handling | `tests/jupiter.test.ts` | Pass |
| Portfolio | Solana and Robinhood Alchemy Portfolio responses retain the intended non-zero holdings | `tests/api.test.ts` | Pass |
| Robinhood exit | One position or all currently routable holdings settle through one smart-wallet call set | Requires funded holdings, explicit Privy confirmation, receipt, and post-exit balance verification | Pending |
| Solana exit | One signed versioned transaction exits one supported holding to USDC and reaches terminal reconciliation | Requires a funded holding, fresh route, explicit signature, confirmed RPC status, and post-exit balance verification | Pending |
| Repository gates | Complete suite and production checks | `npm test`: 24 files / 134 tests; `npm run lint`, `npm run typecheck`, and `npm run build` | Pass |

## Live wallets checked

- Solana mainnet wallet: `ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh`
  had 1.862917 USDC and 0.083460939 SOL at the latest preflight.
- Robinhood Chain smart wallet:
  `0x000000236c4916F5D00F9964AF6c7018cf720000` had 1.000019 USDG and
  0.00035308561063324 native gas token at the latest preflight.

Transaction hashes, confirmed block or slot identifiers, and reconciled output
amounts must be added above before either settlement row can be marked Pass.
