# How-to — Operações rotineiras

> **Tipo:** How-to (Diátaxis). Procedimentos operacionais recorrentes. Runbooks mais longos
> ficam em [../runbooks/](../runbooks/). Conceitos em
> [../explanation/arquitetura.md](../explanation/arquitetura.md).

## Reprocessar família travada em "erro"

**Pela UI:** tela de Revisão → família em erro → botão "Reenviar" (uma) ou "Reenviar N com
erro" (todas do lote).

**Por API** (precisa de JWT do usuário):

```bash
curl -X POST https://<project>.supabase.co/functions/v1/reprocessar-familia \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"familia_id":"<id>"}'      # ou {"lote_id":"<id>"} p/ todas as do lote
```

A função reseta `erro → pendente` e re-enfileira (guard idempotente — ADR-0030).

**Erro de picture id inexistente no ML** (ex.: `Picture id … does not exist` após republicar):
depois do fix de 2026-09-01, o CREATE limpa os caches efêmeros de foto ao marcar erro definitivo
e o modo "Corrigir e republicar" zera os picture ids antes do próximo publish — o Reenviar passa
a re-subir as imagens em vez de reutilizar ids mortos no ML.

## Retentar vínculo de catálogo

Quando uma variação publicada ficou em `catalog_status` **erro** ou **nao_elegivel** (sem
`catalog_listing_id`), o operador pode re-enfileirar o worker de opt-in:

**Pela UI:** tela **Publicados** → linha com catálogo retentável → botão **Tentar catálogo de
novo** (ícone ↻, só admin). Resultado esperado em ~1 minuto.

**Por API:**

```bash
curl -X POST https://<project>.supabase.co/functions/v1/retentar-catalogo \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"familia_id":"<id>"}'
```

A função valida família publicada da org, exige variação Legacy ou item UP retentável, e
enfileira `vincular-catalogo` com delay de 60s (ADR-0021). Não reseta `catalog_status` no
banco — o worker relê elegibilidade/opt-in.

## Destravar família/worker enfileirando no QStash na mão

Quando uma família ficou em estado inconsistente e o reprocessamento normal não cobre:

1. **Reset do estado** via SQL (canal canônico): voltar `status` para `pendente`.
2. **Enfileirar** disparando o `curl` do QStash **do próprio projeto** (com `QSTASH_TOKEN` e a
   URL da função). **Não** use o MCP do QStash para isso — ele faz double-encode do body.
3. Deploy/ações de CLI usam o `SUPABASE_ACCESS_TOKEN` do `.env.local`.

Contexto e armadilhas em `reference_reenfileirar_qstash_manual` (memória do projeto) e ADR-0030.
A automação do botão "Reenviar" é a forma suportada (ADR-0030); o passo manual é exceção.

### Caso concreto: famílias presas em `publicando` sem mensagem (lote #45, 03/08)

Sintoma: a tela de Progresso para de avançar e o operador não tem ação — as famílias **não**
aparecem como erro (então o "Reenviar" não as alcança, ele filtra `status='erro'`) e a fila do
QStash está vazia. Diagnóstico em uma query: `status='publicando'` **e** `qstash_message_id is
null` = a mensagem nunca foi enfileirada.

O bug de origem foi corrigido (PR #66 — enfileiramento em lote + órfãs viram `erro`
recuperável), mas o procedimento continua válido para qualquer resíduo:

1. **Confirme que não há nada em voo** antes de reenfileirar, senão duplica trabalho:
   `GET /v2/queues/publish-ml-{user_id}` deve vir com `lag: 0`, e a DLQ (`GET /v2/dlq`) sem
   mensagens do worker em questão.
2. **Mantenha o status em `publicando`** — não resete para `pendente`: o worker de UPDATE
   (`update-familia-ml`) exige exatamente esse status no claim e faria `skip` em qualquer outro.
3. **Enfileire em batch** (`POST /v2/batch`, um item por família) na fila serial
   `publish-ml-{user_id}`, com `Upstash-Retries: 10` e `Upstash-Retry-Delay: 30000` — os mesmos
   parâmetros de `enfileirarPublicacoes`. Roteie cada família para o worker certo:
   `publicar-split-ml` quando tiver >100 cores ou preços divergentes, senão `update-familia-ml`.
   O body é `{familia_id, lote_id, somenteEstoque}`.
4. Reenviar é **idempotente**: o UPDATE de estoque manda o valor absoluto.

