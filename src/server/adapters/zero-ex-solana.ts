import { createHash, randomUUID } from "node:crypto";
import {
	type AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import type { RegistryAsset } from "../../domain/solana.js";
import {
	SOLANA_USDC_DECIMALS,
	SOLANA_USDC_MINT,
} from "../../domain/solana.js";
import type {
	Candidate,
	ExecutionRequest,
	Quote,
	RankingCandidate,
} from "../../domain/schemas.js";
import {
	ExecutionProviderError,
	type CandidateDiscoveryOptions,
	type CandidateProvider,
	type ExecutionProvider,
	type NormalizedExecutionError,
	type SolanaPreparedTransaction,
} from "./types.js";

type ZeroExInstruction = {
	program_id: number[];
	accounts: Array<{
		pubkey: number[];
		is_signer: boolean;
		is_writable: boolean;
	}>;
	data: number[];
};

type ZeroExSwapInstructions = {
	amount_out: number | string;
	min_amount_out?: number | string;
	instructions: ZeroExInstruction[];
	address_lookup_tables: string[];
	zid: string;
	route_plan?: Array<{ dex_label?: string }>;
};

type PreparedRoute = {
	candidate: Candidate;
	amount: string;
	build: ZeroExSwapInstructions;
	quote: Quote;
};

/**
 * Solana execution through 0x's SVM Swap API. Jupiter remains the discovery
 * source because 0x deliberately exposes executable routes, not a token list.
 */
export class ZeroExSolanaProvider
	implements ExecutionProvider, CandidateProvider
{
	readonly id = "ZERO_EX" as const;
	readonly label = "0x";
	private readonly connection: Connection;

	constructor(
		private readonly apiKey: string,
		rpcUrl: string,
		private readonly discovery: CandidateProvider,
		private readonly fetcher: typeof fetch = fetch,
	) {
		this.connection = new Connection(rpcUrl, "confirmed");
	}

	getAsset(assetId: string): Promise<RegistryAsset | undefined> {
		return this.discovery.getAsset?.(assetId) ?? Promise.resolve(undefined);
	}

	getRankingCandidates(
		limit: number,
		excludedAssetIds?: string[],
		options?: CandidateDiscoveryOptions,
	): Promise<RankingCandidate[]> {
		return this.discovery.getRankingCandidates(limit, excludedAssetIds, options);
	}

	async getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
	): Promise<Candidate[]> {
		const candidates = await this.discovery.getCandidatesForFeed(
			wallet,
			rankedAssetIds,
			amountInBaseUnits,
			now,
			limit,
		);
		return this.withZeroExQuotes(wallet, candidates, amountInBaseUnits, now);
	}

	async getCandidates(
		wallet: string,
		amountInBaseUnits = "100000",
		now = new Date(),
		limit?: number,
		excludedAssetIds?: string[],
		options?: CandidateDiscoveryOptions,
	): Promise<Candidate[]> {
		const candidates = await this.discovery.getCandidates(
			wallet,
			amountInBaseUnits,
			now,
			limit,
			excludedAssetIds,
			options,
		);
		return this.withZeroExQuotes(wallet, candidates, amountInBaseUnits, now);
	}

	async getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits = "100000",
		now = new Date(),
	): Promise<Candidate[]> {
		const candidates = await this.discovery.getCandidatesForExecution(
			wallet,
			assetIds,
			amountInBaseUnits,
			now,
		);
		return this.withZeroExQuotes(wallet, candidates, amountInBaseUnits, now);
	}

	async price(
		wallet: string,
		_txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
	): Promise<Quote> {
		const build = await this.build(
			wallet,
			SOLANA_USDC_MINT,
			candidate.contract,
			amountInBaseUnits,
			slippageBps,
		);
		return quoteFromBuild(candidate, amountInBaseUnits, build, new Date());
	}

	async prepareBasket(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
	): Promise<{ quotes: Quote[]; solanaTransaction: SolanaPreparedTransaction }> {
		if (request.chain !== "SOLANA") {
			throw providerError("UNSUPPORTED_CHAIN", "0x Solana supports Solana only.");
		}
		const byId = new Map(candidates.map((candidate) => [candidate.assetId, candidate]));
		const prepared: PreparedRoute[] = [];
		for (const selection of request.selections) {
			const candidate = byId.get(selection.assetId);
			if (!candidate) {
				throw providerError("INVALID_TOKEN", `${selection.assetId} is unavailable through 0x.`);
			}
			const build = await this.build(
				wallet,
				SOLANA_USDC_MINT,
				candidate.contract,
				selection.amountInBaseUnits,
				50,
			);
			prepared.push({
				candidate,
				amount: selection.amountInBaseUnits,
				build,
				quote: quoteFromBuild(candidate, selection.amountInBaseUnits, build, new Date()),
			});
		}
		return {
			quotes: prepared.map((item) => item.quote),
			solanaTransaction: await this.compose(wallet, prepared),
		};
	}

	async prepareExit(
		wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
	): Promise<{ quote: Quote; solanaTransaction: SolanaPreparedTransaction }> {
		const build = await this.build(
			wallet,
			candidate.contract,
			SOLANA_USDC_MINT,
			amountInBaseUnits,
			slippageBps,
		);
		const output: Candidate = {
			...candidate,
			contract: SOLANA_USDC_MINT,
			decimals: SOLANA_USDC_DECIMALS,
		};
		const quote = quoteFromBuild(output, amountInBaseUnits, build, new Date());
		return {
			quote,
			solanaTransaction: await this.compose(wallet, [
				{ candidate: output, amount: amountInBaseUnits, build, quote },
			]),
		};
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
		const currentBlockHeight = await this.connection.getBlockHeight("confirmed");
		if (currentBlockHeight > prepared.lastValidBlockHeight) {
			throw providerError("INVALID_TRANSACTION", "The prepared Solana transaction expired. Refresh the basket.");
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
			throw providerError("INVALID_TRANSACTION", "The signed Solana transaction does not match the prepared basket.");
		}
		if (!transaction.signatures[0] || transaction.signatures[0].every((byte) => byte === 0)) {
			throw providerError("INVALID_TRANSACTION", "The Solana transaction is not signed.");
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
		if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
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
		const tokenDelta = (mint: string) => {
			const total = (balances: NonNullable<typeof transaction.meta>["postTokenBalances"]) =>
				(balances ?? [])
					.filter((balance) => balance.owner === wallet && balance.mint === mint)
					.reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount.amount), 0n);
			return total(transaction.meta?.postTokenBalances) - total(transaction.meta?.preTokenBalances);
		};
		return expected.map((item) => {
			const delta = tokenDelta(item.mint);
			return {
				assetId: item.assetId,
				amountOutBaseUnits: delta > 0n ? delta.toString() : "0",
				transactionHash: signature,
				blockNumber: transaction.slot.toString(),
				status: delta >= BigInt(item.minimumAmountOut) ? ("success" as const) : ("failed" as const),
			};
		});
	}

	private async withZeroExQuotes(
		wallet: string,
		candidates: Candidate[],
		amountInBaseUnits: string,
		now: Date,
	) {
		const quoted: Candidate[] = [];
		for (const candidate of candidates) {
			try {
				const quote = await this.price(wallet, wallet, candidate, amountInBaseUnits, 50);
				quoted.push({
					...candidate,
					quote: {
						...quote,
						quotedAt: now.toISOString(),
						expiresAt: new Date(now.getTime() + 30_000).toISOString(),
					},
				});
			} catch {
				// A discovery result is not eligible until 0x returns an exact-size route.
			}
		}
		return quoted;
	}

	private async build(
		wallet: string,
		tokenIn: string,
		tokenOut: string,
		amountIn: string,
		slippageBps: number,
	): Promise<ZeroExSwapInstructions> {
		const numericAmountIn = Number(amountIn);
		if (!Number.isSafeInteger(numericAmountIn) || numericAmountIn <= 0) {
			throw providerError("INVALID_TRANSACTION", "The 0x Solana input amount is outside the supported range.");
		}
		const request = {
			method: "POST",
			headers: { "0x-api-key": this.apiKey, "Content-Type": "application/json" },
			body: JSON.stringify({
				amount_in: numericAmountIn,
				taker: wallet,
				token_in: tokenIn,
				token_out: tokenOut,
				slippage_bps: slippageBps,
				reserve_transaction_bytes: 52,
			}),
		} satisfies RequestInit;
		let response: Response | undefined;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			response = await this.fetcher(
				"https://api.0x.org/solana/swap-instructions",
				request,
			);
			if (response.status !== 429 || attempt === 2) break;
			await waitForZeroExRateLimit(response, attempt);
		}
		if (!response) {
			throw providerError("PROVIDER_UNAVAILABLE", "0x Solana did not respond.");
		}
		if (!response.ok) {
			const reason = await response.text().catch(() => "");
			throw providerError(
				response.status === 429 || response.status >= 500
					? "PROVIDER_UNAVAILABLE"
					: "INSUFFICIENT_LIQUIDITY",
				`0x Solana route unavailable${reason ? `: ${reason.slice(0, 160)}` : "."}`,
			);
		}
		const build = (await response.json()) as Partial<ZeroExSwapInstructions>;
		if (
			!positiveInteger(build.amount_out) ||
			!Array.isArray(build.instructions) ||
			build.instructions.length === 0 ||
			!Array.isArray(build.address_lookup_tables) ||
			!build.zid
		) {
			throw providerError("INVALID_TRANSACTION", "0x returned incomplete Solana swap instructions.");
		}
		return build as ZeroExSwapInstructions;
	}

	private async compose(wallet: string, prepared: PreparedRoute[]) {
		const feePayer = new PublicKey(wallet);
		const instructions: TransactionInstruction[] = [];
		const lookupTables = new Map<string, AddressLookupTableAccount>();
		for (const item of prepared) {
			for (const raw of item.build.instructions) {
				const instruction = toInstruction(raw);
				for (const account of instruction.keys) {
					if (account.isSigner && !account.pubkey.equals(feePayer)) {
						throw providerError("INVALID_TRANSACTION", "0x requested an unexpected signer.");
					}
				}
				instructions.push(instruction);
			}
			for (const address of item.build.address_lookup_tables) {
				if (lookupTables.has(address)) continue;
				const result = await this.connection.getAddressLookupTable(new PublicKey(address));
				if (!result.value) {
					throw providerError("INVALID_TRANSACTION", "A 0x address lookup table is unavailable.");
				}
				lookupTables.set(address, result.value);
			}
		}

		const blockhash = await this.connection.getLatestBlockhash("confirmed");
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
		const compile = (units: number) =>
			new TransactionMessage({
				payerKey: feePayer,
				recentBlockhash: blockhash.blockhash,
				instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...instructions],
			}).compileToV0Message([...lookupTables.values()]);
		const simulationTransaction = new VersionedTransaction(compile(1_400_000));
		if (
			simulationTransaction.message.header.numRequiredSignatures !== 1 ||
			!simulationTransaction.message.staticAccountKeys[0]?.equals(feePayer)
		) {
			throw providerError("INVALID_TRANSACTION", "The Solana transaction has an invalid signer set.");
		}
		// ponytail: compile the actual 0x routes instead of guessing their byte cost.
		if (serialize(simulationTransaction).byteLength > 1_232) {
			throw providerError(
				"BASKET_TOO_LARGE",
				"The atomic Solana basket exceeds the transaction size limit. Remove one asset and try again.",
			);
		}
		const simulation = await this.connection.simulateTransaction(simulationTransaction, {
			sigVerify: false,
			replaceRecentBlockhash: false,
		});
		if (simulation.value.err) {
			throw providerError("SIMULATION_FAILED", "Atomic 0x basket simulation failed.");
		}
		const units = Math.min(1_400_000, Math.max(50_000, Math.ceil((simulation.value.unitsConsumed ?? 1_400_000) * 1.2)));
		const transaction = new VersionedTransaction(compile(units));
		const serialized = serialize(transaction);
		if (serialized.byteLength > 1_232) {
			throw providerError(
				"BASKET_TOO_LARGE",
				"The atomic Solana basket exceeds the transaction size limit. Remove one asset and try again.",
			);
		}
		return {
			kind: "SOLANA_TRANSACTION" as const,
			unsignedTransactionBase64: Buffer.from(serialized).toString("base64"),
			messageCommitment: `sha256:${createHash("sha256").update(transaction.message.serialize()).digest("hex")}` as const,
			recentBlockhash: blockhash.blockhash,
			lastValidBlockHeight: blockhash.lastValidBlockHeight,
			expectedBalanceChanges: prepared.map((item) => ({
				assetId: item.candidate.assetId,
				mint: item.candidate.contract,
				minimumAmountOut: item.quote.minimumAmountOut,
			})),
		};
	}
}

