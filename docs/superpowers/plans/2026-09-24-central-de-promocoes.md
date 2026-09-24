# Central de Promoções do ML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Promoções" que lista as campanhas do ML da org e, por anúncio convidado/participando, o líquido projetado no preço promocional, o markup, o semáforo (pior cor) e "até quanto descer" — só leitura, com sync a cada 6 h e dois alertas opcionais.

**Architecture:** Worker novo `sincronizar-promocoes` (QStash com fan-out por org + chamada do usuário) lê `/seller-promotions`, projeta o líquido por cor com funções puras em `_shared/promocoes/` (comissão e frete do ML no preço promocional, custo/piso/origem do cadastro) e grava em 3 tabelas com RLS por org. A tela só lê do banco e aplica `calcularSemaforo`/`calcularMarkup`. Alertas saem pelo `notificarCategoria` (`financeiro`) com dedup, uma mensagem agregada por sync.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno), QStash, Upstash Redis, React + TanStack Query + Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-central-de-promocoes-design.md` · **ADR:** `docs/decisions/0170-central-de-promocoes-ml.md` · **Glossário:** `docs/reference/glossario.md` § Promoções

## Global Constraints

- **Nenhuma escrita no ML.** O worker só faz `GET`. Nenhum `POST/PUT/DELETE` para `api.mercadolibre.com` em nenhum arquivo deste plano.
- Líquido = `liquidoClassico(preco, comissao, frete, aliquotaPct)` (`_shared/preco/liquido.ts`), no **preço avaliado** = `preco_sugerido ?? preco_promo`. Comissão = `comissaoDe(buscarListingPrice(token, preco, categoria, listingType))`; frete = `(await buscarFreteVendedorComProveniencia(token, mlUserId, preco, categoria, dim)).valor` — as mesmas funções do `calcular-tarifa-ml`.
- **`ml_pct` (ML banca) NÃO entra no líquido** (ADR-0170 §7). A tela diz "não incluído no líquido".
- Alíquota: `aliquota_importado_pct` se origem `importado`, `aliquota_nacional_pct` se `nacional`. Org sem `aliquotas_confirmadas_em` → sync da org termina em `estado='erro'` com a mensagem `Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.` **Origem nula → cor sem líquido (`motivo='sem_origem'`)**, nunca 8% presumido.
- Semáforo: 🟢 `liquido >= piso`; 🔴 `custo > 0 && liquido < custo`; 🟡 resto; `indisponivel` se `liquido == null`. Pior do anúncio: vermelho > amarelo > verde entre as cores **com** líquido; `indisponivel` só se nenhuma cor tem líquido.
- Vocabulário da UI: "Convidados", "Participando", "Líquido", "Markup", "ML banca", "Até quanto descer", "Sem custo no PubliAI". Proibido na UI: "margem", "lucro", "candidato", emoji.
- Módulo: `'promocoes'`; menu: `'promocoes'`, rota `/promocoes` e `/promocoes/:promocaoId`, ícone lucide `BadgePercent`, logo após Publicados.
- Switch de alertas: `configuracoes.alertas_promocoes_ativo boolean not null default false` + `grant select (alertas_promocoes_ativo) on public.configuracoes to authenticated`.
- Alertas: `notificarCategoria(admin, orgId, 'financeiro', texto)`; dedup `reservarNotificacao(admin, orgId, null, 'promo_prejuizo', '<promocao_id>:<ml_item_id>')` e `reservarNotificacao(admin, orgId, null, 'promo_prazo', '<promocao_id>')`; no máximo **1 mensagem por org por execução**.
- Orçamento por execução de org: **120 000 ms**; throttle do botão: **2 min** desde `ml_promocoes_sync.iniciado_em`.
- Migrations **só** via `supabase migration new` + `supabase db push` (ADR-0043). Nunca `apply_migration`/painel.
- Git neste worktree: `/usr/bin/git`, um comando por chamada, commit com `-F <arquivo de mensagem absoluto>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Roteamento de modelo (CLAUDE.md): Tasks 1-6 (migration, cálculo financeiro, integração ML) → **opus**; Tasks 7-9 (frontend) → **sonnet**; Tasks 0 e 10 → orquestrador (não delegar).

## Setup do worktree (antes da Task 1)

- [ ] Na raiz do worktree `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/i1-central-promocoes`: `cp "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.local" "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.test" .`
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm test -- supabase/functions/_shared/preco src/lib` → suíte existente verde (linha de base).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_central_promocoes.sql` (novo) | 3 tabelas + RLS + grants + coluna `alertas_promocoes_ativo` |
| `src/lib/database.types.ts` (mod) | tipos das 3 tabelas + coluna nova |
| `supabase/functions/_shared/promocoes/tipos.ts` (novo) | tipos compartilhados (sem IO) |
| `supabase/functions/_shared/promocoes/projecao.ts` (novo) | puras: semáforo, pior, preço avaliado, líquido, até quanto descer, contagem |
| `supabase/functions/_shared/promocoes/cadastro.ts` (novo) | puras: mapa do cadastro e resolução de cor |
| `supabase/functions/_shared/promocoes/ml.ts` (novo) | normalizadores puros + leitura HTTP das promoções/itens/multiget |
| `supabase/functions/_shared/promocoes/sincronizar.ts` (novo) | orquestrador `sincronizarOrg` com deps injetadas |
| `supabase/functions/_shared/promocoes/alertas.ts` (novo) | seleção dos alertas + mensagem + `avisarPromocoes` com deps |
| `supabase/functions/_shared/promocoes/deps.ts` (novo) | fiação real (Supabase, Redis, ML) — só ligação |
| `supabase/functions/_shared/promocoes/__tests__/*.test.ts` (novos) | testes vitest das puras e dos orquestradores |
| `tests/lib/paridade-semaforo-promocoes.test.ts` (novo) | semáforo backend == `src/lib/semaforo.ts` |
| `supabase/functions/sincronizar-promocoes/index.ts` (novo) | handler: QStash sem org (fan-out), QStash com org, usuário |
| `supabase/functions/usuarios/index.ts` (mod) | `'promocoes'` em `MODULOS_VALIDOS` |
| `src/lib/menus.ts`, `src/lib/modulos.ts`, `src/components/sidebar.tsx`, `src/App.tsx` (mod) | menu, módulo, rota |
| `src/lib/promocoes.ts` (novo) | tipos de leitura, queries, helpers de exibição puros |
| `src/hooks/usePromocoes.ts` (novo) | hooks react-query + mutation "Atualizar agora" |
| `src/pages/Promocoes.tsx` (novo) | tela 1 — campanhas |
| `src/pages/PromocaoDetalhe.tsx` (novo) | tela 2 — detalhe + Sheet de cores |
| `src/components/promocoes/*.tsx` (novos) | card de campanha, contagem, painel de estado, sheet de cores |
| `src/lib/queries.ts`, `src/hooks/useConfiguracoes.ts`, `src/components/configuracoes/secao-notificacoes.tsx` (mod) | switch de alertas |

---

### Task 0: Validação de campo (orquestrador — não delegar, só GET)

Confirma na conta Avil, com o token da conexão (mesmo meio do spike, sem expor credencial), o que o código assume. **Nenhuma escrita no ML.** Resultado vai para a seção "Resultado da Task 0" no fim da spec e as fixtures anonimizadas para `supabase/functions/_shared/promocoes/__tests__/fixtures/` (repo público: trocar `seller_id`/nomes de conta por valores fictícios; MLB e preços podem ficar).

- [ ] **Step 1: Formato das respostas.** `GET /seller-promotions/users/{uid}?app_version=v2`, `GET /seller-promotions/promotions/{id}/items?promotion_type=DEAL&app_version=v2&limit=50` (e a 2ª página com o cursor), `GET /seller-promotions/promotions/{id}/items?promotion_type=SMART&app_version=v2`, `GET /items?ids=<3 MLB, 1 Legacy multi-cor, 1 UP>&attributes=id,title,thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations&include_attributes=all`. Salvar como `promocoes-usuario.json`, `itens-deal-p1.json`, `itens-deal-p2.json`, `itens-smart.json`, `multiget.json`. Conferir: nome do cursor em `paging` (`searchAfter`) e do parâmetro de envio (`search_after`); campos `deadline_date`, `benefits`; `stock.min/max` no LIGHTNING. **Se divergir do que `ml.ts` (Task 4) lê, ajustar o normalizador e o teste da Task 4 ao formato real antes de implementá-la.**
- [ ] **Step 2: ML banca.** Achar em `ml_vendas`/`ml_vendas_itens` (SQL read-only via Management API) uma venda de item que estava `started` em SMART com `meli_percentage > 0`; comparar `unit_price`, `sale_fee` e o líquido gravado com `price`/`original_price`/`meli_percentage`. Registrar a regra observada na spec. **O MVP não muda:** o subsídio continua fora do líquido; incluir exige nova decisão do Diego.
- [ ] **Step 3: Volume.** Contar itens `candidate`+`started` somando todas as promoções `pending`/`started` da Avil e o nº de preços distintos. Estimativa de chamadas = multiget/20 + 2 × preços distintos + ~2 × itens com faixa. Registrar; se > ~2 500 chamadas por org, reduzir a concorrência para 4 no `deps.ts` e avisar o Diego antes do deploy.
- [ ] **Step 4: Deep link.** Confirmar no navegador (sessão isolada, conta VALIDATION não serve — só abrir a URL pública de login) a URL da área de promoções do Seller Center (candidata: `https://www.mercadolivre.com.br/anuncios/promocoes`). Registrar em `URL_PROMOCOES_ML` (Task 7).
- [ ] **Step 5: Commit** das fixtures + seção da spec: `docs(promocoes): resultado da validação de campo (Task 0)`.

---

### Task 1: Migration + tipos

**Files:**
- Create: `supabase/migrations/<timestamp>_central_promocoes.sql` (gerado pelo CLI)
- Modify: `src/lib/database.types.ts` (bloco `configuracoes` + 3 tabelas novas em `Tables`)

**Interfaces:**
- Produces: tabelas `ml_promocoes`, `ml_promocao_itens`, `ml_promocoes_sync`; coluna `configuracoes.alertas_promocoes_ativo`.

- [ ] **Step 1:** `supabase migration new central_promocoes`
- [ ] **Step 2: Conteúdo**

```sql
-- ADR-0170 — Central de Promoções do ML (só leitura). Escrita só pelo worker (service_role).

create table public.ml_promocoes (
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  promocao_id            text not null,
  tipo                   text not null,
  nome                   text,
  status                 text not null,
  inicio                 timestamptz,
  fim                    timestamptz,
  prazo_adesao           timestamptz,
  beneficios             jsonb,
  bruto                  jsonb not null default '{}',
  contagem               jsonb,
  erro                   text,
  sincronizado_em        timestamptz not null default now(),
  itens_sincronizados_em timestamptz,
  primary key (org_id, promocao_id)
);

create table public.ml_promocao_itens (
  org_id          uuid not null,
  promocao_id     text not null,
  ml_item_id      text not null,
  status          text not null,
  preco_original  numeric,
  preco_promo     numeric,
  preco_min       numeric,
  preco_max       numeric,
  preco_sugerido  numeric,
  preco_avaliado  numeric,
  ml_pct          numeric,
  vendedor_pct    numeric,
  estoque_min     integer,
  estoque_max     integer,
  titulo          text,
  thumbnail       text,
  permalink       text,
  listing_type_id text,
  projecao        jsonb not null default '[]',
  pior_semaforo   text not null check (pior_semaforo in ('verde','amarelo','vermelho','indisponivel')),
  sincronizado_em timestamptz not null default now(),
  primary key (org_id, promocao_id, ml_item_id),
  foreign key (org_id, promocao_id) references public.ml_promocoes(org_id, promocao_id) on delete cascade
);
create index ml_promocao_itens_semaforo_idx on public.ml_promocao_itens (org_id, promocao_id, pior_semaforo);

create table public.ml_promocoes_sync (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  estado          text not null check (estado in ('sincronizando','ok','sem_acesso','sem_promocoes','erro')),
  iniciado_em     timestamptz,
  ultimo_ok_em    timestamptz,
  ultimo_erro_em  timestamptz,
  erro            text
);

-- RLS: membro lê a própria org; insert/update/delete ficam só com service_role (sem grant).
alter table public.ml_promocoes      enable row level security;
alter table public.ml_promocao_itens enable row level security;
alter table public.ml_promocoes_sync enable row level security;
create policy "ml_promocoes: select org"      on public.ml_promocoes      for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_promocao_itens: select org" on public.ml_promocao_itens for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_promocoes_sync: select org" on public.ml_promocoes_sync for select to authenticated using (org_id = (select public.current_org_id()));
grant select on public.ml_promocoes, public.ml_promocao_itens, public.ml_promocoes_sync to authenticated;

-- Switch dos alertas (nasce desligado). SELECT de configuracoes é por coluna desde 20260822131053.
alter table public.configuracoes
  add column if not exists alertas_promocoes_ativo boolean not null default false;
grant select (alertas_promocoes_ativo) on public.configuracoes to authenticated;
```

- [ ] **Step 3:** `npm run db:check` → Expected: sem erro. `supabase db reset` local → Expected: aplica até o fim.
- [ ] **Step 4: Tipos.** Em `src/lib/database.types.ts`: em `configuracoes` Row `alertas_promocoes_ativo: boolean`, Insert/Update `alertas_promocoes_ativo?: boolean` (ao lado de `monitor_frete_ativo`). Adicionar `ml_promocoes`, `ml_promocao_itens`, `ml_promocoes_sync` em `Tables` no formato das vizinhas (Row com todos os campos; Insert/Update opcionais onde há default; `Relationships: []`), colunas `numeric` como `number | null`, `jsonb` como `Json`/`Json | null`.
- [ ] **Step 5:** `pnpm build` → Expected: sem erro de tipo.
- [ ] **Step 6: Commit** `feat(promocoes): tabelas e switch de alertas (ADR-0170)`.

---

### Task 2: Projeção pura (TDD)

**Files:**
- Create: `supabase/functions/_shared/promocoes/tipos.ts`, `supabase/functions/_shared/promocoes/projecao.ts`
- Test: `supabase/functions/_shared/promocoes/__tests__/projecao.test.ts`, `tests/lib/paridade-semaforo-promocoes.test.ts`

**Interfaces:**
- Consumes: `liquidoClassico` (`../preco/liquido.ts`), `grossUp`, `type Comissao` (`../preco/sugerir.ts`), `type DimensoesPacote` (`../ml/pacote.ts`).
- Produces (usado pelas Tasks 4-6 e 8-9):

```ts
// tipos.ts
import type { Comissao } from '../preco/sugerir.ts';
import type { DimensoesPacote } from '../ml/pacote.ts';

export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export type Origem = 'nacional' | 'importado' | null;
export type MotivoSemLiquido = 'sem_cadastro' | 'sem_custo' | 'sem_origem' | 'sem_preco' | 'sem_categoria';

export interface Tarifa { comissao: Comissao; frete: number }
export interface Aliquotas { nacional: number; importado: number }

export interface PromocaoML {
  id: string; tipo: string; nome: string | null; status: string;
  inicio: string | null; fim: string | null; prazo_adesao: string | null;
  beneficios: Record<string, unknown> | null; bruto: unknown;
}
export interface ItemPromocaoML {
  ml_item_id: string; status: string;
  preco_original: number | null; preco_promo: number | null;
  preco_min: number | null; preco_max: number | null; preco_sugerido: number | null;
  ml_pct: number | null; vendedor_pct: number | null;
  estoque_min: number | null; estoque_max: number | null;
}
export interface VariacaoML { variation_id: number; cor: string | null; sku: string | null; gtin: string | null }
export interface ItemML {
  id: string; titulo: string | null; thumbnail: string | null; permalink: string | null;
  listing_type_id: string | null; categoria: string | null; sku: string | null; gtin: string | null;
  variacoes: VariacaoML[];
}
export interface CadastroVariacao {
  variacao_id: string; custo: number | null; piso: number | null; origem: Origem;
  cor: string | null; codigo: string | null; dim: DimensoesPacote | null;
}
export interface ProjecaoCor {
  variation_id: number | null; cor: string | null; sku: string | null;
  custo: number | null; piso: number | null; origem: Origem;
  comissao_pct: number | null; comissao_fixa: number | null; frete: number | null; aliquota_pct: number | null;
  liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null;
  semaforo: Semaforo; motivo: MotivoSemLiquido | null;
}
export interface LinhaItem extends ItemPromocaoML {
  titulo: string | null; thumbnail: string | null; permalink: string | null; listing_type_id: string | null;
  preco_avaliado: number | null; projecao: ProjecaoCor[]; pior_semaforo: Semaforo;
}
export interface Contagem {
  convidados: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
}
```

