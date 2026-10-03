# Vitrine — melhorias de leitura e identificação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada anúncio da Vitrine com nome certo, variação (cor/tamanho) e atalho para o ML; dicas ⓘ "O que é / Como ler" em cada bloco e legenda dos rótulos.

**Architecture:** O coletor diário (`coletar-trafego-ml`) passa a pedir `title,permalink,attributes` no MESMO multiget de status e grava `titulo/permalink/variacao` em `ml_trafego_item`. Migration nova recria `gravar_trafego_item` (aceita os 3 campos, nunca apaga valor com nulo) e `vitrine_resumo` (título por prioridade sem bloqueio de nulo, `variacao`, `permalink`). Front: tipos + helpers puros em `src/lib/vitrine.ts`, componente `InfoDica` reutilizando o padrão de `KpiInfoButton`, linha do "Onde agir" redesenhada.

**Tech Stack:** Postgres/Supabase, Deno edge (código testado por vitest), React+TS+shadcn (Popover/Tooltip), vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-vitrine-melhorias-design.md` (aprovado). Base: ADR-0176, ADR-0172.

## Global Constraints

- ML: só GET; nenhuma requisição nova — apenas ampliar `attributes=` do multiget existente (`deps.ts` `lerStatusItens`).
- `variacao` = `value_name` de `COLOR` e `SIZE` (nessa ordem) em `body.attributes`, unidos por " · "; ausentes omitidos; nenhum → `null`. Strings vazias/espaço = ausente.
- Coleta nunca apaga `titulo/permalink/variacao` existente com `null` (`coalesce(excluded.x, a.x)`).
- Migrations novas (as de 02/10 já estão em produção): `supabase migration new …` + `db push` só na Task 5. `20261002225552_vitrine_kit_pedido.sql` NÃO pode ser editada.
- Título exibido: `formatarNomeProduto` de `src/lib/texto.ts` (padrão do app; só transforma título 100% maiúsculo; palavra com número fica como está). **Não criar outro helper.**
- Link ML: `item.permalink ?? \`https://produto.mercadolivre.com.br/MLB-${n}\`` (n = dígitos do `ml_item_id`); `target="_blank" rel="noopener noreferrer"`, `aria-label="Abrir anúncio no Mercado Livre"`.
- Textos das dicas e da legenda: **verbatim** do Apêndice do spec.
- Nada muda em `ondeAgir`/`LIMITES` além de extrair `esperado7` (mesma fórmula).
- Modelo: Task 1 (migration) **opus**; Tasks 2–4 **sonnet**; Task 5 no loop principal. Revisão de diff por task e final: Grok 4.7 xhigh (cursor-agent). Dúvida → Codex `gpt-6-astra` high.
- pt-BR com acentos; mobile 390px sem scroll horizontal; temas claro e escuro.

## Review Focus

