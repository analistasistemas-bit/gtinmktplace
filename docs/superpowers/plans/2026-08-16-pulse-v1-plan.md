# Pulse v1 — inteligência de mercado dirigida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu "Pulse" no PubliAI: radar dirigido de concorrência (preços/vendedores por produto de catálogo), alertas de mudança com contexto de margem, price-to-win, e coleta server-side diária + tier quente 6/6h. ADR-0119 (com errata empírica).
**Architecture:** coletor = edge function `pulse-coletar` (QStash cron, dual-mode) + lógica pura em `_shared/pulse/`; leitura da UI direto via PostgREST (RLS select org); ações do usuário via `pulse-adicionar` (JWT) e `pulse-coletar` manual (JWT).
**Tech Stack:** React 18, TanStack Query v5, Supabase JS (PostgREST), Deno edge functions, Vitest + Testing Library, Tailwind, shadcn/ui.
**Spec:** `docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md` (+ errata na mesma data deste plano)

## Fatos empíricos que governam o plano (provados em 2026-08-16 com token real)

- `/items/{id}` de item de TERCEIRO → **403 sempre** (com token, sem token, multiget). Vendas/estoque por anúncio de terceiro NÃO existem via API.
- `/products/{id}/items` (ofertas do catálogo) → ✅ preço, seller_id, listing_type_id, shipping.free_shipping, official_store_id. **Sem** sold_quantity/available_quantity (vêm `null`).
- `/users/{seller_id}` → ✅ nickname, power_seller_status, level_id, `seller_reputation.transactions.total` (ex.: 20.500). Delta entre dias = vendas do VENDEDOR no período (todas as contas dele, não por anúncio) — rotular como estimativa.
- `/suggestions/items/{MEU_item}/details` → ✅ price-to-win com `status`, `suggested_price.amount`, `costs.selling_fees`, `costs.shipping_fees`.
- Itens PRÓPRIOS via multiget `/items?ids=...&attributes=...` → ✅ sold_quantity exato.
- `/sites/MLB/search` está morto (403, descontinuado). Busca textual não existe no v1.

## Global Constraints (copiado das regras do projeto)

- Comentários e textos de UI em português. `pnpm lint` e `pnpm test` verdes antes de cada commit.
- Migrations SÓ via `supabase migration new <nome>` (arquivo em `supabase/migrations/`); nunca aplicar via painel/apply_migration (ADR-0043). Validação: `npm run db:check`.
- RLS org-scoped obrigatória em tabela de domínio: policy select com `org_id = (select public.current_org_id())` **+ grant select to authenticated** (são checagens independentes). Escrita de coletor = service_role direto (Grupo B), **sem** policy de escrita.
- Insert sob service_role NÃO preenche org_id via trigger — **setar `org_id` explicitamente** em todo insert de edge function.
- Edge functions idempotentes; worker QStash: `verify_jwt = false` + `verificarAssinatura(req, body)` com body lido como TEXTO antes do parse.
- Regra financeira LOUD: margem/imposto nunca defaultam em silêncio — dado ausente exibe "—" e explica, jamais assume.
- Tokens/segredos nunca em código. Nunca escrever em anúncio real fora do fluxo (Pulse v1 só LÊ o ML; a única escrita continua sendo o fluxo Revisão→publicar existente).
- Cirúrgico: não tocar `_shared/ml/concorrencia.ts` nem `mercado.ts` (mlGet duplicado deles fica como está).
- Toda tabela nova entra em `scripts/verificar-isolamento-tenant.ts` em DOIS lugares (`TABELAS` e lista de limpeza ordenada por FK).

## Decisões fechadas (não rediscutir durante execução)

1. Toggle de visibilidade = **`organizations.modulos_habilitados`** (padrão real do menu Estoque, super-admin liga em /admin). O ADR-0119 §6 recebe errata.
2. Enumeração do radar auto = `anuncios_externos.variacoes_externas` (espelho jsonb cobre legacy e User Products).
3. Alertas v1: `preco_caiu`, `novo_concorrente`, `concorrente_saiu`. Sem alerta de estoque (dado inexistente p/ terceiros).
4. 1º snapshot de um produto NÃO gera alertas (evita spam no dia 1).
5. Item manual aceita: URL de página de catálogo (`/p/MLB\d+`) ou GTIN. Item avulso de terceiro é impossível (403) — mensagem de erro explica.
6. Job de agregação semanal/prune de 90 dias: **follow-up registrado em TASKS.md**, prazo antes de 2026-11-14 (90 dias após o 1º snapshot). V1 não perde dado por não tê-lo.
7. Reprecificar do alerta: grava `preco_publicacao` via `updateVariacaoPreco` existente e leva o operador à Revisão (fluxo de publicação existente). Nenhum caminho novo de escrita no ML.

---

## Task 1 — Migration Pulse (tabelas + categoria de notificação + backfills)

