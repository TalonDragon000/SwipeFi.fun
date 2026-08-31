import { describe, expect, it } from "vitest";
import { normalizeStoredWallet } from "../src/server/postgres-store.js";

describe("Postgres wallet storage", () => {
	it("preserves case-sensitive Solana addresses", () => {
		const wallet = "EdN4W3Pa7uhC5DLL1vYYY82masEBJ32GQXNbpXeowAqN";
		expect(normalizeStoredWallet(wallet, "SOLANA")).toBe(wallet);
	});

	it("normalizes case-insensitive Robinhood addresses", () => {
		expect(
			normalizeStoredWallet(
				"0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
				"ROBINHOOD",
			),
		).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
	});
});
