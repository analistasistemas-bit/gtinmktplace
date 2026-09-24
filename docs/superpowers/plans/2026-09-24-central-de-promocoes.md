# Central de Promoções do ML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Promoções" que lista as campanhas do ML da org e, por anúncio convidado/participando, o líquido projetado no preço promocional, o markup, o semáforo (pior cor) e "até quanto descer" — só leitura, com sync a cada 6 h e dois alertas opcionais.

**Architecture:** Worker novo `sincronizar-promocoes` (QStash com fan-out por org + chamada do usuário) lê `/seller-promotions`, projeta o líquido por cor com funções puras em `_shared/promocoes/` (comissão e frete do ML no preço promocional, custo/piso/origem do cadastro) e grava em 3 tabelas com RLS por org. A tela só lê do banco e aplica `calcularSemaforo`/`calcularMarkup`. Alertas saem pelo `notificarCategoria` (`financeiro`) com dedup, uma mensagem agregada por sync.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno), QStash, Upstash Redis, React + TanStack Query + Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-central-de-promocoes-design.md` · **ADR:** `docs/decisions/0170-central-de-promocoes-ml.md` · **Glossário:** `docs/reference/glossario.md` § Promoções

## Global Constraints

- **Nenhuma escrita no ML.** Em promoção, item, tarifa e frete o worker só faz `GET`. Única exceção: o refresh OAuth que `getValidAccessTokenConexao` (`_shared/ml/token.ts`) já faz por `POST` no endpoint de token — não é escrita em anúncio.
- Líquido = `liquidoClassico(preco, comissao, frete, aliquotaPct)` (`_shared/preco/liquido.ts`), no **preço avaliado**: item `started` (participando) → `preco_promo ?? preco_sugerido` (o preço que está no ar); convidado → `preco_sugerido ?? preco_promo`. Comissão = `comissaoDeComProveniencia(buscarListingPrice(...))`; frete = `buscarFreteVendedorComProveniencia(...)` — as mesmas fontes do `calcular-tarifa-ml`. **Proveniência `estimated` em qualquer dos dois (o ML não informou) → a cor fica sem líquido (`erro_tarifa`) e nada vai para o cache; nunca vira zero.** `partial` (frete com pacote padrão por falta de dimensão) é aceito — é o mesmo número que a Revisão mostra.
- **`ml_pct` (ML banca) NÃO entra no líquido** (ADR-0170 §7). A tela diz "não incluído no líquido".
- Alíquota: `aliquota_importado_pct` se origem `importado`, `aliquota_nacional_pct` se `nacional`. Org sem `aliquotas_confirmadas_em` → sync da org termina em `estado='erro'` com a mensagem `Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.` A origem vem de `familias.origem` (enum `NOT NULL`, garantida pelo ingest — ADR-0107); o ramo `sem_origem` é só defesa de tipo, não uma trava de negócio.
- Semáforo: 🟢 `liquido >= piso`; 🔴 `custo > 0 && liquido < custo`; 🟡 resto; `indisponivel` se `liquido == null`. Pior do anúncio: vermelho > amarelo > verde entre as cores **com** líquido; `indisponivel` só se nenhuma cor tem líquido.
- Vocabulário da UI: "Convidados", "Participando", "Líquido", "Markup", "ML banca", "Até quanto descer", "Sem custo no PubliAI". Proibido na UI: "margem", "lucro", "candidato", emoji.
- Módulo: `'promocoes'`; menu: `'promocoes'`, rota `/promocoes` e `/promocoes/:promocaoId`, ícone lucide `BadgePercent`, logo após Publicados.
- Switch de alertas: `configuracoes.alertas_promocoes_ativo boolean not null default false` + `grant select (alertas_promocoes_ativo) on public.configuracoes to authenticated`.
- Status do item: **`candidate` = convidado; `started` (no ar) e `pending` (inscrito numa campanha que ainda não começou — visto na 10.10, Task 0) = participando**; qualquer outro status é gravado mas não entra em contagem, filtro nem alerta.
- Alertas: `notificarCategoria(admin, orgId, 'financeiro', texto)`; dedup `reservarNotificacao(admin, orgId, null, 'promo_prejuizo', '<promocao_id>:<ml_item_id>')` e `reservarNotificacao(admin, orgId, null, 'promo_prazo', '<promocao_id>')`; leem o **banco** (última leitura concluída) na etapa de lista; no máximo **1 mensagem por org por sync**.
- Sync em duas etapas: **lista** por org (trava de 5 min por `ml_promocoes_sync.estado='sincronizando'`) e **leitura** por promoção (lotes de 20 itens, orçamento de **90 000 ms** por execução, continuação pelo último `ml_item_id` processado, reserva `ml_promocoes.rodada_em_curso` de 30 min; toda escrita da leitura confere a posse da rodada, comparando instantes, nunca texto). Throttle do botão: **2 min** desde `ml_promocoes_sync.iniciado_em`.
- Migrations **só** via `supabase migration new` + `supabase db push` (ADR-0043). Nunca `apply_migration`/painel.
- Git neste worktree: `/usr/bin/git`, um comando por chamada, commit com `-F <arquivo de mensagem absoluto>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Roteamento de modelo (CLAUDE.md): Tasks 1-6 (migration, cálculo financeiro, integração ML) → **opus**; Tasks 7-9 (frontend) → **sonnet**; Tasks 0 e 10 → orquestrador (não delegar).

## Setup do worktree (antes da Task 1)

- [ ] Na raiz do worktree `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/i1-central-promocoes`: `cp "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.local" "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.test" .`
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm exec vitest run supabase/functions/_shared/preco src/lib` → suíte existente verde (linha de base).

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

- [ ] **Step 1: Formato das respostas.** `GET /seller-promotions/users/{uid}?app_version=v2`, `GET /seller-promotions/promotions/{id}/items?promotion_type=DEAL&app_version=v2&limit=50` (e a 2ª página com o cursor), `GET /seller-promotions/promotions/{id}/items?promotion_type=SMART&app_version=v2`, `GET /items?ids=<3 MLB, 1 Legacy multi-cor, 1 UP>&attributes=id,title,thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations&include_attributes=all`. Salvar como `promocoes-usuario.json`, `itens-deal-p1.json`, `itens-deal-p2.json`, `itens-smart.json`, `multiget.json`. Conferir: nome do cursor em `paging` (`searchAfter`) e do parâmetro de envio (`search_after`); campos `deadline_date`, `benefits`; `stock.min/max` no LIGHTNING; **a lista de `status` distintos dos itens** (o código só reconhece `candidate` e `started` — outro status que signifique convidado/participando exige ajustar `contar`/`filtrarItens` e o glossário); e que `price` de um item `started` em DEAL é o preço que está no ar. **Se divergir do que `ml.ts` (Task 4) lê, ajustar o normalizador e o teste da Task 4 ao formato real antes de implementá-la.**
- [ ] **Step 2: ML banca.** Achar em `ml_vendas`/`ml_vendas_itens` (SQL read-only via Management API) uma venda de item que estava `started` em SMART com `meli_percentage > 0`; comparar `unit_price`, `sale_fee` e o líquido gravado com `price`/`original_price`/`meli_percentage`. Registrar a regra observada na spec. **O MVP não muda:** o subsídio continua fora do líquido; incluir exige nova decisão do Diego.
- [ ] **Step 3: Volume.** Contar itens `candidate`+`started` somando todas as promoções `pending`/`started` da Avil e o nº de preços distintos. Estimativa de GETs por rodada = páginas de itens + multiget/20 + 2 × (combinações distintas de categoria×tipo×preço para comissão + categoria×preço×dimensão para frete), onde cada cor de convidado com faixa soma até 1 (preço avaliado) + 1 (máximo) + ~3 (ponto fixo do "até quanto"). Medir também o tempo de 1 lote de 20 itens da 10.10 com cache frio: tem de ficar bem abaixo de 90 s (orçamento) e do limite de parede da edge function. Registrar; se o lote passar de ~40 s, reduzir `lote` no worker e avisar o Diego antes do deploy. Com o tempo por lote, estimar a duração da cadeia inteira da 10.10 (nº de lotes × tempo): se passar de ~25 min, subir `RESERVA_MIN` (deps.ts) e o limite de `emLeitura` (front) juntos.
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
  rodada_em_curso        timestamptz,   -- reserva da leitura (30 min); null = nenhuma leitura em curso
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
-- Default privileges do Supabase dão ALL a anon/authenticated em tabela nova (precedente: 20260712142159_revoke_anon_ml_mensagens.sql).
revoke all on public.ml_promocoes, public.ml_promocao_itens, public.ml_promocoes_sync from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_promocoes, public.ml_promocao_itens, public.ml_promocoes_sync from authenticated;

-- Switch dos alertas (nasce desligado). SELECT de configuracoes é por coluna desde 20260822131053.
alter table public.configuracoes
  add column if not exists alertas_promocoes_ativo boolean not null default false;
grant select (alertas_promocoes_ativo) on public.configuracoes to authenticated;

-- Menu novo para não-admins que já administram a org (precedente: 20260816125057_pulse_v1.sql).
-- O menu só aparece com o módulo ligado; sem esta linha o operador existente não o veria nem com o módulo.
update public.profiles set allowed_menus = array_append(allowed_menus, 'promocoes')
  where 'configuracoes' = any(allowed_menus) and not ('promocoes' = any(allowed_menus));
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
  convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
  /** Maior parte do desconto bancada pelo ML entre os anúncios (meli_percentage); `benefits` da promoção vem nulo (Task 0). */
  ml_pct_max: number | null;
}
```

