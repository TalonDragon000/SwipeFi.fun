import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import { rankingInputSchema } from "../src/domain/schemas.js";
import { DeterministicRanker } from "../src/server/adapters/deterministic-ranker.js";
import { DemoProvider } from "../src/server/adapters/demo.js";

async function inputWithRanks() {
	const candidates = (await new DemoProvider().getRankingCandidates(3)).map(
		(candidate, index) => ({
			...candidate,
			liquidityUsd: 1_000_000,
			volume24hUsd: 500_000,
			organicScore: 70,
			verified: true,
			marketCapRank: index === 0 ? 400 : index === 1 ? 10 : undefined,
			marketCapRankSource: index < 2 ? ("coingecko" as const) : undefined,
		}),
	);
	const unsigned = {
		schemaVersion: "investmade-ranking-input/v1" as const,
		sessionId: "deterministic-session",
		epochId: "2026-W31",
		policyVersion: "investmade-policy/v1" as const,
		budget: {
			periodBudgetBaseUnits: "100000000",
			slotBudgetBaseUnits: "10000000",
			maxCards: 10,
		},
		preferences: {
			cadence: "weekly" as const,
			ticketSizeUsd: 10,
			riskMode: "balanced" as const,
			assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			feedRankingProvider: "DETERMINISTIC" as const,
		},
		candidates,
	};
	return rankingInputSchema.parse({
		...unsigned,
		inputCommitment: sha256(unsigned),
	});
}

describe("deterministic ranking", () => {
	it("uses CoinGecko rank as a bounded signal and records the effective provider", async () => {
		const input = await inputWithRanks();
		const result = await new DeterministicRanker().rank(input);
		const rank10 = result.output.assets.find(
			(asset) => asset.assetId === input.candidates[1]?.assetId,
		);
		const rank400 = result.output.assets.find(
			(asset) => asset.assetId === input.candidates[0]?.assetId,
		);

		expect(rank10?.scoreBps).toBeGreaterThan(rank400?.scoreBps ?? 0);
		expect(rank10?.reason).toContain("CoinGecko market-cap rank #10");
		expect(result.receipt).toMatchObject({
			requestedProvider: "DETERMINISTIC",
			effectiveProvider: "DETERMINISTIC",
			teeVerified: false,
		});
	});

	it("treats a missing CoinGecko rank as unknown rather than rejecting the asset", async () => {
		const input = await inputWithRanks();
		const result = await new DeterministicRanker().rank(input);
		expect(result.output.assets.map((asset) => asset.assetId)).toContain(
			input.candidates[2]?.assetId,
		);
	});

	it("deterministically alternates stocks and crypto", async () => {
		const input = await inputWithRanks();
		const base = input.candidates[0];
		if (!base) throw new Error("Expected a candidate");
		const candidates = ["CRYPTO", "STOCK_TOKEN", "CRYPTO", "STOCK_TOKEN"].map(
			(kind, index) => ({
				...base,
				assetId: `rh:4663:MIX_${index}`,
				symbol: `MIX${index}`,
				kind: kind as "CRYPTO" | "STOCK_TOKEN",
				discoveryRank: index + 1,
			}),
		);
		const { inputCommitment: _commitment, ...unsigned } = input;
		const mixedInput = rankingInputSchema.parse({
			...unsigned,
			candidates,
			inputCommitment: sha256({ ...unsigned, candidates }),
		});
		const ranker = new DeterministicRanker();
		const first = await ranker.rank(mixedInput);
		const second = await ranker.rank(mixedInput);
		const kindById = new Map(candidates.map((candidate) => [candidate.assetId, candidate.kind]));
		const kinds = first.output.assets.map((asset) => kindById.get(asset.assetId));

		expect(first.output.assets).toEqual(second.output.assets);
		expect(kinds[0]).not.toBe(kinds[1]);
		expect(kinds[1]).not.toBe(kinds[2]);
		expect(kinds[2]).not.toBe(kinds[3]);
	});
});
