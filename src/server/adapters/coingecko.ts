import {
	COINGECKO_COIN_IDS,
	type RegistryAsset,
} from "../../domain/solana.js";
import type { RankingCandidate } from "../../domain/schemas.js";
import type { HistoryPeriod, PricePoint } from "./market-history.js";
import type { ProviderSnapshotCache } from "./types.js";

const COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets";
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";
const NASDAQ_API_URL = "https://api.nasdaq.com/api/quote";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const ICON_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MARKET_CACHE_TTL_MS = 5 * 60_000;
const CLASSIFICATION_CACHE_TTL_MS = 24 * 60 * 60_000;
const HISTORY_CACHE_TTL_MS = 5 * 60_000;
const MAX_CLASSIFICATION_LOOKUPS = 12;
const COINGECKO_ICON_ID_OVERRIDES: Record<string, string> = {
	WETH: "ethereum",
};
const COINGECKO_HISTORY_ID_OVERRIDES: Record<string, string> = {
	WETH: "ethereum",
	SOL: "solana",
	JUP: "jupiter-exchange-solana",
};
const YAHOO_CRYPTO_SYMBOLS: Record<string, string> = {
	ETH: "ETH-USD",
	WETH: "ETH-USD",
	SOL: "SOL-USD",
	JUP: "JUP-USD",
};
const YAHOO_STOCK_SYMBOLS: Record<string, string> = {
	AAPLX: "AAPL",
	NVDAX: "NVDA",
	TSLAX: "TSLA",
};

type MarketRow = {
	id?: string;
	image?: string;
	current_price?: number | null;
	market_cap?: number | null;
	total_volume?: number | null;
	price_change_percentage_24h?: number | null;
	market_cap_rank?: number | null;
	last_updated?: string;
};

type CoinDetailsResponse = {
	id?: string;
	categories?: unknown[];
	market_data?: {
		market_cap?: { usd?: number | null };
		total_volume?: { usd?: number | null };
	};
	links?: {
		homepage?: unknown[];
		twitter_screen_name?: unknown;
		telegram_channel_identifier?: unknown;
		subreddit_url?: unknown;
		chat_url?: unknown[];
	};
	community_data?: {
		telegram_channel_user_count?: number | null;
		reddit_subscribers?: number | null;
	};
	last_updated?: string;
};

type OnchainTokenRow = {
	attributes?: {
		address?: string;
		coingecko_coin_id?: string | null;
		price_usd?: string | null;
		total_reserve_in_usd?: string | null;
		volume_usd?: { h24?: string | null };
		last_trade_timestamp?: number | null;
	};
};

type OnchainTokenInfo = {
	data?: {
		attributes?: {
			address?: string;
			coingecko_coin_id?: string | null;
			websites?: unknown[];
			twitter_handle?: unknown;
			telegram_handle?: unknown;
			gt_score?: number | null;
			gt_verified?: boolean;
			categories?: string[];
			gt_category_ids?: string[];
			mint_authority?: string | null;
			freeze_authority?: string | null;
			is_honeypot?: boolean | "unknown";
			holders?: {
				count?: number | null;
				distribution_percentage?: { top_10?: number | null };
				last_updated?: string | null;
			};
		};
	};
};

export interface AssetIconProvider {
	getIcons(): Promise<Record<string, string>>;
}

export interface MarketDataProvider {
	enrichRankingCandidates(
		candidates: RankingCandidate[],
	): Promise<RankingCandidate[]>;
	history(
		asset: RegistryAsset,
		period: HistoryPeriod,
	): Promise<HistorySeries>;
	details?(asset: RegistryAsset): Promise<AssetDetails | undefined>;
}

export type AssetDetails = {
	source: "coingecko" | "geckoterminal";
	coingeckoId?: string;
	categories: string[];
	marketCapUsd?: number;
	volume24hUsd?: number;
	holderCount?: number;
	websiteUrl?: string;
	community: Array<{ label: string; url?: string; count?: number }>;
	updatedAt?: string;
};

export type HistorySeries = {
	source: "coingecko" | "nasdaq" | "yahoo";
	points: PricePoint[];
	sourceAsset?: string;
	isCompleteHistory?: boolean;
};

export class CoinGeckoIconProvider implements AssetIconProvider {
	private cached: Record<string, string> = {};
	private expiresAt = 0;
	private readonly responseCache = new Map<
		string,
		{ expiresAt: number; value: unknown }
	>();
	private readonly inFlight = new Map<string, Promise<unknown>>();

