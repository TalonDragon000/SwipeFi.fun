import { createHash, randomUUID } from "node:crypto";
import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import type { RegistryAsset } from "../../domain/solana.js";
import type {
	Candidate,
	ExecutionRequest,
	Quote,
	RankingCandidate,
} from "../../domain/schemas.js";
import {
	SOLANA_ASSET_REGISTRY,
	SOLANA_NATIVE_MINT,
	SOLANA_USDC_DECIMALS,
	SOLANA_USDC_MINT,
	type SolanaAsset,
	solanaAssetById,
} from "../../domain/solana.js";
import {
	type CandidateDiscoveryOptions,
	type CandidateProvider,
	type ExecutionProvider,
	ExecutionProviderError,
	type ProviderSnapshotCache,
	type SolanaPreparedTransaction,
} from "./types.js";

type Fetcher = typeof fetch;

type JupiterInstruction = {
	programId: string;
	accounts: Array<{
		pubkey: string;
		isSigner: boolean;
		isWritable: boolean;
	}>;
	data: string;
};

type JupiterBuild = {
	outAmount: string;
	otherAmountThreshold: string;
	priceImpactPct?: string;
	routePlan?: Array<{ swapInfo?: { label?: string } }>;
	computeBudgetInstructions?: JupiterInstruction[];
	setupInstructions?: JupiterInstruction[];
	swapInstruction: JupiterInstruction;
	cleanupInstruction?: JupiterInstruction | null;
	otherInstructions?: JupiterInstruction[];
	addressesByLookupTableAddress?: Record<string, string[]>;
};

type JupiterToken = {
	id: string;
	name: string;
	symbol: string;
	icon?: string | null;
	decimals: number;
	isVerified?: boolean | null;
	organicScore?: number;
	usdPrice?: number;
	liquidity?: number;
	holderCount?: number | null;
	mcap?: number | null;
	tags?: string[] | null;
	tokenProgram?: string;
	updatedAt?: string;
	firstPool?: { createdAt?: string } | null;
	audit?: {
		isSus?: boolean;
		mintAuthorityDisabled?: boolean;
		freezeAuthorityDisabled?: boolean;
		topHoldersPercentage?: number;
		devBalancePercentage?: number;
	} | null;
	stats24h?: {
		buyVolume?: number;
		sellVolume?: number;
		priceChange?: number;
		numTraders?: number;
	};
};

const VERIFIED_CACHE_TTL_MS = 60 * 60_000;
const DYNAMIC_CACHE_TTL_MS = 5 * 60_000;
const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const EXCLUDED_FEED_MINTS = new Set([SOLANA_USDC_MINT, SOLANA_USDT_MINT]);
const EXCLUDED_STABLECOIN_SYMBOLS = new Set([
	"PYUSD",
	"USD1",
	"USDG",
	"JLUSD",
	"USDS",
	"USDE",
	"USX",
	"JUICED",
	"HYUSD",
	"JUPUSD",
	"CASH",
	"EURC",
	"SYRUPUSDC",
	"JLUSDT",
]);

export class JupiterProvider implements ExecutionProvider, CandidateProvider {
	readonly id = "JUPITER" as const;
	readonly label = "Jupiter";
	private readonly connection: Connection;
	private readonly discoveredAssets = new Map<string, SolanaAsset>();
	private readonly discoveredMetadata = new Map<string, JupiterToken>();
	private readonly discoveryCache = new Map<
		string,
		{ expiresAt: number; tokens: JupiterToken[] }
	>();
	private readonly discoveryInFlight = new Map<
		string,
		Promise<JupiterToken[]>
	>();

	constructor(
		private readonly apiKey: string,
		rpcUrl: string,
		private readonly fetcher: Fetcher = fetch,
		private readonly durableCache?: ProviderSnapshotCache,
	) {
		this.connection = new Connection(rpcUrl, "confirmed");
	}

	async getAsset(assetId: string): Promise<RegistryAsset | undefined> {
		return solanaAssetById(assetId) ?? this.discoveredAssets.get(assetId);
	}

	async getRankingCandidates(
		limit: number,
		excludedAssetIds: string[] = [],
		options: CandidateDiscoveryOptions = {},
	): Promise<RankingCandidate[]> {
		const excluded = new Set(excludedAssetIds);
		const tokens = await this.discoverTokens(options.includeCommunity === true);
		const assets = tokens
			.flatMap((token) => {
				const asset = this.assetFromToken(token);
				return excluded.has(asset.assetId) ||
					isExcludedFeedToken(token) ||
					!passesDiscoveryGate(token, options)
					? []
					: [{ asset, token }];
			})
			.slice(0, limit);
		const prices = await this.prices(assets.map(({ asset }) => asset.address));
		return assets.map(({ asset, token }, index) => ({
			chain: "SOLANA" as const,
			assetId: asset.assetId,
			symbol: asset.symbol,
			name: asset.name,
			kind: asset.kind,
			contract: asset.address,
			decimals: asset.decimals,
			discoveryRank: index + 1,
			priceUsd: prices[asset.address]?.usdPrice ?? token.usdPrice,
			volume24hUsd: tokenVolume24h(token),
			priceChange24hPct: token.stats24h?.priceChange,
			liquidityUsd: token.liquidity,
			organicScore: token.organicScore,
			verified: token.isVerified === true,
			primaryClassification: tokenClassification(token),
			classificationConfidence: tokenClassificationConfidence(token),
			tags: token.tags ?? [],
			riskFlags: tokenRiskFlags(token),
			classificationEvidence: tokenClassificationEvidence(token),
			marketDataUpdatedAt: token.updatedAt,
			marketDataSource: "jupiter" as const,
			iconUrl: token.icon ?? undefined,
		}));
	}