- [ ] **Step 1: Criar `tipos.ts`** com o bloco acima (arquivo só de tipos).
- [ ] **Step 2: Teste que falha** — `supabase/functions/_shared/promocoes/__tests__/projecao.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ateQuantoDescer, contar, ehParticipando, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo,
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
  it('convidado: sugerido quando há faixa, senão o preço da promoção', () => {
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: 49.9, preco_promo: 45 })).toBe(49.9);
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: null, preco_promo: 45 })).toBe(45);
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: null, preco_promo: null })).toBeNull();
  });
  it('participando (no ar ou inscrito em campanha futura): o preço escolhido', () => {
    expect(precoAvaliado({ status: 'started', preco_sugerido: 49.9, preco_promo: 45 })).toBe(45);
    expect(precoAvaliado({ status: 'pending', preco_sugerido: 49.9, preco_promo: 45 })).toBe(45);
    expect(ehParticipando('candidate')).toBe(false);
    expect(ehParticipando('finished')).toBe(false);
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

  it('frete menor abaixo de R$ 79: desce até o mínimo real, não para no 1º preço válido', async () => {
    // frete 20 a partir de 79, 8 abaixo. Da tarifa do máximo: (30+20)/0,82 → 61,00 (válido, frete 8).
    // Refazendo com a tarifa de 61: (30+8)/0,82 = 46,34… → 46,35 — o mínimo real.
    const tarifa = async (p: number) => t(10, 0, p >= 79 ? 20 : 8);
    const r = await ateQuantoDescer({ piso: 30, aliquotaPct: 8, min: 20, max: 100 }, tarifa);
    expect(r.valor).toBeCloseTo(46.35, 2);
    expect(liquidoNoPreco(46.35, await tarifa(46.35), 8)).toBeGreaterThanOrEqual(30);
  });

  it('frete maior acima de R$ 40: fica acima do degrau quando abaixo dele não há preço válido', async () => {
    // abaixo de 40 precisaria de 34/0,82 = 41,46 (não existe < 40); a partir de 40: (34+10)/0,82 → 53,70
    const tarifa = async (p: number) => t(10, 0, p >= 40 ? 10 : 0);
    const r = await ateQuantoDescer({ piso: 34, aliquotaPct: 8, min: 20, max: 80 }, tarifa);
    expect(r.valor).toBeCloseTo(53.7, 2);
  });
});

describe('contar', () => {
  const linha = (status: string, pior: LinhaItem['pior_semaforo']) => ({ status, pior_semaforo: pior }) as LinhaItem;
  it('conta convidados, participando (started + pending) e o pior semáforo; outro status não conta', () => {
    expect(contar([
      linha('candidate', 'verde'), linha('candidate', 'indisponivel'),
      linha('started', 'vermelho'), linha('started', 'amarelo'), linha('pending', 'verde'), linha('finished', 'verde'),
    ])).toEqual({
      convidados: 2, convidados_verde: 1, participando: 3, verde: 2, amarelo: 1, vermelho: 1, indisponivel: 1,
      participando_vermelho: 1, ml_pct_max: null,
    });
  });

  it('ml_pct_max = maior parte bancada pelo ML entre os anúncios contados', () => {
    const l = (status: string, ml_pct: number | null) => ({ status, pior_semaforo: 'verde', ml_pct }) as LinhaItem;
    expect(contar([l('candidate', 30), l('started', 10), l('candidate', null)]).ml_pct_max).toBe(30);
    expect(contar([l('candidate', 0)]).ml_pct_max).toBeNull();
  });
});
```

- [ ] **Step 3:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/projecao.test.ts` → Expected: FAIL (módulo não existe).
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

/** Convidado = `candidate`; participando = `started` (no ar) ou `pending` (inscrito, campanha ainda não começou). */
export function ehParticipando(status: string): boolean {
  return status === 'started' || status === 'pending';
}

/** Participando: o preço escolhido/no ar (`price`). Convidado: o sugerido da faixa, senão o preço da promoção. */
export function precoAvaliado(it: { status: string; preco_sugerido: number | null; preco_promo: number | null }): number | null {
  if (ehParticipando(it.status)) return it.preco_promo ?? it.preco_sugerido ?? null;
  return it.preco_sugerido ?? it.preco_promo ?? null;
}

export function liquidoNoPreco(preco: number, t: Tarifa, aliquotaPct: number): number {
  return liquidoClassico(preco, t.comissao, t.frete, aliquotaPct);
}

/**
 * Menor preço da faixa [min, max] cujo líquido, conferido na tarifa DAQUELE preço, fica ≥ piso.
 * Ponto fixo: parte da tarifa do máximo e refaz o gross-up com a tarifa de cada candidato (a comissão
 * fixa e o frete mudam por faixa de preço) até parar de descer. Só guarda preço verificado; no pior
 * caso fica no máximo, que foi verificado primeiro.
 */
export async function ateQuantoDescer(
  a: { piso: number; aliquotaPct: number; min: number; max: number },
  tarifaEm: (preco: number) => Promise<Tarifa>,
): Promise<{ valor: number | null; motivo: 'qualquer' | 'nenhum' | null }> {
  let t = await tarifaEm(a.max);
  if (liquidoNoPreco(a.max, t, a.aliquotaPct) < a.piso) return { valor: null, motivo: 'nenhum' };
  let melhor = a.max;
  for (let i = 0; i < 6; i++) {
    const bruto = grossUp(a.piso, t.comissao.percentual, t.comissao.fixa, t.frete, a.aliquotaPct);
    const cand = Math.min(a.max, Math.max(a.min, bruto));
    if (cand >= melhor) break;
    t = await tarifaEm(cand);
    if (liquidoNoPreco(cand, t, a.aliquotaPct) >= a.piso) melhor = cand;
  }
  return melhor <= a.min ? { valor: null, motivo: 'qualquer' } : { valor: melhor, motivo: null };
}

/** Só convidado e participando contam — outro status do ML não é presumido. */
export function contar(linhas: Pick<LinhaItem, 'status' | 'pior_semaforo' | 'ml_pct'>[]): Contagem {
  const c: Contagem = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null };
  for (const l of linhas) {
    const participa = ehParticipando(l.status);
    if (!participa && l.status !== 'candidate') continue;
    if (participa) c.participando++; else c.convidados++;
    c[l.pior_semaforo]++;
    if (participa && l.pior_semaforo === 'vermelho') c.participando_vermelho++;
    if (!participa && l.pior_semaforo === 'verde') c.convidados_verde++;
    if (l.ml_pct != null && l.ml_pct > 0) c.ml_pct_max = Math.max(c.ml_pct_max ?? 0, l.ml_pct);
  }
  return c;
}
```

- [ ] **Step 5:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/projecao.test.ts` → Expected: PASS. Se `36.6` falhar, conferir `arredondar5Cima` em `sugerir.ts` e ajustar só o valor esperado ao arredondamento real (a asserção do líquido ≥ piso é a que não pode mudar).
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

Run: `pnpm exec vitest run tests/lib/paridade-semaforo-promocoes.test.ts` → Expected: PASS (7 casos). Se o import com extensão `.ts` for exigido pelas outras paridades (`tests/lib/paridade-preco-fe-be.test.ts`), copiar o estilo de import de lá.
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

  it('cai para GTIN e depois código/SKU, ignorando zeros à esquerda', () => {
    const c = montarCadastro([v({ id: 'a', codigo: '00123', gtin: '0789', familias: { ml_item_id: null, origem: 'nacional' } })], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '123', gtin: null })?.variacao_id).toBe('a');
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: null, gtin: '789' })?.variacao_id).toBe('a');
  });

  it('ml_item_id só resolve anúncio de variação única', () => {
    const mono = montarCadastro([v({ id: 'a' })], []);
    expect(resolverCor(mono, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })?.variacao_id).toBe('a');
    const multi = montarCadastro([v({ id: 'a' }), v({ id: 'b' })], []);
    expect(resolverCor(multi, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })).toBeNull();
  });

  it('duplicata: linha sem custo nunca vence linha com custo, mesmo mais nova', () => {
    const c = montarCadastro([
      v({ id: 'com', codigo: '8', custo: 6, atualizado_em: '2026-01-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
      v({ id: 'sem', codigo: '8', custo: null, atualizado_em: '2026-09-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '8', gtin: null })?.variacao_id).toBe('com');
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

- [ ] **Step 2:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/cadastro.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar `cadastro.ts`**

```ts
// ADR-0170 — liga um anúncio da promoção à variação do cadastro. Mesma cadeia do custo vigente
// (_shared/faturamento/custo-vigente.ts: variação → anúncio → GTIN → código) com o vínculo de item
// filho UP na frente. Desempate: linha COM custo vence linha sem custo; entre iguais, a mais recente
// (ADR-0108). Diferença intencional: "anúncio" só resolve anúncio de cor única (o financeiro resolve
// uma venda; aqui cada cor precisa do próprio custo). Puro.
// ponytail: cópia enxuta — o custo-vigente devolve só o custo e é amarrado por paridade ao front;
// aqui precisamos de piso/origem/dimensões/cor.
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
    const vence = !atual
      || (val.custo != null && atual.custo == null)
      || ((val.custo != null) === (atual.custo != null) && quando.get(val)! > quando.get(atual)!);
    if (vence) m.set(k, val);
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
  const doItem = c.porItem.get(q.item_id);
  if (doItem && doItem.length === 1) return doItem[0];
  if (q.gtin) {
    const r = c.porGtin.get(normGtin(q.gtin.trim()));
    if (r) return r;
  }
  if (q.sku) {
    const r = c.porCodigo.get(normGtin(q.sku.trim()));
    if (r) return r;
  }
  return null;
}
```

- [ ] **Step 4:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/cadastro.test.ts` → Expected: PASS.
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

- [ ] **Step 2:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: FAIL.
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

- [ ] **Step 4:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: PASS.
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

Run: `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/ml.test.ts` → Expected: PASS. Se falhar, o normalizador está lendo um campo com nome errado: corrigir `ml.ts` (e o teste inline correspondente), nunca a fixture.
- [ ] **Step 6: Commit** `feat(promocoes): leitura das promocoes do ML so por GET (ADR-0170)`.

---

### Task 5: Orquestradores do sync (lista por org + leitura por promoção) + fiação (TDD)

O sync tem **duas etapas** (revisão R1 do plano):
- **Lista (por org, rápida):** confere alíquotas, lista as promoções, grava metadados, encerra as que sumiram, avisa (alertas lendo o banco) e **reserva + enfileira uma leitura por promoção** `pending`/`started` (cupom não).
- **Leitura (por promoção):** lê os itens (ordenados por `ml_item_id`), projeta em **lotes**, grava cada lote; se o orçamento de tempo acabar, **re-enfileira a si mesma com o cursor**. Ao terminar, apaga o que não veio nesta rodada e recalcula a contagem no banco. Nenhuma promoção grande trava as outras nem a org.

A reserva usa `ml_promocoes.rodada_em_curso` (Task 1): só enfileira se a coluna estiver nula ou tiver mais de 30 min (reserva vencida grava antes o aviso `MSG_INTERROMPIDA` na promoção). A leitura confere a posse **antes de cada lote e na conclusão**, comparando instantes (`mesmaRodada`) — o PostgREST devolve `…+00:00` e a mensagem leva `…Z` —, e aborta em silêncio se perdeu a posse: uma cadeia velha nunca apaga itens nem libera a reserva de uma rodada nova. O cursor é o **último `ml_item_id` processado**: item que entra ou sai da lista do ML entre duas execuções não desloca a retomada.

**Files:**
- Create: `supabase/functions/_shared/promocoes/sincronizar.ts`, `supabase/functions/_shared/promocoes/deps.ts`
- Modify: `supabase/functions/_shared/promocoes/tipos.ts` (acrescentar `'erro_tarifa'` a `MotivoSemLiquido`)
- Test: `supabase/functions/_shared/promocoes/__tests__/sincronizar.test.ts`

**Interfaces:**
- Consumes: Task 2 (`projecao.ts`), Task 3 (`cadastro.ts`), Task 4 (`ml.ts`); `buscarListingPrice`, `comissaoDeComProveniencia` (`../ml/listing-prices.ts`); `buscarFreteVendedorComProveniencia` (`../ml/frete.ts`); `redisGet`, `redisSet` (`../redis/client.ts`); `paginarTudo` (`../pagina.ts`); `qstashClient` (`../queue.ts`).
- Produces:

