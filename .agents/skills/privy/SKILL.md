---
name: Privy
description: Use when building embedded wallets, authenticating users, managing wallet controls and policies, executing transactions, or integrating wallet infrastructure into applications. Agents should reach for this skill when working with wallet creation, user onboarding, transaction signing, policy enforcement, or wallet management across Ethereum, Solana, Bitcoin, and other blockchains.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill

## Product summary

Privy is a programmable wallet infrastructure platform that enables developers to build secure, non-custodial wallets embedded in applications. It provides authentication (email, social, wallet-based), embedded wallet creation and management, transaction signing and execution, policy controls, and multi-chain support (Ethereum, Solana, Bitcoin, Tempo, and 50+ blockchains).

**Key files and configuration:**
- Dashboard: https://dashboard.privy.io (create apps, configure login methods, manage wallets, set policies)
- App credentials: App ID (public) and App Secret (private) from Configuration > App settings > Basics
- Client SDKs: React, React Native, Swift, Android, Flutter, Unity
- Server SDKs: Node.js, Java, Go, Rust, Ruby
- REST API: Direct HTTP requests to `https://api.privy.io/v1/`

**Primary documentation:** https://docs.privy.io

## When to use

Reach for this skill when:
- Building user onboarding flows with email, social, or wallet login
- Creating embedded wallets for users or applications
- Signing transactions on Ethereum, Solana, or other blockchains
- Enforcing spending limits, transaction policies, or approval workflows
- Managing wallet ownership, signers, and authorization controls
- Handling multi-chain transactions, swaps, or transfers
- Setting up webhooks for wallet events (deposits, withdrawals, transactions)
- Integrating external wallets (MetaMask, Phantom) alongside embedded wallets
- Building treasury, agent, or organization wallets with multi-sig controls
- Implementing gas sponsorship or wallet funding flows

## Quick reference

### SDK initialization

| SDK | Setup |
|-----|-------|
| **React** | Wrap app with `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **React Native** | Wrap app with `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **Node.js** | `new PrivyClient({appId: '...', appSecret: '...'})` |
| **Java** | `PrivyClient` with app ID and secret |
| **Go** | `privy.NewClient(appID, appSecret)` |
| **REST API** | Basic auth with app ID:app secret, include `privy-app-id` header |

### Core API endpoints

| Resource | Endpoint | Purpose |
|----------|----------|---------|
| **Wallets** | `POST /v1/wallets` | Create wallet |
| **Wallets** | `GET /v1/wallets/{id}` | Get wallet details |
| **Wallets** | `GET /v1/wallets` | List wallets |
| **Users** | `POST /v1/users` | Create user |
| **Users** | `GET /v1/users/{id}` | Get user by ID |
| **Policies** | `POST /v1/policies` | Create policy |
| **Policies** | `GET /v1/policies/{id}` | Get policy |
| **Transactions** | `GET /v1/transactions/{id}` | Get transaction status |
| **Webhooks** | Dashboard > Configuration > Webhooks | Register webhook endpoint |

### Common wallet operations

```typescript
// Create embedded wallet (React)
const {createWallet} = useCreateWallet();
await createWallet();

// Create wallet (Node.js)
await privy.wallets().create({
  chain_type: 'ethereum',
  owner: {user_id: 'privy:did:xxxxx'}
});

// Sign transaction (React)
const {sendTransaction} = useEmbeddedWallet();
await sendTransaction({to: '0x...', value: '1000000000000000000'});

// Get wallet balance
await privy.wallets().getBalance({wallet_id: '...'});
```

### Policy rule methods

| Method | Use case |
|--------|----------|
| `eth_sendTransaction` | EVM transfers and contract calls |
| `eth_signTransaction` | Sign EVM transactions |
| `signTransaction` | Solana transaction signing |
| `signAndSendTransaction` | Solana sign and broadcast |
| `personal_sign` | Message signing (EVM) |
| `signMessage` | Message signing (Solana) |
| `transfer` | Wallet action API transfers |
| `earn_deposit` / `earn_withdraw` | Yield protocol interactions |
| `*` | Allow/deny all methods |

## Decision guidance

### When to use embedded vs external wallets

| Scenario | Embedded | External |
|----------|----------|----------|
| New users without wallets | ✓ | ✗ |
| Seamless onboarding | ✓ | ✗ |
| Users bring existing wallets | ✗ | ✓ |
| Power users / crypto-native | ✗ | ✓ |
| Non-custodial requirement | ✓ | ✓ |
| Full app control needed | ✓ | ✗ |

### When to use different wallet ownership models

| Model | Owner | Use case |
|-------|-------|----------|
| User-owned | User | Self-custodial consumer wallets |
| User + server | User + server key | Automated trading, limit orders |
| Application-owned | Authorization key | Treasury, bots, agents |
| Custodial | Licensed custodian | FBO banking-like accounts |

