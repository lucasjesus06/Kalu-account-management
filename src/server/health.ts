import "server-only";
import { getDb } from "@/db/client";
import { households } from "@/db/schema";

export type DatabaseHealth =
  | { status: "ok"; households: number }
  | { status: "error" };

export async function checkDatabase(): Promise<DatabaseHealth> {
  try {
    const total = await getDb().$count(households);
    return { status: "ok", households: total };
  } catch (error) {
    console.error("Falha ao verificar o banco de dados", error);
    return { status: "error" };
  }
}