1. **Multiget com item sem `attributes`/`title`** (anúncio closed, resposta parcial): status continua sendo gravado; campos novos ficam `null` sem quebrar. → teste em Task 2.
2. **Coleta seguinte sem o campo** (ML omite `title` num dia): valor salvo antes permanece. → teste SQL em Task 1.
3. **Fonte de título nula de maior prioridade** (o bug MLB4876171545): cai para a próxima fonte; `codigo_pai` continua vindo da fonte de maior prioridade que o tenha. → teste SQL em Task 1.
4. **Anúncio sem título em lugar nenhum**: linha mostra o MLB + selo "título ainda não coletado"; ↗ funciona pelo fallback. → teste de componente em Task 4.
5. **Popover por teclado**: abre com Enter/Espaço, fecha com Esc, foco volta ao ⓘ. → teste de componente em Task 4.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_vitrine_identificacao.sql` (criar) | colunas em `ml_trafego_item`, `gravar_trafego_item` v2, `vitrine_resumo` v3 |
| `supabase/tests/vitrine.sql` (modificar) | asserções de título/variação/permalink |
| `supabase/tests/vendas_sku_trafego.sql` (modificar se testar `gravar_trafego_item`) | campos novos + não apagar com nulo |
| `supabase/functions/_shared/trafego/fiacao.ts` (modificar) | `parseMultigetStatus` devolve `titulo/permalink/variacao` |
| `supabase/functions/_shared/trafego/sincronizar.ts` (modificar) | tipos e repasse dos campos |
| `supabase/functions/coletar-trafego-ml/deps.ts` (modificar) | `attributes=` ampliado; envia campos à RPC |
| `supabase/functions/_shared/trafego/__tests__/fiacao.test.ts`, `sincronizar.test.ts` (modificar) | testes |
| `src/lib/vitrine.ts` (modificar) | `ItemVitrine` + `variacao/permalink`; `linkML`, `esperado7` |
| `tests/lib/vitrine.test.ts` (modificar) | testes dos helpers |
| `src/components/vitrine/info-dica.tsx` (criar) | ⓘ + popover reutilizável |
| `src/components/vitrine/dicas.ts` (criar) | textos verbatim (dicas + legenda) |
| `src/components/vitrine/pulso-vitrine.tsx`, `grafico-vitrine.tsx`, `onde-agir.tsx` (modificar) | ⓘ, legenda, linha nova |
| `tests/components/vitrine-onde-agir.test.tsx` (criar) | componente |

---

### Task 1: Migration — colunas, `gravar_trafego_item` v2, `vitrine_resumo` v3 (model: opus)

**Files:** criar `supabase/migrations/<ts>_vitrine_identificacao.sql` (`supabase migration new vitrine_identificacao`); modificar `supabase/tests/vitrine.sql` e, se ele testa `gravar_trafego_item`, `supabase/tests/vendas_sku_trafego.sql`.

**Interfaces — Produces:**
- `ml_trafego_item` + `titulo text`, `permalink text`, `variacao text` (nulas).
- `public.gravar_trafego_item(p_org uuid, p_itens jsonb)` — mesma assinatura; cada elemento aceita também `titulo`, `permalink`, `variacao` (opcionais).
- `vitrine_resumo` — cada item do JSON ganha `"variacao": string|null` e `"permalink": string|null`; `titulo` com nova prioridade.

- [ ] **Step 1: Testes SQL primeiro (vermelho).** Em `supabase/tests/vitrine.sql` (Postgres local docker `supabase_db_txvncrgkoynoxwopfkbp`, mesma forma de rodar do teste atual), acrescentar ao cenário:
  - `ml_trafego_item` (org A) para `MLBA1`: `status 'active'`, `titulo 'Título do ML A'`, `permalink 'https://ml/a'`, `variacao null`.
  - Na venda paga A-2, item MLBA1 com `cor = 'Verde'` (coluna existente em `ml_vendas_itens`).
  - `anuncios_externos` extra (org A) para `MLBK1` com `titulo null`, `codigo_pai 'P-K'`, `permalink 'https://ae/k'` (é o caso do bug: fonte prio 1 com título nulo).
  - Asserções (sempre `IS DISTINCT FROM`): MLBA1 `titulo = 'Título do ML A'` (ML vence cadastro), `permalink = 'https://ml/a'`, `variacao = 'Verde'` (fallback da venda mais recente); MLBK1 `titulo = 'Kit virtual teste'` (fonte nula não bloqueia), `codigo_pai = 'P-K'`, `permalink = 'https://ae/k'`, `variacao` nula. Ajustar asserções antigas que o cenário novo mude (ex.: `codigo_pai` de MLBK1), mantendo todas as demais (pedidos, receita, pares, kit por pack, semanas, dow, período inválido).
  - Teste de `gravar_trafego_item` (em `vitrine.sql` ou `vendas_sku_trafego.sql`, onde a RPC já é testada): chamar com `{ml_item_id:'MLBG1', status:'active', titulo:'T1', permalink:'P1', variacao:'Azul'}`, depois com `{ml_item_id:'MLBG1', status:'paused'}` (sem os campos) → linha final `status 'paused'`, `titulo 'T1'`, `permalink 'P1'`, `variacao 'Azul'` (nulo não apaga); terceira chamada com `titulo:'T2'` → `titulo 'T2'`.
  - Rodar e ver FALHAR (colunas inexistentes).
- [ ] **Step 2: Migration.**

```sql
alter table public.ml_trafego_item
  add column if not exists titulo text,
  add column if not exists permalink text,
  add column if not exists variacao text;

