import { SOLANA_USDC_MINT } from "../domain/solana.js";
import { executionIntent } from "../domain/execution-intent.js";
import {
	ticketSizeToBaseUnits,
	type Candidate,
	type ExecutionPlan,
	type ExecutionRequest,
} from "../domain/schemas.js";

export interface ReviewExecutionRecord {
	plan: ExecutionPlan;
	status: "PREPARED" | "SUBMITTED" | "SETTLED" | "PARTIAL" | "FAILED";
}

export interface ReviewBasket {
	sessionId: string;
	epochId: string;
	chain: "SOLANA";
	executionProvider: "ZERO_EX" | "JUPITER";
	selected: Candidate[];
	ticketSizeUsd: number;
	periodLimitUsd: number;
	wallet: string;
}

export function reviewBasketKey(basket: ReviewBasket) {
	return JSON.stringify({
		sessionId: basket.sessionId,
		epochId: basket.epochId,
		executionProvider: basket.executionProvider,
		chain: basket.chain,
		assetIds: basket.selected.map((candidate) => candidate.assetId).sort(),
		ticketSizeUsd: basket.ticketSizeUsd,
		periodLimitUsd: basket.periodLimitUsd,
		wallet: basket.wallet.toLowerCase(),
	});
}

export function executionMatchesReviewBasket(
	record: ReviewExecutionRecord | undefined,
	basket: ReviewBasket,
) {
	if (
		!record ||
		!basket.selected.length ||
		record.plan.sessionId !== basket.sessionId ||
		record.plan.epochId !== basket.epochId ||
		record.plan.provider !== basket.executionProvider
	) {
		return false;
	}
	const amountInBaseUnits = ticketSizeToBaseUnits(
		basket.ticketSizeUsd,
	).toString();
	const selectedIds = basket.selected
		.map((candidate) => candidate.assetId)
		.sort();
	const quotedIds = record.plan.quotes
		.map((quote) => quote.assetId)
		.sort();
	if (
		selectedIds.length !== quotedIds.length ||
		selectedIds.some((assetId, index) => assetId !== quotedIds[index]) ||
		record.plan.quotes.some(
			(quote) => quote.amountInBaseUnits !== amountInBaseUnits,
		) ||
		record.plan.totalInputBaseUnits !==
			(BigInt(amountInBaseUnits) * BigInt(selectedIds.length)).toString()
	) {
		return false;
	}
	return true;
}

export async function executionPlanHashMatchesReviewBasket(
	record: ReviewExecutionRecord,
	basket: ReviewBasket,
) {
	if (!basket.selected.length) return false;
	const amountInBaseUnits = ticketSizeToBaseUnits(
		basket.ticketSizeUsd,
	).toString();
	const request: ExecutionRequest = {
		sessionId: basket.sessionId,
		chain: "SOLANA",
		cluster: "mainnet-beta",
		inputToken: SOLANA_USDC_MINT,
		periodLimitUsd: basket.periodLimitUsd,
		selections: basket.selected.map((candidate) => ({
			assetId: candidate.assetId,
			amountInBaseUnits,
		})),
		slippageBps: 50,
	};
	const json = canonicalJson(
		executionIntent(
			{
				id: basket.sessionId,
				epochId: basket.epochId,
				executionProvider: basket.executionProvider,
				chain: basket.chain,
				wallet: basket.wallet,
			},
			request,
		),
	);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(json),
	);
	const hash = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return record.plan.authorizedPlanHash === `sha256:${hash}`;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, item]) => item !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonicalize(item)]),
		);
	}
	return value;
}
