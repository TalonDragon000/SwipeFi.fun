import { randomUUID } from "node:crypto";
import { sha256 } from "../../domain/canonical.js";
import {
	DEFAULT_SLOT_BUDGET,
	FEED_PAGE_SIZE,
} from "../../domain/constants.js";
import { unitPriceUsdFromQuote } from "../../domain/price.js";
import type {
	Candidate,
	ExecutionProviderId,
	ExecutionRequest,
	FeedInput,
	FeedOutput,
	RankingCandidate,
	RankingInput,
	RankingOutput,
} from "../../domain/schemas.js";
import {
	SOLANA_ASSET_REGISTRY,
	SOLANA_USDC_MINT,
} from "../../domain/solana.js";
import type {
	CandidateDiscoveryOptions,
	CandidateProvider,
	ExecutionProvider,
	PrivateInferenceProvider,
} from "./types.js";

const outputs: Record<string, string> = {
	SOL: "50000000",
	JUP: "25000000",
	AAPLx: "150000000",
	NVDAx: "48070000000000000",
	TSLAx: "30780000000000000",
};

function demoRouting(id: ExecutionProviderId): "ZERO_EX" | "JUPITER" {
	return id === "ZERO_EX" ? "ZERO_EX" : "JUPITER";
}

const demoMeta: Record<
	string,
	{ priceImpactBps: number; crowdScoreBps: number; reason: string }
> = {
	SOL: {
		priceImpactBps: 19,
		crowdScoreBps: 6_100,
		reason: "Positive crypto breadth and an executable low-impact route.",
	},
	JUP: {
		priceImpactBps: 24,
		crowdScoreBps: 5_500,
		reason: "Fresh Solana route with healthy liquidity.",
	},
	AAPLx: {
		priceImpactBps: 33,
		crowdScoreBps: 4_810,
		reason: "Strong crowd signal with acceptable estimated route impact.",
	},
	NVDAx: {
		priceImpactBps: 31,
		crowdScoreBps: 5_340,
		reason: "Healthy market state and a current route within the policy limit.",
	},
	TSLAx: {
		priceImpactBps: 18,
		crowdScoreBps: 4_480,
		reason: "Active market state and a fresh route within the policy limit.",
	},
};