```ts
// sincronizar.ts
export type EstadoSync = 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
export const MSG_ALIQUOTA = 'Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.';
export interface QueryTarifa { preco: number; categoria: string; listingType: string; dim: DimensoesPacote | null }
export interface MsgLeitura { etapa: 'promocao'; org_id: string; promocao_id: string; tipo: string; rodada: string; cursor: string | null }
export interface DepsLista { lerAliquotas; listarPromocoes; gravarPromocoes; encerrarAusentes; reservarLeitura; enfileirar; avisar; gravarEstado }
export interface DepsLeitura { agora; rodadaEmCurso; lerAliquotas; listarItens; buscarItensML; carregarCadastro; tarifaEm; gravarLote; continuar; concluir; falhar }
export function projetarItem(it: ItemPromocaoML, ml: ItemML | null, cad: Cadastro, aliq: Aliquotas, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>): Promise<LinhaItem>;
export function emParalelo<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]>;
export function sincronizarLista(deps: DepsLista, ctx: { orgId: string; rodada: string }): Promise<{ estado: EstadoSync; enfileiradas: string[] }>;
export function mesmaRodada(a: string | null, b: string): boolean;
export function sincronizarPromocao(deps: DepsLeitura, msg: MsgLeitura, opts: { limiteMs: number; lote: number; concorrencia: number }): Promise<{ resultado: 'concluida' | 'continua' | 'obsoleta' | 'erro'; processados: number }>;
// deps.ts
export function depsLista(admin: SupabaseClient, cx: { orgId: string; mlUserId: string; token: string }): DepsLista;
export function depsLeitura(admin: SupabaseClient, cx: { orgId: string; mlUserId: string; token: string }, msg: MsgLeitura): DepsLeitura;
export class TarifaEstimada extends Error {}
```

- [ ] **Step 1:** Em `tipos.ts`, trocar a linha do `MotivoSemLiquido` por:

```ts
export type MotivoSemLiquido = 'sem_cadastro' | 'sem_custo' | 'sem_origem' | 'sem_preco' | 'sem_categoria' | 'erro_tarifa';
```

- [ ] **Step 2: Teste que falha** — `__tests__/sincronizar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  MSG_ALIQUOTA, mesmaRodada, projetarItem, sincronizarLista, sincronizarPromocao,
  type DepsLeitura, type DepsLista, type MsgLeitura,
} from '../sincronizar.ts';
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

  it('importado usa a alíquota de importado', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', familias: { ml_item_id: 'MLB1', origem: 'importado' } })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.projecao[0].aliquota_pct).toBe(16);
    expect(l.projecao[0].liquido).toBeCloseTo(50 - 5 - 8, 10);
  });

  it('convidado com faixa: avalia no sugerido e calcula até quanto descer', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', preco: 30 })], []);
    const l = await projetarItem(item({ preco_min: 20, preco_max: 60, preco_sugerido: 45 }), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.preco_avaliado).toBe(45);
    expect(l.projecao[0].ate_quanto).toBeCloseTo(36.6, 2);
  });

  it('participando com faixa: avalia no preço que está no ar, não no sugerido', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item({ status: 'started', preco_promo: 42, preco_sugerido: 45, preco_min: 20, preco_max: 60 }), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.preco_avaliado).toBe(42);
  });

  it('falha no "até quanto" não apaga o líquido já calculado no preço avaliado', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', preco: 30 })], []);
    const tarifa = async (q: { preco: number }) => { if (q.preco !== 45) throw new Error('estimada'); return tarifa10; };
    const l = await projetarItem(item({ preco_min: 20, preco_max: 60, preco_sugerido: 45 }), itemMl(), cad, aliq, tarifa);
    expect(l.projecao[0]).toMatchObject({ motivo: null, ate_quanto: null, semaforo: 'verde' });
    expect(l.projecao[0].liquido).toBeCloseTo(45 * 0.82, 10);
  });

  it('falha ou tarifa estimada derruba só a cor (erro_tarifa)', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => { throw new Error('estimada'); });
    expect(l.projecao[0]).toMatchObject({ motivo: 'erro_tarifa', liquido: null, semaforo: 'indisponivel' });
  });

  it('item fora do multiget: sem categoria, sem líquido', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), null, cad, aliq, async () => tarifa10);
    expect(l.projecao[0].motivo).toBe('sem_categoria');
  });
});

const promo = (id: string, tipo = 'DEAL', status = 'pending') =>
  ({ id, tipo, status, nome: id, inicio: null, fim: null, prazo_adesao: null, beneficios: null, bruto: {} }) as PromocaoML;

type FakeLista = DepsLista & Record<keyof DepsLista, ReturnType<typeof vi.fn>>;
const depsLista = (o: Partial<DepsLista> = {}): FakeLista => ({
  lerAliquotas: vi.fn(async () => aliq),
  listarPromocoes: vi.fn(async (): Promise<PromocaoML[]> => []),
  gravarPromocoes: vi.fn(async () => {}),
  encerrarAusentes: vi.fn(async () => {}),
  reservarLeitura: vi.fn(async () => true),
  enfileirar: vi.fn(async () => {}),
  avisar: vi.fn(async () => 0),
  gravarEstado: vi.fn(async () => {}),
  ...o,
}) as unknown as FakeLista;
const ctx = { orgId: 'org', rodada: '2026-10-06T12:00:00.000Z' };

describe('sincronizarLista', () => {
  it('alíquotas não confirmadas: falha LOUD sem chamar o ML', async () => {
    const d = depsLista({ lerAliquotas: vi.fn(async () => null) });
    expect((await sincronizarLista(d, ctx)).estado).toBe('erro');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'erro', erro: MSG_ALIQUOTA });
    expect(d.listarPromocoes).not.toHaveBeenCalled();
  });

  it('403 → sem_acesso; lista vazia → sem_promocoes e encerra as antigas', async () => {
    const d1 = depsLista({ listarPromocoes: vi.fn(async () => { throw new SemAcessoPromocoes('ML 403'); }) });
    expect((await sincronizarLista(d1, ctx)).estado).toBe('sem_acesso');
    expect(d1.gravarEstado).toHaveBeenCalledWith({ estado: 'sem_acesso', erro: 'ML 403' });
    const d2 = depsLista();
    expect((await sincronizarLista(d2, ctx)).estado).toBe('sem_promocoes');
    expect(d2.encerrarAusentes).toHaveBeenCalledWith([]);
  });

  it('grava, encerra ausentes, avisa e enfileira só pending/started não-cupom que reservou', async () => {
    const d = depsLista({
      listarPromocoes: vi.fn(async () => [
        promo('C', 'SELLER_COUPON_CAMPAIGN', 'started'), promo('F', 'DEAL', 'finished'), promo('P'), promo('S', 'SMART', 'started'),
      ]),
      reservarLeitura: vi.fn(async (id: string) => id !== 'S'),
    });
    const r = await sincronizarLista(d, ctx);
    expect(d.encerrarAusentes).toHaveBeenCalledWith(['C', 'F', 'P', 'S']);
    expect(d.avisar).toHaveBeenCalledTimes(1);
    expect(r.enfileiradas).toEqual(['P']);
    expect(d.enfileirar).toHaveBeenCalledWith({ etapa: 'promocao', org_id: 'org', promocao_id: 'P', tipo: 'DEAL', rodada: ctx.rodada, cursor: null });
    expect(d.gravarEstado).toHaveBeenLastCalledWith({ estado: 'ok' });
  });

  it('falha inesperada grava estado erro e relança (nada fica em "sincronizando")', async () => {
    const d = depsLista({ listarPromocoes: vi.fn(async () => [promo('P')]), gravarPromocoes: vi.fn(async () => { throw new Error('db fora'); }) });
    await expect(sincronizarLista(d, ctx)).rejects.toThrow('db fora');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'erro', erro: 'db fora' });
  });

  it('falha nos alertas não derruba o sync', async () => {
    const d = depsLista({ listarPromocoes: vi.fn(async () => [promo('P')]), avisar: vi.fn(async () => { throw new Error('telegram'); }) });
    expect((await sincronizarLista(d, ctx)).estado).toBe('ok');
  });
});

type FakeLeitura = DepsLeitura & Record<keyof DepsLeitura, ReturnType<typeof vi.fn>> & { avancar: (ms: number) => void };
function depsLeitura(o: Partial<DepsLeitura> = {}): FakeLeitura {
  let relogio = 0;
  return {
    avancar: (ms: number) => { relogio += ms; },
    agora: vi.fn(() => relogio),
    // O PostgREST serializa timestamptz como `+00:00`; a mensagem leva `Z` (toISOString).
    rodadaEmCurso: vi.fn(async (): Promise<string | null> => '2026-10-06T12:00:00+00:00'),
    lerAliquotas: vi.fn(async () => aliq),
    listarItens: vi.fn(async () => [item({ ml_item_id: 'MLB3' }), item({ ml_item_id: 'MLB1' }), item({ ml_item_id: 'MLB2' })]),
    buscarItensML: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, itemMl({ id })]))),
    carregarCadastro: vi.fn(async () => montarCadastro([linhaVar({ id: 'a' })], [])),
    tarifaEm: vi.fn(async () => tarifa10),
    gravarLote: vi.fn(async () => {}),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    falhar: vi.fn(async () => {}),
    ...o,
  } as unknown as FakeLeitura;
}
const msg: MsgLeitura = { etapa: 'promocao', org_id: 'org', promocao_id: 'P', tipo: 'DEAL', rodada: ctx.rodada, cursor: null };
const opts = { limiteMs: 90_000, lote: 2, concorrencia: 4 };

describe('mesmaRodada', () => {
  it('compara instantes, não texto', () => {
    expect(mesmaRodada('2026-10-06T12:00:00+00:00', '2026-10-06T12:00:00.000Z')).toBe(true);
    expect(mesmaRodada('2026-10-06T12:00:01+00:00', '2026-10-06T12:00:00.000Z')).toBe(false);
    expect(mesmaRodada(null, '2026-10-06T12:00:00.000Z')).toBe(false);
  });
});

describe('sincronizarPromocao', () => {
  it('lê em lotes na ordem de ml_item_id e conclui', async () => {
    const d = depsLeitura();
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'concluida', processados: 3 });
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB1', 'MLB2'], ['MLB3']]);
    expect(d.concluir).toHaveBeenCalledTimes(1);
  });

  it('orçamento esgotado: grava o que fez e continua do cursor', async () => {
    const d = depsLeitura();
    d.gravarLote.mockImplementation(async () => { d.avancar(100_000); });
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'continua', processados: 2 });
    expect(d.continuar).toHaveBeenCalledWith('MLB2');
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('retoma depois do último id processado', async () => {
    const d = depsLeitura();
    await sincronizarPromocao(d, { ...msg, cursor: 'MLB2' }, opts);
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB3']]);
  });

  it('item novo antes do cursor não desloca a retomada', async () => {
    const d = depsLeitura({ listarItens: vi.fn(async () => ['MLB0', 'MLB1', 'MLB2', 'MLB3'].map((id) => item({ ml_item_id: id }))) });
    await sincronizarPromocao(d, { ...msg, cursor: 'MLB2' }, opts);
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB3']]);
  });

  it('mensagem de rodada velha não faz nada', async () => {
    const d = depsLeitura({ rodadaEmCurso: vi.fn(async () => '2026-10-06T18:00:00+00:00') });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('obsoleta');
    expect(d.listarItens).not.toHaveBeenCalled();
  });

  it('posse perdida no meio: para sem gravar, sem continuar e sem concluir', async () => {
    const d = depsLeitura();
    d.rodadaEmCurso
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // entrada
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes do 1º lote
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes de gravar o 1º lote
      .mockResolvedValue('2026-10-06T12:40:00+00:00');      // rodada nova reservou
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'obsoleta', processados: 2 });
    expect(d.gravarLote).toHaveBeenCalledTimes(1);
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('posse perdida durante a projeção: não grava o lote', async () => {
    const d = depsLeitura();
    d.rodadaEmCurso
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // entrada
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes do 1º lote
      .mockResolvedValue('2026-10-06T12:40:00+00:00');      // perdeu enquanto projetava
    expect(await sincronizarPromocao(d, msg, opts)).toEqual({ resultado: 'obsoleta', processados: 0 });
    expect(d.gravarLote).not.toHaveBeenCalled();
  });

  it('conclusão sem posse vira obsoleta', async () => {
    const d = depsLeitura({ concluir: vi.fn(async () => false) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('obsoleta');
  });

  it('erro marca a promoção e libera a reserva', async () => {
    const d = depsLeitura({ listarItens: vi.fn(async () => { throw new Error('ML 500 em /x'); }) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('erro');
    expect(d.falhar).toHaveBeenCalledWith('ML 500 em /x');
  });

  it('alíquota desconfirmada no meio: falha LOUD', async () => {
    const d = depsLeitura({ lerAliquotas: vi.fn(async () => null) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('erro');
    expect(d.falhar).toHaveBeenCalledWith(MSG_ALIQUOTA);
  });
});
```

