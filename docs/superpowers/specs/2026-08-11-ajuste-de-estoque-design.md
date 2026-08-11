# Design — Ajuste e zeragem de estoque pelo PubliAI

**Data:** 2026-08-11
**Status:** aguardando aprovação
**Origem:** incidente investigado em 2026-08-11 — cor zerada manualmente no Mercado Livre voltava
a aparecer dias depois.
**Decisão associada:** ADR-0110 (motivo `ajuste` no ledger, só redução, admin-only)
**Refina:** ADR-0094 (ledger de estoque, push absoluto), ADR-0060 (pausar/reativar é admin)

## Problema

O operador zerava o estoque de uma cor direto no Mercado Livre e, um ou dois dias depois, o
estoque estava de volta e a cor voltava a vender.

Causa confirmada com dados de produção em 2026-08-11:

1. `sincronizar-estoque` faz push **absoluto** do estoque local para o canal. O que está no
   PubliAI sobrescreve o que está no ML.
2. O cron `reconciliar-estoque` (`30 12 * * *`, schedule `scd_5WETvRdUHQr7pzKqgv4Pg4QrFNgA`,
   confirmado ativo) re-empurra todo produto com movimento nas últimas 24h — e enfileira com
   `canal_origem: null` fixo (`supabase/functions/reconciliar-estoque/index.ts:93`).
3. Esse `null` descarta a intenção que `sync-venda` grava de propósito: uma venda no ML nasce com
   `push_canal_origem = 'mercado_livre'` justamente para o push **não** ecoar de volta ao ML.
   O que a venda evitou, o cron desfaz até 24h depois.

Estado no banco no dia da investigação (SKU Vermelho dos três anúncios Helanca Light):

| Produto | SKU | Estoque no PubliAI |
|---|---|---|
| `02670534` — 3,00x1,80M | 01876090 | 2000 |
| `26705341` — 10MT | 18760901 | 2000 |
| `26705343` — 10 Metros (user products) | 18760903 | 1990 |

Nenhum foi zerado localmente. Os três vendem quase diariamente, então quase sempre entram na
varredura do cron. Evidência runtime: 13 mensagens `sincronizar-estoque` criadas às 12:30–12:31
UTC de 2026-08-11.

Descartada a hipótese de outbox travado: existe uma única linha com `push_enfileirado_em is null`,
e com `codigo_pai` vazio — ignorada pelo filtro `.neq('codigo_pai', '')` das duas varreduras.

## Requisito (nas palavras do Diego)

1. Zerar o estoque **pelo PubliAI**, não pelo ML — "mais simples e de forma imediata".
2. Poder zerar o produto inteiro **ou** uma variação específica, quando houver variação.
3. Poder **ajustar** o saldo, porque também vende fisicamente e o número local fica defasado.

Decisões tomadas na revisão (crítico adversarial, 2026-08-11):

4. O ajuste **só reduz ou zera**. Aumentar continua sendo Entrada de mercadoria, que exige custo.
5. Ação restrita a **admin**, por paridade com pausar/reativar (ADR-0060).
6. Estorno de pedido cancelado **continua repondo** o saldo — a mercadoria voltou fisicamente. O
   diálogo avisa que isso pode reativar a cor no canal.

## Não-objetivos

- Webhook `items` do ML. Espelhar o que o operador digita no ML fica fora: volume alto de
  notificações (todo push nosso gera evento), risco de o throttle engolir o evento que importa, e
  dependência do painel da aplicação ML. Com o ajuste local existindo, o caso deixa de ocorrer.
- Guard de leitura do ML antes do push. Mesma razão.
- Corrigir o `canal_origem: null` de `reconciliar-estoque:93`. O eco permanece por decisão: **toda**
  edição manual de estoque no ML continua sendo revertida em até 24h, e isso vira regra operacional
  explícita na documentação do operador ("nunca editar estoque direto no ML").

## Arquitetura

Três camadas, espelhando a Entrada de mercadoria, que já está em produção desde 2026-07-29.

```
UI (dialog-ajuste)  →  edge ajustar-estoque  →  RPC ajustar_estoque  →  ledger + variacoes.estoque
                              ↓
                    enfileirarSincronizacaoEstoque(canal_origem: null)
                              ↓
                    sincronizar-estoque → push absoluto → ML
```

### 1. Banco (migration)