Gravar o `qstash_message_id` de volta é só rastreabilidade — não afeta o processamento. Um
`update ... case id ... end` com centenas de entradas estoura o endpoint SQL de management (403);
faça em blocos se precisar.

## Reconectar OAuth do Mercado Livre

Se a publicação falhar com "token expirado" e o refresh automático (lock Redis — ADR-0012) não
resolver:

1. Tela **Canais** (`/canais` — desde a spec 2026-07-14 "menus multicanal"; o card do ML saiu de
   Configurações) → "Desconectar" + "Conectar" (refaz o fluxo `ml-oauth-start` → `ml-oauth-callback`,
   que redireciona de volta para `/canais`).
2. Confirme que `marketplace_connections` foi atualizado (novo `expires_at`).

O refresh de token é automático e protegido por lock; não há ação manual no fluxo normal.

## Habilitar um canal (marketplace) para uma organização

Canal novo no registry de UI (`src/lib/canais.ts`, hoje só Mercado Livre `ativo`) só aparece
operável para uma org depois de habilitado — rollout piloto sem deploy (D5 da spec 2026-07-14):

1. Tela **`/admin`** (super-admin) → botão "Canais" na linha da organização.
2. Marcar o(s) canal(is) desejado(s) — Mercado Livre vem travado (sempre habilitado, não dá para
   desmarcar).
3. Salvar (edge `usuarios`, action `set_canais_org`) — some do "Em breve" e vira operável na tela
   `/canais` da org (ainda precisa conectar OAuth/credencial antes de publicar de fato).

Isso só controla **visibilidade/rollout** por org; o canal só publica de verdade quando o conector
do backend existir (`ShopeeConnector` etc. — ver [[Publicação Shopee]] no vault) e o `status` virar
`'ativo'` no registry.

## Habilitar o módulo Estoque para uma organização (ADR-0094)

O módulo `estoque` (cadastro manual de produto + entrada de mercadoria) é **pago e opt-in**:
nenhuma org nasce com ele.

1. Tela **`/admin`** (super-admin) → botão **"Módulos"** na linha da organização.
2. Marcar **Estoque** e salvar (edge `usuarios`, action `set_modulos_org`).
3. Na org, o menu **Estoque** passa a aparecer para quem tem a permissão de menu correspondente.

Desabilitar esconde o menu e faz as edges `cadastrar-produto`/`entrada-estoque` responderem 403 —
**o dado já gravado não é apagado** (produtos, saldo e ledger continuam lá; a baixa automática por
venda e o push de estoque valem para toda org, com ou sem o módulo).

## Cadastrar produto sem planilha e dar entrada de mercadoria (ADR-0094, código automático ADR-0096)

Fluxo do operador de uma org com o módulo `estoque` habilitado.

**Cadastrar produto** (tela `/estoque` → "Cadastrar produto"):

1. Dados do PAI: nome, descrição, unidade, fornecedor e **origem** (nacional/importado —
   obrigatório, define a alíquota de imposto; o botão de salvar fica travado sem ela). **Sem
   campo de código** — o aviso na tela diz "Códigos gerados automaticamente ao salvar" (D-8 do
   ADR-0096). Campos obrigatórios levam `*`; o título do diálogo mostra "etapa 1 de 2".
2. Uma linha por variação: cor/nome, GTIN, **preço mínimo (líquido)**, custo, estoque inicial,
   peso e dimensões. O rótulo é "Preço mínimo (líquido)" de propósito: **não é preço de venda**,
   é quanto o operador quer receber por venda depois de comissão, frete e imposto
   (`variacoes.preco`, o `piso` do motor). Na Revisão o preço exibido é o **calculado**
   (`preco_publicacao`), com o selo "sugerido pela IA" ao lado quando difere do piso; o valor
   digitado aqui não se perde — continua logo abaixo, como "mín. líquido". ⚠️ O piso **não trava
   a publicação**: no ramo competitivo o preço pode entregar líquido abaixo dele e o anúncio sai
   assim mesmo — o semáforo é que avisa ("Abaixo do mínimo" 🟡, prejuízo 🔴).
   **Sem coluna de SKU** — o GTIN continua sendo o lugar do EAN; o SKU é gerado junto com o
   código do PAI.
