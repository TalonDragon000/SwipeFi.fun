# Security policy

## Supported configuration

Only the latest `main` revision is supported. Production must run with `INVESTMADE_DEMO_MODE=false`, HTTPS, a private database, dedicated RPC, and secrets supplied by the deployment platform.

## Non-custodial boundary

SwipeFi.fun has no server signing key and cannot broadcast a buy on behalf of a user.

Privy access tokens are verified by the backend for live requests, and the requested EVM address
must be present in the authenticated user's verified linked accounts. `PRIVY_APP_SECRET`,
`UNISWAP_API_KEY`, and all other provider credentials are server-only deployment secrets.

## Required controls

- Keep `.env`, `.env.local`, API keys, and database credentials outside Git.
- Rotate any credential accidentally printed, committed, or shared through an insecure channel.
- Terminate TLS at the ingress and preserve secure, `SameSite=Strict`, HTTP-only cookies.
- Restrict database and RPC network access.
- Run `npm audit --omit=dev`, the full CI suite, and the production checklist before release.
- Do not log request bodies for auth, 0G, or execution routes.
- Never reuse a Permit2 signature or calldata after a quote refresh.
- Keep stock cards disabled unless Robinhood registry/market/oracle checks, wallet permission, and a live exact-size quote pass.
- Treat the current atomic buy as all-or-nothing. Preserve `PARTIAL` only for legacy/non-atomic records and never relabel `PARTIAL` or `FAILED` as settled.
- Treat “Exit all” as sequential wallet execution, not an atomic basket; stop and report honestly after the first failed call.

## Reporting

Do not open a public issue for a vulnerability involving funds, authentication, secrets, or private user data. Contact the repository owner privately with reproduction steps and impact.
