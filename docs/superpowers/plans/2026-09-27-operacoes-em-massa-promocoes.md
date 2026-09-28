# Operações em massa — aderir/sair de promoção (I5 + Promoções V2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin da org seleciona anúncios num detalhe de campanha DEAL/SMART da Central de Promoções, revisa um preview e executa uma **operação em massa** que adere ou tira os anúncios da promoção no ML, acompanhando o resultado por item numa aba "Operações", com **Reverter**.

**Architecture:** Duas tabelas novas (`operacoes_massa`, `operacoes_massa_itens`) guardam pedido e resultado por item. Uma edge nova `operacoes-massa` recebe o pedido do usuário (valida, grava, enfileira) e, como worker QStash, executa item a item com orçamento de tempo e continuação — mesmo padrão do `sincronizar-promocoes`. Lógica de decisão e cliente ML de escrita são módulos puros em `_shared/operacoes/`, testados com vitest e fakes. O front ganha seleção + preview no `PromocaoDetalhe`, aba Operações em `Promocoes`, e um aviso na Revisão.

**Tech Stack:** Supabase (Postgres + RLS, Edge Functions Deno), QStash, React + Vite + React Query + shadcn/ui + sonner, vitest, pgTAP-style SQL tests via psql.

**Spec:** `docs/decisions/0174-operacoes-em-massa-promocoes-v2.md` (decisões 1-10 + "Resultado parcial do spike") e `docs/reference/glossario.md` seções "Promoções (ADR-0170)" e "Operações em massa".

## Global Constraints

- Tipos suportados: `DEAL` e `SMART`. Qualquer outro `promotion_type` → recusado (400) na criação.
- Ações: `aderir` e `sair`. Reverter = nova operação com a ação inversa e `origem_id` apontando a original.
- Só executa: `isAdmin || support.scope === 'full'` (padrão `supabase/functions/atualizar-status-publicado/index.ts:15-24`). Membro comum vê tudo e monta preview; botão Executar/Reverter só para admin.
- Módulo: `exigirModulo(admin, orgId, 'promocoes')` (`_shared/produto/modulo.ts:8-16`) em todos os caminhos.
- Escrita ML (formato provado no spike, ADR-0174):
  - Aderir DEAL: `POST /seller-promotions/items/{id}?app_version=v2` body `{promotion_id, promotion_type:'DEAL', deal_price}` → 201.
  - Aderir SMART: mesmo endpoint, body `{promotion_id, promotion_type:'SMART', offer_id: <offer_id do convite, "CANDIDATE-...">}` → 201 com `offer_id` NOVO (`"OFFER-..."`) no corpo — **gravar**.
  - Sair DEAL: `DELETE /seller-promotions/items/{id}?promotion_type=DEAL&promotion_id={pid}&app_version=v2`.
  - Sair SMART: `DELETE ...?promotion_type=SMART&promotion_id={pid}&offer_id={OFFER-...}&app_version=v2` — o `offer_id` vem da leitura fresca da visão da campanha (item participando traz o `OFFER-...`).