**Constraint de motivo.** `estoque_movimentos_motivo_check` não aceita append: a migration faz
`drop constraint` + `add constraint` incluindo `'ajuste'`, preservando os sete motivos atuais
(`supabase/migrations/20260729084329_e6b_estoque_movimentos.sql:38-44`).

**RPC `ajustar_estoque(p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
p_criado_por uuid, p_ref text) returns integer`**, `security definer set search_path = ''`:

- Rejeita `p_novo_saldo` nulo, negativo ou acima de `99999` (cap do ML, ver §4). Rejeita `p_ref`
  vazia. Falha LOUD: `raise exception`, nunca default silencioso.
- Resolve a variação pela **família mais recente** do SKU — mesma âncora de `registrar_entrada`
  (`...sql:281-287`), de `baixar_estoque` e do push. SKU ausente → exceção, igual à entrada.
- **`insert`-first**, como `baixar_estoque` (`...sql:108-115`): grava o movimento com
  `quantidade = 0` e a `referencia_externa`; `unique_violation` → `return null` (já aplicado).
  Só então `select ... for update` no saldo, `update variacoes`, e um segundo `update` no
  movimento preenchendo `quantidade` (delta, sempre ≤ 0), `estoque_anterior` e
  `estoque_resultante`. Essa ordem evita segurar o lock da variação num retry duplicado, o que
  bloquearia `baixar_estoque` concorrente à toa.
- `codigo_pai` é preenchido no insert — sem ele o movimento fica fora do índice de outbox
  (`estoque_movimentos_push_pendente_idx`, `...sql:58-60`) e o push nunca seria recuperado.
- **Rejeita aumento**: `p_novo_saldo > estoque_atual` → exceção orientando a usar Entrada.
- Delta 0 (saldo já é o pedido): o movimento fica gravado com `quantidade = 0` — trilha de que
  alguém conferiu — e a edge enfileira o push mesmo assim (ver §2).
- `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role`,
  como as RPCs do Bloco A (`...sql:350-363`). Sem o revoke, uma função `security definer` fica
  chamável pelo browser e contorna o trigger `bloquear_escrita_direta_estoque` e a RLS.

### 2. Edge `ajustar-estoque` (`verify_jwt = true`)

Espelha `supabase/functions/entrada-estoque/index.ts`:

- `requireUserOrg(req, { access: 'write' })` + **checagem de admin** (ADR-0060) +
  `exigirModulo(admin, orgId, 'estoque')`.
- Body: `{ ajustes: [{ codigo, novoSaldo }], observacao?, ref }`. Uma variação = lista de 1;
  produto inteiro = lista de N. Um endpoint só.
- **Uma referência por item**: `ajuste:{ref}:{codigo}`. O índice de idempotência é
  `(org_id, referencia_externa)` (`...sql:48-50`) — uma `ref` compartilhada faria o segundo item
  colidir e ser lido como duplicata, aplicando só a primeira cor e devolvendo sucesso. Esse é o
  modo de falha mais perigoso do design e a razão da ref por item.
- Aplica item a item e devolve **resultado por item**: `{ codigo, estoque, duplicada, erro? }`.
  Falha no meio não desfaz o que já passou (cada item é atômico na sua RPC); a resposta diz
  exatamente o que entrou, e o operador reenvia com a mesma `ref` — os já aplicados voltam como
  `duplicada`, os que faltaram entram.
- Enfileira **um** `sincronizar-estoque` por `codigo_pai` envolvido, com `canal_origem: null`,
  **sempre** — inclusive quando todos os itens vieram `duplicada` ou com delta 0. É o mesmo
  contrato de `entrada-estoque/index.ts:62-68`: se a primeira tentativa gravou mas morreu antes de
  enfileirar, o retry cairia em duplicada e o push se perderia para sempre. Push absoluto é
  idempotente; re-enfileirar é mais barato que perder a propagação.
- `auditarOperacaoSuporte(admin, context, { type: 'variacao', id: codigo }, 'succeeded')`, como a
  entrada faz (`entrada-estoque/index.ts:83`).
- `supabase/config.toml` ganha `[functions.ajustar-estoque] verify_jwt = true`, junto das irmãs
  chamadas pelo app.

### 3. UI — `src/components/estoque/dialog-ajuste.tsx`

Ao lado de `dialog-entrada.tsx`, no módulo Estoque:

- Uma linha por variação do produto, com o saldo atual e um campo **novo saldo** pré-preenchido
  com esse saldo.