- [ ] **Step 1: Criar `tipos.ts`** com o bloco acima (arquivo só de tipos).
- [ ] **Step 2: Teste que falha** — `supabase/functions/_shared/promocoes/__tests__/projecao.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ateQuantoDescer, contar, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo,
} from '../projecao.ts';
import type { LinhaItem, Tarifa } from '../tipos.ts';

const t = (pct: number, fixa = 0, frete = 0): Tarifa => ({ comissao: { percentual: pct, fixa }, frete });

describe('semaforo', () => {
  it('verde no piso, amarelo entre custo e piso, vermelho abaixo do custo', () => {
    expect(semaforo(20, 20, 10)).toBe('verde');
    expect(semaforo(15, 20, 10)).toBe('amarelo');
    expect(semaforo(9.99, 20, 10)).toBe('vermelho');
    expect(semaforo(null, 20, 10)).toBe('indisponivel');
    expect(semaforo(5, 20, 0)).toBe('amarelo'); // custo 0 nunca vira vermelho (igual ao front)
  });
});

describe('piorSemaforo', () => {
  it('vermelho > amarelo > verde; indisponível só se nenhuma cor tem líquido', () => {
    expect(piorSemaforo(['verde', 'amarelo'])).toBe('amarelo');
    expect(piorSemaforo(['verde', 'indisponivel', 'vermelho'])).toBe('vermelho');
    expect(piorSemaforo(['verde', 'indisponivel'])).toBe('verde');
    expect(piorSemaforo(['indisponivel', 'indisponivel'])).toBe('indisponivel');
    expect(piorSemaforo([])).toBe('indisponivel');
  });
});

describe('precoAvaliado', () => {
  it('sugerido quando há faixa, senão o preço da promoção', () => {
    expect(precoAvaliado({ preco_sugerido: 49.9, preco_promo: 45 })).toBe(49.9);
    expect(precoAvaliado({ preco_sugerido: null, preco_promo: 45 })).toBe(45);
    expect(precoAvaliado({ preco_sugerido: null, preco_promo: null })).toBeNull();
  });
});

describe('liquidoNoPreco', () => {
  it('preço − comissão% − fixa − frete − imposto (mesma conta do liquidoClassico)', () => {
    // 100 − 12 − 6,25 − 20 − 8 = 53,75
    expect(liquidoNoPreco(100, t(12, 6.25, 20), 8)).toBeCloseTo(53.75, 10);
  });
});

describe('ateQuantoDescer', () => {
  const tarifaFixa = async () => t(10, 0, 0); // líquido = 0,82·P com imposto 8%

  it('"qualquer" quando o mínimo da faixa já atinge o piso', async () => {
    const r = await ateQuantoDescer({ piso: 20, aliquotaPct: 8, min: 30, max: 50 }, tarifaFixa);
    expect(r).toEqual({ valor: null, motivo: 'qualquer' });
  });

  it('"nenhum" quando nem o máximo atinge o piso', async () => {
    const r = await ateQuantoDescer({ piso: 100, aliquotaPct: 8, min: 30, max: 50 }, tarifaFixa);
    expect(r).toEqual({ valor: null, motivo: 'nenhum' });
  });

  it('menor preço da faixa com líquido ≥ piso, verificado na tarifa daquele preço', async () => {
    const r = await ateQuantoDescer({ piso: 30, aliquotaPct: 8, min: 20, max: 60 }, tarifaFixa);
    // grossUp(30, 10, 0, 0, 8) = 30/0,82 = 36,585… → arredonda p/ cima de 5 centavos = 36,60
    expect(r.motivo).toBeNull();
    expect(r.valor).toBeCloseTo(36.6, 2);
    expect(liquidoNoPreco(r.valor!, t(10), 8)).toBeGreaterThanOrEqual(30);
  });

  it('se a tarifa muda no preço candidato, itera até o líquido verificado bater', async () => {
    // abaixo de 40 o frete é 0; a partir de 40 o vendedor paga 10 de frete
    const tarifaPorPreco = async (p: number) => t(10, 0, p >= 40 ? 10 : 0);
    const r = await ateQuantoDescer({ piso: 34, aliquotaPct: 8, min: 20, max: 80 }, tarifaPorPreco);
    expect(r.valor).not.toBeNull();
    expect(liquidoNoPreco(r.valor!, await tarifaPorPreco(r.valor!), 8)).toBeGreaterThanOrEqual(34);
  });
});

describe('contar', () => {
  const linha = (status: string, pior: LinhaItem['pior_semaforo']) => ({ status, pior_semaforo: pior }) as LinhaItem;
  it('conta convidados, participando e o pior semáforo de cada anúncio', () => {
    expect(contar([
      linha('candidate', 'verde'), linha('candidate', 'indisponivel'),
      linha('started', 'vermelho'), linha('started', 'amarelo'),
    ])).toEqual({
      convidados: 2, participando: 2, verde: 1, amarelo: 1, vermelho: 1, indisponivel: 1, participando_vermelho: 1,
    });
  });
});
```

- [ ] **Step 3:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/projecao.test.ts` → Expected: FAIL (módulo não existe).
- [ ] **Step 4: Implementar `projecao.ts`**

```ts
// ADR-0170 — projeção do líquido de um anúncio numa promoção do ML. Puro: IO entra por parâmetro.
import { liquidoClassico } from '../preco/liquido.ts';
import { grossUp } from '../preco/sugerir.ts';
import type { Contagem, LinhaItem, Semaforo, Tarifa } from './tipos.ts';

/** Mesma regra de `src/lib/semaforo.ts` (amarrada por tests/lib/paridade-semaforo-promocoes.test.ts). */
export function semaforo(liquido: number | null, piso: number, custo: number | null): Semaforo {
  if (liquido == null) return 'indisponivel';
  if (liquido >= piso) return 'verde';
  if (custo != null && custo > 0 && liquido < custo) return 'vermelho';
  return 'amarelo';
}

const PESO: Record<Semaforo, number> = { indisponivel: 0, verde: 1, amarelo: 2, vermelho: 3 };

/** Pior cor entre as que têm líquido; `indisponivel` só quando nenhuma tem (ADR-0065, família-level). */
export function piorSemaforo(cores: Semaforo[]): Semaforo {
  return cores.reduce<Semaforo>((pior, s) => (PESO[s] > PESO[pior] ? s : pior), 'indisponivel');
}

export function precoAvaliado(it: { preco_sugerido: number | null; preco_promo: number | null }): number | null {
  return it.preco_sugerido ?? it.preco_promo ?? null;
}

export function liquidoNoPreco(preco: number, t: Tarifa, aliquotaPct: number): number {
  return liquidoClassico(preco, t.comissao, t.frete, aliquotaPct);
}

/**
 * Menor preço da faixa [min, max] cujo líquido, conferido na tarifa DAQUELE preço, fica ≥ piso.
 * Parte do gross-up da tarifa do máximo e re-verifica (a comissão fixa e o frete grátis mudam com o
 * preço). Nunca devolve um preço sem verificação: no pior caso fica no máximo, que já foi verificado.
 */
export async function ateQuantoDescer(
  a: { piso: number; aliquotaPct: number; min: number; max: number },
  tarifaEm: (preco: number) => Promise<Tarifa>,
): Promise<{ valor: number | null; motivo: 'qualquer' | 'nenhum' | null }> {
  if (liquidoNoPreco(a.min, await tarifaEm(a.min), a.aliquotaPct) >= a.piso) return { valor: null, motivo: 'qualquer' };
  let t = await tarifaEm(a.max);
  if (liquidoNoPreco(a.max, t, a.aliquotaPct) < a.piso) return { valor: null, motivo: 'nenhum' };
  for (let i = 0; i < 4; i++) {
    const bruto = grossUp(a.piso, t.comissao.percentual, t.comissao.fixa, t.frete, a.aliquotaPct);
    const cand = Math.min(a.max, Math.max(a.min, bruto));
    const tc = await tarifaEm(cand);
    if (liquidoNoPreco(cand, tc, a.aliquotaPct) >= a.piso) return { valor: cand, motivo: null };
    t = tc;
  }
  return { valor: a.max, motivo: null };
}

export function contar(linhas: Pick<LinhaItem, 'status' | 'pior_semaforo'>[]): Contagem {
  const c: Contagem = { convidados: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0 };
  for (const l of linhas) {
    const participa = l.status === 'started';
    if (participa) c.participando++; else c.convidados++;
    c[l.pior_semaforo]++;
    if (participa && l.pior_semaforo === 'vermelho') c.participando_vermelho++;
  }
  return c;
}
```

- [ ] **Step 5:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/projecao.test.ts` → Expected: PASS. Se `36.6` falhar, conferir `arredondar5Cima` em `sugerir.ts` e ajustar só o valor esperado ao arredondamento real (a asserção do líquido ≥ piso é a que não pode mudar).
- [ ] **Step 6: Paridade** — `tests/lib/paridade-semaforo-promocoes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calcularSemaforo } from '../../src/lib/semaforo';
import { semaforo } from '../../supabase/functions/_shared/promocoes/projecao';

describe('paridade semáforo front × promoções', () => {
  const casos: [number | null, number, number | null][] = [
    [null, 10, 5], [10, 10, 5], [9, 10, 5], [4.99, 10, 5], [4.99, 10, 0], [4.99, 10, null], [-3, 10, 5],
  ];
  it.each(casos)('liquido=%s piso=%s custo=%s', (l, p, c) => {
    expect(semaforo(l, p, c)).toBe(calcularSemaforo(l, p, c));
  });
});
```

Run: `pnpm test -- tests/lib/paridade-semaforo-promocoes.test.ts` → Expected: PASS (7 casos). Se o import com extensão `.ts` for exigido pelas outras paridades (`tests/lib/paridade-preco-fe-be.test.ts`), copiar o estilo de import de lá.
- [ ] **Step 7: Commit** `feat(promocoes): projecao pura do liquido e ate quanto descer (ADR-0170)`.

---

### Task 3: Resolução do cadastro (TDD)

**Files:**
- Create: `supabase/functions/_shared/promocoes/cadastro.ts`
- Test: `supabase/functions/_shared/promocoes/__tests__/cadastro.test.ts`

**Interfaces:**
- Consumes: `CadastroVariacao`, `Origem` (`./tipos.ts`); `normGtin` (`../faturamento/venda.ts`).
- Produces:

```ts
export interface LinhaVariacao {   // select da Task 5 (deps.ts)
  id: string; custo: unknown; preco: unknown; cor: string | null; codigo: string | null; gtin: string | null;
  ml_variation_id: string | number | null; peso_gramas: unknown; altura_cm: unknown; largura_cm: unknown;
  comprimento_cm: unknown; atualizado_em: unknown;
  familias: { ml_item_id: string | null; origem: string | null } | { ml_item_id: string | null; origem: string | null }[] | null;
}
export interface LinhaItemUp { item_externo_id: string; variacao_id: string }
export interface Cadastro { /* mapas internos */ }
export function montarCadastro(variacoes: LinhaVariacao[], itensUp: LinhaItemUp[]): Cadastro;
export function resolverCor(c: Cadastro, q: { item_id: string; variation_id: number | null; sku: string | null; gtin: string | null }): CadastroVariacao | null;
```

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { montarCadastro, resolverCor, type LinhaVariacao } from '../cadastro.ts';

const v = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 10, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: null,
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});

describe('resolverCor', () => {
  it('item filho de User Products casa pelo anuncios_externos_itens, mesmo sem SKU (ADR-0105)', () => {
    const c = montarCadastro([v({ id: 'a', cor: 'Rosa' })], [{ item_externo_id: 'MLB900', variacao_id: 'a' }]);
    expect(resolverCor(c, { item_id: 'MLB900', variation_id: null, sku: null, gtin: null })?.cor).toBe('Rosa');
  });

  it('Legacy casa por ml_variation_id', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '555', cor: 'Verde' })], []);
    expect(resolverCor(c, { item_id: 'MLBx', variation_id: 555, sku: null, gtin: null })?.cor).toBe('Verde');
  });

  it('cai para código/SKU e depois GTIN, ignorando zeros à esquerda', () => {
    const c = montarCadastro([v({ id: 'a', codigo: '00123', gtin: '0789' })], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '123', gtin: null })?.variacao_id).toBe('a');
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: null, gtin: '789' })?.variacao_id).toBe('a');
  });

  it('ml_item_id só resolve anúncio de variação única', () => {
    const mono = montarCadastro([v({ id: 'a' })], []);
    expect(resolverCor(mono, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })?.variacao_id).toBe('a');
    const multi = montarCadastro([v({ id: 'a' }), v({ id: 'b' })], []);
    expect(resolverCor(multi, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })).toBeNull();
  });

  it('duplicata de código: vence a linha mais recente (ADR-0108)', () => {
    const c = montarCadastro([
      v({ id: 'velha', codigo: '7', custo: 5, atualizado_em: '2026-01-01T00:00:00Z' }),
      v({ id: 'nova', codigo: '7', custo: 9, atualizado_em: '2026-09-01T00:00:00Z' }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '7', gtin: null })?.custo).toBe(9);
  });

  it('custo ausente/≤0 ou não numérico vira null (⚪); origem inválida vira null', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', custo: 0, familias: { ml_item_id: 'M', origem: 'xx' } })], []);
    const r = resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!;
    expect(r.custo).toBeNull();
    expect(r.origem).toBeNull();
    expect(r.piso).toBe(18);
  });

  it('dimensões inválidas viram null (o frete usa o default do ML)', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', altura_cm: null })], []);
    expect(resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!.dim).toBeNull();
  });

  it('nada casa → null', () => {
    expect(resolverCor(montarCadastro([], []), { item_id: 'Z', variation_id: 1, sku: 's', gtin: 'g' })).toBeNull();
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/cadastro.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar `cadastro.ts`**

```ts
// ADR-0170 — liga um anúncio da promoção à variação do cadastro. Mesma cadeia e desempate do custo
// vigente (ADR-0108), mais o vínculo de item filho UP. Puro.
// ponytail: cópia enxuta da cadeia de _shared/faturamento/custo-vigente.ts — aquele devolve só o
// custo e é amarrado por paridade ao front; aqui precisamos de piso/origem/dimensões/cor.
import { normGtin } from '../faturamento/venda.ts';
import type { CadastroVariacao, Origem } from './tipos.ts';

export interface LinhaVariacao {
  id: string; custo: unknown; preco: unknown; cor: string | null; codigo: string | null; gtin: string | null;
  ml_variation_id: string | number | null; peso_gramas: unknown; altura_cm: unknown; largura_cm: unknown;
  comprimento_cm: unknown; atualizado_em: unknown;
  familias: { ml_item_id: string | null; origem: string | null } | { ml_item_id: string | null; origem: string | null }[] | null;
}
export interface LinhaItemUp { item_externo_id: string; variacao_id: string }

export interface Cadastro {
  porId: Map<string, CadastroVariacao>;
  porItemUp: Map<string, string>;
  porVariacaoMl: Map<string, CadastroVariacao>;
  porCodigo: Map<string, CadastroVariacao>;
  porGtin: Map<string, CadastroVariacao>;
  porItem: Map<string, CadastroVariacao[]>;
}

const numOuNull = (x: unknown): number | null => {
  const n = Number(x);
  return x == null || x === '' || !Number.isFinite(n) ? null : n;
};
const instante = (x: unknown): number => {
  const t = typeof x === 'string' ? Date.parse(x) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

export function montarCadastro(variacoes: LinhaVariacao[], itensUp: LinhaItemUp[]): Cadastro {
  const c: Cadastro = {
    porId: new Map(), porItemUp: new Map(), porVariacaoMl: new Map(),
    porCodigo: new Map(), porGtin: new Map(), porItem: new Map(),
  };
  const quando = new Map<CadastroVariacao, number>();
  const recente = (m: Map<string, CadastroVariacao>, k: string, val: CadastroVariacao) => {
    const atual = m.get(k);
    if (!atual || quando.get(val)! > quando.get(atual)!) m.set(k, val);
  };

  for (const r of variacoes) {
    const fam = Array.isArray(r.familias) ? r.familias[0] : r.familias;
    const custo = numOuNull(r.custo);
    const origem: Origem = fam?.origem === 'nacional' || fam?.origem === 'importado' ? fam.origem : null;
    const altura = numOuNull(r.altura_cm), largura = numOuNull(r.largura_cm);
    const comprimento = numOuNull(r.comprimento_cm), peso = numOuNull(r.peso_gramas);
    const dimOk = [altura, largura, comprimento, peso].every((n) => n != null && n > 0);
    const val: CadastroVariacao = {
      variacao_id: r.id,
      custo: custo != null && custo > 0 ? custo : null,
      piso: numOuNull(r.preco),
      origem,
      cor: r.cor,
      codigo: r.codigo,
      dim: dimOk ? { altura_cm: altura!, largura_cm: largura!, comprimento_cm: comprimento!, peso_gramas: peso! } : null,
    };
    quando.set(val, instante(r.atualizado_em));
    c.porId.set(r.id, val);
    if (r.ml_variation_id != null) recente(c.porVariacaoMl, String(r.ml_variation_id), val);
    if (r.codigo) recente(c.porCodigo, normGtin(r.codigo.trim()), val);
    if (r.gtin) recente(c.porGtin, normGtin(r.gtin.trim()), val);
    if (fam?.ml_item_id) c.porItem.set(fam.ml_item_id, [...(c.porItem.get(fam.ml_item_id) ?? []), val]);
  }
  for (const u of itensUp) c.porItemUp.set(u.item_externo_id, u.variacao_id);
  return c;
}

export function resolverCor(
  c: Cadastro,
  q: { item_id: string; variation_id: number | null; sku: string | null; gtin: string | null },
): CadastroVariacao | null {
  const up = c.porItemUp.get(q.item_id);
  if (up && c.porId.has(up)) return c.porId.get(up)!;
  if (q.variation_id != null) {
    const r = c.porVariacaoMl.get(String(q.variation_id));
    if (r) return r;
  }
  if (q.sku) {
    const r = c.porCodigo.get(normGtin(q.sku.trim()));
    if (r) return r;
  }
  if (q.gtin) {
    const r = c.porGtin.get(normGtin(q.gtin.trim()));
    if (r) return r;
  }
  const doItem = c.porItem.get(q.item_id);
  return doItem && doItem.length === 1 ? doItem[0] : null;
}
```

- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/cadastro.test.ts` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(promocoes): resolucao do cadastro por cor (ADR-0170)`.

---

### Task 4: Leitura do ML — normalizadores e paginação (TDD)

**Files:**
- Create: `supabase/functions/_shared/promocoes/ml.ts`
- Test: `supabase/functions/_shared/promocoes/__tests__/ml.test.ts`

**Interfaces:**
- Consumes: tipos de `./tipos.ts`. Formato real confirmado na Task 0 (fixtures).
- Produces:

```ts
export type GetJson = (path: string) => Promise<unknown>;
export class SemAcessoPromocoes extends Error {}
export const TIPOS_CUPOM: Set<string>;                         // {'SELLER_COUPON_CAMPAIGN'}
export function criarGetJson(token: string, f?: typeof fetch): GetJson;
export function normalizarPromocao(raw: Record<string, unknown>): PromocaoML | null;
export function normalizarItemPromocao(raw: Record<string, unknown>): ItemPromocaoML | null;
export function normalizarItemML(raw: Record<string, unknown>): ItemML;
export function listarPromocoes(get: GetJson, mlUserId: string): Promise<PromocaoML[]>;
export function listarItensPromocao(get: GetJson, p: PromocaoML): Promise<ItemPromocaoML[]>;
export function buscarItensML(get: GetJson, ids: string[]): Promise<Map<string, ItemML>>;
```

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  buscarItensML, criarGetJson, listarItensPromocao, listarPromocoes, normalizarItemML,
  normalizarItemPromocao, normalizarPromocao, SemAcessoPromocoes,
} from '../ml.ts';
import type { PromocaoML } from '../tipos.ts';

describe('normalizadores', () => {
  it('promoção: campos do v2; sem id (PRICE_DISCOUNT) → null', () => {
    expect(normalizarPromocao({ id: 'P-MLB1', type: 'DEAL', name: '10.10', status: 'pending',
      start_date: '2026-10-10T00:00:00Z', finish_date: '2026-10-11T00:00:00Z', deadline_date: '2026-10-08T21:00:00Z',
      benefits: { meli_percent: 30 } })).toMatchObject({
      id: 'P-MLB1', tipo: 'DEAL', nome: '10.10', status: 'pending', prazo_adesao: '2026-10-08T21:00:00Z',
      beneficios: { meli_percent: 30 },
    });
    expect(normalizarPromocao({ type: 'PRICE_DISCOUNT' })).toBeNull();
  });

  it('item da promoção: preços, co-participação e estoque do relâmpago', () => {
    expect(normalizarItemPromocao({ id: 'MLB7', status: 'candidate', price: 45, original_price: 59.9,
      min_discounted_price: 40, max_discounted_price: 55, suggested_discounted_price: 49.9,
      meli_percentage: 30, seller_percentage: 70, stock: { min: 5, max: 50 } })).toEqual({
      ml_item_id: 'MLB7', status: 'candidate', preco_original: 59.9, preco_promo: 45, preco_min: 40, preco_max: 55,
      preco_sugerido: 49.9, ml_pct: 30, vendedor_pct: 70, estoque_min: 5, estoque_max: 50,
    });
  });

  it('item do ML: cor e SKU por variação; UP sem variações', () => {
    const legacy = normalizarItemML({ id: 'MLB1', title: 'Toalha', secure_thumbnail: 'https://x/t.jpg',
      permalink: 'https://p', listing_type_id: 'gold_special', category_id: 'MLB123',
      attributes: [{ id: 'GTIN', value_name: '789' }],
      variations: [{ id: 11, seller_custom_field: 'SKU-A',
        attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }], attributes: [{ id: 'GTIN', value_name: '0789' }] }] });
    expect(legacy.variacoes).toEqual([{ variation_id: 11, cor: 'Azul', sku: 'SKU-A', gtin: '0789' }]);
    expect(legacy).toMatchObject({ categoria: 'MLB123', listing_type_id: 'gold_special', thumbnail: 'https://x/t.jpg', gtin: '789' });
    const up = normalizarItemML({ id: 'MLB2', attributes: [{ id: 'SELLER_SKU', value_name: '00123' }] });
    expect(up).toMatchObject({ sku: '00123', variacoes: [] });
  });
});

