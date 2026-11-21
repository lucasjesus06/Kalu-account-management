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
| `npm test` | Roda os testes unitários e de integração (Vitest) |
| `npm run db:generate` | Gera uma nova migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica as migrations pendentes no banco |
| `npm run db:studio` | Abre o Drizzle Studio para consultar o banco |

## Banco de dados

O banco é um PostgreSQL gerenciado pelo Supabase, acessado com o [Drizzle ORM](https://orm.drizzle.team).

1. Crie um projeto no [Supabase](https://supabase.com) e guarde a senha do banco.
2. No painel do projeto, clique em **Connect** e copie as connection strings:
   - **Transaction pooler** (porta 6543) para `DATABASE_URL`
   - **Session pooler** (porta 5432) para `DATABASE_MIGRATION_URL`
3. Preencha as duas variáveis no `.env.local`, substituindo `[YOUR-PASSWORD]` pela senha do banco.
4. Aplique as migrations com `npm run db:migrate`.
5. Com a aplicação rodando, acesse `/status` para confirmar a conexão.

Fluxo para alterar o banco: editar `src/db/schema.ts`, rodar `npm run db:generate -- --name=descricao`, revisar o SQL gerado em `drizzle/` e aplicar com `npm run db:migrate`.

Todas as tabelas têm Row Level Security habilitado. A aplicação acessa o banco pelo servidor, e o RLS sem políticas bloqueia o acesso direto pela API pública do Supabase.

## Autenticação

O login é feito com e-mail e senha pelo Supabase Auth. Não há cadastro público: as contas são criadas no painel do Supabase e vinculadas aos integrantes da residência.

1. Em **Project Settings → API Keys**, copie a chave **publishable** para `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Em **Authentication → Sign In / Providers**, desative **Allow new users to sign up** e deixe o provedor **Email** habilitado.
3. Em **Authentication → Users → Add user → Create new user**, crie uma conta para cada integrante, com **Auto Confirm User** marcado.
4. No **SQL Editor**, crie a residência e vincule os integrantes às contas, ajustando nomes e e-mails:

```sql
with casa as (
  insert into households (name) values ('Nossa casa') returning id
)
insert into household_members (household_id, display_name, user_id)
select casa.id, integrante.nome, u.id
from casa
cross join (values
  ('Lucas', 'email-do-lucas@exemplo.com'),
  ('Karina', 'email-da-karina@exemplo.com')
) as integrante(nome, email)
join auth.users u on u.email = integrante.email;
```

Rotas protegidas redirecionam para `/login` quem não estiver autenticado. As páginas `/login` e `/status` são públicas.

## Conexões com a Pluggy

Cada integrante cadastra as próprias credenciais da Pluggy e os próprios bancos na tela **Conexões**.

1. Gere a chave de criptografia e coloque o resultado em `ENCRYPTION_KEY` (no `.env.local` e na Vercel):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

2. No [Meu Pluggy](https://meu.pluggy.ai), conecte os bancos. No [Dashboard da Pluggy](https://dashboard.pluggy.ai), com o mesmo e-mail, conecte o **MeuPluggy** à aplicação.
3. Na tela **Conexões** do Kalu, informe o **Client ID** e o **Client Secret** da aplicação. Eles são validados na Pluggy antes de serem salvos, e o secret fica criptografado (AES-256-GCM) no banco.
4. Adicione o **Item ID** de cada banco, copiado de **Connected Items** no Dashboard.

A `ENCRYPTION_KEY` não pode ser trocada sem cadastrar as credenciais de novo: os secrets salvos só podem ser lidos com a chave que os criptografou.

## Testes

```bash
npm test
```

Os testes de integração rodam contra um PostgreSQL em memória ([PGlite](https://pglite.dev)) com as migrations do projeto aplicadas, e a API da Pluggy é simulada.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do Supabase, usada no navegador |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase, somente no servidor |
| `DATABASE_URL` | Conexão da aplicação com o PostgreSQL, pelo pooler do Supabase em modo transação (porta 6543) |
| `DATABASE_MIGRATION_URL` | Conexão usada pelas migrations, pelo pooler do Supabase em modo sessão (porta 5432) |
| `ENCRYPTION_KEY` | Chave de criptografia das credenciais da Pluggy |
| `CRON_SECRET` | Protege os endpoints das tarefas agendadas |

As credenciais da Pluggy não ficam em variáveis de ambiente: cada integrante cadastra as suas, que são guardadas criptografadas no banco.

## Estrutura

```
drizzle/         migrations SQL geradas pelo Drizzle
src/
  app/           rotas, telas e endpoints (interface)
  components/    componentes visuais reutilizáveis
    ui/          componentes do shadcn/ui
  proxy.ts       renovação da sessão e proteção das rotas
  domain/        regras de negócio puras, sem dependência de framework
  server/        serviços de aplicação, executados apenas no servidor
  db/            schema, migrations e acesso ao banco
  integrations/  clientes de fornecedores externos (ex.: Pluggy)
  lib/           utilitários genéricos
  test/          utilitários de teste
```

As pastas são criadas conforme as estórias que as utilizam. A regra é que `domain` não dependa de nenhuma outra camada e que nenhum tipo de fornecedor externo saia de `integrations`.

## Fluxo de trabalho

- Cada estória vira uma branch `feat/FIN-XX-descricao` e um pull request.
- Mensagens de commit em português, em uma linha, com o prefixo da estória: `FIN-XX: descrição`.
- A especificação do produto fica no documento de consolidação (produto, regras de negócio e arquitetura).
