const proximasEtapas = [
  "Login dos integrantes da casa",
  "Conexão com os bancos via Open Finance",
  "Fatura do cartão por categoria",
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Kalu</h1>
        <p className="text-muted-foreground">Finanças da casa em um só lugar.</p>
      </header>

      <section className="rounded-lg border bg-card p-5 text-card-foreground">
        <h2 className="font-medium">Em construção</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          {proximasEtapas.map((etapa) => (
            <li key={etapa} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {etapa}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
