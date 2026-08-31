import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY, COINGECKO_COIN_IDS } from "../src/domain/constants.js";
import { rankingCandidateSchema } from "../src/domain/schemas.js";
import { CoinGeckoIconProvider } from "../src/server/adapters/coingecko.js";

describe("CoinGeckoIconProvider", () => {
	it("uses ticker-specific stock logos instead of CoinGecko's generic Robinhood badge", async () => {
		const fetcher = async (input: string | URL | Request) => {
			const url = new URL(String(input));
			expect(url.searchParams.get("ids")).toContain("yoink-4");
			expect(url.searchParams.get("ids")).toContain("steel-2");
			expect(url.searchParams.get("ids")).not.toContain(
				"robinhood-wrapped-eth-robinhood-chain",
			);
			expect(url.searchParams.get("ids")).not.toContain(
				"apple-robinhood-tokenized-stock",
			);
			expect(url.searchParams.get("ids")).not.toContain(
				"applied-optoelectronics-robinhood-tokenized-stock",
			);
			expect(url.searchParams.get("per_page")).toBe("250");
			return new Response(
				JSON.stringify([
					{
						id: "ethereum",
						image: "https://coin-images.coingecko.com/ethereum.png",
					},
					{
						id: "yoink-4",
						image:
							"https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png?1783361029",
					},
					{
						id: "apple-robinhood-tokenized-stock",
						image:
							"https://coin-images.coingecko.com/generic-robinhood-stock.png",
					},
				]),
			);
		};
		const provider = new CoinGeckoIconProvider(
			"test-key",
			fetcher as typeof fetch,
		);

		const icons = await provider.getIcons();
		expect(icons).toMatchObject({
			CBRS: "/assets/forge/cbrs.webp",
			CRCL: "/assets/forge/crcl.webp",
			CRWV: "/assets/forge/crwv.webp",
			RDDT: "/assets/forge/rddt.webp",
			SPCX: "/assets/forge/spcx.webp",
			ETH: "https://coin-images.coingecko.com/ethereum.png",
			WETH: "https://coin-images.coingecko.com/ethereum.png",
			YOINK:
				"https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png?1783361029",
		});
		expect(icons).not.toHaveProperty("AAOI");
		expect(icons).not.toHaveProperty("AAPL");
		await expect(provider.getIcons()).resolves.toEqual(icons);
	});

	it("maps every checked-in demo registry asset", () => {
		expect(
			Object.keys(ASSET_REGISTRY).filter(
				(symbol) => !COINGECKO_COIN_IDS[symbol],
			),
		).toEqual([]);
		expect(COINGECKO_COIN_IDS).toMatchObject({
			ETH: "ethereum",
			USDG: "global-dollar",
			WETH: "robinhood-wrapped-eth-robinhood-chain",
			STEEL: "steel-2",
			YOINK: "yoink-4",
		});
	});

	it("uses CoinGecko anonymously when no API key is configured", async () => {
		const provider = new CoinGeckoIconProvider(undefined, (async (
			_input,
			init,
		) => {
			expect(init?.headers).toBeUndefined();
			return new Response(
				JSON.stringify([
					{
						id: "yoink-4",
						image:
							"https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png",
					},
				]),
			);
		}) as typeof fetch);

		await expect(provider.getIcons()).resolves.toMatchObject({
			CBRS: "/assets/forge/cbrs.webp",
			SPCX: "/assets/forge/spcx.webp",
			YOINK:
				"https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png",
		});
	});

	it("batches ranking prices, preserves Robinhood-only assets, and caches the response", async () => {
		let calls = 0;
		const provider = new CoinGeckoIconProvider("demo-key", (async (
			input,
			init,
		) => {
			calls += 1;
			const url = new URL(String(input));
			expect(url.pathname).toBe("/api/v3/coins/markets");
			expect(url.searchParams.get("ids")).toContain(
				"apple-robinhood-tokenized-stock",
			);
			expect(url.searchParams.get("ids")).toContain(
				"robinhood-wrapped-eth-robinhood-chain",
			);
			expect(
				(init?.headers as Record<string, string> | undefined)?.[
					"x-cg-demo-api-key"
				],
			).toBe("demo-key");
			return new Response(
				JSON.stringify([
					{
						id: "apple-robinhood-tokenized-stock",
						image: "https://assets.coingecko.com/apple.png",
						current_price: 338.61,
						total_volume: 1_200_000,
						price_change_percentage_24h: 1.25,
						market_cap_rank: 42,
					},
					{
						id: "robinhood-wrapped-eth-robinhood-chain",
						current_price: 1_876.69,
						total_volume: 5_000_000,
						price_change_percentage_24h: -0.75,
					},
				]),
			);
		}) as typeof fetch);
		const candidates = [
			{
				assetId: "rh:4663:AAPL",
				symbol: "AAPL",
				name: "Apple stock token",
				kind: "STOCK_TOKEN" as const,
				discoveryRank: 1,
			},
			{
				assetId: "rh:4663:WETH",
				symbol: "WETH",
				name: "Wrapped Ether",
				kind: "CRYPTO" as const,
				discoveryRank: 2,
			},
			{
				assetId: "rh:4663:ARM",
				symbol: "ARM",
				name: "Arm stock token",
				kind: "STOCK_TOKEN" as const,
				discoveryRank: 3,
			},
		].map((candidate) => rankingCandidateSchema.parse(candidate));

		const enriched = await provider.enrichRankingCandidates(candidates);
		await provider.enrichRankingCandidates(candidates);

		expect(calls).toBe(1);
		expect(enriched).toEqual([
			expect.objectContaining({
				assetId: "rh:4663:AAPL",
				priceUsd: 338.61,
				volume24hUsd: 1_200_000,
				priceChange24hPct: 1.25,
				marketCapRank: 42,
				marketCapRankSource: "coingecko",
				coingeckoId: "apple-robinhood-tokenized-stock",
				iconUrl: "https://assets.coingecko.com/apple.png",
			}),
			expect.objectContaining({
				assetId: "rh:4663:WETH",
				priceUsd: 1_876.69,
			}),
			candidates[2],
		]);
	});

	it("enriches a discovered Robinhood token and only uses explicit meme categories", async () => {
		const contract = "0x020bfC650A365f8BB26819deAAbF3E21291018b4";
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			const url = new URL(String(input));
			if (url.pathname.includes("/tokens/multi/")) {
				return Response.json({
					data: [
						{
							attributes: {
								address: contract.toLowerCase(),
								coingecko_coin_id: "cash-cat",
								price_usd: "0.5",
								total_reserve_in_usd: "3000000",
								volume_usd: { h24: "15000000" },
							},
						},
					],
				});
			}
			if (url.pathname.endsWith("/info")) {
				return Response.json({
					data: {
						attributes: {
							address: contract,
							coingecko_coin_id: "cash-cat",
							categories: ["Memecoin"],
						},
					},
				});
			}
			if (url.pathname.endsWith("/coins/markets")) {
				return Response.json([
					{
						id: "cash-cat",
						current_price: 0.5,
						total_volume: 15_000_000,
						market_cap_rank: 429,
					},
				]);
			}
			throw new Error(`Unexpected URL ${url}`);
		}) as typeof fetch);
		const candidate = rankingCandidateSchema.parse({
			chain: "ROBINHOOD",
			assetId: `rh:4663:${contract.toLowerCase()}`,
			symbol: "CASHCAT",
			name: "Cash Cat",
			kind: "CRYPTO",
			contract,
			decimals: 18,
			discoveryRank: 1,
			primaryClassification: "CRYPTO",
			classificationConfidence: "HIGH",
			coingeckoId: "cash-cat",
			marketDataSource: "geckoterminal",
		});

		await expect(
			provider.enrichRankingCandidates([candidate]),
		).resolves.toEqual([
			expect.objectContaining({
				assetId: candidate.assetId,
				primaryClassification: "MEMECOIN",
				classificationConfidence: "HIGH",
				marketCapRank: 429,
				marketCapRankSource: "coingecko",
				liquidityUsd: 3_000_000,
			}),
		]);
	});

	it("loads and caches CoinGecko chart points for the requested timeframe", async () => {
		let calls = 0;
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			calls += 1;
			const url = new URL(String(input));
			expect(url.pathname).toContain("/coins/yoink-4/market_chart");
			expect(url.searchParams.get("days")).toBe("30");
			return new Response(
				JSON.stringify({
					prices: [
						[1_721_600_000_000, 330.1],
						[1_721_686_400_000, 338.61],
					],
				}),
			);
		}) as typeof fetch);

		const asset = ASSET_REGISTRY.YOINK;
		if (!asset) throw new Error("YOINK fixture missing");
		const points = await provider.history(asset, "1M");
		await provider.history(asset, "1M");

		expect(calls).toBe(1);
		expect(points).toEqual({
			source: "coingecko",
			sourceAsset: "yoink-4",
			isCompleteHistory: true,
			points: [
				{ timestamp: 1_721_600_000, price: 330.1 },
				{ timestamp: 1_721_686_400, price: 338.61 },
			],
		});
	});

	it("loads and caches normalized CoinGecko asset details", async () => {
		let calls = 0;
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			calls += 1;
			const url = new URL(String(input));
			if (url.pathname.endsWith("/info")) {
				expect(url.pathname).toBe(
					"/api/v3/onchain/networks/robinhood/tokens/0x0000000000000000000000000000000000000001/info",
				);
				return Response.json({
					data: {
						attributes: {
							holders: {
								count: 12_345,
								last_updated: "2026-08-01T10:05:00.000Z",
							},
							telegram_handle: "ProjectVEX",
						},
					},
				});
			}
			expect(url.pathname).toBe("/api/v3/coins/projectvex");
			expect(url.searchParams.get("tickers")).toBe("false");
			return Response.json({
				id: "projectvex",
				categories: ["Artificial Intelligence (AI)", "AI Agents", ""],
				market_data: {
					market_cap: { usd: 2_903_741 },
					total_volume: { usd: 926_511 },
				},
				links: {
					homepage: ["javascript:alert(1)", "https://www.projectvex.ai/"],
					twitter_screen_name: "ProjectVEXai",
					telegram_channel_identifier: "",
					subreddit_url: null,
					chat_url: [],
				},
				community_data: { reddit_subscribers: 0 },
				last_updated: "2026-08-01T10:00:00.000Z",
			});
		}) as typeof fetch);
		const asset = {
			assetId: "rh:4663:0xvex",
			symbol: "VEX",
			name: "ProjectVex",
			kind: "CRYPTO" as const,
			address: "0x0000000000000000000000000000000000000001",
			decimals: 18,
			coingeckoId: "projectvex",
		};

		const details = await provider.details(asset);
		await provider.details(asset);

		expect(calls).toBe(2);
		expect(details).toEqual({
			source: "coingecko",
			coingeckoId: "projectvex",
			categories: ["Artificial Intelligence (AI)", "AI Agents"],
			marketCapUsd: 2_903_741,
			volume24hUsd: 926_511,
			holderCount: 12_345,
			websiteUrl: "https://www.projectvex.ai/",
			community: [
				{ label: "X", url: "https://x.com/ProjectVEXai" },
				{ label: "Telegram", url: "https://t.me/ProjectVEX" },
			],
			updatedAt: "2026-08-01T10:00:00.000Z",
		});
	});

	it("uses a discovered asset's CoinGecko ID for historical charts", async () => {
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			const url = new URL(String(input));
			expect(url.pathname).toBe("/api/v3/coins/projectvex/market_chart");
			return new Response(
				JSON.stringify({
					prices: [
						[1_721_600_000_000, 0.00241],
						[1_721_686_400_000, 0.00293],
					],
				}),
			);
		}) as typeof fetch);

		await expect(
			provider.history(
				{
					assetId: "robinhood:0xvex",
					symbol: "VEX",
					name: "ProjectVex",
					kind: "CRYPTO",
					address: "0x0000000000000000000000000000000000000001",
					decimals: 18,
					coingeckoId: "projectvex",
				},
				"1M",
			),
		).resolves.toMatchObject({
			source: "coingecko",
			sourceAsset: "projectvex",
			points: [
				{ timestamp: 1_721_600_000, price: 0.00241 },
				{ timestamp: 1_721_686_400, price: 0.00293 },
			],
		});
	});

	it("loads dynamic Solana history from CoinGecko by mint address", async () => {
		const mint = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
		let calls = 0;
		const provider = new CoinGeckoIconProvider("demo-key", (async (input, init) => {
			calls += 1;
			const url = new URL(String(input));
			expect(url.pathname).toBe(
				`/api/v3/coins/solana/contract/${mint}/market_chart`,
			);
			expect(url.searchParams.get("days")).toBe("7");
			expect(
				(init?.headers as Record<string, string> | undefined)?.[
					"x-cg-demo-api-key"
				],
			).toBe("demo-key");
			return Response.json({
				prices: [
					[1_785_456_000_000, 63_500],
					[1_785_542_400_000, 64_100],
				],
			});
		}) as typeof fetch);
		const asset = {
			assetId: `sol:mainnet:${mint}`,
			symbol: "cbBTC",
			name: "Coinbase Wrapped BTC",
			kind: "CRYPTO" as const,
			address: mint,
			decimals: 8,
		};

		await expect(provider.history(asset, "1W")).resolves.toEqual({
			source: "coingecko",
			sourceAsset: `solana:${mint}`,
			isCompleteHistory: true,
			points: [
				{ timestamp: 1_785_456_000, price: 63_500 },
				{ timestamp: 1_785_542_400, price: 64_100 },
			],
		});
		await provider.history(asset, "1W");
		expect(calls).toBe(1);
	});

	it("uses maximum canonical Ethereum history for WETH", async () => {
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			const url = new URL(String(input));
			expect(url.hostname).toBe("query1.finance.yahoo.com");
			expect(url.pathname).toContain("/chart/ETH-USD");
			expect(url.searchParams.get("range")).toBe("max");
			return new Response(
				JSON.stringify({
					chart: {
						result: [
							{
								timestamp: [
									1_721_686_400,
									1_510_012_800,
									1_510_012_800,
								],
								indicators: {
									adjclose: [{ adjclose: [3_350, 300, 308.64] }],
								},
							},
						],
					},
				}),
			);
		}) as typeof fetch);

		const asset = ASSET_REGISTRY.WETH;
		if (!asset) throw new Error("WETH fixture missing");
		await expect(provider.history(asset, "ALL")).resolves.toMatchObject({
			source: "yahoo",
			sourceAsset: "ETH-USD",
			isCompleteHistory: true,
			points: [{ timestamp: 1_510_012_800 }, { price: 3_350 }],
		});
	});

	it("uses Nasdaq underlying-stock history for long stock charts", async () => {
		const provider = new CoinGeckoIconProvider("demo-key", (async (input) => {
			const url = new URL(String(input));
			expect(url.hostname).toBe("api.nasdaq.com");
			expect(url.pathname).toBe("/api/quote/AAPL/historical");
			expect(url.searchParams.get("fromdate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			return new Response(
				JSON.stringify({
					data: {
						tradesTable: {
							rows: [
								{ date: "07/28/2026", close: "$340.08" },
								{ date: "07/27/2026", close: "$336.91" },
							],
						},
					},
				}),
			);
		}) as typeof fetch);

		const asset = ASSET_REGISTRY.AAPL;
		if (!asset) throw new Error("AAPL fixture missing");
		await expect(provider.history(asset, "1Y")).resolves.toEqual({
			source: "nasdaq",
			sourceAsset: "AAPL",
			isCompleteHistory: false,
			points: [
				{ timestamp: 1_785_110_400, price: 336.91 },
				{ timestamp: 1_785_196_800, price: 340.08 },
			],
		});
	});
});