	constructor(
		private readonly apiKey: string | undefined,
		private readonly fetcher: typeof fetch = fetch,
		private readonly durableCache?: ProviderSnapshotCache,
	) {}

	async getIcons(): Promise<Record<string, string>> {
		if (Date.now() < this.expiresAt) return this.cached;

		const iconEntries = Object.entries(COINGECKO_COIN_IDS).map(
			([symbol, id]) =>
				[symbol, COINGECKO_ICON_ID_OVERRIDES[symbol] ?? id] as const,
		);
		const ids = [...new Set(iconEntries.map(([, id]) => id))];
		const response = await this.fetcher(
			`${COINGECKO_MARKETS_URL}?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&per_page=250&page=1`,
			{
				headers: this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : undefined,
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!response.ok) throw new Error(`COINGECKO_ICONS_${response.status}`);

		const rows = (await response.json()) as Array<{
			id?: string;
			image?: string;
		}>;
		const iconById = new Map(
			rows.flatMap((row) =>
				row.id && row.image ? [[row.id, row.image] as const] : [],
			),
		);
		this.cached = {
			...Object.fromEntries(
				iconEntries.flatMap(([symbol, id]) => {
					const image = iconById.get(id);
					return image ? [[symbol, image]] : [];
				}),
			),
		};
		this.expiresAt = Date.now() + ICON_CACHE_TTL_MS;
		return this.cached;
	}

	async enrichRankingCandidates(
		candidates: RankingCandidate[],
	): Promise<RankingCandidate[]> {
		const onchainCandidates = candidates.filter(
			(candidate) => candidate.chain === "SOLANA" && candidate.contract,
		);
		const solanaRows = await this.onchainMarketRows(
			"solana",
			onchainCandidates.flatMap((candidate) => candidate.contract ?? []),
		);
		const onchainRows = solanaRows.map((row) => ["SOLANA", row] as const);
		const onchainByAddress = new Map(
			onchainRows.flatMap(([chain, row]) => {
				const address = row.attributes?.address;
				return address
					? [[onchainKey(chain, address), row.attributes] as const]
					: [];
			}),
		);
		const classificationCandidates = [...onchainCandidates].sort(
			(left, right) =>
				Number(right.marketDataSource === "geckoterminal") -
				Number(left.marketDataSource === "geckoterminal"),
		);
		const tokenInfoEntries = await Promise.all(
			classificationCandidates
				.slice(0, MAX_CLASSIFICATION_LOOKUPS)
				.map(async (candidate) => {
					const contract = candidate.contract;
					if (!contract) return undefined;
					try {
						return [
							onchainKey(candidate.chain, contract),
							await this.onchainTokenInfo("solana", contract),
						] as const;
					} catch {
						return undefined;
					}
				}),
		);
		const tokenInfoByAddress = new Map(
			tokenInfoEntries.filter((entry): entry is NonNullable<typeof entry> =>
				Boolean(entry),
			),
		);
		const ids = [
			...new Set(
				candidates.flatMap((candidate) => {
					const staticId = COINGECKO_COIN_IDS[candidate.symbol];
					const addressId =
						candidate.contract &&
						(onchainByAddress.get(
							onchainKey(candidate.chain, candidate.contract),
						)?.coingecko_coin_id ??
							tokenInfoByAddress.get(
								onchainKey(candidate.chain, candidate.contract),
							)?.coingecko_coin_id);
					return [candidate.coingeckoId, staticId, addressId].filter(
						(id): id is string => Boolean(id),
					);
				}),
			),
		];
		const rows = ids.length
			? await this.cachedResponse(
					`markets:${[...ids].sort().join(",")}`,
					MARKET_CACHE_TTL_MS,
					async () => {
						const response = await this.fetcher(
							`${COINGECKO_MARKETS_URL}?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&per_page=250&page=1&sparkline=false`,
							{
								headers: this.headers(),
								signal: AbortSignal.timeout(10_000),
							},
						);
						if (!response.ok)
							throw new Error(`COINGECKO_MARKETS_${response.status}`);
						return (await response.json()) as MarketRow[];
					},
				)
			: [];
		const byId = new Map(
			rows.flatMap((row) => (row.id ? [[row.id, row] as const] : [])),
		);
		return candidates.map((candidate) => {
			const onchain = candidate.contract
				? onchainByAddress.get(onchainKey(candidate.chain, candidate.contract))
				: undefined;
			const info = candidate.contract
				? tokenInfoByAddress.get(
						onchainKey(candidate.chain, candidate.contract),
					)
				: undefined;
			const id =
				candidate.coingeckoId ??
				COINGECKO_COIN_IDS[candidate.symbol] ??
				onchain?.coingecko_coin_id ??
				info?.coingecko_coin_id ??
				undefined;
			const row = id ? byId.get(id) : undefined;
			const categories = [
				...(info?.categories ?? []),
				...(info?.gt_category_ids ?? []),
			];
			const isMeme = categories.some((category) =>
				/(^|[-_\s])meme(coins?)?($|[-_\s])/i.test(category),
			);
			const riskFlags = new Set(candidate.riskFlags);
			if (info?.mint_authority) riskFlags.add("MINT_AUTHORITY_ENABLED");
			if (info?.freeze_authority) riskFlags.add("FREEZE_AUTHORITY_ENABLED");
			if ((info?.holders?.distribution_percentage?.top_10 ?? 0) >= 80) {
				riskFlags.add("CONCENTRATED_HOLDERS");
			}
			if (info?.is_honeypot === true) riskFlags.add("HONEYPOT");
			const priceUsd =
				typeof row?.current_price === "number"
					? row.current_price
					: positiveNumber(onchain?.price_usd);
			const volume24hUsd =
				typeof row?.total_volume === "number"
					? row.total_volume
					: positiveNumber(onchain?.volume_usd?.h24);
			const liquidityUsd =
				candidate.liquidityUsd ?? positiveNumber(onchain?.total_reserve_in_usd);
			return {
				...candidate,
				priceUsd: priceUsd ?? candidate.priceUsd,
				volume24hUsd: volume24hUsd ?? candidate.volume24hUsd,
				liquidityUsd,
				priceChange24hPct:
					typeof row?.price_change_percentage_24h === "number"
						? row.price_change_percentage_24h
						: candidate.priceChange24hPct,
				marketCapRank:
					typeof row?.market_cap_rank === "number" && row.market_cap_rank > 0
						? row.market_cap_rank
						: candidate.marketCapRank,
				marketCapRankSource:
					typeof row?.market_cap_rank === "number" && row.market_cap_rank > 0
						? ("coingecko" as const)
						: candidate.marketCapRankSource,
				coingeckoId: id ?? candidate.coingeckoId,
				iconUrl: row?.image ?? candidate.iconUrl,
				marketDataUpdatedAt:
					row?.last_updated ??
					(onchain?.last_trade_timestamp
						? new Date(onchain.last_trade_timestamp * 1_000).toISOString()
						: candidate.marketDataUpdatedAt),
				primaryClassification:
					candidate.primaryClassification === "TOKENIZED_STOCK"
						? "TOKENIZED_STOCK"
						: isMeme
							? "MEMECOIN"
							: id
								? "CRYPTO"
								: candidate.primaryClassification,
				classificationConfidence:
					candidate.primaryClassification === "TOKENIZED_STOCK"
						? candidate.classificationConfidence
						: isMeme || id
							? "HIGH"
							: candidate.classificationConfidence,
				classificationEvidence: [
					...candidate.classificationEvidence,
					...(categories.length
						? [`geckoterminal:categories:${categories.join(",")}`]
						: []),
					...(id ? [`coingecko:coin:${id}`] : []),
				],
				riskFlags: [...riskFlags],
				marketDataSource: row
					? ("coingecko" as const)
					: onchain
						? ("geckoterminal" as const)
						: candidate.marketDataSource,
			};
		});
	}

	async details(asset: RegistryAsset): Promise<AssetDetails | undefined> {
		const id =
			asset.coingeckoId ??
			COINGECKO_HISTORY_ID_OVERRIDES[asset.symbol] ??
			COINGECKO_COIN_IDS[asset.symbol];
		const isSolana = asset.assetId.startsWith("sol:");
		const [body, tokenInfo] = await Promise.all([
			id || isSolana
				? this.cachedResponse(
						isSolana && !id
							? `details:solana:${asset.address}`
							: `details:${id}`,
						MARKET_CACHE_TTL_MS,
						async () => {
							const endpoint =
								isSolana && !id
									? `/coins/solana/contract/${encodeURIComponent(asset.address)}`
									: `/coins/${encodeURIComponent(String(id))}`;
							const response = await this.fetcher(
								`${COINGECKO_API_URL}${endpoint}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
								{
									headers: this.headers(),
									signal: AbortSignal.timeout(10_000),
								},
							);
							if (!response.ok)
								throw new Error(`COINGECKO_DETAILS_${response.status}`);
							return (await response.json()) as CoinDetailsResponse;
						},
					).catch(() => undefined)
				: undefined,
			this.onchainTokenInfo(
				"solana",
				asset.address,
				MARKET_CACHE_TTL_MS,
				"details",
			).catch(() => undefined),
		]);
		if (!body && !tokenInfo) return undefined;
		const resolvedId = body?.id ?? id;
		const twitter = socialHandle(body?.links?.twitter_screen_name);
		const telegram = socialHandle(
			body?.links?.telegram_channel_identifier,
		);
		const onchainTwitter = socialHandle(tokenInfo?.twitter_handle);
		const onchainTelegram = socialHandle(tokenInfo?.telegram_handle);
		const community = [
			twitter
				? { label: "X", url: `https://x.com/${encodeURIComponent(twitter)}` }
				: undefined,
			telegram
				? {
						label: "Telegram",
						url: `https://t.me/${encodeURIComponent(telegram)}`,
						count: positiveInteger(
							body?.community_data?.telegram_channel_user_count,
						),
					}
				: undefined,
			safeHttpUrl(body?.links?.subreddit_url)
				? {
						label: "Reddit",
						url: safeHttpUrl(body?.links?.subreddit_url),
						count: positiveInteger(body?.community_data?.reddit_subscribers),
					}
				: undefined,
			...(body?.links?.chat_url ?? []).flatMap((url, index) => {
				const safeUrl = safeHttpUrl(url);
				return safeUrl ? [{ label: index ? `Community ${index + 1}` : "Community", url: safeUrl }] : [];
			}),
			onchainTwitter
				? {
						label: "X",
						url: `https://x.com/${encodeURIComponent(onchainTwitter)}`,
					}
				: undefined,
			onchainTelegram
				? {
						label: "Telegram",
						url: `https://t.me/${encodeURIComponent(onchainTelegram)}`,
					}
				: undefined,
		].filter((item): item is NonNullable<typeof item> => Boolean(item));
		return {
			source: body ? "coingecko" : "geckoterminal",
			...(resolvedId ? { coingeckoId: resolvedId } : {}),
			categories: [
				...(body?.categories ?? []),
				...(tokenInfo?.categories ?? []),
			]
				.filter((category): category is string =>
					Boolean(typeof category === "string" && category.trim()),
				)
				.map((category) => category.trim())
				.filter((category, index, categories) => categories.indexOf(category) === index)
				.slice(0, 8),
			marketCapUsd: positiveNumber(body?.market_data?.market_cap?.usd),
			volume24hUsd: positiveNumber(body?.market_data?.total_volume?.usd),
			holderCount: positiveInteger(tokenInfo?.holders?.count),
			websiteUrl: [
				...(body?.links?.homepage ?? []),
				...(tokenInfo?.websites ?? []),
			]
				.map(safeHttpUrl)
				.find((url): url is string => Boolean(url)),
			community: dedupeLinks(community).slice(0, 5),
			updatedAt:
				validIsoDate(body?.last_updated) ??
				validIsoDate(tokenInfo?.holders?.last_updated ?? undefined),
		};
	}

	private async onchainMarketRows(
		network: "solana",
		addresses: string[],
	) {
		if (!addresses.length) return [] as OnchainTokenRow[];
		const unique = [...new Set(addresses)].slice(0, 50);
		return this.cachedResponse(
			`${network}-market:${[...unique].sort().join(",")}`,
			MARKET_CACHE_TTL_MS,
			async () => {
				const response = await this.fetcher(
					`${COINGECKO_API_URL}/onchain/networks/${network}/tokens/multi/${encodeURIComponent(unique.join(","))}`,
					{
						headers: this.headers(),
						signal: AbortSignal.timeout(10_000),
					},
				);
				if (!response.ok) return [] as OnchainTokenRow[];
				const body = (await response.json()) as { data?: OnchainTokenRow[] };
				return body.data ?? [];
			},
		);
	}

	private async onchainTokenInfo(
		network: "solana",
		address: string,
		cacheTtlMs = CLASSIFICATION_CACHE_TTL_MS,
		cacheNamespace = "classification",
	) {
		return this.cachedResponse(
			`${cacheNamespace}:${network}-info:${address}`,
			cacheTtlMs,
			async () => {
				const response = await this.fetcher(
					`${COINGECKO_API_URL}/onchain/networks/${network}/tokens/${encodeURIComponent(address)}/info`,
					{
						headers: this.headers(),
						signal: AbortSignal.timeout(10_000),
					},
				);
				if (!response.ok) return undefined;
				const body = (await response.json()) as OnchainTokenInfo;
				return body.data?.attributes;
			},
		);
	}

	async history(
		asset: RegistryAsset,
		period: HistoryPeriod,
	): Promise<HistorySeries> {
		if (period === "ALL") {
			const yahooSymbol = yahooHistorySymbol(asset);
			if (yahooSymbol) {
				const points = await this.yahooHistory(yahooSymbol).catch(() => []);
				if (points.length >= 2) {
					return {
						source: "yahoo",
						points,
						sourceAsset: yahooSymbol,
						isCompleteHistory: true,
					};
				}
			}
		}

		if (
			asset.kind === "STOCK_TOKEN" &&
			(period === "1M" || period === "1Y" || period === "ALL")
		) {
			const referencePoints = await this.nasdaqHistory(
				asset.symbol,
				period,
			).catch(() => []);
			if (referencePoints.length >= 2) {
				return {
					source: "nasdaq",
					points: referencePoints,
					sourceAsset: asset.symbol,
					isCompleteHistory: false,
				};
			}
		}

		const id =
			asset.coingeckoId ??
			COINGECKO_HISTORY_ID_OVERRIDES[asset.symbol] ??
			COINGECKO_COIN_IDS[asset.symbol];
		const isSolana = asset.assetId.startsWith("sol:");
		if (!id && !isSolana)
			return { source: "coingecko", points: [], isCompleteHistory: false };
		const days = historyDays(period);
		const historyKey = id ?? `solana:${asset.address}`;
		const points = await this.cachedResponse(
			`history:${historyKey}:${days}`,
			HISTORY_CACHE_TTL_MS,
			async () => {
				const endpoint = id
					? `/coins/${encodeURIComponent(id)}/market_chart`
					: `/coins/solana/contract/${encodeURIComponent(asset.address)}/market_chart`;
				const response = await this.fetcher(
					`${COINGECKO_API_URL}${endpoint}?vs_currency=usd&days=${days}&precision=full`,
					{
						headers: this.headers(),
						signal: AbortSignal.timeout(10_000),
					},
				);
				if (!response.ok)
					throw new Error(`COINGECKO_HISTORY_${response.status}`);
				const body = (await response.json()) as {
					prices?: Array<[number, number]>;
				};
				return (body.prices ?? []).flatMap(([timestamp, price]) =>
					Number.isFinite(timestamp) && Number.isFinite(price) && price > 0
						? [{ timestamp: Math.floor(timestamp / 1_000), price }]
						: [],
				);
			},
		);
		if (period !== "1H") {
			return {
				source: "coingecko",
				points: normalizeHistoryPoints(points),
				sourceAsset: historyKey,
				isCompleteHistory: period !== "ALL",
			};
		}
		const latest = points.at(-1)?.timestamp ?? 0;
		return {
			source: "coingecko",
			points: points.filter((point) => point.timestamp >= latest - 60 * 60),
			sourceAsset: historyKey,
			isCompleteHistory: true,
		};
	}

	private async yahooHistory(symbol: string): Promise<PricePoint[]> {
		return this.cachedResponse(
			`yahoo:${symbol}:max`,
			HISTORY_CACHE_TTL_MS,
			async () => {
				const response = await this.fetcher(
					`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=max&interval=1d&events=history`,
					{
						headers: {
							Accept: "application/json",
							"User-Agent": "SwipeFi/1.0 market-history",
						},
						signal: AbortSignal.timeout(10_000),
					},
				);
				if (!response.ok) return [];
				const body = (await response.json()) as {
					chart?: {
						result?: Array<{
							timestamp?: number[];
							indicators?: {
								adjclose?: Array<{ adjclose?: Array<number | null> }>;
								quote?: Array<{ close?: Array<number | null> }>;
							};
						}>;
					};
				};
				const result = body.chart?.result?.[0];
				const timestamps = result?.timestamp ?? [];
				const prices =
					result?.indicators?.adjclose?.[0]?.adjclose ??
					result?.indicators?.quote?.[0]?.close ??
					[];
				return normalizeHistoryPoints(
					timestamps.flatMap((timestamp, index) => {
						const price = prices[index];
						return Number.isFinite(timestamp) &&
							typeof price === "number" &&
							Number.isFinite(price) &&
							price > 0
							? [{ timestamp: Math.floor(timestamp), price }]
							: [];
					}),
				);
			},
		);
	}

	private async nasdaqHistory(
		symbol: string,
		period: "1M" | "1Y" | "ALL",
	): Promise<PricePoint[]> {
		const lookbackDays = period === "1M" ? 35 : 370;
		const fromDate =
			period === "ALL"
				? "1970-01-01"
				: new Date(Date.now() - lookbackDays * 86_400_000)
						.toISOString()
						.slice(0, 10);
		return this.cachedResponse(
			`nasdaq:${symbol}:${fromDate}`,
			HISTORY_CACHE_TTL_MS,
			async () => {
				const response = await this.fetcher(
					`${NASDAQ_API_URL}/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${fromDate}&limit=5000`,
					{
						headers: {
							Accept: "application/json",
							"User-Agent": "SwipeFi/1.0 market-history",
						},
						signal: AbortSignal.timeout(10_000),
					},
				);
				if (!response.ok) return [];
				const body = (await response.json()) as {
					data?: {
						tradesTable?: {
							rows?: Array<{ date?: string; close?: string }>;
						};
					} | null;
				};
				return (body.data?.tradesTable?.rows ?? [])
					.flatMap((row) => {
						const timestamp = parseNasdaqDate(row.date);
						const price = Number(row.close?.replace(/[^\d.-]/g, ""));
						return timestamp && Number.isFinite(price) && price > 0
							? [{ timestamp, price }]
							: [];
					})
					.sort((left, right) => left.timestamp - right.timestamp);
			},
		);
	}

	private headers(): Record<string, string> | undefined {
		return this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : undefined;
	}

	private async cachedResponse<T>(
		key: string,
		ttlMs: number,
		load: () => Promise<T>,
	): Promise<T> {
		const cached = this.responseCache.get(key);
		if (cached && cached.expiresAt > Date.now()) return cached.value as T;
		const durable = await this.durableCache
			?.getProviderSnapshot(`coingecko:${key}`)
			.catch(() => undefined);
		if (durable && Date.parse(durable.expiresAt) > Date.now()) {
			this.responseCache.set(key, {
				expiresAt: Date.parse(durable.expiresAt),
				value: durable.value,
			});
			return durable.value as T;
		}
		const pending = this.inFlight.get(key);
		if (pending) return pending as Promise<T>;
		const request = load()
			.then((value) => {
				const expiresAt = Date.now() + ttlMs;
				this.responseCache.set(key, { expiresAt, value });
				void this.durableCache
					?.setProviderSnapshot(
						`coingecko:${key}`,
						"coingecko",
						value,
						new Date(expiresAt).toISOString(),
					)
					.catch(() => undefined);
				return value;
			})
			.finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, request);
		return request;
	}
}

function positiveNumber(value: string | number | null | undefined) {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveInteger(value: number | null | undefined) {
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

function socialHandle(value: unknown): string | undefined {
	return typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value)
		? value
		: undefined;
}

function dedupeLinks<T extends { label: string; url?: string }>(items: T[]): T[] {
	return [
		...new Map(
			items.map((item) => [item.url ?? item.label, item] as const),
		).values(),
	];
}

function validIsoDate(value: string | undefined): string | undefined {
	return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function onchainKey(chain: "SOLANA", address: string) {
	return `${chain}:${address}`;
}

function parseNasdaqDate(value: string | undefined): number | undefined {
	const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? "");
	if (!match) return undefined;
	const [, month, day, year] = match;
	return Math.floor(
		Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1_000,
	);
}

function yahooHistorySymbol(asset: RegistryAsset) {
	if (asset.kind === "STOCK_TOKEN") {
		return YAHOO_STOCK_SYMBOLS[asset.symbol.toUpperCase()] ?? asset.symbol;
	}
	return YAHOO_CRYPTO_SYMBOLS[asset.symbol.toUpperCase()];
}

function normalizeHistoryPoints(points: PricePoint[]): PricePoint[] {
	return [
		...new Map(
			points
				.filter(
					(point) =>
						Number.isFinite(point.timestamp) &&
						Number.isFinite(point.price) &&
						point.price > 0,
				)
				.map((point) => [Math.floor(point.timestamp), point] as const),
		).values(),
	].sort((left, right) => left.timestamp - right.timestamp);
}

function historyDays(period: HistoryPeriod): "1" | "7" | "30" | "365" {
	if (period === "1H" || period === "1D") return "1";
	if (period === "1W") return "7";
	if (period === "1M") return "30";
	// Demo plans are bounded to one year. The response explicitly marks this
	// fallback as limited so the UI never presents it as complete history.
	return "365";
}
