import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.js";

const base = {
	NODE_ENV: "development" as const,
	INVESTMADE_DEMO_MODE: "true" as const,
	PUBLIC_ORIGIN: "http://localhost:5173",
	SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
	PRIVY_APP_ID: "test-privy-app-id",
	PRIVY_APP_SECRET: "test-privy-app-secret",
	ZERO_EX_API_KEY: "test-0x-key",
	COINGECKO_API_KEY: "test-coingecko-key",
};

describe("execution modes", () => {
	it("allows local live signing only as a development-time, demo-backed mode", () => {
		const config = loadConfig({ ...base, LOCAL_LIVE_EXECUTION: "true" });
		expect(config.demoMode).toBe(true);
		expect(config.localLiveExecution).toBe(true);
		expect(config.liveExecution).toBe(true);
	});

	it("rejects local live signing in a production process", () => {
		expect(() =>
			loadConfig({
				...base,
				NODE_ENV: "production",
				LOCAL_LIVE_EXECUTION: "true",
			}),
		).toThrow("LOCAL_LIVE_EXECUTION must not run in production");
	});

	it("requires at least one server-side execution-provider key for local live execution", () => {
		const { ZERO_EX_API_KEY: _key, ...withoutZeroEx } = base;
		expect(() =>
			loadConfig({ ...withoutZeroEx, LOCAL_LIVE_EXECUTION: "true" }),
		).toThrow(
			"ZERO_EX_API_KEY or UNISWAP_API_KEY is required for live execution",
		);
	});

	it("starts live production when persistent state, quotes, and private inference are configured", () => {
		const config = loadConfig({
			...base,
			NODE_ENV: "production",
			INVESTMADE_DEMO_MODE: "false",
			DATABASE_URL: "postgresql://user:password@example.com:5432/investmade",
			ZG_ROUTER_API_KEY: "test-0g-router-key",
		});

		expect(config.liveExecution).toBe(true);
		expect(config.demoMode).toBe(false);
	});
});
