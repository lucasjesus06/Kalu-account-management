"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Plug, Target, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Início", icon: House },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/conexoes", label: "Conexões", icon: Plug },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
      {navItems.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            isActive(pathname, href) && "bg-secondary text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {navItems.map(({ href, label, icon: Icon }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground",
                isActive(pathname, href) && "text-primary",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
