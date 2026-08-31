import { z } from "zod";
import { sha256 } from "../../domain/canonical.js";
import type {
  RankingCandidate,
  RankingInput,
  RankingOutput
} from "../../domain/schemas.js";
import type { PrivateInferenceProvider } from "./types.js";

// Keep the private model's view aligned with the server discovery pool. Exact
// execution checks still happen only after the personalized ordering is known.
const MODEL_CANDIDATE_LIMIT = 60;
const MODEL_RESULT_LIMIT = 15;

export type ZeroGTrustMode = "private" | "verified" | "standard" | "any";
export type ZeroGJsonMode = "native" | "text" | "auto";

const modelRankingSchema = z.object({
  regime: z.enum([
    "CRYPTO_BULLISH",
    "CRYPTO_NEUTRAL",
    "CRYPTO_BEARISH",
    "RISK_OFF"
  ]),
  top: z
    .array(
      z.object({
        key: z.string().regex(/^c\d{2}$/),
        score: z.number().int().min(0).max(100)
      }).strict()
    )
    .min(1)
    .max(MODEL_RESULT_LIMIT)
}).strict();

export const RANKING_SYSTEM_PROMPT = `Rank investment candidates for the supplied user preferences.
Return one JSON object only:
{"regime":"CRYPTO_BULLISH|CRYPTO_NEUTRAL|CRYPTO_BEARISH|RISK_OFF","top":[{"key":"c01","score":82}]}
Use only candidate keys from the input. Never copy or invent asset IDs.
Return exactly 15 unique keys when at least 15 candidates are supplied, otherwise return every key.
Meaningfully rerank for risk mode, cadence, asset mix, and available market metrics.
discoveryRank is weak evidence and only a tie-breaker; do not copy the input order.
CoinGecko marketCapRank is a bounded quality signal, not a substitute for liquidity or risk evidence.
Treat null metrics as unknown and never invent missing data.
Return no fields other than regime, top, key, and score.`;

type RouterBody = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  x_0g_trace?: {
    tee_verified?: boolean;
    provider?: string;
  };
};

export class ZeroGProvider implements PrivateInferenceProvider {
  private resolvedJsonMode: Exclude<ZeroGJsonMode, "auto"> | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly model = "0gm-1.0-35b-a3b",
    private readonly trustMode: ZeroGTrustMode = "private",
    private readonly jsonMode: ZeroGJsonMode = "native"
  ) {}

  async rank(input: RankingInput) {
    const { modelInput, candidatesByKey } = compactRankingInput(input);
    let transport = this.resolvedJsonMode ??
      (this.jsonMode === "auto" ? "native" : this.jsonMode);
    let response = await this.request(modelInput, transport);
    if (
      !response.http.ok &&
      this.jsonMode === "auto" &&
      transport === "native" &&
      response.body.error?.message?.includes("does not support JSON mode")
    ) {
      transport = "text";
      this.resolvedJsonMode = "text";
      response = await this.request(modelInput, transport);
    } else if (response.http.ok && this.jsonMode === "auto") {
      this.resolvedJsonMode = transport;
    }
    if (!response.http.ok) {
      throw new Error(
        `ZG_HTTP_${response.http.status}: ${response.body.error?.message ?? "request failed"}`
      );
    }
    if (
      this.trustMode === "private" &&
      response.body.x_0g_trace?.tee_verified !== true
    ) {
      throw new Error("UNVERIFIED_PRIVATE_INFERENCE");
    }

    const raw = modelRankingSchema.parse(
      parseJsonContent(response.body.choices?.[0]?.message?.content)
    );
    const seen = new Set<string>();
    const assets = raw.top.map((asset, index) => {
      const candidate = candidatesByKey.get(asset.key);
      if (!candidate) throw new Error(`MODEL_UNKNOWN_CANDIDATE_KEY:${asset.key}`);
      if (seen.has(asset.key)) throw new Error(`MODEL_DUPLICATE_CANDIDATE_KEY:${asset.key}`);
      seen.add(asset.key);
      return {
        assetId: candidate.assetId,
        rank: index + 1,
        scoreBps: asset.score * 100,
        reason: serverRankingReason(candidate, input, asset.score)
      };
    });
    const output: RankingOutput = {
      schemaVersion: "investmade-ranking-output/v1",
      sessionId: input.sessionId,
      inputCommitment: input.inputCommitment,
      policyVersion: input.policyVersion,
      regime: raw.regime,
      assets,
      warnings: []
    };
    return {
      output,
      receipt: {
        network: "0G mainnet",
        model: this.model,
        provider: String(response.body.x_0g_trace?.provider ?? "unknown"),
        teeVerified: response.body.x_0g_trace?.tee_verified === true,
        inputCommitment: input.inputCommitment,
        outputCommitment: sha256(output),
        rawOutputCommitment: sha256(raw)
      },
      diagnostics: {
        transport,
        promptTokens: response.body.usage?.prompt_tokens,
        completionTokens: response.body.usage?.completion_tokens,
        returnedAssets: raw.top.length
      }
    };
  }

  private async request(
    modelInput: ReturnType<typeof compactRankingInput>["modelInput"],
    transport: Exclude<ZeroGJsonMode, "auto">
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-0G-Provider-Sort": "latency"
    };
    if (this.trustMode !== "any") {
      headers["X-0G-Provider-Trust-Mode"] = this.trustMode;
    }
    const http = await fetch("https://router-api.0g.ai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: RANKING_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(modelInput) }
        ],
        ...(transport === "native"
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(this.trustMode === "private" ? { verify_tee: true } : {}),
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 400,
        stream: false
      }),
      signal: AbortSignal.timeout(45_000)
    });
    return {
      http,
      body: (await http.json()) as RouterBody
    };
  }
}

