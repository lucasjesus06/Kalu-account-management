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
4. Na primeira vez que alguém entra, o Kalu cria o perfil pessoal dessa conta (`household_members`, sem residência). Para criar uma residência e vincular as pessoas, use o **SQL Editor**, ajustando nomes e e-mails. O primeiro papel é o administrador:

```sql
with casa as (
  insert into households (name) values ('Nossa casa') returning id
),
pessoas (nome, email, papel) as (
  values
    ('Lucas', 'email-do-lucas@exemplo.com', 'admin'),
    ('Karina', 'email-da-karina@exemplo.com', 'member')
),
perfis as (
  insert into household_members (household_id, display_name, user_id)
  select casa.id, pessoa.nome, u.id
  from casa
  cross join pessoas pessoa
  join auth.users u on u.email = pessoa.email
  returning id, household_id, display_name
)
insert into household_memberships (household_id, member_id, role)
select perfil.household_id, perfil.id, pessoa.papel
from perfis perfil
join pessoas pessoa on pessoa.nome = perfil.display_name;
```

Se o perfil já existir (a pessoa já entrou), use `update household_members set household_id = ... where user_id = ...` e insira só a participação.

### Perfis e residências

- **Perfil pessoal** (`household_members`): existe para todo usuário autenticado, com ou sem residência. É o dono das conexões, contas, cartões e transações, e das credenciais da Pluggy. Sem residência, a pessoa já conecta bancos e sincroniza em **Conexões**.
- **Residência** (`households`): espaço de consolidação, criado manualmente, que não é dona dos dados financeiros de ninguém.
- **Participação** (`household_memberships`): liga um perfil a uma residência com o papel `admin` ou `member`. Uma pessoa pode participar de mais de uma residência, uma residência tem exatamente um administrador e não pressupõe parentesco ou casamento. Participar não dá, por si só, acesso aos dados financeiros de ninguém.
- A coluna `household_members.household_id` é legada (a residência única de antes). A fonte de verdade da participação é `household_memberships`. Nesta etapa as telas de consumo ainda leem a residência atual; o escopo pessoal e o compartilhamento por conta chegam nas próximas estórias.

Rotas protegidas redirecionam para `/login` quem não estiver autenticado. As páginas `/login` e `/status` são públicas.

## Conexões com a Pluggy

Cada integrante cadastra as próprias credenciais da Pluggy e os próprios bancos na tela **Conexões**.

1. Gere a chave de criptografia e coloque o resultado em `ENCRYPTION_KEY` (no `.env.local` e na Vercel):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

