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

5. Clique em **Sincronizar agora** em cada banco. As contas, faturas e transações aparecem na tela **Contas**.

A `ENCRYPTION_KEY` não pode ser trocada sem cadastrar as credenciais de novo: os secrets salvos só podem ser lidos com a chave que os criptografou.

## Sincronização

A sincronização busca contas, faturas e transações na Pluggy e grava no banco:

- Pode rodar quantas vezes for preciso: cada registro é identificado pelo identificador da fonte, então nada é duplicado e alterações da fonte (como uma transação pendente que foi lançada) atualizam o registro existente.
- Antes de gravar, o serviço compara o que veio da fonte com o que já está salvo e grava somente os registros novos ou alterados. Cada execução registra quantas transações foram novas, alteradas e removidas, e esse resumo aparece em Conexões.
- Transações pendentes que a fonte deixou de enviar são removidas; transações já lançadas nunca são apagadas.
- Cada compra de cartão fica vinculada à sua fatura pelo identificador da fatura na fonte, nunca por data.
- Valores são guardados em centavos inteiros.
- Cada execução fica registrada em `sync_runs`, com totais ou mensagem de erro. Se a Pluggy recusar as credenciais ou não encontrar o banco, a conexão fica com status de erro até a próxima sincronização bem-sucedida.
- Só uma sincronização por conexão roda de cada vez. Uma execução que ficou presa por mais de 15 minutos é marcada como interrompida e libera a próxima.

### Sincronização automática

A Vercel chama `GET /api/cron/sync` uma vez por dia, às 09:00 UTC (06:00 em Brasília), conforme o `vercel.json`. A rota sincroniza todas as conexões que não foram revogadas, uma depois da outra, e devolve um resumo em JSON. Ela só responde a quem enviar o cabeçalho `Authorization: Bearer <CRON_SECRET>`, que a Vercel envia sozinha quando a variável `CRON_SECRET` está configurada no projeto.

