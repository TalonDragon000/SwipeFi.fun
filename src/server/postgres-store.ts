import { Pool, type PoolClient } from "pg";
import {
	executionPlanSchema,
	onboardingPreferencesSchema,
	type AppChain,
	type ExecutionPlan,
	type ExecutionProviderId,
	type FeedRankingProviderId,
	type OnboardingPreferences,
} from "../domain/schemas.js";
import type {
  ExecutionRecord,
  SettledOutput,
  StateStore,
  WeeklySession
} from "./store.js";

interface SessionRow {
  id: string;
  owner_id: string | null;
  wallet: string;
  epoch_id: string;
  chain: AppChain | null;
  execution_provider: ExecutionProviderId;
  feed_ranking_provider: FeedRankingProviderId | null;
  status: WeeklySession["status"];
  execution_id: string | null;
  created_at: Date;
}

interface ExecutionRow {
  plan: ExecutionPlan;
  status: ExecutionRecord["status"];
  submission_mode: ExecutionRecord["submissionMode"];
  transaction_hashes: string[];
  settled_outputs: SettledOutput[];
  settled_at: Date | null;
}

export function normalizeStoredWallet(wallet: string, _chain: AppChain) {
  return wallet;
}

export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: true }
    });
  }

  async getProviderSnapshot(key: string) {
    const result = await this.pool.query<{
      snapshot: unknown;
      expires_at: Date;
    }>(
      `SELECT snapshot, expires_at FROM asset_metadata_cache
       WHERE cache_key = $1 AND expires_at > now()`,
      [key]
    );
    const row = result.rows[0];
    return row
      ? { value: row.snapshot, expiresAt: row.expires_at.toISOString() }
      : undefined;
  }

  async setProviderSnapshot(
    key: string,
    provider: string,
    value: unknown,
    expiresAt: string
  ) {
    await this.pool.query(
      `INSERT INTO asset_metadata_cache (
         cache_key, provider, snapshot, expires_at
       ) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (cache_key) DO UPDATE SET
         provider = EXCLUDED.provider,
         snapshot = EXCLUDED.snapshot,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [key, provider, JSON.stringify(value), expiresAt]
    );
  }

  async getPreferences(ownerId: string) {
    const result = await this.pool.query<{ preferences: unknown }>(
      `SELECT preferences FROM user_preferences
       WHERE owner_id = $1 OR (owner_id IS NULL AND wallet = $1)
       ORDER BY owner_id NULLS LAST LIMIT 1`,
      [ownerId.toLowerCase()]
    );
    return result.rows[0]
      ? onboardingPreferencesSchema.parse(result.rows[0].preferences)
      : undefined;
  }

  async setPreferences(
    ownerId: string,
    preferences: OnboardingPreferences,
    wallet = ownerId
  ) {
    const parsed = onboardingPreferencesSchema.parse(preferences);
    await this.pool.query(
      `INSERT INTO user_preferences (wallet, owner_id, execution_provider, preferences)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL DO UPDATE
       SET wallet = EXCLUDED.wallet,
           execution_provider = EXCLUDED.execution_provider,
           preferences = EXCLUDED.preferences,
           updated_at = now()`,
      [
        normalizeStoredWallet(wallet, parsed.activeChain),
        ownerId.toLowerCase(),
        parsed.executionProvider,
        JSON.stringify(parsed)
      ]
    );
    return parsed;
  }

  async invalidatePreparedExecutions(ownerId: string) {
    const normalized = ownerId.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prepared = await client.query<{ id: string }>(
        `SELECT e.id
         FROM executions e
         JOIN weekly_sessions s ON s.id = e.session_id
         WHERE (s.owner_id = $1 OR (s.owner_id IS NULL AND s.wallet = $1))
           AND e.status = 'PREPARED'
         FOR UPDATE`,
        [normalized]
      );
      const ids = prepared.rows.map((row) => row.id);
      if (ids.length) {
        await client.query(
          `UPDATE weekly_sessions
           SET execution_id = NULL, status = 'OPEN', updated_at = now()
           WHERE execution_id = ANY($1::uuid[])`,
          [ids]
        );
        await client.query(
          "DELETE FROM executions WHERE id = ANY($1::uuid[]) AND status = 'PREPARED'",
          [ids]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async openSession(
    wallet: string,
    epochId: string,
    executionProvider: ExecutionProviderId,
    chain: AppChain = "SOLANA",
    ownerId = wallet,
    feedRankingProvider: FeedRankingProviderId = "ZERO_G"
  ): Promise<WeeklySession> {
    const normalizedWallet = normalizeStoredWallet(wallet, chain);
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO weekly_sessions (
         wallet, owner_id, epoch_id, chain, execution_provider, feed_ranking_provider, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
       ON CONFLICT (wallet, epoch_id, chain, execution_provider, feed_ranking_provider)
       DO UPDATE SET owner_id = EXCLUDED.owner_id
       RETURNING id, owner_id, wallet, epoch_id, chain, execution_provider, feed_ranking_provider, status, execution_id, created_at`,
      [normalizedWallet, ownerId.toLowerCase(), epochId, chain, executionProvider, feedRankingProvider]
    );
    const row = result.rows[0];
    if (!row) throw new Error("SESSION_UPSERT_FAILED");
    return mapSession(row);
  }

  async getSession(id: string): Promise<WeeklySession | undefined> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, owner_id, wallet, epoch_id, chain, execution_provider, feed_ranking_provider, status, execution_id, created_at
       FROM weekly_sessions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query<SessionRow>(
        `SELECT id, owner_id, wallet, epoch_id, chain, execution_provider, feed_ranking_provider, status, execution_id, created_at
         FROM weekly_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );
      const session = sessionResult.rows[0];
      if (!session) throw new Error("SESSION_NOT_FOUND");
      if (session.execution_id) {
        const existing = await this.getExecutionWithClient(client, session.execution_id);
        if (existing?.plan.authorizedPlanHash === plan.authorizedPlanHash) {
          await client.query("COMMIT");
          return existing;
        }
        throw new Error("EPOCH_ALREADY_EXECUTED");
      }
      await client.query(
        `INSERT INTO executions (
           id, session_id, authorized_plan_hash, execution_provider, plan, status
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, 'PREPARED')`,
        [
          plan.executionId,
          sessionId,
          plan.authorizedPlanHash,
          plan.provider,
          JSON.stringify(plan)
        ]
      );
      await client.query(
        `UPDATE weekly_sessions
         SET execution_id = $1, status = 'AWAITING_SIGNATURE'
         WHERE id = $2`,
        [plan.executionId, sessionId]
      );
      await client.query("COMMIT");
      return {
        plan,
        status: "PREPARED",
        submissionMode: "SEQUENTIAL",
        transactionHashes: [],
        settledOutputs: []
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      return await this.getExecutionWithClient(client, id);
    } finally {
      client.release();
    }
  }

  async refreshPreparedExecution(
    id: string,
    expectedAuthorizedPlanHash: string,
    plan: ExecutionPlan
  ): Promise<ExecutionRecord> {
    const result = await this.pool.query<ExecutionRow>(
      `UPDATE executions
       SET plan = $2::jsonb,
           authorized_plan_hash = $4,
           updated_at = now()
       WHERE id = $1
         AND status = 'PREPARED'
         AND authorized_plan_hash = $3
       RETURNING plan, status, submission_mode, transaction_hashes, settled_outputs, settled_at`,
      [
        id,
        JSON.stringify({ ...plan, executionId: id }),
        expectedAuthorizedPlanHash,
        plan.authorizedPlanHash
      ]
    );
    if (!result.rows[0]) throw new Error("EPOCH_ALREADY_EXECUTED");
    return mapExecution(result.rows[0]);
  }

  async updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes: string[] = [],
    settledOutputs: SettledOutput[] = [],
    submissionMode: ExecutionRecord["submissionMode"] = "SEQUENTIAL"
  ): Promise<ExecutionRecord> {
    const terminal = ["SETTLED", "PARTIAL", "FAILED"].includes(status);
    const result = await this.pool.query<ExecutionRow>(
      `UPDATE executions
       SET status = $2,
           transaction_hashes = $3,
           settled_outputs = $4::jsonb,
           submission_mode = $5,
           settled_at = CASE WHEN $6 THEN now() ELSE settled_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING plan, status, submission_mode, transaction_hashes, settled_outputs, settled_at`,
      [id, status, transactionHashes, JSON.stringify(settledOutputs), submissionMode, terminal]
    );
    if (!result.rows[0]) throw new Error("EXECUTION_NOT_FOUND");
    return mapExecution(result.rows[0]);
  }

  private async getExecutionWithClient(client: PoolClient, id: string) {
    const result = await client.query<ExecutionRow>(
      `SELECT plan, status, submission_mode, transaction_hashes, settled_outputs, settled_at
       FROM executions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapExecution(result.rows[0]) : undefined;
  }
}

function mapSession(row: SessionRow): WeeklySession {
  return {
    id: row.id,
    ownerId: row.owner_id ?? row.wallet,
    wallet: row.wallet,
    epochId: row.epoch_id,
    chain: row.chain ?? "SOLANA",
    executionProvider: row.execution_provider,
    feedRankingProvider: row.feed_ranking_provider ?? "ZERO_G",
    status: row.status,
    executionId: row.execution_id ?? undefined,
    createdAt: row.created_at.toISOString()
  };
}

function mapExecution(row: ExecutionRow): ExecutionRecord {
  return {
    plan: executionPlanSchema.parse(row.plan),
    status: row.status,
    submissionMode: row.submission_mode,
    transactionHashes: row.transaction_hashes,
    settledOutputs: row.settled_outputs,
    settledAt: row.settled_at?.toISOString()
  };
}
