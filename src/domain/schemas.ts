import { z } from "zod";
import {
	DEFAULT_SLOT_BUDGET,
	POLICY_VERSION,
} from "./constants.js";
import {
	SOLANA_CLUSTER,
	SOLANA_USDC_DECIMALS,
	SOLANA_USDC_MINT,
} from "./solana.js";

export const solanaAddressSchema = z
	.string()
	.min(32)
	.max(44)
	.regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
export const chainAddressSchema = solanaAddressSchema;
export const baseUnitsSchema = z.string().regex(/^[0-9]+$/);
export const appChainSchema = z.literal("SOLANA");
export const executionProviderIdSchema = z.enum(["ZERO_EX", "JUPITER"]);
export const feedRankingProviderIdSchema = z.enum(["ZERO_G", "DETERMINISTIC"]);
export const assetClassificationSchema = z.enum([
	"TOKENIZED_STOCK",
	"MEMECOIN",
	"CRYPTO",
	"UNKNOWN",
]);
export const classificationConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const MIN_TICKET_SIZE_USD = 0.1;
export const MIN_PERIOD_LIMIT_USD = MIN_TICKET_SIZE_USD;
export const TICKET_SIZE_INCREMENT_USD = 0.01;
export const TICKET_SIZE_INCREMENT_BASE_UNITS = 10_000n;

export function isTicketSizeUsd(value: number): boolean {
	const cents = value * 100;
	return (
		Number.isFinite(value) &&
		value >= MIN_TICKET_SIZE_USD &&
		Number.isSafeInteger(Math.round(value * 10 ** SOLANA_USDC_DECIMALS)) &&
		Math.abs(cents - Math.round(cents)) < 1e-8
	);
}

export function isPeriodLimitUsd(value: number): boolean {
	const cents = value * 100;
	return (
		Number.isFinite(value) &&
		value >= MIN_PERIOD_LIMIT_USD &&
		Number.isSafeInteger(Math.round(value * 10 ** SOLANA_USDC_DECIMALS)) &&
		Math.abs(cents - Math.round(cents)) < 1e-8
	);
}

export function ticketSizeToBaseUnits(ticketSizeUsd: number): bigint {
	if (!isTicketSizeUsd(ticketSizeUsd)) throw new Error("INVALID_TICKET_SIZE");
	return BigInt(Math.round(ticketSizeUsd * 10 ** SOLANA_USDC_DECIMALS));
}

export function formatTicketSizeUsd(ticketSizeUsd: number): string {
	return ticketSizeUsd.toFixed(2);
}

const quoteBaseSchema = z.object({
	requestId: z.string().min(1),
	provider: executionProviderIdSchema.optional(),
	chain: appChainSchema.default("SOLANA"),
	assetId: z.string().min(1),
	tokenOut: chainAddressSchema,
	amountInBaseUnits: baseUnitsSchema,
	estimatedAmountOut: baseUnitsSchema,
	minimumAmountOut: baseUnitsSchema,
	unitPriceUsd: z.string().regex(/^\d+(\.\d+)?$/),
	priceImpactBps: z.number().int().nonnegative(),
	routing: z.enum([
		"CLASSIC",
		"WRAP",
		"UNWRAP",
		"DUTCH_V2",
		"DUTCH_V3",
		"PRIORITY",
		"ZERO_EX",
		"JUPITER",
	]),
	fees: z
		.array(
			z.object({
				type: z.string().min(1),
				token: chainAddressSchema,
				amount: baseUnitsSchema,
			}),
		)
		.optional(),
	providerEvidence: z.record(z.string(), z.string()).optional(),
	quotedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
});

export const quoteSchema = quoteBaseSchema.transform((quote) => ({
	...quote,
	provider:
		quote.provider ??
		(quote.routing === "ZERO_EX"
			? "ZERO_EX"
			: quote.routing === "JUPITER"
				? "JUPITER"
				: "JUPITER"),
}));

