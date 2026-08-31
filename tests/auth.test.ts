import type { LinkedAccount } from "@privy-io/node";
import { describe, expect, it } from "vitest";
import {
	executionActorFromLinkedAccounts,
	isEthereumWallet,
	isInvestmadeWallet,
} from "../src/server/auth.js";

describe("Privy linked wallet boundary", () => {
	it("accepts an Ethereum wallet account", () => {
		expect(
			isEthereumWallet({
				type: "wallet",
				chain_type: "ethereum",
				address: "0x71f30000000000000000000000000000000009a2",
			} as LinkedAccount),
		).toBe(true);
	});

	it("accepts the Privy smart wallet used as the canonical execution account", () => {
		expect(
			isInvestmadeWallet({
				type: "smart_wallet",
				address: "0x71f30000000000000000000000000000000009a2",
			} as LinkedAccount),
		).toBe(true);
	});

	it("rejects non-Ethereum and non-wallet accounts", () => {
		expect(
			isEthereumWallet({
				type: "wallet",
				chain_type: "solana",
				address: "8VQwqjke",
			} as LinkedAccount),
		).toBe(false);
		expect(
			isEthereumWallet({
				type: "email",
				address: "user@example.com",
			} as LinkedAccount),
		).toBe(false);
	});

	it("accepts txOrigin only when the smart wallet and embedded EOA belong to the same user", () => {
		const accounts = [
			{
				type: "smart_wallet",
				address: "0x71f30000000000000000000000000000000009a2",
			},
			{
				type: "wallet",
				chain_type: "ethereum",
				address: "0x71f30000000000000000000000000000000009a3",
			},
		] as LinkedAccount[];
		expect(
			executionActorFromLinkedAccounts(
				accounts,
				"0x71f30000000000000000000000000000000009a2",
				"0x71f30000000000000000000000000000000009a3",
			),
		).toEqual({
			wallet: "0x71f30000000000000000000000000000000009a2",
			txOrigin: "0x71f30000000000000000000000000000000009a3",
			chain: "ROBINHOOD",
		});
		expect(() =>
			executionActorFromLinkedAccounts(
				accounts,
				"0x71f30000000000000000000000000000000009a2",
				"0x71f30000000000000000000000000000000009a4",
			),
		).toThrow("TX_ORIGIN_NOT_LINKED_TO_PRIVY_USER");
	});

	it("authorizes only a Solana wallet linked to the same Privy user", () => {
		const wallet = "7dHbWXadHki3tFQ5wPzQ3pQZf2fQxv9KZQmXWm8pY7e";
		const accounts = [
			{ type: "wallet", chain_type: "solana", address: wallet },
		] as LinkedAccount[];
		expect(
			executionActorFromLinkedAccounts(accounts, wallet, wallet, "SOLANA"),
		).toEqual({ wallet, txOrigin: wallet, chain: "SOLANA" });
		expect(() =>
			executionActorFromLinkedAccounts(
				accounts,
				"8dHbWXadHki3tFQ5wPzQ3pQZf2fQxv9KZQmXWm8pY7e",
				wallet,
				"SOLANA",
			),
		).toThrow("SOLANA_WALLET_NOT_LINKED_TO_PRIVY_USER");
	});
});
