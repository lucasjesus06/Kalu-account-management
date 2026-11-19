import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  return drizzle(postgres(url, { prepare: false }), { schema });
}

let instance: ReturnType<typeof createDb> | undefined;

export function getDb() {
  instance ??= createDb();
  return instance;
}
