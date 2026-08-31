import { randomUUID } from "node:crypto";
import type {
	AppChain,
	ExecutionPlan,
	ExecutionProviderId,
	FeedRankingProviderId,
	OnboardingPreferences,
} from "../domain/schemas.js";
import type { ProviderSnapshotCache } from "./adapters/types.js";

export type SessionStatus =
  | "OPEN"
  | "SWIPING"
  | "REVIEW"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "SETTLED"
  | "PARTIAL"
  | "FAILED"
  | "CLOSED";

export interface WeeklySession {
  id: string;
  ownerId: string;
  wallet: string;
  epochId: string;
  chain: AppChain;
  executionProvider: ExecutionProviderId;
  feedRankingProvider: FeedRankingProviderId;
  status: SessionStatus;
  executionId?: string;
  createdAt: string;
}

export interface ExecutionRecord {
  plan: ExecutionPlan;
  status: "PREPARED" | "SUBMITTED" | "SETTLED" | "PARTIAL" | "FAILED";
  submissionMode: "SEQUENTIAL" | "BATCH";
  transactionHashes: string[];
  settledOutputs: SettledOutput[];
  settledAt?: string;
}

export interface SettledOutput {
  assetId: string;
  amountOutBaseUnits: string;
  transactionHash: string;
  blockNumber?: string;
  status: "success" | "failed";
}

export interface StateStore extends ProviderSnapshotCache {
  getPreferences(ownerId: string): Promise<OnboardingPreferences | undefined>;
  setPreferences(
    ownerId: string,
    preferences: OnboardingPreferences,
    wallet?: string
  ): Promise<OnboardingPreferences>;
  invalidatePreparedExecutions(ownerId: string): Promise<void>;
  openSession(
    wallet: string,
    epochId: string,
    executionProvider?: ExecutionProviderId,
    chain?: AppChain,
    ownerId?: string,
    feedRankingProvider?: FeedRankingProviderId
  ): Promise<WeeklySession>;
  getSession(id: string): Promise<WeeklySession | undefined>;
  reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord>;
  refreshPreparedExecution(
    id: string,
    expectedAuthorizedPlanHash: string,
    plan: ExecutionPlan
  ): Promise<ExecutionRecord>;
  getExecution(id: string): Promise<ExecutionRecord | undefined>;
  updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes?: string[],
    settledOutputs?: SettledOutput[],
    submissionMode?: ExecutionRecord["submissionMode"]
  ): Promise<ExecutionRecord>;
}

export class MemoryStateStore implements StateStore {
  private readonly sessions = new Map<string, WeeklySession>();
  private readonly sessionByEpoch = new Map<string, string>();
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly preferences = new Map<string, OnboardingPreferences>();
  private readonly providerSnapshots = new Map<
    string,
    { value: unknown; expiresAt: string }
  >();

  async getProviderSnapshot(key: string) {
    const snapshot = this.providerSnapshots.get(key);
    if (!snapshot || Date.parse(snapshot.expiresAt) <= Date.now()) return undefined;
    return snapshot;
  }

  async setProviderSnapshot(
    key: string,
    _provider: string,
    value: unknown,
    expiresAt: string
  ) {
    this.providerSnapshots.set(key, { value, expiresAt });
  }

  async getPreferences(ownerId: string) {
    return this.preferences.get(ownerId.toLowerCase());
  }

  async setPreferences(ownerId: string, preferences: OnboardingPreferences) {
    this.preferences.set(ownerId.toLowerCase(), preferences);
    return preferences;
  }

  async invalidatePreparedExecutions(ownerId: string) {
    const normalized = ownerId.toLowerCase();
    for (const [sessionId, session] of this.sessions) {
      if (
        session.ownerId.toLowerCase() !== normalized &&
        session.wallet !== normalized
      ) continue;
      if (!session.executionId) continue;
      const execution = this.executions.get(session.executionId);
      if (execution?.status !== "PREPARED") continue;
      this.executions.delete(session.executionId);
      this.sessions.set(sessionId, {
        ...session,
        status: "OPEN",
        executionId: undefined
      });
    }
  }

  async openSession(
    wallet: string,
    epochId: string,
    executionProvider: ExecutionProviderId = "ZERO_EX",
    chain: AppChain = "SOLANA",
    ownerId = wallet,
    feedRankingProvider: FeedRankingProviderId = "ZERO_G"
  ): Promise<WeeklySession> {
    const normalizedWallet = normalizeWallet(wallet, chain);
    const key = `${normalizedWallet}:${epochId}:${chain}:${executionProvider}:${feedRankingProvider}`;
    const existingId = this.sessionByEpoch.get(key);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (!existing) throw new Error("SESSION_INDEX_CORRUPT");
      return existing;
    }

    const session: WeeklySession = {
      id: randomUUID(),
      ownerId,
      wallet: normalizedWallet,
      epochId,
      chain,
      executionProvider,
      feedRankingProvider,
      status: "OPEN",
      createdAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this.sessionByEpoch.set(key, session.id);
    return session;
  }

  async getSession(id: string): Promise<WeeklySession | undefined> {
    return this.sessions.get(id);
  }

  async reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.executionId) {
      const existing = this.executions.get(session.executionId);
      if (existing?.plan.authorizedPlanHash === plan.authorizedPlanHash) return existing;
      throw new Error("EPOCH_ALREADY_EXECUTED");
    }
    const record: ExecutionRecord = {
      plan,
      status: "PREPARED",
      submissionMode: "SEQUENTIAL",
      transactionHashes: [],
      settledOutputs: []
    };
    this.executions.set(plan.executionId, record);
    this.sessions.set(sessionId, {
      ...session,
      status: "AWAITING_SIGNATURE",
      executionId: plan.executionId
    });
    return record;
  }

  async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    return this.executions.get(id);
  }

  async refreshPreparedExecution(
    id: string,
    expectedAuthorizedPlanHash: string,
    plan: ExecutionPlan
  ): Promise<ExecutionRecord> {
    const existing = this.executions.get(id);
    if (!existing) throw new Error("EXECUTION_NOT_FOUND");
    if (
      existing.status !== "PREPARED" ||
      existing.plan.authorizedPlanHash !== expectedAuthorizedPlanHash
    ) {
      throw new Error("EPOCH_ALREADY_EXECUTED");
    }
    const refreshed = { ...existing, plan: { ...plan, executionId: id } };
    this.executions.set(id, refreshed);
    return refreshed;
  }

  async updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes: string[] = [],
    settledOutputs: SettledOutput[] = [],
    submissionMode: ExecutionRecord["submissionMode"] = "SEQUENTIAL"
  ): Promise<ExecutionRecord> {
    const existing = this.executions.get(id);
    if (!existing) throw new Error("EXECUTION_NOT_FOUND");
    const updated = {
      ...existing,
      status,
      submissionMode,
      transactionHashes,
      settledOutputs,
      settledAt: ["SETTLED", "PARTIAL", "FAILED"].includes(status)
        ? new Date().toISOString()
        : undefined
    };
    this.executions.set(id, updated);
    return updated;
  }
}

function normalizeWallet(wallet: string, _chain: AppChain) {
  return wallet;
}