**Files:** create `supabase/migrations/<ts>_pulse_v1.sql` (via `supabase migration new pulse_v1`); modify `scripts/verificar-isolamento-tenant.ts`.

```sql
-- Pulse v1 (ADR-0119): radar dirigido de mercado.
-- 4 tabelas Grupo B (select org via RLS; escrita só service_role, org_id explícito).

create table public.pulse_produtos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  catalog_product_id text not null,
  codigo_pai text,                        -- anúncio nosso que originou (null quando manual)
  titulo text,
  origem text not null default 'auto' check (origem in ('auto','manual')),
  status text not null default 'ativo' check (status in ('ativo','pausado','arquivado')),
  ptw_status text,                        -- price-to-win do NOSSO item (suggestions API)
  ptw_preco_sugerido numeric(12,2),
  ptw_custos jsonb,                       -- {"comissao": 3.78, "frete": 6.65}
  ptw_atualizado_em timestamptz,
  ultimo_snapshot_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index pulse_produtos_org_cpid_uniq on public.pulse_produtos (org_id, catalog_product_id);
create index pulse_produtos_org_status_idx on public.pulse_produtos (org_id, status, ultimo_snapshot_em asc);

create table public.pulse_ofertas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  produto_id uuid not null references public.pulse_produtos(id) on delete cascade,
  item_id text not null,
  seller_id bigint not null,
  preco numeric(12,2) not null,
  tier text,
  frete_gratis boolean not null default false,
  loja_oficial boolean not null default false,
  ativo boolean not null default true,    -- false = oferta sumiu do catálogo neste dia
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now()
);
create unique index pulse_ofertas_prod_item_dia_uniq on public.pulse_ofertas (produto_id, item_id, dia);
create index pulse_ofertas_org_prod_dia_idx on public.pulse_ofertas (org_id, produto_id, dia desc);

create table public.pulse_vendedores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  seller_id bigint not null,
  nickname text,
  power_seller text,
  nivel text,
  transactions_total bigint,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now()
);
create unique index pulse_vendedores_org_seller_dia_uniq on public.pulse_vendedores (org_id, seller_id, dia);
create index pulse_vendedores_org_seller_idx on public.pulse_vendedores (org_id, seller_id, dia desc);

create table public.pulse_alertas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  produto_id uuid references public.pulse_produtos(id) on delete cascade,
  tipo text not null check (tipo in ('preco_caiu','novo_concorrente','concorrente_saiu')),
  payload jsonb not null default '{}',
  lido boolean not null default false,
  criado_em timestamptz not null default now()
);
create index pulse_alertas_org_lido_idx on public.pulse_alertas (org_id, lido, criado_em desc);

-- RLS (Grupo B) + grants — privilégio e policy são checagens independentes.
alter table public.pulse_produtos  enable row level security;
alter table public.pulse_ofertas   enable row level security;
alter table public.pulse_vendedores enable row level security;
alter table public.pulse_alertas   enable row level security;

create policy "pulse_produtos: select org"  on public.pulse_produtos  for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_ofertas: select org"   on public.pulse_ofertas   for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_vendedores: select org" on public.pulse_vendedores for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_alertas: select org"   on public.pulse_alertas   for select to authenticated using (org_id = (select public.current_org_id()));
grant select on public.pulse_produtos, public.pulse_ofertas, public.pulse_vendedores, public.pulse_alertas to authenticated;

-- Marcar alerta como lido e pausar/reativar produto direto do app (únicos updates do membro).
create policy "pulse_alertas: update org" on public.pulse_alertas for update to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
grant update (lido) on public.pulse_alertas to authenticated;
create policy "pulse_produtos: update org" on public.pulse_produtos for update to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
grant update (status) on public.pulse_produtos to authenticated;

create trigger pulse_produtos_set_updated_at before update on public.pulse_produtos
  for each row execute procedure extensions.moddatetime (atualizado_em);

-- Categoria de notificação 'pulse' (sincronia manual com os dois categorias.ts — Tasks 3 e 6).
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse'));

-- Backfill 1: chave de menu 'pulse' para não-admins existentes (precedente: menus_multicanal/canais).
update public.profiles set allowed_menus = array_append(allowed_menus, 'pulse')
  where 'configuracoes' = any(allowed_menus) and not ('pulse' = any(allowed_menus));

-- Backfill 2: admins ativos assinam a categoria (lerAssinantes exige; sem assinante o alerta não grava).
update public.profiles set telegram_categorias = array_append(telegram_categorias, 'pulse')
  where is_admin and is_active and not ('pulse' = any(coalesce(telegram_categorias, '{}')));
```

`scripts/verificar-isolamento-tenant.ts`: adicionar `'pulse_produtos','pulse_ofertas','pulse_vendedores','pulse_alertas'` em `TABELAS` (linha ~28) E na lista de limpeza ordenada por FK (~linha 233) na ordem `pulse_alertas, pulse_ofertas, pulse_vendedores, pulse_produtos` (filhas antes do pai).

