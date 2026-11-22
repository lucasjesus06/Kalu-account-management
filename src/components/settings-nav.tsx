"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Landmark, ListChecks, Share2, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/configuracoes/conta", label: "Conta", icon: User },
  { href: "/configuracoes/familia", label: "Família", icon: Users },
  { href: "/configuracoes/compartilhamento", label: "Compartilhamento", icon: Share2 },
  { href: "/configuracoes/regras", label: "Regras", icon: ListChecks },
  { href: "/configuracoes/notificacoes", label: "Notificações", icon: Bell },
  { href: "/conexoes", label: "Conexões bancárias", icon: Landmark },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Configurações" className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  active && "bg-secondary text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