	async getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
	): Promise<Candidate[]> {
		return this.resolveCandidates(
			wallet,
			rankedAssetIds.slice(0, limit),
			amountInBaseUnits,
			now,
		);
	}

	async getCandidates(
		wallet: string,
		amountInBaseUnits = "100000",
		now = new Date(),
		limit = Object.keys(SOLANA_ASSET_REGISTRY).length,
		excludedAssetIds: string[] = [],
	): Promise<Candidate[]> {
		const excluded = new Set(excludedAssetIds);
		const discovered = await this.discoverTokens(false);
		return this.resolveCandidates(
			wallet,
			discovered
				.map((token) => this.assetFromToken(token))
				.filter((asset) => !excluded.has(asset.assetId))
				.slice(0, limit)
				.map((asset) => asset.assetId),
			amountInBaseUnits,
			now,
		);
	}

	async getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits = "100000",
		now = new Date(),
	): Promise<Candidate[]> {
		return this.resolveCandidates(wallet, assetIds, amountInBaseUnits, now);
	}

	async price(
		wallet: string,
		_txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		_slippageBps: number,
	): Promise<Quote> {
		const build = await this.build(
			wallet,
			candidate.contract,
			amountInBaseUnits,
		);
		return quoteFromBuild(candidate, amountInBaseUnits, build, new Date());
	}

	async prepareBasket(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
	): Promise<{
		quotes: Quote[];
		solanaTransaction?: SolanaPreparedTransaction;
		solanaTransactions?: SolanaPreparedTransaction[];
	}> {
		if (request.chain !== "SOLANA") {
			throw providerError("UNSUPPORTED_CHAIN", "Jupiter supports Solana only.");
		}
		const byId = new Map(
			candidates.map((candidate) => [candidate.assetId, candidate]),
		);
		const accountProfiles =
			request.selections.length >= 3 ? [undefined] : [undefined, 24, 16, 12];
		let lastRetryableError: ExecutionProviderError | undefined;
		// ponytail: one fresh route retry; add DEX exclusions only if failures persist.
		let retriedRouteFailure = false;
		const smallestWorkingBuild = new Map<string, JupiterBuild>();
		let fallbackPrepared: Array<{
			candidate: Candidate;
			amount: string;
			build: JupiterBuild;
			quote: Quote;
		}> = [];
		for (const maxAccounts of accountProfiles) {
			// ponytail: independent Jupiter legs are network-bound, so build them together.
			const prepared = await Promise.all(
				request.selections.map(async (selection) => {
					const candidate = byId.get(selection.assetId);
					if (!candidate) {
						throw providerError(
							"INVALID_TOKEN",
							`${selection.assetId} is not in the Solana execution set.`,
						);
					}
					let build: JupiterBuild;
					try {
						build = await this.build(
							wallet,
							candidate.contract,
							selection.amountInBaseUnits,
							SOLANA_USDC_MINT,
							maxAccounts,
						);
						smallestWorkingBuild.set(selection.assetId, build);
					} catch (error) {
						const previous = smallestWorkingBuild.get(selection.assetId);
						if (
							!previous ||
							!(error instanceof ExecutionProviderError) ||
							error.code !== "INVALID_TRANSACTION" ||
							!error.upstreamReason?.includes("No routes found")
						) {
							throw error;
						}
						// Some routes cannot honor the next tighter account cap. Keep that
						// leg's smallest valid build while continuing to compact the others.
						build = previous;
					}
					return {
						candidate,
						amount: selection.amountInBaseUnits,
						build,
						quote: quoteFromBuild(
							candidate,
							selection.amountInBaseUnits,
							build,
							new Date(),
						),
					};
				}),
			);
			fallbackPrepared = prepared;
			try {
				const solanaTransaction = await this.compose(wallet, prepared);
				const validatedAt = new Date();
				return {
					quotes: prepared.map((item) => ({
						...item.quote,
						quotedAt: validatedAt.toISOString(),
						expiresAt: new Date(validatedAt.getTime() + 45_000).toISOString(),
					})),
					solanaTransaction,
				};
			} catch (error) {
				const retryableSize =
					error instanceof ExecutionProviderError &&
					error.code === "BASKET_TOO_LARGE";
				const retryableRoute =
					error instanceof ExecutionProviderError &&
					error.code === "SIMULATION_FAILED" &&
					!retriedRouteFailure;
				const retryable = retryableSize || retryableRoute;
				if (!retryable) {
					throw error;
				}
				if (retryableRoute) retriedRouteFailure = true;
				lastRetryableError = error;
			}
		}
		if (!fallbackPrepared.length) {
			throw (
				lastRetryableError ??
				providerError(
					"BASKET_TOO_LARGE",
					"The Solana basket could not be prepared.",
				)
			);
		}
		// ponytail: one transaction per leg is the reliable fallback; pack later only if measured UX demands it.
		const solanaTransactions = await Promise.all(
			fallbackPrepared.map((item) => this.compose(wallet, [item])),
		);
		const validatedAt = new Date();
		return {
			quotes: fallbackPrepared.map((item) => ({
				...item.quote,
				quotedAt: validatedAt.toISOString(),
				expiresAt: new Date(validatedAt.getTime() + 45_000).toISOString(),
			})),
			solanaTransactions,
		};
	}

	async prepareExit(
		wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
	): Promise<{
		quote: Quote;
		solanaTransaction: SolanaPreparedTransaction;
	}> {
		const build = await this.build(
			wallet,
			SOLANA_USDC_MINT,
			amountInBaseUnits,
			candidate.contract,
		);
		const reverseCandidate: Candidate = {
			...candidate,
			contract: SOLANA_USDC_MINT,
			decimals: SOLANA_USDC_DECIMALS,
		};
		const quote = quoteFromBuild(
			reverseCandidate,
			amountInBaseUnits,
			build,
			new Date(),
		);
		const solanaTransaction = await this.compose(wallet, [
			{ candidate: reverseCandidate, amount: amountInBaseUnits, build, quote },
		]);
		return { quote, solanaTransaction };
	}

	async health() {
		return {
			available: Boolean(this.apiKey),
			status: this.apiKey ? ("CONFIGURED" as const) : ("UNAVAILABLE" as const),
		};
	}

	async submitSignedTransaction(
		prepared: SolanaPreparedTransaction,
		signedTransactionBase64: string,
	): Promise<string> {
		const currentBlockHeight =
			await this.connection.getBlockHeight("confirmed");
		if (currentBlockHeight > prepared.lastValidBlockHeight) {
			throw providerError(
				"INVALID_TRANSACTION",
				"The prepared Solana transaction expired. Refresh the basket.",
			);
		}
		const supplied = Buffer.from(signedTransactionBase64, "base64");
		let transaction: VersionedTransaction;
		if (supplied.byteLength === 64) {
			transaction = VersionedTransaction.deserialize(
				Buffer.from(prepared.unsignedTransactionBase64, "base64"),
			);
			transaction.signatures[0] = new Uint8Array(supplied);
		} else {
			transaction = VersionedTransaction.deserialize(supplied);
		}
		const commitment = `sha256:${createHash("sha256")
			.update(transaction.message.serialize())
			.digest("hex")}`;
		if (commitment !== prepared.messageCommitment) {
			throw providerError(
				"INVALID_TRANSACTION",
				"The signed Solana transaction does not match the prepared basket.",
			);
		}
		if (
			!transaction.signatures[0] ||
			transaction.signatures[0].every((byte) => byte === 0)
		) {
			throw providerError(
				"INVALID_TRANSACTION",
				"The Solana transaction is not signed.",
			);
		}
		return this.connection.sendRawTransaction(transaction.serialize(), {
			skipPreflight: false,
			maxRetries: 3,
		});
	}

	async transactionStatus(signature: string) {
		const statuses = await this.connection.getSignatureStatuses([signature], {
			searchTransactionHistory: true,
		});
		const status = statuses.value[0];
		if (!status) return { state: "PENDING" as const };
		if (status.err) return { state: "FAILED" as const };
		if (
			status.confirmationStatus === "confirmed" ||
			status.confirmationStatus === "finalized"
		) {
			return { state: "CONFIRMED" as const, slot: status.slot };
		}
		return { state: "PENDING" as const };
	}

	async reconcileOutputs(
		signature: string,
		wallet: string,
		expected: SolanaPreparedTransaction["expectedBalanceChanges"],
	) {
		const transaction = await this.connection.getTransaction(signature, {
			commitment: "confirmed",
			maxSupportedTransactionVersion: 0,
		});
		if (!transaction?.meta || transaction.meta.err) return undefined;
		const owner = wallet;
		const tokenDelta = (mint: string) => {
			const total = (
				balances: NonNullable<typeof transaction.meta>["postTokenBalances"],
			) =>
				(balances ?? [])
					.filter((balance) => balance.owner === owner && balance.mint === mint)
					.reduce(
						(sum, balance) => sum + BigInt(balance.uiTokenAmount.amount),
						0n,
					);
			return (
				total(transaction.meta?.postTokenBalances) -
				total(transaction.meta?.preTokenBalances)
			);
		};
		return expected.map((item) => {
			const delta =
				item.mint === "So11111111111111111111111111111111111111112"
					? BigInt(
							(transaction.meta?.postBalances[0] ?? 0) -
								(transaction.meta?.preBalances[0] ?? 0) +
								(transaction.meta?.fee ?? 0) +
								(transaction.meta?.preBalances.reduce(
									(rent, preBalance, index) =>
										preBalance === 0
											? rent + (transaction.meta?.postBalances[index] ?? 0)
											: rent,
									0,
								) ?? 0),
						)
					: tokenDelta(item.mint);
			return {
				assetId: item.assetId,
				amountOutBaseUnits: delta > 0n ? delta.toString() : "0",
				transactionHash: signature,
				blockNumber: transaction.slot.toString(),
				status:
					delta >= BigInt(item.minimumAmountOut)
						? ("success" as const)
						: ("failed" as const),
			};
		});
	}

	private async resolveCandidates(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits: string,
		now: Date,
	) {
		const candidates: Candidate[] = [];
		for (const assetId of assetIds) {
			try {
				let asset =
					solanaAssetById(assetId) ?? this.discoveredAssets.get(assetId);
				let metadata: JupiterToken | undefined;
				if (!asset) {
					const mint = dynamicMintFromAssetId(assetId);
					if (!mint) continue;
					metadata = await this.token(mint);
					asset = this.assetFromToken(metadata);
					if (asset.assetId !== assetId) continue;
				}
				metadata ??=
					this.discoveredMetadata.get(asset.address) ??
					(await this.token(asset.address));
				if (
					metadata.id !== asset.address ||
					metadata.symbol.toLowerCase() !== asset.symbol.toLowerCase() ||
					metadata.decimals !== asset.decimals ||
					metadata.audit?.isSus === true
				) {
					continue;
				}
				const stub = candidateFromAsset(asset, metadata);
				const quote = await this.price(
					wallet,
					wallet,
					stub,
					amountInBaseUnits,
					50,
				);
				candidates.push({ ...stub, quote });
			} catch (error) {
				logProviderError("candidate", error);
			}
		}
		return candidates.map((candidate) => ({
			...candidate,
			quote: candidate.quote
				? {
						...candidate.quote,
						quotedAt: now.toISOString(),
						expiresAt: new Date(now.getTime() + 30_000).toISOString(),
					}
				: undefined,
		}));
	}

	private async build(
		wallet: string,
		outputMint: string,
		amount: string,
		inputMint: string = SOLANA_USDC_MINT,
		maxAccounts?: number,
	): Promise<JupiterBuild> {
		const query = new URLSearchParams({
			inputMint,
			outputMint,
			amount,
			taker: wallet,
			slippageBps: "rtse",
		});
		if (maxAccounts) query.set("maxAccounts", String(maxAccounts));
		let response: Response | undefined;
		let responseReason: string | undefined;
		let rateLimitRetries = 0;
		// ponytail: one retry covers transient router state without hiding real errors.
		let retriedRejectedBuild = false;
		while (true) {
			response = await this.fetcher(
				`https://api.jup.ag/swap/v2/build?${query}`,
				{ headers: this.headers() },
			);
			if (response.status === 429 && rateLimitRetries < 2) {
				await waitForJupiterRateLimit(response, rateLimitRetries);
				rateLimitRetries += 1;
				continue;
			}
			if (!response.ok) responseReason = await safeText(response);
			const retryRejectedBuild =
				!response.ok &&
				!retriedRejectedBuild &&
				response.status >= 400 &&
				response.status < 500 &&
				![404, 422, 429].includes(response.status) &&
				!isJupiterInsufficientFunds(responseReason ?? "");
			if (!retryRejectedBuild) break;
			retriedRejectedBuild = true;
		}
		if (!response) {
			throw providerError("PROVIDER_UNAVAILABLE", "Jupiter did not respond.");
		}
		if (!response.ok) {
			throw upstreamError(
				response.status,
				responseReason ?? (await safeText(response)),
			);
		}
		const build = (await response.json()) as Partial<JupiterBuild>;
		if (
			!build.swapInstruction ||
			!positiveInteger(build.outAmount) ||
			!positiveInteger(build.otherAmountThreshold)
		) {
			throw providerError(
				"INVALID_TRANSACTION",
				"Jupiter returned an incomplete swap build.",
			);
		}
		return build as JupiterBuild;
	}

	private async compose(
		wallet: string,
		prepared: Array<{
			candidate: Candidate;
			amount: string;
			build: JupiterBuild;
			quote: Quote;
		}>,
	): Promise<SolanaPreparedTransaction> {
		const feePayer = new PublicKey(wallet);
		const instructionKeys = new Set<string>();
		const computeInstructions: TransactionInstruction[] = [];
		const instructions: TransactionInstruction[] = [];
		const lookupTables = new Map<string, AddressLookupTableAccount>();

		const append = (
			target: TransactionInstruction[],
			instruction: JupiterInstruction | null | undefined,
		) => {
			if (!instruction) return;
			const key = JSON.stringify(instruction);
			if (instructionKeys.has(key)) return;
			instructionKeys.add(key);
			const converted = toInstruction(instruction);
			for (const account of converted.keys) {
				if (account.isSigner && !account.pubkey.equals(feePayer)) {
					throw providerError(
						"INVALID_TRANSACTION",
						"Jupiter requested an unexpected signer.",
					);
				}
			}
			target.push(converted);
		};

		for (const item of prepared) {
			for (const instruction of item.build.computeBudgetInstructions ?? []) {
				append(computeInstructions, instruction);
			}
			for (const instruction of item.build.setupInstructions ?? []) {
				append(instructions, instruction);
			}
			append(instructions, item.build.swapInstruction);
			for (const instruction of item.build.otherInstructions ?? []) {
				append(instructions, instruction);
			}
			append(instructions, item.build.cleanupInstruction);
			for (const [tableAddress, addresses] of Object.entries(
				item.build.addressesByLookupTableAddress ?? {},
			)) {
				if (lookupTables.has(tableAddress)) continue;
				lookupTables.set(
					tableAddress,
					new AddressLookupTableAccount({
						key: new PublicKey(tableAddress),
						state: {
							deactivationSlot: BigInt("18446744073709551615"),
							lastExtendedSlot: 0,
							lastExtendedSlotStartIndex: 0,
							authority: undefined,
							addresses: addresses.map((address) => new PublicKey(address)),
						},
					}),
				);
			}
		}

		const blockhash = await this.connection.getLatestBlockhash("confirmed");
		const uniqueComputeInstructions = new Map<number, TransactionInstruction>();
		for (const instruction of computeInstructions) {
			if (
				instruction.programId.equals(ComputeBudgetProgram.programId) &&
				instruction.data[0] === 2
			) {
				continue;
			}
			const discriminator = instruction.data[0] ?? -1;
			if (!uniqueComputeInstructions.has(discriminator)) {
				uniqueComputeInstructions.set(discriminator, instruction);
			}
		}
		const serialize = (transaction: VersionedTransaction) => {
			try {
				return transaction.serialize();
			} catch {
				throw providerError(
					"BASKET_TOO_LARGE",
					"The atomic Solana basket exceeds the transaction size limit. Remove one asset and try again.",
				);
			}
		};
		const compile = (unitLimit?: number, includeProviderCompute = true) =>
			new TransactionMessage({
				payerKey: feePayer,
				recentBlockhash: blockhash.blockhash,
				instructions: [
					...(unitLimit
						? [ComputeBudgetProgram.setComputeUnitLimit({ units: unitLimit })]
						: []),
					...(includeProviderCompute ? uniqueComputeInstructions.values() : []),
					...instructions,
				],
			}).compileToV0Message([...lookupTables.values()]);

		let usesExplicitComputeBudget = true;
		let simulationTransaction = new VersionedTransaction(compile(1_400_000));
		if (serialize(simulationTransaction).byteLength > 1_232) {
			// Solana derives a compute allowance from the transaction's instruction
			// count (capped at the network maximum). For large baskets, omitting the
			// optional compute-budget program can be the difference between a valid
			// atomic transaction and one that exceeds 1232 bytes.
			usesExplicitComputeBudget = false;
			simulationTransaction = new VersionedTransaction(
				compile(undefined, false),
			);
		}
		if (
			simulationTransaction.message.header.numRequiredSignatures !== 1 ||
			!simulationTransaction.message.staticAccountKeys[0]?.equals(feePayer)
		) {
			throw providerError(
				"INVALID_TRANSACTION",
				"The Solana transaction has an invalid signer set.",
			);
		}
		// ponytail: the compiled transaction is the capacity calculator; estimates drift by route.
		const simulationSize = serialize(simulationTransaction).byteLength;
		if (simulationSize > 1_232) {
			throw providerError(
				"BASKET_TOO_LARGE",
				`The atomic Solana basket is ${simulationSize} bytes and exceeds the 1232-byte transaction limit.`,
			);
		}
		const simulation = await this.connection.simulateTransaction(
			simulationTransaction,
			{ sigVerify: false, replaceRecentBlockhash: false },
		);
		if (simulation.value.err) {
			const reason = JSON.stringify(simulation.value.err);
			if (isJupiterInsufficientFunds(reason)) {
				throw providerError(
					"INSUFFICIENT_FUNDS",
					"This wallet has insufficient USDC or SOL for the basket amount, fees, or rent.",
					reason,
				);
			}
			throw providerError(
				"SIMULATION_FAILED",
				"Atomic Jupiter basket simulation failed.",
				reason,
			);
		}
		const consumed = simulation.value.unitsConsumed ?? 1_400_000;
		const unitLimit = Math.min(
			1_400_000,
			Math.max(50_000, Math.ceil(consumed * 1.2)),
		);
		const transaction = new VersionedTransaction(
			usesExplicitComputeBudget
				? compile(unitLimit)
				: compile(undefined, false),
		);
		const serialized = serialize(transaction);
		if (serialized.byteLength > 1_232) {
			throw providerError(
				"BASKET_TOO_LARGE",
				`The atomic Solana basket is ${serialized.byteLength} bytes and exceeds the 1232-byte transaction limit.`,
			);
		}
		const messageBytes = transaction.message.serialize();
		return {
			kind: "SOLANA_TRANSACTION",
			unsignedTransactionBase64: Buffer.from(serialized).toString("base64"),
			messageCommitment: `sha256:${createHash("sha256")
				.update(messageBytes)
				.digest("hex")}`,
			recentBlockhash: blockhash.blockhash,
			lastValidBlockHeight: blockhash.lastValidBlockHeight,
			expectedBalanceChanges: prepared.map((item) => ({
				assetId: item.candidate.assetId,
				mint: item.candidate.contract,
				minimumAmountOut: item.quote.minimumAmountOut,
			})),
		};
	}

	private async token(mint: string): Promise<JupiterToken> {
		let response: Response | undefined;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			response = await this.fetcher(
				`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
				{ headers: this.headers() },
			);
			if (response.status !== 429 || attempt === 2) break;
			await waitForJupiterRateLimit(response, attempt);
		}
		if (!response) {
			throw providerError("PROVIDER_UNAVAILABLE", "Jupiter did not respond.");
		}
		if (!response.ok)
			throw upstreamError(response.status, await safeText(response));
		const tokens = (await response.json()) as JupiterToken[];
		const token = tokens.find((item) => item.id === mint);
		if (!token)
			throw providerError(
				"INVALID_TOKEN",
				"Jupiter token metadata is missing.",
			);
		this.discoveredMetadata.set(mint, token);
		return token;
	}

	private assetFromToken(token: JupiterToken): SolanaAsset {
		const curated = Object.values(SOLANA_ASSET_REGISTRY).find(
			(asset) => asset.address === token.id,
		);
		const asset: SolanaAsset = curated ?? {
			assetId: `sol:mainnet:${token.id}`,
			symbol: token.symbol,
			name: token.name,
			kind:
				tokenClassification(token) === "TOKENIZED_STOCK"
					? "STOCK_TOKEN"
					: "CRYPTO",
			address: token.id,
			decimals: token.decimals,
		};
		this.discoveredAssets.set(asset.assetId, asset);
		this.discoveredMetadata.set(asset.address, token);
		return asset;
	}

	private async discoverTokens(includeCommunity: boolean) {
		// Jupiter's tag catalogue can change independently of its Tokens API
		// documentation. Keep each source isolated so one retired tag never takes
		// down the complete Solana feed.
		const curatedMints = Object.values(SOLANA_ASSET_REGISTRY).map(
			(asset) => asset.address,
		);
		const stable = await Promise.all(
			[
				this.cachedTokenList(
					"curated",
					VERIFIED_CACHE_TTL_MS,
					`/tokens/v2/search?query=${encodeURIComponent(curatedMints.join(","))}`,
				),
				this.cachedTokenList(
					"tag:verified",
					VERIFIED_CACHE_TTL_MS,
					"/tokens/v2/tag?query=verified",
				),
				this.cachedTokenList(
					"tag:lst",
					VERIFIED_CACHE_TTL_MS,
					"/tokens/v2/tag?query=lst",
				),
			].map((request) =>
				request.catch((error) => {
					logProviderError("discovery", error);
					return [] as JupiterToken[];
				}),
			),
		);
		const dynamicPaths = [
			"/tokens/v2/toporganicscore/1h?limit=100",
			"/tokens/v2/toporganicscore/24h?limit=100",
			"/tokens/v2/toptraded/1h?limit=100",
			"/tokens/v2/toptraded/24h?limit=100",
			"/tokens/v2/toptrending/1h?limit=100",
			"/tokens/v2/toptrending/24h?limit=100",
			...(includeCommunity ? ["/tokens/v2/recent"] : []),
		];
		const dynamic = await Promise.all(
			dynamicPaths.map((path) =>
				this.cachedTokenList(
					`dynamic:${path}`,
					DYNAMIC_CACHE_TTL_MS,
					path,
				).catch((error) => {
					logProviderError("discovery", error);
					return [] as JupiterToken[];
				}),
			),
		);
		const curatedMintSet = new Set(
			Object.values(SOLANA_ASSET_REGISTRY).map((asset) => asset.address),
		);
		const byMint = new Map<string, JupiterToken>();
		for (const token of [...stable.flat(), ...dynamic.flat()]) {
			if (!isValidTokenMetadata(token)) continue;
			const current = byMint.get(token.id);
			byMint.set(token.id, mergeTokenMetadata(current, token));
		}
		return [...byMint.values()].sort(
			(left, right) =>
				Number(curatedMintSet.has(right.id)) -
					Number(curatedMintSet.has(left.id)) ||
				Number(right.isVerified === true) - Number(left.isVerified === true) ||
				(right.organicScore ?? 0) - (left.organicScore ?? 0) ||
				(right.liquidity ?? 0) - (left.liquidity ?? 0) ||
				left.id.localeCompare(right.id),
		);
	}

	private async cachedTokenList(key: string, ttlMs: number, path: string) {
		const cached = this.discoveryCache.get(key);
		if (cached && cached.expiresAt > Date.now()) return cached.tokens;
		const durable = await this.durableCache
			?.getProviderSnapshot(`jupiter:${key}`)
			.catch(() => undefined);
		if (durable && Date.parse(durable.expiresAt) > Date.now()) {
			const tokens = durable.value as JupiterToken[];
			this.discoveryCache.set(key, {
				expiresAt: Date.parse(durable.expiresAt),
				tokens,
			});
			return tokens;
		}
		const existing = this.discoveryInFlight.get(key);
		if (existing) return existing;
		const request = (async () => {
			const response = await this.fetcher(`https://api.jup.ag${path}`, {
				headers: this.headers(),
			});
			if (!response.ok) {
				throw upstreamError(response.status, await safeText(response));
			}
			const tokens = (await response.json()) as JupiterToken[];
			this.discoveryCache.set(key, {
				expiresAt: Date.now() + ttlMs,
				tokens,
			});
			void this.durableCache
				?.setProviderSnapshot(
					`jupiter:${key}`,
					"jupiter",
					tokens,
					new Date(Date.now() + ttlMs).toISOString(),
				)
				.catch(() => undefined);
			return tokens;
		})().finally(() => this.discoveryInFlight.delete(key));
		this.discoveryInFlight.set(key, request);
		return request;
	}

	private async prices(mints: string[]) {
		const response = await this.fetcher(
			`https://api.jup.ag/price/v3?ids=${encodeURIComponent(mints.join(","))}`,
			{ headers: this.headers() },
		);
		if (!response.ok) return {} as Record<string, JupiterToken>;
		return (await response.json()) as Record<string, JupiterToken>;
	}

	private headers() {
		return { "x-api-key": this.apiKey };
	}
}