**Verify:** `npm run db:check` passa; `pnpm lint` verde. NÃO rodar `supabase db push` (deploy é etapa final do Diego/da sessão principal).
**Commit:** `feat(pulse): migration v1 — radar, ofertas, vendedores, alertas (ADR-0119)`

- [ ] Task 1 completa

---

## Task 2 — `_shared/pulse/` lógica pura + testes (TDD)

**Files:** create `supabase/functions/_shared/pulse/tipos.ts`, `parse.ts`, `diff.ts`, `vendedor.ts`, `__tests__/parse.test.ts`, `__tests__/diff.test.ts`, `__tests__/vendedor.test.ts`.

`tipos.ts`:
```ts
// Pulse (ADR-0119): tipos puros do coletor. Sem I/O.
export interface OfertaColetada {
  item_id: string;
  seller_id: number;
  preco: number;
  tier: string | null;
  frete_gratis: boolean;
  loja_oficial: boolean;
}
export interface OfertaAnterior extends OfertaColetada { ativo: boolean; }
export type TipoAlerta = 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
export interface AlertaNovo { tipo: TipoAlerta; payload: Record<string, unknown>; }
export interface DiffOfertas {
  gravar: OfertaColetada[];          // linhas novas do dia (novas ou com preço/atributo mudado)
  desativar: OfertaColetada[];       // ofertas que sumiram (gravadas com ativo=false)
  alertas: AlertaNovo[];
}
export interface PriceToWin {
  status: string | null;
  preco_sugerido: number | null;
  custos: { comissao: number | null; frete: number | null } | null;
}
```

`parse.ts` (respostas reais da API validadas na prova de 2026-08-16):
```ts
import type { OfertaColetada, PriceToWin } from './tipos.ts';

// /products/{id}/items → results[]: item_id, price, seller_id, listing_type_id,
// shipping.free_shipping, official_store_id. sold/available vêm null — não parsear.
export function parseOfertasProduto(json: unknown): OfertaColetada[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: OfertaColetada[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    const itemId = typeof o.item_id === 'string' ? o.item_id : null;
    const preco = typeof o.price === 'number' ? o.price : null;
    const sellerId = typeof o.seller_id === 'number' ? o.seller_id : null;
    if (!itemId || preco == null || sellerId == null) continue;
    out.push({
      item_id: itemId,
      seller_id: sellerId,
      preco,
      tier: typeof o.listing_type_id === 'string' ? o.listing_type_id : null,
      frete_gratis: Boolean((o.shipping as { free_shipping?: unknown } | null)?.free_shipping),
      loja_oficial: o.official_store_id != null,
    });
  }
  return out;
}

// /suggestions/items/{id}/details
export function parsePriceToWin(json: unknown): PriceToWin | null {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.status == null) return null;
  const sug = (d.suggested_price as { amount?: unknown } | null)?.amount;
  const costs = d.costs as { selling_fees?: unknown; shipping_fees?: unknown } | null;
  return {
    status: typeof d.status === 'string' ? d.status : null,
    preco_sugerido: typeof sug === 'number' ? sug : null,
    custos: costs
      ? {
          comissao: typeof costs.selling_fees === 'number' ? costs.selling_fees : null,
          frete: typeof costs.shipping_fees === 'number' ? costs.shipping_fees : null,
        }
      : null,
  };
}
```

`diff.ts`:
```ts
import type { AlertaNovo, DiffOfertas, OfertaAnterior, OfertaColetada } from './tipos.ts';

const mudou = (a: OfertaAnterior, b: OfertaColetada) =>
  a.preco !== b.preco || a.tier !== b.tier || a.frete_gratis !== b.frete_gratis || a.loja_oficial !== b.loja_oficial;

/**
 * Snapshot só-se-mudou (ADR-0119 §2). `anteriores` = estado atual por item
 * (última linha por item_id). Primeiro snapshot (anteriores vazio) grava tudo
 * e NÃO alerta — evita spam no dia em que o produto entra no radar.
 */
export function diffOfertas(anteriores: OfertaAnterior[], atuais: OfertaColetada[]): DiffOfertas {
  const antesPorItem = new Map(anteriores.map((o) => [o.item_id, o]));
  const primeiraColeta = anteriores.length === 0;
  const gravar: OfertaColetada[] = [];
  const alertas: AlertaNovo[] = [];

  for (const atual of atuais) {
    const antes = antesPorItem.get(atual.item_id);
    if (!antes) {
      gravar.push(atual);
      if (!primeiraColeta) {
        alertas.push({ tipo: 'novo_concorrente', payload: { item_id: atual.item_id, seller_id: atual.seller_id, preco: atual.preco } });
      }
      continue;
    }
    if (antes.ativo && mudou(antes, atual)) gravar.push(atual);
    if (!antes.ativo) gravar.push(atual); // oferta voltou
  }

  // Queda do MENOR preço do produto (é o que muda decisão de repricing).
  const minAntes = Math.min(...anteriores.filter((o) => o.ativo).map((o) => o.preco));
  const minAtual = Math.min(...atuais.map((o) => o.preco));
  if (!primeiraColeta && Number.isFinite(minAntes) && Number.isFinite(minAtual) && minAtual < minAntes) {
    alertas.push({ tipo: 'preco_caiu', payload: { de: minAntes, para: minAtual } });
  }

  const itensAtuais = new Set(atuais.map((o) => o.item_id));
  const desativar = anteriores.filter((o) => o.ativo && !itensAtuais.has(o.item_id));
  const sellersAtuais = new Set(atuais.map((o) => o.seller_id));
  for (const d of desativar) {
    if (!sellersAtuais.has(d.seller_id)) {
      alertas.push({ tipo: 'concorrente_saiu', payload: { item_id: d.item_id, seller_id: d.seller_id } });
    }
  }
  return { gravar, desativar, alertas };
}
```