- [ ] **Step 3:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/sincronizar.test.ts` → Expected: FAIL.
- [ ] **Step 4: Implementar `sincronizar.ts`**

```ts
// ADR-0170 — sync das promoções: etapa de lista (por org) e etapa de leitura (por promoção, em lotes,
// com continuação). Decisão aqui; IO nas deps (fiação real em deps.ts).
import type { DimensoesPacote } from '../ml/pacote.ts';
import { resolverCor, type Cadastro } from './cadastro.ts';
import { SemAcessoPromocoes, TIPOS_CUPOM } from './ml.ts';
import { ateQuantoDescer, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo } from './projecao.ts';
import type {
  Aliquotas, ItemML, ItemPromocaoML, LinhaItem, MotivoSemLiquido, ProjecaoCor, PromocaoML, Tarifa,
} from './tipos.ts';

export type EstadoSync = 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
export const MSG_ALIQUOTA = 'Confirme as alíquotas de imposto em Configurações antes de usar a Central de Promoções.';

export interface QueryTarifa { preco: number; categoria: string; listingType: string; dim: DimensoesPacote | null }
export interface MsgLeitura { etapa: 'promocao'; org_id: string; promocao_id: string; tipo: string; rodada: string; cursor: string | null }

export interface DepsLista {
  lerAliquotas(): Promise<Aliquotas | null>;
  listarPromocoes(): Promise<PromocaoML[]>;
  /** Upsert dos metadados; não toca contagem, erro, itens_sincronizados_em nem rodada_em_curso. */
  gravarPromocoes(ps: PromocaoML[]): Promise<void>;
  /** status='finished' nas pending/started da org cujo id não está em `vistos`. */
  encerrarAusentes(vistos: string[]): Promise<void>;
  /** Reserva atômica: grava rodada_em_curso se estiver nula ou com mais de 30 min. true = reservou. */
  reservarLeitura(promocaoId: string, rodada: string): Promise<boolean>;
  enfileirar(m: MsgLeitura): Promise<void>;
  /** Alertas lendo o banco (dados da rodada anterior). Devolve nº de envios. */
  avisar(): Promise<number>;
  gravarEstado(e: { estado: EstadoSync; erro?: string }): Promise<void>;
}

export interface DepsLeitura {
  agora(): number;
  rodadaEmCurso(): Promise<string | null>;
  lerAliquotas(): Promise<Aliquotas | null>;
  listarItens(): Promise<ItemPromocaoML[]>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  carregarCadastro(): Promise<Cadastro>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  /** Upsert das linhas com sincronizado_em = rodada. */
  gravarLote(linhas: LinhaItem[]): Promise<void>;
  /** Publica a mesma mensagem com o cursor = último ml_item_id processado. */
  continuar(cursor: string): Promise<void>;
  /** Só com a posse da rodada: apaga itens com sincronizado_em < rodada, recalcula a contagem no banco,
   *  itens_sincronizados_em = rodada, erro = null, rodada_em_curso = null. false = posse perdida, nada feito. */
  concluir(): Promise<boolean>;
  /** Só com a posse da rodada: erro = msg, rodada_em_curso = null. */
  falhar(erro: string): Promise<void>;
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
  let t: Tarifa;
  try {
    t = await tarifaNo(preco!);
  } catch {
    // Inclui TarifaEstimada: comissão/frete que o ML não informou NUNCA vira zero (ADR-0170 §7).
    return { ...base, motivo: 'erro_tarifa' };
  }
  const liquido = liquidoNoPreco(preco!, t, aliquotaPct);
  let ate: { valor: number | null; motivo: 'qualquer' | 'nenhum' | null } = { valor: null, motivo: null };
  if (it.status === 'candidate' && it.preco_min != null && it.preco_max != null) {
    try {
      ate = await ateQuantoDescer({ piso, aliquotaPct, min: it.preco_min, max: it.preco_max }, tarifaNo);
    } catch { /* sem "até quanto"; o líquido no preço avaliado continua válido */ }
  }
  return {
    ...base, comissao_pct: t.comissao.percentual, comissao_fixa: t.comissao.fixa, frete: t.frete,
    aliquota_pct: aliquotaPct, liquido, ate_quanto: ate.valor, ate_quanto_motivo: ate.motivo,
    semaforo: semaforo(liquido, piso, custo),
  };
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

export async function sincronizarLista(
  deps: DepsLista, ctx: { orgId: string; rodada: string },
): Promise<{ estado: EstadoSync; enfileiradas: string[] }> {
  try {
    if (!(await deps.lerAliquotas())) {
      await deps.gravarEstado({ estado: 'erro', erro: MSG_ALIQUOTA });
      return { estado: 'erro', enfileiradas: [] };
    }
    let promos: PromocaoML[];
    try {
      promos = await deps.listarPromocoes();
    } catch (e) {
      if (!(e instanceof SemAcessoPromocoes)) throw e;
      await deps.gravarEstado({ estado: 'sem_acesso', erro: e.message });
      return { estado: 'sem_acesso', enfileiradas: [] };
    }
    if (promos.length) await deps.gravarPromocoes(promos);
    await deps.encerrarAusentes(promos.map((p) => p.id));
    try {
      await deps.avisar();
    } catch (e) {
      console.error('[promocoes] alertas falharam (sync mantido):', e);
    }
    if (!promos.length) {
      await deps.gravarEstado({ estado: 'sem_promocoes' });
      return { estado: 'sem_promocoes', enfileiradas: [] };
    }
    const enfileiradas: string[] = [];
    for (const p of promos) {
      if (TIPOS_CUPOM.has(p.tipo) || (p.status !== 'pending' && p.status !== 'started')) continue;
      if (!(await deps.reservarLeitura(p.id, ctx.rodada))) continue; // já em leitura por outra rodada
      await deps.enfileirar({ etapa: 'promocao', org_id: ctx.orgId, promocao_id: p.id, tipo: p.tipo, rodada: ctx.rodada, cursor: null });
      enfileiradas.push(p.id);
    }
    await deps.gravarEstado({ estado: 'ok' });
    return { estado: 'ok', enfileiradas };
  } catch (e) {
    await deps.gravarEstado({ estado: 'erro', erro: mensagem(e) });
    throw e;
  }
}

/** O PostgREST devolve timestamptz como `…+00:00`; a mensagem leva `…Z`. Compara o instante, nunca o texto. */
export function mesmaRodada(a: string | null, b: string): boolean {
  return a != null && Date.parse(a) === Date.parse(b);
}

const porId = (a: ItemPromocaoML, b: ItemPromocaoML) => (a.ml_item_id < b.ml_item_id ? -1 : a.ml_item_id > b.ml_item_id ? 1 : 0);

export async function sincronizarPromocao(
  deps: DepsLeitura, msg: MsgLeitura, opts: { limiteMs: number; lote: number; concorrencia: number },
): Promise<{ resultado: 'concluida' | 'continua' | 'obsoleta' | 'erro'; processados: number }> {
  const inicio = deps.agora();
  if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: 0 };
  let feitos = 0;
  try {
    const aliq = await deps.lerAliquotas();
    if (!aliq) {
      await deps.falhar(MSG_ALIQUOTA);
      return { resultado: 'erro', processados: 0 };
    }
    // Cursor = último ml_item_id processado; a comparação é a mesma da ordenação (code units).
    const pendentes = (await deps.listarItens()).sort(porId)
      .filter((x) => msg.cursor == null || x.ml_item_id > msg.cursor);
    const cadastro = await deps.carregarCadastro();
    while (feitos < pendentes.length) {
      // Posse antes de cada lote: uma cadeia velha nunca escreve por cima de uma rodada nova.
      if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: feitos };
      if (feitos > 0 && deps.agora() - inicio > opts.limiteMs) {
        await deps.continuar(pendentes[feitos - 1].ml_item_id);
        return { resultado: 'continua', processados: feitos };
      }
      const lote = pendentes.slice(feitos, feitos + opts.lote);
      const ml = await deps.buscarItensML(lote.map((x) => x.ml_item_id));
      const linhas = await emParalelo(lote, opts.concorrencia, (it) =>
        projetarItem(it, ml.get(it.ml_item_id) ?? null, cadastro, aliq, (q) => deps.tarifaEm(q)));
      // O lote leva segundos: reconfere a posse logo antes de escrever.
      if (!mesmaRodada(await deps.rodadaEmCurso(), msg.rodada)) return { resultado: 'obsoleta', processados: feitos };
      await deps.gravarLote(linhas);
      feitos += lote.length;
    }
    if (!(await deps.concluir())) return { resultado: 'obsoleta', processados: feitos };
    return { resultado: 'concluida', processados: feitos };
  } catch (e) {
    await deps.falhar(mensagem(e));
    return { resultado: 'erro', processados: feitos };
  }
}
```

(`feitos > 0` garante que toda execução avança pelo menos um lote — não existe continuação sem progresso.)
- [ ] **Step 5:** `pnpm exec vitest run supabase/functions/_shared/promocoes` → Expected: PASS (todas as suítes da pasta).
- [ ] **Step 6: Implementar `deps.ts`** (fiação; validada contra Postgres real e o ML na Task 10)

```ts
// Fiação real do sync de promoções (ADR-0170). Só ligação, nenhuma decisão — a regra vive em
// sincronizar.ts / alertas.ts, testadas por vitest. Validada contra Postgres real e o ML na Task 10.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buscarListingPrice, comissaoDeComProveniencia } from '../ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../ml/frete.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import { paginarTudo } from '../pagina.ts';
import { qstashClient } from '../queue.ts';
import { montarCadastro, type LinhaItemUp, type LinhaVariacao } from './cadastro.ts';
import { buscarItensML, criarGetJson, listarItensPromocao, listarPromocoes } from './ml.ts';
import { contar } from './projecao.ts';
import { avisarPromocoes, depsAlertas } from './alertas.ts';
import { mesmaRodada, type DepsLeitura, type DepsLista, type MsgLeitura } from './sincronizar.ts';
import type { Comissao } from '../preco/sugerir.ts';
import type { Aliquotas, LinhaItem } from './tipos.ts';