describe('paginação', () => {
  it('itens: segue o cursor searchAfter até acabar', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: 'A', status: 'candidate' }], paging: { searchAfter: 'c1' } })
      .mockResolvedValueOnce({ results: [{ id: 'B', status: 'started' }], paging: {} });
    const p = { id: 'P-1', tipo: 'DEAL' } as PromocaoML;
    const itens = await listarItensPromocao(get, p);
    expect(itens.map((i) => i.ml_item_id)).toEqual(['A', 'B']);
    expect(get.mock.calls[0][0]).toBe('/seller-promotions/promotions/P-1/items?promotion_type=DEAL&app_version=v2&limit=50');
    expect(get.mock.calls[1][0]).toContain('&search_after=c1');
  });

  it('itens: cursor repetido não vira laço infinito', async () => {
    const get = vi.fn().mockResolvedValue({ results: [{ id: 'A', status: 'candidate' }], paging: { searchAfter: 'c1' } });
    await listarItensPromocao(get, { id: 'P', tipo: 'DEAL' } as PromocaoML);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('promoções: pagina por offset', async () => {
    const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `P${i}`, type: 'SMART', status: 'started' }));
    const get = vi.fn().mockResolvedValueOnce({ results: pagina(50) }).mockResolvedValueOnce({ results: pagina(3) });
    expect((await listarPromocoes(get, '99')).length).toBe(53);
    expect(get.mock.calls[1][0]).toBe('/seller-promotions/users/99?app_version=v2&limit=50&offset=50');
  });

  it('multiget: blocos de 20 e ignora code ≠ 200', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
    const get = vi.fn(async (path: string) => {
      const lote = decodeURIComponent(path.split('ids=')[1].split('&')[0]).split(',');
      return lote.map((id) => (id === 'MLB3' ? { code: 404, body: {} } : { code: 200, body: { id } }));
    });
    const m = await buscarItensML(get, ids);
    expect(get).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(44);
    expect(m.has('MLB3')).toBe(false);
  });
});

describe('criarGetJson', () => {
  it('401/403 viram SemAcessoPromocoes; outros erros viram Error', async () => {
    const f403 = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(criarGetJson('t', f403 as unknown as typeof fetch)('/x')).rejects.toBeInstanceOf(SemAcessoPromocoes);
    const f500 = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(criarGetJson('t', f500 as unknown as typeof fetch)('/x')).rejects.toThrow('ML 500');
  });
  it('só GET, com Bearer', async () => {
    const f = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    await criarGetJson('tok', f as unknown as typeof fetch)('/y');
    expect(f).toHaveBeenCalledWith('https://api.mercadolibre.com/y', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar `ml.ts`**

```ts
// ADR-0170 — leitura das promoções do ML. SÓ GET: este arquivo não tem nenhum outro verbo HTTP.
import type { ItemML, ItemPromocaoML, PromocaoML, VariacaoML } from './tipos.ts';

type Obj = Record<string, unknown>;
export type GetJson = (path: string) => Promise<unknown>;
export class SemAcessoPromocoes extends Error {}
export const TIPOS_CUPOM = new Set(['SELLER_COUPON_CAMPAIGN']);

const API = 'https://api.mercadolibre.com';
const LIMITE = 50;
const ATRIBUTOS_ITEM = 'id,title,thumbnail,secure_thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations';

const num = (x: unknown): number | null => {
  const n = Number(x);
  return x == null || x === '' || !Number.isFinite(n) ? null : n;
};
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const lista = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const atributo = (attrs: unknown, id: string): string | null => str(lista(attrs).find((a) => a.id === id)?.value_name);

export function criarGetJson(token: string, f: typeof fetch = fetch): GetJson {
  return async (path) => {
    const r = await f(`${API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const rota = path.split('?')[0];
    if (r.status === 401 || r.status === 403) throw new SemAcessoPromocoes(`ML ${r.status} em ${rota}`);
    if (!r.ok) throw new Error(`ML ${r.status} em ${rota}`);
    return r.json();
  };
}

export function normalizarPromocao(raw: Obj): PromocaoML | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id, tipo: str(raw.type) ?? 'DESCONHECIDO', nome: str(raw.name), status: str(raw.status) ?? 'desconhecido',
    inicio: str(raw.start_date), fim: str(raw.finish_date), prazo_adesao: str(raw.deadline_date),
    beneficios: raw.benefits && typeof raw.benefits === 'object' ? (raw.benefits as Obj) : null,
    bruto: raw,
  };
}

export function normalizarItemPromocao(raw: Obj): ItemPromocaoML | null {
  const id = str(raw.id);
  if (!id) return null;
  const stock = raw.stock && typeof raw.stock === 'object' ? (raw.stock as Obj) : null;
  return {
    ml_item_id: id, status: str(raw.status) ?? 'desconhecido',
    preco_original: num(raw.original_price), preco_promo: num(raw.price),
    preco_min: num(raw.min_discounted_price), preco_max: num(raw.max_discounted_price),
    preco_sugerido: num(raw.suggested_discounted_price),
    ml_pct: num(raw.meli_percentage), vendedor_pct: num(raw.seller_percentage),
    estoque_min: num(stock?.min), estoque_max: num(stock?.max),
  };
}

export function normalizarItemML(raw: Obj): ItemML {
  const variacoes: VariacaoML[] = lista(raw.variations)
    .map((v) => ({
      variation_id: Number(v.id),
      cor: atributo(v.attribute_combinations, 'COLOR'),
      sku: str(v.seller_custom_field) ?? atributo(v.attributes, 'SELLER_SKU'),
      gtin: atributo(v.attributes, 'GTIN'),
    }))
    .filter((v) => Number.isFinite(v.variation_id));
  return {
    id: String(raw.id), titulo: str(raw.title),
    thumbnail: str(raw.secure_thumbnail) ?? str(raw.thumbnail), permalink: str(raw.permalink),
    listing_type_id: str(raw.listing_type_id), categoria: str(raw.category_id),
    sku: str(raw.seller_custom_field) ?? atributo(raw.attributes, 'SELLER_SKU'),
    gtin: atributo(raw.attributes, 'GTIN'),
    variacoes,
  };
}

export async function listarPromocoes(get: GetJson, mlUserId: string): Promise<PromocaoML[]> {
  const out: PromocaoML[] = [];
  for (let offset = 0; offset < 10_000; offset += LIMITE) {
    const r = (await get(`/seller-promotions/users/${mlUserId}?app_version=v2&limit=${LIMITE}&offset=${offset}`)) as Obj;
    const res = lista(r.results);
    for (const x of res) {
      const p = normalizarPromocao(x);
      if (p) out.push(p);
    }
    if (res.length < LIMITE) break;
  }
  return out;
}

export async function listarItensPromocao(get: GetJson, p: PromocaoML): Promise<ItemPromocaoML[]> {
  const out: ItemPromocaoML[] = [];
  const base = `/seller-promotions/promotions/${encodeURIComponent(p.id)}/items?promotion_type=${encodeURIComponent(p.tipo)}&app_version=v2&limit=${LIMITE}`;
  let cursor: string | null = null;
  for (let pagina = 0; pagina < 400; pagina++) {
    const r = (await get(cursor ? `${base}&search_after=${encodeURIComponent(cursor)}` : base)) as Obj;
    const res = lista(r.results);
    for (const x of res) {
      const it = normalizarItemPromocao(x);
      if (it) out.push(it);
    }
    const paging = r.paging && typeof r.paging === 'object' ? (r.paging as Obj) : {};
    const prox = str(paging.searchAfter) ?? str(paging.search_after);
    if (!prox || res.length === 0 || prox === cursor) return out;
    cursor = prox;
  }
  throw new Error(`paginação dos itens da promoção ${p.id} não terminou em 400 páginas`);
}

export async function buscarItensML(get: GetJson, ids: string[]): Promise<Map<string, ItemML>> {
  const m = new Map<string, ItemML>();
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const r = await get(`/items?ids=${encodeURIComponent(bloco.join(','))}&attributes=${ATRIBUTOS_ITEM}&include_attributes=all`);
    for (const x of lista(r)) {
      if (x.code === 200 && x.body && typeof x.body === 'object') {
        const it = normalizarItemML(x.body as Obj);
        m.set(it.id, it);
      }
    }
  }
  return m;
}
```

- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: PASS.
- [ ] **Step 5: Teste com as fixtures da Task 0** (acrescentar ao mesmo arquivo):

```ts
import promocoesUsuario from './fixtures/promocoes-usuario.json';
import itensDeal from './fixtures/itens-deal-p1.json';
import multiget from './fixtures/multiget.json';

describe('fixtures reais (Task 0)', () => {
  it('todas as promoções com id normalizam com tipo e status', () => {
    const ps = (promocoesUsuario as { results: Record<string, unknown>[] }).results
      .map(normalizarPromocao).filter((p) => p != null);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) { expect(p!.tipo).not.toBe('DESCONHECIDO'); expect(p!.status).not.toBe('desconhecido'); }
  });
  it('itens de DEAL trazem faixa e sugerido', () => {
    const it0 = normalizarItemPromocao((itensDeal as { results: Record<string, unknown>[] }).results[0])!;
    expect(it0.preco_min).not.toBeNull();
    expect(it0.preco_max).not.toBeNull();
    expect(it0.preco_sugerido).not.toBeNull();
  });
  it('multiget: item Legacy multi-cor tem cor por variação', () => {
    const itens = (multiget as { code: number; body: Record<string, unknown> }[]).map((x) => normalizarItemML(x.body));
    expect(itens.some((i) => i.variacoes.length > 1 && i.variacoes.every((v) => v.cor))).toBe(true);
  });
});
```

Run: `pnpm test -- supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: PASS. Se falhar, o normalizador está lendo um campo com nome errado: corrigir `ml.ts` (e o teste inline correspondente), nunca a fixture.
- [ ] **Step 6: Commit** `feat(promocoes): leitura das promocoes do ML so por GET (ADR-0170)`.

---

### Task 5: Orquestrador do sync + fiação (TDD)

**Files:**
- Create: `supabase/functions/_shared/promocoes/sincronizar.ts`, `supabase/functions/_shared/promocoes/deps.ts`
- Modify: `supabase/functions/_shared/promocoes/tipos.ts` (acrescentar `'erro_tarifa'` a `MotivoSemLiquido`)
- Test: `supabase/functions/_shared/promocoes/__tests__/sincronizar.test.ts`

**Interfaces:**
- Consumes: Task 2 (`projecao.ts`), Task 3 (`cadastro.ts`), Task 4 (`ml.ts`); `buscarListingPrice`, `comissaoDe` (`../ml/listing-prices.ts`); `buscarFreteVendedorComProveniencia` (`../ml/frete.ts`); `redisGet`, `redisSet` (`../redis/client.ts`); `paginarTudo` (`../pagina.ts`).
- Produces:

```ts
export type EstadoSync = 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
export const MSG_ALIQUOTA: string;
export const MSG_TEMPO: string;
export interface QueryTarifa { preco: number; categoria: string; listingType: string; dim: DimensoesPacote | null }
export interface DepsSync { /* ver Step 4 */ }
export interface ResultadoSync { estado: EstadoSync; processadas: { promo: PromocaoML; linhas: LinhaItem[] }[]; puladas: string[] }
export function projetarItem(it: ItemPromocaoML, ml: ItemML | null, cad: Cadastro, aliq: Aliquotas, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>): Promise<LinhaItem>;
export function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]>;
export function sincronizarOrg(deps: DepsSync, opts: { limiteMs: number; concorrencia: number }): Promise<ResultadoSync>;
// deps.ts
export function depsSync(admin: SupabaseClient, cx: { orgId: string; mlUserId: string; token: string }): DepsSync;
```

- [ ] **Step 1:** Em `tipos.ts`, trocar a linha do `MotivoSemLiquido` por:

```ts
export type MotivoSemLiquido = 'sem_cadastro' | 'sem_custo' | 'sem_origem' | 'sem_preco' | 'sem_categoria' | 'erro_tarifa';
```

