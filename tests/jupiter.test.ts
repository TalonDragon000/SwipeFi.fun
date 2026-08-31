import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
	SOLANA_ASSET_REGISTRY,
	SOLANA_USDC_MINT,
} from "../src/domain/solana.js";
import { JupiterProvider } from "../src/server/adapters/jupiter.js";

const memoProgram = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const blockhash = "11111111111111111111111111111111";

function providerFor(
	wallet: string,
	unexpectedSigner?: string,
	instructionBytes = 0,
	simulationErrors: unknown[] = [null],
) {
	const fetcher = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.includes("/tokens/v2/search")) {
			const mint = new URL(url).searchParams.get("query") ?? "";
			const asset = Object.values(SOLANA_ASSET_REGISTRY).find(
				(candidate) => candidate.address === mint,
			);
			return Response.json([
				{
					id: mint,
					name: asset?.name ?? "Unknown",
					symbol: asset?.symbol ?? "UNKNOWN",
					decimals: asset?.decimals ?? 6,
					isVerified: true,
					organicScore: 90,
					usdPrice: 100,
					liquidity: 1_000_000,
				},
			]);
		}
		if (url.includes("/swap/v2/build")) {
			const outputMint = new URL(url).searchParams.get("outputMint") ?? "";
			const instructionData = Buffer.alloc(instructionBytes);
			if (instructionBytes) instructionData.write(outputMint);
			const asset = Object.values(SOLANA_ASSET_REGISTRY).find(
				(candidate) => candidate.address === outputMint,
			);
			return Response.json({
				outAmount: String(10 ** Math.min(asset?.decimals ?? 6, 9)),
				otherAmountThreshold: "1",
				priceImpactPct: "0.001",
				routePlan: [{ swapInfo: { label: "Mock AMM" } }],
				swapInstruction: {
					programId: memoProgram,
					accounts: [
						{
							pubkey: unexpectedSigner ?? wallet,
							isSigner: true,
							isWritable: false,
						},
					],
					data: instructionData.toString("base64"),
				},
			});
		}
		if (url.includes("/tx/v1/submit")) {
			return Response.json({ signature: "mock-solana-signature" });
		}
		return new Response("not found", { status: 404 });
	});
	const provider = new JupiterProvider(
		"test-jupiter-key",
		"https://api.mainnet-beta.solana.com",
		fetcher as typeof fetch,
	);
	let simulationIndex = 0;
	const simulateTransaction = vi.fn(async () => ({
		value: {
			err:
				simulationErrors[
					Math.min(simulationIndex++, simulationErrors.length - 1)
				] ?? null,
			unitsConsumed: 100_000,
		},
	}));
	Object.assign(provider as object, {
		connection: {
			getLatestBlockhash: vi.fn(async () => ({
				blockhash,
				lastValidBlockHeight: 500,
			})),
			simulateTransaction,
			getBlockHeight: vi.fn(async () => 100),
		},
	});
	return { provider, fetcher, simulateTransaction };
}

async function candidatesFor(
	provider: JupiterProvider,
	wallet: string,
	assetIds: string[],
) {
	return provider.getCandidatesForExecution(
		wallet,
		assetIds,
		"1000000",
		new Date("2026-07-29T12:00:00.000Z"),
	);
}

