import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import { headers } from "next/headers";
import postgres from "postgres";
import * as schema from "./schema";

type Sql = postgres.Sql;
type Transaction = postgres.TransactionSql;

const serviceScope = new AsyncLocalStorage<true>();
const requestMembers = new WeakMap<object, string>();

export async function bindRequestMember(memberId: string) {
  requestMembers.set(await headers(), memberId);
}

function authenticatedClient(base: Sql) {
  const setup = (tx: Transaction, memberId: string) =>
    tx.unsafe("select set_config('role', 'authenticated', true), set_config('app.member_id', $1, true)", [memberId]);
  const identify = async () => {
    const memberId = requestMembers.get(await headers());
    if (!memberId) {
      throw new Error("Consulta ao banco sem usuário identificado na requisição");
    }
    return memberId;
  };
  const scoped = async (run: (tx: Transaction) => unknown) => {
    const memberId = await identify();
    return base.begin(async (tx) => {
      const [, result] = await Promise.all([setup(tx, memberId), run(tx)]);
      return result;
    });
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
  const client = postgres(url, { prepare: false });
  const service = drizzle(client, { schema });
  const member = drizzle(authenticatedClient(client), { schema });
  return { service, member };
}

let instance: ReturnType<typeof createDatabases> | undefined;

function databases() {
  instance ??= createDatabases();
  return instance;
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