function dynamicMintFromAssetId(assetId: string) {
	const prefix = "sol:mainnet:";
	if (!assetId.startsWith(prefix)) return undefined;
	const mint = assetId.slice(prefix.length);
	try {
		return new PublicKey(mint).toBase58() === mint ? mint : undefined;
	} catch {
		return undefined;
	}
}

function candidateFromAsset(
	asset: SolanaAsset,
	metadata: JupiterToken,
): Candidate {
	return {
		chain: "SOLANA",
		assetId: asset.assetId,
		symbol: asset.symbol,
		name: asset.name,
		kind: asset.kind,
		contract: asset.address,
		decimals: asset.decimals,
		eligible: true,
		marketHealthy:
			(metadata.liquidity ?? 0) >= 25_000 && metadata.audit?.isSus !== true,
		permissionAllowed: metadata.audit?.isSus !== true,
		marketPriceUsd: metadata.usdPrice,
		marketDataSource: "jupiter",
		marketDataUpdatedAt: metadata.updatedAt,
		iconUrl: metadata.icon ?? undefined,
		primaryClassification: tokenClassification(metadata),
		classificationConfidence: tokenClassificationConfidence(metadata),
		tags: metadata.tags ?? [],
		riskFlags: tokenRiskFlags(metadata),
		classificationEvidence: tokenClassificationEvidence(metadata),
		crowdScoreBps: Math.max(
			1,
			Math.min(10_000, Math.round((metadata.organicScore ?? 50) * 100)),
		),
		reason: `${asset.name} passed Jupiter token checks and has an executable USDC route.`,
		evidenceIds: [
			`jupiter:token:${asset.address}`,
			`jupiter:route:${asset.address}`,
		],
	};
}

