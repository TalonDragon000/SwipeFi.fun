import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ASSET_REGISTRY } from "../src/domain/constants.js";
import {
	fillFeedPage,
	nextFeedExcludedAssetIds,
	shouldPrefetchNextFeed,
} from "../src/domain/feed-pagination.js";
import type {
	ExecutionPlan,
	OnboardingPreferences,
} from "../src/domain/schemas.js";
import { SOLANA_USDC_MINT } from "../src/domain/solana.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import type { CandidateProvider } from "../src/server/adapters/types.js";
import { type AppDependencies, createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { MemoryStateStore } from "../src/server/store.js";

function testApp(
	history?: AppDependencies["history"],
	marketData?: AppDependencies["marketData"],
) {
	const provider = new DemoProvider();
	return createApp({
		config: loadConfig({
			NODE_ENV: "test",
			INVESTMADE_DEMO_MODE: "true",
			PUBLIC_ORIGIN: "http://localhost:5173",
			SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
			PRIVY_APP_ID: "test-privy-app-id",
			PRIVY_APP_SECRET: "test-privy-app-secret",
		}),
		store: new MemoryStateStore(),
		candidates: provider,
		inference: provider,
		execution: provider,
		history,
		marketData,
	});
}

function testLocalLiveApp(marketData?: AppDependencies["marketData"]) {
	const provider = new DemoProvider();
	return createApp({
		config: loadConfig({
			NODE_ENV: "test",
			INVESTMADE_DEMO_MODE: "true",
			LOCAL_LIVE_EXECUTION: "true",
			PUBLIC_ORIGIN: "http://localhost:5173",
			SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
			PRIVY_APP_ID: "test-privy-app-id",
			PRIVY_APP_SECRET: "test-privy-app-secret",
			ZERO_EX_API_KEY: "test-0x-key",
		}),
		store: new MemoryStateStore(),
		candidates: provider,
		inference: provider,
		execution: provider,
		marketData,
	});
}

function providerPreferenceApp(
	options: {
		uniswapConfigured?: boolean;
		includeUniswapAdapter?: boolean;
	} = {},
) {
	const store = new MemoryStateStore();
	const zeroEx = new DemoProvider("ZERO_EX");
	const uniswap = new DemoProvider("UNISWAP");
	const uniswapFeedCalls: string[][] = [];
	const uniswapCandidates: CandidateProvider = {
		getRankingCandidates: (...args) => uniswap.getRankingCandidates(...args),
		async getCandidatesForFeed(wallet, assetIds, ...rest) {
			uniswapFeedCalls.push(assetIds);
			return uniswap.getCandidatesForFeed(wallet, assetIds, ...rest);
		},
		getCandidates: (...args) => uniswap.getCandidates(...args),
		getCandidatesForExecution: (...args) =>
			uniswap.getCandidatesForExecution(...args),
	};
	const includeUniswap = options.includeUniswapAdapter ?? true;
	const app = createApp({
		config: loadConfig({
			NODE_ENV: "test",
			INVESTMADE_DEMO_MODE: "true",
			LOCAL_LIVE_EXECUTION: "true",
			PUBLIC_ORIGIN: "http://localhost:5173",
			SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
			PRIVY_APP_ID: "test-privy-app-id",
			PRIVY_APP_SECRET: "test-privy-app-secret",
			ZERO_EX_API_KEY: "server-zero-ex-secret",
			...(options.uniswapConfigured === false
				? {}
				: { UNISWAP_API_KEY: "server-uniswap-secret" }),
		}),
		store,
		candidates: zeroEx,
		candidateProviders: {
			ZERO_EX: zeroEx,
			...(includeUniswap ? { UNISWAP: uniswapCandidates } : {}),
		},
		inference: zeroEx,
		execution: zeroEx,
		executionProviders: {
			ZERO_EX: zeroEx,
			...(includeUniswap ? { UNISWAP: uniswap } : {}),
		},
		auth: {
			actor: async () => ({
				wallet: "0x71f30000000000000000000000000000000009a2",
				txOrigin: "0x71f30000000000000000000000000000000009a3",
			}),
		},
	});
	return { app, store, zeroEx, uniswapFeedCalls };
}

const authenticated = { Authorization: "Bearer test-privy-token" };

const onboardingPreferences = {
	activeChain: "ROBINHOOD",
	cadence: "weekly",
	ticketSizeUsd: 10,
	riskMode: "balanced",
	assetClasses: ["CRYPTO", "STOCK_TOKEN"],
	riskDisclosureAccepted: true,
	executionProvider: "ZERO_EX",
	feedRankingProvider: "ZERO_G",
} satisfies OnboardingPreferences;

describe("core API flow", () => {
	it("binds Solana preferences to the authenticated wallet", async () => {
		const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
		const provider = new DemoProvider("JUPITER");
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "false",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				DATABASE_URL: "postgres://test:test@localhost/test",
				COINGECKO_API_KEY: "test-coingecko-key",
				ZG_ROUTER_API_KEY: "test-0g-key",
				UNISWAP_API_KEY: "test-uniswap-key",
				JUPITER_API_KEY: "test-jupiter-key",
				SOLANA_RPC_URL: "https://solana.example.test",
				SOLANA_WS_URL: "wss://solana.example.test",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			solanaExecutionProviders: { JUPITER: provider },
			auth: {
				actor: async () => ({ wallet, txOrigin: wallet, chain: "SOLANA" }),
			},
		});

		await request(app)
			.post("/api/preferences")
			.set(authenticated)
			.send({
				...onboardingPreferences,
				activeChain: "SOLANA",
				executionProvider: "JUPITER",
				solanaExecutionWallet: "So11111111111111111111111111111111111111112",
			})
			.expect(200)
			.expect(({ body }) => expect(body.solanaExecutionWallet).toBe(wallet));
	});

	it("does not expose unexpected database errors to the client", async () => {
		class FailingPreferencesStore extends MemoryStateStore {
			override async setPreferences(): Promise<OnboardingPreferences> {
				throw new Error(
					'new row for relation "user_preferences" violates check constraint "user_preferences_wallet_check"',
				);
			}
		}
		const provider = new DemoProvider();
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new FailingPreferencesStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			auth: {
				actor: async () => ({
					wallet: "0x71f30000000000000000000000000000000009a2",
					txOrigin: "0x71f30000000000000000000000000000000009a3",
				}),
			},
		});

		try {
			await request(app)
				.post("/api/preferences")
				.set(authenticated)
				.send(onboardingPreferences)
				.expect(500)
				.expect(({ body }) => {
					expect(body).toEqual({
						error: "REQUEST_FAILED",
						message: "The request could not be completed. Please try again.",
					});
					expect(JSON.stringify(body)).not.toContain("user_preferences");
				});
			expect(errorLog).toHaveBeenCalledWith(
				expect.stringContaining('"event":"request_failed"'),
			);
		} finally {
			errorLog.mockRestore();
		}
	});

	it("reconciles independently submitted Solana legs as partial", async () => {
		const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
		const store = new MemoryStateStore();
		const session = await store.openSession(
			wallet,
			"2026-W32",
			"JUPITER",
			"SOLANA",
		);
		const mints = [
			"So11111111111111111111111111111111111111112",
			"JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
		] as const;
		const assetIds = mints.map((mint) => `sol:mainnet:${mint}`);
		const solanaTransactions = mints.map((mint, index) => ({
			kind: "SOLANA_TRANSACTION" as const,
			unsignedTransactionBase64: `unsigned-${index}`,
			messageCommitment:
				`sha256:${String(index + 1).repeat(64)}` as `sha256:${string}`,
			recentBlockhash: "11111111111111111111111111111111",
			lastValidBlockHeight: 500,
			expectedBalanceChanges: [
				{
					assetId: assetIds[index] ?? "",
					mint,
					minimumAmountOut: "1",
				},
			],
		}));
		const plan: ExecutionPlan = {
			executionId: "solana-per-leg-execution",
			sessionId: session.id,
			epochId: session.epochId,
			provider: "JUPITER",
			chain: "SOLANA",
			cluster: "mainnet-beta",
			inputToken: SOLANA_USDC_MINT,
			signingWallet: wallet,
			totalInputBaseUnits: "2000000",
			authorizedPlanHash: `sha256:${"a".repeat(64)}`,
			policyHash: `sha256:${"b".repeat(64)}`,
			callCommitments: [],
			quotes: mints.map((mint, index) => ({
				requestId: `quote-${index}`,
				assetId: assetIds[index] ?? "",
				tokenOut: mint,
				amountInBaseUnits: "1000000",
				estimatedAmountOut: "2",
				minimumAmountOut: "1",
				unitPriceUsd: "1000000",
				priceImpactBps: 1,
				routing: "JUPITER" as const,
				provider: "JUPITER" as const,
				chain: "SOLANA" as const,
				quotedAt: "2026-08-07T12:00:00.000Z",
				expiresAt: "2026-08-07T12:01:00.000Z",
			})),
			solanaTransactions,
			generatedAt: "2026-08-07T12:00:00.000Z",
		};
		await store.reserveExecution(session.id, plan);
		const provider = Object.assign(new DemoProvider("JUPITER"), {
			async submitSignedTransaction(_prepared: unknown, signed: string) {
				if (signed === "reject") throw new Error("preflight failed");
				return "signature-one";
			},
			async transactionStatus() {
				return { state: "CONFIRMED" as const, slot: 123 };
			},
			async reconcileOutputs(
				signature: string,
				_wallet: string,
				expected: (typeof solanaTransactions)[number]["expectedBalanceChanges"],
			) {
				return expected.map((change) => ({
					assetId: change.assetId,
					amountOutBaseUnits: "2",
					transactionHash: signature,
					blockNumber: "123",
					status: "success" as const,
				}));
			},
		});
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				LOCAL_LIVE_EXECUTION: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				ZERO_EX_API_KEY: "test-0x-key",
				JUPITER_API_KEY: "test-jupiter-key",
				SOLANA_RPC_URL: "https://solana.example.test",
				SOLANA_WS_URL: "wss://solana.example.test",
			}),
			store,
			candidates: provider,
			inference: provider,
			execution: provider,
			solanaExecutionProviders: { JUPITER: provider },
			auth: {
				actor: async () => ({ wallet, txOrigin: wallet, chain: "SOLANA" }),
			},
		});

		const submitted = await request(app)
			.post(`/api/executions/${plan.executionId}/submitted`)
			.set(authenticated)
			.send({ signedTransactions: ["signed-one", "reject"] })
			.expect(200);
		expect(submitted.body).toMatchObject({
			status: "SUBMITTED",
			submissionMode: "SEQUENTIAL",
			transactionHashes: ["signature-one", ""],
		});

		const reconciled = await request(app)
			.post(`/api/executions/${plan.executionId}/reconcile`)
			.set(authenticated)
			.expect(200);
		expect(reconciled.body.status).toBe("PARTIAL");
		expect(
			reconciled.body.settledOutputs.map(
				(output: { status: string }) => output.status,
			),
		).toEqual(["success", "failed"]);
	});

	it("rejects a Solana basket before routing when USDC is insufficient", async () => {
		const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
		const store = new MemoryStateStore();
		const provider = new DemoProvider("JUPITER");
		let candidatesRequested = false;
		const candidateProvider = Object.assign(provider, {
			async getCandidatesForExecution() {
				candidatesRequested = true;
				return [];
			},
		});
		await store.setPreferences(wallet, {
			activeChain: "SOLANA",
			cadence: "weekly",
			ticketSizeUsd: 0.1,
			riskMode: "balanced",
			assetClasses: ["CRYPTO"],
			riskDisclosureAccepted: true,
			executionProvider: "JUPITER",
			feedRankingProvider: "ZERO_G",
		});
		const session = await store.openSession(
			wallet,
			"2026-W32",
			"JUPITER",
			"SOLANA",
		);
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				LOCAL_LIVE_EXECUTION: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				ZERO_EX_API_KEY: "test-0x-key",
				JUPITER_API_KEY: "test-jupiter-key",
				SOLANA_RPC_URL: "https://solana.example.test",
				SOLANA_WS_URL: "wss://solana.example.test",
			}),
			store,
			candidates: candidateProvider,
			solanaCandidateProviders: { JUPITER: candidateProvider },
			inference: provider,
			execution: provider,
			solanaExecutionProviders: { JUPITER: provider },
			auth: {
				actor: async () => ({ wallet, txOrigin: wallet, chain: "SOLANA" }),
			},
			fetcher: async () =>
				Response.json({
					jsonrpc: "2.0",
					result: {
						value: [
							{
								account: {
									data: {
										parsed: {
											info: { tokenAmount: { amount: "300000" } },
										},
									},
								},
							},
						],
					},
				}),
		});

		await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: session.id,
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				periodLimitUsd: 100,
				selections: Array.from({ length: 5 }, (_, index) => ({
					assetId: `sol:mainnet:asset-${index}`,
					amountInBaseUnits: "100000",
				})),
				slippageBps: 50,
			})
			.expect(422)
			.expect(({ body }) =>
				expect(body).toEqual({
					error: "INSUFFICIENT_FUNDS",
					message: "Basket requires 0.5 USDC, but this wallet has 0.3 USDC.",
				}),
			);
		expect(candidatesRequested).toBe(false);
	});

	it("returns SOL and USDC balances from the configured server-side Solana RPC", async () => {
		const provider = new DemoProvider();
		const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				SOLANA_RPC_URL: "https://solana.example.test",
				SOLANA_WS_URL: "wss://solana.example.test",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as { method: string };
				return Response.json({
					jsonrpc: "2.0",
					result:
						body.method === "getBalance"
							? { value: 100_001_000 }
							: {
									value: [
										{
											account: {
												data: {
													parsed: {
														info: { tokenAmount: { amount: "2000000" } },
													},
												},
											},
										},
									],
								},
				});
			},
		});

		const response = await request(app)
			.get(`/api/balances/${wallet}/solana`)
			.expect(200);

		expect(response.body).toMatchObject({
			cluster: "mainnet-beta",
			address: wallet,
			solBalanceLamports: "100001000",
			usdcBalanceBaseUnits: "2000000",
			usdcDecimals: 6,
		});
	});

	it("returns the complete non-zero Solana portfolio from Alchemy", async () => {
		const provider = new DemoProvider();
		const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				SOLANA_RPC_URL: "https://solana-mainnet.g.alchemy.com/v2/test-key",
				SOLANA_WS_URL: "wss://solana-mainnet.g.alchemy.com/v2/test-key",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			fetcher: async () =>
				Response.json({
					data: {
						tokens: [
							{
								tokenAddress: null,
								tokenBalance: "0x3b9aca00",
								tokenMetadata: {},
								tokenPrices: [{ currency: "usd", value: "100" }],
							},
							{
								tokenAddress: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
								tokenBalance: "0x0f4240",
								tokenMetadata: {
									decimals: 9,
									name: "HYPE",
									symbol: "HYPE",
									logo: "https://example.com/hype.png",
								},
								tokenPrices: [],
							},
							{
								tokenAddress: "11111111111111111111111111111111",
								tokenBalance: "0x0",
								tokenMetadata: { decimals: 0, name: "Empty", symbol: "EMPTY" },
							},
						],
					},
				}),
		});

		const response = await request(app)
			.get(`/api/portfolio/${wallet}/solana`)
			.expect(200);

		expect(response.body.tokens).toHaveLength(2);
		expect(response.body.tokens).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assetId: "sol:mainnet:SOL",
					symbol: "SOL",
					balanceBaseUnits: "1000000000",
					priceUsd: 100,
				}),
				expect.objectContaining({
					assetId: "sol:mainnet:98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
					symbol: "HYPE",
					balanceBaseUnits: "1000000",
				}),
			]),
		);
	});

	it("returns supported Robinhood holdings from Alchemy", async () => {
		const provider = new DemoProvider();
		const wallet = "0x71f30000000000000000000000000000000009a2";
		let requestedUrl = "";
		let requestedBody: Record<string, unknown> = {};
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
				ROBINHOOD_RPC_URL:
					"https://robinhood-mainnet.g.alchemy.com/v2/test-key",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			fetcher: async (input, init) => {
				requestedUrl = String(input);
				requestedBody = JSON.parse(String(init?.body));
				return Response.json({
					data: {
						tokens: [
							{
								tokenAddress: ASSET_REGISTRY.GME?.address,
								tokenBalance: "0x0de0b6b3a7640000",
								tokenMetadata: { logo: "https://example.com/gme.png" },
								tokenPrices: [{ currency: "usd", value: "25" }],
							},
							{
								tokenAddress: "0x0000000000000000000000000000000000000001",
								tokenBalance: "0x1",
							},
						],
					},
				});
			},
		});

		const response = await request(app)
			.get(`/api/portfolio/${wallet}/robinhood`)
			.expect(200);

		expect(requestedUrl).toContain("/assets/tokens/balances/by-address");
		expect(requestedBody).toMatchObject({
			addresses: [{ address: wallet, networks: ["robinhood-mainnet"] }],
			includeNativeTokens: false,
			includeErc20Tokens: true,
		});
		expect(response.body).toMatchObject({
			chainId: 4663,
			address: wallet,
			tokens: [
				{
					assetId: "rh:4663:GME",
					symbol: "GME",
					balanceBaseUnits: "1000000000000000000",
					priceUsd: 25,
					iconUrl: "https://example.com/gme.png",
				},
			],
		});
	});

	it("prefetches one feed page ahead", () => {
		expect(shouldPrefetchNextFeed(0, 10)).toBe(true);
		expect(shouldPrefetchNextFeed(0, 20)).toBe(false);
		expect(shouldPrefetchNextFeed(10, 20)).toBe(true);
		expect(shouldPrefetchNextFeed(20, 30)).toBe(true);
	});

	it("allows anonymous local feed previews but keeps execution wallet-gated", async () => {
		const app = testLocalLiveApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(401);
	});

	it("keeps only CoinGecko-listed Robinhood assets with logos in the live feed", async () => {
		const app = testLocalLiveApp({
			enrichRankingCandidates: async (candidates) =>
				candidates.map((candidate, index) =>
					index === 0
						? {
								...candidate,
								coingeckoId: "listed-token",
								iconUrl: "https://assets.coingecko.com/listed.png",
							}
						: candidate,
				),
			history: async () => ({ source: "coingecko", points: [] }),
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);

		expect(feed.body.candidates).toEqual([
			expect.objectContaining({
				coingeckoId: "listed-token",
				iconUrl: "https://assets.coingecko.com/listed.png",
			}),
		]);
	});

	it("exposes only safe icon URLs, never the CoinGecko API key", async () => {
		const response = await request(testApp())
			.get("/api/assets/icons")
			.expect(200);
		expect(response.body).toEqual({ icons: {} });
	});

	it("exposes provider availability without leaking API keys", async () => {
		const response = await request(testApp()).get("/api/config").expect(200);
		expect(response.body.executionProviders).toEqual({
			ZERO_EX: { available: true },
			UNISWAP: { available: true },
			JUPITER: { available: false },
		});
		expect(JSON.stringify(response.body)).not.toContain("server-secret");
		expect(JSON.stringify(response.body)).not.toContain("test-0x-key");
	});

	it("persists the authenticated provider preference and uses it for the next feed", async () => {
		const { app, uniswapFeedCalls } = providerPreferenceApp();
		const preferences = {
			...onboardingPreferences,
			executionProvider: "UNISWAP",
		};
		await request(app)
			.post("/api/preferences")
			.set(authenticated)
			.send(preferences)
			.expect(200);
		const stored = await request(app)
			.get("/api/preferences")
			.set(authenticated)
			.expect(200);
		expect(stored.body.executionProvider).toBe("UNISWAP");

		const opened = await request(app)
			.post("/api/sessions/open")
			.set(authenticated)
			.send({ cadence: "weekly" })
			.expect(200);
		expect(opened.body.executionProvider).toBe("UNISWAP");
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.set(authenticated)
			.send(preferences)
			.expect(200);
		expect(feed.body.candidates).not.toHaveLength(0);
		expect(uniswapFeedCalls).toHaveLength(1);
	});

	it("rejects an unavailable provider and never falls back to another adapter", async () => {
		const unavailable = providerPreferenceApp({ uniswapConfigured: false });
		await request(unavailable.app)
			.post("/api/preferences")
			.set(authenticated)
			.send({ ...onboardingPreferences, executionProvider: "UNISWAP" })
			.expect(422)
			.expect(({ body }) => {
				expect(body).toMatchObject({
					error: "EXECUTION_PROVIDER_UNAVAILABLE",
					provider: "UNISWAP",
					message: "Uniswap is not configured.",
				});
			});

		const missingAdapter = providerPreferenceApp({
			includeUniswapAdapter: false,
		});
		await missingAdapter.store.setPreferences(
			"0x71f30000000000000000000000000000000009a2",
			{ ...onboardingPreferences, executionProvider: "UNISWAP" },
		);
		const opened = await request(missingAdapter.app)
			.post("/api/sessions/open")
			.set(authenticated)
			.send({ cadence: "weekly" })
			.expect(200);
		await request(missingAdapter.app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.set(authenticated)
			.send({ ...onboardingPreferences, executionProvider: "UNISWAP" })
			.expect(422)
			.expect(({ body }) => {
				expect(body).toMatchObject({
					error: "PROVIDER_UNAVAILABLE",
					provider: "UNISWAP",
				});
			});
	});

	it("invalidates only unsubmitted prepared quotes when the provider changes", async () => {
		const { app, store, zeroEx } = providerPreferenceApp();
		const wallet = "0x71f30000000000000000000000000000000009a2";
		await store.setPreferences(wallet, onboardingPreferences);
		const session = await store.openSession(wallet, "2026-W31", "ZERO_EX");
		const [candidate] = await zeroEx.getCandidatesForExecution(wallet, [
			"rh:4663:WETH",
		]);
		if (!candidate?.quote) throw new Error("TEST_QUOTE_REQUIRED");
		const plan: ExecutionPlan = {
			executionId: "prepared-before-switch",
			sessionId: session.id,
			epochId: session.epochId,
			provider: "ZERO_EX",
			chain: "ROBINHOOD",
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			totalInputBaseUnits: "10000000",
			authorizedPlanHash: `sha256:${"a".repeat(64)}`,
			policyHash: `sha256:${"b".repeat(64)}`,
			callCommitments: [],
			quotes: [candidate.quote],
			generatedAt: new Date().toISOString(),
		};
		await store.reserveExecution(session.id, plan);
		await request(app)
			.post("/api/preferences")
			.set(authenticated)
			.send({ ...onboardingPreferences, executionProvider: "UNISWAP" })
			.expect(200);

		expect(await store.getExecution(plan.executionId)).toBeUndefined();
		expect((await store.getSession(session.id))?.executionId).toBeUndefined();
	});

	it("falls back to demo history when CoinGecko has no points", async () => {
		let calls = 0;
		const history = {
			history: async (_asset: unknown, period: string) => {
				calls += 1;
				expect(period).toBe("1M");
				return { source: "coingecko", points: [] };
			},
		} as unknown as AppDependencies["history"];
		const response = await request(testApp(history))
			.get("/api/assets/rh%3A4663%3AWETH/history?period=1M")
			.expect(200);

		expect(calls).toBe(1);
		expect(response.body).toMatchObject({ period: "1M", source: "demo" });
		expect(response.body.points).toHaveLength(31);
	});

	it("does not fabricate demo chart history while local live execution is enabled", async () => {
		const response = await request(testLocalLiveApp())
			.get("/api/assets/rh%3A4663%3AWETH/history?period=1M")
			.expect(200);

		expect(response.body).toEqual({
			period: "1M",
			source: "unavailable",
			points: [],
			isCompleteHistory: false,
		});
	});

	it("resolves a dynamic Solana asset from the Solana provider for chart history", async () => {
		const mint = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
		const assetId = `sol:mainnet:${mint}`;
		const provider = Object.assign(new DemoProvider("JUPITER"), {
			getAsset: async (requestedAssetId: string) =>
				requestedAssetId === assetId
					? {
							assetId,
							symbol: "cbBTC",
							name: "Coinbase Wrapped BTC",
							kind: "CRYPTO" as const,
							address: mint,
							decimals: 8,
						}
					: undefined,
		});
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: new DemoProvider(),
			solanaCandidateProviders: { JUPITER: provider },
			inference: provider,
			execution: provider,
			history: {
				async history(asset) {
					expect(asset.address).toBe(mint);
					return {
						source: "coingecko" as const,
						points: [
							{ timestamp: 1_785_456_000, price: 63_500 },
							{ timestamp: 1_785_542_400, price: 64_100 },
						],
					};
				},
			},
		});

		const response = await request(app)
			.get(`/api/assets/${encodeURIComponent(assetId)}/history?period=1W`)
			.expect(200);
		expect(response.body).toMatchObject({
			period: "1W",
			source: "coingecko",
			points: [{ price: 63_500 }, { price: 64_100 }],
		});
	});

	it("preserves the provider source for underlying-stock reference charts", async () => {
		const history = {
			history: async () => ({
				source: "nasdaq" as const,
				points: [
					{ timestamp: 1_700_000_000, price: 100 },
					{ timestamp: 1_700_086_400, price: 101 },
				],
			}),
		};
		const response = await request(testApp(history))
			.get("/api/assets/rh%3A4663%3AAAPL/history?period=ALL")
			.expect(200);

		expect(response.body).toMatchObject({
			period: "ALL",
			source: "nasdaq",
			points: [{ price: 100 }, { price: 101 }],
		});
	});

	it("returns normalized CoinGecko asset details with an explorer link", async () => {
		const marketData = {
			async enrichRankingCandidates(candidates: never[]) {
				return candidates;
			},
			async history() {
				return { source: "coingecko" as const, points: [] };
			},
			async details() {
				return {
					source: "coingecko" as const,
					coingeckoId: "ethereum",
					categories: ["Smart Contract Platform"],
					marketCapUsd: 1_000_000,
					volume24hUsd: 250_000,
					holderCount: 12_345,
					websiteUrl: "https://ethereum.org/",
					community: [{ label: "X", url: "https://x.com/ethereum" }],
				};
			},
		} as unknown as AppDependencies["marketData"];
		const response = await request(testApp(undefined, marketData))
			.get("/api/assets/rh%3A4663%3AWETH/details")
			.expect(200);

		expect(response.body).toMatchObject({
			source: "coingecko",
			coingeckoId: "ethereum",
			marketCapUsd: 1_000_000,
			volume24hUsd: 250_000,
			holderCount: 12_345,
			contract: ASSET_REGISTRY.WETH?.address,
			explorerUrl: `https://robinhoodchain.blockscout.com/token/${ASSET_REGISTRY.WETH?.address}`,
		});
	});

	it("opens repeatable demo baskets, generates a bounded feed, and reserves execution once", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const second = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		expect(second.body.id).not.toBe(opened.body.id);

		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		expect(feed.body.feed.cards).toHaveLength(10);
		expect(feed.body.candidates).toHaveLength(10);
		expect(feed.body.hasMore).toBe(true);
		expect(feed.body.candidates[0].marketPriceUsd).toBe(3212.335367);
		expect(feed.body.candidates[0]).not.toHaveProperty("quote");
		expect(feed.body.proof.teeVerified).toBe(false);

		const body = {
			sessionId: opened.body.id,
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			selections: [{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" }],
			slippageBps: 50,
		};
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		const retry = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		expect(retry.body.plan.executionId).toBe(prepared.body.plan.executionId);

		const settled = await request(app)
			.post(`/api/executions/${prepared.body.plan.executionId}/demo-settle`)
			.expect(200);
		expect(settled.body.status).toBe("SETTLED");
		expect(settled.body.transactionHashes).toHaveLength(1);
		expect(settled.body.settledOutputs).toEqual([
			expect.objectContaining({
				assetId: "rh:4663:WETH",
				amountOutBaseUnits: "3113000000000000",
				status: "success",
			}),
		]);

		const nextFeed = await request(app)
			.post(`/api/sessions/${second.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		const nextPrepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				...body,
				sessionId: second.body.id,
				selections: [
					{
						assetId: nextFeed.body.candidates[0].assetId,
						amountInBaseUnits: "10000000",
					},
				],
			})
			.expect(200);
		expect(nextPrepared.body.plan.executionId).not.toBe(
			prepared.body.plan.executionId,
		);
	});

	it("refreshes quotes after changing an unsigned basket selection", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		const [firstAsset, secondAsset] = feed.body.candidates;
		expect(firstAsset?.assetId).toBeTruthy();
		expect(secondAsset?.assetId).toBeTruthy();
		const requestBody = {
			sessionId: opened.body.id,
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			selections: [
				{ assetId: firstAsset.assetId, amountInBaseUnits: "10000000" },
			],
			slippageBps: 50,
		};
		const initial = await request(app)
			.post("/api/executions/prepare")
			.send(requestBody)
			.expect(200);
		const refreshed = await request(app)
			.post("/api/executions/prepare")
			.send({
				...requestBody,
				selections: [
					{ assetId: secondAsset.assetId, amountInBaseUnits: "10000000" },
				],
			})
			.expect(200);

		expect(refreshed.body.plan.executionId).toBe(initial.body.plan.executionId);
		expect(refreshed.body.plan.authorizedPlanHash).not.toBe(
			initial.body.plan.authorizedPlanHash,
		);
		expect(refreshed.body.plan.quotes).toEqual([
			expect.objectContaining({ assetId: secondAsset.assetId }),
		]);
	});

	it("preserves an enriched CoinGecko icon on feed candidates", async () => {
		const provider = new DemoProvider();
		const iconUrl = "https://assets.coingecko.com/coins/images/example.png";
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: provider,
			marketData: {
				async enrichRankingCandidates(candidates) {
					return candidates.map((candidate, index) =>
						index === 0 ? { ...candidate, iconUrl } : candidate,
					);
				},
				async history() {
					return { source: "coingecko", points: [] };
				},
			},
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);

		expect(feed.body.candidates).toContainEqual(
			expect.objectContaining({ iconUrl }),
		);
	});

	it("enforces the selected DCA budget by total USDG, not asset count", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);

		await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				periodLimitUsd: 10,
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" },
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(422)
			.expect(({ body }) => expect(body.error).toBe("BUDGET_EXCEEDED"));
	});

	it("allows different asset allocations when their total stays within the DCA budget", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);

		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				periodLimitUsd: 250,
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "120000000" },
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "130000000" },
				],
				slippageBps: 50,
			})
			.expect(200);

		expect(prepared.body.plan.totalInputBaseUnits).toBe("250000000");
	});

	it("filters the feed using validated onboarding preferences", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				cadence: "daily",
				ticketSizeUsd: 10,
				riskMode: "conservative",
				assetClasses: ["STOCK_TOKEN"],
			})
			.expect(200);

		expect(feed.body.candidates).toHaveLength(10);
		expect(feed.body.rankedAssetCount).toBeGreaterThan(10);
		expect(
			feed.body.candidates.every(
				(candidate: { kind: string }) => candidate.kind === "STOCK_TOKEN",
			),
		).toBe(true);
		expect(feed.body.feed.cards[0].amountInBaseUnits).toBe("10000000");
		expect(feed.body.candidates[0].marketDataSource).toBe("demo");
		expect(feed.body.candidates[0]).not.toHaveProperty("quote");

		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(200);
		expect(prepared.body.plan.totalInputBaseUnits).toBe("10000000");
		expect(prepared.body.plan.quotes[0].amountInBaseUnits).toBe("10000000");
	});

	it("shows community pool tokens only in degen mode", async () => {
		const app = testApp();
		const safeSession = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);
		const safeFeed = await request(app)
			.post(`/api/sessions/${safeSession.body.id}/feed`)
			.send({
				...onboardingPreferences,
				assetClasses: ["CRYPTO"],
				candidateLimit: 2,
			})
			.expect(200);
		expect(
			safeFeed.body.candidates.map(
				(candidate: { symbol: string }) => candidate.symbol,
			),
		).toEqual(["WETH"]);

		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);

		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				riskMode: "degen",
				assetClasses: ["CRYPTO"],
				candidateLimit: 2,
			})
			.expect(200);

		expect(
			feed.body.candidates.map(
				(candidate: { symbol: string }) => candidate.symbol,
			),
		).toEqual(["STEEL", "YOINK"]);
	});

	it("stops candidate work at the requested feed size", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, candidateLimit: 5 })
			.expect(200);

		expect(feed.body.candidates).toHaveLength(5);
		expect(feed.body.feed.cards).toHaveLength(5);
	});

	it("continues the feed past ten cards without creating a new basket", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const first = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		const next = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				excludedAssetIds: first.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
			})
			.expect(200);

		expect(next.body.candidates).toHaveLength(2);
		expect(next.body.feed.cards).toHaveLength(2);
		expect(next.body.hasMore).toBe(false);
		expect(nextFeedExcludedAssetIds(first.body)).toEqual(
			first.body.candidates.map(
				(candidate: { assetId: string }) => candidate.assetId,
			),
		);
		expect(nextFeedExcludedAssetIds(next.body)).toEqual(
			next.body.candidates.map(
				(candidate: { assetId: string }) => candidate.assetId,
			),
		);
		const finalPage = fillFeedPage(
			next.body.candidates as Array<{ assetId: string }>,
		);
		expect(finalPage).toEqual(next.body.candidates);
		expect(
			new Set([
				...first.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
				...next.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
			]).size,
		).toBe(12);
	});

	it("builds feed cards without requesting or returning executable quotes", async () => {
		const provider = new DemoProvider();
		let legacyCandidateCalls = 0;
		const candidates: CandidateProvider = {
			getRankingCandidates: (...args) => provider.getRankingCandidates(...args),
			getCandidatesForFeed: (...args) => provider.getCandidatesForFeed(...args),
			async getCandidates(...args) {
				legacyCandidateCalls += 1;
				return provider.getCandidates(...args);
			},
			getCandidatesForExecution: (...args) =>
				provider.getCandidatesForExecution(...args),
		};
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates,
			inference: provider,
			execution: provider,
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);

		expect(feed.body.candidates).toHaveLength(10);
		expect(legacyCandidateCalls).toBe(0);
		expect(
			feed.body.candidates.every(
				(candidate: { quote?: unknown }) => candidate.quote === undefined,
			),
		).toBe(true);
	});

	it("bounds a higher ticket-size feed within the fixed period budget", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "monthly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, cadence: "monthly", ticketSizeUsd: 25 })
			.expect(200);

		expect(feed.body.candidates).toHaveLength(4);
		expect(feed.body.feed.cards).toHaveLength(4);
		expect(
			feed.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "25000000",
			),
		).toBe(true);
	});

	it("supports $0.10 and $0.25 USDG ticket sizes with exact base units", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);

		const tenth = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, ticketSizeUsd: 0.1 })
			.expect(200);
		expect(tenth.body.feed.cards).toHaveLength(10);
		expect(
			tenth.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "100000",
			),
		).toBe(true);

		const quarter = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, ticketSizeUsd: 0.25 })
			.expect(200);
		expect(quarter.body.feed.cards).toHaveLength(10);
		expect(
			quarter.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "250000",
			),
		).toBe(true);
	});

	it("rejects a non-canonical selection", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const response = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:SCAM", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(422);
		expect(response.body.error).toBe("ASSET_NOT_ELIGIBLE");
	});

	it("rejects a terminal epoch before candidate or execution preparation", async () => {
		const provider = new DemoProvider();
		let candidateRequests = 0;
		let executionPreparations = 0;
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: {
				getRankingCandidates: (...args) =>
					provider.getRankingCandidates(...args),
				getCandidatesForFeed: (...args) =>
					provider.getCandidatesForFeed(...args),
				async getCandidates(...args) {
					candidateRequests += 1;
					return provider.getCandidates(...args);
				},
				async getCandidatesForExecution(...args) {
					candidateRequests += 1;
					return provider.getCandidatesForExecution(...args);
				},
			},
			inference: provider,
			execution: {
				id: provider.id,
				label: provider.label,
				price: (...args) => provider.price(...args),
				health: () => provider.health(),
				async prepareBasket(...args) {
					executionPreparations += 1;
					return provider.prepareBasket(...args);
				},
				prepareExit: (...args) => provider.prepareExit(...args),
			},
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const body = {
			sessionId: opened.body.id,
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			selections: [{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" }],
			slippageBps: 50,
		};
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		await request(app)
			.post(`/api/executions/${prepared.body.plan.executionId}/demo-settle`)
			.expect(200);
		const requestsBeforeRetry = candidateRequests;
		const preparationsBeforeRetry = executionPreparations;

		const conflict = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(409);

		expect(conflict.body).toEqual(
			expect.objectContaining({
				error: "EXECUTION_TERMINAL",
				executionId: prepared.body.plan.executionId,
				status: "SETTLED",
			}),
		);
		expect(candidateRequests).toBe(requestsBeforeRetry);
		expect(executionPreparations).toBe(preparationsBeforeRetry);
	});

	it("prepares only the selected assets and exposes stage timing", async () => {
		const provider = new DemoProvider();
		const executionRequests: string[][] = [];
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: {
				getRankingCandidates: (...args) =>
					provider.getRankingCandidates(...args),
				getCandidatesForFeed: (...args) =>
					provider.getCandidatesForFeed(...args),
				getCandidates: (...args) => provider.getCandidates(...args),
				async getCandidatesForExecution(wallet, assetIds, amount, now) {
					executionRequests.push(assetIds);
					return provider.getCandidatesForExecution(
						wallet,
						assetIds,
						amount,
						now,
					);
				},
			},
			inference: provider,
			execution: provider,
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [{ assetId: "rh:4663:WETH", amountInBaseUnits: "100000" }],
				slippageBps: 50,
			})
			.expect(200);

		expect(executionRequests).toEqual([["rh:4663:WETH"]]);
		expect(prepared.body.plan.quotes).toHaveLength(1);
		expect(prepared.headers["server-timing"]).toMatch(
			/session;dur=.*candidates;dur=.*execution;dur=.*store;dur=.*total;dur=/,
		);
	});

	it("returns the exact 0x-rejected basket legs without reserving a partial execution", async () => {
		const provider = new DemoProvider();
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: provider,
			inference: provider,
			execution: {
				id: provider.id,
				label: provider.label,
				price: (...args) => provider.price(...args),
				health: () => provider.health(),
				async prepareBasket() {
					return {
						quotes: [],
						walletCalls: [],
						unavailableAssetIds: ["rh:4663:AAPL"],
					};
				},
				prepareExit: (...args) => provider.prepareExit(...args),
			},
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const response = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "100000" },
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "100000" },
				],
				slippageBps: 50,
			})
			.expect(422);

		expect(response.body).toMatchObject({
			error: "EXECUTION_ASSETS_UNAVAILABLE",
			assetIds: ["rh:4663:AAPL"],
			symbols: ["AAPL"],
		});
	});

	it("keeps a supported exit reachable outside the weekly execution path", async () => {
		const app = testApp();
		const response = await request(app)
			.post("/api/positions/rh%3A4663%3AWETH/exit/quote")
			.send({ amountInBaseUnits: "1000000000000000" })
			.expect(200);
		expect(response.body.asset.symbol).toBe("WETH");
		expect(response.body.quote.tokenOut).toBe(
			"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
		);
		expect(response.body.walletCalls).toEqual([]);
	});
});
