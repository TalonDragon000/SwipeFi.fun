import { expect, it, vi } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import { rankingInputSchema } from "../src/domain/schemas.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import {
  compactRankingInput,
  ZeroGProvider
} from "../src/server/adapters/zero-g.js";

async function rankingInput() {
  const candidates = await new DemoProvider().getRankingCandidates(60);
  const unsigned = {
    schemaVersion: "investmade-ranking-input/v1" as const,
    sessionId: "test-session",
    epochId: "test-epoch",
    policyVersion: "investmade-policy/v1" as const,
    budget: {
      periodBudgetBaseUnits: "100000000",
      slotBudgetBaseUnits: "10000000",
      maxCards: 10
    },
    preferences: {
      cadence: "weekly" as const,
      ticketSizeUsd: 10,
      riskMode: "balanced" as const,
      assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const
    },
    candidates
  };
  return rankingInputSchema.parse({
    ...unsigned,
    inputCommitment: sha256(unsigned)
  });
}

it("keeps a 60-asset discovery universe available to personalization", async () => {
  const input = await rankingInput();
  const seed = input.candidates[0];
  if (!seed) throw new Error("ranking fixture missing");
  const candidates = Array.from({ length: 60 }, (_, index) => ({
    ...seed,
    assetId: `rh:4663:TEST${index + 1}`,
    symbol: `TEST${index + 1}`,
    discoveryRank: index + 1
  }));
  const unsigned = {
    ...input,
    candidates
  };
  const expanded = rankingInputSchema.parse({
    ...unsigned,
    inputCommitment: sha256({
      schemaVersion: unsigned.schemaVersion,
      sessionId: unsigned.sessionId,
      epochId: unsigned.epochId,
      policyVersion: unsigned.policyVersion,
      budget: unsigned.budget,
      preferences: unsigned.preferences,
      candidates
    })
  });

  const { modelInput } = compactRankingInput(expanded);

  expect(modelInput.candidates).toHaveLength(60);
  expect(modelInput.candidates.at(-1)?.key).toBe("c60");
});

function modelOutput(input: Awaited<ReturnType<typeof rankingInput>>) {
  const { modelInput } = compactRankingInput(input);
  return {
    regime: "CRYPTO_NEUTRAL",
    top: modelInput.candidates.map((candidate, index) => ({
      key: candidate.key,
      score: 90 - index
    }))
  };
}

it("uses the compact response contract and generates reasons on the server", async () => {
  const input = await rankingInput();
  const output = modelOutput(input);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 500, completion_tokens: 300 },
        x_0g_trace: { tee_verified: true, provider: "0xprovider" }
      }),
      { status: 200 }
    )
  );

  const result = await new ZeroGProvider("secret").rank(input);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(init.body));
  const sentInput = JSON.parse(body.messages[1].content);

  expect((init.headers as Record<string, string>)["X-0G-Provider-Trust-Mode"]).toBe("private");
  expect(body.verify_tee).toBe(true);
  expect(body.max_tokens).toBe(400);
  expect(body.messages[0].content).not.toContain('"reason"');
  expect(body.messages[0].content).not.toContain('"warnings"');
  expect(sentInput.candidates[0]).toMatchObject({ key: "c01" });
  expect(JSON.stringify(sentInput)).not.toContain("assetId");
  expect(JSON.stringify(sentInput)).not.toContain("inputCommitment");
  expect(result.output.assets.map((asset) => asset.assetId)).toEqual(
    input.candidates.map((candidate) => candidate.assetId)
  );
  expect(result.output.assets[0]?.reason).toContain(
    "scored 90/100 for your balanced weekly plan"
  );
  expect(result.output.warnings).toEqual([]);
  expect(result.diagnostics).toMatchObject({
    transport: "native",
    promptTokens: 500,
    completionTokens: 300
  });
  fetchMock.mockRestore();
});

it("falls back to fenced plain-text JSON when native JSON mode is unsupported", async () => {
  const input = await rankingInput();
  const output = modelOutput(input);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: "model does not support JSON mode (response_format: json_object)" }
        }),
        { status: 400 }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` } }
          ]
        }),
        { status: 200 }
      )
    );

  const result = await new ZeroGProvider(
    "secret",
    "plain-model",
    "verified",
    "auto"
  ).rank(input);
  const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

  expect(firstBody.response_format).toEqual({ type: "json_object" });
  expect(secondBody.response_format).toBeUndefined();
  expect(result.diagnostics.transport).toBe("text");
  fetchMock.mockRestore();
});

it("rejects an invented candidate key", async () => {
  const input = await rankingInput();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              regime: "CRYPTO_NEUTRAL",
              top: [{ key: "c99", score: 50 }]
            })
          }
        }],
        x_0g_trace: { tee_verified: true }
      }),
      { status: 200 }
    )
  );

  await expect(new ZeroGProvider("secret").rank(input)).rejects.toThrow(
    "MODEL_UNKNOWN_CANDIDATE_KEY:c99"
  );
  vi.restoreAllMocks();
});

it("rejects legacy model-generated reason and warnings fields", async () => {
  const input = await rankingInput();
  const output = modelOutput(input);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              ...output,
              warnings: ["legacy"],
              top: output.top.map((asset) => ({ ...asset, reason: "legacy" }))
            })
          }
        }],
        x_0g_trace: { tee_verified: true }
      }),
      { status: 200 }
    )
  );

  await expect(new ZeroGProvider("secret").rank(input)).rejects.toThrow();
  vi.restoreAllMocks();
});
