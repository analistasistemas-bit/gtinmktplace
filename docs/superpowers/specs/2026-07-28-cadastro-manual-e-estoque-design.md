# Cadastro manual de produto + Entrada de mercadoria + Estoque — Design

**Data:** 2026-07-28
**Status:** Aguardando revisão do Diego
**Épico:** absorve e amplia o `E6b` (estoque único cross-canal) do roadmap
**Substitui:** `docs/superpowers/plans/2026-07-02-e6b-estoque-unico-cross-canal.md` (plano nunca executado — as decisões D-E6b.\* são reaproveitadas, com uma inversão explícita em D-E6b.5/D-E6b.7)

---

## 1. Problema

Hoje um produto só entra no PubliAI por **planilha** (`ingest-lote`). Isso significa que o produto
exige, como pré-requisito de uso, que o cliente **já tenha um sistema** capaz de exportar a planilha
no formato esperado — ou seja, o funil está restrito exatamente ao público que menos precisa de
ajuda. Quem vende no Mercado Livre sem ERP não consegue nem começar.

Somado a isso, o estoque hoje flui num sentido só: PubliAI → ML, no momento da publicação/UPDATE.
Não existe baixa quando ocorre uma venda (`sync-venda` grava `ml_vendas`/`ml_vendas_itens` e **não
toca** em `variacoes`), nem qualquer forma de somar estoque que não seja reimportar a planilha.

## 2. Objetivo

Permitir que uma organização **sem ERP** use o PubliAI de ponta a ponta:

1. **Cadastrar** um produto (família multi-variação) direto na UI, sem planilha.
2. **Dar entrada** de mercadoria, somando saldo e registrando custo.
3. Ter o estoque **baixado automaticamente** a cada venda paga e **propagado na hora** para os
   canais onde o produto está publicado.
4. Publicar normalmente pelo fluxo que já existe (Revisão → publicação → Publicados).

E, para **todas** as organizações (inclusive as de planilha), entregar a baixa por venda + ledger
auditável + push cross-canal — que é o `E6b` do roadmap, pré-requisito do multicanal.

## 3. Fora de escopo (decidido explicitamente)

| Item | Por quê |
|---|---|
| **Emissão de NF-e** | Discutido e descartado nesta sessão. É commodity (6 providers fazem igual), é passivo e não ativo (nota errada = multa do cliente, suporte contábil que o time não tem), e é manutenção fiscal perpétua (reforma tributária em transição — o próprio mercado vende "calculadora da reforma" como módulo à parte, e o motor da NFE.io é add-on de parceiro sem preço público). Não multiplica nada do que o PubliAI já construiu. Registrado com detalhe na seção 11. |
| **Importação do XML de compra do fornecedor** | Fase 2. Grava exatamente as mesmas linhas que a tela de entrada, então encaixa depois sem refazer nada. Antes de construir, validar que o cliente-alvo tem os XMLs em mãos. |
| **Multi-depósito / estoque por localização** | YAGNI. Um saldo por SKU por org. |
| **Reserva de estoque / estoque de segurança** | YAGNI. O ML já baixa por conta própria no momento da venda. |
| **Custo médio ponderado** | Decidido: último custo sobrescreve (D-9). O ledger guarda o histórico por entrada, então nada se perde e dá para evoluir depois. |
| **Emissão de NF-e de devolução / reposição automática em devolução** | Só notifica (D-7). Repor exige saber se a mercadoria voltou e em que estado — decisão do operador. |

## 4. Estado atual verificado (2026-07-28)

Fatos conferidos no código deste worktree. Onde o plano E6b divergir, **o código vence**.

### Modelo de dados

- `lotes` (`20260527123422_enums_lotes_storage.sql:49`): `status` (`lote_status` enum), `planilha_path`,
  `imagens_paths text[]`, contadores `total_familias`/`total_publicadas`/`total_erros`, `numero`
  (identity; numeração por org veio no E7). **Não existe coluna que distinga a origem do lote.**
- `familias` (`20260527125643_familias_variacoes.sql:10`): `lote_id uuid **not null**` →
  `lotes(id) on delete cascade`, e **`unique (lote_id, codigo_pai)`** (linha 63).
  NOT NULL sem default: `lote_id`, `user_id`, `codigo_pai`, `nome_pai`, `operacao`, `org_id`
  (`20260705165755_e7_org_id_not_null.sql:14`).
  Colunas relevantes já existentes: `descricao_pai`, `unidade`, `fornecedor`
  (`20260605132923_add_custo_fornecedor.sql:2`), `origem` (enum `origem_produto`: `nacional`/`importado`),
  `capa_storage_path`/`capa2_storage_path`/`capa3_storage_path`, `variacao_principal_codigo`.