function tokenClassification(token: JupiterToken) {
	const tags = new Set(token.tags ?? []);
	if (tags.has("stocks")) return "TOKENIZED_STOCK" as const;
	return "CRYPTO" as const;
}

function isExcludedFeedToken(token: JupiterToken) {
	if (EXCLUDED_FEED_MINTS.has(token.id)) return true;
	const symbol = token.symbol.trim().toUpperCase();
	if (EXCLUDED_STABLECOIN_SYMBOLS.has(symbol) || symbol.includes("USD")) {
		return true;
	}
	if (token.id === SOLANA_NATIVE_MINT) return false;
	const tags = new Set((token.tags ?? []).map((tag) => tag.toLowerCase()));
	return (
		tags.has("lst") ||
		tags.has("stablecoin") ||
		/(?:wrapped|liquid[ -]?staked|staked)\s+sol(?:ana)?/i.test(token.name) ||
		/sol$/i.test(token.symbol)
	);
}

function tokenClassificationConfidence(token: JupiterToken) {
	if (tokenClassification(token) === "TOKENIZED_STOCK") {
		return token.isVerified === true ? ("HIGH" as const) : ("MEDIUM" as const);
	}
	return token.isVerified === true ? ("HIGH" as const) : ("LOW" as const);
}

function tokenClassificationEvidence(token: JupiterToken) {
	return [
		`jupiter:token:${token.id}`,
		...(token.tags ?? []).map((tag) => `jupiter:tag:${tag}`),
	];
}