- [ ] **Step 2: Teste que falha** — `__tests__/sincronizar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MSG_ALIQUOTA, MSG_TEMPO, projetarItem, sincronizarOrg, type DepsSync } from '../sincronizar.ts';
import { montarCadastro, type LinhaVariacao } from '../cadastro.ts';
import { SemAcessoPromocoes } from '../ml.ts';
import type { ItemML, ItemPromocaoML, PromocaoML, Tarifa } from '../tipos.ts';

const tarifa10: Tarifa = { comissao: { percentual: 10, fixa: 0 }, frete: 0 };
const aliq = { nacional: 8, importado: 16 };
const linhaVar = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 20, preco: 30, cor: null, codigo: null, gtin: null, ml_variation_id: null, peso_gramas: 200,
  altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});
const item = (o: Partial<ItemPromocaoML> = {}): ItemPromocaoML => ({
  ml_item_id: 'MLB1', status: 'candidate', preco_original: 60, preco_promo: 50, preco_min: null, preco_max: null,
  preco_sugerido: null, ml_pct: null, vendedor_pct: null, estoque_min: null, estoque_max: null, ...o,
});
const itemMl = (o: Partial<ItemML> = {}): ItemML => ({
  id: 'MLB1', titulo: 'Toalha', thumbnail: null, permalink: 'https://p', listing_type_id: 'gold_special',
  categoria: 'MLB123', sku: null, gtin: null, variacoes: [], ...o,
});

describe('projetarItem', () => {
  it('Legacy 3 cores: líquido por cor, pior semáforo entre as que têm líquido', async () => {
    const cad = montarCadastro([
      linhaVar({ id: 'a', ml_variation_id: '1', custo: 20, preco: 30 }),  // 50 − 5 − 4 = 41 ≥ 30 → verde
      linhaVar({ id: 'b', ml_variation_id: '2', custo: 45, preco: 50 }),  // 41 < 45 → vermelho
    ], []);
    const ml = itemMl({ variacoes: [
      { variation_id: 1, cor: 'Azul', sku: null, gtin: null },
      { variation_id: 2, cor: 'Rosa', sku: null, gtin: null },
      { variation_id: 3, cor: 'Verde', sku: null, gtin: null },           // sem cadastro
    ] });
    const l = await projetarItem(item(), ml, cad, aliq, async () => tarifa10);
    expect(l.projecao.map((p) => [p.cor, p.semaforo, p.motivo])).toEqual([
      ['Azul', 'verde', null], ['Rosa', 'vermelho', null], ['Verde', 'indisponivel', 'sem_cadastro'],
    ]);
    expect(l.projecao[0].liquido).toBeCloseTo(41, 10);
    expect(l.pior_semaforo).toBe('vermelho');
    expect(l.preco_avaliado).toBe(50);
  });

  it('origem nula nunca vira 8%: sem líquido, motivo sem_origem', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', familias: { ml_item_id: 'MLB1', origem: null } })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.projecao[0]).toMatchObject({ liquido: null, motivo: 'sem_origem', semaforo: 'indisponivel' });
  });

  it('importado usa a alíquota de importado', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', familias: { ml_item_id: 'MLB1', origem: 'importado' } })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.projecao[0].aliquota_pct).toBe(16);
    expect(l.projecao[0].liquido).toBeCloseTo(50 - 5 - 8, 10);
  });

  it('faixa: avalia no sugerido e calcula até quanto descer', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', preco: 30 })], []);
    const l = await projetarItem(item({ preco_min: 20, preco_max: 60, preco_sugerido: 45 }), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.preco_avaliado).toBe(45);
    expect(l.projecao[0].ate_quanto).toBeCloseTo(36.6, 2);
  });

  it('falha na tarifa derruba só a cor (erro_tarifa)', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => { throw new Error('ML 500'); });
    expect(l.projecao[0]).toMatchObject({ motivo: 'erro_tarifa', liquido: null });
  });

  it('item fora do multiget: sem categoria, sem líquido', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), null, cad, aliq, async () => tarifa10);
    expect(l.projecao[0].motivo).toBe('sem_categoria');
  });
});

type Fake = DepsSync & { avancar: (ms: number) => void } & Record<string, ReturnType<typeof vi.fn>>;
function fakeDeps(o: Partial<DepsSync> = {}): Fake {
  let relogio = 0;
  const base = {
    agora: vi.fn(() => relogio),
    avancar: (ms: number) => { relogio += ms; },
    lerAliquotas: vi.fn(async () => aliq),
    listarPromocoes: vi.fn(async (): Promise<PromocaoML[]> => []),
    listarItens: vi.fn(async (): Promise<ItemPromocaoML[]> => [item()]),
    buscarItensML: vi.fn(async () => new Map([['MLB1', itemMl()]])),
    carregarCadastro: vi.fn(async () => montarCadastro([linhaVar({ id: 'a' })], [])),
    tarifaEm: vi.fn(async () => tarifa10),
    ultimaLeituraItens: vi.fn(async () => new Map<string, string | null>()),
    gravarPromocoes: vi.fn(async () => {}),
    gravarItens: vi.fn(async () => {}),
    marcarErroPromocao: vi.fn(async () => {}),
    gravarEstado: vi.fn(async () => {}),
  };
  return { ...base, ...o } as unknown as Fake;
}
const promo = (id: string, tipo = 'DEAL', status = 'pending') =>
  ({ id, tipo, status, nome: id, inicio: null, fim: null, prazo_adesao: null, beneficios: null, bruto: {} }) as PromocaoML;
const opts = { limiteMs: 120_000, concorrencia: 4 };

describe('sincronizarOrg', () => {
  it('alíquotas não confirmadas: falha LOUD sem chamar o ML', async () => {
    const d = fakeDeps({ lerAliquotas: vi.fn(async () => null) });
    const r = await sincronizarOrg(d, opts);
    expect(r.estado).toBe('erro');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'erro', erro: MSG_ALIQUOTA });
    expect(d.listarPromocoes).not.toHaveBeenCalled();
  });

  it('403 do ML vira estado sem_acesso', async () => {
    const d = fakeDeps({ listarPromocoes: vi.fn(async () => { throw new SemAcessoPromocoes('ML 403'); }) });
    expect((await sincronizarOrg(d, opts)).estado).toBe('sem_acesso');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'sem_acesso', erro: 'ML 403' });
  });

  it('lista vazia vira sem_promocoes', async () => {
    expect((await sincronizarOrg(fakeDeps(), opts)).estado).toBe('sem_promocoes');
  });

  it('cupom e encerrada só gravam a linha; pending/started leem itens', async () => {
    const d = fakeDeps({ listarPromocoes: vi.fn(async () => [
      promo('C', 'SELLER_COUPON_CAMPAIGN', 'started'), promo('F', 'DEAL', 'finished'), promo('P'),
    ]) });
    const r = await sincronizarOrg(d, opts);
    expect(d.gravarPromocoes).toHaveBeenCalledTimes(1);
    expect(d.listarItens).toHaveBeenCalledTimes(1);
    expect(d.gravarItens.mock.calls[0][0]).toBe('P');
    expect(d.gravarItens.mock.calls[0][2]).toMatchObject({ convidados: 1, verde: 1 });
    expect(r.estado).toBe('ok');
    expect(d.gravarEstado).toHaveBeenLastCalledWith({ estado: 'ok' });
  });

  it('rodízio: nunca lida primeiro; estourou o orçamento → marca e fica para a próxima rodada', async () => {
    const d = fakeDeps({
      listarPromocoes: vi.fn(async () => [promo('Velha'), promo('Nunca')]),
      ultimaLeituraItens: vi.fn(async () => new Map([['Velha', '2026-09-01T00:00:00Z']])),
    });
    d.listarItens.mockImplementation(async () => { d.avancar(200_000); return [item()]; });
    const r = await sincronizarOrg(d, opts);
    expect(d.listarItens.mock.calls[0][0].id).toBe('Nunca');
    expect(d.marcarErroPromocao).toHaveBeenCalledWith('Velha', MSG_TEMPO);
    expect(r.puladas).toEqual(['Velha']);
  });

  it('falha numa promoção não derruba as outras', async () => {
    const d = fakeDeps({ listarPromocoes: vi.fn(async () => [promo('A'), promo('B')]) });
    d.listarItens.mockImplementationOnce(async () => { throw new Error('ML 500 em /x'); });
    const r = await sincronizarOrg(d, opts);
    expect(d.marcarErroPromocao).toHaveBeenCalledWith('A', 'ML 500 em /x');
    expect(r.processadas.map((p) => p.promo.id)).toEqual(['B']);
    expect(r.estado).toBe('ok');
  });
});
```

- [ ] **Step 3:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/sincronizar.test.ts` → Expected: FAIL.
- [ ] **Step 4: Implementar `sincronizar.ts`**

```ts
// ADR-0170 — sync das promoções de UMA org. Decisão aqui, IO nas deps (fiação real em deps.ts).
import type { DimensoesPacote } from '../ml/pacote.ts';
import { resolverCor, type Cadastro } from './cadastro.ts';
import { SemAcessoPromocoes, TIPOS_CUPOM } from './ml.ts';
import { ateQuantoDescer, contar, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo } from './projecao.ts';
import type {
  Aliquotas, Contagem, ItemML, ItemPromocaoML, LinhaItem, MotivoSemLiquido, ProjecaoCor, PromocaoML, Tarifa,
} from './tipos.ts';

export type EstadoSync = 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
export const MSG_ALIQUOTA = 'Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.';
export const MSG_TEMPO = 'Não processada nesta rodada (tempo esgotado); entra primeiro na próxima.';

export interface QueryTarifa { preco: number; categoria: string; listingType: string; dim: DimensoesPacote | null }

export interface DepsSync {
  agora(): number;
  lerAliquotas(): Promise<Aliquotas | null>;
  listarPromocoes(): Promise<PromocaoML[]>;
  listarItens(p: PromocaoML): Promise<ItemPromocaoML[]>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  carregarCadastro(): Promise<Cadastro>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  /** promocao_id → itens_sincronizados_em (null = nunca leu os itens). */
  ultimaLeituraItens(): Promise<Map<string, string | null>>;
  /** Upsert dos metadados; NÃO toca contagem, erro nem itens_sincronizados_em. */
  gravarPromocoes(ps: PromocaoML[]): Promise<void>;
  /** Upsert dos itens, apaga os que não vieram, grava contagem, erro=null e itens_sincronizados_em. */
  gravarItens(promocaoId: string, linhas: LinhaItem[], contagem: Contagem): Promise<void>;
  marcarErroPromocao(promocaoId: string, erro: string): Promise<void>;
  gravarEstado(e: { estado: EstadoSync; erro?: string }): Promise<void>;
}

export interface ResultadoSync {
  estado: EstadoSync;
  processadas: { promo: PromocaoML; linhas: LinhaItem[] }[];
  puladas: string[];
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      out[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return out;
}

async function projetarCor(
  it: ItemPromocaoML, ml: ItemML | null,
  c: { variation_id: number | null; cor: string | null; sku: string | null; gtin: string | null },
  cad: Cadastro, aliq: Aliquotas, preco: number | null, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>,
): Promise<ProjecaoCor> {
  const r = resolverCor(cad, { item_id: it.ml_item_id, variation_id: c.variation_id, sku: c.sku, gtin: c.gtin });
  const base: ProjecaoCor = {
    variation_id: c.variation_id, cor: c.cor ?? r?.cor ?? null, sku: c.sku,
    custo: r?.custo ?? null, piso: r?.piso ?? null, origem: r?.origem ?? null,
    comissao_pct: null, comissao_fixa: null, frete: null, aliquota_pct: null,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: null,
  };
  const motivo: MotivoSemLiquido | null =
    !r ? 'sem_cadastro'
    : r.custo == null || r.piso == null ? 'sem_custo'
    : r.origem == null ? 'sem_origem'
    : preco == null ? 'sem_preco'
    : !ml?.categoria || !ml.listing_type_id ? 'sem_categoria'
    : null;
  if (motivo) return { ...base, motivo };

  const piso = r!.piso!, custo = r!.custo!;
  const aliquotaPct = r!.origem === 'importado' ? aliq.importado : aliq.nacional;
  const tarifaNo = (p: number) => tarifaEm({ preco: p, categoria: ml!.categoria!, listingType: ml!.listing_type_id!, dim: r!.dim });
  try {
    const t = await tarifaNo(preco!);
    const liquido = liquidoNoPreco(preco!, t, aliquotaPct);
    const ate = it.preco_min != null && it.preco_max != null
      ? await ateQuantoDescer({ piso, aliquotaPct, min: it.preco_min, max: it.preco_max }, tarifaNo)
      : { valor: null, motivo: null };
    return {
      ...base, comissao_pct: t.comissao.percentual, comissao_fixa: t.comissao.fixa, frete: t.frete,
      aliquota_pct: aliquotaPct, liquido, ate_quanto: ate.valor, ate_quanto_motivo: ate.motivo,
      semaforo: semaforo(liquido, piso, custo),
    };
  } catch {
    return { ...base, motivo: 'erro_tarifa' };
  }
}

export async function projetarItem(
  it: ItemPromocaoML, ml: ItemML | null, cad: Cadastro, aliq: Aliquotas, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>,
): Promise<LinhaItem> {
  const preco = precoAvaliado(it);
  const cores = ml && ml.variacoes.length
    ? ml.variacoes.map((v) => ({ variation_id: v.variation_id, cor: v.cor, sku: v.sku ?? ml.sku, gtin: v.gtin ?? ml.gtin }))
    : [{ variation_id: null, cor: null, sku: ml?.sku ?? null, gtin: ml?.gtin ?? null }];
  const projecao: ProjecaoCor[] = [];
  for (const c of cores) projecao.push(await projetarCor(it, ml, c, cad, aliq, preco, tarifaEm));
  return {
    ...it,
    titulo: ml?.titulo ?? null, thumbnail: ml?.thumbnail ?? null, permalink: ml?.permalink ?? null,
    listing_type_id: ml?.listing_type_id ?? null, preco_avaliado: preco, projecao,
    pior_semaforo: piorSemaforo(projecao.map((p) => p.semaforo)),
  };
}

export async function sincronizarOrg(
  deps: DepsSync, opts: { limiteMs: number; concorrencia: number },
): Promise<ResultadoSync> {
  const inicio = deps.agora();
  const fim = (estado: EstadoSync, extra: Partial<ResultadoSync> = {}): ResultadoSync =>
    ({ estado, processadas: [], puladas: [], ...extra });

  const aliq = await deps.lerAliquotas();
  if (!aliq) {
    await deps.gravarEstado({ estado: 'erro', erro: MSG_ALIQUOTA });
    return fim('erro');
  }

  let promos: PromocaoML[];
  try {
    promos = await deps.listarPromocoes();
  } catch (e) {
    const estado: EstadoSync = e instanceof SemAcessoPromocoes ? 'sem_acesso' : 'erro';
    await deps.gravarEstado({ estado, erro: mensagem(e) });
    return fim(estado);
  }
  if (promos.length === 0) {
    await deps.gravarEstado({ estado: 'sem_promocoes' });
    return fim('sem_promocoes');
  }

  await deps.gravarPromocoes(promos);
  const ultima = await deps.ultimaLeituraItens();
  const quando = (id: string) => Date.parse(ultima.get(id) ?? '') || 0; // nunca lida = 0 → primeiro
  const aLer = promos
    .filter((p) => !TIPOS_CUPOM.has(p.tipo) && (p.status === 'pending' || p.status === 'started'))
    .sort((a, b) => quando(a.id) - quando(b.id));

  const cadastro = await deps.carregarCadastro();
  const processadas: ResultadoSync['processadas'] = [];
  const puladas: string[] = [];
  for (const p of aLer) {
    if (deps.agora() - inicio > opts.limiteMs) {
      await deps.marcarErroPromocao(p.id, MSG_TEMPO);
      puladas.push(p.id);
      continue;
    }
    try {
      const itens = await deps.listarItens(p);
      const ml = await deps.buscarItensML(itens.map((i) => i.ml_item_id));
      const linhas = await emParalelo(itens, opts.concorrencia, (it) =>
        projetarItem(it, ml.get(it.ml_item_id) ?? null, cadastro, aliq, (q) => deps.tarifaEm(q)));
      await deps.gravarItens(p.id, linhas, contar(linhas));
      processadas.push({ promo: p, linhas });
    } catch (e) {
      await deps.marcarErroPromocao(p.id, mensagem(e));
    }
  }
  await deps.gravarEstado({ estado: 'ok' });
  return fim('ok', { processadas, puladas });
}
```

- [ ] **Step 5:** `pnpm test -- supabase/functions/_shared/promocoes` → Expected: PASS (todas as suítes da pasta).
- [ ] **Step 6: Implementar `deps.ts`** (fiação; validada contra Postgres real e o ML na Task 10)

```ts
// Fiação real do sync de promoções (ADR-0170). Só ligação, nenhuma decisão — a regra vive em
// sincronizar.ts, testada por vitest. Validada contra Postgres real e o ML na Task 10.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buscarListingPrice, comissaoDe } from '../ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../ml/frete.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import { paginarTudo } from '../pagina.ts';
import { montarCadastro, type LinhaItemUp, type LinhaVariacao } from './cadastro.ts';
import { buscarItensML, criarGetJson, listarItensPromocao, listarPromocoes } from './ml.ts';
import type { DepsSync } from './sincronizar.ts';
import type { Tarifa } from './tipos.ts';

const TTL_TARIFA_S = 6 * 60 * 60;

export function depsSync(admin: SupabaseClient, cx: { orgId: string; mlUserId: string; token: string }): DepsSync {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };

  return {
    agora: () => Date.now(),

    async lerAliquotas() {
      const { data, error } = await admin.from('configuracoes')
        .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em')
        .eq('org_id', orgId).maybeSingle();
      falhou('lerAliquotas', error);
      if (!data?.aliquotas_confirmadas_em || data.aliquota_nacional_pct == null || data.aliquota_importado_pct == null) return null;
      return { nacional: Number(data.aliquota_nacional_pct), importado: Number(data.aliquota_importado_pct) };
    },

    listarPromocoes: () => listarPromocoes(get, cx.mlUserId),
    listarItens: (p) => listarItensPromocao(get, p),
    buscarItensML: (ids) => buscarItensML(get, ids),

    async carregarCadastro() {
      const variacoes = await paginarTudo<LinhaVariacao>((de, ate) => admin.from('variacoes')
        .select('id, custo, preco, cor, codigo, gtin, ml_variation_id, peso_gramas, altura_cm, largura_cm, comprimento_cm, atualizado_em, familias!inner(ml_item_id, origem)')
        .eq('org_id', orgId).order('id').range(de, ate) as never);
      const itensUp = await paginarTudo<LinhaItemUp>((de, ate) => admin.from('anuncios_externos_itens')
        .select('item_externo_id, variacao_id')
        .eq('org_id', orgId).not('item_externo_id', 'is', null).not('variacao_id', 'is', null)
        .order('id').range(de, ate) as never);
      return montarCadastro(variacoes, itensUp);
    },

    async tarifaEm({ preco, categoria, listingType, dim }) {
      const dimKey = dim ? `${dim.altura_cm}x${dim.largura_cm}x${dim.comprimento_cm}x${dim.peso_gramas}` : 'padrao';
      const chave = `promo:tarifa:v1:${cx.mlUserId}:${categoria}:${listingType}:${preco.toFixed(2)}:${dimKey}`;
      try {
        const hit = await redisGet(chave);
        if (hit) return JSON.parse(hit) as Tarifa;
      } catch { /* cache é otimização; segue sem ele */ }
      const [lp, frete] = await Promise.all([
        buscarListingPrice(cx.token, preco, categoria, listingType),
        buscarFreteVendedorComProveniencia(cx.token, cx.mlUserId, preco, categoria, dim),
      ]);
      const t: Tarifa = { comissao: comissaoDe(lp), frete: frete.valor };
      try { await redisSet(chave, JSON.stringify(t), TTL_TARIFA_S); } catch { /* idem */ }
      return t;
    },

    async ultimaLeituraItens() {
      const { data, error } = await admin.from('ml_promocoes')
        .select('promocao_id, itens_sincronizados_em').eq('org_id', orgId);
      falhou('ultimaLeituraItens', error);
      return new Map((data ?? []).map((r) => [r.promocao_id as string, (r.itens_sincronizados_em as string | null) ?? null]));
    },

    async gravarPromocoes(ps) {
      const agora = new Date().toISOString();
      const { error } = await admin.from('ml_promocoes').upsert(ps.map((p) => ({
        org_id: orgId, promocao_id: p.id, tipo: p.tipo, nome: p.nome, status: p.status,
        inicio: p.inicio, fim: p.fim, prazo_adesao: p.prazo_adesao, beneficios: p.beneficios,
        bruto: p.bruto, sincronizado_em: agora,
      })), { onConflict: 'org_id,promocao_id' });
      falhou('gravarPromocoes', error);
    },

    async gravarItens(promocaoId, linhas, contagem) {
      const rodada = new Date().toISOString();
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await admin.from('ml_promocao_itens').upsert(linhas.slice(i, i + 500).map((l) => ({
          org_id: orgId, promocao_id: promocaoId, ml_item_id: l.ml_item_id, status: l.status,
          preco_original: l.preco_original, preco_promo: l.preco_promo, preco_min: l.preco_min, preco_max: l.preco_max,
          preco_sugerido: l.preco_sugerido, preco_avaliado: l.preco_avaliado, ml_pct: l.ml_pct, vendedor_pct: l.vendedor_pct,
          estoque_min: l.estoque_min, estoque_max: l.estoque_max, titulo: l.titulo, thumbnail: l.thumbnail,
          permalink: l.permalink, listing_type_id: l.listing_type_id, projecao: l.projecao,
          pior_semaforo: l.pior_semaforo, sincronizado_em: rodada,
        })), { onConflict: 'org_id,promocao_id,ml_item_id' });
        falhou('gravarItens.upsert', error);
      }
      const del = await admin.from('ml_promocao_itens').delete()
        .eq('org_id', orgId).eq('promocao_id', promocaoId).lt('sincronizado_em', rodada);
      falhou('gravarItens.delete', del.error);
      const upd = await admin.from('ml_promocoes')
        .update({ contagem, erro: null, itens_sincronizados_em: rodada })
        .eq('org_id', orgId).eq('promocao_id', promocaoId);
      falhou('gravarItens.contagem', upd.error);
    },