export const candidateSchema = z.object({
	chain: appChainSchema.default("SOLANA"),
	assetId: z.string().min(1),
	symbol: z.string().min(1),
	name: z.string().min(1),
	kind: z.enum(["CRYPTO", "STOCK_TOKEN"]),
	contract: chainAddressSchema,
	decimals: z.number().int().min(0).max(36),
	eligible: z.boolean(),
	marketHealthy: z.boolean(),
	permissionAllowed: z.boolean(),
	marketPriceUsd: z.number().positive().optional(),
	volume24hUsd: z.number().nonnegative().optional(),
	liquidityUsd: z.number().nonnegative().optional(),
	marketDataSource: z
		.enum([
			"coingecko",
			"geckoterminal",
			"0x",
			"jupiter",
			"alchemy",
			"demo",
		])
		.optional(),
	marketCapRank: z.number().int().positive().optional(),
	marketCapRankSource: z.literal("coingecko").optional(),
	coingeckoId: z.string().min(1).optional(),
	iconUrl: z.string().url().optional(),
	marketDataUpdatedAt: z.string().datetime().optional(),
	primaryClassification: assetClassificationSchema.optional(),
	classificationConfidence: classificationConfidenceSchema.optional(),
	tags: z.array(z.string().min(1)).optional(),
	riskFlags: z.array(z.string().min(1)).optional(),
	classificationEvidence: z.array(z.string().min(1)).optional(),
	quote: quoteSchema.optional(),
	crowdScoreBps: z.number().int().min(0).max(10_000),
	reason: z.string().min(1).max(280),
	evidenceIds: z.array(z.string().min(1)).min(1),
});

export const rankingCandidateSchema = z.object({
	chain: appChainSchema.default("SOLANA"),
	assetId: z.string().min(1),
	symbol: z.string().min(1),
	name: z.string().min(1),
	kind: z.enum(["CRYPTO", "STOCK_TOKEN"]),
	contract: chainAddressSchema.optional(),
	decimals: z.number().int().min(0).max(36).optional(),
	discoveryRank: z.number().int().positive(),
	priceUsd: z.number().nonnegative().optional(),
	volume24hUsd: z.number().nonnegative().optional(),
	priceChange24hPct: z.number().optional(),
	liquidityUsd: z.number().nonnegative().optional(),
	organicScore: z.number().min(0).max(100).optional(),
	verified: z.boolean().optional(),
	marketCapRank: z.number().int().positive().optional(),
	marketCapRankSource: z.literal("coingecko").optional(),
	coingeckoId: z.string().min(1).optional(),
	iconUrl: z.string().url().optional(),
	marketDataUpdatedAt: z.string().datetime().optional(),
	primaryClassification: assetClassificationSchema.default("UNKNOWN"),
	classificationConfidence: classificationConfidenceSchema.default("LOW"),
	tags: z.array(z.string().min(1)).default([]),
	riskFlags: z.array(z.string().min(1)).default([]),
	classificationEvidence: z.array(z.string().min(1)).default([]),
	marketDataSource: z
		.enum([
			"coingecko",
			"geckoterminal",
			"jupiter",
			"alchemy",
			"demo",
		])
		.optional(),
});

export const personalizationPreferencesSchema = z.object({
	executionProvider: executionProviderIdSchema.default("JUPITER"),
	solanaExecutionProvider: z.enum(["JUPITER", "ZERO_EX"]).optional(),
	activeChain: appChainSchema.default("SOLANA"),
	solanaExecutionWallet: solanaAddressSchema.optional(),
	feedRankingProvider: feedRankingProviderIdSchema.default("DETERMINISTIC"),
	cadence: z.enum(["daily", "weekly", "monthly"]),
	periodLimitUsd: z
		.number()
		.refine(isPeriodLimitUsd, {
			message: "Period limit must be at least $0.10 in $0.01 increments.",
		})
		.optional(),
	ticketSizeUsd: z.number().refine(isTicketSizeUsd, {
		message: "Ticket size must be at least $0.10 in $0.01 increments.",
	}),
	riskMode: z.enum(["conservative", "balanced", "degen"]),
	assetClasses: z
		.array(z.enum(["CRYPTO", "STOCK_TOKEN"]))
		.min(1)
		.max(2)
		.refine((values) => new Set(values).size === values.length, {
			message: "Asset classes must be unique",
		}),
});