function tokenRiskFlags(token: JupiterToken) {
	const flags: string[] = [];
	if (token.audit?.isSus) flags.push("JUPITER_SUSPICIOUS");
	if (token.audit?.mintAuthorityDisabled === false) {
		flags.push("MINT_AUTHORITY_ENABLED");
	}
	if (token.audit?.freezeAuthorityDisabled === false) {
		flags.push("FREEZE_AUTHORITY_ENABLED");
	}
	if ((token.audit?.topHoldersPercentage ?? 0) >= 80) {
		flags.push("CONCENTRATED_HOLDERS");
	}
	if ((token.audit?.devBalancePercentage ?? 0) >= 20) {
		flags.push("HIGH_DEVELOPER_BALANCE");
	}
	if (token.tokenProgram?.toLowerCase().includes("2022")) {
		flags.push("TOKEN_2022");
	}
	if (poolAgeHours(token) < 24) flags.push("NEW_POOL");
	return flags;
}

function passesDiscoveryGate(
	token: JupiterToken,
	options: CandidateDiscoveryOptions,
) {
	if (token.audit?.isSus === true) return false;
	const risk = options.riskMode ?? "balanced";
	const liquidity = token.liquidity ?? 0;
	const organic = token.organicScore ?? 0;
	if (risk === "conservative") {
		return (
			(token.isVerified === true || (token.tags ?? []).includes("stocks")) &&
			liquidity >= 250_000 &&
			organic >= 60
		);
	}
	if (risk === "degen") {
		return liquidity >= 25_000 && organic >= 20 && poolAgeHours(token) >= 1;
	}
	return liquidity >= 100_000 && organic >= 40;
}