- `variacoes` (mesma migration, linha ~82): NOT NULL sem default: `familia_id`, `user_id`, `codigo`,
  `preco`, `org_id`. Já tem `gtin`, `estoque integer not null default 0`, `custo numeric`,
  `peso_gramas`/`altura_cm`/`largura_cm`/`comprimento_cm`, `cor`/`cor_hex`/`cor_origem`, `imagem_path`.
- **Não existe** ledger de estoque (`estoque_movimentos` nunca foi criado).

### Acoplamento lote → família (a armadilha)

`lote_id` **não** é metadado incidental. É lido/exigido em:

| Local | Uso |
|---|---|
| `supabase/functions/process-familia/index.ts:52` | `if (!job.familia_id \|\| !job.lote_id) return 400` — hard gate da IA de atributos |
| `supabase/functions/publish-familia-ml/processar.ts` | `finalizarLote(job.lote_id)` chamado incondicionalmente após publicar |
| `supabase/functions/update-familia-ml/processar.ts` | idem |
| `supabase/functions/upload-imagens-lote/processar.ts:32` | busca família por `.eq('lote_id', loteId)` + match por nome de arquivo |
| `supabase/functions/_shared/lote/recontar.ts:12` | housekeeping por lote |
| `src/lib/queries.ts` (`fetchFamilias`, `fetchFamiliasResumo`) | `.eq('lote_id', loteId)` — alimenta a Revisão |
| `src/hooks/useLoteRealtime.ts:19` | `filter: lote_id=eq.${loteId}` |
| Rota `/revisao/:loteId` (`src/App.tsx:53`) | **não existe rota por família** |
| Trigger `update_lote_counters` | `where l.id = coalesce(new.lote_id, old.lote_id)` |

**Consequência:** tornar `lote_id` nullable custaria migration + revisar a unique (que fica furada,
porque Postgres trata NULL como distinto) + relaxar `process-familia` + tratar `finalizarLote(null)`
nos **dois workers que publicam anúncio real** + rota/tela nova por família + caminho novo de upload
de foto. Foi por isso que o desenho mudou para "sessão de cadastro = um lote" (D-1).

### O que já é reaproveitável de graça

- `src/lib/publicavel.ts` — `familiaPublicavel()` (linha 77) e `casadaNoMl()` (linha 13) são
  **funções puras sobre `Familia`/`Variacao`, sem referência a `lote_id`**.
- `src/lib/queries.ts:290-380` — mutations de edição por `id` (`updateVariacaoPreco`,
  `updateFamiliaTitulo`, `updateFamiliaDescricao`, `updateVariacaoCor`, `updateVariacaoGtin`,
  `updateVariacaoPrincipal`), todas lote-agnósticas.
- `supabase/functions/_shared/anuncios/pre-subir-fotos.ts` — lê `capa_storage_path`/`imagem_path`
  por `familia_id`/`variacao.id`, **sem tocar em lote**.
- `supabase/functions/sync-venda/index.ts:55-60` — `upsertVenda` devolve `{ novaPaga, itens }`;
  o bloco `if (novaPaga)` dispara exatamente 1× por pedido pago (já usado por Telegram + mensagem
  ao comprador). `ml_vendas_itens` já tem `codigo` (SKU) e `quantity`.
- Storage: bucket `imagens`, policies exigem `(storage.foldername(name))[1] = auth.uid()` — path
  `{user_id}/{lote_id}/{arquivo}`. Upload direto do browser funciona sem edge nova.
- Feature flag por org: `organizations.canais_habilitados text[]`
  (`20260715014055_menus_multicanal.sql:5`) + action `set_canais_org`
  (`supabase/functions/usuarios/index.ts:148-166`, trava `is_super_admin && !org_id`) + UI em
  `src/pages/Organizacoes.tsx:390`. Menu: `src/lib/menus.ts` (`MENU_KEYS`, `visibleMenus`, `PREFIX`)
  com espelho backend em `supabase/functions/usuarios/index.ts:6`.
