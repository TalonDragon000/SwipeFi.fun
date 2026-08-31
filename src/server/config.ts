import { z } from "zod";

const envSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		INVESTMADE_DEMO_MODE: z.enum(["true", "false"]).default("true"),
		LOCAL_LIVE_EXECUTION: z.enum(["true", "false"]).default("false"),
		PORT: z.coerce.number().int().positive().default(8787),
		PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
		SESSION_SECRET: z
			.string()
			.min(32)
			.default("local-demo-only-secret-change-me-000"),
		PRIVY_APP_ID: z.string().min(1),
		PRIVY_APP_SECRET: z.string().min(1),
		DATABASE_URL: z.string().optional(),
		ZERO_EX_API_KEY: z.string().optional(),
		JUPITER_API_KEY: z.string().optional(),
		SOLANA_RPC_URL: z.string().url().optional(),
		SOLANA_WS_URL: z.string().url().optional(),
		COINGECKO_API_KEY: z.string().optional(),
		ZG_ROUTER_API_KEY: z.string().optional(),
	})
	.superRefine((env, context) => {
		if (
			env.LOCAL_LIVE_EXECUTION === "true" &&
			env.INVESTMADE_DEMO_MODE !== "true"
		) {
			context.addIssue({
				code: "custom",
				path: ["LOCAL_LIVE_EXECUTION"],
				message:
					"LOCAL_LIVE_EXECUTION is only supported with INVESTMADE_DEMO_MODE=true",
			});
		}
		if (env.LOCAL_LIVE_EXECUTION === "true" && env.NODE_ENV === "production") {
			context.addIssue({
				code: "custom",
				path: ["LOCAL_LIVE_EXECUTION"],
				message: "LOCAL_LIVE_EXECUTION must not run in production",
			});
		}
		if (
			(env.LOCAL_LIVE_EXECUTION === "true" ||
				env.INVESTMADE_DEMO_MODE === "false") &&
			!env.JUPITER_API_KEY &&
			!env.ZERO_EX_API_KEY
		) {
			context.addIssue({
				code: "custom",
				path: ["JUPITER_API_KEY"],
				message:
					"JUPITER_API_KEY or ZERO_EX_API_KEY is required for live execution",
			});
		}
		if (env.INVESTMADE_DEMO_MODE === "false") {
			for (const key of [
				"DATABASE_URL",
				"COINGECKO_API_KEY",
				"ZG_ROUTER_API_KEY",
				"JUPITER_API_KEY",
				"SOLANA_RPC_URL",
				"SOLANA_WS_URL",
			] as const) {
				if (!env[key]) {
					context.addIssue({
						code: "custom",
						path: [key],
						message: `${key} is required when INVESTMADE_DEMO_MODE=false`,
					});
				}
			}
		}
	});

export type AppConfig = z.infer<typeof envSchema> & {
	demoMode: boolean;
	localLiveExecution: boolean;
	liveExecution: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
	const parsed = envSchema.parse(source);
	const demoMode = parsed.INVESTMADE_DEMO_MODE === "true";
	const localLiveExecution = parsed.LOCAL_LIVE_EXECUTION === "true";
	return {
		...parsed,
		demoMode,
		localLiveExecution,
		liveExecution: localLiveExecution || !demoMode,
	};
}