3. Salvar. Se aparecer aviso de pendência (**"Reprocessar"** ou lista de SKUs sem estoque),
   resolva antes de seguir — o botão "Ir para a Revisão" fica travado de propósito, porque
   cadastro parcial reportado como sucesso é a pior falha possível aqui.
4. Etapa de fotos: capa (até 3) e uma foto por variação, já pelo código **gerado**. As fotos
   escolhidas na etapa 1 **já subiram** durante o Salvar — a etapa 2 mostra cada uma como
   miniatura com **"✓ enviada"** e um botão "Trocar", e só apresenta campo de upload para o que
   falta ou falhou. Ela **não** está pedindo a mesma foto de novo; é a tela de conferência e
   retry.
5. "Ir para a Revisão" — **o cadastro não publica nada**; publicar continua sendo ato explícito
   na Revisão, como no fluxo de planilha.

Produtos cadastrados em sequência caem no **mesmo lote** (a "sessão de cadastro"). Na tela de
Lotes eles aparecem com o chip **Cadastro manual**, para distinguir do fluxo de planilha.

Erros esperados e o que significam — como o operador não digita código nem SKU, os dois 409 de
hoje não são mais "renomeie X"; são sempre reação a uma submissão repetida (mesma chave de
idempotência), nunca a uma escolha do operador:

| Erro | O que fazer |
|---|---|
| 409 "Cadastro em andamento. Tente novamente." | Sem produto para abrir ainda — reenviar (clicar Salvar de novo) resolve: ou o cadastro anterior com esta chave ainda está terminando de gravar, ou houve corrida entre duas submissões da mesma chave. |
| 409 de divergência (banner fixo no diálogo + toast com ação **"Abrir na Revisão"**) | Esta chave já gerou um produto gravado, e o que está no formulário agora é diferente do que foi salvo. Não adianta reenviar — abra o produto na Revisão para conferir/editar o que já existe. |
| 403 "módulo não habilitado" | A org perdeu o módulo. Ver a seção acima. |

**Dar entrada de mercadoria** (tela `/estoque` → "Dar entrada"):

1. Buscar o SKU por código ou nome do produto.
2. Quantidade (inteiro > 0), custo unitário (opcional; se informado tem que ser > 0 e
   **sobrescreve** o custo da variação) e documento (NF do fornecedor, texto livre).
3. Registrar. O saldo sobe e o novo estoque é empurrado na hora para **todos** os marketplaces
   onde o produto está publicado.

Se aparecer *"Saldo atualizado. A sincronização com os marketplaces falhou…"*, a entrada **foi
gravada** — só a propagação falhou, e a reconciliação diária (`30 12 * * *`) a refaz. Não lance a
entrada de novo. Se relançar mesmo assim na mesma janela do formulário, a referência de
idempotência faz a 2ª aplicação virar no-op.

O histórico completo de movimentos de cada produto fica no expandir da linha, em `/estoque` e em
Publicados. A tabela de variações expandida também mostra GTIN, dimensões (peso/altura/largura/
comprimento) e a descrição do produto — dados capturados no cadastro que antes só eram visíveis
na Revisão.

## Reduzir ou zerar o estoque de um produto (ADR-0110)

**Nunca edite o estoque direto no Mercado Livre.** O PubliAI faz push **absoluto** do saldo local
para o canal, e o cron `reconciliar-estoque` (09:30 BRT) re-empurra todo produto que teve movimento
nas últimas 24h — o número que você digitou lá volta ao valor daqui em até um dia. Foi exatamente
isso que aconteceu com a cor Vermelho do Helanca Light em agosto de 2026.

O caminho certo é `/estoque` → botão **Ajustar** no produto (visível só para admin):

1. O diálogo lista todas as variações com o saldo atual já preenchido.
2. Digite o novo saldo da cor, ou clique **Zerar** na linha. **Zerar tudo** zera todas de uma vez.
3. Opcionalmente escreva a observação (ela vai para o histórico de movimentos: "venda no balcão",
   "perda", "acerto de inventário").
4. Confirme. O saldo cai aqui e o push leva o número novo para todos os canais publicados.

O ajuste **só reduz**. Para aumentar, use **Entrada** de mercadoria — ela exige custo, e é o custo
que alimenta markup e preço. Se um pedido for cancelado depois de você zerar, o estorno **repõe** o
saldo (a mercadoria voltou fisicamente) e a cor pode voltar a vender; para tirar de venda de vez,
use **Pausar** em Publicados.