    async marcarErroPromocao(promocaoId, erro) {
      const { error } = await admin.from('ml_promocoes').update({ erro })
        .eq('org_id', orgId).eq('promocao_id', promocaoId);
      falhou('marcarErroPromocao', error);
    },

    async gravarEstado({ estado, erro }) {
      const agora = new Date().toISOString();
      const ok = estado === 'ok' || estado === 'sem_promocoes';
      const { error } = await admin.from('ml_promocoes_sync').upsert({
        org_id: orgId, estado, erro: erro ?? null,
        ...(ok ? { ultimo_ok_em: agora } : { ultimo_erro_em: agora }),
      }, { onConflict: 'org_id' });
      falhou('gravarEstado', error);
    },
  };
}
```

- [ ] **Step 7:** `pnpm check:functions && pnpm lint:functions` → Expected: sem erro (o `deps.ts` só é verificado pelo `deno check`).
- [ ] **Step 8: Commit** `feat(promocoes): orquestrador do sync por org com rodizio e orcamento (ADR-0170)`.

---

### Task 6: Alertas + worker `sincronizar-promocoes` + módulo na edge `usuarios` (TDD)

**Files:**
- Create: `supabase/functions/_shared/promocoes/alertas.ts`, `supabase/functions/sincronizar-promocoes/index.ts`
- Modify: `supabase/functions/usuarios/index.ts:211` (`MODULOS_VALIDOS`), `supabase/config.toml` (bloco da função nova)
- Test: `supabase/functions/_shared/promocoes/__tests__/alertas.test.ts`

**Interfaces:**
- Consumes: `ResultadoSync` (Task 5); `reservarNotificacao` (`../faturamento/notificacoes-dedupe.ts`); `notificarCategoria` (`../notificacoes/config.ts`); `requireUserOrg` (`../_shared/auth.ts`); `verificarAssinatura`, `qstashClient` (`../_shared/queue.ts`); `exigirModulo` (`../_shared/produto/modulo.ts`); `resolverConexao` (`../_shared/canais/conexao.ts`); `getValidAccessTokenConexao` (`../_shared/ml/token.ts`).
- Produces:

```ts
export interface DepsAlertas {
  ativo(): Promise<boolean>;
  reservar(entidade: 'promo_prejuizo' | 'promo_prazo', chave: string): Promise<boolean>;
  notificar(texto: string): Promise<number>;
}
export function selecionarAlertas(r: ResultadoSync, agoraMs: number): Selecao;
export function montarMensagemPromocoes(s: Selecao): string;
export function avisarPromocoes(r: ResultadoSync, agoraMs: number, deps: DepsAlertas): Promise<number>;
export function depsAlertas(admin: SupabaseClient, orgId: string): DepsAlertas;
```

- [ ] **Step 1: Teste que falha** — `__tests__/alertas.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { avisarPromocoes, montarMensagemPromocoes, selecionarAlertas, type DepsAlertas } from '../alertas.ts';
import type { ResultadoSync } from '../sincronizar.ts';
import type { LinhaItem, PromocaoML } from '../tipos.ts';

const H = 3_600_000;
const agora = Date.parse('2026-10-06T12:00:00Z');
const promo = (id: string, status: string, prazoHoras: number | null) => ({
  id, tipo: 'DEAL', nome: `Campanha ${id}`, status, inicio: null, fim: null, beneficios: null, bruto: {},
  prazo_adesao: prazoHoras == null ? null : new Date(agora + prazoHoras * H).toISOString(),
}) as PromocaoML;
const linha = (id: string, status: string, pior: LinhaItem['pior_semaforo']) =>
  ({ ml_item_id: id, status, pior_semaforo: pior, titulo: `Anúncio ${id}`, preco_avaliado: 49.9,
     projecao: [{ liquido: 8.5, custo: 12 }] }) as unknown as LinhaItem;
const r = (processadas: ResultadoSync['processadas']): ResultadoSync => ({ estado: 'ok', processadas, puladas: [] });

describe('selecionarAlertas', () => {
  it('prejuízo = participando com pior vermelho; convidado vermelho não conta', () => {
    const s = selecionarAlertas(r([{ promo: promo('S', 'started', null), linhas: [
      linha('A', 'started', 'vermelho'), linha('B', 'candidate', 'vermelho'), linha('C', 'started', 'amarelo'),
    ] }]), agora);
    expect(s.prejuizo.map((x) => x.linha.ml_item_id)).toEqual(['A']);
  });

  it('prazo = pending com adesão em ≤ 48 h (ainda aberta) e ≥ 1 convidado verde', () => {
    const s = selecionarAlertas(r([
      { promo: promo('P1', 'pending', 47), linhas: [linha('A', 'candidate', 'verde')] },
      { promo: promo('P2', 'pending', 49), linhas: [linha('A', 'candidate', 'verde')] },
      { promo: promo('P3', 'pending', 10), linhas: [linha('A', 'candidate', 'amarelo')] },
      { promo: promo('P4', 'pending', -1), linhas: [linha('A', 'candidate', 'verde')] },
    ]), agora);
    expect(s.prazo).toEqual([{ promo: expect.objectContaining({ id: 'P1' }), verdes: 1 }]);
  });
});

describe('avisarPromocoes', () => {
  type D = DepsAlertas & { notificar: ReturnType<typeof vi.fn>; reservar: ReturnType<typeof vi.fn> };
  const deps = (o: Partial<DepsAlertas> = {}): D =>
    ({ ativo: vi.fn(async () => true), reservar: vi.fn(async () => true), notificar: vi.fn(async () => 1), ...o }) as unknown as D;
  const res = r([
    { promo: promo('S', 'started', null), linhas: [linha('A', 'started', 'vermelho'), linha('B', 'started', 'vermelho')] },
    { promo: promo('P', 'pending', 24), linhas: [linha('C', 'candidate', 'verde')] },
  ]);

  it('switch desligado: não reserva nem envia', async () => {
    const d = deps({ ativo: vi.fn(async () => false) });
    expect(await avisarPromocoes(res, agora, d)).toBe(0);
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('uma mensagem agregada só com o que reservou agora', async () => {
    const d = deps();
    d.reservar.mockImplementation(async (_e: string, chave: string) => chave !== 'S:B');
    await avisarPromocoes(res, agora, d);
    expect(d.reservar).toHaveBeenCalledWith('promo_prejuizo', 'S:A');
    expect(d.reservar).toHaveBeenCalledWith('promo_prazo', 'P');
    expect(d.notificar).toHaveBeenCalledTimes(1);
    const texto = d.notificar.mock.calls[0][0] as string;
    expect(texto).toContain('Anúncio A');
    expect(texto).not.toContain('Anúncio B');
    expect(texto).toContain('Campanha P');
  });

  it('nada reservado → nenhuma mensagem', async () => {
    const d = deps({ reservar: vi.fn(async () => false) });
    expect(await avisarPromocoes(res, agora, d)).toBe(0);
    expect(d.notificar).not.toHaveBeenCalled();
  });
});

describe('montarMensagemPromocoes', () => {
  it('lista até 10 anúncios, resume o resto e não usa "margem"/"lucro"', () => {
    const linhas = Array.from({ length: 12 }, (_, i) => ({ promo: promo('S', 'started', null), linha: linha(`X${i}`, 'started', 'vermelho') }));
    const t = montarMensagemPromocoes({ prejuizo: linhas, prazo: [] });
    expect(t).toContain('e mais 2');
    expect(t).not.toMatch(/margem|lucro/i);
  });
});
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/alertas.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar `alertas.ts`**

```ts
// ADR-0170 §9 — alertas da Central de Promoções: participando no prejuízo e prazo acabando.
// Uma mensagem por org por execução, só com o que reservou agora (o 1º sync não despeja histórico).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { ResultadoSync } from './sincronizar.ts';
import type { LinhaItem, PromocaoML } from './tipos.ts';

const JANELA_PRAZO_MS = 48 * 3_600_000;
const MAX_LISTADOS = 10;

export interface DepsAlertas {
  ativo(): Promise<boolean>;
  reservar(entidade: 'promo_prejuizo' | 'promo_prazo', chave: string): Promise<boolean>;
  notificar(texto: string): Promise<number>;
}
export type Selecao = { prejuizo: { promo: PromocaoML; linha: LinhaItem }[]; prazo: { promo: PromocaoML; verdes: number }[] };

export function selecionarAlertas(r: ResultadoSync, agoraMs: number): Selecao {
  const s: Selecao = { prejuizo: [], prazo: [] };
  for (const { promo, linhas } of r.processadas) {
    for (const l of linhas) {
      if (l.status === 'started' && l.pior_semaforo === 'vermelho') s.prejuizo.push({ promo, linha: l });
    }
    const prazo = promo.prazo_adesao ? Date.parse(promo.prazo_adesao) : NaN;
    if (promo.status === 'pending' && Number.isFinite(prazo) && prazo > agoraMs && prazo - agoraMs <= JANELA_PRAZO_MS) {
      const verdes = linhas.filter((l) => l.status !== 'started' && l.pior_semaforo === 'verde').length;
      if (verdes > 0) s.prazo.push({ promo, verdes });
    }
  }
  return s;
}

const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function montarMensagemPromocoes(s: Selecao): string {
  const partes: string[] = [];
  if (s.prejuizo.length) {
    partes.push(`🔴 Promoções: ${s.prejuizo.length} anúncio(s) participando com líquido abaixo do custo`);
    for (const { promo, linha } of s.prejuizo.slice(0, MAX_LISTADOS)) {
      const pior = linha.projecao.find((p) => p.liquido != null && p.custo != null && p.liquido < p.custo);
      partes.push(`• ${linha.titulo ?? linha.ml_item_id} (${linha.ml_item_id}) em ${promo.nome ?? promo.id}: ` +
        `preço ${brl(linha.preco_avaliado)}, líquido ${brl(pior?.liquido)}, custo ${brl(pior?.custo)}`);
    }
    if (s.prejuizo.length > MAX_LISTADOS) partes.push(`e mais ${s.prejuizo.length - MAX_LISTADOS}.`);
  }
  for (const { promo, verdes } of s.prazo) {
    const prazo = promo.prazo_adesao ? new Date(promo.prazo_adesao).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    partes.push(`⏰ ${promo.nome ?? promo.id}: adesão até ${prazo}, ${verdes} anúncio(s) convidado(s) com líquido acima do mínimo.`);
  }
  partes.push('Veja em Promoções no PubliAI.');
  return partes.join('\n');
}

export async function avisarPromocoes(r: ResultadoSync, agoraMs: number, deps: DepsAlertas): Promise<number> {
  const s = selecionarAlertas(r, agoraMs);
  if (!s.prejuizo.length && !s.prazo.length) return 0;
  if (!(await deps.ativo())) return 0;
  const novos: Selecao = { prejuizo: [], prazo: [] };
  for (const x of s.prejuizo) {
    if (await deps.reservar('promo_prejuizo', `${x.promo.id}:${x.linha.ml_item_id}`)) novos.prejuizo.push(x);
  }
  for (const x of s.prazo) {
    if (await deps.reservar('promo_prazo', x.promo.id)) novos.prazo.push(x);
  }
  if (!novos.prejuizo.length && !novos.prazo.length) return 0;
  return deps.notificar(montarMensagemPromocoes(novos));
}

export function depsAlertas(admin: SupabaseClient, orgId: string): DepsAlertas {
  return {
    async ativo() {
      const { data, error } = await admin.from('configuracoes')
        .select('alertas_promocoes_ativo').eq('org_id', orgId).maybeSingle();
      if (error) throw new Error(`alertas_promocoes_ativo: ${error.message}`);
      return data?.alertas_promocoes_ativo === true;
    },
    reservar: (entidade, chave) => reservarNotificacao(admin, orgId, null, entidade, chave),
    notificar: (texto) => notificarCategoria(admin, orgId, 'financeiro', texto),
  };
}
```

O emoji aqui é do **texto do Telegram** (mesmo padrão das mensagens de `_shared/notificacoes/telegram.ts`), não da UI.
- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/promocoes/__tests__/alertas.test.ts` → Expected: PASS.
- [ ] **Step 5: Worker** — `supabase/functions/sincronizar-promocoes/index.ts`:

```ts
// ADR-0170 — sync da Central de Promoções. Três modos:
//  - QStash sem org_id (schedule 6/6 h): publica 1 mensagem por org com o módulo.
//  - QStash com org_id: sincroniza essa org.
//  - Usuário logado ("Atualizar agora"): só a própria org, com throttle de 2 min.
// Só GET no ML (ver _shared/promocoes/ml.ts).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { sincronizarOrg } from '../_shared/promocoes/sincronizar.ts';
import { depsSync } from '../_shared/promocoes/deps.ts';
import { avisarPromocoes, depsAlertas } from '../_shared/promocoes/alertas.ts';

const LIMITE_MS = 120_000;
const CONCORRENCIA = 6;
const THROTTLE_MS = 2 * 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function sincronizar(admin: ReturnType<typeof adminClient>, orgId: string) {
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) {
    await admin.from('ml_promocoes_sync').upsert(
      { org_id: orgId, estado: 'sem_acesso', erro: 'Organização sem conexão com o Mercado Livre.', ultimo_erro_em: new Date().toISOString() },
      { onConflict: 'org_id' });
    return { estado: 'sem_acesso' as const };
  }
  await admin.from('ml_promocoes_sync').upsert(
    { org_id: orgId, estado: 'sincronizando', iniciado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  const token = await getValidAccessTokenConexao(conexao);
  const r = await sincronizarOrg(depsSync(admin, { orgId, mlUserId: conexao.contaExternaId, token }),
    { limiteMs: LIMITE_MS, concorrencia: CONCORRENCIA });
  try {
    await avisarPromocoes(r, Date.now(), depsAlertas(admin, orgId));
  } catch (e) {
    console.error('[sincronizar-promocoes] alertas falharam (sync mantido):', e);
  }
  return { estado: r.estado, processadas: r.processadas.length, puladas: r.puladas.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  const admin = adminClient();

  try {
    if (req.headers.get('upstash-signature')) {
      if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
      let payload: { org_id?: string } = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio */ }

      if (!payload.org_id) {
        // Fan-out: uma execução por org, cada uma com o próprio orçamento de tempo.
        const { data: orgs, error } = await admin.from('organizations').select('id').contains('modulos_habilitados', ['promocoes']);
        if (error) throw new Error(`orgs com módulo: ${error.message}`);
        const alvo = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-promocoes`;
        for (const o of orgs ?? []) {
          await qstashClient().publishJSON({ url: alvo, body: { org_id: o.id }, retries: 1 });
        }
        return json({ ok: true, orgs: (orgs ?? []).length });
      }
      if (!(await exigirModulo(admin, payload.org_id, 'promocoes'))) return json({ ok: false, erro: 'Módulo desabilitado.' }, 403);
      return json({ ok: true, ...(await sincronizar(admin, payload.org_id)) });
    }

    let orgId: string;
    try {
      ({ orgId } = await requireUserOrg(req, { access: 'write' }));
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }
    if (!(await exigirModulo(admin, orgId, 'promocoes'))) {
      return json({ ok: false, erro: 'A Central de Promoções não está habilitada para esta organização.' }, 403);
    }
    const { data: estado } = await admin.from('ml_promocoes_sync').select('iniciado_em').eq('org_id', orgId).maybeSingle();
    const ultimo = estado?.iniciado_em ? Date.parse(estado.iniciado_em) : NaN;
    if (Number.isFinite(ultimo) && Date.now() - ultimo < THROTTLE_MS) {
      return json({ ok: false, erro: 'Atualização feita há menos de 2 minutos. Tente de novo em instantes.' }, 429);
    }
    return json({ ok: true, ...(await sincronizar(admin, orgId)) });
  } catch (e) {
    console.error('[sincronizar-promocoes]', e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 6: `verify_jwt`.** Em `supabase/config.toml`, copiar o bloco `[functions.monitorar-moderados]` como `[functions.sincronizar-promocoes]` (mesmo `verify_jwt = false`): a função valida a assinatura QStash ou o JWT do usuário por conta própria (ADR-0046). Se `monitorar-moderados` não tiver bloco (deploy com flag), usar a mesma flag no deploy da Task 10 e registrar isso aqui.
- [ ] **Step 7: Módulo na edge `usuarios`** — em `supabase/functions/usuarios/index.ts:211`:

```ts
      const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal', 'promocoes'];
```

- [ ] **Step 8:** `pnpm check:functions && pnpm lint:functions && pnpm test -- supabase/functions/_shared/promocoes` → Expected: tudo verde.
- [ ] **Step 9: Commit** `feat(promocoes): worker sincronizar-promocoes e alertas (ADR-0170)`.

---

### Task 7: Frontend base — menu, módulo, rota, leitura e switch de alertas (TDD)

**Files:**
- Modify: `src/lib/menus.ts`, `src/lib/modulos.ts`, `src/components/sidebar.tsx:16-27`, `src/App.tsx` (lazy import + 2 rotas junto de `/publicados`)
- Modify: `src/lib/queries.ts` (após `upsertMonitorFreteAtivo`), `src/hooks/useConfiguracoes.ts` (após `useSalvarMonitorFreteAtivo`), `src/components/configuracoes/secao-notificacoes.tsx`
- Create: `src/lib/promocoes.ts`, `src/hooks/usePromocoes.ts`
- Test: `src/lib/__tests__/promocoes.test.ts`, `src/lib/__tests__/menus.test.ts` (acrescentar), `src/lib/__tests__/modulos.test.ts` (acrescentar)

**Interfaces:**
- Consumes: tabelas da Task 1; edge `sincronizar-promocoes` (Task 6) — resposta `{ ok, erro?, estado?, processadas?, puladas? }`, 429 no throttle.
- Produces (usado pelas Tasks 8-9):

```ts
// src/lib/promocoes.ts
export type SemaforoPromo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface ContagemPromo { convidados: number; participando: number; verde: number; amarelo: number; vermelho: number; indisponivel: number; participando_vermelho: number }
export interface Promocao { promocao_id: string; tipo: string; nome: string | null; status: string; inicio: string | null; fim: string | null; prazo_adesao: string | null; beneficios: Record<string, unknown> | null; contagem: ContagemPromo | null; erro: string | null; itens_sincronizados_em: string | null }
export interface CorProjetada { variation_id: number | null; cor: string | null; sku: string | null; custo: number | null; piso: number | null; origem: string | null; liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null; semaforo: SemaforoPromo; motivo: string | null }
export interface ItemPromocao { ml_item_id: string; status: string; preco_original: number | null; preco_promo: number | null; preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; preco_avaliado: number | null; ml_pct: number | null; estoque_min: number | null; titulo: string | null; thumbnail: string | null; permalink: string | null; projecao: CorProjetada[]; pior_semaforo: SemaforoPromo }
export interface EstadoSyncPromo { estado: 'sincronizando' | 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro'; iniciado_em: string | null; ultimo_ok_em: string | null; ultimo_erro_em: string | null; erro: string | null }
export type AbaPromo = 'ativas' | 'futuras' | 'encerradas';
export const URL_PROMOCOES_ML: string;
export function ehCupom(tipo: string): boolean;
export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null;
export function rotuloTipo(tipo: string): string;
export function descontoPct(original: number | null, promo: number | null): number | null;
export function mlBancaPct(beneficios: Record<string, unknown> | null): number | null;
export function prazoUrgente(prazo: string | null, agoraMs: number): boolean;
export function corDeReferencia(it: ItemPromocao): CorProjetada | null;
export function ateQuantoDaLinha(it: ItemPromocao): { valor: number | null; motivo: 'qualquer' | 'nenhum' | null };
export function fetchPromocoes(): Promise<Promocao[]>;
export function fetchItensPromocao(promocaoId: string): Promise<ItemPromocao[]>;
export function fetchEstadoSyncPromocoes(): Promise<EstadoSyncPromo | null>;
// src/hooks/usePromocoes.ts
export function usePromocoes(): UseQueryResult<Promocao[]>;
export function useItensPromocao(promocaoId: string): UseQueryResult<ItemPromocao[]>;
export function useEstadoSyncPromocoes(): UseQueryResult<EstadoSyncPromo | null>;
export function useAtualizarPromocoes(): UseMutationResult<unknown, Error, void>;
```

- [ ] **Step 1: Teste que falha** — `src/lib/__tests__/promocoes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  abaDa, ateQuantoDaLinha, corDeReferencia, descontoPct, ehCupom, mlBancaPct, prazoUrgente, rotuloTipo,
  type CorProjetada, type ItemPromocao,
} from '../promocoes';

const agora = Date.parse('2026-10-06T12:00:00Z');
const dia = 86_400_000;
const cor = (o: Partial<CorProjetada>): CorProjetada => ({
  variation_id: null, cor: null, sku: null, custo: 10, piso: 20, origem: 'nacional', liquido: 25,
  ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null, ...o,
});
const item = (projecao: CorProjetada[], pior: ItemPromocao['pior_semaforo']) =>
  ({ projecao, pior_semaforo: pior }) as ItemPromocao;

describe('abas', () => {
  it('started → ativas, pending → futuras, finished nos últimos 30 dias → encerradas', () => {
    expect(abaDa({ status: 'started', fim: null }, agora)).toBe('ativas');
    expect(abaDa({ status: 'pending', fim: null }, agora)).toBe('futuras');
    expect(abaDa({ status: 'finished', fim: new Date(agora - 10 * dia).toISOString() }, agora)).toBe('encerradas');
    expect(abaDa({ status: 'finished', fim: new Date(agora - 31 * dia).toISOString() }, agora)).toBeNull();
  });
});

describe('rótulos e números', () => {
  it('cupom e tipos', () => {
    expect(ehCupom('SELLER_COUPON_CAMPAIGN')).toBe(true);
    expect(rotuloTipo('LIGHTNING')).toBe('Relâmpago');
    expect(rotuloTipo('XYZ')).toBe('XYZ');
  });
  it('desconto % arredondado, ML banca do bloco de benefícios', () => {
    expect(descontoPct(59.9, 49.9)).toBe(17);
    expect(descontoPct(null, 49.9)).toBeNull();
    expect(mlBancaPct({ meli_percent: 30 })).toBe(30);
    expect(mlBancaPct(null)).toBeNull();
  });
  it('prazo urgente = adesão em até 48 h e ainda aberta', () => {
    expect(prazoUrgente(new Date(agora + 47 * 3_600_000).toISOString(), agora)).toBe(true);
    expect(prazoUrgente(new Date(agora + 49 * 3_600_000).toISOString(), agora)).toBe(false);
    expect(prazoUrgente(new Date(agora - 1000).toISOString(), agora)).toBe(false);
    expect(prazoUrgente(null, agora)).toBe(false);
  });
});

describe('linha da tabela', () => {
  it('cor de referência = a pior cor com líquido (menor líquido no empate)', () => {
    const it0 = item([cor({ cor: 'Azul', liquido: 30 }), cor({ cor: 'Rosa', liquido: 5, semaforo: 'vermelho' }), cor({ cor: 'Verde', liquido: null, semaforo: 'indisponivel' })], 'vermelho');
    expect(corDeReferencia(it0)?.cor).toBe('Rosa');
    expect(corDeReferencia(item([cor({ liquido: null, semaforo: 'indisponivel' })], 'indisponivel'))).toBeNull();
  });
  it('até quanto do anúncio = o maior entre as cores (tem que servir a todas)', () => {
    expect(ateQuantoDaLinha(item([cor({ ate_quanto: 40 }), cor({ ate_quanto: 44 })], 'verde'))).toEqual({ valor: 44, motivo: null });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto: 40 }), cor({ ate_quanto_motivo: 'nenhum' })], 'verde'))).toEqual({ valor: null, motivo: 'nenhum' });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto_motivo: 'qualquer' }), cor({ ate_quanto_motivo: 'qualquer' })], 'verde'))).toEqual({ valor: null, motivo: 'qualquer' });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto_motivo: 'qualquer' }), cor({ ate_quanto: 41 })], 'verde'))).toEqual({ valor: 41, motivo: null });
    expect(ateQuantoDaLinha(item([cor({})], 'verde'))).toEqual({ valor: null, motivo: null });
  });
});
```

Acrescentar em `src/lib/__tests__/menus.test.ts` (e `menuKeyForPath` ao import de `'../menus'` do topo):

```ts
describe('rota de promoções', () => {
  it('detalhe da campanha pertence ao menu promocoes', () => {
    expect(menuKeyForPath('/promocoes/P-MLB1')).toBe('promocoes');
  });
});
```

Acrescentar em `src/lib/__tests__/modulos.test.ts` (no `describe` existente):

```ts
  it('sem o módulo promocoes, o menu promocoes some', () => {
    expect(menusDeModulosDesabilitados(['estoque'])).toContain('promocoes');
    expect(menusDeModulosDesabilitados(['promocoes'])).not.toContain('promocoes');
  });
