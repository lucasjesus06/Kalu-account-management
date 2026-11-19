import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { checkDatabase } from "@/server/health";

export const metadata: Metadata = {
  title: "Status · Kalu",
};

async function DatabaseStatus() {
  await connection();
  const health = await checkDatabase();

  if (health.status === "error") {
    return <p className="text-destructive">Banco de dados indisponível</p>;
  }

  return (
    <p>
      Banco de dados conectado · {health.households}{" "}
      {health.households === 1 ? "residência" : "residências"}
    </p>
  );
}

export default function StatusPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
      <section className="rounded-lg border bg-card p-5 text-sm text-card-foreground">
        <Suspense fallback={<p className="text-muted-foreground">Verificando banco de dados…</p>}>
          <DatabaseStatus />
        </Suspense>
      </section>
    </main>
  );
}
