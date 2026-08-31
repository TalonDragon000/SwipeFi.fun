import { describe, expect, it } from "vitest";
import {
	personalizationPreferencesSchema,
	type OnboardingPreferences,
} from "../src/domain/schemas.js";
import {
	preferencesKey,
	readAccountPreferences,
	removeAccountPreferences,
	removeLegacyPreferences,
	writeAccountPreferences,
	type PreferencesStorage,
} from "../src/client/preferences-storage.js";

class MemoryStorage implements PreferencesStorage {
	readonly values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const preferences: OnboardingPreferences = {
	activeChain: "ROBINHOOD",
	cadence: "weekly",
	ticketSizeUsd: 10,
	riskMode: "balanced",
	assetClasses: ["CRYPTO", "STOCK_TOKEN"],
	riskDisclosureAccepted: true,
	executionProvider: "ZERO_EX",
	feedRankingProvider: "ZERO_G",
};

describe("account-scoped preference storage", () => {
	it("defaults new preferences to Uniswap with local ranking", () => {
		const parsed = personalizationPreferencesSchema.parse({
			cadence: "weekly",
			ticketSizeUsd: 10,
			riskMode: "balanced",
			assetClasses: ["CRYPTO", "STOCK_TOKEN"],
		});

		expect(parsed.executionProvider).toBe("UNISWAP");
		expect(parsed.feedRankingProvider).toBe("DETERMINISTIC");
	});

	it("keeps preferences isolated by Privy user id", () => {
		const storage = new MemoryStorage();
		writeAccountPreferences("did:privy:alice", preferences, storage);

		expect(readAccountPreferences("did:privy:alice", storage)).toEqual(
			preferences,
		);
		expect(readAccountPreferences("did:privy:bob", storage)).toBeUndefined();
	});

	it("rejects malformed stored preferences", () => {
		const storage = new MemoryStorage();
		storage.setItem(
			preferencesKey("did:privy:alice"),
			JSON.stringify({
				version: 3,
				preferences: { ...preferences, ticketSizeUsd: 0 },
			}),
		);

		expect(readAccountPreferences("did:privy:alice", storage)).toBeUndefined();
	});

	it("removes only the selected account and clears the unsafe legacy key", () => {
		const storage = new MemoryStorage();
		writeAccountPreferences("did:privy:alice", preferences, storage);
		writeAccountPreferences("did:privy:bob", preferences, storage);
		storage.setItem(
			"investmade:onboarding:v2",
			JSON.stringify({ version: 2, preferences }),
		);

		removeAccountPreferences("did:privy:alice", storage);
		removeLegacyPreferences(storage);

		expect(readAccountPreferences("did:privy:alice", storage)).toBeUndefined();
		expect(readAccountPreferences("did:privy:bob", storage)).toEqual(
			preferences,
		);
		expect(storage.getItem("investmade:onboarding:v2")).toBeNull();
	});
});