- Leitura fresca = **visão da campanha** `GET /seller-promotions/promotions/{pid}/items?promotion_type={T}&item_id={id}&app_version=v2` (a visão por item atrasa). Retry em 500 (o ML devolve 500 intermitente): até 3 tentativas, 1 s entre elas.
- 200 do DELETE ≠ saiu: item vira `saida_solicitada`; conferência agendada (QStash `delay` 300 s) até a visão da campanha não mostrar mais o item como participando → `aplicado`. Máximo 12 conferências (~1 h); depois fica `saida_solicitada` com mensagem "O ML ainda não confirmou a saída".
- Par User Product/catálogo: aderir recusado (`bloqueado`) quando o item tem `item_relations` para outro item com `catalog_listing: true` e ele próprio `catalog_listing: false` — mensagem "Anúncio sincronizado com o de catálogo {id}: inscreva o de catálogo".
- Preço DEAL: default `preco_sugerido`; editável dentro de `[preco_min, preco_max]`; fora da faixa → recusado na criação (400).
- Trava financeira: item cujo semáforo no preço escolhido é `vermelho` ou `indisponivel` só entra com `confirmado_risco = true` (checkbox separado no preview); criação sem confirmação → 400.
- Nenhum preço, nome de coluna ou status inventado: status de item do ML são `candidate` (convidado), `started`/`pending` (participando) — `ehParticipando` em `_shared/promocoes/projecao.ts`.
- Textos de UI em pt-BR, termos do glossário: "Operação em massa", "Convidado", "Participando", "Reverter", "Líquido", "Markup". Nunca "lote" para operação, nunca "candidato", nunca "margem %".
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check`.
- Tokens nunca logados. Idempotência: reprocessar a mesma mensagem QStash não pode escrever duas vezes no ML.

## Review Focus

1. **Retry do QStash depois de um POST que deu certo mas não foi gravado** (edge morreu entre o POST e o update): a próxima execução lê a visão da campanha, vê o item participando → `ja_estava` (sucesso), sem novo POST. Teste em Task 3.
2. **Reverter de uma operação com itens mistos** (aplicado, erro, mudou, ja_estava): só `aplicado` e `ja_estava` entram; itens que o ML não aceita mais no inverso viram `mudou` na execução, não erro genérico. Teste em Task 5 (validação) e Task 7 (montagem do preview).
3. **Preço editado fora da faixa DEAL ou com vírgula** ("18,50"): o input aceita vírgula, normaliza para número, e a criação recusa fora de `[min,max]`. Teste em Task 6 e Task 5.
4. **Duas operações simultâneas no mesmo item** (dois cliques em Executar): índice único parcial impede o mesmo `ml_item_id` em duas operações com item `pendente` na mesma promoção; a segunda criação recebe 409. Teste SQL em Task 1 e Task 5.
5. **Token perto de vencer / conexão sem scope de escrita** (403 do ML): 401/403 é da conta inteira → o item e todos os pendentes restantes viram `erro` com "Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais", sem martelar o ML. Teste em Task 4.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_operacoes_massa.sql` | Tabelas, índices, RLS, grants |
| `supabase/tests/operacoes_massa.sql` | Isolamento por org, escrita só service role, índice anti-duplicidade |
| `supabase/functions/_shared/operacoes/tipos.ts` | Tipos compartilhados do motor |
| `supabase/functions/_shared/operacoes/decidir.ts` | Puro: decide ação por item a partir da leitura fresca |
| `supabase/functions/_shared/operacoes/ml.ts` | Cliente ML de escrita/leitura fresca (fetch injetável) |
| `supabase/functions/_shared/operacoes/executar.ts` | Laço de execução com orçamento, continuação e conferência (deps injetadas) |
| `supabase/functions/_shared/operacoes/validar.ts` | Puro: valida pedido de criação contra `ml_promocao_itens` |
| `supabase/functions/_shared/operacoes/deps.ts` | Deps reais (Supabase + QStash + ML) |
| `supabase/functions/operacoes-massa/index.ts` | Edge: caminho usuário (criar) + QStash (executar/conferir) |
| `src/lib/operacoes.ts` | Tipos front, semáforo no preço, preview, rótulos |
| `src/hooks/useOperacoes.ts` | React Query: lista, itens, criar |
| `src/components/promocoes/barra-selecao.tsx` | Barra "Aderir N / Sair N" |
| `src/components/promocoes/preview-operacao.tsx` | Sheet de preview + confirmação + Executar |
| `src/components/promocoes/lista-operacoes.tsx` | Aba Operações: lista, detalhe por item, Reverter |
| `src/pages/PromocaoDetalhe.tsx` | Checkboxes + barra + preview |
| `src/pages/Promocoes.tsx` | Aba "Operações" |
| `src/pages/Revisao.tsx` | Aviso "participando de promoção" no diálogo de publicar |

---

### Task 1: Migration — tabelas do motor com RLS

**Model:** opus (migration + RLS).

**Files:**
- Create: `supabase/migrations/<gerado por supabase migration new operacoes_massa>.sql`
- Create: `supabase/tests/operacoes_massa.sql`

**Interfaces:**
- Produces: tabelas `public.operacoes_massa` e `public.operacoes_massa_itens` com as colunas abaixo — nomes usados por todas as tasks seguintes.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new operacoes_massa`

Conteúdo:

```sql
-- ADR-0174 — motor de operações em massa (primeira operação: aderir/sair de promoção DEAL/SMART).
create table public.operacoes_massa (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  acao          text not null check (acao in ('aderir','sair')),
  promocao_id   text not null,
  promocao_tipo text not null check (promocao_tipo in ('DEAL','SMART')),
  promocao_nome text,
  origem_id     uuid references public.operacoes_massa(id) on delete set null, -- Reverter
  status        text not null default 'executando' check (status in ('executando','concluida')),
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  concluido_em  timestamptz
);
create index operacoes_massa_org_criado on public.operacoes_massa (org_id, criado_em desc);

