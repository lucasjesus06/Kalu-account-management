export const categories = [
  { slug: "moradia", name: "Moradia", kind: "expense" },
  { slug: "energia", name: "Energia elétrica", kind: "expense" },
  { slug: "agua", name: "Água", kind: "expense" },
  { slug: "internet-telefone", name: "Internet e telefone", kind: "expense" },
  { slug: "supermercado", name: "Supermercado", kind: "expense" },
  { slug: "restaurantes", name: "Restaurantes e delivery", kind: "expense" },
  { slug: "fast-food", name: "Fast food", kind: "expense" },
  { slug: "transporte", name: "Transporte", kind: "expense" },
  { slug: "transporte-por-aplicativo", name: "Transporte por aplicativo", kind: "expense" },
  { slug: "combustivel", name: "Combustível", kind: "expense" },
  { slug: "saude", name: "Saúde", kind: "expense" },
  { slug: "farmacia", name: "Farmácia", kind: "expense" },
  { slug: "academia", name: "Academia", kind: "expense" },
  { slug: "educacao", name: "Educação", kind: "expense" },
  { slug: "entretenimento", name: "Lazer e entretenimento", kind: "expense" },
  { slug: "vestuario", name: "Vestuário", kind: "expense" },
  { slug: "assinaturas", name: "Assinaturas", kind: "expense" },
  { slug: "compras", name: "Compras", kind: "expense" },
  { slug: "pets", name: "Pets", kind: "expense" },
  { slug: "viagens", name: "Viagens", kind: "expense" },
  { slug: "seguros", name: "Seguros", kind: "expense" },
  { slug: "impostos", name: "Impostos", kind: "expense" },
  { slug: "tarifas-bancarias", name: "Tarifas bancárias", kind: "expense" },
  { slug: "servicos", name: "Serviços", kind: "expense" },
  { slug: "outros", name: "Outros", kind: "expense" },
  { slug: "transferencia-entre-integrantes", name: "Transferência entre integrantes", kind: "transfer" },
  { slug: "transferencia-entre-contas-proprias", name: "Transferência entre contas próprias", kind: "transfer" },
] as const;

export const categoryKinds = ["expense", "transfer"] as const;
export type CategoryKind = (typeof categoryKinds)[number];

export type CategorySlug = (typeof categories)[number]["slug"];