### Authentication: Privy vs your own provider

| Approach | Best for |
|----------|----------|
| **Privy auth** | New apps, multi-method login (email, social, wallet, passkey) |
| **Your JWT provider** | Existing auth system, want to add wallets only |

## Workflow

### 1. Set up your app
- Create app in Privy Dashboard
- Copy App ID and App Secret from Configuration > App settings > Basics
- Configure login methods (email, Google, Discord, wallet, etc.) if using Privy auth
- Set allowed domains and OAuth redirect URIs

### 2. Initialize SDK in your application
- Client-side: Wrap app with `PrivyProvider` (React/React Native) or initialize SDK
- Server-side: Create `PrivyClient` with app ID and secret
- Store credentials in environment variables (never commit secrets)

### 3. Authenticate users
- Use Privy's built-in login UI or implement custom auth flow
- Verify user JWT tokens on your backend
- Retrieve authenticated user object with linked accounts

### 4. Create wallets
- Automatically on login (set `createOnLogin: 'users-without-wallets'`)
- Or manually via `createWallet()` hook or API
- Specify owner (user ID for user wallets, authorization key for app-owned)
- Optionally attach policies and signers at creation

### 5. Configure policies (if needed)
- Define rules for each RPC method (eth_sendTransaction, signTransaction, etc.)
- Set conditions: spending limits, allowlisted addresses, contract interactions
- Attach policy to wallet at creation or update wallet later
- Test policy evaluation before production

### 6. Execute transactions
- Client-side: Use wallet hooks (`useEmbeddedWallet`, `useSignMessage`)
- Server-side: Call wallet signing methods with authorization signatures
- Include required headers: `privy-authorization-signature`, `privy-request-expiry`
- Handle policy violations and insufficient funds errors

### 7. Monitor with webhooks
- Register webhook endpoint in Dashboard > Configuration > Webhooks
- Verify webhook signatures using SDK or manual verification
- Listen for user events (created, authenticated), wallet events (funds_deposited), transaction events (confirmed, failed)
- Return 2xx status to acknowledge receipt; Privy retries on failure

## Common gotchas

- **Missing app client ID**: If deploying across multiple domains, create app clients in Dashboard and pass `clientId` to PrivyProvider
- **Policy blocks all requests by default**: If a wallet has a policy, you must explicitly allow each RPC method or it will be denied. Use `"method": "*"` with `ALLOW` action as fallback
- **Authorization signatures required for server wallets**: Server-side wallet operations need proper signing with `privy-authorization-signature` header; use `AuthorizationContext` in Node.js SDK to automate this
- **User session keys expire**: User signing keys are time-bound; request fresh keys regularly or use SDK's `AuthorizationContext` for automatic refresh
- **Webhook endpoint must return 2xx**: Any non-2xx response (including 3xx redirects) counts as failure; endpoint disabled after 5 days of failures
- **Idempotency keys prevent duplicates**: Use `idempotency_key` on wallet creation and transaction requests to safely retry without creating duplicates
- **Policy evaluation is in-enclave**: Policies are evaluated in secure execution environments; you cannot inspect policy logic from outside
- **External IDs are write-once**: Set `external_id` at wallet creation; cannot be changed after
- **Rate limits apply**: Implement exponential backoff for 429 responses; batch requests where possible
- **Solana policies evaluate all instructions**: Every instruction in a Solana transaction must satisfy policy rules or entire transaction is denied
- **Gas sponsorship credits deplete**: Monitor gas credits in Dashboard > Billing > Gas Sponsorship; enable automated refill

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and App Secret are stored in environment variables, not hardcoded
- [ ] PrivyProvider wraps the entire app (or at least all components using Privy)
- [ ] `ready` flag from `usePrivy()` is checked before consuming Privy state
- [ ] Wallet policies (if used) explicitly allow all RPC methods the app needs
- [ ] Authorization signatures are properly signed and included in server-side requests
- [ ] Webhook endpoint returns 2xx status and verifies payload signature
- [ ] Idempotency keys are used for wallet creation and transaction requests
- [ ] Error handling covers policy violations, insufficient funds, and authorization failures
- [ ] External wallet connectors are configured if supporting MetaMask, Phantom, etc.
- [ ] Gas sponsorship credits are monitored if using gas sponsorship
- [ ] Tested across all configured login methods and wallet types

## Resources

**Comprehensive documentation:** https://docs.privy.io/llms.txt (page-by-page navigation for all topics)

**Critical reference pages:**
- [Key concepts](https://docs.privy.io/basics/key-concepts) — Authentication, wallets, controls, and ownership models
- [API reference introduction](https://docs.privy.io/api-reference/introduction) — REST API setup and rate limits
- [Policies overview](https://docs.privy.io/controls/policies/overview) — Policy rules, conditions, and evaluation

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt