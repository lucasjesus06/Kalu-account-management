# Kalu

Finanças da casa em um só lugar: contas, cartões e faturas dos integrantes da residência, coletados automaticamente via Open Finance e organizados por categoria.

## Stack

- [Next.js](https://nextjs.org) (App Router) com TypeScript
- Tailwind CSS e [shadcn/ui](https://ui.shadcn.com)
- Supabase (PostgreSQL e autenticação)
- Pluggy (Open Finance)
- Vercel (hospedagem e tarefas agendadas)

## Como rodar

Requisitos: Node.js 20.9 ou superior.

```bash
npm install
cp .env.example .env.local
npm run dev
```

A aplicação sobe em [http://localhost:3000](http://localhost:3000).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run start` | Sobe o build de produção |
| `npm run lint` | Verificação de código com ESLint |

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do Supabase, usada no navegador |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase, somente no servidor |
| `DATABASE_URL` | Conexão com o PostgreSQL pelo pooler do Supabase |
| `ENCRYPTION_KEY` | Chave de criptografia das credenciais da Pluggy |
| `CRON_SECRET` | Protege os endpoints das tarefas agendadas |

As credenciais da Pluggy não ficam em variáveis de ambiente: cada integrante cadastra as suas, que são guardadas criptografadas no banco.

## Estrutura

```
src/
  app/           rotas, telas e endpoints (interface)
  components/    componentes visuais reutilizáveis
    ui/          componentes do shadcn/ui
  domain/        regras de negócio puras, sem dependência de framework
  server/        serviços de aplicação, executados apenas no servidor
  db/            schema, migrations e acesso ao banco
  integrations/  clientes de fornecedores externos (ex.: Pluggy)
  lib/           utilitários genéricos
```

As pastas são criadas conforme as estórias que as utilizam. A regra é que `domain` não dependa de nenhuma outra camada e que nenhum tipo de fornecedor externo saia de `integrations`.

## Fluxo de trabalho

- Cada estória vira uma branch `feat/FIN-XX-descricao` e um pull request.
- Mensagens de commit em português, em uma linha, com o prefixo da estória: `FIN-XX: descrição`.
- A especificação do produto fica no documento de consolidação (produto, regras de negócio e arquitetura).
