import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
	SOLANA_ASSET_REGISTRY,
	SOLANA_USDC_MINT,
} from "../src/domain/solana.js";
import type { Candidate, RankingCandidate } from "../src/domain/schemas.js";
import { ZeroExSolanaProvider } from "../src/server/adapters/zero-ex-solana.js";
import type { CandidateProvider } from "../src/server/adapters/types.js";

const memoProgram = new Keypair().publicKey;
const blockhash = "11111111111111111111111111111111";

function candidate(): Candidate {
	const asset = SOLANA_ASSET_REGISTRY.JUP;
	if (!asset) throw new Error("JUP_ASSET_REQUIRED");
	return {
		chain: "SOLANA",
		assetId: asset.assetId,
		symbol: asset.symbol,
		name: asset.name,
		kind: asset.kind,
		contract: asset.address,
		decimals: asset.decimals,
		eligible: true,
		marketHealthy: true,
		permissionAllowed: true,
		crowdScoreBps: 9000,
		reason: "test route",
		evidenceIds: ["test"],
	};
}

function providerFor(wallet: string, signer = wallet) {
	const discovered = candidate();
	const discovery: CandidateProvider = {
		getAsset: vi.fn(async () => undefined),
		getRankingCandidates: vi.fn(async () => [] as RankingCandidate[]),
		getCandidatesForFeed: vi.fn(async () => [discovered]),
		getCandidatesForExecution: vi.fn(async () => [discovered]),
		getCandidates: vi.fn(async () => [discovered]),
	};
	const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(body.token_in).toBe(SOLANA_USDC_MINT);
		return Response.json({
			amount_out: 2_000_000,
			min_amount_out: 1_990_000,
			instructions: [
				{
					program_id: [...memoProgram.toBytes()],
					accounts: [
						{
							pubkey: [...new PublicKey(signer).toBytes()],
							is_signer: true,
							is_writable: false,
						},
					],
					data: [],
				},
			],
			address_lookup_tables: [],
			zid: "00112233445566778899aabb",
			route_plan: [{ dex_label: "Mock DEX" }],
		});
	});
	const provider = new ZeroExSolanaProvider(
		"test-0x-key",
		"https://api.mainnet-beta.solana.com",
		discovery,
		fetcher as typeof fetch,
	);
	Object.assign(provider as object, {
		connection: {
			getLatestBlockhash: vi.fn(async () => ({
				blockhash,
				lastValidBlockHeight: 500,
			})),
			simulateTransaction: vi.fn(async () => ({
				value: { err: null, unitsConsumed: 100_000 },
			})),
		},
	});
	return { provider, fetcher };
}

describe("0x Solana execution", () => {
	it("retries a rate-limited route before declaring the asset unavailable", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider, fetcher } = providerFor(wallet);
		fetcher.mockImplementationOnce(async () =>
			new Response("rate limited", {
				status: 429,
				headers: { "retry-after": "0.001" },
			}),
		);

		await expect(
			provider.price(wallet, wallet, candidate(), "100000", 50),
		).resolves.toMatchObject({ provider: "ZERO_EX", chain: "SOLANA" });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("uses 0x for exact feed eligibility while keeping discovery separate", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider, fetcher } = providerFor(wallet);
		const candidates = await provider.getCandidatesForFeed(
			wallet,
			[candidate().assetId],
			"100000",
			new Date("2026-08-03T12:00:00.000Z"),
			1,
		);

		expect(candidates[0]?.quote).toMatchObject({
			provider: "ZERO_EX",
			chain: "SOLANA",
			minimumAmountOut: "1990000",
		});
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.0x.org/solana/swap-instructions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("builds one unsigned v0 transaction for a Solana basket", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet);
		const asset = candidate();
		const prepared = await provider.prepareBasket(
			wallet,
			{
				chain: "SOLANA",
				cluster: "mainnet-beta",
				inputToken: SOLANA_USDC_MINT,
				sessionId: "zero-ex-solana",
				periodLimitUsd: 1,
				selections: [{ assetId: asset.assetId, amountInBaseUnits: "100000" }],
				slippageBps: 50,
			},
			[asset],
		);

		expect(prepared.quotes[0]?.provider).toBe("ZERO_EX");
		expect(prepared.solanaTransaction).toMatchObject({
			kind: "SOLANA_TRANSACTION",
			expectedBalanceChanges: [
				{ assetId: asset.assetId, minimumAmountOut: "1990000" },
			],
		});
		expect(prepared.solanaTransaction.messageCommitment).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("fails closed when 0x requests another signer", async () => {
		const wallet = Keypair.generate().publicKey.toBase58();
		const unexpectedSigner = Keypair.generate().publicKey.toBase58();
		const { provider } = providerFor(wallet, unexpectedSigner);
		const asset = candidate();

		await expect(
			provider.prepareBasket(
				wallet,
				{
					chain: "SOLANA",
					cluster: "mainnet-beta",
					inputToken: SOLANA_USDC_MINT,
					sessionId: "bad-signer",
					periodLimitUsd: 1,
					selections: [{ assetId: asset.assetId, amountInBaseUnits: "100000" }],
					slippageBps: 50,
				},
				[asset],
			),
		).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
	});
});