```

- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/promocoes.test.ts src/lib/__tests__/menus.test.ts src/lib/__tests__/modulos.test.ts` → Expected: FAIL.
- [ ] **Step 3: Menu e módulo.** `src/lib/menus.ts`: em `MENU_KEYS`, inserir `'promocoes'` logo após `'publicados'`; em `PREFIX`, acrescentar `promocoes: 'promocoes',` após `publicados`. `src/lib/modulos.ts`: `export type ModuloId = 'estoque' | 'pulse' | 'fiscal' | 'promocoes';` e acrescentar ao fim de `MODULOS`:

```ts
  {
    id: 'promocoes',
    nome: 'Promoções',
    descricao: 'Campanhas do Mercado Livre com o líquido projetado de cada anúncio convidado (ADR-0170).',
    menu: 'promocoes',
  },
```

`src/components/sidebar.tsx`: importar `BadgePercent` de `lucide-react` e inserir após a linha de Publicados:

```tsx
  { to: '/promocoes', label: 'Promoções', icon: BadgePercent, end: false, key: 'promocoes' },
```

`src/App.tsx`: junto dos outros `lazy`:

```tsx
const Promocoes = lazy(() => import('@/pages/Promocoes'));
const PromocaoDetalhe = lazy(() => import('@/pages/PromocaoDetalhe'));
```

e logo abaixo de `<Route path="/publicados/vendas" element={<DetalheVendas />} />`:

```tsx
<Route path="/promocoes" element={<Promocoes />} />
<Route path="/promocoes/:promocaoId" element={<PromocaoDetalhe />} />
```

(As páginas nascem na Task 8/9; até lá, criar `src/pages/Promocoes.tsx` e `src/pages/PromocaoDetalhe.tsx` com `export default function Promocoes() { return null; }` / `export default function PromocaoDetalhe() { return null; }` para o build passar.)
- [ ] **Step 4: `src/lib/promocoes.ts`**

```ts
// ADR-0170 — leitura da Central de Promoções (o sync grava; aqui só lemos) + regras de exibição puras.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';

export type SemaforoPromo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface ContagemPromo {
  convidados: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
}
export interface Promocao {
  promocao_id: string; tipo: string; nome: string | null; status: string;
  inicio: string | null; fim: string | null; prazo_adesao: string | null;
  beneficios: Record<string, unknown> | null; contagem: ContagemPromo | null;
  erro: string | null; itens_sincronizados_em: string | null;
}
export interface CorProjetada {
  variation_id: number | null; cor: string | null; sku: string | null;
  custo: number | null; piso: number | null; origem: string | null;
  liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null;
  semaforo: SemaforoPromo; motivo: string | null;
}
export interface ItemPromocao {
  ml_item_id: string; status: string;
  preco_original: number | null; preco_promo: number | null; preco_min: number | null; preco_max: number | null;
  preco_sugerido: number | null; preco_avaliado: number | null; ml_pct: number | null; estoque_min: number | null;
  titulo: string | null; thumbnail: string | null; permalink: string | null;
  projecao: CorProjetada[]; pior_semaforo: SemaforoPromo;
}
export interface EstadoSyncPromo {
  estado: 'sincronizando' | 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
  iniciado_em: string | null; ultimo_ok_em: string | null; ultimo_erro_em: string | null; erro: string | null;
}
export type AbaPromo = 'ativas' | 'futuras' | 'encerradas';

/** Área de promoções do Seller Center (confirmada na Task 0 do plano). */
export const URL_PROMOCOES_ML = 'https://www.mercadolivre.com.br/anuncios/promocoes';

const TIPOS: Record<string, string> = {
  DEAL: 'Campanha', MARKETPLACE_CAMPAIGN: 'Campanha do ML', SMART: 'Co-participação',
  LIGHTNING: 'Relâmpago', PRICE_MATCHING: 'Preço competitivo', PRICE_DISCOUNT: 'Desconto próprio',
  SELLER_COUPON_CAMPAIGN: 'Cupom', VOLUME: 'Desconto por volume',
};
const DIA = 86_400_000;

export const ehCupom = (tipo: string) => tipo === 'SELLER_COUPON_CAMPAIGN';
export const rotuloTipo = (tipo: string) => TIPOS[tipo] ?? tipo;

export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null {
  if (p.status === 'started') return 'ativas';
  if (p.status === 'pending') return 'futuras';
  const fim = p.fim ? Date.parse(p.fim) : NaN;
  return Number.isFinite(fim) && fim >= agoraMs - 30 * DIA ? 'encerradas' : null;
}

export function descontoPct(original: number | null, promo: number | null): number | null {
  if (original == null || promo == null || original <= 0) return null;
  return Math.round((1 - promo / original) * 100);
}

export function mlBancaPct(beneficios: Record<string, unknown> | null): number | null {
  const n = Number(beneficios?.meli_percent);
  return beneficios?.meli_percent == null || !Number.isFinite(n) ? null : n;
}

export function prazoUrgente(prazo: string | null, agoraMs: number): boolean {
  const t = prazo ? Date.parse(prazo) : NaN;
  return Number.isFinite(t) && t > agoraMs && t - agoraMs <= 2 * DIA;
}

/** A cor que dá o semáforo do anúncio (a pior com líquido; menor líquido no empate). */
export function corDeReferencia(it: ItemPromocao): CorProjetada | null {
  const comLiquido = it.projecao.filter((c) => c.liquido != null && c.semaforo === it.pior_semaforo);
  return comLiquido.sort((a, b) => a.liquido! - b.liquido!)[0] ?? null;
}

/** O preço tem de servir a todas as cores: vale o maior "até quanto"; uma cor sem saída trava o anúncio. */
export function ateQuantoDaLinha(it: ItemPromocao): { valor: number | null; motivo: 'qualquer' | 'nenhum' | null } {
  const cores = it.projecao.filter((c) => c.liquido != null);
  if (cores.some((c) => c.ate_quanto_motivo === 'nenhum')) return { valor: null, motivo: 'nenhum' };
  const valores = cores.map((c) => c.ate_quanto).filter((v): v is number => v != null);
  if (valores.length) return { valor: Math.max(...valores), motivo: null };
  if (cores.length && cores.every((c) => c.ate_quanto_motivo === 'qualquer')) return { valor: null, motivo: 'qualquer' };
  return { valor: null, motivo: null };
}

const COLS_PROMO = 'promocao_id, tipo, nome, status, inicio, fim, prazo_adesao, beneficios, contagem, erro, itens_sincronizados_em';
const COLS_ITEM = 'ml_item_id, status, preco_original, preco_promo, preco_min, preco_max, preco_sugerido, preco_avaliado, ml_pct, estoque_min, titulo, thumbnail, permalink, projecao, pior_semaforo';

export async function fetchPromocoes(): Promise<Promocao[]> {
  const { data, error } = await supabase.from('ml_promocoes').select(COLS_PROMO)
    .order('prazo_adesao', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Promocao[];
}

export async function fetchItensPromocao(promocaoId: string): Promise<ItemPromocao[]> {
  return buscarTodasPaginas<ItemPromocao>((de, ate) =>
    supabase.from('ml_promocao_itens').select(COLS_ITEM).eq('promocao_id', promocaoId)
      .order('ml_item_id').range(de, ate) as never);
}

export async function fetchEstadoSyncPromocoes(): Promise<EstadoSyncPromo | null> {
  const { data, error } = await supabase.from('ml_promocoes_sync')
    .select('estado, iniciado_em, ultimo_ok_em, ultimo_erro_em, erro').maybeSingle();
  if (error) throw error;
  return (data as EstadoSyncPromo | null) ?? null;
}
```

Conferir a assinatura de `buscarTodasPaginas` em `src/lib/paginacao-supabase.ts` e usar o mesmo formato de chamada de `src/lib/anuncio-canonico.ts:30`. A RLS já limita à org do usuário; não filtrar por `org_id` no front (padrão das telas).
- [ ] **Step 5:** `pnpm test -- src/lib/__tests__/promocoes.test.ts src/lib/__tests__/menus.test.ts src/lib/__tests__/modulos.test.ts` → Expected: PASS. Rodar também `pnpm test -- src/lib src/components/__tests__` para pegar teste que lista `MENU_KEYS` inteiro; se algum quebrar só por causa da chave nova, atualizar a lista esperada.
- [ ] **Step 6: `src/hooks/usePromocoes.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchEstadoSyncPromocoes, fetchItensPromocao, fetchPromocoes } from '@/lib/promocoes';

const QK_PROMO = ['promocoes'] as const;

export function usePromocoes() {
  return useQuery({ queryKey: [...QK_PROMO, 'lista'], queryFn: fetchPromocoes, staleTime: 60_000 });
}
export function useItensPromocao(promocaoId: string) {
  return useQuery({ queryKey: [...QK_PROMO, 'itens', promocaoId], queryFn: () => fetchItensPromocao(promocaoId), staleTime: 60_000 });
}
export function useEstadoSyncPromocoes() {
  return useQuery({ queryKey: [...QK_PROMO, 'estado'], queryFn: fetchEstadoSyncPromocoes, staleTime: 30_000 });
}

/** "Atualizar agora": o worker responde ao fim do sync (até ~2 min). 429 = atualizado há < 2 min. */
export function useAtualizarPromocoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sincronizar-promocoes', { body: {} });
      if (error) {
        const corpo = await (error as { context?: Response }).context?.json().catch(() => null);
        throw new Error((corpo as { erro?: string } | null)?.erro ?? 'Não foi possível atualizar as promoções.');
      }
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK_PROMO }),
  });
}
```