Dois comportamentos do ML medidos em 2026-08-11, que valem para qualquer reposição:

- **Repor estoque reativa o anúncio pausado.** Item `paused` com quantidade 0 que recebe estoque
  volta a `active` sozinho, sem ninguém mandar reativar.
- **Anúncio moderado (`forbidden`) recusa o push** com 400 — o saldo cai aqui e o canal fica para
  trás até a republicação. E atenção: `sincronizar-estoque` devolve 200 mesmo nesse caso, então
  fila entregue **não** é prova de canal atualizado; confira o número na tela Publicados.

## Excluir ou alterar um produto cadastrado manualmente

A tela `/estoque` tem **Dar entrada**, **Ajustar** (ADR-0110) e, no menu `⋮` da linha,
**Excluir produto** (ADR-0113) — os dois últimos só para admin, e o menu só aparece de tablet
para cima. Os caminhos:

- **Alterar** (título, descrição, preço, categoria, atributos) — só funciona **antes de
  publicar** (`status='pronto'`/`'revisao'`): editar em **Revisão**, os mesmos campos do fluxo de
  planilha. Depois de publicado não existe edição "ao vivo" para um produto cadastrado manualmente
  — as únicas rotas de atualização (nova planilha com o mesmo código, ou Publicados → Remover →
  Republicar) exigem despublicar e recriar o anúncio.
- **Excluir produto não publicado** — `/estoque` → menu `⋮` da linha → **Excluir produto** →
  digitar o código para confirmar. Roda a edge `excluir-produto`: apaga **todas** as famílias
  daquele `codigo_pai` na org (as variações caem por `ON DELETE CASCADE`), as fotos do Storage e
  os movimentos órfãos. Saldo em estoque **não** bloqueia — o freio é a confirmação digitada.
- **Se o produto está publicado**, o item do menu vem desabilitado e a edge recusa com 409. É
  deliberado (ADR-0113 D-1): apagar família com `ml_item_id` cortaria o vínculo de UPDATE do
  `ingest-lote` e a próxima planilha do mesmo código viraria **anúncio duplicado** no ML. O
  caminho é **Publicados → Remover**, que pausa no ML antes de apagar.
- **Excluir o lote inteiro** — tela **Lotes**, achar o lote com o chip "Cadastro manual" →
  lixeira no card → confirmar. Roda `excluir-lote`, que é **parcial** quando há publicados: só as
  famílias não-publicadas saem, a publicada é preservada (ADR-0019).

> **O ledger `estoque_movimentos` É apagado na exclusão, desde o ADR-0097** (2026-08-01) — a
> versão anterior desta página dizia o contrário, o que valeu até o E6b. As três portas
> (`excluir-lote`, `remover-publicado`, `excluir-produto`) chamam `limpar_movimentos_orfaos`
> depois do delete: uma varredura por anti-join que apaga os movimentos da org cujo `codigo` não
> corresponde a nenhuma variação viva. Sobrevivem quatro motivos que nascem sem variação por
> construção (ADR-0097 D-1.1) — `cancelamento_sem_baixa`, `venda_sku_nao_encontrado`,
> `estorno_sku_nao_encontrado`, `venda_cancelada_antes`. O primeiro é **guarda funcional**, não
> histórico: é o tombstone que faz `baixar_estoque` recusar um pedido já cancelado.

## Monitorar anúncios moderados

Configuração, deploy (`--no-verify-jwt`... veja a ressalva abaixo) e agendamento estão no
runbook dedicado: [../runbooks/monitorar-moderados.md](../runbooks/monitorar-moderados.md).
Resumo: configurar Telegram em Configurações, deployar `monitorar-moderados`, agendar no QStash
(ex.: a cada 6h). A função alerta moderações novas e marca resolvidas (ADR-0035).

> Nota: o runbook menciona `--no-verify-jwt`; o estado atual de `verify_jwt` por função vive no
> `config.toml` (ver [edge-functions.md](../reference/edge-functions.md)). Prefira manter o
> valor no `config.toml` a passar a flag no deploy.

## Anúncios "Próximos a serem pausados" (catálogo)

Procedimento do operador — como resolver quando o ML avisa que vai pausar anúncios por falta de
associação ao catálogo: [../runbooks/catalogo-anuncios-a-pausar.md](../runbooks/catalogo-anuncios-a-pausar.md).