function poolAgeHours(token: JupiterToken) {
	const createdAt = token.firstPool?.createdAt;
	if (!createdAt) return Number.POSITIVE_INFINITY;
	const timestamp = Date.parse(createdAt);
	return Number.isFinite(timestamp)
		? Math.max(0, (Date.now() - timestamp) / 3_600_000)
		: Number.POSITIVE_INFINITY;
}

function tokenVolume24h(token: JupiterToken) {
	const volume =
		(token.stats24h?.buyVolume ?? 0) + (token.stats24h?.sellVolume ?? 0);
	return volume > 0 ? volume : undefined;
}

function isValidTokenMetadata(token: JupiterToken) {
	if (
		!token.id ||
		!token.name ||
		!token.symbol ||
		!Number.isInteger(token.decimals) ||
		token.decimals < 0 ||
		token.decimals > 36
	) {
		return false;
	}
	try {
		new PublicKey(token.id);
		return true;
	} catch {
		return false;
	}
}

async function waitForJupiterRateLimit(response: Response, attempt: number) {
	const retryAfterSeconds = Number(response.headers.get("retry-after"));
	const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
	const resetDelay = Number.isFinite(resetSeconds)
		? resetSeconds * 1_000 - Date.now() + 75
		: 0;
	const retryAfterDelay = Number.isFinite(retryAfterSeconds)
		? retryAfterSeconds * 1_000
		: 0;
	const fallbackDelay = 1_000 * 2 ** attempt;
	const delay = Math.min(
		10_000,
		Math.max(0, resetDelay, retryAfterDelay, fallbackDelay),
	);
	await new Promise((resolve) => setTimeout(resolve, delay));
}