const TTL_S = 6 * 60 * 60;
const RESERVA_MIN = 30; // medir a duração da cadeia da 10.10 na Task 0 e ajustar (UI usa o mesmo valor em emLeitura)
const MSG_INTERROMPIDA = 'A leitura anterior dos anúncios foi interrompida; os números podem estar incompletos.';

/** Comissão ou frete que o ML não informou: nunca vira zero, nunca entra no cache. */
export class TarifaEstimada extends Error {}

type Cx = { orgId: string; mlUserId: string; token: string };
const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };
const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-promocoes`;

async function lerAliquotas(admin: SupabaseClient, orgId: string): Promise<Aliquotas | null> {
  const { data, error } = await admin.from('configuracoes')
    .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em')
    .eq('org_id', orgId).maybeSingle();
  falhou('lerAliquotas', error);
  if (!data?.aliquotas_confirmadas_em || data.aliquota_nacional_pct == null || data.aliquota_importado_pct == null) return null;
  return { nacional: Number(data.aliquota_nacional_pct), importado: Number(data.aliquota_importado_pct) };
}

async function emCache<T>(chave: string, calcular: () => Promise<T>): Promise<T> {
  try {
    const hit = await redisGet(chave);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* cache é otimização */ }
  const v = await calcular(); // lança → não grava
  try { await redisSet(chave, JSON.stringify(v), TTL_S); } catch { /* idem */ }
  return v;
}

export function depsLista(admin: SupabaseClient, cx: Cx): DepsLista {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  return {
    lerAliquotas: () => lerAliquotas(admin, orgId),
    listarPromocoes: () => listarPromocoes(get, cx.mlUserId),

    async gravarPromocoes(ps) {
      const agora = new Date().toISOString();
      const { error } = await admin.from('ml_promocoes').upsert(ps.map((p) => ({
        org_id: orgId, promocao_id: p.id, tipo: p.tipo, nome: p.nome, status: p.status,
        inicio: p.inicio, fim: p.fim, prazo_adesao: p.prazo_adesao, beneficios: p.beneficios,
        bruto: p.bruto, sincronizado_em: agora,
      })), { onConflict: 'org_id,promocao_id' });
      falhou('gravarPromocoes', error);
    },

    async encerrarAusentes(vistos) {
      let q = admin.from('ml_promocoes').update({ status: 'finished', rodada_em_curso: null })
        .eq('org_id', orgId).in('status', ['pending', 'started']);
      if (vistos.length) q = q.not('promocao_id', 'in', `(${vistos.map((v) => `"${v.replaceAll('"', '')}"`).join(',')})`);
      const { error } = await q;
      falhou('encerrarAusentes', error);
    },

    async reservarLeitura(promocaoId, rodada) {
      const limite = new Date(Date.now() - RESERVA_MIN * 60_000).toISOString();
      // Reserva vencida = cadeia anterior morreu sem concluir nem falhar: registra antes de reservar de novo.
      const vencida = await admin.from('ml_promocoes').update({ erro: MSG_INTERROMPIDA })
        .eq('org_id', orgId).eq('promocao_id', promocaoId).lt('rodada_em_curso', limite);
      falhou('reservarLeitura.vencida', vencida.error);
      const { data, error } = await admin.from('ml_promocoes').update({ rodada_em_curso: rodada })
        .eq('org_id', orgId).eq('promocao_id', promocaoId)
        .or(`rodada_em_curso.is.null,rodada_em_curso.lt.${limite}`)
        .select('promocao_id');
      falhou('reservarLeitura', error);
      return (data ?? []).length === 1;
    },

    async enfileirar(m) {
      await qstashClient().publishJSON({ url: urlWorker(), body: m, retries: 1 });
    },

    avisar: () => avisarPromocoes(Date.now(), depsAlertas(admin, orgId)),

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

export function depsLeitura(admin: SupabaseClient, cx: Cx, msg: MsgLeitura): DepsLeitura {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  const lerRodada = async (): Promise<string | null> => {
    const { data, error } = await admin.from('ml_promocoes').select('rodada_em_curso')
      .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).maybeSingle();
    falhou('rodadaEmCurso', error);
    return (data?.rodada_em_curso as string | null) ?? null;
  };
  return {
    agora: () => Date.now(),
    rodadaEmCurso: lerRodada,

    lerAliquotas: () => lerAliquotas(admin, orgId),
    listarItens: () => listarItensPromocao(get, { id: msg.promocao_id, tipo: msg.tipo } as never),
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
      const p = preco.toFixed(2);
      const dimKey = dim ? `${dim.altura_cm}x${dim.largura_cm}x${dim.comprimento_cm}x${dim.peso_gramas}` : 'padrao';
      const [comissao, frete] = await Promise.all([
        emCache<Comissao>(`promo:lp:v1:${categoria}:${listingType}:${p}`, async () => {
          const c = comissaoDeComProveniencia(await buscarListingPrice(cx.token, preco, categoria, listingType));
          if (c.proveniencia === 'estimated') throw new TarifaEstimada(c.motivo ?? 'comissão estimada');
          return c.valor;
        }),
        emCache<number>(`promo:frete:v1:${cx.mlUserId}:${categoria}:${p}:${dimKey}`, async () => {
          const f = await buscarFreteVendedorComProveniencia(cx.token, cx.mlUserId, preco, categoria, dim);
          // 'partial' (pacote padrão por falta de dimensão) é o mesmo número que a Revisão mostra: aceito.
          if (f.proveniencia === 'estimated') throw new TarifaEstimada(f.motivo ?? 'frete estimado');
          return f.valor;
        }),
      ]);
      return { comissao, frete };
    },

    async gravarLote(linhas: LinhaItem[]) {
      const { error } = await admin.from('ml_promocao_itens').upsert(linhas.map((l) => ({
        org_id: orgId, promocao_id: msg.promocao_id, ml_item_id: l.ml_item_id, status: l.status,
        preco_original: l.preco_original, preco_promo: l.preco_promo, preco_min: l.preco_min, preco_max: l.preco_max,
        preco_sugerido: l.preco_sugerido, preco_avaliado: l.preco_avaliado, ml_pct: l.ml_pct, vendedor_pct: l.vendedor_pct,
        estoque_min: l.estoque_min, estoque_max: l.estoque_max, titulo: l.titulo, thumbnail: l.thumbnail,
        permalink: l.permalink, listing_type_id: l.listing_type_id, projecao: l.projecao,
        pior_semaforo: l.pior_semaforo, sincronizado_em: msg.rodada,
      })), { onConflict: 'org_id,promocao_id,ml_item_id' });
      falhou('gravarLote', error);
    },

    async continuar(cursor) {
      await qstashClient().publishJSON({ url: urlWorker(), body: { ...msg, cursor }, retries: 1 });
    },

    async concluir() {
      if (!mesmaRodada(await lerRodada(), msg.rodada)) return false;
      const del = await admin.from('ml_promocao_itens').delete()
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).lt('sincronizado_em', msg.rodada);
      falhou('concluir.delete', del.error);
      const linhas = await paginarTudo<Pick<LinhaItem, 'status' | 'pior_semaforo' | 'ml_pct'>>((de, ate) => admin.from('ml_promocao_itens')
        .select('ml_item_id, status, pior_semaforo, ml_pct').eq('org_id', orgId).eq('promocao_id', msg.promocao_id)
        .order('ml_item_id').range(de, ate) as never);
      // PostgREST compara timestamptz pelo instante: `eq` com o texto da mensagem funciona.
      const upd = await admin.from('ml_promocoes')
        .update({ contagem: contar(linhas), erro: null, itens_sincronizados_em: msg.rodada, rodada_em_curso: null })
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).eq('rodada_em_curso', msg.rodada)
        .select('promocao_id');
      falhou('concluir.contagem', upd.error);
      return (upd.data ?? []).length === 1;
    },

    async falhar(erro) {
      const { error } = await admin.from('ml_promocoes').update({ erro, rodada_em_curso: null })
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).eq('rodada_em_curso', msg.rodada);
      falhou('falhar', error);
    },
  };
}
```

- [ ] **Step 7:** `/usr/bin/git add supabase/functions/_shared/promocoes` (o `check:functions` só enxerga arquivo rastreado — `package.json:22` usa `git ls-files`) e então `pnpm check:functions && pnpm lint:functions` → Expected: sem erro.
- [ ] **Step 8: Commit** `feat(promocoes): sync em duas etapas com leitura por promocao e continuacao (ADR-0170)`.

---

### Task 6: Alertas + worker `sincronizar-promocoes` + menu/módulo na edge `usuarios` (TDD)

Os alertas leem o **banco** (dados da última leitura concluída) na etapa de lista: uma mensagem por org por sync, sem depender de quais promoções foram lidas agora.

**Files:**
- Create: `supabase/functions/_shared/promocoes/alertas.ts`, `supabase/functions/sincronizar-promocoes/index.ts`
- Modify: `supabase/functions/usuarios/index.ts` (linha 10 `MENU_KEYS` e linha 211 `MODULOS_VALIDOS`), `supabase/config.toml` (bloco da função nova)
- Test: `supabase/functions/_shared/promocoes/__tests__/alertas.test.ts`