comment on column public.ml_trafego_item.titulo is 'Título do anúncio no ML (multiget de status do coletar-trafego-ml). Exibição na Vitrine (ADR-0176).';
comment on column public.ml_trafego_item.variacao is 'COLOR · SIZE (value_name) do item no ML; null quando o item não tem esses atributos (ex.: Legacy com variations).';

create or replace function public.gravar_trafego_item(p_org uuid, p_itens jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.ml_trafego_item as a (org_id, ml_item_id, status, status_desde, ultimo_ok_em, titulo, permalink, variacao)
  select p_org, x.ml_item_id, x.status, now(), x.ultimo_ok_em, x.titulo, x.permalink, x.variacao
    from jsonb_to_recordset(p_itens) as x(ml_item_id text, status text, ultimo_ok_em timestamptz,
                                          titulo text, permalink text, variacao text)
  on conflict (org_id, ml_item_id) do update
    set status       = excluded.status,
        status_desde = case when a.status is distinct from excluded.status then excluded.status_desde else a.status_desde end,
        ultimo_ok_em = greatest(a.ultimo_ok_em, excluded.ultimo_ok_em),
        titulo       = coalesce(excluded.titulo, a.titulo),
        permalink    = coalesce(excluded.permalink, a.permalink),
        variacao     = coalesce(excluded.variacao, a.variacao);
$$;
-- Reemitir os MESMOS revoke/grant da definição original (20260927084615_vendas_sku_trafego.sql:166,173): só service_role executa.
```
  Depois, `create or replace function public.vitrine_resumo(p_inicio date, p_fim date)` = cópia **integral** de `20261002225552_vitrine_kit_pedido.sql` com só estas mudanças:
  1. O `union all` do `info` vira CTE `fontes` com colunas `(ml_item_id, titulo, codigo_pai, permalink, prio, criado_em)`: Legacy (`ae.permalink`), UP (`aei.permalink`), kit, catálogo UP (`aei.permalink`), família, catálogo opt-in (demais `null::text` para permalink).
  2. `info_cod` = `distinct on (ml_item_id) … where codigo_pai is not null order by ml_item_id, prio, criado_em desc nulls last` → `codigo_pai`.
  3. `info_tit` = idem `where titulo is not null` → `titulo`.
  4. `info_link` = idem `where permalink is not null` → `permalink`.
  5. `cor_venda` = `select distinct on (i.ml_item_id) i.ml_item_id, i.cor from ml_vendas_itens i join ml_vendas s on s.id = i.venda_id and s.org_id = i.org_id cross join org where i.org_id = org.id and i.cor is not null and nullif(trim(i.cor), '') is not null and i.ml_item_id in (select ml_item_id from agg) order by i.ml_item_id, s.date_closed desc nulls last`.
  6. No objeto do item: `'titulo', coalesce(nullif(trim(t.titulo), ''), it.titulo, tv.titulo)`, `'codigo_pai', ic.codigo_pai`, `'variacao', coalesce(nullif(trim(t.variacao), ''), cv.cor)`, `'permalink', coalesce(t.permalink, il.permalink)`; joins `left join info_cod ic`, `left join info_tit it`, `left join info_link il`, `left join cor_venda cv` (todos por `ml_item_id`).
  Reemitir `revoke all … from public, anon; grant execute … to authenticated;`. Não repetir backfill de menu.
- [ ] **Step 3:** aplicar no Postgres local, rodar `supabase/tests/vitrine.sql` (+ o de tráfego se mexido) → `NOTICE: TESTE_OK`. Rodar `npm run db:check` (divergência esperada só da migration nova).
- [ ] **Step 4: Commit** `feat(vitrine): título/variação/link no tráfego e na RPC` (só os arquivos SQL).

---

### Task 2: Coletor — campos novos no multiget (model: sonnet)

**Files:** `supabase/functions/_shared/trafego/fiacao.ts`, `supabase/functions/_shared/trafego/sincronizar.ts`, `supabase/functions/coletar-trafego-ml/deps.ts`, testes em `supabase/functions/_shared/trafego/__tests__/fiacao.test.ts` e `sincronizar.test.ts`.

**Interfaces:**
- `export function variacaoDeAtributos(attrs: unknown): string | null` (fiacao.ts).
- `parseMultigetStatus` devolve `{ ml_item_id: string; status: string; titulo: string | null; permalink: string | null; variacao: string | null }[]`.
- `StatusItemGravar` = `{ ml_item_id; status; ultimo_ok_em; titulo: string | null; permalink: string | null; variacao: string | null }`.
- `lerStatusItens` com o tipo novo; URL `…&attributes=id,status,title,permalink,attributes`.

- [ ] **Step 1: Testes (vermelho)** em `fiacao.test.ts`:

```ts
describe('variacaoDeAtributos', () => {
  it('cor', () => expect(variacaoDeAtributos([{ id: 'COLOR', value_name: 'Marsala' }])).toBe('Marsala'));
  it('cor · tamanho, nessa ordem', () =>
    expect(variacaoDeAtributos([{ id: 'SIZE', value_name: 'G' }, { id: 'COLOR', value_name: 'Azul' }])).toBe('Azul · G'));
  it('sem cor/tamanho, vazio ou não-array → null', () => {
    expect(variacaoDeAtributos([{ id: 'BRAND', value_name: 'Búfalo' }])).toBeNull();
    expect(variacaoDeAtributos([{ id: 'COLOR', value_name: '  ' }])).toBeNull();
    expect(variacaoDeAtributos(undefined)).toBeNull();
  });
});
describe('parseMultigetStatus com campos novos', () => {
  it('extrai título, link e variação', () => {
    expect(parseMultigetStatus([{ code: 200, body: { id: 'MLB1', status: 'active', title: 'Fita X', permalink: 'https://p/1',
      attributes: [{ id: 'COLOR', value_name: 'Verde' }] } }]))
      .toEqual([{ ml_item_id: 'MLB1', status: 'active', titulo: 'Fita X', permalink: 'https://p/1', variacao: 'Verde' }]);
  });
  it('item sem title/attributes continua com status; campos novos null', () => {
    expect(parseMultigetStatus([{ code: 200, body: { id: 'MLB2', status: 'closed' } }]))
      .toEqual([{ ml_item_id: 'MLB2', status: 'closed', titulo: null, permalink: null, variacao: null }]);
  });
});
```
  Em `sincronizar.test.ts`: ajustar o mock de `lerStatusItens` para devolver os campos novos e a asserção existente (`toContainEqual({ ml_item_id:'MLB2', status:'active', ultimo_ok_em:null })`) passa a incluir `titulo/permalink/variacao` repassados; caso de MLB sem status (`desconhecido`) grava os 3 como `null`.
- [ ] **Step 2: Implementar.** `variacaoDeAtributos`: se não for array → null; pega `value_name` (string, `trim`, não vazio) do primeiro `id==='COLOR'` e do primeiro `id==='SIZE'`; junta `[cor, tam].filter(Boolean).join(' · ') || null`. `parseMultigetStatus`: mantém o filtro atual (code 200, id/status string) e acrescenta `titulo: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null`, `permalink` idem, `variacao: variacaoDeAtributos(body.attributes)`. `sincronizar.gravarStatus` repassa os 3 campos (MLB sem status → null). `deps.ts`: só a URL e o mapeamento para a RPC (os 3 campos vão no `p_itens`).
- [ ] **Step 3:** `pnpm exec vitest run supabase/functions/_shared/trafego/__tests__/` verde; `deno check supabase/functions/coletar-trafego-ml/index.ts` (ou o lint de backend que o CI roda — conferir `package.json`/CI `backend-lint`).
- [ ] **Step 4: Commit** `feat(trafego): coletor traz título, link e variação no multiget de status`.

---

### Task 3: `src/lib/vitrine.ts` — tipos e helpers (model: sonnet)

**Files:** `src/lib/vitrine.ts`, `tests/lib/vitrine.test.ts`.

**Interfaces — Produces:**
- `ItemVitrine` + `variacao: string | null; permalink: string | null`.
- `export function esperado7(i: ItemVitrine): number` — `(visitas − visitas_ult7) × 7 ÷ (pares_ok − dias_ok_ult7)`, 0 quando o divisor ≤ 0. `ondeAgir` passa a usá-la (mesmo comportamento; testes atuais continuam verdes).
- `export function linkML(i: Pick<ItemVitrine, 'ml_item_id' | 'permalink'>): string` — `permalink` se não vazio; senão `https://produto.mercadolivre.com.br/MLB-${dígitos}`.

- [ ] **Step 1: Testes (vermelho):**

```ts
describe('esperado7', () => {
  it('taxa dos outros dias × 7', () => expect(esperado7(item({ visitas: 50, visitas_ult7: 0, pares_ok: 28, dias_ok_ult7: 7 }))).toBeCloseTo(50 * 7 / 21));
  it('divisor ≤ 0 → 0', () => expect(esperado7(item({ visitas: 9, pares_ok: 7, dias_ok_ult7: 7 }))).toBe(0));
});
describe('linkML', () => {
  it('usa o permalink', () => expect(linkML({ ml_item_id: 'MLB1', permalink: 'https://p/1' })).toBe('https://p/1'));
  it('sem permalink monta pelo MLB', () => expect(linkML({ ml_item_id: 'MLB4876171545', permalink: null })).toBe('https://produto.mercadolivre.com.br/MLB-4876171545'));
  it('permalink vazio = ausente', () => expect(linkML({ ml_item_id: 'MLB7', permalink: '  ' })).toBe('https://produto.mercadolivre.com.br/MLB-7'));
});
```
  (O helper `item()` do arquivo ganha `variacao: null, permalink: null` no default.)
- [ ] **Step 2:** implementar; `ondeAgir` usa `esperado7(i)`.
- [ ] **Step 3:** `pnpm exec vitest run tests/lib/vitrine.test.ts`, eslint, `pnpm exec tsc -b --noEmit`.
- [ ] **Step 4: Commit** `feat(vitrine): variação, link do ML e esperado7 no modelo`.

---

### Task 4: UI — ⓘ, legenda e linha nova (model: sonnet)

**Files:** criar `src/components/vitrine/info-dica.tsx`, `src/components/vitrine/dicas.ts`, `tests/components/vitrine-onde-agir.test.tsx`; modificar `pulso-vitrine.tsx`, `grafico-vitrine.tsx`, `onde-agir.tsx`.

**Interfaces:** `InfoDica({ titulo: string; children: ReactNode })` — botão ⓘ (`Info` do lucide, `aria-label="Como ler: {titulo}"`) + `Popover` (padrão de `KpiInfoButton` em `src/components/ui/kpi-card.tsx:45-79`). `dicas.ts` exporta `DICAS: Record<'visitas'|'conversao'|'vendaPorVisita'|'grafico', { oQueE: string; comoLer: string[] }>` e `LEGENDA: { rotulo: Rotulo; significa: string; fazer: string; porQue: string }[]` — **textos verbatim do Apêndice do spec** (cada frase de "Como ler" vira um item).

- [ ] **Step 1: Testes de componente (vermelho)** em `tests/components/vitrine-onde-agir.test.tsx` (Testing Library, padrão de `tests/pages/Vitrine.test.tsx`):
  1. Linha com `titulo: 'FITA CETIM PROGRESSO N.3 | 10 METROS'`, `variacao: 'Marsala'` → mostra `Fita Cetim Progresso N.3 | 10 Metros` e `Marsala`.
  2. Link `getByRole('link', { name: 'Abrir anúncio no Mercado Livre' })` com `href` = permalink; sem permalink → URL montada; `target="_blank"` e `rel` contendo `noopener`.
  3. Sem título → mostra o `ml_item_id` e o texto `título ainda não coletado`.
  4. Invisível mostra `o normal seria ~N` com N = `Math.round(esperado7)`.
  5. ⓘ do "Onde agir": clicar abre a legenda com as 4 linhas (os 4 rótulos e seus textos); `Escape` fecha; foco volta ao botão.
- [ ] **Step 2: Implementar.**
  - `pulso-vitrine.tsx`: `InfoDica` ao lado do rótulo de cada card (Visitas, Conversão, Venda por visita) com `DICAS[...]`.
  - `grafico-vitrine.tsx`: `InfoDica` ao lado do `h2`.
  - `onde-agir.tsx`: `InfoDica` ao lado do `h2` "Onde agir" com a tabela `LEGENDA` (Rótulo · Significa · O que fazer · Por que entrou; em telas estreitas vira lista empilhada); chips de filtro com `Tooltip` da frase `significa`.
  - Linha (desktop ≥ `sm`): grid `[rótulo+título] [visitas] [conversão] [≈ pedidos]`, números `tabular-nums` alinhados à direita, cabeçalho de colunas discreto acima da lista ("Visitas", "Conversão", "Em jogo"). Rótulo = ponto ● colorido (tom atual do rótulo) + nome em texto normal (substitui o `StatusPill` cheio); título `formatarNomeProduto(i.titulo)` (fallback: `i.ml_item_id` + selo `título ainda não coletado`); etiqueta de variação = `StatusPill`/badge em contorno neutro, só se `i.variacao`; ↗ = `ExternalLink` 14px com o link de `linkML(i)`. Segunda linha: motivo (Invisível: `Sem visita há 7+ dias (o normal seria ~${Math.round(esperado7(i))})`; demais: frase atual) ; terceira: ação sugerida + `Ver no dossiê ›` (quando `codigo_pai`). Selo Ads só em `converte` (como hoje).
  - Mobile (< `sm`): empilha — linha 1 rótulo + ↗ à direita; linha 2 título + variação; linha 3 `N visitas em {4 sem|12 sem|6 meses} · conv · ≈ pedidos`; linha 4 ação · Dossiê. O período vem da página (passar `preset` ao `OndeAgir`).
  - Manter: filtro por rótulo, top 10 + "Ver todos", estados vazio.
- [ ] **Step 3:** `pnpm exec vitest run tests/components/vitrine-onde-agir.test.tsx tests/pages/Vitrine.test.tsx tests/lib/vitrine.test.ts`; `pnpm test`; `pnpm lint`; `pnpm preflight:static`.
- [ ] **Step 4: Commit** `feat(vitrine): dicas ⓘ, legenda dos rótulos e linha com variação e link do ML`.

---

### Task 5: Deploy, coleta manual, validação e docs (loop principal)

- [ ] **Step 1:** `supabase db push` (migration da Task 1); `supabase functions deploy coletar-trafego-ml`; conferir versão ativa (`supabase functions list`).
- [ ] **Step 2: Coleta manual** via QStash publish (não esperar o cron 09:17 UTC): `POST https://qstash.upstash.io/v2/publish/https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-trafego-ml` com `Authorization: Bearer $QSTASH_TOKEN` (de `.env.local`, nunca impresso) e `Upstash-Retries: 1`. Acompanhar até `ml_trafego_item.titulo` preenchido para a org Avil (SQL read-only). Medir: % de MLBs com título, com variação; conferir MLB4876171545 (título) e os 36 "FITA CETIM PROGRESSO N.3" (variações distintas).
- [ ] **Step 3: Validação visual** (skill `playwright-cli`, sessão isolada, login VALIDATION, JSON real da Avil coletado da RPC nova e injetado): desktop 1440, 390px, tema claro; abrir os 5 ⓘ; legenda; clicar ↗ (confere `href`); hover nos chips; screenshots; console limpo.
- [ ] **Step 4: Docs:** nota no ADR-0176 ("Nota — identificação e dicas, 2026-10-03"), `docs/reference/modelo-de-dados.md` (colunas novas + RPC v3), `docs/reference/edge-functions.md` (multiget ampliado), `docs/runbooks/coletar-trafego-ml.md` (comando de coleta manual via QStash publish), `docs/TASKS.md` — skill `docs-update-checklist`.
- [ ] **Step 5:** revisão final Grok 4.7 xhigh da branch, correções, `pnpm preflight`, CI verde → parar no ponto de merge e chamar o Diego.
