# Uniswap Trading API feedback

## Integration

SwipeFi.fun uses `/permissions`, `/check_approval`, `/quote`, and `/swap` to turn fixed USDG
allocations into wallet-ready crypto and tokenized-stock trades on Robinhood Chain. The user signs
the resulting approval, Permit2, and swap calls through a non-custodial ERC-4337 wallet.

## What worked well

- The same exact-input API flow returned `CLASSIC` routes for WETH, AAPL, and TSLA on chain 4663.
- `/permissions` exposed per-token transfer restrictions before quote and execution.
- Wallet-ready transaction objects let us keep execution non-custodial.

## Friction

- Building a multi-asset feed requires many quote requests. Responses can be slow, and parallel
  requests can receive `429`, so we added bounded concurrency, retries, and caching.
- Stock-token metadata does not include consistent image URLs, so we maintain the images ourselves.
- There is no basket endpoint for our use case. We request each route separately, then assemble and
  simulate one ERC-4337 smart-wallet operation.
- The API does not provide historical prices for Robinhood Chain stock tokens. We built a The Graph
  Substreams package to derive price history from Uniswap v4 events.

## Requested improvements

1. Bulk quotes for several output tokens.
2. A basket endpoint returning coordinated approvals, Permit2 calls, and swaps.
3. Canonical image URLs for supported stock tokens.
4. An official historical-price endpoint or recommended Substreams package.