create table public.operacoes_massa_itens (
  operacao_id       uuid not null references public.operacoes_massa(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  promocao_id       text not null,
  ml_item_id        text not null,
  titulo            text,
  preco             numeric,               -- DEAL: deal_price pedido; SMART: preço da oferta (informativo)
  semaforo          text check (semaforo in ('verde','amarelo','vermelho','indisponivel')),
  confirmado_risco  boolean not null default false,
  offer_id          text,                  -- SMART: OFFER-... devolvido pelo POST (usado pelo Reverter)
  status            text not null default 'pendente'
                    check (status in ('pendente','aplicado','ja_estava','mudou','bloqueado','erro','saida_solicitada')),
  mensagem          text,
  conferencias      integer not null default 0,
  atualizado_em     timestamptz not null default now(),
  primary key (operacao_id, ml_item_id)
);
create index operacoes_massa_itens_org on public.operacoes_massa_itens (org_id);
-- Anti-duplicidade: o mesmo anúncio não fica pendente em duas operações da mesma promoção.
create unique index operacoes_massa_itens_pendente_unico
  on public.operacoes_massa_itens (org_id, promocao_id, ml_item_id) where status = 'pendente';

alter table public.operacoes_massa enable row level security;
alter table public.operacoes_massa_itens enable row level security;

-- Leitura para membros da org; escrita só pela edge (service role, que ignora RLS).
create policy operacoes_massa_select on public.operacoes_massa
  for select to authenticated using (org_id = public.current_org_id());
create policy operacoes_massa_itens_select on public.operacoes_massa_itens
  for select to authenticated using (org_id = public.current_org_id());

revoke all on public.operacoes_massa, public.operacoes_massa_itens from anon, authenticated;
grant select on public.operacoes_massa, public.operacoes_massa_itens to authenticated;
grant all on public.operacoes_massa, public.operacoes_massa_itens to service_role;
```

Antes de gravar, confirmar que `public.current_org_id()` existe (`grep -n "function public.current_org_id" supabase/migrations/*.sql`) e copiar o padrão de policy de uma tabela org-scoped recente (ex.: `ml_promocoes` em `20260924184220_central_promocoes.sql`) — se ela usar outra forma (ex.: `(select public.current_org_id())`), usar a mesma.

- [ ] **Step 2: Escrever o teste SQL**

`supabase/tests/operacoes_massa.sql` — seguir o cabeçalho e o estilo de `supabase/tests/support_access.sql` (begin; fixtures; asserts com `do $$ ... raise exception ... $$`; rollback). Casos:
1. Duas orgs, uma operação + 1 item em cada. Como `authenticated` com JWT do membro da org A (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uid A>"}'` — copiar como `support_access.sql` simula usuário), `select count(*) from operacoes_massa` = 1 e `from operacoes_massa_itens` = 1.
2. Como `authenticated`, `insert into operacoes_massa ...` → falha com `42501`.
3. Como superusuário: inserir 2º item `pendente` com mesmo `(org_id, promocao_id, ml_item_id)` em outra operação → falha com `23505`; com o primeiro já `aplicado`, o insert passa.

- [ ] **Step 3: Aplicar local e rodar o teste**

Run (Supabase local rodando): `supabase db reset` — se o reset estiver quebrado (ver memória `reference_worktree_guard_scripts_e2e_local`), aplicar o arquivo via `docker exec -i supabase_db_<ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<arquivo>.sql`.
Depois: `docker exec -i supabase_db_<ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/operacoes_massa.sql`
Expected: termina sem erro (`ROLLBACK`).

- [ ] **Step 4: `npm run db:check`** — Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_operacoes_massa.sql supabase/tests/operacoes_massa.sql
git commit -m "feat(operacoes): tabelas do motor de operações em massa com RLS (ADR-0174)"
```

---

### Task 2: Tipos e decisão pura por item

**Model:** opus (marketplace).

**Files:**
- Create: `supabase/functions/_shared/operacoes/tipos.ts`
- Create: `supabase/functions/_shared/operacoes/decidir.ts`
- Test: `supabase/functions/_shared/operacoes/__tests__/decidir.test.ts`

**Interfaces:**
- Consumes: `ehParticipando(status)` de `_shared/promocoes/projecao.ts`.
- Produces:

```ts
// tipos.ts
export type Acao = 'aderir' | 'sair';
export type TipoPromocao = 'DEAL' | 'SMART';
export type StatusItem = 'pendente' | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';
/** Leitura fresca da visão da campanha para UM item; null = o item não aparece na campanha. */
export interface ItemNaCampanha {
  status: string;                 // candidate | started | pending | ...
  preco_min: number | null; preco_max: number | null;
  offer_id: string | null;        // CANDIDATE-... (convidado SMART) ou OFFER-... (participando SMART)
}
export interface Relacoes { catalog_listing: boolean; relacionados: { id: string; catalog_listing: boolean }[] }
export interface PedidoItem { ml_item_id: string; preco: number | null }
export type Decisao =
  | { tipo: 'post'; body: Record<string, unknown> }
  | { tipo: 'delete'; query: string }
  | { tipo: 'fim'; status: Exclude<StatusItem, 'pendente'>; mensagem: string | null };
```

```ts
// decidir.ts
export function decidir(
  acao: Acao, tipo: TipoPromocao, promocaoId: string, pedido: PedidoItem,
  fresco: ItemNaCampanha | null, relacoes: Relacoes | null,
): Decisao;
```

Regras de `decidir` (cada uma vira um teste):
- aderir, `fresco` participando (`ehParticipando`) → `fim ja_estava`, mensagem null.
- aderir, `fresco` null ou status ≠ `candidate` → `fim mudou`, "O anúncio não é mais convidado nesta promoção".
- aderir, `relacoes` com `catalog_listing:false` e algum relacionado `catalog_listing:true` → `fim bloqueado`, `Anúncio sincronizado com o de catálogo ${id}: inscreva o de catálogo`.
- aderir DEAL, `pedido.preco` null ou fora de `[preco_min, preco_max]` do fresco (quando ambos não-null) → `fim mudou`, `A faixa de preço mudou: agora ${min} a ${max}` (formatar com 2 casas e vírgula: `18,99`).
- aderir DEAL ok → `post` com `{promotion_id, promotion_type:'DEAL', deal_price: pedido.preco}`.
- aderir SMART sem `fresco.offer_id` → `fim erro`, "O ML não informou a oferta deste convite".
- aderir SMART ok → `post` com `{promotion_id, promotion_type:'SMART', offer_id: fresco.offer_id}`.
- sair, `fresco` null ou não participando → `fim ja_estava` (já está fora).
- sair DEAL participando → `delete` com `promotion_type=DEAL&promotion_id=${pid}&app_version=v2`.
- sair SMART participando sem `offer_id` → `fim erro`, "O ML não informou a oferta deste anúncio".
- sair SMART participando → `delete` com `promotion_type=SMART&promotion_id=${pid}&offer_id=${encodeURIComponent(offer)}&app_version=v2`.

- [ ] **Step 1: Escrever os testes** — um `it` por regra acima, com fixtures mínimas. Exemplo:

```ts
import { describe, expect, it } from 'vitest';
import { decidir } from '../decidir.ts';

const conv = { status: 'candidate', preco_min: 7, preco_max: 18.99, offer_id: null };
describe('decidir — aderir DEAL', () => {
  it('posta deal_price dentro da faixa', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', { ml_item_id: 'MLB1', preco: 18.99 }, conv, null))
      .toEqual({ tipo: 'post', body: { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 18.99 } });
  });
  it('faixa mudou → mudou', () => {
    const d = decidir('aderir', 'DEAL', 'P-1', { ml_item_id: 'MLB1', preco: 19.5 }, conv, null);
    expect(d).toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'A faixa de preço mudou: agora 7,00 a 18,99' });
  });
  it('retry depois de POST bem-sucedido não posta de novo', () => {
    const d = decidir('aderir', 'DEAL', 'P-1', { ml_item_id: 'MLB1', preco: 18.99 }, { ...conv, status: 'pending' }, null);
    expect(d).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/operacoes/__tests__/decidir.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `tipos.ts` e `decidir.ts` (imports com extensão `.ts`, como o resto de `_shared`).
- [ ] **Step 4:** Rodar de novo → PASS.
- [ ] **Step 5:** Commit `feat(operacoes): decisão pura por item (aderir/sair DEAL/SMART)`.

---

### Task 3: Cliente ML de escrita e leitura fresca

**Model:** opus (marketplace).

**Files:**
- Create: `supabase/functions/_shared/operacoes/ml.ts`
- Test: `supabase/functions/_shared/operacoes/__tests__/ml.test.ts`

**Interfaces:**
- Consumes: tipos da Task 2.
- Produces:

```ts
export class SemEscritaPromocoes extends Error {}   // 401/403 do ML
export interface ClienteML {
  lerNaCampanha(promocaoId: string, tipo: TipoPromocao, itemId: string): Promise<ItemNaCampanha | null>;
  lerRelacoes(itemId: string): Promise<Relacoes>;
  post(itemId: string, body: Record<string, unknown>): Promise<{ offer_id: string | null }>;
  del(itemId: string, query: string): Promise<void>;
}
export function criarClienteML(token: string, f?: typeof fetch, esperar?: (ms: number) => Promise<void>): ClienteML;
```

Comportamento:
- `lerNaCampanha`: GET `/seller-promotions/promotions/${pid}/items?promotion_type=${tipo}&item_id=${itemId}&app_version=v2`; lê `results[0]` (null se `results` null/vazio) → `{status, preco_min: min_discounted_price, preco_max: max_discounted_price, offer_id}` (números via `Number` com null seguro). Retry em 500/502/503: até 3 tentativas, `esperar(1000)` entre elas; persistindo, lança `Error('ML 500 em /seller-promotions/promotions')`.
- `lerRelacoes`: GET `/items/${itemId}?attributes=id,catalog_listing,item_relations`; para cada relação, GET `/items/${rel.id}?attributes=id,catalog_listing` → `{catalog_listing, relacionados:[{id, catalog_listing}]}`.
- `post`: POST `/seller-promotions/items/${itemId}?app_version=v2` JSON; 201/200 → `{offer_id: corpo.offer_id ?? null}`; 401/403 → `SemEscritaPromocoes`; outros → `Error` com `ML ${status}: ${message do corpo}` (message cortada em 200 chars).
- `del`: DELETE `/seller-promotions/items/${itemId}?${query}`; 200/204 → ok; 401/403 → `SemEscritaPromocoes`; outros → `Error`.
- Header `Authorization: Bearer ${token}`; nunca incluir o token em mensagens de erro.

- [ ] **Step 1: Testes com `fetch` falso** (padrão de `_shared/promocoes/__tests__/ml.test.ts`): (a) leitura com `results` → objeto; (b) `results: null` → null; (c) 500, 500, 200 → sucesso após 2 `esperar`; (d) 500×3 → lança; (e) POST 201 devolve `offer_id: 'OFFER-X'`; (f) POST 403 → `SemEscritaPromocoes`; (g) DELETE monta a URL com a query recebida; (h) `lerRelacoes` com 1 relação catálogo.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5:** Commit `feat(operacoes): cliente ML de escrita em seller-promotions`.

---

### Task 4: Executor com orçamento, continuação e conferência de saída

**Model:** opus (marketplace).

**Files:**
- Create: `supabase/functions/_shared/operacoes/executar.ts`
- Test: `supabase/functions/_shared/operacoes/__tests__/executar.test.ts`

**Interfaces:**
- Consumes: `decidir` (Task 2), `ClienteML`, `SemEscritaPromocoes` (Task 3).
- Produces:

```ts
export interface OperacaoRow { id: string; org_id: string; acao: Acao; promocao_id: string; promocao_tipo: TipoPromocao }
export interface ItemRow { ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number }
export interface DepsExecutar {
  ml: ClienteML;
  agora(): number;
  itensPendentes(operacaoId: string, limite: number): Promise<ItemRow[]>;
  itensAConferir(operacaoId: string): Promise<ItemRow[]>;          // status saida_solicitada
  gravarItem(operacaoId: string, mlItemId: string, campos: Partial<{ status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number }>): Promise<void>;
  espelharStatusCentral(promocaoId: string, mlItemId: string, statusML: 'candidate' | 'started'): Promise<void>; // ml_promocao_itens
  continuar(): Promise<void>;                 // republica { etapa:'executar', operacao_id }
  agendarConferencia(): Promise<void>;        // republica { etapa:'conferir', operacao_id } com delay 300 s
  concluir(): Promise<void>;                  // status='concluida', concluido_em=now() se nada pendente nem a conferir
}
export async function executar(op: OperacaoRow, deps: DepsExecutar, opts: { limiteMs: number; lote: number }): Promise<{ processados: number; continuou: boolean }>;
export async function conferir(op: OperacaoRow, deps: DepsExecutar, opts: { maxConferencias: number }): Promise<{ confirmados: number; pendentes: number }>;
```

Regras:
- `executar`: laço de lotes de `opts.lote` itens `pendente` (sequencial dentro do lote — escrita no ML, sem concorrência). Por item: `lerNaCampanha` → (se aderir) `lerRelacoes` → `decidir`.
  - `post` → `ml.post` → `gravarItem(status 'aplicado', offer_id)` + `espelharStatusCentral(..., 'started')`.
  - `delete` → `ml.del` → `gravarItem(status 'saida_solicitada', mensagem 'Saída pedida ao ML; aguardando confirmação')`.
  - `fim` → `gravarItem(status, mensagem)`.
  - `SemEscritaPromocoes` em qualquer chamada → marca ESTE e TODOS os pendentes restantes como `erro` com "Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais" e para (sem continuar).
  - Outro erro no item → `erro` com a mensagem e segue.
  - Passou de `limiteMs` com pendentes restantes → `continuar()` e retorna `continuou: true`.
  - Sem pendentes: se houver `saida_solicitada` → `agendarConferencia()`; senão `concluir()`.
- `conferir`: para cada `saida_solicitada`: `lerNaCampanha`; não participando (null ou `candidate`) → `aplicado`, mensagem null, `espelharStatusCentral('candidate')`; senão `conferencias+1`; se `conferencias+1 >= maxConferencias` → mantém `saida_solicitada` com mensagem "O ML ainda não confirmou a saída. Confira no Seller Center.". Se sobrou algum abaixo do máximo → `agendarConferencia()`; senão `concluir()`.

- [ ] **Step 1: Testes com deps falsas em memória** (um array de itens + `ClienteML` falso). Casos obrigatórios: DEAL aderir aplica e espelha; SMART aderir grava `offer_id` devolvido; retry (item já `pending` no fresco) → `ja_estava` sem chamar `post`; 403 no segundo item → 2º..N viram `erro` com a mensagem de reconexão e `continuar` não é chamado; orçamento estourado (`agora` avançando) → `continuar` chamado uma vez; sair → `saida_solicitada` + `agendarConferencia`; `conferir` confirma quando fresco null; `conferir` no limite mantém com a mensagem do Seller Center e chama `concluir`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(operacoes): executor com continuação e conferência de saída`.

---

### Task 5: Validação do pedido + edge `operacoes-massa`

**Model:** opus (marketplace + financeiro).

**Files:**
- Create: `supabase/functions/_shared/operacoes/validar.ts`
- Create: `supabase/functions/_shared/operacoes/deps.ts`
- Create: `supabase/functions/operacoes-massa/index.ts`
- Modify: `supabase/config.toml` (bloco `[functions.operacoes-massa]`, `verify_jwt = false` — mesmo motivo do `sincronizar-promocoes`: recebe QStash; o caminho de usuário valida o JWT via `requireUserOrg`)
- Test: `supabase/functions/_shared/operacoes/__tests__/validar.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4; `requireUserOrg` (`_shared/auth.ts:36-56`), `exigirModulo`, `resolverConexao` + `getValidAccessTokenConexao` (copiar `conexaoDaOrg` de `sincronizar-promocoes/index.ts:24-28`), `qstashClient`, `verificarAssinatura`, `semaforo` e `liquidoNoPreco` de `_shared/promocoes/projecao.ts`.
- Produces: endpoint `POST /functions/v1/operacoes-massa`:
  - Usuário: body `{ acao: 'aderir'|'sair', promocao_id: string, origem_id?: string, itens: { ml_item_id: string; preco?: number|null; confirmado_risco?: boolean }[] }` → `201 { operacao_id }` | `400 { erro, itens?: {ml_item_id, motivo}[] }` | `403` | `409 { erro }`.
  - QStash: `{ etapa: 'executar'|'conferir', operacao_id }`.

`validar.ts` (puro):

```ts
export interface LinhaCentral { ml_item_id: string; status: string; titulo: string | null; preco_min: number | null;
  preco_max: number | null; preco_sugerido: number | null; preco_promo: number | null; projecao: ProjecaoCor[] }
export interface PedidoValidado { ml_item_id: string; titulo: string | null; preco: number | null; semaforo: Semaforo; confirmado_risco: boolean }
export function semaforoNoPreco(projecao: ProjecaoCor[], preco: number | null): Semaforo;
export function validarPedido(
  acao: Acao, tipo: string, itens: { ml_item_id: string; preco?: number | null; confirmado_risco?: boolean }[],
  central: Map<string, LinhaCentral>,
): { ok: true; itens: PedidoValidado[] } | { ok: false; erro: string; itens?: { ml_item_id: string; motivo: string }[] };
```

- `semaforoNoPreco`: para cada cor com `comissao_pct`, `frete`, `aliquota_pct` e `custo` não-null, líquido = `liquidoNoPreco(preco, {comissao:{percentual: comissao_pct, fixa: comissao_fixa ?? 0}, frete}, aliquota_pct)`, semáforo = `semaforo(liquido, piso ?? custo, custo)`; cor sem dado → `'indisponivel'`; resultado = `piorSemaforo`. `// ponytail: tarifa da projeção (preço avaliado), não a do preço editado — cruza faixa de comissão fixa só em edição grande; recalcular com tarifaEm se aparecer divergência.`
- `validarPedido` recusa: tipo ∉ {DEAL,SMART}; lista vazia ou > 500 itens; item fora de `central`; aderir com status ≠ `candidate`; sair com status não participando; DEAL aderir com preço ausente/fora de `[preco_min, preco_max]`; semáforo `vermelho`/`indisponivel` sem `confirmado_risco`. Motivos em pt-BR, um por item. SMART aderir: `preco = preco_promo` (informativo).

`index.ts` — estrutura igual a `sincronizar-promocoes/index.ts`:
- QStash (header `upstash-signature`): `verificarAssinatura`; carrega a operação (service role); `exigirModulo`; `conexaoDaOrg`; sem conexão → todos pendentes `erro` "Organização sem conexão com o Mercado Livre" + concluir. `etapa:'executar'` → `executar(op, depsExecutar(admin, cx, op), { limiteMs: 90_000, lote: 20 })`; `'conferir'` → `conferir(..., { maxConferencias: 12 })`. Sempre 200 (o executor já gravou o erro por item); exceção inesperada → 500 (QStash tenta de novo; `decidir` garante idempotência).
- Usuário: `requireUserOrg(req, { access: 'write' })`; `!isAdmin && support?.scope !== 'full'` → 403 "Só administradores executam operações em massa."; `exigirModulo`; lê `ml_promocoes` (tipo, nome) da `promocao_id` na org (404 se não existe); se `origem_id`, confere que a origem é da org e tem a ação inversa (400 senão); lê `ml_promocao_itens` dos `ml_item_id` pedidos; `validarPedido`; insere operação + itens (insert dos itens falhando com `23505` → apaga a operação recém-criada e responde 409 "Algum destes anúncios já está numa operação em andamento."); publica `{etapa:'executar', operacao_id}` com `qstashClient().publishJSON({ url, body, retries: 3 })`; responde 201.

`deps.ts`: implementa `DepsExecutar` com `admin` (service role): `itensPendentes` (`status='pendente'`, `order ml_item_id`, `limit`), `gravarItem` (update + `atualizado_em = now()`), `espelharStatusCentral` (update `ml_promocao_itens.status` por `org_id, promocao_id, ml_item_id` — ignora 0 linhas), `continuar`/`agendarConferencia` (`publishJSON` com `deduplicationId` determinístico `${etapa}:${operacao_id}:${n}`, onde `n` = nº de itens já fora de `pendente` (executar) ou soma de `conferencias` (conferir) — retry da mesma mensagem gera o mesmo id e o QStash descarta; `delay: 300` na conferência), `concluir` (só se `count(status in ('pendente','saida_solicitada' com conferencias < 12))` = 0 → `status='concluida', concluido_em=now()`), `agora = Date.now`, `ml = criarClienteML(cx.token)`.

- [ ] **Step 1: Testes de `validarPedido` e `semaforoNoPreco`** — casos: tipo LIGHTNING → erro; DEAL preço 19,50 com faixa 7-18,99 → motivo; item vermelho sem confirmação → motivo; com confirmação → ok; sair de item convidado → motivo; SMART aderir usa `preco_promo`; cor sem custo → indisponivel; 501 itens → erro.
- [ ] **Step 2:** FAIL. **Step 3:** implementar `validar.ts`, `deps.ts`, `index.ts`, `config.toml`. **Step 4:** PASS + `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5:** Commit `feat(operacoes): edge operacoes-massa (criar, executar, conferir)`.

---

### Task 6: Front — lib e hooks

**Model:** sonnet.

**Files:**
- Create: `src/lib/operacoes.ts`
- Create: `src/hooks/useOperacoes.ts`
- Test: `src/lib/__tests__/operacoes.test.ts`

**Interfaces:**
- Consumes: linha de item da Central já tipada em `src/lib/promocoes.ts` (usar o tipo existente de `useItensPromocao`), `calcularSemaforo` (`src/lib/semaforo.ts`), `liquidoClassico` equivalente do front se existir; senão replicar a fórmula de `_shared/preco/liquido.ts` (`preco - (preco*pct/100 + fixa) - frete - preco*aliq/100`) em `src/lib/operacoes.ts` com teste de paridade contra `_shared/operacoes/validar.ts#semaforoNoPreco` (padrão de `tests/lib/paridade-semaforo-promocoes.test.ts`).
- Produces:

```ts
export type AcaoOperacao = 'aderir' | 'sair';
export type StatusItemOperacao = 'pendente'|'aplicado'|'ja_estava'|'mudou'|'bloqueado'|'erro'|'saida_solicitada';
export interface LinhaPreview { ml_item_id: string; titulo: string | null; preco: number | null; min: number | null; max: number | null;
  sugerido: number | null; ateQuanto: number | null; semaforo: Semaforo; marcado: boolean }
export function parsePreco(txt: string): number | null;                 // "18,50" → 18.5; inválido → null
export function semaforoNoPreco(projecao: ProjecaoCor[], preco: number | null): Semaforo; // paridade com o backend
export function montarPreview(acao: AcaoOperacao, tipo: 'DEAL'|'SMART', itens: ItemPromocao[]): LinhaPreview[];
  // aderir: preco = sugerido (DEAL) / preco_promo (SMART); marcado = semaforo === 'verde'
  // sair: preco = preco_promo; marcado = true
export function precisaConfirmarRisco(linhas: LinhaPreview[]): { vermelho: number; indisponivel: number };
export const ROTULO_STATUS: Record<StatusItemOperacao, string>;
  // pendente 'Na fila', aplicado 'Feito', ja_estava 'Já estava', mudou 'Mudou desde o preview',
  // bloqueado 'Bloqueado', erro 'Erro', saida_solicitada 'Saída pedida'
export function inversa(a: AcaoOperacao): AcaoOperacao;
export function itensRevertiveis(itens: { ml_item_id: string; status: StatusItemOperacao }[]): string[]; // aplicado | ja_estava
```

`useOperacoes.ts`: QK `['operacoes']`; `useOperacoes()` (lista da org, `select('*, itens:operacoes_massa_itens(status)')` ordenada por `criado_em desc`, limit 50; `refetchInterval` 5 s se alguma `executando`); `useItensOperacao(id)`; `useCriarOperacao()` (mutation → `supabase.functions.invoke('operacoes-massa', { body })`; em `onSuccess` invalida `['operacoes']` e `['promocoes']`). Erros da edge: ler `error.context` como os outros hooks da Central fazem (`src/lib/promocoes.ts`).

- [ ] **Step 1: Testes** — `parsePreco` ("18,50", "18.5", "", "abc"); `montarPreview` DEAL aderir marca só verde e usa sugerido; SMART aderir usa preco_promo; sair marca tudo; `precisaConfirmarRisco` conta; `itensRevertiveis`; paridade `semaforoNoPreco` front × backend em 3 casos.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(operacoes): lib e hooks do front`.

---

### Task 7: Front — seleção e preview no detalhe da campanha

**Model:** sonnet.

**Files:**
- Create: `src/components/promocoes/barra-selecao.tsx`
- Create: `src/components/promocoes/preview-operacao.tsx`
- Modify: `src/pages/PromocaoDetalhe.tsx`
- Test: `src/components/promocoes/__tests__/preview-operacao.test.tsx`, `src/pages/__tests__/PromocaoDetalhe.test.tsx` (acrescentar casos)

**Interfaces:**
- Consumes: Task 6; `useProfile().isAdmin` (`src/hooks/useProfile.ts:7`); `Sheet` de `src/components/ui/sheet` (padrão de `sheet-cores.tsx`); `toast` de `sonner`.
- Produces: `<PreviewOperacao acao tipo promocaoId promocaoNome itens origemId? aberto onClose />` — reutilizado pela Task 8 no Reverter.

Comportamento:
- Checkbox por linha (desktop `DataTable` e `ListaMobile`) só quando o tipo da campanha é DEAL/SMART e a campanha não está encerrada. Checkbox "selecionar todos" no cabeçalho respeitando o filtro atual.
- `BarraSelecao` fixa no rodapé quando há seleção: "N selecionados · Aderir X · Sair Y" (X = convidados selecionados, Y = participando selecionados) + "Limpar". Cada botão abre o preview com os itens daquele grupo.
- `PreviewOperacao`: título "Aderir à {nome}" / "Sair de {nome}"; tabela com checkbox por item (default = `marcado` de `montarPreview`), título, semáforo, preço. DEAL aderir: input de preço (aceita vírgula), faixa "7,00 a 18,99" abaixo, semáforo recalculado ao digitar via `semaforoNoPreco`, botão por linha "usar Até quanto descer" quando `ateQuanto` existe, e ação em massa "Usar 'Até quanto descer' em todos". Preço fora da faixa → borda vermelha + botão Executar desabilitado.
- Se marcados incluem vermelho/indisponível: bloco de alerta "N abaixo do custo e M sem líquido" + checkbox "Aderir mesmo assim" que precisa estar marcado para habilitar Executar; ao enviar, esses itens vão com `confirmado_risco: true`.
- Botão "Executar" só se `isAdmin`; não admin vê o texto "Só administradores executam operações em massa." no lugar.
- Executar → `useCriarOperacao` → toast.success "Operação iniciada: N anúncios" → fecha o sheet, limpa seleção e navega para `/promocoes?aba=operacoes`. Erro 400 com `itens` → mostra o motivo na linha correspondente; 409/403 → toast.error com `erro`.

- [ ] **Step 1: Testes** (Testing Library, padrão de `sheet-cores.test.tsx`): preview DEAL marca só verdes; digitar "19,50" fora da faixa desabilita Executar; item vermelho marcado exige o checkbox de risco; não admin não vê Executar; envio chama a mutation com `{acao, promocao_id, itens:[{ml_item_id, preco, confirmado_risco}]}`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(operacoes): seleção e preview no detalhe da campanha`.

---

### Task 8: Front — aba Operações e Reverter

**Model:** sonnet.

**Files:**
- Create: `src/components/promocoes/lista-operacoes.tsx`
- Modify: `src/pages/Promocoes.tsx` (aba "Operações" ao lado de Ativas/Futuras/Encerradas; `?aba=operacoes` na URL)
- Test: `src/components/promocoes/__tests__/lista-operacoes.test.tsx`

**Interfaces:**
- Consumes: Tasks 6-7 (`PreviewOperacao`, `itensRevertiveis`, `inversa`, `ROTULO_STATUS`).

Comportamento:
- Lista: cada operação em um card/linha: "Aderir à 10.10" / "Sair de …", data/hora, quem, contagens por status (chips com `ROTULO_STATUS`), barra de progresso enquanto `executando` (feitos/total). Vazia → "Nenhuma operação ainda. Selecione anúncios numa campanha para aderir ou sair."
- Abrir uma operação → lista de itens (título, status, mensagem). Operação de Reverter mostra "Reverte a operação de {data}".
- "Reverter" (só admin, só operação `concluida` com itens revertíveis) → abre `PreviewOperacao` com `acao = inversa(op.acao)`, `origemId = op.id`, itens = linhas atuais da Central para `itensRevertiveis`; itens que não estão mais no estado exigido aparecem desmarcados com o motivo "Não revertível: o anúncio não está mais convidado/participando".

- [ ] **Step 1: Testes**: lista vazia; contagens; Reverter visível só para admin e só com revertíveis; Reverter abre preview com ação inversa e `origemId`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(operacoes): aba Operações com Reverter`.

---

### Task 9: Aviso na Revisão

**Model:** sonnet.

**Files:**
- Modify: `src/pages/Revisao.tsx` (diálogo de confirmação, junto de `familiasComPrecoAlterado`, ~l.327 e ~l.698)
- Create/Modify: hook pequeno em `src/hooks/usePromocoes.ts`: `useParticipacoesPorItem(mlItemIds: string[])` → `Map<ml_item_id, nome da promoção>` lendo `ml_promocao_itens` (status `started`/`pending`) + `ml_promocoes.nome`, habilitado só com o módulo `promocoes` ligado.
- Test: `src/pages/__tests__/Revisao*.test.tsx` existente mais próximo (acrescentar caso) ou novo teste do hook.

Comportamento: para famílias UPDATE com **preço alterado** cujo `ml_item_id` (use `familias.ml_item_id`; em User Products, os `anuncios_externos.item_externo_id` da família — conferir como `familiasComPrecoAlterado` identifica os itens) está participando, o diálogo mostra "⚠️ {família} participa da {promoção}: mudar o preço pode tirar o anúncio da promoção." Não bloqueia publicar.

- [ ] **Step 1:** teste do aviso aparecendo só para família com preço alterado e participando. **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(revisao): aviso de família participando de promoção`.

---

### Task 10: Documentação

**Model:** sonnet.

**Files:**
- Modify: `docs/decisions/0174-operacoes-em-massa-promocoes-v2.md` — Status "Aceito", data; seção "Implementação" com tabelas/edge/telas.
- Modify: `docs/reference/edge-functions.md` (entrada `operacoes-massa`), `docs/reference/modelo-de-dados.md` (2 tabelas), `docs/TASKS.md`, `docs/project-status.md` (linha da entrega) — seguir a skill `docs-update-checklist`.
- Modify: `docs/reference/glossario.md` — trocar "(I5 — em design)" por "(ADR-0174)"; acrescentar **Saída pedida** ("O ML aceitou o pedido de saída mas ainda não confirmou; o app confere a cada 5 min por até 1 h").

- [ ] **Step 1:** atualizar. **Step 2:** `pnpm docs:links` → PASS. **Step 3:** Commit `docs(operacoes): ADR-0174 aceito e referências`.

---

## Encerramento (orquestrador, não subagente)

1. `pnpm preflight` (static + testes) verde.
2. Teste SQL da Task 1 contra Postgres local.
3. Grok 4.7 xHigh revisa o diff da branch inteira; corrigir achados.
4. `supabase db push` → `supabase functions deploy operacoes-massa` → conferir versão ativa.
5. Validação visual (Playwright, screenshots) do fluxo seleção → preview → executar → aba Operações → Reverter, com uma escrita real controlada na DSA (item avulso, verde se houver) e reversão em seguida.
6. CI verde → merge fast-forward na main → limpar branch/worktree.