describe("Jupiter atomic Solana execution", () => {
	it("keeps Solana discovery available when an optional Jupiter source fails", async () => {
		const excludedTokens = [
			{
				id: Keypair.generate().publicKey.toBase58(),
				name: "PayPal USD",
				symbol: "PYUSD",
				decimals: 6,
				isVerified: true,
				organicScore: 95,
				liquidity: 10_000_000,
				tags: ["stablecoin"],
			},
			{
				id: Keypair.generate().publicKey.toBase58(),
				name: "Jito Staked SOL",
				symbol: "JitoSOL",
				decimals: 9,
				isVerified: true,
				organicScore: 95,
				liquidity: 10_000_000,
				tags: ["lst"],
			},
			{
				id: Keypair.generate().publicKey.toBase58(),
				name: "Jupiter Lend USDC",
				symbol: "jlUSDC",
				decimals: 6,
				isVerified: true,
				organicScore: 95,
				liquidity: 10_000_000,
				tags: ["verified"],
			},
		];
		const curated = Object.values(SOLANA_ASSET_REGISTRY).map((asset) => ({
			id: asset.address,
			name: asset.name,
			symbol: asset.symbol,
			decimals: asset.decimals,
			isVerified: true,
			organicScore: 90,
			liquidity: 1_000_000,
			icon: `https://example.com/${asset.symbol}.png`,
			tags: asset.kind === "STOCK_TOKEN" ? ["stocks"] : ["verified"],
		}));
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/tokens/v2/search")) return Response.json(curated);
			if (url.includes("/tokens/v2/tag?query=lst")) {
				return Response.json(
					{ status: 400, message: "Invalid tag provided." },
					{ status: 400 },
				);
			}
			if (url.includes("/tokens/v2/tag?query=verified")) {
				return Response.json(excludedTokens);
			}
			if (url.includes("/tokens/v2/")) return Response.json([]);
			if (url.includes("/price/v3")) return Response.json({});
			return new Response("not found", { status: 404 });
		});
		const provider = new JupiterProvider(
			"test-jupiter-key",
			"https://api.mainnet-beta.solana.com",
			fetcher as typeof fetch,
		);

		const candidates = await provider.getRankingCandidates(10, [], {
			riskMode: "balanced",
		});

		expect(new Set(candidates.map((candidate) => candidate.symbol))).toEqual(
			new Set(["SOL", "JUP", "AAPLx", "NVDAx", "TSLAx"]),
		);
		expect(candidates.every((candidate) => candidate.chain === "SOLANA")).toBe(
			true,
		);
		expect(
			candidates.find((candidate) => candidate.symbol === "SOL")?.iconUrl,
		).toBe("https://example.com/SOL.png");
	});

	it("retries a rate-limited Jupiter route instead of dropping the feed card", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const asset = SOLANA_ASSET_REGISTRY.SOL;
		if (!asset) throw new Error("SOL_ASSET_REQUIRED");
		let buildAttempts = 0;
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/tokens/v2/search")) {
				return Response.json([
					{
						id: asset.address,
						name: asset.name,
						symbol: asset.symbol,
						decimals: asset.decimals,
						isVerified: true,
						organicScore: 99,
						liquidity: 1_000_000,
					},
				]);
			}
			if (url.includes("/swap/v2/build")) {
				buildAttempts += 1;
				if (buildAttempts === 1) {
					return new Response("rate limited", {
						status: 429,
						headers: { "retry-after": "0" },
					});
				}
				return Response.json({
					outAmount: "1000000",
					otherAmountThreshold: "990000",
					priceImpactPct: "0.001",
					swapInstruction: {
						programId: memoProgram,
						accounts: [],
						data: "",
					},
				});
			}
			return new Response("not found", { status: 404 });
		});
		const provider = new JupiterProvider(
			"test-jupiter-key",
			"https://api.mainnet-beta.solana.com",
			fetcher as typeof fetch,
		);

		const candidates = await provider.getCandidatesForExecution(
			wallet,
			[asset.assetId],
			"100000",
		);

		expect(candidates).toHaveLength(1);
		expect(buildAttempts).toBe(2);
	});

	it("retries one rejected Jupiter build", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const asset = SOLANA_ASSET_REGISTRY.SOL;
		if (!asset) throw new Error("SOL_ASSET_REQUIRED");
		let buildAttempts = 0;
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/tokens/v2/search")) {
				return Response.json([
					{
						id: asset.address,
						name: asset.name,
						symbol: asset.symbol,
						decimals: asset.decimals,
						isVerified: true,
						organicScore: 99,
						liquidity: 1_000_000,
					},
				]);
			}
			if (url.includes("/swap/v2/build")) {
				buildAttempts += 1;
				if (buildAttempts === 1) {
					return new Response("Invalid state: base quantity out is zero", {
						status: 400,
					});
				}
				return Response.json({
					outAmount: "1000000",
					otherAmountThreshold: "990000",
					swapInstruction: {
						programId: memoProgram,
						accounts: [],
						data: "",
					},
				});
			}
			return new Response("not found", { status: 404 });
		});
		const provider = new JupiterProvider(
			"test-jupiter-key",
			"https://api.mainnet-beta.solana.com",
			fetcher as typeof fetch,
		);

		const candidates = await provider.getCandidatesForExecution(
			wallet,
			[asset.assetId],
			"100000",
		);

		expect(candidates).toHaveLength(1);
		expect(buildAttempts).toBe(2);
	});

	it("reconstructs a discovered token from its mint after a provider restart", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const mint = Keypair.generate().publicKey.toBase58();
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/tokens/v2/search")) {
				return Response.json([
					{
						id: mint,
						name: "Restart Token",
						symbol: "RST",
						decimals: 6,
						isVerified: true,
						organicScore: 90,
						liquidity: 1_000_000,
					},
				]);
			}
			if (url.includes("/swap/v2/build")) {
				return Response.json({
					outAmount: "1000000",
					otherAmountThreshold: "990000",
					priceImpactPct: "0.001",
					swapInstruction: {
						programId: memoProgram,
						accounts: [],
						data: "",
					},
				});
			}
			return new Response("not found", { status: 404 });
		});
		const provider = new JupiterProvider(
			"test-jupiter-key",
			"https://api.mainnet-beta.solana.com",
			fetcher as typeof fetch,
		);

		const candidates = await provider.getCandidatesForExecution(
			wallet,
			[`sol:mainnet:${mint}`],
			"100000",
		);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			assetId: `sol:mainnet:${mint}`,
			contract: mint,
			symbol: "RST",
			eligible: true,
		});
	});

	it.each([1, 2, 3, 4])(
		"composes and simulates a %i-asset basket as one v0 transaction",
		async (count) => {
			const wallet = Keypair.generate().publicKey.toBase58();
			const { provider, fetcher } = providerFor(wallet);
			const assetIds = Object.values(SOLANA_ASSET_REGISTRY)
				.slice(0, count)
				.map((asset) => asset.assetId);
			const candidates = await candidatesFor(provider, wallet, assetIds);
			const prepared = await provider.prepareBasket(
				wallet,
				{
					chain: "SOLANA",
					cluster: "mainnet-beta",
					inputToken: SOLANA_USDC_MINT,
					sessionId: "solana-session",
					periodLimitUsd: 10,
					selections: assetIds.map((assetId) => ({
						assetId,
						amountInBaseUnits: "1000000",
					})),
					slippageBps: 50,
				},
				candidates,
			);

			expect(prepared.quotes).toHaveLength(count);
			expect(prepared.solanaTransaction?.kind).toBe("SOLANA_TRANSACTION");
			expect(prepared.solanaTransaction?.expectedBalanceChanges).toHaveLength(
				count,
			);
			expect(
				fetcher.mock.calls.filter(([url]) =>
					String(url).includes("/swap/v2/build"),
				),
			).toHaveLength(count * 2);
		},
	);

	it("reports Jupiter 6024 as insufficient funds without rerouting", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider, simulateTransaction } = providerFor(
			wallet,
			undefined,
			0,
			[{ InstructionError: [1, { Custom: 6024 }] }],
		);
		const assetId = SOLANA_ASSET_REGISTRY.SOL?.assetId;
		if (!assetId) throw new Error("SOL_ASSET_REQUIRED");
		const candidates = await candidatesFor(provider, wallet, [assetId]);

		await expect(
			provider.prepareBasket(
				wallet,
				{
					chain: "SOLANA",
					cluster: "mainnet-beta",
					inputToken: SOLANA_USDC_MINT,
					sessionId: "insufficient-funds",
					periodLimitUsd: 10,
					selections: [{ assetId, amountInBaseUnits: "1000000" }],
					slippageBps: 50,
				},
				candidates,
			),
		).rejects.toMatchObject({
			code: "INSUFFICIENT_FUNDS",
			message:
				"This wallet has insufficient USDC or SOL for the basket amount, fees, or rent.",
		});
		expect(simulateTransaction).toHaveBeenCalledTimes(1);
	});

	it("rebuilds once after a route-specific simulation failure", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider, fetcher, simulateTransaction } = providerFor(
			wallet,
			undefined,
			0,
			[{ InstructionError: [1, "ProgramFailedToComplete"] }, null],
		);
		const assetId = SOLANA_ASSET_REGISTRY.SOL?.assetId;
		if (!assetId) throw new Error("SOL_ASSET_REQUIRED");
		const candidates = await candidatesFor(provider, wallet, [assetId]);

		const prepared = await provider.prepareBasket(
			wallet,
			{
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				sessionId: "reroute-once",
				periodLimitUsd: 10,
				selections: [{ assetId, amountInBaseUnits: "1000000" }],
				slippageBps: 50,
			},
			candidates,
		);

		expect(prepared.solanaTransaction?.kind).toBe("SOLANA_TRANSACTION");
		expect(simulateTransaction).toHaveBeenCalledTimes(2);
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).includes("/swap/v2/build"),
			),
		).toHaveLength(3);
	});

	it("rejects a basket only when its compiled transaction is too large", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet, undefined, 1_300);
		const assetIds = Object.values(SOLANA_ASSET_REGISTRY)
			.slice(0, 1)
			.map((asset) => asset.assetId);
		const candidates = await candidatesFor(provider, wallet, assetIds);
		await expect(
			provider.prepareBasket(
				wallet,
				{
					chain: "SOLANA",
					cluster: "mainnet-beta",
					inputToken: SOLANA_USDC_MINT,
					sessionId: "too-large",
					periodLimitUsd: 10,
					selections: assetIds.map((assetId) => ({
						assetId,
						amountInBaseUnits: "1000000",
					})),
					slippageBps: 50,
				},
				candidates,
			),
		).rejects.toMatchObject({ code: "BASKET_TOO_LARGE" });
	});

	it("falls back to one simulated transaction per leg when the atomic basket is too large", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet, undefined, 600);
		const assetIds = Object.values(SOLANA_ASSET_REGISTRY)
			.slice(0, 2)
			.map((asset) => asset.assetId);
		const candidates = await candidatesFor(provider, wallet, assetIds);

		const prepared = await provider.prepareBasket(
			wallet,
			{
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				sessionId: "per-leg-fallback",
				periodLimitUsd: 10,
				selections: assetIds.map((assetId) => ({
					assetId,
					amountInBaseUnits: "1000000",
				})),
				slippageBps: 50,
			},
			candidates,
		);

		expect(prepared.solanaTransaction).toBeUndefined();
		expect(prepared.solanaTransactions).toHaveLength(2);
		expect(
			prepared.solanaTransactions?.map(
				(transaction) => transaction.expectedBalanceChanges[0]?.assetId,
			),
		).toEqual(assetIds);
	});

	it("skips capped routes for baskets with three or more assets", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider, fetcher } = providerFor(wallet, undefined, 600);
		const assetIds = Object.values(SOLANA_ASSET_REGISTRY)
			.slice(0, 3)
			.map((asset) => asset.assetId);
		const candidates = await candidatesFor(provider, wallet, assetIds);
		const baseFetch = fetcher.getMockImplementation();
		if (!baseFetch) throw new Error("JUPITER_FETCHER_REQUIRED");
		let activeBuilds = 0;
		let peakActiveBuilds = 0;
		fetcher.mockImplementation(async (input) => {
			const url = String(input);
			if (
				url.includes("/swap/v2/build") &&
				new URL(url).searchParams.has("maxAccounts")
			) {
				return Response.json({ error: "No routes found" }, { status: 400 });
			}
			if (!url.includes("/swap/v2/build")) return baseFetch(input);
			activeBuilds += 1;
			peakActiveBuilds = Math.max(peakActiveBuilds, activeBuilds);
			await new Promise((resolve) => setTimeout(resolve, 10));
			try {
				return await baseFetch(input);
			} finally {
				activeBuilds -= 1;
			}
		});

		const prepared = await provider.prepareBasket(
			wallet,
			{
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				sessionId: "three-leg-route-fallback",
				periodLimitUsd: 10,
				selections: assetIds.map((assetId) => ({
					assetId,
					amountInBaseUnits: "1000000",
				})),
				slippageBps: 50,
			},
			candidates,
		);

		expect(prepared.solanaTransaction).toBeUndefined();
		expect(prepared.solanaTransactions).toHaveLength(assetIds.length);
		expect(peakActiveBuilds).toBe(assetIds.length);
		expect(
			fetcher.mock.calls.filter(
				([input]) =>
					String(input).includes("/swap/v2/build") &&
					new URL(String(input)).searchParams.has("maxAccounts"),
			),
		).toHaveLength(0);
	});

	it("fails closed when Jupiter introduces an unexpected signer", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const unexpectedSigner = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet, unexpectedSigner);
		const assetId = SOLANA_ASSET_REGISTRY.SOL?.assetId;
		if (!assetId) throw new Error("SOL_ASSET_REQUIRED");
		const candidates = await candidatesFor(provider, wallet, [assetId]);
		await expect(
			provider.prepareBasket(
				wallet,
				{
					chain: "SOLANA",
					cluster: "mainnet-beta",
					inputToken: SOLANA_USDC_MINT,
					sessionId: "bad-signer",
					periodLimitUsd: 10,
					selections: [{ assetId, amountInBaseUnits: "1000000" }],
					slippageBps: 50,
				},
				candidates,
			),
		).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
	});

	it("reconciles native SOL output separately from new token-account rent", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet);
		Object.assign(provider as object, {
			connection: {
				getTransaction: vi.fn(async () => ({
					slot: 42,
					meta: {
						err: null,
						fee: 261_926,
						preBalances: [97_879_073, 0, 0, 0],
						postBalances: [92_853_718, 2_039_280, 2_039_280, 2_039_280],
						preTokenBalances: [],
						postTokenBalances: [],
					},
				})),
			},
		});

		const outputs = await provider.reconcileOutputs("signature", wallet, [
			{
				assetId: "sol:mainnet:SOL",
				mint: "So11111111111111111111111111111111111111112",
				minimumAmountOut: "1354411",
			},
		]);

		expect(outputs).toEqual([
			expect.objectContaining({
				assetId: "sol:mainnet:SOL",
				amountOutBaseUnits: "1354411",
				status: "success",
			}),
		]);
	});
});