`vendedor.ts`:
```ts
// Grava snapshot do vendedor só quando transactions_total mudou (ou 1ª vez).
export function deveGravarVendedor(anterior: { transactions_total: number | null } | null, atualTotal: number | null): boolean {
  if (anterior == null) return true;
  return anterior.transactions_total !== atualTotal;
}
```

**Testes (escrever ANTES, RED→GREEN):** `parse.test.ts` — fixture com o shape real de `/products/{id}/items` (campos da prova: inclui oferta sem price → ignorada); `diff.test.ts` — casos: primeira coleta (grava tudo, 0 alertas), preço caiu (gravar + alerta com de/para), oferta nova (alerta novo_concorrente), oferta sumiu com seller ainda presente (desativa, sem alerta), seller saiu de vez (alerta concorrente_saiu), nada mudou (gravar vazio); `vendedor.test.ts` — 3 casos.

**Verify:** `pnpm test -- pulse` verde; `pnpm lint` verde.
**Commit:** `feat(pulse): lógica pura do coletor (parse/diff/vendedor) com testes`

- [ ] Task 2 completa

---

## Task 3 — Edge functions `pulse-coletar` + `pulse-adicionar` + config.toml

**Files:** create `supabase/functions/_shared/ml/http.ts`, `supabase/functions/pulse-coletar/index.ts`, `supabase/functions/pulse-coletar/processar.ts`, `supabase/functions/pulse-adicionar/index.ts`; modify `supabase/config.toml`, `supabase/functions/_shared/notificacoes/categorias.ts` (adicionar `'pulse'`).

`_shared/ml/http.ts` (novo helper com retry — os mlGet privados existentes NÃO são tocados):
```ts
// GET na API do ML com timeout e 1 retry para 429/timeout. Non-ok → null (chamador decide).
const TIMEOUT_MS = 15000;
export async function mlGet(url: string, token: string, tentativa = 0): Promise<unknown | null> {
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (resp.status === 429 && tentativa === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return mlGet(url, token, 1);
    }
    if (!resp.ok) {
      console.warn(`ML GET ${resp.status}: ${url}`);
      return null;
    }
    return resp.json();
  } catch (e) {
    if (tentativa === 0) return mlGet(url, token, 1);
    console.warn(`ML GET falhou: ${url}: ${(e as Error).message}`);
    return null;
  }
}
```

