import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../src/server/store.js";
import {
	executionPlanSchema,
	type ExecutionPlan,
} from "../src/domain/schemas.js";

const plan: ExecutionPlan = {
  executionId: "execution-1",
  sessionId: "filled-later",
  epochId: "2026-W30",
  provider: "UNISWAP",
  chain: "ROBINHOOD",
  chainId: 4663,
  inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  totalInputBaseUnits: "10000000",
  authorizedPlanHash: `sha256:${"a".repeat(64)}`,
  policyHash: `sha256:${"b".repeat(64)}`,
  callCommitments: [],
  quotes: [
    {
      requestId: "quote-1",
      assetId: "rh:4663:WETH",
      tokenOut: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      amountInBaseUnits: "10000000",
      estimatedAmountOut: "1",
      minimumAmountOut: "1",
      unitPriceUsd: "10000000",
      priceImpactBps: 10,
      routing: "CLASSIC",
      provider: "UNISWAP",
      chain: "ROBINHOOD",
      quotedAt: "2026-07-25T12:00:00.000Z",
      expiresAt: "2026-07-25T12:01:00.000Z"
    }
  ],
  generatedAt: "2026-07-25T12:00:00.000Z"
};

describe("weekly session idempotency", () => {
  it("keeps historical ZERO_EX and CLASSIC plans parseable with their original provider", () => {
    const legacyZeroEx = {
      ...plan,
      chain: undefined,
      provider: undefined,
      quotes: [
        {
          ...plan.quotes[0],
          chain: undefined,
          provider: undefined,
          routing: "ZERO_EX"
        }
      ]
    };
    const legacyUniswap = {
      ...plan,
      chain: undefined,
      provider: undefined,
      quotes: [
        {
          ...plan.quotes[0],
          chain: undefined,
          provider: undefined,
          routing: "CLASSIC"
        }
      ]
    };
    expect(executionPlanSchema.parse(legacyZeroEx)).toMatchObject({
      chain: "ROBINHOOD",
      provider: "ZERO_EX"
    });
    expect(executionPlanSchema.parse(legacyUniswap)).toMatchObject({
      chain: "ROBINHOOD",
      provider: "UNISWAP"
    });
  });

  it("returns one session per wallet and epoch", async () => {
    const store = new MemoryStateStore();
    const first = await store.openSession("0xabc", "2026-W30");
    const second = await store.openSession("0xABC", "2026-W30");
    expect(first.id).toBe(second.id);
  });

  it("uses ranking provider as part of session uniqueness", async () => {
    const store = new MemoryStateStore();
    const zeroG = await store.openSession(
      "0xabc",
      "2026-W30",
      "ZERO_EX",
      "ROBINHOOD",
      "0xabc",
      "ZERO_G"
    );
    const deterministic = await store.openSession(
      "0xabc",
      "2026-W30",
      "ZERO_EX",
      "ROBINHOOD",
      "0xabc",
      "DETERMINISTIC"
    );
    expect(deterministic.id).not.toBe(zeroG.id);
  });

  it("preserves case-sensitive Solana wallet addresses", async () => {
    const store = new MemoryStateStore();
    const wallet = "ENskeWSdXAfqZaDAn3xv7X8CdE88Bb3WQreWGAuk9oyh";
    const session = await store.openSession(
      wallet,
      "2026-W30",
      "JUPITER",
      "SOLANA"
    );
    expect(session.wallet).toBe(wallet);
  });

  it("returns the same execution for the same authorized intent and rejects another", async () => {
    const store = new MemoryStateStore();
    const session = await store.openSession("0xabc", "2026-W30");
    const current = { ...plan, sessionId: session.id };
    const first = await store.reserveExecution(session.id, current);
    const retry = await store.reserveExecution(session.id, {
      ...current,
      executionId: "execution-retry"
    });
    expect(retry.plan.executionId).toBe(first.plan.executionId);
    await expect(
      store.reserveExecution(session.id, {
        ...current,
        executionId: "execution-2",
        authorizedPlanHash: `sha256:${"c".repeat(64)}`
      })
    ).rejects.toThrow("EPOCH_ALREADY_EXECUTED");
  });

  it("atomically replaces an unsigned prepared plan", async () => {
    const store = new MemoryStateStore();
    const session = await store.openSession("0xabc", "2026-W30");
    const current = { ...plan, sessionId: session.id };
    await store.reserveExecution(session.id, current);

    const replacement = {
      ...current,
      authorizedPlanHash: `sha256:${"c".repeat(64)}`,
      totalInputBaseUnits: "20000000"
    };
    const refreshed = await store.refreshPreparedExecution(
      current.executionId,
      current.authorizedPlanHash,
      replacement
    );

    expect(refreshed.plan).toMatchObject({
      executionId: current.executionId,
      authorizedPlanHash: replacement.authorizedPlanHash,
      totalInputBaseUnits: "20000000"
    });
    await expect(
      store.refreshPreparedExecution(
        current.executionId,
        current.authorizedPlanHash,
        current
      )
    ).rejects.toThrow("EPOCH_ALREADY_EXECUTED");
  });

  it("persists terminal output evidence with the execution", async () => {
    const store = new MemoryStateStore();
    const session = await store.openSession("0xabc", "2026-W30");
    const current = { ...plan, sessionId: session.id };
    await store.reserveExecution(session.id, current);
    const settled = await store.updateExecution(
      current.executionId,
      "SETTLED",
      [`0x${"d".repeat(64)}`],
      [
        {
          assetId: "rh:4663:WETH",
          amountOutBaseUnits: "1",
          transactionHash: `0x${"d".repeat(64)}`,
          blockNumber: "123",
          status: "success"
        }
      ]
    );
    expect(settled.settledOutputs[0]?.blockNumber).toBe("123");
  });

  it("records a submitted atomic batch separately from sequential calls", async () => {
    const store = new MemoryStateStore();
    const session = await store.openSession("0xabc", "2026-W30");
    const current = { ...plan, sessionId: session.id };
    await store.reserveExecution(session.id, current);
    const submitted = await store.updateExecution(
      current.executionId,
      "SUBMITTED",
      [`0x${"e".repeat(64)}`],
      [],
      "BATCH"
    );
    expect(submitted.submissionMode).toBe("BATCH");
  });
});
