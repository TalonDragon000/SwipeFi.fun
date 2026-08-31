import type { RegistryAsset } from "../../domain/solana.js";
import type {
	Candidate,
	ExecutionProviderId,
	ExecutionRequest,
	FeedRankingProviderId,
	Quote,
	RankingCandidate,
	RankingInput,
	RankingOutput,
} from "../../domain/schemas.js";

export type CandidateDiscoveryOptions = {
	includeCommunity?: boolean;
	riskMode?: "conservative" | "balanced" | "degen";
};

export interface ProviderSnapshotCache {
	getProviderSnapshot(
		key: string,
	): Promise<{ value: unknown; expiresAt: string } | undefined>;
	setProviderSnapshot(
		key: string,
		provider: string,
		value: unknown,
		expiresAt: string,
	): Promise<void>;
}

export interface SolanaPreparedTransaction {
	kind: "SOLANA_TRANSACTION";
	unsignedTransactionBase64: string;
	messageCommitment: `sha256:${string}`;
	recentBlockhash: string;
	lastValidBlockHeight: number;
	expectedBalanceChanges: Array<{
		assetId: string;
		mint: string;
		minimumAmountOut: string;
	}>;
}

export interface AssetDiscoveryProvider {
	getRankingCandidates(
		limit: number,
		excludedAssetIds?: string[],
		options?: CandidateDiscoveryOptions,
	): Promise<RankingCandidate[]>;
}

export interface AssetEnrichmentProvider {
	enrichRankingCandidates(
		candidates: RankingCandidate[],
	): Promise<RankingCandidate[]>;
}

export interface ExecutionEligibilityProvider {
	getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
		txOrigin?: string,
	): Promise<Candidate[]>;
	getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits?: string,
		now?: Date,
		txOrigin?: string,
	): Promise<Candidate[]>;
}

export interface CandidateProvider
	extends AssetDiscoveryProvider,
		ExecutionEligibilityProvider {
	getAsset?(assetId: string): Promise<RegistryAsset | undefined>;
	getCandidates(
		wallet: string,
		amountInBaseUnits?: string,
		now?: Date,
		limit?: number,
		excludedAssetIds?: string[],
		options?: CandidateDiscoveryOptions,
		txOrigin?: string,
	): Promise<Candidate[]>;
}

export interface PrivateInferenceProvider {
	rank(input: RankingInput): Promise<{
		output: RankingOutput;
		receipt: {
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
	}>;
}

export interface FeedRankingProvider extends PrivateInferenceProvider {}

export interface ExecutionProvider {
	readonly id: ExecutionProviderId;
	readonly label: string;
	price(
		wallet: string,
		txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
	): Promise<Quote>;
	prepareBasket(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		txOrigin?: string,
	): Promise<{
		quotes: Quote[];
		solanaTransaction?: SolanaPreparedTransaction;
		solanaTransactions?: SolanaPreparedTransaction[];
		unavailableAssetIds?: string[];
	}>;
	health(): Promise<{
		available: boolean;
		status: "CONFIGURED" | "UNAVAILABLE";
	}>;
	prepareExit(
		wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
		txOrigin?: string,
	): Promise<{
		quote: Quote;
		solanaTransaction?: SolanaPreparedTransaction;
	}>;
	submitSignedTransaction?(
		prepared: SolanaPreparedTransaction,
		signedTransactionBase64: string,
	): Promise<string>;
	transactionStatus?(signature: string): Promise<{
		state: "PENDING" | "FAILED" | "CONFIRMED";
		slot?: number;
	}>;
	reconcileOutputs?(
		signature: string,
		wallet: string,
		expected: SolanaPreparedTransaction["expectedBalanceChanges"],
	): Promise<
		| Array<{
				assetId: string;
				amountOutBaseUnits: string;
				transactionHash: string;
				blockNumber?: string;
				status: "success" | "failed";
		  }>
		| undefined
	>;
}

export type NormalizedExecutionError =
	| "TOKEN_UNAUTHORIZED"
	| "INSUFFICIENT_LIQUIDITY"
	| "UNSUPPORTED_CHAIN"
	| "INVALID_TOKEN"
	| "INVALID_TRANSACTION"
	| "INSUFFICIENT_FUNDS"
	| "SIMULATION_FAILED"
	| "BASKET_TOO_LARGE"
	| "PROVIDER_UNAVAILABLE";

export class ExecutionProviderError extends Error {
	constructor(
		public readonly provider: ExecutionProviderId,
		public readonly code: NormalizedExecutionError,
		message: string,
		public readonly upstreamReason?: string,
	) {
		super(message);
		this.name = "ExecutionProviderError";
	}
}