- [ ] **Step 7: Switch de alertas.** Em `src/lib/queries.ts`, logo após `upsertMonitorFreteAtivo`:

```ts
export async function fetchAlertasPromocoesAtivo(): Promise<boolean> {
  const orgId = effectiveOrgId();
  if (!orgId) return false;
  const { data } = await supabase.from('configuracoes')
    .select('alertas_promocoes_ativo').eq('org_id', orgId).maybeSingle();
  return data?.alertas_promocoes_ativo ?? false;
}

export async function upsertAlertasPromocoesAtivo(ativo: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = effectiveOrgId();
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, alertas_promocoes_ativo: ativo, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}
```

Em `src/hooks/useConfiguracoes.ts`, após `useSalvarMonitorFreteAtivo` (e importar as duas funções):

```ts
export function useAlertasPromocoesAtivo() {
  return useQuery({ queryKey: ['configuracoes', 'alertas_promocoes_ativo'], queryFn: fetchAlertasPromocoesAtivo });
}
export function useSalvarAlertasPromocoesAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertAlertasPromocoesAtivo(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'alertas_promocoes_ativo'] }),
  });
}
```

Em `secao-notificacoes.tsx`, importar os dois hooks, declarar `const { data: alertasPromoAtivo } = useAlertasPromocoesAtivo(); const salvarAlertasPromo = useSalvarAlertasPromocoesAtivo();` e acrescentar após o grupo "Monitor de frete":

```tsx
      <SettingsGroup titulo="Promoções" descricao="Avisos da Central de Promoções, conferidos a cada atualização." aviso={aviso}>
        <SettingsRow
          titulo="Avisar sobre promoções"
          descricao="Anúncio participando com líquido abaixo do custo, e campanha com adesão fechando em até 48 h que tem anúncios acima do mínimo. O aviso vai para quem recebe a categoria Financeiro (ADR-0170)."
          estado={<EstadoSalvo estado={estadoDeMutation(salvarAlertasPromo)} />}
        >
          <Switch
            checked={alertasPromoAtivo ?? false}
            disabled={!podeEditarConfig}
            onCheckedChange={(v) => salvarAlertasPromo.mutate(v)}
            aria-label="Promoções: avisar sobre anúncios no prejuízo e prazos de adesão"
          />
        </SettingsRow>
      </SettingsGroup>
```

Se existir `src/components/configuracoes/__tests__/secao-notificacoes.test.tsx` (criado no ADR-0169), acrescentar o mock dos dois hooks novos no mesmo formato dos do monitor de frete e um caso "switch de promoções chama o mutate com true".
- [ ] **Step 8:** `pnpm test -- src/lib src/components/configuracoes src/hooks` e `pnpm build` → Expected: verde.
- [ ] **Step 9: Commit** `feat(promocoes): menu, modulo, leitura e switch de alertas no front (ADR-0170)`.

---

### Task 8: Tela 1 — campanhas (TDD)

