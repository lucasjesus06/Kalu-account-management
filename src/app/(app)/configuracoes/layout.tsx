import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings-nav";

export default function SettingsLayout({ children }: LayoutProps<"/configuracoes">) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Configurações" />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[14rem_1fr] lg:items-start">
        <SettingsNav />
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
      </div>
    </div>
  );
}