- Notificação: `notificarCategoria` (`_shared/notificacoes/config.ts`) — ponto único que já
  entrega Telegram + sino in-app (ADR-0085).

### Mercado Livre

- Push de estoque: `available_quantity` em `_shared/ml/atualizar.ts` (padrão "só `available_quantity`,
  sem `price`" — preserva preço de venda). **Gotcha: o ML deleta variações omitidas** → todo push
  manda TODAS as variações do anúncio.
- Estoque zero: o ML pausa o anúncio sozinho; ao voltar saldo, volta a aparecer. Nenhuma ação nossa.
- `anuncios_externos.variacoes_externas` mapeia `sku → variation_id` por anúncio (essencial no split,
  ADR-0048: cada cor vive em exatamente 1 partição).

---

## 5. Decisões travadas

| # | Decisão | Racional |
|---|---|---|
| **D-1** | **Sessão de cadastro = um lote.** O cadastro manual cria um `lote` normal (marcado como manual) com N famílias e suas variações, e cai na **mesma tela de Revisão de sempre**. | Zero mudança em `process-familia`, nos dois workers de publicação, no realtime, no roteamento e na unique `(lote_id, codigo_pai)`. Nada do caminho que fatura é tocado. A alternativa (`lote_id` nullable) custa 6 frentes, duas delas em código que publica anúncio real. |
| **D-1.1** | **"Sessão" = o lote manual aberto da org.** O cadastro reusa o lote com `origem='manual'` e `status in ('importando','processando','revisao')`; se não houver, cria um novo. Ao anexar família, o lote volta para `status='processando'`. | Verificado: `talvezFinalizarLote` (`publish-familia-ml/processar.ts:44-52`) **não** compara contadores — recalcula do estado vivo (`publicando` → não mexe; senão `pronto` → `revisao`; senão `concluido`). Logo o ciclo se auto-corrige e nenhum worker precisa mudar. A regra evita os dois extremos: um lote por produto (polui a tela de Lotes) e um lote permanente (nunca fecha, e a Revisão vira lista infinita misturando produto novo com produto de 6 meses). Corresponde ao que o operador chama de "meus cadastros ainda não publicados". |
| **D-2** | `lotes.origem text not null default 'planilha'` com check `in ('planilha','manual')`. A tela de Lotes rotula. | 1 linha de migration, sem ambiguidade. Inferir por `planilha_path is null` funcionaria na maioria dos casos, mas quebra num lote que falhou antes de gravar o path. |
| **D-3** | Cadastro é **multi-variação desde a fase 1**: dados do PAI + tabela de linhas de variação. | Família = 1 anúncio, variação = 1 SKU é o modelo do PubliAI inteiro; split, user products e resolução de cor já assumem N. Fazer só produto simples obrigaria a refazer a tela. |
| **D-4** | **Guard LOUD de duplicata:** o cadastro rejeita `codigo_pai` que já exista na org (em qualquer lote), com mensagem "esse produto já existe — use Entrada de estoque". | A unique é `(lote_id, codigo_pai)`, então dois lotes diferentes aceitariam o mesmo produto e criariam duas linhas canônicas concorrentes. Erro explícito, nunca merge silencioso. |
| **D-5** | **Ledger `estoque_movimentos`** com idempotência por `(org_id, referencia_externa)` única. Motivos: `venda`, `entrada`, `ajuste_manual`, `estorno_venda`, `venda_sku_nao_encontrado`. | Herdado de D-E6b.2. Baixa nunca aplica 2× (webhook re-entregue, backfill, reconciliação) e todo movimento é auditável. |
| **D-6** | **Baixa na transição `novaPaga`, para todas as orgs, sem flag.** | Mesmo mecanismo, dois regimes de graça: para a org de planilha evita oversell **entre** importações e a próxima importação segue sobrescrevendo (D-E6b.1 intacto); para a org do módulo é a verdade permanente, porque ela nunca importa. Um caminho só para testar. |
| **D-7** | **Cancelamento repõe — mas só o que foi de fato baixado.** O estorno (`estorno_venda`, idempotente por referência própria) só roda quando existe movimento de `venda` para aquele `(canal, pedido, sku)`. **Devolução não é tocada** neste épico: nem repõe, nem notifica. | Fisicamente diferentes: cancelado antes do despacho = mercadoria nunca saiu; devolvido = precisa conferir o que voltou. A condicional é obrigatória porque a baixa só ocorre na transição `novaPaga`: pedido criado → nunca pago → cancelado (comum no ML) jamais gerou baixa, e estornar aí criaria **estoque fantasma**, propagado para todos os canais. **Inverte parcialmente D-E6b.7**, que não repunha em nenhum caso. |
| **D-16** | **`talvezFinalizarLote` passa a considerar famílias `pendente`/`processando`**: lote com trabalho em curso vira `processando`, não `concluido`. | Defeito **pré-existente** (`publish-familia-ml/processar.ts:44-52` olha só `publicando` e `pronto`): publicar as famílias prontas de um lote enquanto a IA ainda roda nas demais marcava o lote como concluído, e o trigger de transição só promove lote em `'processando'` — o lote ficava travado com família publicável dentro. O D-1.1 torna isso frequente, mas o bug já atinge o caminho de planilha hoje. Correção na função compartilhada, não `if` no caminho novo. |
| **D-17** | **Toda escrita de estoque exige referência de idempotência**, inclusive a entrada manual (`registrar_entrada(..., p_ref)` obrigatório; o formulário gera um uuid por submissão). | Sem isso, duplo clique ou retry de rede soma o saldo duas vezes e sobrescreve o custo duas vezes — e custo alimenta markup e preço (ADR-0055). Caminho financeiro não aceita "provavelmente só roda uma vez". |
| **D-8** | **Venda maior que o saldo:** baixa até zero (`greatest(0, estoque - qtd)`), o ledger registra a quantidade **real** vendida, e dispara notificação via `notificarCategoria`. A venda **nunca** falha por causa de estoque. | O saldo negativo obrigaria todo o resto (publicabilidade, push, ML) a aguentar negativo — e o ML não aceita quantidade negativa. Mas venda sem saldo é exatamente o evento que o operador precisa saber. |
| **D-9** | **Entrada sobrescreve `variacoes.custo`** com o custo unitário informado (último custo) — **só quando o custo é informado e maior que zero**. Custo ausente → entrada registra a quantidade e **não toca** em `custo`. Custo zero ou negativo → **rejeita a entrada** com erro explícito, nunca trata como ausente. | É como o operador pensa e é o que a planilha já faz na importação. Zero estado extra; o histórico por entrada fica em `estoque_movimentos.custo_unitario`, que é a trilha de auditoria. `variacoes.custo` alimenta markup e preço (ADR-0055): é caminho financeiro, então valor inválido falha LOUD em vez de virar default silencioso — mesma classe do incidente de ORIGEM em `ingest-lote`. **Efeito aceito e intencional:** dar entrada com custo novo num produto já publicado muda o markup exibido em Revisão/Publicados/Financeiro; o ledger explica a mudança. |
| **D-10** | **Propagação por valor absoluto**, fila serial `estoque-{orgId}` (parallelism 1). Entrada e estorno propagam **na hora, para TODOS os canais publicados, inclusive o ML**. Baixa por venda propaga para todos os canais **exceto o de origem** (que já se auto-decrementou). **Ajuste manual NÃO propaga na hora** — um trigger Postgres não consegue enfileirar no QStash; a reconciliação diária cobre em ≤24h. | Push absoluto é idempotente e auto-corretivo; a fila serial garante ordem. **Amplia D-E6b.5**, que excluía sempre o canal de origem — regra que só valia para venda. O corte do ajuste manual é honesto: hoje não existe nem escritor de `variacoes.estoque` no browser, então o trigger nasce como rede de auditoria, não como feature. |
| **D-11** | **Estoque zero: nenhuma ação.** Push manda `available_quantity: 0` e o ML pausa sozinho; ao entrar mercadoria, o push sobe o saldo e o anúncio volta. | Comportamento nativo do ML. Pausar explicitamente duplicaria a lógica e criaria a pergunta "quem reativa, e quando?". |
| **D-12** | **Reconciliação diária** = re-push absoluto, restrito a (a) produtos com movimento nas últimas 24h e (b) produtos publicados em ≥2 canais. Não varre o catálogo inteiro. | Rede de segurança contra webhook perdido / push que falhou definitivamente, sem gastar centenas de chamadas por dia em produto parado. Aperta D-E6b.8, que re-empurrava todo produto multi-canal. |
| **D-15** | **Toda escrita de estoque passa por edge com `service_role`** — as RPCs `baixar_estoque`/`estornar_estoque`/`registrar_entrada` são revogadas de `authenticated`, e a edge repassa o `user_id` do chamador em `criado_por`. O browser nunca chama a RPC direto. | Sem isso, o trigger de `ajuste_manual` (que dispara quando `auth.uid()` não é nulo) registraria um segundo movimento para a mesma entrada. Com `service_role`, `auth.uid()` é nulo e existe exatamente 1 movimento por operação. É também onde o gate do módulo (D-13) é aplicado de fato. |
| **D-13** | **Módulo opt-in por org:** `organizations.modulos_habilitados text[]` + action `set_modulos_org` na edge `usuarios` (mesma trava `is_super_admin && !org_id`) + checkbox em `/admin`. O gate vai **no menu E na edge** de cadastro/entrada. | Espelha exatamente `canais_habilitados`. Esconder o menu é navegação, **não** fronteira de segurança (ADR-0047) — sem o gate na edge, qualquer token autenticado chamaria o endpoint. Permite cobrar pelo módulo sem construir billing (ADR-0028 segue stub). |
| **D-14** | A **baixa/ledger/push (D-5..D-12) não é gated** pelo módulo; só **cadastro e entrada (D-1..D-4, D-9)** são. | A baixa serve as duas populações (D-6). Gatear criaria um `if` no gancho `novaPaga` e duas realidades para manter. |

---

## 6. Arquitetura

Dois blocos independentes, entregáveis em ordem.

### Bloco A — Estoque (serve todas as orgs)

```
venda paga (sync-venda, novaPaga)
  └─ registrarBaixaVenda(admin, {orgId, canal, orderId, itens})
       └─ RPC baixar_estoque(org, codigo, qtd, canal, ref)   [atômica, idempotente]
            ├─ insert em estoque_movimentos (unique ref → duplicata = no-op)
            ├─ resolve variação canônica: família mais recente do (org_id, codigo)
            └─ update variacoes.estoque = greatest(0, estoque - qtd)
       └─ enfileirarSincronizacaoEstoque({org_id, codigo_pai, canal_origem})
            └─ fila serial estoque-{orgId}
                 └─ worker sincronizar-estoque
                      └─ push ABSOLUTO por anúncio publicado (≠ canal_origem)
                           └─ conn.atualizarEstoque(ctx, itemExternoId, estoques, variacoesExternas)

entrada de mercadoria / ajuste manual
  └─ RPC registrar_entrada(org, codigo, qtd, custo, doc, obs)
       ├─ insert em estoque_movimentos (motivo 'entrada')
       ├─ update variacoes.estoque = estoque + qtd
       └─ update variacoes.custo = custo            [D-9, só se custo informado]
  └─ enfileirarSincronizacaoEstoque({..., canal_origem: null})   [null = TODOS os canais, D-10]

pedido cancelado (sync-venda / sync-devolucao)
  └─ cancelado antes do despacho → movimento 'estorno_venda' (repõe, D-7)
  └─ devolvido / já despachado   → notificarCategoria (só avisa)

diário (QStash)
  └─ reconciliar-estoque → re-push absoluto de todo produto publicado
```

**Falha de estoque nunca falha a venda** — try/catch + log no gancho, mesmo padrão da mensagem ao
comprador. Falha de um canal nunca afeta outro.

### Bloco B — Cadastro manual + Entrada (gated pelo módulo)

```
tela Estoque (menu novo)
  ├─ [Cadastrar produto]  → sessão de cadastro
  │    ├─ dados do PAI: codigo_pai, nome_pai, descricao_pai, unidade, fornecedor, origem
  │    ├─ tabela de variações: codigo, gtin, preco, custo, estoque inicial,
  │    │                       peso_gramas, altura/largura/comprimento_cm, foto
  │    ├─ fotos comuns da família: capa, capa2, capa3
  │    └─ [Salvar] → edge cadastrar-produto
  │         ├─ valida (D-4: codigo_pai duplicado na org = 400 LOUD)
  │         ├─ cria/reusa lote da sessão (origem='manual', status='processando')
  │         ├─ insere familias (operacao='CREATE') + variacoes (estoque = 0)
  │         ├─ estoque inicial > 0 → registrar_entrada(...)   [caminho único, D-15]
  │         └─ enfileirarFamilia({familia_id, lote_id})   → IA de atributos, INTACTA
  │    → redireciona para /revisao/{loteId}   ← fluxo existente daqui pra frente
  │
  ├─ lista de produtos com saldo (codigo, nome, cor, estoque, custo, canais publicados)
  ├─ [Dar entrada] → SKU + quantidade + custo unitário + documento + observação
  └─ histórico de movimentos por SKU (data, motivo, qtd, canal, estoque resultante)
```

**Fotos:** upload direto do browser para o bucket `imagens` no path `{user_id}/{lote_id}/{arquivo}`
(as policies de storage já cobrem isso), seguido de update de `variacoes.imagem_path` /
`familias.capa_storage_path`. Não reusa `upload-imagens-lote` (que casa por convenção de nome, o que
não faz sentido num formulário onde o operador já escolheu o arquivo para aquela variação
específica). `pre-subir-fotos.ts` lê esses campos sem saber de onde vieram.

**Publicação:** nenhuma mudança. `familiaPublicavel()` já exige, no CREATE, `categoria_ml_id` + cor +
foto + preço + estoque > 0 por variação incluída — que é exatamente o contrato que o cadastro precisa
cumprir. Split (ADR-0048/0078) e user products (ADR-0088) funcionam sem saber que o produto veio de
formulário.

---

## 7. Modelo de dados

### Migration 1 — ledger + operações atômicas

```sql
create table public.estoque_movimentos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  codigo             text not null,             -- SKU (variacoes.codigo)
  codigo_pai         text not null default '',  -- preenchido ao resolver a variação
  quantidade         integer not null,          -- negativo = baixa, positivo = entrada
  motivo             text not null,             -- venda | entrada | ajuste_manual
                                                -- | estorno_venda | venda_sku_nao_encontrado
  canal_origem       text,
  referencia_externa text,                      -- '{canal}:{order_id}:{codigo}' — idempotência
  custo_unitario     numeric(12,2),             -- só em 'entrada'
  documento          text,                      -- NF do fornecedor / observação curta
  estoque_resultante integer,
  criado_por         uuid references auth.users(id),
  criado_em          timestamptz not null default now()
);

create unique index estoque_movimentos_ref_uniq
  on public.estoque_movimentos (org_id, referencia_externa)
  where referencia_externa is not null;
create index estoque_movimentos_org_pai_idx
  on public.estoque_movimentos (org_id, codigo_pai, criado_em desc);
create index estoque_movimentos_org_codigo_idx
  on public.estoque_movimentos (org_id, codigo, criado_em desc);

alter table public.estoque_movimentos enable row level security;
create policy "estoque_movimentos: select org" on public.estoque_movimentos
  for select to authenticated using (org_id = (select public.current_org_id()));
-- escrita: só service_role, via as RPCs abaixo.
```

Funções `security definer` (`set search_path = ''`), todas revogadas de `public`/`anon`/`authenticated`:

- `baixar_estoque(p_org, p_codigo, p_qtd, p_canal, p_ref) returns integer` — insere movimento
  (duplicata → `null`, sem tocar estoque), resolve a variação canônica (família mais recente do
  `(org_id, codigo)`, mesma âncora do ADR-0025), aplica `greatest(0, estoque - qtd)`, devolve o saldo.
  SKU não encontrado → movimento vira `venda_sku_nao_encontrado` e devolve `null`.
- `estornar_estoque(p_org, p_codigo, p_qtd, p_canal, p_ref)` — espelho de `baixar_estoque` com
  `motivo = 'estorno_venda'` e referência própria (`estorno:{canal}:{order_id}:{codigo}`), para ser
  idempotente independentemente da baixa.
- `registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, p_obs, p_criado_por, p_ref) returns integer` —
  movimento `entrada`, soma no saldo canônico e, se `p_custo` não for nulo e for > 0, sobrescreve
  `variacoes.custo` (D-9). `p_ref` é **obrigatório** (D-17): duplicata devolve `null` sem tocar o saldo.
  Custo ≤ 0 levanta exceção — nunca vira default silencioso.

**Ajuste manual:** trigger `after update of estoque on variacoes` quando `auth.uid() is not null`
(edição humana, não worker) insere movimento `ajuste_manual` com `quantidade = new.estoque - old.estoque`
e `referencia_externa = null`.

### Migration 2 — origem do lote + flag de módulo

```sql
-- O default 'planilha' backfilla TODO lote histórico como planilha — correto e
-- intencional: até esta migration, planilha era a única origem possível.
alter table public.lotes
  add column origem text not null default 'planilha'
  check (origem in ('planilha','manual'));

-- Default '{}' = nenhum módulo. Habilitação é sempre ato explícito do super-admin.
alter table public.organizations
  add column modulos_habilitados text[] not null default '{}';
```

**RLS verificada:** `lotes` já usa `org_id = (select public.current_org_id())` desde o E7
(`20260705165828_e7_rls_org.sql:13-21`, grupo A com CRUD por membro da org) — o lote manual nasce
visível para toda a organização, coerente com a "operação compartilhada" do ADR-0047. Nenhuma
policy nova é necessária para `lotes`.

---

## 8. Contrato de canal

`_shared/canais/contrato.ts` ganha:

```ts
export interface EstoquePorSku { sku: string; estoque: number }
export interface Capabilities { /* … */ atualizarEstoque: boolean }

/** Push de estoque (valores ABSOLUTOS). Não lança: erros viram ResultadoCanal.erro. */
atualizarEstoque(
  ctx: ContextoCanal,
  itemExternoId: string,
  estoques: EstoquePorSku[],
  variacoesExternas: Record<string, string>,   // sku -> variation_id no canal
): Promise<ResultadoCanal<void>>
```

ML implementa reusando `_shared/ml/atualizar.ts`: busca o item, monta **todas** as variações
(gotcha: o ML deleta as omitidas), troca `available_quantity` só nas que o mapa cobre, **sem** `price`.
O conector `fake` implementa gravando as chamadas — é o que prova a infra cross-canal enquanto só
existe o ML. Canal sem suporte declara `atualizarEstoque: false` e o worker pula com log.

---

## 9. Superfície de UI

| Tela | Mudança |
|---|---|
| **Estoque** (menu novo, gated) | Lista de produtos com saldo · botão Cadastrar produto · botão Dar entrada · histórico de movimentos por SKU |
| **Cadastro de produto** (dentro de Estoque) | Formulário PAI + tabela de variações + upload de fotos → redireciona para `/revisao/{loteId}` |
| **Lotes** | Rótulo distinguindo lote manual de lote de planilha (`lotes.origem`) |
| **Publicados** (expandir da linha) | Seção "Movimentos de estoque" — últimos 20 movimentos do produto |
| **`/admin` → Organizações** | Checkbox de módulos por org (espelha o de canais) |
| **`src/lib/menus.ts`** | Nova key `estoque` em `MENU_KEYS` + espelho em `usuarios/index.ts:6` + entrada em `PREFIX`; visível só com o módulo habilitado |

---

## 10. Riscos e armadilhas conhecidas

| Risco | Mitigação |
|---|---|
| Dois lotes com o mesmo `codigo_pai` na mesma org (a unique é por lote) criam duas linhas canônicas concorrentes | Guard LOUD no cadastro (D-4). A âncora "família mais recente" resolve leitura, mas duplicata é erro, não estado válido |
| Push omitindo variações **deleta** as variações no ML | O conector monta sempre TODAS as variações do item; teste RED cobre exatamente isso |
| Duas vendas seguidas aplicando estoque velho por cima do novo | Fila serial `estoque-{orgId}` com parallelism 1 + push absoluto (repetir é seguro) |
| Webhook do ML re-entregue duplicando a baixa | Dupla camada: `ml_webhook_eventos` unique `(topic, resource)` + unique `(org_id, referencia_externa)` no ledger |
| Falha de estoque derrubando o `sync-venda` | try/catch + log no gancho. A venda é sagrada |
| Menu escondido tratado como segurança | Gate também na edge de cadastro/entrada (D-13). ADR-0047 é explícito: `allowed_menus` é navegação |
| Lote manual poluindo contadores/housekeeping por lote | `lotes.origem` permite filtrar; os contadores funcionam normalmente porque o lote é real |
| Split (ADR-0048): push indo para a partição errada | Push por SKU usa `anuncios_externos.variacoes_externas`, que já diz qual anúncio contém cada SKU |
| Org com planilha começando a cadastrar à mão e criando duas fontes de verdade | Módulo é opt-in por org (D-13); a decisão de habilitar nas duas é consciente do super-admin |

---

## 11. Por que a NF-e ficou de fora (registro da decisão)

Levantado nesta sessão, com pesquisa nos seis principais providers brasileiros:

- **É commodity.** Focus NFe, PlugNotas, NFE.io, Nuvem Fiscal, eNotas e WebmaniaBR entregam a mesma
  função. Nenhum cliente escolhe o PubliAI por emitir nota.
- **"O provider calcula tudo" é majoritariamente ilusão.** Só a NFE.io tem motor fiscal real
  documentado (grupo `taxDetermination`, que devolve CFOP/CST/CSOSN/base/alíquota/DIFAL) — e ele é
  **add-on de parceiro, sem preço público**, fora dos planos de emissão (Base R$ 190/mês, 250 notas,
  CNPJ ilimitado). Os outros cinco são camada de transmissão: você manda os campos já calculados.
  Na Focus, o preenchimento automático é produto pago à parte (R$ 59,90 / 20 mil acionamentos) e
  ainda exige configurar as regras.
- **É passivo, não ativo.** Nota rejeitada é problema fiscal do cliente que chega como chamado de
  suporte. "Por que rejeitou com NCM inválido?" é atendimento contábil.
- **É manutenção perpétua.** A reforma tributária está em transição e o mercado trata o novo cálculo
  como módulo separado (a "Calculadora da Reforma Tributária" do PlugNotas é o sinal mais claro).
- **Custo de oportunidade.** O E5 Shopee espera só o conector — toda a orquestração do E6 já está
  pronta e parada. Segundo canal multiplica IA de atributos, split, user products e preço competitivo.
  NF-e não multiplica nada disso.

Dados técnicos levantados, caso a decisão seja revisitada: a NFE.io permite criar empresa emitente
por API (`POST /v2/companies`, com `TaxRegime: SimplesNacional | LucroPresumido`) e subir certificado
A1 via `POST /v2/companies/{id}/certificates` (multipart, .pfx + senha), tem SDK oficial em TypeScript
(`nfe/client-nodejs`, Node 22+) e cancelamento/CC-e por API. A Nuvem Fiscal é a mais forte em
multi-empresa (`PUT /empresas/{cnpj}/certificado`, sandbox real gratuito) mas não calcula nada.
Também vale registrar: no **Full**, o ML emite a nota pelo vendedor via Faturador — se o PubliAI
emitisse também, sairia nota duplicada.

---

## 12. Critério de saída

**Bloco A (estoque):**

1. Venda paga no ML dá baixa atômica e idempotente no estoque canônico; o ledger prova 1 movimento
   por venda+item e re-entrega não duplica.
2. Push absoluto para os demais canais em ≤1 job de fila (provado com o conector fake; ordem
   garantida pela fila serial por org).
3. Entrada e ajuste manual propagam na hora, para todos os canais publicados, inclusive o ML.
4. Cancelamento antes do despacho repõe; devolução notifica sem repor.
5. Venda sem saldo baixa até zero, registra a quantidade real no ledger e notifica.
6. Falha de estoque nunca falha a venda; falha de um canal nunca afeta outro.
7. `estoque_movimentos` entra em `scripts/verificar-isolamento-tenant.ts` e a suite re-passa.

**Bloco B (cadastro + entrada):**

8. Cadastrar produto multi-variação com fotos pela UI → família enriquecida pela IA → aparece na
   Revisão → publica no ML pelo fluxo existente, sem nenhuma mudança no caminho de publicação.
9. `codigo_pai` duplicado na org é rejeitado com erro explícito.
10. Menu Estoque só aparece com o módulo habilitado, **e** a edge recusa chamada de org sem o módulo.
11. Org de planilha segue funcionando byte-a-byte como hoje (nenhum número de nenhuma tela muda).

**Gate final:** `pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build` verdes;
validação com browser em runtime real; docs (`modelo-de-dados.md`, `edge-functions.md`,
`arquitetura.md`, `glossario.md`, `project-status.md`, `TASKS.md`) e `obsidian-vault/` atualizados
no mesmo commit da entrega; Graphify re-ingerido.

---

## 13. ADR

Escrever **ADR-0054 — Estoque único, cadastro manual e entrada de mercadoria** antes de codar,
cobrindo D-1..D-17 (e os cortes declarados: ajuste manual não propaga na hora; devolução não é
tocada; o guard D-4 não é atômico), com as alternativas rejeitadas registradas: `lote_id` nullable (custo verificado
em 6 frentes, duas em código de publicação real), delta em vez de push absoluto (não idempotente),
tabela `produtos` separada (duplica a fonte de verdade), custo médio ponderado (cálculo num caminho
financeiro sem demanda), e emissão de NF-e (seção 11).