export class DemoProvider
	implements CandidateProvider, PrivateInferenceProvider, ExecutionProvider
{
	readonly label: string;

	constructor(readonly id: ExecutionProviderId = "JUPITER") {
		this.label = id === "ZERO_EX" ? "0x demo" : "Jupiter demo";
	}

	async health() {
		return { available: true, status: "CONFIGURED" as const };
	}

	async getRankingCandidates(
		limit: number,
		excludedAssetIds: string[] = [],
		_discoveryOptions: CandidateDiscoveryOptions = {},
	): Promise<RankingCandidate[]> {
		const excluded = new Set(excludedAssetIds);
		return Object.values(SOLANA_ASSET_REGISTRY)
			.filter(
				(asset) =>
					Boolean(outputs[asset.symbol] && demoMeta[asset.symbol]) &&
					!excluded.has(asset.assetId),
			)
			.slice(0, limit)
			.map((asset, index) => ({
				chain: "SOLANA" as const,
				assetId: asset.assetId,
				symbol: asset.symbol,
				name: asset.name,
				kind: asset.kind,
				contract: asset.address,
				decimals: asset.decimals,
				discoveryRank: index + 1,
				primaryClassification:
					asset.kind === "STOCK_TOKEN"
						? ("TOKENIZED_STOCK" as const)
						: ("CRYPTO" as const),
				classificationConfidence: "HIGH" as const,
				tags: [asset.kind === "STOCK_TOKEN" ? "stock" : "crypto"],
				riskFlags: [],
				classificationEvidence: [`demo:registry:${asset.symbol}`],
				marketDataSource: "demo" as const,
			}));
	}

	async getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const candidates = await this.getCandidates(
			wallet,
			amountInBaseUnits,
			now,
			Object.keys(outputs).length,
		);
		const byId = new Map(
			candidates.map((candidate) => [candidate.assetId, candidate]),
		);
		return rankedAssetIds
			.flatMap((assetId) => byId.get(assetId) ?? [])
			.slice(0, limit)
			.map(({ quote: _quote, ...candidate }) => candidate);
	}

	async getCandidates(
		_wallet: string,
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		limit = FEED_PAGE_SIZE,
		excludedAssetIds: string[] = [],
		_discoveryOptions: CandidateDiscoveryOptions = {},
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const excluded = new Set(excludedAssetIds);
		const expiresAt = new Date(now.getTime() + 60_000).toISOString();
		const amount = BigInt(amountInBaseUnits);
		return Object.values(SOLANA_ASSET_REGISTRY)
			.filter(
				(asset) =>
					Boolean(outputs[asset.symbol] && demoMeta[asset.symbol]) &&
					!excluded.has(asset.assetId),
			)
			.slice(0, limit)
			.map((asset) => {
				const baseEstimate = outputs[asset.symbol];
				const meta = demoMeta[asset.symbol];
				if (!baseEstimate || !meta)
					throw new Error(`DEMO_FIXTURE_MISSING_${asset.symbol}`);
				const estimated = (
					(BigInt(baseEstimate) * amount) /
					DEFAULT_SLOT_BUDGET
				).toString();
				const minimum = ((BigInt(estimated) * 995n) / 1000n).toString();
				const unitPriceUsd = unitPriceUsdFromQuote(
					amountInBaseUnits,
					estimated,
					asset.decimals,
				);
				return {
					...asset,
					chain: "SOLANA" as const,
					contract: asset.address,
					eligible: true,
					marketHealthy: true,
					permissionAllowed: true,
					marketPriceUsd: Number(unitPriceUsd),
					marketDataSource: "demo" as const,
					quote: {
						requestId: `demo-quote-${asset.symbol.toLowerCase()}-${randomUUID()}`,
						provider: this.id,
						chain: "SOLANA" as const,
						assetId: asset.assetId,
						tokenOut: asset.address,
						amountInBaseUnits,
						estimatedAmountOut: estimated,
						minimumAmountOut: minimum,
						unitPriceUsd,
						priceImpactBps: meta.priceImpactBps,
						routing: demoRouting(this.id),
						quotedAt: now.toISOString(),
						expiresAt,
					},
					crowdScoreBps: meta.crowdScoreBps,
					reason: meta.reason,
					evidenceIds: [
						`demo:market:${asset.symbol}`,
						`demo:crowd:${asset.symbol}`,
						`demo:quote:${asset.symbol}`,
					],
				};
			});
	}

	async getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const selected = new Set(assetIds);
		return (
			await this.getCandidates(
				wallet,
				amountInBaseUnits,
				now,
				Object.keys(outputs).length,
			)
		).filter((candidate) => selected.has(candidate.assetId));
	}

	async rank(input: RankingInput) {
		const assets = input.candidates.map((candidate, index) => ({
			assetId: candidate.assetId,
			rank: index + 1,
			scoreBps: 7_420 - index * 410,
			reason: `Demo preference match for ${candidate.symbol}.`,
		}));
		const output: RankingOutput = {
			schemaVersion: "investmade-ranking-output/v1",
			sessionId: input.sessionId,
			inputCommitment: input.inputCommitment,
			policyVersion: "investmade-policy/v1",
			regime: "CRYPTO_BULLISH",
			assets,
			warnings: [
				"Demo evidence is deterministic and cannot be used for mainnet execution.",
			],
		};
		return {
			output,
			receipt: {
				network: "LOCAL_DEMO",
				model: "deterministic-fixture/v1",
				provider: "local",
				teeVerified: false,
				inputCommitment: input.inputCommitment,
				outputCommitment: sha256(output),
			},
		};
	}

	async generate(input: FeedInput, candidates: Candidate[]) {
		const output: FeedOutput = {
			schemaVersion: "investmade-feed-output/v1",
			sessionId: input.sessionId,
			inputCommitment: input.inputCommitment,
			policyVersion: "investmade-policy/v1",
			regime: "CRYPTO_BULLISH",
			cards: candidates.map((candidate, index) => ({
				assetId: candidate.assetId,
				action: "BUY",
				rank: index + 1,
				amountInBaseUnits: input.budget.slotBudgetBaseUnits,
				scoreBps: 7_420 - index * 410,
				evidenceIds: candidate.evidenceIds,
				reason: candidate.reason,
			})),
			warnings: [
				"Demo evidence is deterministic and cannot be used for mainnet execution.",
			],
		};
		return {
			output,
			receipt: {
				network: "LOCAL_DEMO",
				model: "deterministic-fixture/v1",
				provider: "local",
				teeVerified: false,
				inputCommitment: input.inputCommitment,
				outputCommitment: sha256(output),
			},
		};
	}

	async prepareBasket(
		_wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		_txOrigin?: string,
	) {
		const selected = new Set(
			request.selections.map((selection) => selection.assetId),
		);
		return {
			quotes: candidates
				.filter((candidate) => selected.has(candidate.assetId))
				.flatMap((candidate) => candidate.quote ?? []),
		};
	}

	async prepare(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		txOrigin?: string,
	) {
		return this.prepareBasket(wallet, request, candidates, txOrigin);
	}

	async price(
		wallet: string,
		_txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		_slippageBps: number,
	) {
		const priced = await this.getCandidatesForExecution(
			wallet,
			[candidate.assetId],
			amountInBaseUnits,
		);
		const quote = priced[0]?.quote;
		if (!quote) throw new Error("DEMO_QUOTE_UNAVAILABLE");
		return quote;
	}

	async prepareExit(
		_wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		_slippageBps: number,
		_txOrigin?: string,
	) {
		const now = new Date();
		return {
			quote: {
				requestId: `demo-exit-${candidate.symbol.toLowerCase()}-${randomUUID()}`,
				provider: this.id,
				chain: "SOLANA" as const,
				assetId: candidate.assetId,
				tokenOut: SOLANA_USDC_MINT,
				amountInBaseUnits,
				estimatedAmountOut: DEFAULT_SLOT_BUDGET.toString(),
				minimumAmountOut: ((DEFAULT_SLOT_BUDGET * 995n) / 1000n).toString(),
				unitPriceUsd: "1",
				priceImpactBps: demoMeta[candidate.symbol]?.priceImpactBps ?? 0,
				routing: demoRouting(this.id),
				quotedAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + 60_000).toISOString(),
			},
		};
	}
}