**Interfaces:**
- Consumes: `Contagem` com `convidados_verde` (Task 2); `reservarNotificacao` (`../faturamento/notificacoes-dedupe.ts`); `notificarCategoria` (`../notificacoes/config.ts`); no worker: `requireUserOrg` (`../_shared/auth.ts`), `verificarAssinatura`, `qstashClient` (`../_shared/queue.ts`), `exigirModulo` (`../_shared/produto/modulo.ts`), `resolverConexao` (`../_shared/canais/conexao.ts`), `getValidAccessTokenConexao` (`../_shared/ml/token.ts`), Task 5.
- Produces:

```ts
export interface PromoAlerta { promocao_id: string; nome: string | null; status: string; prazo_adesao: string | null; contagem: Contagem | null }
export interface ItemAlerta { promocao_id: string; ml_item_id: string; titulo: string | null; preco_avaliado: number | null; projecao: ProjecaoCor[] }
export interface DepsAlertas {
  ativo(): Promise<boolean>;
  lerPromocoes(): Promise<PromoAlerta[]>;               // status pending/started
  lerParticipandoNoPrejuizo(): Promise<ItemAlerta[]>;   // status 'started'/'pending' e pior 'vermelho'
  reservar(entidade: 'promo_prejuizo' | 'promo_prazo', chave: string): Promise<boolean>;
  notificar(texto: string): Promise<number>;
}
export type Selecao = { prejuizo: { promo: PromoAlerta; item: ItemAlerta }[]; prazo: { promo: PromoAlerta; verdes: number }[] };
export function selecionarAlertas(promos: PromoAlerta[], prejuizo: ItemAlerta[], agoraMs: number): Selecao;
export function montarMensagemPromocoes(s: Selecao): string;
export function avisarPromocoes(agoraMs: number, deps: DepsAlertas): Promise<number>;
export function depsAlertas(admin: SupabaseClient, orgId: string): DepsAlertas;
```

- [ ] **Step 1: Teste que falha** — `__tests__/alertas.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  avisarPromocoes, montarMensagemPromocoes, selecionarAlertas,
  type DepsAlertas, type ItemAlerta, type PromoAlerta,
} from '../alertas.ts';

const H = 3_600_000;
const agora = Date.parse('2026-10-06T12:00:00Z');
const contagem = (verdes: number) => ({ convidados: 5, convidados_verde: verdes, participando: 0, verde: verdes, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null });
const promo = (id: string, status: string, prazoHoras: number | null, verdes = 1): PromoAlerta => ({
  promocao_id: id, nome: `Campanha ${id}`, status, contagem: contagem(verdes),
  prazo_adesao: prazoHoras == null ? null : new Date(agora + prazoHoras * H).toISOString(),
});
const item = (promocao: string, id: string): ItemAlerta => ({
  promocao_id: promocao, ml_item_id: id, titulo: `Anúncio ${id}`, preco_avaliado: 49.9,
  projecao: [{ liquido: 8.5, custo: 12 } as never],
});

describe('selecionarAlertas', () => {
  it('prejuízo: casa o item com a promoção; promoção desconhecida é ignorada', () => {
    const s = selecionarAlertas([promo('S', 'started', null)], [item('S', 'A'), item('X', 'B')], agora);
    expect(s.prejuizo.map((x) => x.item.ml_item_id)).toEqual(['A']);
  });

  it('prazo: pending, adesão aberta em ≤ 48 h e ≥ 1 convidado verde', () => {
    const s = selecionarAlertas([
      promo('P1', 'pending', 47), promo('P2', 'pending', 49), promo('P3', 'pending', 10, 0),
      promo('P4', 'pending', -1), promo('P5', 'started', 10),
    ], [], agora);
    expect(s.prazo).toEqual([{ promo: expect.objectContaining({ promocao_id: 'P1' }), verdes: 1 }]);
  });
});

describe('avisarPromocoes', () => {
  type D = DepsAlertas & Record<keyof DepsAlertas, ReturnType<typeof vi.fn>>;
  const deps = (o: Partial<DepsAlertas> = {}): D => ({
    ativo: vi.fn(async () => true),
    lerPromocoes: vi.fn(async () => [promo('S', 'started', null), promo('P', 'pending', 24)]),
    lerParticipandoNoPrejuizo: vi.fn(async () => [item('S', 'A'), item('S', 'B')]),
    reservar: vi.fn(async () => true),
    notificar: vi.fn(async () => 1),
    ...o,
  }) as unknown as D;

  it('switch desligado: não lê, não reserva, não envia', async () => {
    const d = deps({ ativo: vi.fn(async () => false) });
    expect(await avisarPromocoes(agora, d)).toBe(0);
    expect(d.lerPromocoes).not.toHaveBeenCalled();
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('uma mensagem agregada só com o que reservou agora', async () => {
    const d = deps();
    d.reservar.mockImplementation(async (_e: string, chave: string) => chave !== 'S:B');
    await avisarPromocoes(agora, d);
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
    expect(await avisarPromocoes(agora, d)).toBe(0);
    expect(d.notificar).not.toHaveBeenCalled();
  });
});

describe('montarMensagemPromocoes', () => {
  it('lista até 10 anúncios, resume o resto e não usa "margem"/"lucro"', () => {
    const p = promo('S', 'started', null);
    const t = montarMensagemPromocoes({ prejuizo: Array.from({ length: 12 }, (_, i) => ({ promo: p, item: item('S', `X${i}`) })), prazo: [] });
    expect(t).toContain('e mais 2');
    expect(t).not.toMatch(/margem|lucro/i);
  });
});
```

- [ ] **Step 2:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/alertas.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar `alertas.ts`**

```ts
// ADR-0170 §9 — alertas da Central de Promoções: participando no prejuízo e prazo acabando.
// Lê o banco (última leitura concluída). Uma mensagem por org por sync, só com o que reservou
// agora — o 1º sync não despeja histórico (ADR-0121).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { Contagem, ProjecaoCor } from './tipos.ts';

const JANELA_PRAZO_MS = 48 * 3_600_000;
const MAX_LISTADOS = 10;

export interface PromoAlerta { promocao_id: string; nome: string | null; status: string; prazo_adesao: string | null; contagem: Contagem | null }
export interface ItemAlerta { promocao_id: string; ml_item_id: string; titulo: string | null; preco_avaliado: number | null; projecao: ProjecaoCor[] }
export interface DepsAlertas {
  ativo(): Promise<boolean>;
  lerPromocoes(): Promise<PromoAlerta[]>;
  lerParticipandoNoPrejuizo(): Promise<ItemAlerta[]>;
  reservar(entidade: 'promo_prejuizo' | 'promo_prazo', chave: string): Promise<boolean>;
  notificar(texto: string): Promise<number>;
}
export type Selecao = { prejuizo: { promo: PromoAlerta; item: ItemAlerta }[]; prazo: { promo: PromoAlerta; verdes: number }[] };

export function selecionarAlertas(promos: PromoAlerta[], prejuizo: ItemAlerta[], agoraMs: number): Selecao {
  const porId = new Map(promos.map((p) => [p.promocao_id, p]));
  const s: Selecao = { prejuizo: [], prazo: [] };
  for (const it of prejuizo) {
    const promo = porId.get(it.promocao_id);
    if (promo) s.prejuizo.push({ promo, item: it });
  }
  for (const promo of promos) {
    const prazo = promo.prazo_adesao ? Date.parse(promo.prazo_adesao) : NaN;
    const verdes = promo.contagem?.convidados_verde ?? 0;
    if (promo.status === 'pending' && Number.isFinite(prazo) && prazo > agoraMs && prazo - agoraMs <= JANELA_PRAZO_MS && verdes > 0) {
      s.prazo.push({ promo, verdes });
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
    for (const { promo, item } of s.prejuizo.slice(0, MAX_LISTADOS)) {
      const pior = item.projecao.find((p) => p.liquido != null && p.custo != null && p.liquido < p.custo);
      partes.push(`• ${item.titulo ?? item.ml_item_id} (${item.ml_item_id}) em ${promo.nome ?? promo.promocao_id}: ` +
        `preço ${brl(item.preco_avaliado)}, líquido ${brl(pior?.liquido)}, custo ${brl(pior?.custo)}`);
    }
    if (s.prejuizo.length > MAX_LISTADOS) partes.push(`e mais ${s.prejuizo.length - MAX_LISTADOS}.`);
  }
  for (const { promo, verdes } of s.prazo) {
    const prazo = new Date(promo.prazo_adesao!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    partes.push(`⏰ ${promo.nome ?? promo.promocao_id}: adesão até ${prazo}, ${verdes} anúncio(s) convidado(s) com líquido acima do mínimo.`);
  }
  partes.push('Veja em Promoções no PubliAI.');
  return partes.join('\n');
}

export async function avisarPromocoes(agoraMs: number, deps: DepsAlertas): Promise<number> {
  if (!(await deps.ativo())) return 0;
  const s = selecionarAlertas(await deps.lerPromocoes(), await deps.lerParticipandoNoPrejuizo(), agoraMs);
  const novos: Selecao = { prejuizo: [], prazo: [] };
  for (const x of s.prejuizo) {
    if (await deps.reservar('promo_prejuizo', `${x.promo.promocao_id}:${x.item.ml_item_id}`)) novos.prejuizo.push(x);
  }
  for (const x of s.prazo) {
    if (await deps.reservar('promo_prazo', x.promo.promocao_id)) novos.prazo.push(x);
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
    async lerPromocoes() {
      const { data, error } = await admin.from('ml_promocoes')
        .select('promocao_id, nome, status, prazo_adesao, contagem')
        .eq('org_id', orgId).in('status', ['pending', 'started']);
      if (error) throw new Error(`lerPromocoes: ${error.message}`);
      return (data ?? []) as PromoAlerta[];
    },
    async lerParticipandoNoPrejuizo() {
      const { data, error } = await admin.from('ml_promocao_itens')
        .select('promocao_id, ml_item_id, titulo, preco_avaliado, projecao')
        .eq('org_id', orgId).in('status', ['started', 'pending']).eq('pior_semaforo', 'vermelho').limit(500);
      if (error) throw new Error(`lerParticipandoNoPrejuizo: ${error.message}`);
      return (data ?? []) as ItemAlerta[];
    },
    reservar: (entidade, chave) => reservarNotificacao(admin, orgId, null, entidade, chave),
    notificar: (texto) => notificarCategoria(admin, orgId, 'financeiro', texto),
  };
}
```

O emoji é do **texto do Telegram** (padrão de `_shared/notificacoes/telegram.ts`), não da UI.
- [ ] **Step 4:** `pnpm exec vitest run supabase/functions/_shared/promocoes/__tests__/alertas.test.ts` → Expected: PASS.
- [ ] **Step 5: Worker** — `supabase/functions/sincronizar-promocoes/index.ts`:

