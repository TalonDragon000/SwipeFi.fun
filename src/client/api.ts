import type {
	AppChain,
	Candidate,
	ExecutionPlan,
	ExecutionProviderId,
	FeedOutput,
	FeedRankingProviderId,
	OnboardingPreferences,
	Quote,
} from "../domain/schemas.js";
import { SOLANA_USDC_MINT } from "../domain/solana.js";
import { ticketSizeToBaseUnits } from "../domain/schemas.js";

export interface WeeklySession {
	id: string;
	epochId: string;
	chain: AppChain;
	wallet: string;
	executionProvider: ExecutionProviderId;
	feedRankingProvider: FeedRankingProviderId;
	status: string;
}

export interface FeedResponse {
	candidates: Candidate[];
	feed: FeedOutput;
	hasMore: boolean;
	rankedAssetCount: number;
	proof: {
		network: string;
		model: string;
		provider: string;
		teeVerified: boolean;
		inputCommitment: string;
		outputCommitment: string;
		requestedProvider?: FeedRankingProviderId;
		effectiveProvider?: FeedRankingProviderId;
		warnings?: string[];
	};
}

export interface ExecutionRecord {
	plan: ExecutionPlan;
	status: "PREPARED" | "SUBMITTED" | "SETTLED" | "PARTIAL" | "FAILED";
	submissionMode: "SEQUENTIAL" | "BATCH";
	transactionHashes: string[];
	settledOutputs: Array<{
		assetId: string;
		amountOutBaseUnits: string;
		transactionHash: string;
		blockNumber?: string;
		status: "success" | "failed";
	}>;
	settledAt?: string;
	solanaTransaction?: NonNullable<ExecutionPlan["solanaTransaction"]>;
	solanaTransactions?: NonNullable<ExecutionPlan["solanaTransactions"]>;
}

export interface ExitPreparation {
	kind: "SOLANA_TRANSACTION";
	provider: ExecutionProviderId;
	asset: { assetId: string; symbol: string; decimals: number };
	quote: Quote;
	solanaTransaction?: NonNullable<ExecutionPlan["solanaTransaction"]>;
}

export interface PublicConfig {
	demoMode: boolean;
	executionMode: "demo" | "local-live" | "live";
	cluster: "mainnet-beta";
	stableToken: "USDC";
	inputMint: string;
	executionProviders: {
		JUPITER: { available: boolean };
		ZERO_EX: { available: boolean };
	};
	feedRankingProviders: Record<FeedRankingProviderId, { available: boolean }>;
	maxCards: number;
	privy: { appId: string };
}

export interface AssetIconsResponse {
	icons: Record<string, string>;
}

export interface AssetHistoryResponse {
	period: HistoryPeriod;
	source: "coingecko" | "nasdaq" | "yahoo" | "demo" | "unavailable";
	points: Array<{ timestamp: number; price: number }>;
	requestedPeriod?: HistoryPeriod;
	effectivePeriod?: HistoryPeriod | "MAX" | "LIMITED";
	coverageStart?: number;
	coverageEnd?: number;
	sourceAsset?: string;
	isCompleteHistory?: boolean;
}

export interface AssetDetailsResponse {
	assetId: string;
	source: "coingecko" | "geckoterminal" | "unavailable";
	coingeckoId?: string;
	categories: string[];
	marketCapUsd?: number;
	volume24hUsd?: number;
	holderCount?: number;
	contract?: string;
	explorerUrl?: string;
	websiteUrl?: string;
	community: Array<{ label: string; url?: string; count?: number }>;
	updatedAt?: string;
}

export type HistoryPeriod = "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL";

export interface SolanaBalanceResponse {
	cluster: "mainnet-beta";
	address: string;
	solBalanceLamports: string;
	usdcBalanceBaseUnits: string;
	usdcDecimals: number;
}

export interface SolanaPortfolioResponse {
	cluster: "mainnet-beta";
	address: string;
	tokens: Array<{
		assetId: string;
		mint: string;
		symbol: string;
		name: string;
		decimals: number;
		balanceBaseUnits: string;
		iconUrl?: string;
		priceUsd?: number;
		priceUpdatedAt?: string;
	}>;
}

let authProvider:
	| {
			getAccessToken: () => Promise<string | null>;
			getWalletAddress: () => string | undefined;
			getWalletChain: () => AppChain;
	  }
	| undefined;

const historyRequests = new Map<string, Promise<AssetHistoryResponse>>();
const detailRequests = new Map<string, Promise<AssetDetailsResponse>>();

function assetDetails(assetId: string) {
	let requestForAsset = detailRequests.get(assetId);
	if (!requestForAsset) {
		requestForAsset = request<AssetDetailsResponse>(
			`/api/assets/${encodeURIComponent(assetId)}/details`,
		).catch((error) => {
			detailRequests.delete(assetId);
			throw error;
		});
		detailRequests.set(assetId, requestForAsset);
	}
	return requestForAsset;
}

function assetHistory(
	assetId: string,
	period: HistoryPeriod = "1W",
	refresh = false,
) {
	const cacheKey = `${assetId}:${period}`;
	if (refresh) historyRequests.delete(cacheKey);
	let requestForAsset = historyRequests.get(cacheKey);
	if (!requestForAsset) {
		requestForAsset = request<AssetHistoryResponse>(
			`/api/assets/${encodeURIComponent(assetId)}/history?period=${period}`,
		)
			.then((result) => {
				if (result.source === "unavailable") historyRequests.delete(cacheKey);
				return result;
			})
			.catch((error) => {
				historyRequests.delete(cacheKey);
				throw error;
			});
		historyRequests.set(cacheKey, requestForAsset);
	}
	return requestForAsset;
}