`pulse-coletar/processar.ts` — assinatura e passos:
```ts
export interface ResultadoColeta { produtos: number; gravadas: number; alertas: number; }
export async function processarColetaOrg(
  admin: SupabaseClient, conexao: ConexaoCanal, orgId: string,
  tier: 'completo' | 'quente', maxProdutos: number,
): Promise<ResultadoColeta>
```
1. **sincronizarRadar** (só tier `completo`): `paginarTudo` em `anuncios_externos` (`org_id`, `status='publicado'`) lendo `codigo_pai, titulo, item_externo_id, variacoes_externas`; extrair `catalog_product_id` de cada sku em `variacoes_externas`; upsert `pulse_produtos` `{ org_id, catalog_product_id, codigo_pai, titulo, origem: 'auto' }` com `onConflict: 'org_id,catalog_product_id'` (ignoreDuplicates: false, mas NÃO sobrescrever `status` — updateColumns só `codigo_pai,titulo,atualizado_em`). Arquivar: `pulse_produtos` `origem='auto'` cujo `codigo_pai` não está mais na lista de publicados → `status='arquivado'`.
2. **selecionar**: `pulse_produtos` `status='ativo'` (tier quente: e `origem='auto'`) order by `ultimo_snapshot_em` asc nulls first, limit `maxProdutos`.
3. **coletar por produto** com `pool(6, produtos, ...)` (reusar `_shared/concorrencia/pool.ts`): `mlGet(/products/{cpid}/items)` → `parseOfertasProduto` → carregar estado atual (`pulse_ofertas` do produto: última linha por `item_id` — select das últimas N ordenado por dia desc e reduzir em JS) → `diffOfertas` → insert `gravar` (com `org_id`, `produto_id`, dia default) + insert `desativar` como linhas `ativo=false` — ambos com `onConflict: 'produto_id,item_id,dia'` ignoreDuplicates (idempotência de re-execução no mesmo dia) → update `pulse_produtos.ultimo_snapshot_em = now()`.
4. **vendedores** (só tier `completo`): seller_ids únicos das ofertas atuais da org (dedupe em memória por execução); para cada um sem linha hoje: `mlGet(/users/{id})` → `deveGravarVendedor(ultimaLinha, total)` → insert `pulse_vendedores` com `onConflict: 'org_id,seller_id,dia'` ignoreDuplicates.
5. **price-to-win** (só tier `completo`): para produtos `origem='auto'` com `codigo_pai` → `anuncios_externos.item_externo_id` → `mlGet(/suggestions/items/{item}/details)` → `parsePriceToWin` → update `pulse_produtos` `ptw_*`, `ptw_atualizado_em=now()`. Resposta null → não sobrescrever (mantém último conhecido).
6. **alertas**: insert `pulse_alertas` (org_id, produto_id, tipo, payload); se `alertas.length > 0` ao fim da org → `notificarCategoria(admin, orgId, 'pulse', texto)` com texto agregado: `Pulse: ${n} alerta(s) de mercado — abra o menu Pulse para agir.` (1 notificação por org por execução).

`pulse-coletar/index.ts` — dual-mode idêntico ao `monitorar-moderados`: OPTIONS/405; body como texto; se header `upstash-signature` → `verificarAssinatura` → itera todas `marketplace_connections` `canal='mercado_livre'` com `tier` do body (`{"tier":"quente"}` ou `{"tier":"completo"}`, default `completo`), `maxProdutos` = 100 (quente) / 200 (completo); senão → `requireUserOrg(req, { access: 'write' })` → só a org do usuário, tier `completo`, `maxProdutos=50`, responde `{ produtos, gravadas, alertas }`. Erro por org: `console.warn` e segue (uma org nunca derruba as outras).

`pulse-adicionar/index.ts` (`verify_jwt = true`): POST `{ entrada: string }` → `requireUserOrg(req, { access: 'write' })`. Resolver:
- `/\/p\/(MLB\d+)/` na entrada → `catalog_product_id` direto;
- `/^\d{8,14}$/` → `mlGet(/products/search?status=active&site_id=MLB&product_identifier={gtin})` → `results[0].id`; sem resultado → 404 `{ erro: 'GTIN sem produto de catálogo no ML' }`;
- senão → 400 `{ erro: 'Informe o link de catálogo (…/p/MLBxxxx) ou um GTIN. Anúncio avulso de terceiro não é acessível pela API do ML.' }`.
Com o id: `mlGet(/products/{id})` para `name` → upsert `pulse_produtos` `{ org_id, catalog_product_id, titulo: name, origem: 'manual', status: 'ativo' }` → 200 `{ produto_id }`.

`config.toml` (seguir agrupamento comentado existente):
```toml
[functions.pulse-coletar]
verify_jwt = false
[functions.pulse-adicionar]
verify_jwt = true
```

`_shared/notificacoes/categorias.ts`: adicionar `'pulse'` a `CATEGORIAS_NOTIFICACAO` (o espelho do front é a Task 6).

**Testes:** os de parse/diff já cobrem a lógica; adicionar `__tests__` para o resolvedor de entrada do `pulse-adicionar` (extrair para `_shared/pulse/entrada.ts`: `resolverEntrada(entrada: string): { tipo: 'cpid'|'gtin'|'invalida'; valor: string | null }` puro + testes: URL com /p/, GTIN 13 dígitos, URL de item avulso → invalida, texto qualquer → invalida).
**Verify:** `pnpm test -- pulse` e `pnpm lint` verdes. Deploy NÃO é desta task.
**Commit:** `feat(pulse): coletor QStash dual-mode + adicionar manual (edge)`

- [ ] Task 3 completa

---

## Task 4 — Fiação do menu Pulse (6 espelhos + testes de contagem)

**Files (modify):** `src/lib/menus.ts`, `src/lib/modulos.ts`, `src/components/sidebar.tsx`, `src/App.tsx`, `src/pages/Usuarios.tsx`, `supabase/functions/usuarios/index.ts`, `tests/components/shell.test.tsx`, `src/lib/menus.test.ts`, `src/lib/__tests__/menus.test.ts`, `tests/App.test.tsx`. **Create:** `src/pages/Pulse.tsx` (placeholder mínimo renderizável — a página real é a Task 5).