No plano Hobby a Vercel executa o agendamento uma vez por dia, em algum momento dentro da hora marcada. Para rodar na mão:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync
```

### Validade da autorização

A autorização dada no Meu Pluggy vale um ano. O Kalu guarda a data de vencimento de cada conexão (a informada pela Pluggy ou, na falta dela, um ano depois do cadastro) e avisa no Início e em Conexões quando faltam 30 dias ou menos, em vermelho a partir de 7 dias.

Antes de buscar os dados, a sincronização consulta o item na Pluggy. Se a autorização venceu ou foi revogada, a conexão passa para **Expirada** e nenhum dado é alterado. Se a Pluggy devolver uma conexão sem nenhuma conta quando antes havia contas, a sincronização também falha sem apagar nada. Depois de renovar no Meu Pluggy, basta clicar em **Sincronizar agora** ou esperar a próxima execução diária.

## Regras de fatura

O valor oficial de cada fatura fechada vem da fonte. O Kalu explica esse valor com as transações importadas:

- Cada transação de cartão é classificada como **compra** (toda saída), **pagamento de fatura** (entrada com a categoria de pagamento da fonte, com descrição de pagamento ou com o valor de uma fatura, com tolerância de 10 centavos) ou **crédito** (as demais entradas, como estornos e cashback).
- A fatura fechada é montada pelo identificador da fatura na fonte, nunca por datas. O total identificado é a soma das compras menos os créditos. O pagamento da fatura anterior, que vem dentro da fatura, não é abatido.
- A diferença entre o valor oficial e o total identificado é exibida como **não identificado pela fonte** (encargos, compras anteriores ao histórico) e nunca é distribuída entre categorias.
- A fatura mais antiga é marcada como incompleta, porque o histórico disponível pode não cobrir o ciclo inteiro.
- A fatura aberta é formada pelas transações sem identificador de fatura. O pagamento da fatura anterior aparece nela e fica fora do total. Compras pendentes entram no total e são indicadas à parte.
- O limite utilizado do cartão inclui faturas fechadas não pagas, a fatura aberta e parcelas futuras, e por isso não é apresentado como valor de fatura.

### Tela da fatura

Em **Contas**, cada cartão tem o atalho **Ver fatura por categoria**, que abre `/contas/fatura?cartao=<id>`. A tela mostra:

- Os ciclos do cartão: a fatura aberta e as fechadas, da mais recente para a mais antiga (`&ciclo=<id da fatura na fonte>`).
- Na fatura fechada: o total oficial, o valor pago e a situação (paga, parcialmente paga ou em aberto) e o valor não identificado pela fonte. O pagamento de uma fatura é procurado no ciclo seguinte, onde a fonte o lança.
- Na fatura aberta: o total parcial, as compras pendentes e os créditos.
- A distribuição por categoria. Cada categoria abre a lista das suas transações, e o valor não identificado aparece como uma linha própria, nunca distribuído entre as categorias.
- Os maiores estabelecimentos, os créditos e estornos e as parcelas futuras, com o valor restante calculado a partir da parcela do ciclo.
- A referência de data: a composição é feita pela competência da fatura, ou seja, pelo ciclo em que o banco cobrou cada compra.

## Categorização

As categorias de gastos ficam na tabela `categories`, criada com a lista de `src/domain/categories.ts`. Cada transação guarda:

- `merchant_name`: o estabelecimento, extraído da descrição sem intermediadores de pagamento (`DL*`, `MP *`, `HNA*`, `ZP*`, `PAYPAL *`, `IFD*`, `KEETABR*`), marcadores de status (`PENDING`), parcelas e diferenças de maiúsculas, acentos e espaços. A descrição original é preservada.
- `category_id`: a categoria.
- `category_source`: a origem da classificação, `automatic`, `rule` ou `user`. Vazio significa que a transação ainda não foi avaliada.

A categorização automática é determinística, sem inteligência artificial:

1. Estabelecimentos conhecidos (ex.: Uber e 99, iFood e Keeta, farmácias, streaming, supermercados, postos, concessionárias de água e energia), definidos em `src/domain/categorization.ts`.
2. Na falta deles, a categoria informada pela Pluggy, traduzida para as categorias do Kalu.
3. Sem nenhuma das duas, a transação fica sem categoria. Pagamentos de fatura, transferências e receitas ficam sem categoria de propósito.

### Transferências

As categorias têm um tipo: **consumo** (`expense`) ou **transferência** (`transfer`). Há duas classificações de transferência:

- **Transferência entre integrantes**: por exemplo, um PIX feito com o cartão de crédito para o outro integrante, ou um PIX entre as contas de vocês.
- **Transferência entre contas próprias**: reconhecida automaticamente quando a Pluggy indica transferência para o mesmo titular ou quando a descrição diz "mesma titularidade" ou "transferência entre contas".

Transferências não entram no consumo: na tela da fatura aparecem numa seção própria e ficam fora dos maiores estabelecimentos; no extrato, ficam fora dos gastos. Para que um PIX no crédito recorrente para o outro integrante seja sempre tratado como transferência, use a correção com a opção que cria a regra do estabelecimento.

### Extrato da conta

Em **Contas**, cada conta corrente ou poupança tem o atalho **Ver extrato**, que abre `/contas/extrato?conta=<id>&mes=AAAA-MM`. O extrato mostra as movimentações do mês (pelo horário de Brasília) e um resumo com entradas, gastos, transferências enviadas e recebidas e pagamentos de fatura. Pagamentos de fatura do cartão não entram nos gastos, porque as compras já são contadas na fatura. Cada movimentação tem o botão **Alterar**, com a mesma correção da tela da fatura.

### Correção de categoria

Na tela da fatura, cada transação tem o botão **Alterar**, que abre a correção com três opções:

- **Somente nesta transação**: a escolha fica marcada como do usuário (`user`) e nenhuma regra é criada. Esse tipo de ajuste nunca é substituído por regras.
- **Nesta e nas próximas deste estabelecimento**: cria ou atualiza uma regra da residência para o estabelecimento normalizado (tabela `category_rules`). As transações anteriores não mudam.
- **Em todas deste estabelecimento, inclusive as anteriores**: cria a regra e a reaplica explicitamente ao histórico da residência, preservando os ajustes feitos só numa transação.

Na sincronização, a regra da residência vem antes das regras automáticas. As transações mostram quando a categoria veio de uma regra da residência ou de um ajuste.

A sincronização categoriza só as transações ainda não avaliadas, então mudar uma regra não reescreve o histórico. Uma transação categorizada automaticamente volta a ser avaliada apenas se a descrição ou a categoria da fonte mudar. Classificações feitas pelo usuário nunca são alteradas pela sincronização. A tela Contas mostra a porcentagem das compras de cada cartão que têm categoria.

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
| `CRON_SECRET` | Protege a rota da sincronização diária. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` e configure na Vercel |
| `PLUGGY_API_URL` | Opcional. Endereço da API da Pluggy; vazio usa `https://api.pluggy.ai`. Serve para apontar para um servidor simulado em testes |

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