Resumo: o card "Catálogo em risco" em Publicados lista só os anúncios que o ML sinalizou (tag
`catalog_forewarning`); resolver pela extensão (`extensao-ml/`, com dry-run antes do envio) ou à mão
pelo link do card. Contrato e travas em [ADR-0118](../decisions/0118-resolucao-em-massa-do-no-match-de-catalogo.md).

## Catálogo em risco: backfill das famílias congeladas em `pendente`

Quando famílias ficam presas em `catalog_status='pendente'` (o worker parou de perguntar a
elegibilidade ao ML antes de ela ficar pronta), o backfill re-enfileira `vincular-catalogo` para
elas. O script **não escreve no ML nem no banco** — só publica jobs QStash para o worker existente,
então todo opt-in resultante passa pelas travas do ADR-0021.

**Pré-requisito absoluto:** o worker corrigido precisa estar deployado (`supabase functions list`
para conferir a versão). Worker antigo ignora o campo `alertar` e dispara uma mensagem de Telegram
por família.

1. **Gerar a lista** (SQL somente leitura). Salvar como `familias.txt`, um uuid por linha, **fora do
   repositório** (dado de produção):

```sql
select distinct v.familia_id
from variacoes v join familias f on f.id = v.familia_id
where v.catalog_status = 'pendente'
  and v.ml_variation_id is not null
  and f.ml_item_id is not null;
```

O filtro `ml_variation_id is not null` é obrigatório: sem ele entram milhares de linhas nunca
publicadas, que carregam o valor *default* da coluna e não representam problema nenhum.

2. **Dry-run** (não enfileira nada):

```bash
deno run --node-modules-dir=none --allow-net --allow-env --allow-read \
  scripts/backfill-catalogo-pendente.ts familias.txt
```

3. **Executar** e **guardar a saída** — os `messageId` são o mecanismo de reversão:

```bash
deno run --node-modules-dir=none --allow-net --allow-env --allow-read \
  scripts/backfill-catalogo-pendente.ts familias.txt --executar | tee backfill-$(date +%Y%m%d-%H%M).log
```

> `--node-modules-dir=none` é obrigatório nos dois comandos. Sem ele o Deno resolve o
> `node_modules` do pnpm que existe no repo e quebra em `jose`
> (`does not provide an export named 'encode'`).

Os jobs vão com `alertar: false`: a operação roda em silêncio, sem Telegram, inclusive nos
reagendamentos. Publicações novas continuam alertando normalmente.

4. **Reverter** (só antes da entrega — a janela é o delay de cada mensagem):

```bash
curl -X DELETE "https://qstash.upstash.io/v2/messages/<messageId>" -H "Authorization: Bearer $QSTASH_TOKEN"
```

Depois da entrega não há rollback, nem é necessário: o worker é idempotente e o pior resultado é o
`catalog_status` passar a refletir a verdade atual do ML.

5. **Conferir** algumas horas depois e no dia seguinte — QStash 200 não prova resultado:

```sql
select v.catalog_status, count(*) as variacoes, count(distinct v.familia_id) as familias
from variacoes v join familias f on f.id = v.familia_id
where v.ml_variation_id is not null and f.ml_item_id is not null
group by 1 order by 2 desc;
```

O card "Catálogo em risco" na tela Publicados deve encolher junto. Logs:
`supabase functions logs vincular-catalogo`.

## Faturamento: backfill e reconciliação

- **Backfill retroativo** (um período): tela de Faturamento dispara `backfill-faturamento` com
  o JWT do usuário. Não traz frete (shipment).
