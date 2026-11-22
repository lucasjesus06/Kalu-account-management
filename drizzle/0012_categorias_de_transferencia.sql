INSERT INTO "categories" ("slug", "name", "kind", "sort_order") VALUES
  ('transferencia-entre-integrantes', 'Transferência entre integrantes', 'transfer', 26),
  ('transferencia-entre-contas-proprias', 'Transferência entre contas próprias', 'transfer', 27)
ON CONFLICT ("slug") DO NOTHING;
