import type { Metadata } from "next";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getAccountEmail, getRenderProfile } from "@/server/auth";
import { PasswordForm, RenameForm } from "./account-forms";

export const metadata: Metadata = {
  title: "Conta · Kalu",
};

async function AccountContent() {
  const [profile, email] = await Promise.all([getRenderProfile(), getAccountEmail()]);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex max-w-sm flex-col gap-5">
        <h2 className="font-display text-xl font-bold">Seus dados</h2>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">E-mail</span>
          <span className="text-muted-foreground">{email ?? "Não informado"}</span>
        </div>
        <RenameForm name={profile.displayName} />
      </section>

      <section className="flex flex-col gap-5 border-t pt-10">
        <h2 className="font-display text-xl font-bold">Senha</h2>
        <PasswordForm />
      </section>

      <section className="flex flex-col gap-4 border-t pt-10">
        <h2 className="font-display text-xl font-bold">Sessão</h2>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            <LogOut />
            Sair deste dispositivo
          </Button>
        </form>
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <AccountContent />
    </Suspense>
  );
}
