import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error("Defina DATABASE_MIGRATION_URL no .env.local.");
  process.exit(1);
}

const apply = process.argv.includes("--aplicar");
const folder = join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
const migrations = journal.entries.map((entry) => {
  const sql = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
  return {
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256").update(sql).digest("hex"),
    statements: sql.split("--> statement-breakpoint"),
  };
});

const db = postgres(url, { max: 1, onnotice: () => {} });

try {
  await db`create schema if not exists drizzle`;
  await db`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  const applied = new Set((await db`select hash from drizzle.__drizzle_migrations`).map((row) => row.hash));
  const missing = migrations.filter((migration) => !applied.has(migration.hash));

  console.log(`${migrations.length} migrações no repositório, ${migrations.length - missing.length} aplicadas.`);
  if (missing.length === 0) {
    console.log("Banco em dia.");
  } else {
    console.log("Faltando:");
    for (const migration of missing) {
      console.log(`  ${migration.tag}`);
    }
  }

  if (missing.length > 0 && !apply) {
    console.log("Rode `npm run db:verificar -- --aplicar` para aplicar as que faltam, em ordem.");
    process.exitCode = 2;
  } else if (missing.length > 0) {
    for (const migration of missing) {
      await db.begin(async (tx) => {
        for (const statement of migration.statements) {
          await tx.unsafe(statement);
        }
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.when})`;
      });
      console.log(`Aplicada: ${migration.tag}`);
    }
    console.log("Banco em dia.");
  }
} catch (error) {
  console.error(`Falhou: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
