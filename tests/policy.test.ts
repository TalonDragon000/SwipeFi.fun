import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import {
	eligibleCandidates,
	eligibleFeedCandidates,
	PolicyError,
	validateFeed,
	validateExecutionAssets,
	validateRanking,
} from "../src/domain/policy.js";
import {
	budgetForTicket,
	DEFAULT_BUDGET,
	feedInputSchema,
	feedOutputSchema,
	rankingInputSchema,
} from "../src/domain/schemas.js";
import { SOLANA_ASSET_REGISTRY } from "../src/domain/solana.js";
import { DemoProvider } from "../src/server/adapters/demo.js";

describe("deterministic feed policy", () => {
	it("does not re-filter provider-quoted feed candidates", async () => {
		const candidate = (await new DemoProvider().getCandidates("0x0"))[0];
		if (!candidate) throw new Error("Expected a demo candidate");
		expect(
			eligibleFeedCandidates([
				{
					...candidate,
					assetId: "rh:4663:0x020bfc650a365f8bb26819deaabf3e21291018b4",
					marketPriceUsd: undefined,
					marketDataSource: undefined,
				},
			]),
		).toHaveLength(1);
	});

	it("accepts only fresh, registered, executable candidates", async () => {
		const now = new Date("2026-07-25T12:00:00.000Z");
		const candidates = await new DemoProvider().getCandidates(
			"0x0",
			"10000000",
			now,
		);
		expect(eligibleCandidates(candidates, now)).toHaveLength(10);

		const firstCandidate = candidates[0];
		if (!firstCandidate?.quote)
			throw new Error("Expected a quoted demo candidate");
		firstCandidate.quote.expiresAt = new Date(now.getTime() - 1).toISOString();
		expect(eligibleCandidates(candidates, now)).toHaveLength(9);
	});

	it("accepts canonical curated and mint-address Solana candidates", async () => {
		const now = new Date("2026-07-25T12:00:00.000Z");
		const [base] = await new DemoProvider().getCandidates("0x0", "100000", now);
		if (!base?.quote) throw new Error("Expected a quoted demo candidate");
		const sol = SOLANA_ASSET_REGISTRY.SOL;
		if (!sol) throw new Error("Expected the curated SOL asset");
		const mint = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
		const candidates = [
			{
				...base,
				chain: "SOLANA" as const,
				assetId: sol.assetId,
				symbol: sol.symbol,
				name: sol.name,
				contract: sol.address,
				decimals: sol.decimals,
			},
			{
				...base,
				chain: "SOLANA" as const,
				assetId: `sol:mainnet:${mint}`,
				symbol: "WBTC",
				name: "Wrapped Bitcoin",
				contract: mint,
				decimals: 8,
			},
		];
		const dynamicCandidate = candidates[1];
		if (!dynamicCandidate) throw new Error("Expected a dynamic candidate");

		expect(eligibleCandidates(candidates, now)).toHaveLength(2);
		expect(
			eligibleCandidates(
				[{ ...dynamicCandidate, assetId: "sol:mainnet:wrong" }],
				now,
			),
		).toHaveLength(0);
	});

	it("accepts contract-address Robinhood candidates for execution", async () => {
		const [base] = await new DemoProvider().getCandidates("0x0");
		if (!base) throw new Error("Expected a demo candidate");
		const contract = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
		const candidate = {
			...base,
			assetId: `rh:4663:${contract}`,
			contract,
			symbol: "CASHCAT",
		};

		expect(() =>
			validateExecutionAssets(
				{
					periodLimitUsd: 100,
					selections: [
						{ assetId: candidate.assetId, amountInBaseUnits: "100000" },
					],
				} as never,
				[candidate],
			),
		).not.toThrow();
	});

	it("rejects an invented asset returned by the model", async () => {
		const candidates = (await new DemoProvider().getCandidates("0x0")).slice(
			0,
			3,
		);
		const unsigned = {
			schemaVersion: "investmade-feed-input/v1" as const,
			sessionId: "session-1",
			epochId: "2026-W30",
			policyVersion: "investmade-policy/v1" as const,
			budget: DEFAULT_BUDGET,
			preferences: {
				cadence: "weekly" as const,
				ticketSizeUsd: 10,
				riskMode: "balanced" as const,
				assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			},
			candidates,
		};
		const input = feedInputSchema.parse({
			...unsigned,
			inputCommitment: sha256(unsigned),
		});
		const generated = await new DemoProvider().generate(input, candidates);
		const firstCard = generated.output.cards[0];
		if (!firstCard) throw new Error("Expected a demo card");
		firstCard.assetId = "rh:4663:INVENTED";
		expect(() =>
			validateFeed(generated.output, input, candidates),
		).toThrowError(
			new PolicyError(
				"ASSET_NOT_ELIGIBLE",
				"Asset rh:4663:INVENTED did not pass the candidate gate.",
			),
		);
	});

	it("rejects a commitment mismatch", async () => {
		const candidates = (await new DemoProvider().getCandidates("0x0")).slice(
			0,
			3,
		);
		const unsigned = {
			schemaVersion: "investmade-feed-input/v1" as const,
			sessionId: "session-1",
			epochId: "2026-W30",
			policyVersion: "investmade-policy/v1" as const,
			budget: DEFAULT_BUDGET,
			preferences: {
				cadence: "weekly" as const,
				ticketSizeUsd: 10,
				riskMode: "balanced" as const,
				assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			},
			candidates,
		};
		const input = feedInputSchema.parse({
			...unsigned,
			inputCommitment: sha256(unsigned),
		});
		const generated = await new DemoProvider().generate(input, candidates);
		generated.output.inputCommitment = `sha256:${"0".repeat(64)}`;
		expect(() =>
			validateFeed(generated.output, input, candidates),
		).toThrowError(/commitment/);
	});

	it("derives basket capacity from the period budget instead of a fixed card cap", () => {
		expect(budgetForTicket(0.1).maxCards).toBe(1000);
		expect(budgetForTicket(25).maxCards).toBe(4);

		const card = {
			assetId: "rh:4663:WETH",
			action: "BUY",
			rank: 1,
			amountInBaseUnits: "10000000",
			scoreBps: 7000,
			evidenceIds: ["evidence"],
			reason: "Bounded reason.",
		};
		const result = feedOutputSchema.safeParse({
			schemaVersion: "investmade-feed-output/v1",
			sessionId: "session",
			inputCommitment: `sha256:${"1".repeat(64)}`,
			policyVersion: "investmade-policy/v1",
			regime: "CRYPTO_NEUTRAL",
			cards: Array.from({ length: 11 }, (_, index) => ({
				...card,
				rank: index + 1,
			})),
			warnings: [],
		});
		expect(result.success).toBe(true);
	});

	it("completes a partial 0G shortlist from the supplied universe", async () => {
		const provider = new DemoProvider();
		const candidates = await provider.getRankingCandidates(100);
		const unsigned = {
			schemaVersion: "investmade-ranking-input/v1" as const,
			sessionId: "session-ranking",
			epochId: "2026-W30",
			policyVersion: "investmade-policy/v1" as const,
			budget: DEFAULT_BUDGET,
			preferences: {
				cadence: "weekly" as const,
				ticketSizeUsd: 10,
				riskMode: "balanced" as const,
				assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			},
			candidates,
		};
		const input = rankingInputSchema.parse({
			...unsigned,
			inputCommitment: sha256(unsigned),
		});
		const generated = await provider.rank(input);
		const removed = generated.output.assets.pop();
		if (!removed) throw new Error("Expected a ranked asset");

		const ranking = validateRanking(generated.output, input, candidates);

		expect(ranking.assets).toHaveLength(candidates.length);
		expect(ranking.assets.at(-1)).toMatchObject({
			assetId: removed.assetId,
			rank: candidates.length,
			scoreBps: 0,
		});
		expect(ranking.warnings.at(-1)).toMatch(
			/completed from the verified Robinhood/,
		);
	});

	it("rejects an empty 0G ranking", async () => {
		const provider = new DemoProvider();
		const candidates = await provider.getRankingCandidates(3);
		const unsigned = {
			schemaVersion: "investmade-ranking-input/v1" as const,
			sessionId: "session-ranking-empty",
			epochId: "2026-W30",
			policyVersion: "investmade-policy/v1" as const,
			budget: DEFAULT_BUDGET,
			preferences: {
				cadence: "weekly" as const,
				ticketSizeUsd: 10,
				riskMode: "balanced" as const,
				assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			},
			candidates,
		};
		const input = rankingInputSchema.parse({
			...unsigned,
			inputCommitment: sha256(unsigned),
		});
		const generated = await provider.rank(input);
		generated.output.assets = [];

		expect(() =>
			validateRanking(generated.output, input, candidates),
		).toThrowError(/at least one supplied candidate/);
	});
});