1. `src/lib/menus.ts`: `'pulse'` em `MENU_KEYS` (depois de `'estoque'`) e `PREFIX['pulse'] = 'pulse'`.
2. `src/lib/modulos.ts`: `export type ModuloId = 'estoque' | 'pulse';` + entrada `{ id: 'pulse', nome: 'Pulse', descricao: 'Inteligência de mercado: concorrência, alertas e price-to-win (ADR-0119).', menu: 'pulse' }`.
3. `supabase/functions/usuarios/index.ts`: `'pulse'` no `MENU_KEYS` copiado (linha ~8) e em `MODULOS_VALIDOS` (linha ~175).
4. `src/components/sidebar.tsx`: `{ to: '/pulse', label: 'Pulse', icon: Activity, end: false, key: 'pulse' }` (import `Activity` de `lucide-react`), após Estoque.
5. `src/App.tsx`: `const Pulse = lazy(() => import('@/pages/Pulse'));` + `<Route path="/pulse" element={<Pulse />} />` no mesmo bloco das outras rotas protegidas.
6. `src/pages/Usuarios.tsx`: `MENU_LABEL` ganha `pulse: 'Pulse'` (Record exaustivo — sem isso não compila).
7. `src/pages/Pulse.tsx` placeholder:
```tsx
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';

export default function Pulse() {
  const { data: modulos, isLoading } = useModulosHabilitados();
  if (isLoading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!modulos?.includes('pulse')) return <Navigate to="/" replace />;
  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Pulse" subtitle="Inteligência de mercado" />
    </div>
  );
}
```
8. Testes: atualizar contagens hardcoded em `tests/components/shell.test.tsx` (9→10 e 10→11) e o que quebrar em `src/lib/menus.test.ts`, `src/lib/__tests__/menus.test.ts`, `tests/App.test.tsx` — rodar `pnpm test` e corrigir exatamente o que falhar por causa da chave nova.

**Verify:** `pnpm test` inteiro verde; `pnpm lint` verde.
**Commit:** `feat(pulse): menu, rota e módulo org-gated (padrão Estoque)`

- [ ] Task 4 completa

---

## Task 5 — Página Pulse: radar + detalhe do produto

**Files:** create `src/lib/pulse.ts`, `src/components/pulse/tabela-radar.tsx`, `src/components/pulse/dialog-detalhe.tsx`, `src/components/pulse/dialog-adicionar.tsx`, `src/lib/pulse-margem.ts`, `src/lib/__tests__/pulse-margem.test.ts`; modify `src/pages/Pulse.tsx`, `src/lib/queries.ts` (chaves QK).

`src/lib/queries.ts`: adicionar em `QK`: `pulseProdutos: ['pulse','produtos']`, `pulseDetalhe: (id: string) => ['pulse','detalhe',id]`, `pulseAlertas: ['pulse','alertas']`.

`src/lib/pulse.ts` (PostgREST direto — RLS resolve o escopo):
```ts
export interface PulseProduto {
  id: string; catalog_product_id: string; codigo_pai: string | null; titulo: string | null;
  origem: 'auto' | 'manual'; status: 'ativo' | 'pausado' | 'arquivado';
  ptw_status: string | null; ptw_preco_sugerido: number | null;
  ptw_custos: { comissao: number | null; frete: number | null } | null;
  ultimo_snapshot_em: string | null;
}
export interface PulseOferta { item_id: string; seller_id: number; preco: number; tier: string | null; frete_gratis: boolean; loja_oficial: boolean; ativo: boolean; dia: string; }
export interface PulseVendedor { seller_id: number; nickname: string | null; power_seller: string | null; nivel: string | null; transactions_total: number | null; dia: string; }

export async function fetchPulseProdutos(): Promise<PulseProduto[]>            // status != 'arquivado', order atualizado
export async function fetchPulseDetalhe(produtoId: string): Promise<{ ofertas: PulseOferta[]; vendedores: PulseVendedor[] }>
  // ofertas: últimas 400 do produto (dia desc) — o estado atual (última linha por item_id) e o
  // histórico do menor preço por dia são derivados em pulse-margem.ts (puro, testável)
export async function pausarPulseProduto(id: string, pausar: boolean): Promise<void>  // update status
export async function adicionarPulseManual(entrada: string): Promise<void>     // POST /functions/v1/pulse-adicionar com session token
export async function coletarPulseAgora(): Promise<{ produtos: number; alertas: number }>  // POST /functions/v1/pulse-coletar
```

