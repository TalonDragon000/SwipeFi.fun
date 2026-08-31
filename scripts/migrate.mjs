import pg from "pg";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: true }
});

try {
  const sql = await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log(JSON.stringify({ event: "migration_complete", migration: "001_initial" }));
} finally {
  await pool.end();
}