export const onboardingPreferencesSchema =
	personalizationPreferencesSchema.extend({
		riskDisclosureAccepted: z.literal(true),
	});

export const feedInputSchema = z.object({
	schemaVersion: z.literal("investmade-feed-input/v1"),
	sessionId: z.string().min(1),
	epochId: z.string().min(1),
	policyVersion: z.literal(POLICY_VERSION),
	budget: z.object({
		periodBudgetBaseUnits: baseUnitsSchema,
		slotBudgetBaseUnits: baseUnitsSchema,
		maxCards: z.number().int().min(1),
	}),
	preferences: personalizationPreferencesSchema,
	candidates: z.array(candidateSchema),
	inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const rankingInputSchema = z.object({
	schemaVersion: z.literal("investmade-ranking-input/v1"),
	sessionId: z.string().min(1),
	epochId: z.string().min(1),
	policyVersion: z.literal(POLICY_VERSION),
	budget: feedInputSchema.shape.budget,
	preferences: personalizationPreferencesSchema,
	candidates: z.array(rankingCandidateSchema).min(1),
	inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const rankedAssetSchema = z.object({
	assetId: z.string().min(1),
	rank: z.number().int().positive(),
	scoreBps: z.number().int().min(0).max(10_000),
	reason: z.string().min(1).max(280),
});

export const rankingOutputSchema = z.object({
	schemaVersion: z.literal("investmade-ranking-output/v1"),
	sessionId: z.string().min(1),
	inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	policyVersion: z.literal(POLICY_VERSION),
	regime: z.enum([
		"CRYPTO_BULLISH",
		"CRYPTO_NEUTRAL",
		"CRYPTO_BEARISH",
		"RISK_OFF",
	]),
	assets: z.array(rankedAssetSchema),
	warnings: z.array(z.string()),
});

export const feedCardSchema = z.object({
	assetId: z.string().min(1),
	action: z.literal("BUY"),
	rank: z.number().int().positive(),
	amountInBaseUnits: baseUnitsSchema,
	scoreBps: z.number().int().min(0).max(10_000),
	marketCapRank: z.number().int().positive().optional(),
	marketCapRankSource: z.literal("coingecko").optional(),
	evidenceIds: z.array(z.string().min(1)).min(1),
	reason: z.string().min(1).max(280),
});

export const feedOutputSchema = z.object({
	schemaVersion: z.literal("investmade-feed-output/v1"),
	sessionId: z.string().min(1),
	inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	policyVersion: z.literal(POLICY_VERSION),
	regime: z.enum([
		"CRYPTO_BULLISH",
		"CRYPTO_NEUTRAL",
		"CRYPTO_BEARISH",
		"RISK_OFF",
	]),
	cards: z.array(feedCardSchema),
	warnings: z.array(z.string()),
});

export const selectedAssetSchema = z.object({
	assetId: z.string().min(1),
	amountInBaseUnits: baseUnitsSchema,
});

const executionRequestFields = {
	sessionId: z.string().min(1),
	periodLimitUsd: z
		.number()
		.refine(isPeriodLimitUsd, {
			message: "Period limit must be at least $0.10 in $0.01 increments.",
		})
		.default(100),
	selections: z.array(selectedAssetSchema).min(1),
	slippageBps: z.number().int().min(1).max(100),
};

export const executionRequestSchema = z.preprocess(
	(value) =>
		value && typeof value === "object" && !("chain" in value)
			? { ...value, chain: "SOLANA" }
			: value,
	z.object({
		...executionRequestFields,
		chain: z.literal("SOLANA"),
		cluster: z.literal(SOLANA_CLUSTER),
		inputToken: z.literal(SOLANA_USDC_MINT),
		selections: z.array(selectedAssetSchema).min(1).max(100),
	}),
);

const solanaPreparedTransactionSchema = z.object({
	kind: z.literal("SOLANA_TRANSACTION"),
	unsignedTransactionBase64: z.string().min(1),
	messageCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	recentBlockhash: z.string().min(1),
	lastValidBlockHeight: z.number().int().positive(),
	expectedBalanceChanges: z
		.array(z.object({
			assetId: z.string().min(1),
			mint: solanaAddressSchema,
			minimumAmountOut: baseUnitsSchema,
		}))
		.min(1),
});

export const executionPlanSchema = z
	.object({
		executionId: z.string().min(1),
		sessionId: z.string().min(1),
		epochId: z.string().min(1),
		provider: executionProviderIdSchema.optional(),
		chain: appChainSchema.default("SOLANA"),
		cluster: z.literal(SOLANA_CLUSTER),
		inputToken: z.literal(SOLANA_USDC_MINT),
		signingWallet: chainAddressSchema,
		totalInputBaseUnits: baseUnitsSchema,
		authorizedPlanHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		callCommitments: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
		quotes: z.array(quoteSchema).min(1),
		generatedAt: z.string().datetime(),
		solanaTransaction: solanaPreparedTransactionSchema.optional(),
		solanaTransactions: z
			.array(solanaPreparedTransactionSchema)
			.min(1)
			.optional(),
	})
	.superRefine((plan, context) => {
		if (
			plan.cluster !== SOLANA_CLUSTER ||
			plan.inputToken !== SOLANA_USDC_MINT ||
			(!plan.solanaTransaction && !plan.solanaTransactions?.length) ||
			(plan.solanaTransaction && plan.solanaTransactions?.length) ||
			!plan.signingWallet
		) {
			context.addIssue({
				code: "custom",
				message: "Invalid Solana execution plan",
			});
		}
	})
	.transform((plan) => ({
		...plan,
		provider:
			plan.provider ?? plan.quotes[0]?.provider ?? "JUPITER",
	}));

export type ExecutionProviderId = z.infer<typeof executionProviderIdSchema>;
export type FeedRankingProviderId = z.infer<typeof feedRankingProviderIdSchema>;
export type AppChain = z.infer<typeof appChainSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type RankingCandidate = z.infer<typeof rankingCandidateSchema>;
export type PersonalizationPreferences = z.infer<
	typeof personalizationPreferencesSchema
>;
export type OnboardingPreferences = z.infer<typeof onboardingPreferencesSchema>;
export type FeedInput = z.infer<typeof feedInputSchema>;
export type FeedOutput = z.infer<typeof feedOutputSchema>;
export type RankingInput = z.infer<typeof rankingInputSchema>;
export type RankingOutput = z.infer<typeof rankingOutputSchema>;
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export function budgetForTicket(ticketSizeUsd: number, periodLimitUsd = 100) {
	const slotBudget = ticketSizeToBaseUnits(ticketSizeUsd);
	const periodBudget = ticketSizeToBaseUnits(periodLimitUsd);
	if (slotBudget > periodBudget) throw new Error("TICKET_EXCEEDS_PERIOD_LIMIT");
	return {
		periodBudgetBaseUnits: periodBudget.toString(),
		slotBudgetBaseUnits: slotBudget.toString(),
		maxCards: Number(periodBudget / slotBudget),
	};
}

export const DEFAULT_BUDGET = budgetForTicket(
	Number(DEFAULT_SLOT_BUDGET / 10n ** BigInt(SOLANA_USDC_DECIMALS)),
);