`src/lib/pulse-margem.ts` (puro, com testes):
```ts
export function estadoAtualOfertas(ofertas: PulseOferta[]): PulseOferta[]      // última linha por item_id, só ativo=true, ordenada por preço
export function menorPrecoPorDia(ofertas: PulseOferta[]): { dia: string; preco: number }[]
export function vendasEstimadasVendedor(hist: PulseVendedor[]): number | null // delta transactions_total entre 1ª e última linha; null com <2 pontos
/**
 * Margem líquida estimada usando os custos do price-to-win do ML (comissão e frete em R$)
 * + imposto por origem + custo do produto. QUALQUER insumo ausente → null (regra LOUD:
 * margem nunca é exibida com dado assumido).
 */
export function margemEstimada(args: {
  preco: number; custoProduto: number | null;
  ptwCustos: { comissao: number | null; frete: number | null } | null;
  aliquotaPct: number | null;
}): { liquido: number; margemPct: number } | null
```
`margemEstimada`: `liquido = preco − comissao − frete − preco*aliquota/100 − custoProduto`; `margemPct = liquido / preco * 100`; null se `custoProduto == null || ptwCustos?.comissao == null || ptwCustos?.frete == null || aliquotaPct == null`.

Contexto de margem por produto (custo + alíquota): query em `src/lib/pulse.ts`:
```ts
export async function fetchContextoMargem(codigoPai: string): Promise<{ custo: number | null; aliquotaPct: number | null; precoAtual: number | null }>
// familias por codigo_pai (mais recente com variações), origem → configuracoes.aliquota_nacional_pct/importado_pct;
// custo = max(variacoes.custo) (conservador); precoAtual = variacoes.preco_publicado_ml ?? preco_publicacao (primeira não nula)
```

`src/pages/Pulse.tsx` (substitui o placeholder): gate do módulo (como no placeholder) + `PageHeader` com ações `[Adicionar produto]` (abre `dialog-adicionar`) e `[Atualizar agora]` (mutation `coletarPulseAgora`, `isPending` no botão, toast com resultado). Corpo: `Skeleton` no loading, `EmptyState` (ícone `Activity`, descrição "O radar acompanha automaticamente os concorrentes dos seus anúncios de catálogo. Publique anúncios ou adicione um produto manualmente.") quando vazio, senão `tabela-radar`.

`tabela-radar.tsx`: linhas com título/`codigo_pai`, badge origem (auto/manual), menor preço atual, nº de ofertas ativas, badge `ptw_status` (mapa: `with_benchmark_highest`→"Acima do benchmark" variant destructive; `sharing_first_place`→"Dividindo o 1º lugar"; outros → texto cru), `ultimo_snapshot_em` relativo, menu de linha (pausar/reativar). Clique → `dialog-detalhe`.

`dialog-detalhe.tsx`: título + `catalog_product_id`; seção **Ofertas atuais** (tabela: preço, vendedor — nickname + `power_seller` + vendas totais + `vendasEstimadasVendedor` como "≈N no período" com sufixo "(estimado)", frete grátis, oficial, tier); seção **Menor preço por dia** (lista compacta dos últimos 14 pontos de `menorPrecoPorDia` — sem gráfico no v1); seção **Sua posição** (quando `codigo_pai`): seu preço atual, menor concorrente, `ptw_preco_sugerido` e **Simulador**: input de preço → `margemEstimada` com `fetchContextoMargem`; insumo faltando → "Margem indisponível: falta {custo|alíquota|price-to-win}" (nunca assumir). Botão `Reprecificar` aparece aqui (implementação na Task 6 — nesta task renderizar desabilitado com tooltip "em breve" é PROIBIDO; simplesmente não renderizar o botão ainda).

**Verify:** `pnpm test` verde (incl. `pulse-margem.test.ts`: margem completa, cada insumo ausente → null, estadoAtual com oferta desativada, delta vendedor com 1 ponto → null); `pnpm lint` verde.
**Commit:** `feat(pulse): página radar + detalhe com margem estimada e simulador`

- [ ] Task 5 completa

---

## Task 6 — Alertas: UI, sino e reprecificar

**Files:** create `src/components/pulse/painel-alertas.tsx`, `src/components/pulse/dialog-reprecificar.tsx`; modify `src/pages/Pulse.tsx`, `src/lib/pulse.ts`, `src/lib/notificacoes-categorias.ts`, `src/components/pulse/dialog-detalhe.tsx`.