2. No [Meu Pluggy](https://meu.pluggy.ai), conecte os bancos.
3. Na tela **Conexões** do Kalu, informe o **Client ID** e o **Client Secret** da aplicação, do [Dashboard da Pluggy](https://dashboard.pluggy.ai). Eles são validados na Pluggy antes de serem salvos, e o secret fica criptografado (AES-256-GCM) no banco.
4. Clique em **Conectar banco**. O Kalu cria um token de conexão temporário no servidor (o secret nunca vai para o navegador) e abre a janela da Pluggy (Pluggy Connect). Escolha **MeuPluggy** e autorize. A conexão é registrada e a primeira sincronização roda em seguida.
5. As contas, faturas e transações aparecem na tela **Contas**.

Ainda é possível adicionar um banco pelo **Item ID** (em **Adicionar pelo Item ID**), copiado de **Connected Items** no Dashboard.

### Renovação da autorização

A autorização do Meu Pluggy vale um ano e só pode ser renovada por quem entra no Meu Pluggy; a sincronização automática não consegue renová-la. Quando a autorização está perto de vencer, expirou ou a conexão está com erro, a conexão mostra **Renovar autorização**: a janela da Pluggy abre já vinculada ao item (`updateItem`), e depois de autorizar a conexão volta para **Ativa**, com a nova validade, e é sincronizada. Se a Pluggy devolver outro item na renovação, a mesma conexão do Kalu passa a apontar para ele.

Os avisos de vencimento no Início levam para a tela **Conexões**.

`NEXT_PUBLIC_PLUGGY_CONNECT_URL` é opcional e só serve para apontar o widget para um ambiente de testes; sem ela, é usado o endereço oficial da Pluggy.

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

### Avisos de meta no celular (push)

Quando uma meta cruza uma faixa, o Kalu manda uma notificação para os aparelhos ativos da casa, além de mostrar o aviso em `/metas`.

- **Ativar**: em **Metas**, painel **Avisos**, **Ativar avisos neste aparelho**. Cada pessoa ativa em cada aparelho; **Desativar** remove só o aparelho atual. No iPhone (iOS 16.4 ou mais novo) o Kalu precisa estar instalado na tela inicial.
- **Chaves**: gere o par VAPID uma vez com `npx web-push generate-vapid-keys` e configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (por exemplo `mailto:voce@exemplo.com`) na Vercel. Sem as três, o botão não aparece e nada é enviado. Troque o par e todos precisam ativar de novo.
- **Quando envia**: após cada sincronização, ao reclassificar uma transação e ao salvar uma meta. Se várias faixas da mesma meta forem cruzadas de uma vez, vai uma única notificação, a da maior faixa.
- **Sem repetição**: cada aviso guarda `notified_at` e é reservado antes do envio, então duas execuções ao mesmo tempo não mandam duas vezes. Avisos com mais de 48 horas são marcados como enviados sem notificar, para a configuração tardia das chaves não despejar histórico.
- **Aparelhos expirados**: quando o serviço de push responde 404 ou 410, a inscrição é apagada sozinha.
- A falha no envio nunca derruba a sincronização nem o salvamento: o aviso continua na tela.

### Notificações da Pluggy (webhooks)

Com as notificações ativas, o Kalu sincroniza assim que a Pluggy avisa que algo mudou, sem esperar o agendamento diário (que continua como garantia).

- **Rota**: `POST /api/webhooks/pluggy`, pública no proxy. Ela responde em seguida (a Pluggy espera resposta 2xx em até 10 segundos) e processa depois da resposta, com `after()` do Next.js.
- **Autenticidade**: toda notificação precisa trazer o cabeçalho `X-Kalu-Webhook-Secret` com o valor de `PLUGGY_WEBHOOK_SECRET`, cadastrado na Pluggy junto com o webhook. Se `PLUGGY_WEBHOOK_SIGNING_SECRET` estiver configurado (segredo `whsec_...` gerado no Dashboard), a assinatura `X-Pluggy-Signature` (HMAC-SHA256 de `t.corpo`, com no máximo 5 minutos de diferença) também é exigida. Sem isso, a resposta é `401`, que a Pluggy não reenvia. O `clientId` da notificação precisa ser o das credenciais do integrante dono do item.
- **Eventos**: `item/created`, `item/updated`, `item/error` e `transactions/*` disparam a sincronização da conexão (que consulta a Pluggy com a chave da API e detecta autorização expirada); `item/deleted` marca a conexão como revogada; os demais são ignorados.
- **Sem repetição**: cada notificação fica em `webhook_events` pelo `eventId`, com o resultado (`synced`, `revoked`, `ignored` ou `failed`) e o detalhe. Uma entrega repetida não é processada de novo.
- **Ativação**: em **Conexões**, **Ativar notificações** cadastra o webhook na Pluggy (evento `all`, com o segredo nos cabeçalhos) ou atualiza e reativa o que já aponta para o Kalu. Exige o Kalu publicado em HTTPS (`APP_URL` ou o domínio de produção da Vercel). A tela mostra desde quando estão ativas e a última notificação recebida.

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

## Para quem é o gasto

Além da categoria (em que o dinheiro foi gasto), cada gasto pode dizer para quem ele foi. É independente de quem pagou: uma compra de mercado no cartão do Lucas continua sendo da Casa.

- **Casa** (`household`): despesas da residência, como aluguel, contas e mercado.
- **Compartilhado** (`shared`): o que os integrantes aproveitam juntos, como um restaurante ou uma assinatura dos dois.
- **Um integrante** (`individual`): o gasto de uma pessoa só, guardado com o integrante.
- **Sem definição**: ainda não informado.

Marcar um gasto como Compartilhado ou Casa não divide o valor entre os integrantes.

Cada transação guarda `expense_nature`, `expense_member_id` (só para `individual`) e `expense_nature_source` (`automatic`, `rule` ou `user`; vazio significa ainda não avaliada). A avaliação automática é determinística e não inventa a informação:

1. Regra da residência para o estabelecimento (tabela `expense_nature_rules`).
2. Na falta dela, as categorias Moradia, Energia elétrica, Água e Supermercado viram **Casa** (`src/domain/expense-nature.ts`).
3. Nos demais casos, o gasto fica **Sem definição**. Quem pagou nunca é usado para presumir quem consumiu. Transferências não têm para quem.

A correção usa o mesmo botão **Alterar** da categoria, com as mesmas três opções de alcance. Assim como na categoria, a sincronização avalia só as transações novas, reavalia quando a descrição muda na fonte e nunca altera a escolha do usuário. Quando a categoria muda, um "para quem" automático é recalculado; um vindo de regra ou do usuário é mantido.

## Metas e alertas

Uma meta é um limite mensal de consumo, por categoria e por para quem (ou para todo o consumo de um integrante). Fica em `/metas`, com atalho no painel "Metas do mês" da tela inicial.

- O consumo comparado com o limite segue a mesma regra dos indicadores: compras menos estornos, pela data de Brasília, sem receitas, transferências e pagamentos de fatura.
- Os avisos são configuráveis (padrão 70%, 90% e 100%, até 5 faixas de no máximo 300%). Cada faixa avisa uma vez por meta e por mês (`budget_alerts`, índice único em meta, mês e faixa), então reavaliar não repete o aviso.
- A avaliação roda ao final de cada sincronização e quando uma transação é reclassificada.
- Metas são versionadas por mês: editar num mês seguinte encerra a meta antiga no mês anterior e cria uma nova, preservando o histórico dos meses passados. Editar ou remover no mês de criação altera ou apaga a própria meta.
- Só pode existir uma meta ativa por categoria e para quem.

## Histórico de alterações

Toda mudança feita por uma pessoa fica registrada em `change_log` e aparece em `/historico` (atalho nas telas Contas e Metas), com filtro por Classificação e Metas.

- Registra quem alterou, quando, o item (estabelecimento ou meta), o valor anterior, o novo valor e o alcance da correção.
- Classificação: categoria e "para quem". Nas correções com regra, o valor anterior é o da transação clicada e a contagem informa quantas transações foram afetadas, incluindo o histórico do estabelecimento.
- Metas: criação, alteração (com o limite e os avisos anteriores) e remoção ou encerramento.
- O registro é gravado na mesma transação do banco da mudança: se uma falha, a outra também. Correções recusadas não geram registro.
- Alterações automáticas da sincronização e das regras não entram aqui, só o que uma pessoa fez. Os valores ficam como texto, então o histórico continua legível se uma categoria ou meta mudar depois.

## Indicadores e análise

### Definições

Todas as telas usam as mesmas definições, em `src/domain/consumption.ts`:

- **Consumo**: compras no cartão e saídas da conta, menos estornos e créditos do cartão.
- **Fora do consumo**: entradas, transferências entre integrantes ou entre contas próprias e pagamentos de fatura.
- **Pagamentos de fatura**: o mesmo pagamento aparece saindo da conta e chegando no cartão. Os dois lados são contados separados ("faturas pagas, recebido nos cartões" e "pagamentos feitos pelas contas") e nunca somados.
- **Data de referência**: dia da compra ou do lançamento, no horário de Brasília. A tela da fatura usa o ciclo de cobrança, por isso os totais por mês e por fatura podem diferir.
- **Períodos comparáveis**: o mês em andamento é comparado com o mesmo intervalo de dias do mês comparado (ex.: 01/11 a 22/11 contra 01/10 a 22/10). Meses encerrados são comparados inteiros.
- **Ticket médio**: valor das compras dividido pela quantidade, sem descontar estornos.
- **Variação**: diferença sobre o período comparado, sem cálculo quando o período comparado é zero.
- **Titular**: integrante dono da conta ou do cartão em que a compra foi feita, que não é necessariamente quem consumiu.
- **Para quem**: Casa, Compartilhado, um integrante ou Sem definição. Estornos abatem do mesmo grupo da compra.

### Telas

- **Início**: visão do dia a dia, com o consumo do mês comparado ao mesmo período do mês anterior, entradas, saldo em contas, faturas abertas com o limite usado, as maiores categorias e para quem foi o consumo, com a variação. Mostra o período, a última sincronização e quanto ainda está sem definição de para quem, com um atalho para definir.
- **Análise detalhada** (`/analise?mes=AAAA-MM&comparar=AAAA-MM`): comparação entre dois períodos com os indicadores, consumo por categoria e por para quem (cada linha abre as movimentações, que podem ser ajustadas ali), por titular, por origem e por estabelecimento, a qualidade dos dados (histórico disponível, consumo sem categoria, consumo sem para quem, compras pendentes, última sincronização), as definições e a exportação.

### Exportação

`GET /api/exportacao?mes=AAAA-MM&formato=csv|excel` devolve um CSV com uma linha por transação da residência, em ordem cronológica. Sem `mes`, exporta o histórico completo. O formato `csv` usa vírgula e ponto decimal; o formato `excel` usa ponto e vírgula e vírgula decimal, para o Excel em português. O arquivo é UTF-8 com BOM, e textos que começam com `=`, `+`, `-` ou `@` são protegidos contra execução de fórmulas.

| Coluna | Descrição |
|---|---|
| `id` | Identificador interno da transação |
| `data` | Data da compra ou do lançamento, no horário de Brasília (`AAAA-MM-DD`) |
| `mes` | Mês da data (`AAAA-MM`) |
| `data_hora_utc` | Data e hora em UTC (ISO 8601) |
| `valor` | Valor absoluto, em reais |
| `consumo` | Contribuição para o consumo: positivo para compras, negativo para estornos, zero para o resto |
| `natureza` | `consumo`, `estorno`, `entrada`, `transferencia` ou `pagamento_fatura` |
| `direcao` | `saida` ou `entrada` |
| `situacao` | `lancada` ou `pendente` (pendentes podem mudar ou sumir na fonte) |
| `descricao_original` | Descrição como veio do banco |
| `estabelecimento` | Estabelecimento normalizado |
| `categoria` | Categoria no Kalu, vazia quando sem categoria |
| `tipo_categoria` | `consumo` ou `transferencia` |
| `origem_categoria` | `automatica`, `regra` (regra da residência) ou `usuario` (ajuste manual) |
| `categoria_fonte` | Categoria informada pela Pluggy |
| `para_quem` | `domestica` (Casa), `compartilhada` ou `individual`; vazio quando sem definição |
| `participantes` | Integrantes envolvidos, separados por `\|`: todos para `domestica` e `compartilhada`, o integrante para `individual` |
| `origem_para_quem` | `automatica`, `regra` ou `usuario` |
| `conta` | Nome da conta ou do cartão |
| `tipo_conta` | `conta_corrente`, `poupanca`, `cartao_credito` ou `outra` |
| `instituicao` | Banco |
| `titular` | Titular da conta ou do cartão (quem pagou), que não é necessariamente quem consumiu |
| `fatura_vencimento` | Vencimento da fatura em que a compra foi cobrada (cartão) |
| `parcela`, `total_parcelas` | Número da parcela e quantidade de parcelas |

Para somar o consumo de um período, some a coluna `consumo`. Para não contar o pagamento de fatura duas vezes, filtre `natureza = pagamento_fatura` por `tipo_conta`.

## Aplicativo no celular (PWA)

O Kalu pode ser instalado na tela inicial do celular e abre em tela cheia, como um aplicativo, sem loja.

- `src/app/manifest.ts` gera o `/manifest.webmanifest` com nome, cores, modo de tela cheia, ícones (comum e *maskable* para o Android) e atalhos para Contas e Análise. O manifesto e os ícones são públicos, porque o navegador os busca sem a sessão.
- Ícones em `public/icons/`, `src/app/apple-icon.png` (tela inicial do iPhone) e `src/app/favicon.ico`.
- No iPhone, o Kalu abre sem a barra do Safari e a detecção automática de telefone fica desligada, para valores não virarem links.
- No Início, um cartão sugere a instalação: no Android e no Chrome, o botão **Instalar** abre o instalador do sistema; no iPhone, mostra o caminho pelo Safari (Compartilhar → Adicionar à Tela de Início). O cartão some quando o Kalu já está instalado ou depois de dispensado.
- Não há modo offline: os dados financeiros não são guardados no aparelho.

Para instalar: abra o Kalu publicado (HTTPS) no celular, entre com sua conta e use o cartão do Início ou o menu do navegador.

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
| `APP_URL` | Endereço público do Kalu, usado no cadastro do webhook. Na Vercel, se vazio, usa o domínio de produção |
| `PLUGGY_WEBHOOK_SECRET` | Segredo que a Pluggy envia em cada notificação |
| `PLUGGY_WEBHOOK_SIGNING_SECRET` | Opcional: segredo de assinatura gerado no Dashboard da Pluggy |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Chaves das notificações push dos avisos de meta (veja Avisos de meta no celular). Opcionais: sem elas, não há push |
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