```ts
// ADR-0170 — sync da Central de Promoções. Modos:
//  - QStash {} (schedule 6/6 h): fan-out, 1 mensagem { etapa: 'lista', org_id } por org com o módulo.
//  - QStash { etapa: 'lista', org_id }: etapa de lista da org (trava se já está sincronizando).
//  - QStash { etapa: 'promocao', ... }: leitura de uma promoção (lotes + continuação).
//  - Usuário logado ("Atualizar agora"): etapa de lista da própria org, com throttle de 2 min.
// No ML só GET de promoção/item/tarifa/frete; o único POST é o refresh OAuth de token.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { sincronizarLista, sincronizarPromocao, type MsgLeitura } from '../_shared/promocoes/sincronizar.ts';
import { depsLeitura, depsLista } from '../_shared/promocoes/deps.ts';

const LEITURA = { limiteMs: 90_000, lote: 20, concorrencia: 6 };
const THROTTLE_MS = 2 * 60_000;
const TRAVA_LISTA_MS = 5 * 60_000;

type Admin = ReturnType<typeof adminClient>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function conexaoDaOrg(admin: Admin, orgId: string) {
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return null;
  return { orgId, mlUserId: conexao.contaExternaId, token: await getValidAccessTokenConexao(conexao) };
}

async function etapaLista(admin: Admin, orgId: string) {
  const { data: atual } = await admin.from('ml_promocoes_sync').select('estado, iniciado_em').eq('org_id', orgId).maybeSingle();
  const desde = atual?.iniciado_em ? Date.now() - Date.parse(atual.iniciado_em) : Infinity;
  if (atual?.estado === 'sincronizando' && desde < TRAVA_LISTA_MS) return { estado: 'sincronizando' as const, enfileiradas: [] };
  const rodada = new Date().toISOString();
  await admin.from('ml_promocoes_sync').upsert({ org_id: orgId, estado: 'sincronizando', iniciado_em: rodada }, { onConflict: 'org_id' });
  const cx = await conexaoDaOrg(admin, orgId).catch(() => null);
  if (!cx) {
    await admin.from('ml_promocoes_sync').upsert({ org_id: orgId, estado: 'sem_acesso', erro: 'Organização sem conexão com o Mercado Livre.', ultimo_erro_em: new Date().toISOString() }, { onConflict: 'org_id' });
    return { estado: 'sem_acesso' as const, enfileiradas: [] };
  }
  return sincronizarLista(depsLista(admin, cx), { orgId, rodada });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  const admin = adminClient();

  try {
    if (req.headers.get('upstash-signature')) {
      if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
      let payload: Partial<MsgLeitura> & { etapa?: string; org_id?: string } = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio */ }

      if (!payload.org_id) {
        const { data: orgs, error } = await admin.from('organizations').select('id').contains('modulos_habilitados', ['promocoes']);
        if (error) throw new Error(`orgs com módulo: ${error.message}`);
        const alvo = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-promocoes`;
        for (const o of orgs ?? []) await qstashClient().publishJSON({ url: alvo, body: { etapa: 'lista', org_id: o.id }, retries: 1 });
        return json({ ok: true, orgs: (orgs ?? []).length });
      }
      if (!(await exigirModulo(admin, payload.org_id, 'promocoes'))) return json({ ok: false, erro: 'Módulo desabilitado.' }, 403);
      if (payload.etapa === 'promocao') {
        const cx = await conexaoDaOrg(admin, payload.org_id);
        if (!cx) return json({ ok: false, erro: 'sem conexão' });
        const r = await sincronizarPromocao(depsLeitura(admin, cx, payload as MsgLeitura), payload as MsgLeitura, LEITURA);
        return json({ ok: true, ...r });
      }
      return json({ ok: true, ...(await etapaLista(admin, payload.org_id)) });
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
    return json({ ok: true, ...(await etapaLista(admin, orgId)) });
  } catch (e) {
    console.error('[sincronizar-promocoes]', e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

O botão do usuário recebe a resposta da etapa de lista (segundos); as leituras das promoções seguem pelo QStash e a tela acompanha por `rodada_em_curso` (Task 8).
- [ ] **Step 6: `verify_jwt`.** Em `supabase/config.toml`, copiar o bloco `[functions.monitorar-moderados]` como `[functions.sincronizar-promocoes]` (mesmo `verify_jwt = false`): a função valida a assinatura QStash ou o JWT do usuário por conta própria (ADR-0046). Se `monitorar-moderados` não tiver bloco (deploy com flag), usar a mesma flag no deploy da Task 10 e registrar aqui.
- [ ] **Step 7: Menu e módulo na edge `usuarios`** — `supabase/functions/usuarios/index.ts`: na linha 10 (espelho de `src/lib/menus.ts`), inserir `'promocoes'` logo após `'publicados'` em `MENU_KEYS`; na linha 211:

```ts
      const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal', 'promocoes'];
```

Sem a chave em `MENU_KEYS`, o admin libera o menu e a edge descarta a permissão em silêncio.
- [ ] **Step 8:** `/usr/bin/git add supabase/functions/_shared/promocoes supabase/functions/sincronizar-promocoes` e então `pnpm check:functions && pnpm lint:functions && pnpm exec vitest run supabase/functions/_shared/promocoes` → Expected: tudo verde.
- [ ] **Step 9: Commit** `feat(promocoes): worker sincronizar-promocoes, alertas e menu na edge usuarios (ADR-0170)`.

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
export interface ContagemPromo { convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number; vermelho: number; indisponivel: number; participando_vermelho: number; ml_pct_max: number | null }
export interface Promocao { promocao_id: string; tipo: string; nome: string | null; status: string; inicio: string | null; fim: string | null; prazo_adesao: string | null; beneficios: Record<string, unknown> | null; contagem: ContagemPromo | null; erro: string | null; itens_sincronizados_em: string | null; rodada_em_curso: string | null }
export interface CorProjetada { variation_id: number | null; cor: string | null; sku: string | null; custo: number | null; piso: number | null; origem: string | null; liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null; semaforo: SemaforoPromo; motivo: string | null }
export interface ItemPromocao { ml_item_id: string; status: string; preco_original: number | null; preco_promo: number | null; preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; preco_avaliado: number | null; ml_pct: number | null; estoque_min: number | null; titulo: string | null; thumbnail: string | null; permalink: string | null; projecao: CorProjetada[]; pior_semaforo: SemaforoPromo }
export interface EstadoSyncPromo { estado: 'sincronizando' | 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro'; iniciado_em: string | null; ultimo_ok_em: string | null; ultimo_erro_em: string | null; erro: string | null }
export type AbaPromo = 'ativas' | 'futuras' | 'encerradas';
export const URL_PROMOCOES_ML: string;
export function ehCupom(tipo: string): boolean;
export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null;
export function rotuloTipo(tipo: string): string;
export function descontoPct(original: number | null, promo: number | null): number | null;
export function prazoUrgente(prazo: string | null, agoraMs: number): boolean;
export function corDeReferencia(it: ItemPromocao): CorProjetada | null;
export function ateQuantoDaLinha(it: ItemPromocao): { valor: number | null; motivo: 'qualquer' | 'nenhum' | null };
export function emLeitura(p: Pick<Promocao, 'rodada_em_curso'>, agoraMs: number): boolean;
export function rotuloSemLiquido(it: ItemPromocao): 'Sem custo no PubliAI' | 'Sem líquido';
export function fetchPromocoes(): Promise<Promocao[]>;
export function fetchItensPromocao(promocaoId: string): Promise<ItemPromocao[]>;
export function fetchEstadoSyncPromocoes(): Promise<EstadoSyncPromo | null>;
// src/hooks/usePromocoes.ts
export function usePromocoes(): UseQueryResult<Promocao[]>;
export function useItensPromocao(promocaoId: string, lendo?: boolean): UseQueryResult<ItemPromocao[]>;
export function useEstadoSyncPromocoes(): UseQueryResult<EstadoSyncPromo | null>;
export function useAtualizarPromocoes(): UseMutationResult<unknown, Error, void>;
```

- [ ] **Step 1: Teste que falha** — `src/lib/__tests__/promocoes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  abaDa, ateQuantoDaLinha, corDeReferencia, descontoPct, ehCupom, emLeitura, prazoUrgente,
  rotuloSemLiquido, rotuloTipo, type CorProjetada, type ItemPromocao,
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
  it('fim já passou vira encerrada mesmo com status velho', () => {
    expect(abaDa({ status: 'started', fim: new Date(agora - dia).toISOString() }, agora)).toBe('encerradas');
  });
  it('leitura em curso só vale por 30 min (a reserva do worker)', () => {
    expect(emLeitura({ rodada_em_curso: new Date(agora - 60_000).toISOString() }, agora)).toBe(true);
    expect(emLeitura({ rodada_em_curso: new Date(agora - 31 * 60_000).toISOString() }, agora)).toBe(false);
    expect(emLeitura({ rodada_em_curso: null }, agora)).toBe(false);
  });
});

describe('rótulos e números', () => {
  it('cupom e tipos', () => {
    expect(ehCupom('SELLER_COUPON_CAMPAIGN')).toBe(true);
    expect(rotuloTipo('LIGHTNING')).toBe('Relâmpago');
    expect(rotuloTipo('XYZ')).toBe('XYZ');
  });
  it('desconto % arredondado', () => {
    expect(descontoPct(59.9, 49.9)).toBe(17);
    expect(descontoPct(null, 49.9)).toBeNull();
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
  it('rótulo sem líquido: "Sem custo" só quando falta cadastro/custo em todas as cores', () => {
    expect(rotuloSemLiquido(item([cor({ liquido: null, motivo: 'sem_cadastro' })], 'indisponivel'))).toBe('Sem custo no PubliAI');
    expect(rotuloSemLiquido(item([cor({ liquido: null, motivo: 'erro_tarifa' })], 'indisponivel'))).toBe('Sem líquido');
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

- [ ] **Step 2:** `pnpm exec vitest run src/lib/__tests__/promocoes.test.ts src/lib/__tests__/menus.test.ts src/lib/__tests__/modulos.test.ts` → Expected: FAIL.
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
  convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
  /** Maior parte do desconto bancada pelo ML entre os anúncios (meli_percentage); `benefits` da promoção vem nulo (Task 0). */
  ml_pct_max: number | null;
}
export interface Promocao {
  promocao_id: string; tipo: string; nome: string | null; status: string;
  inicio: string | null; fim: string | null; prazo_adesao: string | null;
  beneficios: Record<string, unknown> | null; contagem: ContagemPromo | null;
  erro: string | null; itens_sincronizados_em: string | null; rodada_em_curso: string | null;
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

/** `fim` no passado encerra a campanha mesmo que o status gravado ainda diga ativa/futura. */
export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null {
  const fim = p.fim ? Date.parse(p.fim) : NaN;
  const acabou = p.status === 'finished' || (Number.isFinite(fim) && fim < agoraMs);
  if (!acabou) return p.status === 'started' ? 'ativas' : p.status === 'pending' ? 'futuras' : null;
  return Number.isFinite(fim) && fim >= agoraMs - 30 * DIA ? 'encerradas' : null;
}

/** A leitura dos anúncios de uma campanha está em curso (reserva de 30 min, igual a RESERVA_MIN do worker). */
export function emLeitura(p: Pick<Promocao, 'rodada_em_curso'>, agoraMs: number): boolean {
  const t = p.rodada_em_curso ? Date.parse(p.rodada_em_curso) : NaN;
  return Number.isFinite(t) && agoraMs - t < 30 * 60_000;
}

export function descontoPct(original: number | null, promo: number | null): number | null {
  if (original == null || promo == null || original <= 0) return null;
  return Math.round((1 - promo / original) * 100);
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

/** ⚪: "Sem custo no PubliAI" só quando nenhuma cor tem cadastro/custo; senão o motivo é outro (tarifa, categoria…). */
export function rotuloSemLiquido(it: ItemPromocao): 'Sem custo no PubliAI' | 'Sem líquido' {
  const motivos = it.projecao.map((c) => c.motivo);
  return motivos.length > 0 && motivos.every((m) => m === 'sem_cadastro' || m === 'sem_custo') ? 'Sem custo no PubliAI' : 'Sem líquido';
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

const COLS_PROMO = 'promocao_id, tipo, nome, status, inicio, fim, prazo_adesao, beneficios, contagem, erro, itens_sincronizados_em, rodada_em_curso';
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
- [ ] **Step 5:** `pnpm exec vitest run src/lib/__tests__/promocoes.test.ts src/lib/__tests__/menus.test.ts src/lib/__tests__/modulos.test.ts` → Expected: PASS. Rodar também `pnpm exec vitest run src/lib src/components/__tests__` para pegar teste que lista `MENU_KEYS` inteiro; se algum quebrar só por causa da chave nova, atualizar a lista esperada.
- [ ] **Step 6: `src/hooks/usePromocoes.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emLeitura, fetchEstadoSyncPromocoes, fetchItensPromocao, fetchPromocoes } from '@/lib/promocoes';

const QK_PROMO = ['promocoes'] as const;

/** Enquanto alguma campanha está em leitura, recarrega a cada 10 s para a tela acompanhar. */
export function usePromocoes() {
  return useQuery({
    queryKey: [...QK_PROMO, 'lista'], queryFn: fetchPromocoes, staleTime: 60_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => emLeitura(p, Date.now())) ? 10_000 : false),
  });
}
export function useItensPromocao(promocaoId: string, lendo = false) {
  return useQuery({
    queryKey: [...QK_PROMO, 'itens', promocaoId], queryFn: () => fetchItensPromocao(promocaoId), staleTime: 60_000,
    refetchInterval: lendo ? 15_000 : false,
  });
}
export function useEstadoSyncPromocoes() {
  return useQuery({ queryKey: [...QK_PROMO, 'estado'], queryFn: fetchEstadoSyncPromocoes, staleTime: 30_000 });
}

/** "Atualizar agora": o worker responde ao fim da etapa de lista (segundos); a leitura das campanhas
 *  segue em segundo plano e a lista acompanha por `rodada_em_curso`. 429 = atualizado há < 2 min. */
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
- [ ] **Step 8:** `pnpm exec vitest run src/lib src/components/configuracoes src/hooks` e `pnpm build` → Expected: verde.
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
  rodada_em_curso: null,
  contagem: { convidados: 504, convidados_verde: 310, participando: 0, verde: 310, amarelo: 120, vermelho: 40, indisponivel: 34, participando_vermelho: 0, ml_pct_max: null },
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

  it('ML banca: maior parte bancada entre os anúncios', () => {
    renderCard({ ...base, contagem: { ...base.contagem!, ml_pct_max: 30 } });
    expect(screen.getByText(/ML banca até 30%/)).toBeTruthy();
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

- [ ] **Step 2:** `pnpm exec vitest run src/components/promocoes` → Expected: FAIL.
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
  indisponivel: { tone: 'neutral', label: 'Sem líquido', Icon: CircleHelp },
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
import { ehCupom, emLeitura, prazoUrgente, rotuloTipo, type Promocao } from '@/lib/promocoes';
import { ContagemSemaforo } from './contagem-semaforo';

const STATUS: Record<string, string> = { started: 'Ativa', pending: 'Futura', finished: 'Encerrada' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CardCampanha({ promocao: p, agoraMs }: { promocao: Promocao; agoraMs: number }) {
  const cupom = ehCupom(p.tipo);
  const banca = p.contagem?.ml_pct_max ?? null;
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
      {emLeitura(p, agoraMs) && <StatusPill tone="info">Lendo anúncios…</StatusPill>}
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
import { abaDa, emLeitura, type AbaPromo } from '@/lib/promocoes';
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
    onSuccess: () => toast.success('Campanhas atualizadas. Buscando os anúncios de cada uma…'),
    onError: (e) => toast.error(e.message),
  });
  // Execução que caiu no meio deixa 'sincronizando' para trás: só vale se começou há < 5 min.
  const emCurso = estado.data?.estado === 'sincronizando'
    && Date.now() - Date.parse(estado.data.iniciado_em ?? '') < 5 * 60_000;
  const lendo = (promocoes.data ?? []).some((p) => emLeitura(p, Date.now()));
  // "Atualizado há" = última leitura de anúncios concluída (a lista sozinha não atualiza números).
  const ultimaLeitura = (promocoes.data ?? []).map((p) => p.itens_sincronizados_em)
    .filter((x): x is string => x != null).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  const sincronizando = atualizar.isPending || emCurso || lendo;
  const temDados = (promocoes.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promoções"
        subtitle="Campanhas do Mercado Livre com o líquido de cada anúncio no preço da promoção."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{atualizadoHa(ultimaLeitura)}</span>
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
- [ ] **Step 7:** `pnpm exec vitest run src/components/promocoes` → Expected: PASS. `pnpm build` → Expected: verde.
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
  const itens = [it2('A', 'candidate', 'verde'), it2('B', 'started', 'vermelho'), it2('C', 'candidate', 'vermelho'), it2('D', 'pending', 'verde')];
  it('convidados × participando e semáforo', () => {
    expect(filtrarItens(itens, { semaforo: null, participando: false }).map((i) => i.ml_item_id)).toEqual(['A', 'C']);
    expect(filtrarItens(itens, { semaforo: null, participando: true }).map((i) => i.ml_item_id)).toEqual(['B', 'D']);
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

- [ ] **Step 2:** `pnpm exec vitest run src/lib/__tests__/promocoes.test.ts src/components/promocoes` → Expected: FAIL.
- [ ] **Step 3: `filtrarItens`** — acrescentar em `src/lib/promocoes.ts`:

```ts
/** Convidado = `candidate`; participando = `started` ou `pending` (inscrito em campanha futura); outro status não aparece. */
export function filtrarItens(itens: ItemPromocao[], f: { semaforo: SemaforoPromo | null; participando: boolean }): ItemPromocao[] {
  return itens.filter((i) => (f.participando ? i.status === 'started' || i.status === 'pending' : i.status === 'candidate')
    && (f.semaforo == null || i.pior_semaforo === f.semaforo));
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
  sem_cadastro: 'Sem custo no PubliAI', sem_custo: 'Sem custo no PubliAI', sem_origem: 'Sem origem no cadastro',
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import { calcularMarkup } from '@/lib/markup';
import { fmtBRL, fmtMarkup } from '@/lib/formato';
import {
  URL_PROMOCOES_ML, ateQuantoDaLinha, corDeReferencia, descontoPct, emLeitura, filtrarItens, rotuloSemLiquido, rotuloTipo,
  type ItemPromocao, type SemaforoPromo,
} from '@/lib/promocoes';
import { ContagemSemaforo, SEMAFORO_UI } from '@/components/promocoes/contagem-semaforo';
import { SheetCores } from '@/components/promocoes/sheet-cores';

const PESO: Record<SemaforoPromo, number> = { vermelho: 0, amarelo: 1, verde: 2, indisponivel: 3 };

export default function PromocaoDetalhe() {
  const { promocaoId = '' } = useParams();
  const promocoes = usePromocoes();
  const promoAtual = promocoes.data?.find((p) => p.promocao_id === promocaoId);
  const itens = useItensPromocao(promocaoId, promoAtual ? emLeitura(promoAtual, Date.now()) : false);
  const [semaforo, setSemaforo] = useState<SemaforoPromo | null>(null);
  const [participando, setParticipando] = useState(false);
  const [aberto, setAberto] = useState<ItemPromocao | null>(null);

  const promo = promocoes.data?.find((p) => p.promocao_id === promocaoId) ?? null;
  const daAba = useMemo(() => filtrarItens(itens.data ?? [], { semaforo: null, participando }), [itens.data, participando]);
  const linhas = useMemo(() => filtrarItens(itens.data ?? [], { semaforo, participando }), [itens.data, semaforo, participando]);
  const contagem = useMemo(() => {
    const c = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null };
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
      key: 'liquido', header: 'Líquido', className: 'text-right tabular-nums',
      sortValue: (r) => corDeReferencia(r)?.liquido ?? null,
      cell: (r) => {
        const c = corDeReferencia(r);
        if (!c || c.custo == null) return <span className="text-muted-foreground">{rotuloSemLiquido(r)}</span>;
        return fmtBRL(c.liquido!);
      },
    },
    {
      key: 'markup', header: 'Markup', className: 'text-right tabular-nums',
      sortValue: (r) => { const c = corDeReferencia(r); return c && c.custo ? calcularMarkup(c.liquido!, c.custo).markup : null; },
      cell: (r) => { const c = corDeReferencia(r); return c && c.custo != null ? fmtMarkup(calcularMarkup(c.liquido!, c.custo).markup) : '—'; },
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
    <TooltipProvider>
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Promoções', to: '/promocoes' }, { label: promo?.nome ?? promocaoId }]} />
      <PageHeader
        title={promo?.nome ?? promocaoId}
        subtitle={promo ? `${rotuloTipo(promo.tipo)}${promo.prazo_adesao ? ` · adesão até ${new Date(promo.prazo_adesao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : undefined}
        actions={<Button asChild variant="outline"><a href={URL_PROMOCOES_ML} target="_blank" rel="noreferrer">Abrir no Seller Center <ExternalLink className="size-4" aria-hidden /></a></Button>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={semaforo == null} onClick={() => setSemaforo(null)}
            className="min-h-9 rounded-full border px-3 text-sm tabular-nums aria-pressed:bg-muted aria-pressed:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Todos {daAba.length}
          </button>
          <ContagemSemaforo contagem={contagem} ativo={semaforo} onFiltro={setSemaforo} />
        </div>
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
    </TooltipProvider>
  );
}
```

Conferir que `text-danger` existe como utilitário (tokens `danger` de `src/index.css`, usados pelo `StatusPill`); senão usar a mesma classe de cor que o `StatusPill` usa para `danger`.
- [ ] **Step 6:** `pnpm exec vitest run src/lib/__tests__/promocoes.test.ts src/components/promocoes` → Expected: PASS. `pnpm build` e `pnpm lint` → Expected: verde.
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
