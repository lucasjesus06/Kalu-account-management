import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories as categoriesTable } from "@/db/schema";
import { categories } from "@/domain/categories";
import { createTestDatabase } from "@/test/database";

describe("categorias iniciais", () => {
  it("o banco tem exatamente as categorias do domínio, na mesma ordem", async () => {
    const db = await createTestDatabase();

    const stored = await db
      .select({ slug: categoriesTable.slug, name: categoriesTable.name, kind: categoriesTable.kind })
      .from(categoriesTable)
      .orderBy(asc(categoriesTable.sortOrder));

    expect(stored).toEqual(categories.map(({ slug, name, kind }) => ({ slug, name, kind })));
  });
});
