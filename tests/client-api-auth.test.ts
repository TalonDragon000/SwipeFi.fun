import { afterEach, describe, expect, it, vi } from "vitest";
import { api, configureApiAuth } from "../src/client/api.js";

describe("client API authentication", () => {
	afterEach(() => {
		configureApiAuth(undefined);
		vi.restoreAllMocks();
	});

	it("keeps wallet and chain headers from one provider while the token resolves", async () => {
		let resolveToken: ((token: string) => void) | undefined;
		const token = new Promise<string>((resolve) => {
			resolveToken = resolve;
		});
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({}));

		configureApiAuth({
			getAccessToken: () => token,
			getWalletAddress: () => "SolanaWallet",
			getWalletChain: () => "SOLANA",
		});
		const pendingRequest = api.preferences();

		configureApiAuth({
			getAccessToken: async () => "other-token",
			getWalletAddress: () => "OtherWallet",
			getWalletChain: () => "SOLANA",
		});
		resolveToken?.("solana-token");
		await pendingRequest;

		const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
		expect(headers.get("Authorization")).toBe("Bearer solana-token");
		expect(headers.get("X-Wallet-Address")).toBe("SolanaWallet");
		expect(headers.get("X-Wallet-Chain")).toBe("SOLANA");
	});
});