function mergeTokenMetadata(
	current: JupiterToken | undefined,
	next: JupiterToken,
): JupiterToken {
	if (!current) return next;
	return {
		...current,
		...next,
		tags: [...new Set([...(current.tags ?? []), ...(next.tags ?? [])])],
		audit: { ...(current.audit ?? {}), ...(next.audit ?? {}) },
		stats24h: { ...(current.stats24h ?? {}), ...(next.stats24h ?? {}) },
		isVerified: current.isVerified === true || next.isVerified === true,
		organicScore: Math.max(current.organicScore ?? 0, next.organicScore ?? 0),
		liquidity: Math.max(current.liquidity ?? 0, next.liquidity ?? 0),
	};
}

function quoteFromBuild(
	candidate: Candidate,
	amountInBaseUnits: string,
	build: JupiterBuild,
	now: Date,
): Quote {
	const amountUsd = Number(amountInBaseUnits) / 10 ** SOLANA_USDC_DECIMALS;
	const output = Number(build.outAmount) / 10 ** candidate.decimals;
	const unitPriceUsd = output > 0 ? amountUsd / output : 0;
	return {
		requestId: randomUUID(),
		provider: "JUPITER",
		chain: "SOLANA",
		assetId: candidate.assetId,
		tokenOut: candidate.contract,
		amountInBaseUnits,
		estimatedAmountOut: build.outAmount,
		minimumAmountOut: build.otherAmountThreshold,
		unitPriceUsd: Math.max(unitPriceUsd, Number.EPSILON).toString(),
		priceImpactBps: Math.max(
			0,
			Math.round(Number(build.priceImpactPct ?? "0") * 100),
		),
		routing: "JUPITER",
		providerEvidence: {
			routers: [
				...new Set(
					(build.routePlan ?? [])
						.map((route) => route.swapInfo?.label)
						.filter((label): label is string => Boolean(label)),
				),
			].join(","),
			slippage: "rtse",
		},
		quotedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 30_000).toISOString(),
	};
}