async function waitForZeroExRateLimit(response: Response, attempt: number) {
	const retryAfter = Number(response.headers.get("retry-after"));
	const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
		? Math.min(2_000, retryAfter * 1_000)
		: 250 * 2 ** attempt;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function quoteFromBuild(
	candidate: Candidate,
	amountInBaseUnits: string,
	build: ZeroExSwapInstructions,
	now: Date,
): Quote {
	const estimatedAmountOut = String(build.amount_out);
	const minimumAmountOut = String(
		build.min_amount_out ?? (BigInt(estimatedAmountOut) * 9_950n) / 10_000n,
	);
	const amountUsd = Number(amountInBaseUnits) / 10 ** SOLANA_USDC_DECIMALS;
	const output = Number(estimatedAmountOut) / 10 ** candidate.decimals;
	return {
		requestId: randomUUID(),
		provider: "ZERO_EX",
		chain: "SOLANA",
		assetId: candidate.assetId,
		tokenOut: candidate.contract,
		amountInBaseUnits,
		estimatedAmountOut,
		minimumAmountOut,
		unitPriceUsd: Math.max(output > 0 ? amountUsd / output : 0, Number.EPSILON).toString(),
		priceImpactBps: 0,
		routing: "ZERO_EX",
		providerEvidence: {
			zid: build.zid,
			routers: [...new Set((build.route_plan ?? []).map((route) => route.dex_label).filter(Boolean))].join(","),
			slippage: "50bps",
		},
		quotedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 30_000).toISOString(),
	};
}

function toInstruction(raw: ZeroExInstruction) {
	return new TransactionInstruction({
		programId: new PublicKey(Uint8Array.from(raw.program_id)),
		keys: raw.accounts.map((account) => ({
			pubkey: new PublicKey(Uint8Array.from(account.pubkey)),
			isSigner: account.is_signer,
			isWritable: account.is_writable,
		})),
		data: Buffer.from(raw.data),
	});
}

function positiveInteger(value: unknown) {
	return (typeof value === "number" || typeof value === "string") && /^\d+$/.test(String(value)) && BigInt(String(value)) > 0n;
}

function providerError(code: NormalizedExecutionError, message: string) {
	return new ExecutionProviderError("ZERO_EX", code, message);
}
