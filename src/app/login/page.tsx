import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar · Kalu",
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">
          kalu<span className="text-primary">.</span>
        </h1>
        <p className="text-muted-foreground">Finanças da casa em um só lugar.</p>
      </header>
      <div className="rounded-2xl border bg-card p-6">
        <LoginForm />
      </div>
    </main>
  );
}
