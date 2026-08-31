import { config } from "dotenv";
import { sha256 } from "../src/domain/canonical.js";
import { POLICY_VERSION } from "../src/domain/constants.js";
import { SOLANA_ASSET_REGISTRY } from "../src/domain/solana.js";
import {
  rankingInputSchema,
  type RankingInput
} from "../src/domain/schemas.js";
import {
  type ZeroGTrustMode,
  ZeroGProvider
} from "../src/server/adapters/zero-g.js";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const response = await fetch("https://router-api.0g.ai/v1/models");
  if (!response.ok) throw new Error(`0G models ${response.status}`);
  const body = (await response.json()) as {
    data?: Array<{ id: string; provider_count?: number }>;
  };
  console.table(
    (body.data ?? []).map(({ id, provider_count }) => ({
      model: id,
      providers: provider_count ?? "?"
    }))
  );
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const positional = args.filter((argument) => !argument.startsWith("--"));
const model = positional[0] ?? "0gm-1.0-35b-a3b";
const trustMode = positional[1] ?? "private";
if (!["private", "verified", "standard", "any"].includes(trustMode)) {
  throw new Error("Trust mode must be private, verified, standard, or any.");
}

const profiles = [
  { riskMode: "conservative", cadence: "monthly" },
  { riskMode: "balanced", cadence: "weekly" },
  { riskMode: "degen", cadence: "daily" }
] as const;
const inputs = profiles.map(({ riskMode, cadence }) =>
  benchmarkInput(riskMode, cadence)
);

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        model,
        trustMode,
        fixtures: inputs.map((input) => ({
          risk: input.preferences.riskMode,
          candidates: input.candidates.length,
          inputCommitment: input.inputCommitment
        }))
      },
      null,
      2
    )
  );
  process.exit(0);
}

const apiKey = process.env.ZG_ROUTER_API_KEY;
if (!apiKey) throw new Error("ZG_ROUTER_API_KEY is missing.");
const provider = new ZeroGProvider(
  apiKey,
  model,
  trustMode as ZeroGTrustMode,
  "auto"
);
const rows = [];
for (const input of inputs) {
  const startedAt = performance.now();
  try {
    const result = await provider.rank(input);
    const top10 = result.output.assets.slice(0, 10);
    rows.push({
      profile: input.preferences.riskMode,
      latencyMs: Math.round(performance.now() - startedAt),
      promptTokens: result.diagnostics.promptTokens ?? "?",
      completionTokens: result.diagnostics.completionTokens ?? "?",
      returnedAssets: result.diagnostics.returnedAssets,
      transport: result.diagnostics.transport,
      teeVerified: result.receipt.teeVerified,
      copiedSource: top10.every(
        (asset, index) => asset.assetId === input.candidates[index]?.assetId
      ),
      top10: top10
        .map((asset) =>
          input.candidates.find((candidate) => candidate.assetId === asset.assetId)
            ?.symbol
        )
        .join(", ")
    });
  } catch (error) {
    rows.push({
      profile: input.preferences.riskMode,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}

console.table(rows);
const successful = rows.filter(
  (row): row is typeof row & { top10: string } => "top10" in row
);
const latencies = successful
  .map((result) => result.latencyMs)
  .sort((left, right) => left - right);
const distinctRankings = new Set(successful.map((result) => result.top10)).size;
console.log(
  `median=${latencies[1] ?? "n/a"}ms valid=${successful.length}/3 distinctTop10=${distinctRankings} model=${model} trust=${trustMode}`
);
if (successful.length !== 3 || distinctRankings < 2) process.exitCode = 1;

function benchmarkInput(
  riskMode: "conservative" | "balanced" | "degen",
  cadence: "daily" | "weekly" | "monthly"
): RankingInput {
  const changes = [-11.8, -6.2, -2.4, 0.3, 2.7, 5.9, 9.6];
  const candidates = Object.values(SOLANA_ASSET_REGISTRY)
    .slice(0, 30)
    .map((asset, index) => ({
      assetId: asset.assetId,
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      chain: "SOLANA" as const,
      discoveryRank: index + 1,
      priceUsd: Number((18 + index * 7.25).toFixed(2)),
      volume24hUsd: 750_000 + ((index * 379_123) % 9_000_000),
      priceChange24hPct: changes[index % changes.length]
    }));
  const unsigned = {
    schemaVersion: "investmade-ranking-input/v1" as const,
    sessionId: `benchmark-${riskMode}`,
    epochId: "benchmark-epoch",
    policyVersion: POLICY_VERSION,
    budget: {
      periodBudgetBaseUnits: "100000000",
      slotBudgetBaseUnits: "10000000",
      maxCards: 10
    },
    preferences: {
      cadence,
      periodLimitUsd: 100,
      ticketSizeUsd: 10,
      riskMode,
      assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const
    },
    candidates
  };
  return rankingInputSchema.parse({
    ...unsigned,
    inputCommitment: sha256(unsigned)
  });
}
