import { sha256 } from "../../domain/canonical.js";
import type {
	RankingCandidate,
	RankingInput,
	RankingOutput,
} from "../../domain/schemas.js";
import type { FeedRankingProvider } from "./types.js";

const MODEL_VERSION = "deterministic-market/v1";

export class DeterministicRanker implements FeedRankingProvider {
	async rank(input: RankingInput) {
		const scored = input.candidates
			.map((candidate) => ({
				candidate,
				scoreBps: scoreCandidate(candidate, input),
			}))
			.sort(
				(left, right) =>
					right.scoreBps - left.scoreBps ||
					left.candidate.discoveryRank - right.candidate.discoveryRank ||
					left.candidate.assetId.localeCompare(right.candidate.assetId),
			);
		const crypto = scored.filter(({ candidate }) => candidate.kind === "CRYPTO");
		const stocks = scored.filter(
			({ candidate }) => candidate.kind === "STOCK_TOKEN",
		);
		const groups =
			Number.parseInt(input.inputCommitment.at(-1) ?? "0", 16) % 2
				? [stocks, crypto]
				: [crypto, stocks];
		// ponytail: deterministic alternation; weighted mixing only if users ask for it.
		const mixed = Array.from(
			{ length: Math.max(crypto.length, stocks.length) },
			(_, index) => groups.flatMap((group) => group[index] ?? []),
		).flat();
		const output: RankingOutput = {
			schemaVersion: "investmade-ranking-output/v1",
			sessionId: input.sessionId,
			inputCommitment: input.inputCommitment,
			policyVersion: input.policyVersion,
			regime: marketRegime(input.candidates),
			assets: mixed.map(({ candidate, scoreBps }, index) => ({
				assetId: candidate.assetId,
				rank: index + 1,
				scoreBps,
				reason: rankingReason(candidate, input),
			})),
			warnings: [],
		};
		return {
			output,
			receipt: {
				network: "SwipeFi server",
				model: MODEL_VERSION,
				provider: "deterministic",
				teeVerified: false,
				inputCommitment: input.inputCommitment,
				outputCommitment: sha256(output),
				requestedProvider: "DETERMINISTIC" as const,
				effectiveProvider: "DETERMINISTIC" as const,
			},
		};
	}
}

function scoreCandidate(candidate: RankingCandidate, input: RankingInput) {
	const liquidity = logarithmicSignal(candidate.liquidityUsd, 2_000);
	const volume = logarithmicSignal(candidate.volume24hUsd, 1_400);
	const organic = Math.round((candidate.organicScore ?? 40) * 18);
	const marketRank = candidate.marketCapRank
		? Math.max(0, 900 - Math.round(Math.log10(candidate.marketCapRank + 1) * 260))
		: 250;
	const confidence =
		candidate.classificationConfidence === "HIGH"
			? 650
			: candidate.classificationConfidence === "MEDIUM"
				? 350
				: 100;
	const verification = candidate.verified ? 700 : 0;
	const riskPenalty = Math.min(candidate.riskFlags.length * 300, 1_800);
	const momentumWeight =
		input.preferences.riskMode === "degen"
			? 35
			: input.preferences.riskMode === "balanced"
				? 20
				: 8;
	const momentum = Math.max(
		-700,
		Math.min(700, Math.round((candidate.priceChange24hPct ?? 0) * momentumWeight)),
	);
	const discoveryTieBreak = Math.max(0, 100 - candidate.discoveryRank * 2);
	return Math.max(
		0,
		Math.min(
			10_000,
			2_000 +
				liquidity +
				volume +
				organic +
				marketRank +
				confidence +
				verification +
				momentum +
				discoveryTieBreak -
				riskPenalty,
		),
	);
}

function logarithmicSignal(value: number | undefined, maximum: number) {
	if (!value || value <= 0) return 0;
	return Math.min(maximum, Math.round(Math.log10(value + 1) * (maximum / 8)));
}

function rankingReason(candidate: RankingCandidate, input: RankingInput) {
	const signals: string[] = [];
	if (candidate.marketCapRank) {
		signals.push(`CoinGecko market-cap rank #${candidate.marketCapRank}`);
	}
	if (candidate.liquidityUsd) {
		signals.push(`${formatCompactUsd(candidate.liquidityUsd)} liquidity`);
	}
	if (candidate.organicScore !== undefined) {
		signals.push(`organic score ${Math.round(candidate.organicScore)}/100`);
	}
	if (!signals.length) signals.push("available market and route evidence");
	return `${candidate.symbol} fits the ${input.preferences.riskMode} plan using ${signals.slice(0, 3).join(", ")}.`;
}

function marketRegime(candidates: RankingCandidate[]): RankingOutput["regime"] {
	const changes = candidates.flatMap((candidate) =>
		candidate.priceChange24hPct === undefined
			? []
			: candidate.priceChange24hPct,
	);
	if (!changes.length) return "CRYPTO_NEUTRAL";
	const average =
		changes.reduce((total, change) => total + change, 0) / changes.length;
	if (average >= 2) return "CRYPTO_BULLISH";
	if (average <= -4) return "RISK_OFF";
	if (average <= -1) return "CRYPTO_BEARISH";
	return "CRYPTO_NEUTRAL";
}

function formatCompactUsd(value: number) {
	return `$${Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value)}`;
}