**Files:**
- Create: `src/components/promocoes/contagem-semaforo.tsx`, `src/components/promocoes/card-campanha.tsx`, `src/components/promocoes/painel-estado-sync.tsx`
- Modify: `src/pages/Promocoes.tsx` (substitui o stub)
- Test: `src/components/promocoes/__tests__/painel-estado-sync.test.tsx`, `src/components/promocoes/__tests__/card-campanha.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`@/lib/promocoes`, `@/hooks/usePromocoes`); `PageHeader`, `EmptyState`, `StatusPill`, `Skeleton`, `Tabs*`, `Button`, `Card` de `@/components/ui/*`; `CanalTabs` de `@/components/canal-tabs`; `useCanalAtivo` de `@/hooks/useCanalAtivo`; `fmtBRL`, `fmtInt` de `@/lib/formato`.
- Produces: `ContagemSemaforo({ contagem, ativo?, onFiltro? })` (reusada na Task 9), `CardCampanha({ promocao, agoraMs })`, `PainelEstadoSync({ estado, temDados, onAtualizar, atualizando })`.

- [ ] **Step 1: Teste que falha** — `src/components/promocoes/__tests__/painel-estado-sync.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render as renderRtl, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { PainelEstadoSync } from '../painel-estado-sync';

const render = (ui: ReactElement) => renderRtl(<MemoryRouter>{ui}</MemoryRouter>);

describe('PainelEstadoSync', () => {
  it('nunca sincronizado: convida a buscar', () => {
    const onAtualizar = vi.fn();
    render(<PainelEstadoSync estado={null} temDados={false} onAtualizar={onAtualizar} atualizando={false} />);
    expect(screen.getByText('Ainda não buscamos as promoções desta conta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar promoções agora' }));
    expect(onAtualizar).toHaveBeenCalled();
  });

  it('sem acesso: explica e aponta Canais', () => {
    render(<PainelEstadoSync estado={{ estado: 'sem_acesso', iniciado_em: null, ultimo_ok_em: null, ultimo_erro_em: null, erro: 'ML 403' }}
      temDados={false} onAtualizar={() => {}} atualizando={false} />);
    expect(screen.getByText('O Mercado Livre não liberou promoções para esta conta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconectar em Canais' }).getAttribute('href')).toContain('/canais');
  });

  it('erro com dados antigos: faixa de aviso, não esconde os dados', () => {
    render(<PainelEstadoSync estado={{ estado: 'erro', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: '2026-10-06T17:00:00Z', erro: 'x' }}
      temDados onAtualizar={() => {}} atualizando={false} />);
    expect(screen.getByText(/A última atualização falhou/)).toBeTruthy();
  });

  it('ok com dados: não renderiza nada', () => {
    const { container } = render(<PainelEstadoSync estado={{ estado: 'ok', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: null, erro: null }}
      temDados onAtualizar={() => {}} atualizando={false} />);
    expect(container.textContent).toBe('');
  });
});
```

`src/components/promocoes/__tests__/card-campanha.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CardCampanha } from '../card-campanha';
import type { Promocao } from '@/lib/promocoes';

const agora = Date.parse('2026-10-06T12:00:00Z');
const base: Promocao = {
  promocao_id: 'P-1', tipo: 'DEAL', nome: '10.10', status: 'pending', inicio: null, fim: null,
  prazo_adesao: new Date(agora + 24 * 3_600_000).toISOString(), beneficios: null, erro: null, itens_sincronizados_em: null,
  contagem: { convidados: 504, participando: 0, verde: 310, amarelo: 120, vermelho: 40, indisponivel: 34, participando_vermelho: 0 },
};
const renderCard = (p: Promocao) => render(<MemoryRouter><CardCampanha promocao={p} agoraMs={agora} /></MemoryRouter>);

describe('CardCampanha', () => {
  it('mostra convidados, contagem e prazo urgente; link para o detalhe', () => {
    renderCard(base);
    expect(screen.getByText('504 anúncios convidados')).toBeTruthy();
    expect(screen.getByText('310')).toBeTruthy();
    expect(screen.getByText(/Adesão até/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/promocoes/P-1');
  });

  it('participando no prejuízo aparece em destaque', () => {
    renderCard({ ...base, status: 'started', contagem: { ...base.contagem!, participando: 12, participando_vermelho: 2 } });
    expect(screen.getByText('2 participando com líquido abaixo do custo')).toBeTruthy();
  });

  it('cupom: informativo, sem contagem e sem link', () => {
    renderCard({ ...base, tipo: 'SELLER_COUPON_CAMPAIGN', contagem: null });
    expect(screen.getByText('Cupom vale no carrinho; sem cálculo de líquido.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('nenhuma palavra proibida', () => {
    const { container } = renderCard(base);
    expect(container.textContent).not.toMatch(/margem|lucro|candidato/i);
  });
});
```

- [ ] **Step 2:** `pnpm test -- src/components/promocoes` → Expected: FAIL.
- [ ] **Step 3: `contagem-semaforo.tsx`**

```tsx
import { CircleAlert, CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import type { ContagemPromo, SemaforoPromo } from '@/lib/promocoes';

// Mesmos tons/ícones do SemaforoPreco (src/components/semaforo-preco.tsx).
export const SEMAFORO_UI: Record<SemaforoPromo, { tone: StatusTone; label: string; Icon: typeof CircleCheck }> = {
  verde: { tone: 'success', label: 'Vale a pena', Icon: CircleCheck },
  amarelo: { tone: 'warning', label: 'Abaixo do mínimo', Icon: CircleAlert },
  vermelho: { tone: 'danger', label: 'Prejuízo', Icon: CircleX },
  indisponivel: { tone: 'neutral', label: 'Sem custo no PubliAI', Icon: CircleHelp },
};
const ORDEM: SemaforoPromo[] = ['verde', 'amarelo', 'vermelho', 'indisponivel'];

export function ContagemSemaforo({ contagem, ativo, onFiltro }: {
  contagem: ContagemPromo; ativo?: SemaforoPromo | null; onFiltro?: (s: SemaforoPromo | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ORDEM.map((s) => {
        const { tone, label, Icon } = SEMAFORO_UI[s];
        const pill = (
          <StatusPill tone={tone} title={label}>
            <Icon className="size-3.5" aria-hidden />
            <span className="tabular-nums">{fmtInt(contagem[s])}</span>
            <span className="sr-only md:not-sr-only">{label}</span>
          </StatusPill>
        );
        return onFiltro ? (
          <button key={s} type="button" aria-pressed={ativo === s} onClick={() => onFiltro(ativo === s ? null : s)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-ring">
            {pill}
          </button>
        ) : <span key={s}>{pill}</span>;
      })}
    </div>
  );
}
```

- [ ] **Step 4: `card-campanha.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import { ehCupom, mlBancaPct, prazoUrgente, rotuloTipo, type Promocao } from '@/lib/promocoes';
import { ContagemSemaforo } from './contagem-semaforo';

const STATUS: Record<string, string> = { started: 'Ativa', pending: 'Futura', finished: 'Encerrada' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CardCampanha({ promocao: p, agoraMs }: { promocao: Promocao; agoraMs: number }) {
  const cupom = ehCupom(p.tipo);
  const banca = mlBancaPct(p.beneficios);
  const corpo = (
    <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{p.nome ?? rotuloTipo(p.tipo)}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{rotuloTipo(p.tipo)} · {STATUS[p.status] ?? p.status}</span>
      </div>
      {p.prazo_adesao && p.status === 'pending' && (
        <StatusPill tone={prazoUrgente(p.prazo_adesao, agoraMs) ? 'warning' : 'neutral'}>Adesão até {dataHora(p.prazo_adesao)}</StatusPill>
      )}
      {cupom ? (
        <p className="text-sm text-muted-foreground">Cupom vale no carrinho; sem cálculo de líquido.</p>
      ) : p.contagem ? (
        <>
          <p className="text-sm text-muted-foreground">
            {p.status === 'started'
              ? `${fmtInt(p.contagem.participando)} participando · ${fmtInt(p.contagem.convidados)} convidados`
              : `${fmtInt(p.contagem.convidados)} anúncios convidados`}
            {banca != null && ` · ML banca até ${banca}%`}
          </p>
          <ContagemSemaforo contagem={p.contagem} />
          {p.contagem.participando_vermelho > 0 && (
            <StatusPill tone="danger">{fmtInt(p.contagem.participando_vermelho)} participando com líquido abaixo do custo</StatusPill>
          )}
        </>
      ) : (
        <StatusPill tone="neutral">{p.erro ?? 'Anúncios ainda não lidos'}</StatusPill>
      )}
      {p.erro && p.contagem && <p className="text-xs text-muted-foreground">Não foi possível ler os anúncios na última atualização.</p>}
    </Card>
  );
  if (cupom) return corpo;
  return (
    <Link to={`/promocoes/${encodeURIComponent(p.promocao_id)}`}
      className="group block min-h-11 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {corpo}
    </Link>
  );
}
```

- [ ] **Step 5: `painel-estado-sync.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { BadgePercent, PlugZap } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import type { EstadoSyncPromo } from '@/lib/promocoes';

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

export function PainelEstadoSync({ estado, temDados, onAtualizar, atualizando }: {
  estado: EstadoSyncPromo | null; temDados: boolean; onAtualizar: () => void; atualizando: boolean;
}) {
  if (estado?.estado === 'sincronizando' && !temDados) {
    return <EmptyState icon={BadgePercent} title="Buscando as promoções no Mercado Livre…" description="Leva até 2 minutos." />;
  }
  if (!estado && !temDados) {
    return (
      <EmptyState icon={BadgePercent} title="Ainda não buscamos as promoções desta conta."
        action={<Button onClick={onAtualizar} disabled={atualizando}>Buscar promoções agora</Button>} />
    );
  }
  if (estado?.estado === 'sem_acesso' && !temDados) {
    return (
      <EmptyState icon={PlugZap} title="O Mercado Livre não liberou promoções para esta conta."
        description="Isso depende da reputação da conta e da permissão de ofertas da conexão."
        action={<Button asChild variant="outline"><Link to="/canais">Reconectar em Canais</Link></Button>} />
    );
  }
  if (estado?.estado === 'sem_promocoes' && !temDados) {
    return (
      <EmptyState icon={BadgePercent} title="O Mercado Livre não convidou seus anúncios para nenhuma promoção agora."
        description="Campanhas novas aparecem aqui sozinhas a cada 6 horas." />
    );
  }
  if ((estado?.estado === 'erro' || estado?.estado === 'sem_acesso') && temDados) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-2 text-sm text-warning">
        <span>A última atualização falhou às {hora(estado.ultimo_erro_em)}. Mostrando dados de {hora(estado.ultimo_ok_em)}.</span>
        <Button size="sm" variant="outline" onClick={onAtualizar} disabled={atualizando}>Tentar de novo</Button>
      </div>
    );
  }
  if (estado?.estado === 'erro') {
    return (
      <EmptyState icon={BadgePercent} title="Não foi possível buscar as promoções."
        description={estado.erro ?? undefined}
        action={<Button onClick={onAtualizar} disabled={atualizando}>Tentar de novo</Button>} />
    );
  }
  return null;
}
```

Conferir que `Button` aceita `asChild`, `variant="outline"` e `size="sm"` (`src/components/ui/button.tsx`); se não aceitar `asChild`, usar `<Link className={buttonVariants({ variant: 'outline' })}>` no mesmo padrão das outras telas.
- [ ] **Step 6: `src/pages/Promocoes.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { useAtualizarPromocoes, useEstadoSyncPromocoes, usePromocoes } from '@/hooks/usePromocoes';
import { abaDa, type AbaPromo } from '@/lib/promocoes';
import { CardCampanha } from '@/components/promocoes/card-campanha';
import { PainelEstadoSync } from '@/components/promocoes/painel-estado-sync';

const VAZIO: Record<AbaPromo, string> = {
  ativas: 'Nenhuma campanha ativa.', futuras: 'Nenhuma campanha futura.', encerradas: 'Nenhuma campanha encerrada nos últimos 30 dias.',
};

function atualizadoHa(iso: string | null | undefined): string {
  if (!iso) return 'Nunca atualizado';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'Atualizado agora';
  if (min < 60) return `Atualizado há ${min} min`;
  return `Atualizado há ${Math.round(min / 60)} h`;
}

export default function Promocoes() {
  const { canal, setCanal, habilitados } = useCanalAtivo();
  const promocoes = usePromocoes();
  const estado = useEstadoSyncPromocoes();
  const atualizar = useAtualizarPromocoes();
  const [aba, setAba] = useState<AbaPromo>('ativas');
  const agora = Date.now();

  const porAba = useMemo(() => {
    const m: Record<AbaPromo, NonNullable<typeof promocoes.data>> = { ativas: [], futuras: [], encerradas: [] };
    for (const p of promocoes.data ?? []) {
      const a = abaDa(p, agora);
      if (a) m[a].push(p);
    }
    return m;
  }, [promocoes.data, agora]);

  const onAtualizar = () => atualizar.mutate(undefined, {
    onSuccess: () => toast.success('Promoções atualizadas'),
    onError: (e) => toast.error(e.message),
  });
  // Execução que caiu no meio deixa 'sincronizando' para trás: só vale se começou há < 5 min.
  const emCurso = estado.data?.estado === 'sincronizando'
    && Date.now() - Date.parse(estado.data.iniciado_em ?? '') < 5 * 60_000;
  const sincronizando = atualizar.isPending || emCurso;
  const temDados = (promocoes.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promoções"
        subtitle="Campanhas do Mercado Livre com o líquido de cada anúncio no preço da promoção."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{atualizadoHa(estado.data?.ultimo_ok_em)}</span>
            <Button onClick={onAtualizar} disabled={sincronizando}>{sincronizando ? 'Atualizando…' : 'Atualizar agora'}</Button>
          </div>
        }
      />
      <CanalTabs canal={canal} onCanal={setCanal} habilitados={habilitados} />
      <PainelEstadoSync estado={estado.data ?? null} temDados={temDados} onAtualizar={onAtualizar} atualizando={sincronizando} />

      {promocoes.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : temDados && (
        <Tabs value={aba} onValueChange={(v) => setAba(v as AbaPromo)}>
          <TabsList>
            <TabsTrigger value="ativas">Ativas ({porAba.ativas.length})</TabsTrigger>
            <TabsTrigger value="futuras">Futuras ({porAba.futuras.length})</TabsTrigger>
            <TabsTrigger value="encerradas">Encerradas</TabsTrigger>
          </TabsList>
          {porAba[aba].length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">{VAZIO[aba]}</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {porAba[aba].map((p) => <CardCampanha key={p.promocao_id} promocao={p} agoraMs={agora} />)}
            </div>
          )}
        </Tabs>
      )}
    </div>
  );
}
```

Com 1 canal, a `CanalTabs` mostra só ML (mesmo comportamento de Publicados). O botão segue o padrão de espera do ADR-0163: se `src/components/ui` tiver o componente de espera usado nos diálogos (ver `docs/decisions/0163-padrao-de-espera-em-dialogos.md`), usar ele no lugar do texto "Atualizando…".
- [ ] **Step 7:** `pnpm test -- src/components/promocoes` → Expected: PASS. `pnpm build` → Expected: verde.
- [ ] **Step 8: Commit** `feat(promocoes): tela de campanhas com estados (ADR-0170)`.

---

### Task 9: Tela 2 — detalhe da campanha + cores (TDD)

**Files:**
- Create: `src/components/promocoes/sheet-cores.tsx`
- Modify: `src/pages/PromocaoDetalhe.tsx` (substitui o stub)
- Modify: `src/lib/promocoes.ts` (acrescentar `filtrarItens`)
- Test: `src/lib/__tests__/promocoes.test.ts` (acrescentar), `src/components/promocoes/__tests__/sheet-cores.test.tsx`

**Interfaces:**
- Consumes: Task 7 e 8 (`ContagemSemaforo`, `SEMAFORO_UI`); `DataTable`, `type Column` de `@/components/ui/data-table`; `Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription` de `@/components/ui/sheet`; `Breadcrumbs`; `Tooltip*` de `@/components/ui/tooltip`; `calcularMarkup` de `@/lib/markup`; `fmtBRL`, `fmtMarkup` de `@/lib/formato`.
- Produces: `filtrarItens(itens: ItemPromocao[], f: { semaforo: SemaforoPromo | null; participando: boolean }): ItemPromocao[]`; `SheetCores({ item, onClose })`.

- [ ] **Step 1: Teste que falha** — acrescentar `filtrarItens` ao import de `'../promocoes'` do topo de `src/lib/__tests__/promocoes.test.ts` e o bloco:

```ts
describe('filtrarItens', () => {
  const it2 = (id: string, status: string, pior: ItemPromocao['pior_semaforo']) =>
    ({ ml_item_id: id, status, pior_semaforo: pior, projecao: [] }) as unknown as ItemPromocao;
  const itens = [it2('A', 'candidate', 'verde'), it2('B', 'started', 'vermelho'), it2('C', 'candidate', 'vermelho')];
  it('convidados × participando e semáforo', () => {
    expect(filtrarItens(itens, { semaforo: null, participando: false }).map((i) => i.ml_item_id)).toEqual(['A', 'C']);
    expect(filtrarItens(itens, { semaforo: null, participando: true }).map((i) => i.ml_item_id)).toEqual(['B']);
    expect(filtrarItens(itens, { semaforo: 'vermelho', participando: false }).map((i) => i.ml_item_id)).toEqual(['C']);
  });
});
```

`src/components/promocoes/__tests__/sheet-cores.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetCores } from '../sheet-cores';
import type { ItemPromocao } from '@/lib/promocoes';

const item = {
  ml_item_id: 'MLB1', titulo: 'Jogo de cama', status: 'candidate', preco_avaliado: 69.9, pior_semaforo: 'vermelho',
  projecao: [
    { variation_id: 1, cor: 'Azul', sku: null, custo: 20, piso: 30, origem: 'nacional', liquido: 32, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null },
    { variation_id: 2, cor: 'Rosa', sku: null, custo: 40, piso: 45, origem: 'nacional', liquido: 36.9, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'vermelho', motivo: null },
    { variation_id: 3, cor: 'Verde', sku: null, custo: null, piso: null, origem: null, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: 'sem_cadastro' },
  ],
} as unknown as ItemPromocao;

describe('SheetCores', () => {
  it('uma linha por cor, com líquido, markup e o motivo quando não há líquido', () => {
    render(<SheetCores item={item} onClose={() => {}} />);
    expect(screen.getByText('Azul')).toBeTruthy();
    expect(screen.getByText('Rosa')).toBeTruthy();
    expect(screen.getByText('Sem custo no PubliAI')).toBeTruthy();
    expect(screen.getByText('+60%')).toBeTruthy(); // (32 − 20) / 20
  });
});
```

- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/promocoes.test.ts src/components/promocoes` → Expected: FAIL.
- [ ] **Step 3: `filtrarItens`** — acrescentar em `src/lib/promocoes.ts`:

```ts
export function filtrarItens(itens: ItemPromocao[], f: { semaforo: SemaforoPromo | null; participando: boolean }): ItemPromocao[] {
  return itens.filter((i) => (i.status === 'started') === f.participando && (f.semaforo == null || i.pior_semaforo === f.semaforo));
}
```

- [ ] **Step 4: `sheet-cores.tsx`**

```tsx
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusPill } from '@/components/ui/status-pill';
import { calcularMarkup } from '@/lib/markup';
import { fmtBRL, fmtMarkup } from '@/lib/formato';
import type { ItemPromocao } from '@/lib/promocoes';
import { SEMAFORO_UI } from './contagem-semaforo';

const MOTIVO: Record<string, string> = {
  sem_cadastro: 'Sem custo no PubliAI', sem_custo: 'Sem custo no PubliAI', sem_origem: 'Sem origem (nacional/importado) no cadastro',
  sem_preco: 'Sem preço na promoção', sem_categoria: 'Anúncio não lido no Mercado Livre', erro_tarifa: 'Tarifa do Mercado Livre indisponível',
};

export function SheetCores({ item, onClose }: { item: ItemPromocao | null; onClose: () => void }) {
  return (
    <Sheet open={item != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>{item.titulo ?? item.ml_item_id}</SheetTitle>
              <SheetDescription>
                {item.ml_item_id} · preço da promoção {item.preco_avaliado != null ? fmtBRL(item.preco_avaliado) : '—'}
              </SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col divide-y divide-border px-4">
              {item.projecao.map((c, i) => {
                const ui = SEMAFORO_UI[c.semaforo];
                return (
                  <li key={c.variation_id ?? i} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.cor ?? 'Única'}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {c.custo != null ? `custo ${fmtBRL(c.custo)}` : ''}{c.piso != null ? ` · mín. líquido ${fmtBRL(c.piso)}` : ''}
                      </p>
                    </div>
                    {c.liquido != null && c.custo != null ? (
                      <div className="flex shrink-0 items-center gap-3 text-right">
                        <div className="tabular-nums">
                          <p className="font-medium">{fmtBRL(c.liquido)}</p>
                          <p className="text-xs text-muted-foreground">{fmtMarkup(calcularMarkup(c.liquido, c.custo).markup)}</p>
                        </div>
                        <StatusPill tone={ui.tone} title={ui.label}><ui.Icon className="size-3.5" aria-hidden />{ui.label}</StatusPill>
                      </div>
                    ) : (
                      <span className="shrink-0 text-sm text-muted-foreground">{MOTIVO[c.motivo ?? ''] ?? 'Sem custo no PubliAI'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: `src/pages/PromocaoDetalhe.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import { calcularMarkup } from '@/lib/markup';
import { fmtBRL, fmtMarkup } from '@/lib/formato';
import {
  URL_PROMOCOES_ML, ateQuantoDaLinha, corDeReferencia, descontoPct, filtrarItens, rotuloTipo,
  type ItemPromocao, type SemaforoPromo,
} from '@/lib/promocoes';
import { ContagemSemaforo, SEMAFORO_UI } from '@/components/promocoes/contagem-semaforo';
import { SheetCores } from '@/components/promocoes/sheet-cores';

const PESO: Record<SemaforoPromo, number> = { vermelho: 0, amarelo: 1, verde: 2, indisponivel: 3 };

export default function PromocaoDetalhe() {
  const { promocaoId = '' } = useParams();
  const promocoes = usePromocoes();
  const itens = useItensPromocao(promocaoId);
  const [semaforo, setSemaforo] = useState<SemaforoPromo | null>(null);
  const [participando, setParticipando] = useState(false);
  const [aberto, setAberto] = useState<ItemPromocao | null>(null);

  const promo = promocoes.data?.find((p) => p.promocao_id === promocaoId) ?? null;
  const daAba = useMemo(() => filtrarItens(itens.data ?? [], { semaforo: null, participando }), [itens.data, participando]);
  const linhas = useMemo(() => filtrarItens(itens.data ?? [], { semaforo, participando }), [itens.data, semaforo, participando]);
  const contagem = useMemo(() => {
    const c = { convidados: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0 };
    for (const i of daAba) c[i.pior_semaforo]++;
    return c;
  }, [daAba]);

  const colunas: Column<ItemPromocao>[] = [
    {
      key: 'semaforo', header: 'Semáforo',
      sortValue: (r) => PESO[r.pior_semaforo],
      cell: (r) => { const ui = SEMAFORO_UI[r.pior_semaforo]; return <StatusPill tone={ui.tone} title={ui.label}><ui.Icon className="size-3.5" aria-hidden /><span className="sr-only">{ui.label}</span></StatusPill>; },
    },
    {
      key: 'anuncio', header: 'Anúncio',
      cell: (r) => (
        <div className={`flex min-w-0 items-center gap-3 ${r.pior_semaforo === 'indisponivel' ? 'text-muted-foreground' : ''}`}>
          {r.thumbnail && <img src={r.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />}
          <div className="min-w-0">
            <p className="truncate">{r.titulo ?? r.ml_item_id}</p>
            <p className="text-xs text-muted-foreground">{r.ml_item_id}{r.estoque_min != null ? ` · Estoque mín. ${r.estoque_min}` : ''}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'preco', header: 'Preço → Promo', className: 'text-right tabular-nums',
      sortValue: (r) => r.preco_avaliado,
      cell: (r) => {
        const d = descontoPct(r.preco_original, r.preco_avaliado);
        return <span>{r.preco_original != null ? fmtBRL(r.preco_original) : '—'} → {r.preco_avaliado != null ? fmtBRL(r.preco_avaliado) : '—'}{d != null ? ` (−${d}%)` : ''}</span>;
      },
    },
    {
      key: 'banca', header: 'ML banca', className: 'text-right tabular-nums',
      cell: (r) => r.ml_pct ? (
        <Tooltip>
          <TooltipTrigger className="underline decoration-dotted">{r.ml_pct}%</TooltipTrigger>
          <TooltipContent>Parte do desconto paga pelo Mercado Livre — não incluída no líquido.</TooltipContent>
        </Tooltip>
      ) : '—',
    },
    {
      key: 'liquido', header: 'Líquido · Markup', className: 'text-right tabular-nums',
      sortValue: (r) => corDeReferencia(r)?.liquido ?? null,
      cell: (r) => {
        const c = corDeReferencia(r);
        if (!c || c.custo == null) return <span className="text-muted-foreground">Sem custo no PubliAI</span>;
        return <span>{fmtBRL(c.liquido!)} · {fmtMarkup(calcularMarkup(c.liquido!, c.custo).markup)}</span>;
      },
    },
    {
      key: 'ate', header: 'Até quanto descer', className: 'text-right tabular-nums',
      cell: (r) => {
        if (r.preco_min == null || r.preco_max == null) return '—';
        const a = ateQuantoDaLinha(r);
        if (a.motivo === 'qualquer') return 'Qualquer preço da faixa';
        if (a.motivo === 'nenhum') return <span className="text-danger">Nenhum preço da faixa atinge o mínimo</span>;
        return a.valor != null ? fmtBRL(a.valor) : '—';
      },
    },
    {
      key: 'ml', header: <span className="sr-only">Abrir no Mercado Livre</span>, stickyRight: true,
      cell: (r) => r.permalink ? (
        <a href={r.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          aria-label={`Abrir ${r.ml_item_id} no Mercado Livre`} className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ) : null,
    },
  ];

  if (!promocoes.isLoading && !promo) {
    return <EmptyState title="Campanha não encontrada." description="Ela pode ter saído da lista do Mercado Livre na última atualização." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Promoções', to: '/promocoes' }, { label: promo?.nome ?? promocaoId }]} />
      <PageHeader
        title={promo?.nome ?? promocaoId}
        subtitle={promo ? `${rotuloTipo(promo.tipo)}${promo.prazo_adesao ? ` · adesão até ${new Date(promo.prazo_adesao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : undefined}
        actions={<Button asChild variant="outline"><a href={URL_PROMOCOES_ML} target="_blank" rel="noreferrer">Abrir no Seller Center <ExternalLink className="size-4" aria-hidden /></a></Button>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ContagemSemaforo contagem={contagem} ativo={semaforo} onFiltro={setSemaforo} />
        <div role="group" aria-label="Filtrar por participação" className="inline-flex rounded-lg border p-0.5">
          {[{ v: false, l: 'Convidados' }, { v: true, l: 'Participando' }].map((o) => (
            <button key={o.l} type="button" aria-pressed={participando === o.v} onClick={() => { setParticipando(o.v); setSemaforo(null); }}
              className="min-h-9 rounded-md px-3 text-sm aria-pressed:bg-muted aria-pressed:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <DataTable
          columns={colunas} rows={linhas} rowKey={(r) => r.ml_item_id}
          loading={itens.isLoading} skeletonRows={8}
          defaultSort={{ key: 'semaforo', dir: 'asc' }}
          onRowClick={setAberto}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">Nenhum anúncio neste filtro.</p>}
        />
      </div>
      <SheetCores item={aberto} onClose={() => setAberto(null)} />
    </div>
  );
}
```

Conferir que `text-danger` existe como utilitário (tokens `danger` de `src/index.css`, usados pelo `StatusPill`); senão usar a mesma classe de cor que o `StatusPill` usa para `danger`.
- [ ] **Step 6:** `pnpm test -- src/lib/__tests__/promocoes.test.ts src/components/promocoes` → Expected: PASS. `pnpm build` e `pnpm lint` → Expected: verde.
- [ ] **Step 7: Commit** `feat(promocoes): detalhe da campanha com liquido por cor (ADR-0170)`.

---

### Task 10: Postgres real, validação, deploy e docs (orquestrador — não delegar)

- [ ] **Step 1: Portão local.** `pnpm preflight` (≈ 3 min 40 s) → Expected: verde. Nunca substituir por checklist montado à mão.
- [ ] **Step 2: RLS contra Postgres real.** `supabase db reset` local; com service role inserir 1 `ml_promocoes` + 1 `ml_promocao_itens` + 1 `ml_promocoes_sync` para a org A; logado como usuário da org B (`scripts/verificar-isolamento-tenant.ts` como modelo — acrescentar as 3 tabelas à suíte se ela for parametrizável por tabela) → Expected: 0 linhas; como usuário da org A → 1 linha; `insert` como `authenticated` → erro de permissão.
- [ ] **Step 3: Revisão final do diff pelo Fable** (regra do projeto antes de merge) — passar o diff inteiro da branch contra `origin/main`, a spec e o ADR; corrigir o que ele apontar e repetir o Step 1.
- [ ] **Step 4: Deploy do backend** (ordem da ADR-0170): `supabase db push` → conferir as 3 tabelas e a coluna nova por SQL read-only → `supabase functions deploy sincronizar-promocoes` e `supabase functions deploy usuarios` (a mudança em `usuarios` é só a lista de módulos) → `supabase functions list` confirma as versões novas e `verify_jwt` = false só em `sincronizar-promocoes` (a `usuarios` segue exigindo JWT — lição do deploy de 2026-07-15) → chamada sem assinatura e sem JWT a `sincronizar-promocoes` → Expected: 401.
- [ ] **Step 5: Schedule QStash** (não há schedule-as-code; procedimento de `docs/reference/edge-functions.md`): criar `0 */6 * * *` para `…/functions/v1/sincronizar-promocoes` com body `{}` (objeto JSON puro), retries 1; conferir com o `curl … /v2/schedules` do mesmo doc; acrescentar a linha na tabela de schedules do doc.
- [ ] **Step 6: Ligar o módulo na Avil** — pedir ao Diego (super-admin) para ligar "Promoções" em `/admin` na org Avil; **não** ligar por SQL. Em seguida, "Atualizar agora" (ou QStash com `{ "org_id": "<avil>" }`) e conferir `ml_promocoes_sync.estado = 'ok'`, nº de promoções = o da Task 0, tempo da execução nos logs (`iso_timestamp_start/end` obrigatórios na consulta de logs).
- [ ] **Step 7: Prova dos números** (critério de aceite 1): para 3 anúncios de uma campanha real (1 Legacy multi-cor, 1 UP, 1 com faixa), comparar a `projecao` gravada com a conta da Revisão no mesmo preço (`calcular-tarifa-ml` com `preco_avaliado` + custo/piso/alíquota da variação) — diferença ≤ R$ 0,01. Contagem de convidados da campanha = Seller Center (critério 2). Registrar os 3 casos em `docs/TASKS.md`.
- [ ] **Step 8: UI em runtime** (sessão isolada, nunca o Chrome do Diego): skill `playwright-cli`, conta VALIDATION com as respostas do PostgREST de `ml_promocoes`/`ml_promocao_itens`/`ml_promocoes_sync` injetadas via `route` (a conta VALIDATION não tem os dados da Avil); screenshot real de: campanhas (3 abas), card de cupom, detalhe com filtros, Sheet de cores, estados vazio/sem acesso/erro, e largura 360 px. Comparar 1:1 com os números do Step 7.
- [ ] **Step 9: Alertas.** Com o switch ligado na Avil (pedir ao Diego), rodar um sync e conferir: no máximo 1 mensagem; `ml_notificacoes_enviadas` com as chaves `promo_prejuizo`/`promo_prazo`; segundo sync sem mensagem nova.
- [ ] **Step 10: Docs** — skill `docs-update-checklist`: `docs/TASKS.md` (seção 2026-09-24/25), `docs/reference/edge-functions.md` (função + schedule), `docs/reference/modelo-de-dados.md` (3 tabelas + coluna), `docs/project-status.md` (entrada ADR-0170), `docs/decisions/README.md` (índice), `obsidian-vault/` (módulo + índice de ADRs + changelog), `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` local (I1 MVP entregue — arquivo fora do git). Depois, Graphify (skill `graphify-update-maintenance`).
- [ ] **Step 11: Entrega** — push da branch → CI verde (`frontend`, `backend-lint`) → merge fast-forward na `main` → deletar branch e worktree. As edge functions já estão deployadas (Step 4); conferir que a versão ativa é a do commit mergeado.