- **Reconciliação periódica**: `reconciliar-faturamento` roda por schedule do QStash (1h) e cobre
  webhooks perdidos (~72h). **Achado 2026-07-24:** esse schedule não existia de fato desde a
  criação da função (2026-06-22) — corrigido, ver
  [edge-functions.md](../reference/edge-functions.md#histórico--reconciliar-faturamento-sem-schedule-qstash-desde-a-criação-corrigida).

> Antes de confiar nesses fluxos, confira a nota de inconsistências de `verify_jwt` em
> [edge-functions.md](../reference/edge-functions.md#inconsistências-conhecidas-de-verify_jwt) —
> `sync-venda`/`reconciliar-faturamento` podem não estar executando se o gateway rejeitar a
> chamada do QStash.

## Verificar/reconciliar histórico de migrations

```bash
pnpm db:check
```

Se divergir, ver [deploy-e-migrations.md](deploy-e-migrations.md#se-o-histórico-divergir).

## Convidar usuário e definir acesso por menu (ADR-0047)

Operação multiusuário/compartilhada: um **admin** cria os logins e escolhe quais menus cada um
vê. Tela: **Usuários** na sidebar (só admin) → **Convidar usuário**.

- **Convidar:** informe e-mail + nome e marque os menus. Ligue o switch **Administrador** para
  acesso total (auto-marca e trava todos os menus e promove `is_admin`).
- **Editar/desativar/promover:** na tabela de Usuários (switches Admin/Ativo e "Editar menus").
  Usuário **desativado** é deslogado; usuário **sem nenhum menu** cai em `/sem-acesso`.
- O convidado recebe o e-mail "Seu acesso ao PubliAI", clica em **Definir senha e entrar**
  (`/#/definir-senha?token_hash=…&type=invite`), define a senha e entra.

**Reenviar convite a um usuário que já existe** (reinvitar o mesmo e-mail dá "já registrado"):
exclua e recrie. Excluir (cascata remove o `profiles`):

```sql
delete from auth.users where email = 'pessoa@empresa.com';
```

Depois é só clicar **Convidar usuário** de novo na tela.

## Configurar quem recebe notificações no Telegram (ADR-0068)

Cada usuário cadastrado pode receber alertas do Telegram, e o **admin** escolhe **quem recebe
quais categorias** (Vendas, Perguntas, Pós-venda, Financeiro, Moderação). O bot é **um só por
empresa**; o que muda por pessoa é o destino (Chat ID) e as categorias.

**Pré-requisito (uma vez):** em **Configurações → Alertas no Telegram**, cole o **Bot token**
(criado no `@BotFather` com `/newbot`) e ligue o interruptor **Ativo**. Esse interruptor é geral:
desligado, **ninguém** recebe.

**Para cada pessoa que vai receber:**

1. **Ela descobre o Chat ID dela:** no Telegram, abre conversa com `@userinfobot`, manda `/start`;
   ele responde `Id: 123456789`. Copiar só o número.
2. **Ela libera o bot da empresa** (passo que todos esquecem): abrir o **bot da empresa** e mandar
   qualquer mensagem uma vez (ex.: `oi`). Sem isso o Telegram bloqueia o bot de escrever pra ela.
3. **O admin cadastra o destinatário:** tela **Usuários** → na linha da pessoa, botão
   **Notificações** → cola o **Chat ID** → marca as **categorias** (ou usa **Marcar todas**) →
   **Salvar**. As categorias assinadas aparecem como etiquetas na linha.
4. **Confirmar que chegou:** ainda no dialog, o botão **Enviar teste** (ao lado de "Categorias")
   manda uma mensagem de teste **direto pro Chat ID que está no campo**, sem precisar mexer em
   Configurações. Fica desabilitado enquanto o campo estiver vazio.

**Regras:**

- **Chat ID vazio = não recebe**, mesmo com categorias marcadas.
- Cada pessoa recebe **só** as categorias marcadas para ela.
- Para tirar alguém: abra **Notificações** e desmarque tudo (ou apague o Chat ID).
- O campo **"Chat ID para teste de conexão"** em Configurações é do botão **Enviar teste** de lá
  (mesma edge function, mas usa o Chat ID salvo em Configurações) — não é o destino das
  notificações reais; para testar o Chat ID de uma pessoa específica, use o botão dentro do
  dialog de Notificações dela (item 4 acima).
- Categorias: **Vendas** (venda paga), **Perguntas** (pergunta de comprador), **Pós-venda**
  (devolução/reclamação), **Financeiro** (liberação de saldo MP), **Moderação** (anúncio moderado
  + catálogo sem match).

## Adicionar uma empresa-cliente (multi-tenant, E7 — ADR-0027)

Cada empresa é uma **organização** (`org_id`) com dados 100% isolados por RLS
(`org_id = current_org_id()`). O `.env.local` é da **plataforma** — nunca se cria `.env` por
empresa. Só **super-admin** (`is_super_admin`, hoje só o Diego) cria empresas (D-E7.8).

**1. Criar a empresa** — link **"Admin da plataforma"** no topo (só super-admin) → tela
**`/admin`** → **"Nova empresa"**. Informe nome, slug (único, minúsculo), marca padrão,
**e-mail + nome do primeiro admin dela**. Isso cria a `organizations`, convida o admin e marca
o `profiles` dele com o `org_id` novo (`is_admin=true`).

**2. O admin da empresa entra** — recebe o convite ("Definir senha e entrar"), loga e já cai
isolado na org dele (só vê os próprios dados).

**3. Ele conecta a conta do marketplace** — **Configurações → "Conectar Mercado Livre"** →
autoriza com a **conta ML da empresa dele**. O `ml-oauth-callback` grava a conexão em
`marketplace_connections` no `org_id` dele, com token no Vault (é a conexão **da org**, não do
usuário — qualquer membro dela publica). O `ML_CLIENT_ID` é o mesmo app do PubliAI para todas
(OAuth = 1 app, N contas autorizando).

> **Quem conecta o ML é sempre um usuário daquela empresa.** Como o modelo é **1 usuário = 1 org**
> (D-E7.1), o super-admin não opera dentro de outra empresa nem conecta o ML por ela. Multi-org
> por usuário foi adiado (E8).
>
> **Pré-requisito externo:** o app do PubliAI no ML DevCenter precisa estar em produção/aprovado
> para aceitar contas de terceiros (em modo de teste só contas de teste autorizam).

**Remover uma empresa** — na tela `/admin`, botão **"Excluir"** na linha da empresa →
confirmação digitando o **slug**. A ação `delete_org` (edge `usuarios`, super-admin) apaga todos
os dados da org (`lotes` cascateia famílias/variações; `ml_vendas` cascateia itens; demais
tabelas `org_id` explicitamente), os **membros** (`auth.users`) e a organização. **Travas:**
super-admin não exclui a **própria** empresa (protege a Avil); a linha da própria org mostra
"sua empresa" em vez do botão.

> ⚠️ Isto remove só os **registros locais**. Anúncios já publicados **não** são despublicados do
> marketplace, e o secret da conexão fica órfão no Vault (inofensivo).

Validado ponta a ponta em 2026-07-06 (criação via `/admin`, isolamento confirmado — admin da
empresa nova viu 0 lotes/famílias da Avil — trava da própria empresa, e exclusão completa pela UI).

## E-mail transacional (SMTP via Resend)

O e-mail de convite/reset **não** usa o serviço interno do Supabase (`@mail.app.supabase.io`,
só entrega para a equipe do projeto). Está configurado **SMTP próprio via Resend**:

- **Provedor:** Resend (free 3k/mês). Domínio de envio verificado: `daludi.com.br`.
  Remetente: `publiai@daludi.com.br`. Secrets no `.env.local`: `RESEND_API_KEY`,
  `RESEND_SENDER_EMAIL`.
- **Onde mora:** a API key fica na **config de SMTP do Supabase Auth** (Management API:
  `smtp_host=smtp.resend.com`, `smtp_port=465`, `smtp_user=resend`, `smtp_pass=<API key>`).
  O frontend/edge **não** leem `.env.local` para isso — o Supabase é quem envia.
- **Templates** (Convite/Reset) e `site_url` (= URL de produção) também estão na config do Auth;
  o link aponta para `{{ .SiteURL }}/#/definir-senha?token_hash={{ .TokenHash }}&type=…`.
- **Validar entrega:** API do Resend — `GET https://api.resend.com/emails?limit=5`
  (`Authorization: Bearer $RESEND_API_KEY`) mostra `last_event: delivered` e o HTML/link.
- **Limite de envio:** o Supabase Auth tem rate limit **próprio** por hora
  (`rate_limit_email_sent`), independente do Resend. O default do serviço interno é **2/hora** —
  ele **não** sobe sozinho ao configurar SMTP. Está em **50/hora**. Se um convite falhar com
  **"email rate limit exceeded"**, é esse teto; ajuste via Management API:
  `PATCH /v1/projects/{ref}/config/auth` com `{"rate_limit_email_sent": <n>}`.

### Diagnóstico de convite que falha

A tela mostra a mensagem real da função. Causas comuns:

- **"Esse e-mail já tem cadastro…"** (409) → o e-mail já existe; remova e convide de novo.
- **"email rate limit exceeded"** (400) → estourou o `rate_limit_email_sent` da hora (ver acima).
- Para ver o status real no servidor: `get_logs` (service `edge-function`) mostra o código HTTP
  de `/usuarios`; `get_logs` (service `auth`) mostra os eventos `mail.send`/`user_invited`.