function toInstruction(instruction: JupiterInstruction) {
	return new TransactionInstruction({
		programId: new PublicKey(instruction.programId),
		keys: instruction.accounts.map((account) => ({
			pubkey: new PublicKey(account.pubkey),
			isSigner: account.isSigner,
			isWritable: account.isWritable,
		})),
		data: Buffer.from(instruction.data, "base64"),
	});
}

function positiveInteger(value: unknown): value is string {
	return (
		typeof value === "string" && /^[0-9]+$/.test(value) && BigInt(value) > 0n
	);
}

function isJupiterInsufficientFunds(reason: string) {
	return /"Custom"\s*:\s*6024|InsufficientFunds|0x1788/i.test(reason);
}

function upstreamError(status: number, reason: string) {
	if (status === 404 || status === 422) {
		return providerError(
			"INSUFFICIENT_LIQUIDITY",
			"No Jupiter route is available.",
			reason,
		);
	}
	if (status === 429 || status >= 500) {
		return providerError(
			"PROVIDER_UNAVAILABLE",
			"Jupiter is temporarily unavailable.",
			reason,
		);
	}
	return providerError(
		"INVALID_TRANSACTION",
		"Jupiter rejected the swap request.",
		reason,
	);
}

function providerError(
	code: ConstructorParameters<typeof ExecutionProviderError>[1],
	message: string,
	reason?: string,
) {
	return new ExecutionProviderError("JUPITER", code, message, reason);
}

async function safeText(response: Response) {
	try {
		return (await response.text()).slice(0, 500);
	} catch {
		return "";
	}
}

function logProviderError(endpoint: string, error: unknown) {
	const normalized =
		error instanceof ExecutionProviderError
			? error
			: providerError("PROVIDER_UNAVAILABLE", "Jupiter request failed.");
	console.warn(
		JSON.stringify({
			event: "execution_provider_error",
			provider: "JUPITER",
			endpoint,
			code: normalized.code,
			reason: normalized.upstreamReason ?? normalized.message,
		}),
	);
}