- Botão **Zerar** por linha (preenche 0) e **Zerar tudo** no cabeçalho (preenche 0 em todas).
- Campo de observação opcional, gravado em `estoque_movimentos.observacao`.
- Campo que exceda o saldo atual é bloqueado na tela, com a mensagem apontando para a Entrada.
- Antes de confirmar, resumo do que sai: "Vermelho: 1990 → 0 (−1990)".
- Aviso fixo no diálogo: **um pedido cancelado depois disso repõe o saldo e a cor pode voltar a
  vender no canal; para tirar de venda de vez, use Pausar.**
- Sucesso: `✓ Salvo` inline. `pushOk:false` → "Salvo. A sincronização com o canal será refeita
  automaticamente."
- Ação visível só para admin (mesmo gate do pausar/reativar).

### 4. Cap de estoque do ML

`atualizarEstoque` envia o valor cru — item plano em `_shared/canais/mercado-livre.ts:350`,
variações em `:356` — sem passar por `caparEstoque` (`_shared/split/capar-estoque.ts`), que
hoje só roda na criação e no update (`mercado-livre.ts:139`, `:260`). Como o ajuste só reduz, ele
não pode criar um valor acima do teto; a validação `0 ≤ novoSaldo ≤ 99999` entra mesmo assim, como
trava barata. Aplicar `caparEstoque` também no push fica registrado como dívida conhecida (afeta a
Entrada, não este design).

## Fluxo de dados

1. Diego abre o produto no módulo Estoque e clica em **Ajustar**.
2. Zera a cor Vermelho (ou o produto inteiro) e confirma.
3. Edge aplica N RPCs, cada uma com sua ref; ledger ganha N movimentos `ajuste` com delta negativo.
4. Edge enfileira um `sincronizar-estoque` por `codigo_pai`, `canal_origem: null`.
5. Worker lê o estoque canônico (agora 0 para o SKU), resolve os alvos e faz PUT no ML.
6. O anúncio fica sem estoque na cor. O cron das 09:30 (12:30 UTC) passa a **reafirmar** o zero.

## Tratamento de erro

| Falha | Comportamento |
|---|---|
| SKU inexistente na família mais recente | Exceção na RPC; item volta com erro, os outros seguem |
| Novo saldo > atual | Rejeitado na tela e de novo na RPC (defesa dupla) |
| Mesma submissão reenviada | `unique_violation` → `duplicada`, sem aplicar de novo |
| Enfileiramento do push falha | Ajuste já é a verdade; `pushOk:false` e a reconciliação diária recupera pelo outbox |
| Push falha no canal | Retentável → QStash re-tenta; definitivo → log e reconciliação diária |
| Não-admin | 403 antes de qualquer escrita |

## Riscos aceitos

- **Item user products preso em pausado.** `alvos.ts:45` pula filho com `status !== 'ativo'`. Se o
  ML pausar o item técnico ao chegar a 0 e algum job regravar esse status localmente, um ajuste
  posterior para cima (via Entrada) pode não alcançar o item. Verificação obrigatória antes da
  entrega: zerar um SKU UP real, conferir o status no ML e no banco, repor pela Entrada e conferir
  que o push chegou.
- **Estorno repõe por cima do zero.** Decisão explícita do Diego (§Requisito 6).
- **Edição manual no ML continua sendo revertida.** Decisão explícita (§Não-objetivos).

## Testes

- Unitário puro (vitest) do cálculo de delta e das validações de faixa/direção, extraídos para um
  módulo sem dependência de Deno — mesmo padrão de `_shared/estoque/baixa.ts` e
  `_shared/split/capar-estoque.ts`.
- Teste da montagem de refs por item: N itens produzem N referências distintas.
- Teste da edge com admin cliente falso: item que falha no meio não impede os seguintes, e o push
  é enfileirado uma vez por `codigo_pai`.
- Teste de UI do diálogo: bloqueio de valor maior que o saldo, "Zerar tudo" preenchendo todas as
  linhas, e o resumo do delta.
- Verificação manual em produção com um SKU real (o item UP do risco acima).

## Documentação a atualizar no mesmo commit da entrega

- `docs/reference/edge-functions.md` (nova função + config)
- `docs/reference/modelo-de-dados.md` (motivo `ajuste`, nova RPC)
- `docs/decisions/0110-ajuste-de-estoque-so-reduz.md` + índice de ADRs no obsidian-vault
- `docs/TASKS.md`
- Regra operacional "nunca editar estoque direto no ML" na documentação do operador