1. `src/lib/notificacoes-categorias.ts`: adicionar `'pulse'` com label `Pulse (mercado)` e descrição `Alertas de concorrência: queda de preço, novo concorrente, saída de concorrente.` (espelho do `categorias.ts` da edge — Task 3).
2. `src/lib/pulse.ts`: `fetchPulseAlertas(): Promise<PulseAlerta[]>` (não lidos + últimos 20, join `pulse_produtos(titulo, codigo_pai, catalog_product_id)` via select aninhado) e `marcarAlertaLido(id: string)` (update `lido=true`).
3. `painel-alertas.tsx`: card no topo da página Pulse quando houver não lidos. Cada alerta: texto por tipo — `preco_caiu`: "Menor preço de {titulo} caiu de R$ {de} para R$ {para}"; `novo_concorrente`: "Novo concorrente em {titulo} a R$ {preco}"; `concorrente_saiu`: "Um concorrente saiu de {titulo}". Ações: `[Ver produto]` (abre dialog-detalhe), `[Reprecificar]` (só `preco_caiu` com `codigo_pai`), `[✓]` marcar lido (optimistic update + invalidate).
4. `dialog-reprecificar.tsx`: recebe `codigoPai` + preço sugerido inicial (o `para` do alerta ou o input do simulador). Mostra `margemEstimada` ao preço escolhido (mesma regra LOUD). Confirmação:
```ts
// Resolve a família publicável; ambiguidade → orienta e leva à Revisão (nunca escolhe sozinho).
const { data: familias } = await supabase.from('familias')
  .select('id').eq('codigo_pai', codigoPai).in('status', ['pronto', 'erro']);
if (!familias || familias.length !== 1) {
  toast.error('Não achei uma família única publicável — ajuste o preço pela Revisão.');
  navigate('/revisao'); return;
}
const { data: variacoes } = await supabase.from('variacoes').select('id').eq('familia_id', familias[0].id);
for (const v of variacoes ?? []) await updateVariacaoPreco(v.id, novoPreco);
toast.success('✓ Preço gravado — confirme e publique na Revisão.');
navigate('/revisao');
```
   (`updateVariacaoPreco` já existe em `src/lib/queries.ts:314` e seta `preco_editado_pelo_operador=true`. A publicação continua 100% no fluxo Revisão existente — nenhuma escrita nova no ML.)
5. `dialog-detalhe.tsx`: agora renderiza o botão `Reprecificar` (abre `dialog-reprecificar` com o preço do simulador).

**Verify:** `pnpm test` e `pnpm lint` verdes; teste novo para o texto/roteamento dos alertas se houver função pura extraída (extrair `textoAlerta(alerta): string` para `src/lib/pulse-alerta-texto.ts` + teste dos 3 tipos).
**Commit:** `feat(pulse): alertas com reprecificação via Revisão + categoria no sino`

- [ ] Task 6 completa

---

## Task 7 — Docs, TASKS e follow-ups

**Files (modify):** `docs/reference/edge-functions.md` (2 funções novas + linhas na tabela de schedules com os crons abaixo), `docs/reference/modelo-de-dados.md` (4 tabelas), `docs/TASKS.md` (entrega Pulse v1 + follow-up "job de agregação semanal + prune 90d do Pulse — antes de 2026-11-14" + follow-up "v2: extensão coletora de DOM p/ vendas por anúncio"), `docs/project-status.md` (Pulse v1 em validação), `obsidian-vault/06-Roadmap/Sprint Atual.md` (se houver seção de sprint corrente).

Schedules (documentar; criação real é etapa de deploy da sessão principal, não desta task):
```
pulse-coletar completo: cron 0 9 * * *  (06:00 BRT), body {"tier":"completo"}
pulse-coletar quente:   cron 0 */6 * * *, body {"tier":"quente"}
```

**Verify:** `pnpm lint` verde (markdownlint se houver); links relativos válidos.
**Commit:** `docs(pulse): edge functions, modelo de dados e follow-ups do v1`

- [ ] Task 7 completa

---

## Self-review do plano (Sentinel fase 2)

1. **Cobertura design→task:** ADR §1 radar auto+manual → T1/T3/T5; §2 travas (só-se-mudou T2/T3; teto por org — coberto pelo teto por execução + follow-up de agregação em T7; ciclo de vida ativo/pausado/arquivado T1/T3/T5); §3 QStash+tiers → T3/T7; §4 três telas → T5 (concorrência, rentabilidade) + T6 (alertas); §5 diferenciais → T3 passo 5 + T5/T6; §6 rollout → T4 (módulo) — **gap encontrado e resolvido:** ADR prometia "vendas estimadas por anúncio de terceiro"; prova de 2026-08-16 mostrou 403 → errata no ADR + proxy por vendedor (aprovado pelo Diego em 2026-08-16). Teto rígido de itens por org (tier premium) ficou fora do v1 — o teto por execução (200/dia) limita o custo; registrar junto do follow-up de agregação.
2. **Placeholders:** nenhum TBD/TODO; todo código citado é literal e completo o suficiente para executor sem contexto.
3. **Consistência de tipos entre tasks:** `OfertaColetada/OfertaAnterior/DiffOfertas/PriceToWin` definidos em T2 e consumidos em T3; `PulseProduto/PulseOferta/PulseVendedor` definidos em T5 e consumidos em T6; `updateVariacaoPreco(variacaoId, novoPreco)` (existente) consumido em T6; colunas SQL de T1 batem com os selects de T3/T5 (conferido campo a campo).
