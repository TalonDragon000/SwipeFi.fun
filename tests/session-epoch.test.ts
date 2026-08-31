import { describe, expect, it } from "vitest";
import { sessionEpochId } from "../src/server/session-epoch.js";
import { MemoryStateStore } from "../src/server/store.js";

describe("session epoch modes", () => {
	it("gives every local-live basket a unique session and epoch", async () => {
		const store = new MemoryStateStore();
		const mode = { demoMode: false, localLiveExecution: true };
		const firstEpoch = sessionEpochId("weekly", mode, "first");
		const secondEpoch = sessionEpochId("weekly", mode, "second");
		const first = await store.openSession("0xabc", firstEpoch);
		const second = await store.openSession("0xabc", secondEpoch);

		expect(second.epochId).not.toBe(first.epochId);
		expect(second.id).not.toBe(first.id);
	});

	it("preserves production idempotency for a wallet and cadence", async () => {
		const store = new MemoryStateStore();
		const mode = { demoMode: false, localLiveExecution: false };
		const firstEpoch = sessionEpochId("weekly", mode, "ignored-first");
		const secondEpoch = sessionEpochId("weekly", mode, "ignored-second");
		const first = await store.openSession("0xabc", firstEpoch);
		const second = await store.openSession("0xabc", secondEpoch);

		expect(second.epochId).toBe(first.epochId);
		expect(second.id).toBe(first.id);
	});
});
