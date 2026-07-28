import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export interface MigrationStepResult {
  name: string;
  action: "applied" | "already-applied" | "skipped-existing-schema";
}

/**
 * Applies every supabase/migrations/*.sql file against `connectionString`,
 * in filename order (they're timestamp-prefixed). Tracked in its own
 * `_calendula_migrations` table rather than Supabase CLI's internal one,
 * since this runs without the CLI at all — the whole point is a no-terminal
 * "Connect" flow (paste credentials in-app, the app applies the schema).
 *
 * Tolerates a database that was already migrated by other means (e.g. a
 * local `supabase start`, which uses its own tracking table this doesn't
 * know about): if the canary table already exists and nothing is tracked
 * yet, every migration is recorded as already-applied rather than re-run,
 * since re-running `create table` against an existing schema would fail.
 */
export async function runMigrations(connectionString: string): Promise<MigrationStepResult[]> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _calendula_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    const { rows: appliedRows } = await client.query<{ name: string }>(
      "select name from _calendula_migrations",
    );
    const applied = new Set(appliedRows.map((r) => r.name));

    const { rows: canaryRows } = await client.query<{ exists: boolean }>(`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'calendula_scheduling_profile'
      ) as exists;
    `);
    const schemaAlreadyExists = canaryRows[0]?.exists ?? false;

    const results: MigrationStepResult[] = [];

    for (const file of files) {
      if (applied.has(file)) {
        results.push({ name: file, action: "already-applied" });
        continue;
      }

      if (schemaAlreadyExists && applied.size === 0) {
        await client.query("insert into _calendula_migrations (name) values ($1)", [file]);
        results.push({ name: file, action: "skipped-existing-schema" });
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _calendula_migrations (name) values ($1)", [file]);
        await client.query("commit");
        results.push({ name: file, action: "applied" });
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results;
  } finally {
    await client.end();
  }
}
