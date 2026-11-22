import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import { cookies } from "next/headers";
import postgres from "postgres";
import * as schema from "./schema";

type Sql = postgres.Sql;
type Transaction = postgres.TransactionSql;

const serviceScope = new AsyncLocalStorage<true>();
const MEMBERS_LIMIT = 500;
const sessionMembers = new Map<string, string>();

async function sessionKey() {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join(";");
}

export async function bindRequestMember(memberId: string) {
  const key = await sessionKey();
  if (!key) {
    return;
  }
  sessionMembers.delete(key);
  sessionMembers.set(key, memberId);
  if (sessionMembers.size > MEMBERS_LIMIT) {
    sessionMembers.delete(sessionMembers.keys().next().value!);
  }
}

function authenticatedClient(base: Sql) {
  const setup = (tx: Transaction | postgres.ReservedSql, memberId: string) =>
    tx.unsafe("select set_config('role', 'authenticated', true), set_config('app.member_id', $1, true)", [memberId]);
  const identify = async () => {
    const key = await sessionKey();
    const memberId = key ? sessionMembers.get(key) : undefined;
    if (!memberId) {
      throw new Error("Consulta ao banco sem usuário identificado na requisição");
    }
    return memberId;
  };
  const scoped = async (run: (connection: postgres.ReservedSql) => unknown) => {
    const memberId = await identify();
    const connection = await base.reserve();
    try {
      const steps = await Promise.allSettled([
        connection.unsafe("begin"),
        setup(connection, memberId),
        run(connection),
        connection.unsafe("commit"),
      ]);
      const failed = steps.find((step) => step.status === "rejected");
      if (failed) {
        throw failed.reason;
      }
      return (steps[2] as PromiseFulfilledResult<unknown>).value;
    } finally {
      connection.release();
    }
  };

  const unsafe = (query: string, params?: unknown[], options?: postgres.UnsafeQueryOptions) => ({
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      scoped((tx) => tx.unsafe(query, params as never, options)).then(resolve, reject),
    values: () => scoped((tx) => tx.unsafe(query, params as never, options).values()),
  });
  const begin = async (work: (tx: Transaction) => Promise<unknown>) => {
    const memberId = await identify();
    return base.begin(async (tx) => {
      await setup(tx, memberId);
      return work(tx);
    });
  };
  return { options: base.options, unsafe, begin } as unknown as Sql;
}

function createDatabases() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  const client = postgres(url, { prepare: false, idle_timeout: 20 });
  const service = drizzle(client, { schema });
  const member = drizzle(authenticatedClient(client), { schema });
  return { service, member };
}

const globalForDb = globalThis as unknown as { kaluDatabases?: ReturnType<typeof createDatabases> };

function databases() {
  globalForDb.kaluDatabases ??= createDatabases();
  return globalForDb.kaluDatabases;
}

export function getServiceDb() {
  return databases().service;
}

export function asService<T>(work: () => Promise<T>) {
  return serviceScope.run(true, work);
}

export function getDb() {
  return serviceScope.getStore() ? databases().service : databases().member;
}