export class ApiError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly details: Record<string, unknown>,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function configureApiAuth(provider: typeof authProvider) {
	authProvider = provider;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const requestAuthProvider = authProvider;
	const token = await requestAuthProvider?.getAccessToken();
	const wallet = requestAuthProvider?.getWalletAddress();
	const chain = requestAuthProvider?.getWalletChain() ?? "SOLANA";
	const response = await fetch(path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(wallet ? { "X-Wallet-Address": wallet } : {}),
			"X-Wallet-Chain": chain,
			...init?.headers,
		},
	});
	const body = await response.json();
	if (!response.ok) {
		const details =
			body && typeof body === "object" ? (body as Record<string, unknown>) : {};
		const code =
			typeof details.error === "string" ? details.error : "REQUEST_FAILED";
		const message =
			typeof details.message === "string"
				? details.message
				: apiErrorMessage(code);
		throw new ApiError(code, message, details);
	}
	return body as T;
}

function apiErrorMessage(code: string) {
	if (code === "SESSION_NOT_FOUND")
		return "This basket session expired. Start another basket.";
	if (code === "EPOCH_ALREADY_EXECUTED") {
		return "Quotes were prepared for a different basket. Start another basket to change it.";
	}
	if (code === "EXECUTION_TERMINAL") {
		return "This basket has already been submitted. Open its receipt or start another basket.";
	}
	if (code === "INVALID_REQUEST") {
		return "Choose at least one eligible asset before continuing.";
	}
	if (code === "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES") {
		return "No executable assets matched your feed rules. Try again or adjust them in Account.";
	}
	return "The basket could not be prepared. Please try again.";
}

export const api = {
	config: () => request<PublicConfig>("/api/config"),
	preferences: () => request<OnboardingPreferences>("/api/preferences"),
	savePreferences: (preferences: OnboardingPreferences) =>
		request<OnboardingPreferences>("/api/preferences", {
			method: "POST",
			body: JSON.stringify(preferences),
		}),
	assetIcons: () => request<AssetIconsResponse>("/api/assets/icons"),
	assetDetails,
	assetHistory,
	solanaBalance: (wallet: string) =>
		request<SolanaBalanceResponse>(
			`/api/balances/${encodeURIComponent(wallet)}/solana`,
		),
	solanaPortfolio: (wallet: string) =>
		request<SolanaPortfolioResponse>(
			`/api/portfolio/${encodeURIComponent(wallet)}/solana`,
		),
	openSession: (
		cadence: OnboardingPreferences["cadence"],
		executionProvider: ExecutionProviderId = "JUPITER",
		chain: AppChain = "SOLANA",
		feedRankingProvider: FeedRankingProviderId = "ZERO_G",
	) =>
		request<WeeklySession>("/api/sessions/open", {
			method: "POST",
			body: JSON.stringify({
				cadence,
				executionProvider,
				chain,
				feedRankingProvider,
			}),
		}),
	generateFeed: (
		sessionId: string,
		preferences: OnboardingPreferences,
		excludedAssetIds: string[] = [],
	) =>
		request<FeedResponse>(`/api/sessions/${sessionId}/feed`, {
			method: "POST",
			body: JSON.stringify({ ...preferences, excludedAssetIds }),
		}),
	prepareExecution: (
		sessionId: string,
		assetIds: string[],
		ticketSizeUsd: number,
		periodLimitUsd: number,
	) =>
		request<ExecutionRecord>("/api/executions/prepare", {
			method: "POST",
			body: JSON.stringify({
				sessionId,
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				periodLimitUsd,
				selections: assetIds.map((assetId) => ({
					assetId,
					amountInBaseUnits: ticketSizeToBaseUnits(ticketSizeUsd).toString(),
				})),
				slippageBps: 50,
			}),
		}),
	demoSettle: (executionId: string) =>
		request<ExecutionRecord>(`/api/executions/${executionId}/demo-settle`, {
			method: "POST",
		}),
	markSubmitted: (
		executionId: string,
		transactionHashes: string[],
		batched = false,
	) =>
		request<ExecutionRecord>(`/api/executions/${executionId}/submitted`, {
			method: "POST",
			body: JSON.stringify({ transactionHashes, batched }),
		}),
	submitSolana: (executionId: string, signedTransactions: string[]) =>
		request<ExecutionRecord>(`/api/executions/${executionId}/submitted`, {
			method: "POST",
			body: JSON.stringify({ signedTransactions }),
		}),
	reconcile: (executionId: string) =>
		request<ExecutionRecord>(`/api/executions/${executionId}/reconcile`, {
			method: "POST",
		}),
	execution: (executionId: string) =>
		request<ExecutionRecord>(`/api/executions/${executionId}`),
	prepareExit: (assetId: string, amountInBaseUnits: string) =>
		request<ExitPreparation>(
			`/api/positions/${encodeURIComponent(assetId)}/exit/quote`,
			{
				method: "POST",
				body: JSON.stringify({ amountInBaseUnits }),
			},
		),
	submitSolanaExit: (assetId: string, signedTransaction: string) =>
		request<{ signature: string; status: "SUBMITTED" }>(
			`/api/positions/${encodeURIComponent(assetId)}/exit/submit`,
			{
				method: "POST",
				body: JSON.stringify({ signedTransaction }),
			},
		),
	solanaExitStatus: (assetId: string) =>
		request<{
			signature: string;
			status: "PENDING" | "FAILED" | "SETTLED";
		}>(`/api/positions/${encodeURIComponent(assetId)}/exit/status`),
};