function serverRankingReason(
  candidate: RankingCandidate,
  input: RankingInput,
  score: number
): string {
  const signals: string[] = [];
  if (candidate.priceChange24hPct !== undefined) {
    const change = candidate.priceChange24hPct;
    signals.push(`${change >= 0 ? "+" : ""}${change.toFixed(1)}% 24h move`);
  }
  if (candidate.volume24hUsd !== undefined) {
    signals.push(`${formatCompactUsd(candidate.volume24hUsd)} 24h volume`);
  }
  if (candidate.marketCapRank !== undefined) {
    signals.push(`CoinGecko market-cap rank #${candidate.marketCapRank}`);
  }
  const evidence =
    signals.length > 0
      ? signals.join(" and ")
      : `${candidate.kind === "CRYPTO" ? "crypto" : "tokenized-stock"} market data`;
  return `${candidate.symbol} scored ${score}/100 for your ${input.preferences.riskMode} ${input.preferences.cadence} plan, using ${evidence}.`;
}

function formatCompactUsd(value: number): string {
  return `$${Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value)}`;
}

export function compactRankingInput(input: RankingInput) {
  const candidates = input.candidates
    .slice(0, MODEL_CANDIDATE_LIMIT)
    .map((candidate, index) => ({
      key: `c${String(index + 1).padStart(2, "0")}`,
      symbol: candidate.symbol,
      type: candidate.kind === "CRYPTO" ? "crypto" as const : "stock" as const,
      discoveryRank: candidate.discoveryRank,
      classification: candidate.primaryClassification,
      classificationConfidence: candidate.classificationConfidence,
      priceUsd: candidate.priceUsd ?? null,
      volume24hUsd: candidate.volume24hUsd ?? null,
      liquidityUsd: candidate.liquidityUsd ?? null,
      organicScore: candidate.organicScore ?? null,
      marketCapRank: candidate.marketCapRank ?? null,
      change24hPct: candidate.priceChange24hPct ?? null,
      riskFlags: candidate.riskFlags
    }));
  return {
    modelInput: {
      preferences: {
        cadence: input.preferences.cadence,
        risk: input.preferences.riskMode,
        ticketUsd: input.preferences.ticketSizeUsd,
        assetMix: input.preferences.assetClasses.map((kind) =>
          kind === "CRYPTO" ? "crypto" as const : "stock" as const
        )
      },
      candidates
    },
    candidatesByKey: new Map<string, RankingCandidate>(
      candidates.map((candidate, index) => [
        candidate.key,
        input.candidates[index] as RankingCandidate
      ])
    )
  };
}

function parseJsonContent(content: unknown): unknown {
  if (typeof content !== "string") throw new Error("ZG_CONTENT_MISSING");
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(withoutFence);
}
