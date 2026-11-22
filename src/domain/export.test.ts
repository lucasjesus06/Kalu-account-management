import { describe, expect, it } from "vitest";
import type { ConsumptionRecord } from "./consumption";
import { exportColumns, toCsv } from "./export";

function record(overrides: Partial<ConsumptionRecord> = {}): ConsumptionRecord {
  return {
    id: "a1",
    occurredAt: new Date("2026-12-01T02:30:00Z"),
    amountCents: 123456,
    direction: "outflow",
    status: "posted",
    description: "IFD*COMPANHIA TESTE",
    providerCategory: "Food delivery",
    billExternalId: "fatura",
    merchantName: "COMPANHIA TESTE",
    category: { slug: "restaurantes", name: "Restaurantes e delivery", kind: "expense" },
    categorySource: "automatic",
    expenseNature: null,
    expenseMemberId: null,
    expenseMemberName: null,
    expenseNatureSource: null,
    installmentNumber: 2,
    installmentTotal: 3,
    accountId: "cartao",
    accountKind: "credit_card",
    accountName: "ELITE VISA",
    institutionName: "Santander",
    memberName: "Lucas",
    billDueDate: "2026-12-03",
    ...overrides,
  };
}

const members = ["Lucas", "Karina"];

function parse(csv: string, separator = ",") {
  const [header, ...rows] = csv.replace(/^﻿/, "").trim().split("\r\n");
  return { header: header.split(separator), rows };
}

describe("exportação CSV", () => {
  it("começa com BOM e o cabeçalho do dicionário de dados", () => {
    const csv = toCsv([], [], "csv", members);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(parse(csv).header).toEqual([...exportColumns]);
  });

  it("escreve uma linha por transação com data e mês de Brasília, valor e contribuição ao consumo", () => {
    const { rows } = parse(toCsv([record()], [], "csv", members));

    expect(rows).toEqual([
      "a1,2026-11-30,2026-11,2026-12-01T02:30:00.000Z,1234.56,1234.56,consumo,saida,lancada,IFD*COMPANHIA TESTE,COMPANHIA TESTE,Restaurantes e delivery,consumo,automatica,Food delivery,,,,ELITE VISA,cartao_credito,Santander,Lucas,2026-12-03,2,3",
    ]);
  });

  it("estorno contribui negativamente; transferência e pagamento de fatura não contribuem", () => {
    const csv = toCsv(
      [
        record({ id: "e", direction: "inflow", description: "ESTORNO", amountCents: 1000 }),
        record({ id: "p", direction: "inflow", description: "PAGAMENTO DE FATURA", amountCents: 403477 }),
        record({
          id: "t",
          category: { slug: "transferencia-entre-integrantes", name: "Transferência entre integrantes", kind: "transfer" },
          categorySource: "user",
        }),
      ],
      [],
      "csv",
      members,
    );
    const columns = parse(csv).rows.map((row) => row.split(","));

    expect(columns.map((c) => [c[0], c[5], c[6], c[12], c[13]])).toEqual([
      ["e", "-10.00", "estorno", "consumo", "automatica"],
      ["p", "0.00", "pagamento_fatura", "consumo", "automatica"],
      ["t", "0.00", "transferencia", "transferencia", "usuario"],
    ]);
  });

  it("separa para quem e participantes de quem pagou", () => {
    const csv = toCsv(
      [
        record({ id: "casa", expenseNature: "household", expenseNatureSource: "automatic" }),
        record({ id: "juntos", expenseNature: "shared", expenseNatureSource: "rule" }),
        record({
          id: "karina",
          expenseNature: "individual",
          expenseMemberId: "m2",
          expenseMemberName: "Karina",
          expenseNatureSource: "user",
        }),
        record({ id: "pendente" }),
      ],
      [],
      "csv",
      members,
    );
    const header = parse(csv).header;
    const pick = (row: string[]) => ["id", "para_quem", "participantes", "origem_para_quem", "titular"].map((name) => row[header.indexOf(name)]);

    expect(parse(csv).rows.map((row) => pick(row.split(",")))).toEqual([
      ["casa", "domestica", "Lucas|Karina", "automatica", "Lucas"],
      ["juntos", "compartilhada", "Lucas|Karina", "regra", "Lucas"],
      ["karina", "individual", "Karina", "usuario", "Lucas"],
      ["pendente", "", "", "", "Lucas"],
    ]);
  });

  it("no formato do Excel usa ponto e vírgula e vírgula decimal", () => {
    const csv = toCsv([record()], [], "excel", members);
    const { header, rows } = parse(csv, ";");

    expect(header).toEqual([...exportColumns]);
    expect(rows[0].split(";")[4]).toBe("1234,56");
  });

  it("protege textos com separador, aspas, quebra de linha e fórmulas", () => {
    const csv = toCsv(
      [record({ description: 'LOJA "A", B\nC', merchantName: "=HYPERLINK(1)", category: null, categorySource: null })],
      [],
      "csv",
      members,
    );

    expect(csv).toContain('"LOJA ""A"", B\nC"');
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
  });
});
