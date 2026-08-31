import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import { executionIntent } from "../src/domain/execution-intent.js";
import {
	formatTicketSizeUsd,
	ticketSizeToBaseUnits,
} from "../src/domain/schemas.js";
import { SOLANA_USDC_MINT } from "../src/domain/solana.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import {
	executionMatchesReviewBasket,
	executionPlanHashMatchesReviewBasket,
	type ReviewBasket,
	type ReviewExecutionRecord,
} from "../src/client/review-safety.js";

describe("review signing safety", () => {
	it("formats three ten-cent allocations as exact money", () => {
		expect(formatTicketSizeUsd(0.1 * 3)).toBe("0.30");
	});

	it("blocks signing after prepare then removing the prepared asset", async () => {
		const provider = new DemoProvider();
		const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
		const [candidate] = await provider.getCandidates(wallet);
		if (!candidate?.quote) throw new Error("TEST_CANDIDATE_REQUIRED");
		const basket: ReviewBasket = {
			chain: "SOLANA",
			sessionId: "session-1",
			epochId: "2026-W30:basket:test",
			executionProvider: "JUPITER",
			selected: [candidate],
			ticketSizeUsd: 0.1,
			periodLimitUsd: 10,
			wallet,
		};
		const amountInBaseUnits = ticketSizeToBaseUnits(
			basket.ticketSizeUsd,
		).toString();
		const request = {
			sessionId: basket.sessionId,
			chain: "SOLANA" as const,
			cluster: "mainnet-beta" as const,
			inputToken: SOLANA_USDC_MINT,
			periodLimitUsd: basket.periodLimitUsd,
			selections: [{ assetId: candidate.assetId, amountInBaseUnits }],
			slippageBps: 50,
		};
		const record: ReviewExecutionRecord = {
			plan: {
				executionId: "execution-1",
				sessionId: basket.sessionId,
				epochId: basket.epochId,
				provider: basket.executionProvider,
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				signingWallet: basket.wallet,
				totalInputBaseUnits: amountInBaseUnits,
				authorizedPlanHash: sha256(
					executionIntent(
						{
							id: basket.sessionId,
							epochId: basket.epochId,
							executionProvider: basket.executionProvider,
							chain: "SOLANA",
							wallet: basket.wallet,
						},
						request,
					),
				),
				policyHash: `sha256:${"b".repeat(64)}`,
				callCommitments: [`sha256:${"c".repeat(64)}`],
				quotes: [{ ...candidate.quote, amountInBaseUnits }],
				generatedAt: new Date().toISOString(),
			},
			status: "PREPARED",
		};

		expect(executionMatchesReviewBasket(record, basket)).toBe(true);
		expect(await executionPlanHashMatchesReviewBasket(record, basket)).toBe(true);

		const afterRemoval = { ...basket, selected: [] };
		expect(executionMatchesReviewBasket(record, afterRemoval)).toBe(false);
		expect(
			await executionPlanHashMatchesReviewBasket(record, afterRemoval),
		).toBe(false);
	});
});
