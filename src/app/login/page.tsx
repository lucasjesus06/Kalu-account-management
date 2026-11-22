import type { Metadata } from "next";
import { Suspense } from "react";
import { safeNextPath } from "@/domain/invite";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar · Kalu",
};

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(next)} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">
          kalu<span className="text-primary">.</span>
        </h1>
        <p className="text-muted-foreground">Finanças da casa em um só lugar.</p>
      </header>
      <div className="rounded-2xl border bg-card p-6">
        <Suspense fallback={<LoginForm next="/" />}>
          <LoginFormWithNext searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
