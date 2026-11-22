import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { BottomNav, TopNav } from "@/components/app-nav";
import { HideValuesToggle } from "@/components/hide-values-toggle";
import { MemberAvatars } from "@/components/member-avatars";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
            kalu<span className="text-primary">.</span>
          </Link>
          <TopNav />
          <div className="ml-auto flex items-center gap-2">
            <Suspense fallback={null}>
              <ScopeSwitcher />
            </Suspense>
            <HideValuesToggle />
            <Suspense fallback={null}>
              <MemberAvatars />
            </Suspense>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Sair" title="Sair">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 sm:px-6 lg:pb-16">{children}</main>

      <BottomNav />
    </div>
  );
}
