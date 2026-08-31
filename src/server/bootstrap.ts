import { CoinGeckoIconProvider } from "./adapters/coingecko.js";
import { DemoProvider } from "./adapters/demo.js";
import { DeterministicRanker } from "./adapters/deterministic-ranker.js";
import { JupiterProvider } from "./adapters/jupiter.js";
import type { ExecutionProviderId } from "../domain/schemas.js";
import type {
	CandidateProvider,
	ExecutionProvider,
} from "./adapters/types.js";
import { ZeroExSolanaProvider } from "./adapters/zero-ex-solana.js";
import { ZeroGProvider } from "./adapters/zero-g.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresStateStore } from "./postgres-store.js";
import { MemoryStateStore } from "./store.js";

export function createServerApp() {
	const config = loadConfig();
	const demo = new DemoProvider();
	const demoZeroEx = new DemoProvider("ZERO_EX");
	const deterministic = new DeterministicRanker();
	const required = (value: string | undefined, name: string) => {
		if (!value) throw new Error(`${name}_REQUIRED`);
		return value;
	};
	const store = config.demoMode
		? new MemoryStateStore()
		: new PostgresStateStore(required(config.DATABASE_URL, "DATABASE_URL"));
	const coinGecko = new CoinGeckoIconProvider(
		config.COINGECKO_API_KEY,
		fetch,
		store,
	);
	const executionProviders: Partial<
		Record<ExecutionProviderId, ExecutionProvider>
	> = {};
	const candidateProviders: Partial<
		Record<ExecutionProviderId, CandidateProvider>
	> = {};
	let jupiterProvider: JupiterProvider | undefined;
	if (
		config.JUPITER_API_KEY &&
		config.SOLANA_RPC_URL &&
		config.SOLANA_WS_URL
	) {
		jupiterProvider = new JupiterProvider(
			config.JUPITER_API_KEY,
			config.SOLANA_RPC_URL,
			fetch,
			store,
		);
		executionProviders.JUPITER = jupiterProvider;
		candidateProviders.JUPITER = jupiterProvider;
		if (config.ZERO_EX_API_KEY) {
			const zeroExSolana = new ZeroExSolanaProvider(
				config.ZERO_EX_API_KEY,
				config.SOLANA_RPC_URL,
				jupiterProvider,
			);
			executionProviders.ZERO_EX = zeroExSolana;
			candidateProviders.ZERO_EX = zeroExSolana;
		}
	}
	const defaultExecution = executionProviders.JUPITER ?? demo;
	const defaultCandidates = candidateProviders.JUPITER ?? demo;
	const zeroG = config.ZG_ROUTER_API_KEY
		? new ZeroGProvider(config.ZG_ROUTER_API_KEY)
		: undefined;
	const inference = zeroG ?? deterministic;

	return createApp({
		config,
		store,
		candidates: defaultCandidates,
		candidateProviders: config.liveExecution
			? candidateProviders
			: { JUPITER: demo, ZERO_EX: demoZeroEx },
		inference,
		rankingProviders: {
			...(zeroG ? { ZERO_G: zeroG } : {}),
			DETERMINISTIC: deterministic,
		},
		execution: defaultExecution,
		executionProviders: config.liveExecution
			? executionProviders
			: { JUPITER: demo, ZERO_EX: demoZeroEx },
		icons: coinGecko,
		marketData: coinGecko,
		history: coinGecko,
	});
}
