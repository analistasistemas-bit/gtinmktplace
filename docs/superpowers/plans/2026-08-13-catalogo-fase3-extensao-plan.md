# Catálogo em risco — Fase 3: extensão de navegador (Plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão Chrome MV3 (carregada sem compactação) que aplica "Não encontro minha variação" em massa nos anúncios listados pelo card "Catálogo em risco", na sessão logada do operador, com dry-run obrigatório antes de qualquer envio e preservação estrita dos vínculos já corretos.

**Architecture:** Pasta `extensao-ml/` no repo, sem build step (JS puro, ESM). O coração é uma função pura `montarPlanoAnuncio` (testada exaustivamente por vitest) que replica byte a byte o `getMappedGroups` do bundle do próprio ML. O painel da extensão orquestra: lê o estado SSR da página do matcher via `chrome.scripting.executeScript` (world MAIN), monta e exibe o dry-run, e só envia sob confirmação explícita — **duas chamadas por anúncio** (`multivariation_matcher_confirm` + `massive_summary_confirm`; a segunda ecoa a resposta da primeira). O PubliAI só entrega a lista (postMessage → content script) e, terminado o lote, re-enfileira `vincular-catalogo` pelo script de backfill já existente. A extensão não escreve no banco.

**Tech Stack:** Chrome MV3 (manifest v3, ESM, `chrome.scripting`/`chrome.storage.session`), vitest, React + TanStack Query (lado PubliAI), PostgREST.

**Spec:** `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md` (Parte 3 + seção "Contrato do matcher confirm — RESOLVIDO"). Correções à spec descobertas nesta análise estão na seção "Achados" abaixo e viram a Task 8.

## Global Constraints

- **Dry-run é o padrão.** Nenhum PATCH/POST sai sem confirmação explícita do operador no painel — por anúncio ou por lote, mas sempre depois de exibir o payload. (Regra do projeto: revisão humana antes de alterar anúncio publicado.)
- **Preservar os matches corretos é estrito:** variação fora da lista de risco só entra no payload com o `catalog_product_id` que o PubliAI conhece (`variacoes.catalog_product_id` de status `vinculado`). Match presente na página que o PubliAI não confirmou → anúncio inteiro vira `manual`. Nunca aceitar sugestão do ML (bypass da `fichaEquivalente` = repetir o incidente do kit).
- **O payload replica `getMappedGroups` do ML literalmente**, inclusive o `filter(e => !e.status)`. Variações sem `status` nunca são omitidas: ou preservam vínculo ou levam `null`.
- A extensão não escreve no banco do PubliAI; não armazena credencial nenhuma; `host_permissions` só ML + domínio do app.
- Nenhuma escrita em anúncio real durante o desenvolvimento. Envio real só na Task 7 (validação guiada com Diego), começando por UM anúncio escolhido a dedo.
- Item plano (`ml_variation_id = ml_item_id`, 16 anúncios) fica FORA do lote — o fluxo dele no ML é individual, não o matcher multivariação.
- Testes: `pnpm test` (exige `.env.test`). Lint: `pnpm lint`. Teste dirigido: `pnpm test <caminho>`.
- Commits em português, sem emoji, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Modelo: Tasks 1–6 podem descer para sonnet; Task 7 (envio real em marketplace) fica no loop principal — regra do CLAUDE.md de nunca rebaixar em publicação de marketplace.

## Achados da análise crítica (2026-08-13, bundle `optin.js` + banco read-only)

**Confirmado no bundle (não é suposição):**

1. **`getMappedGroups` literal** (`variant-matcher-card/helpers/groups-mapper.js`): `group_attributes` = `match_product.attributes` mapeado para `{id,name,value_id,value_name}`; `matches` = `variations.filter(e => !e.status).map(e => ({entity_id: e.id, catalog_product_id: e.match?.product?.id || null}))`. O `entity_id` sai **sem conversão de tipo** (número no estado → número no payload).
2. **`status` das variações só tem dois valores**: `VARIATIONS_STATUS = {HIDDEN:"hidden", DISABLED:"disabled"}`. Linhas `hidden` nem são renderizadas na tabela do matcher; ambas ficam fora do payload que o próprio ML envia.
3. **`productId` = `stepData.parent_catalog_product.id`** (em `onCardConfirm`/`useVariantMatcherCardContent`). O `original_catalog_product_id` observado na página é o mesmo valor no contexto de melidata — serve de fallback de leitura.
4. **Não existe GET da API interna que devolva o estado do matcher.** A lista completa de endpoints do módulo foi extraída: os únicos GETs são `family-specs`, `comparison` e `product-suggestions/comparison` — nenhum devolve grupos/variações/matches. O dado chega por SSR (`initialOptinData` = `{step, step_data, ...contextData}`, embutido na página) e pelas **respostas** dos PATCHes de confirmação (wizard dirigido pelo servidor: toda ação chama `onChangeStep(resposta)`).
5. **A spec está errada em "uma chamada por anúncio": são DUAS.** O `multivariation_matcher_confirm` é um passo do wizard; a resposta dele traz o passo `MULTI_VARIATION_SUMMARY`, cujo botão de confirmação ("Crear publicaciones con competencia") chama `massiveSummaryConfirm(stepData.parent_catalog_product.id, stepData.product_associations, invoice)` → `POST .../massive_summary_confirm`. É aí que o fluxo se consuma (o congrats seguinte carrega `catalog_listing_created_ids`). **O payload do summary é ecoado da resposta do matcher confirm** — a extensão não o constrói, só o devolve, com um guard de consistência (ver Task 4).
6. **Gates do summary:** o stepData do summary pode trazer `add_invoice` (exige nota) e `anatel_data` (eletrônicos). Se qualquer um vier, a extensão para o anúncio e reporta `manual` — não inventamos invoice.
7. **CSRF:** o cliente HTTP do ML (`frontend-restclient`) lê `<meta name="csrf-token">` da página e manda no header `x-csrf-token`. Cookie vai sozinho (fetch same-origin). É exatamente o que um `fetch` executado na página consegue reproduzir.
8. **`basePath` não é hardcodável:** o literal `"/seller_central/catalog/optin_buybox/"` do bundle é sobrescrito pelo spread dos dados SSR (`{basePath:"...", ...t}`), e a captura de junho (ADR-0036) mostrou `/produzir/catalogo/api/optin-up/...`. Ler do estado da página; fallback: derivar de `location.pathname`.

**Confirmado no banco (read-only, 2026-08-13):** 130 anúncios em risco no total pela heurística de
`catalog_status` — **114 multivariação** (1.642 variações) + **16 item plano** (fora do escopo).
**21 dos 114** têm no mesmo anúncio variações `vinculado`/`family_diff` — o cenário "preservar
matches" é real e mensurável.

**Correção de escopo (mesmo dia, decisão do Diego):** esses 130/114 são a base de dados usada para
montar `variacoesRisco`/`vinculos`/`itemPlano` por anúncio (o que a extensão consome), mas deixam
de ser a lista que aparece na tela e vira alvo do lote. O card e a extensão passam a operar SÓ nos
anúncios que o ML sinaliza com a tag `catalog_forewarning` (verificado ao vivo:
`GET /users/{seller}/items/search?tags=catalog_forewarning` → 3 hoje, `MLB7066697288`,
`MLB7159179348`, `MLB4888109497` — os mesmos que o painel "Próximos a serem pausados" do ML
mostra). Ver spec 2026-08-12, seção "Mudança de escopo (2026-08-13)", e
`src/lib/catalogo-risco.ts:filtrarCatalogForewarning`. As Tasks abaixo continuam válidas como
descritas (a extensão recebe o mesmo `AnuncioEmRisco[]`, só que agora pré-filtrado); os números
114/130/21 citados nesta análise são o universo da heurística local, não mais o tamanho real do
lote em produção.

**Suposições (declaradas, não inventadas):**

- **`window.__NORDIC_RENDERING_CTX__`** como chave do estado foi observado ao vivo em 2026-08-13 (CDP, read-only) — não aparece no bundle (a hidratação é do framework nordic, fora deste chunk). O leitor do estado é resiliente por construção (busca estrutural por `{step, step_data}`), e o dry-run da Task 7 valida em páginas reais antes de qualquer envio.
- **Semântica servidor de omitir variação com `status`** ("não mexer" vs "desassociar") não é determinável pelo cliente. **A extensão não precisa responder isso**: ela envia exatamente o que o próprio ML enviaria num confirm manual (mesmo filtro, mesma construção) — risco idêntico ao fluxo manual que o operador já executa hoje. O dry-run lista as variações excluídas por `status` para conferência; nenhum experimento de escrita é necessário.
- **Se `multivariation_matcher_confirm` sozinho persiste algo** no servidor é desconhecido. Tratamos o wizard como não-consumado até o `massive_summary_confirm` — por isso as duas chamadas são disparadas em sequência na mesma confirmação do operador, e falha entre elas é reportada com instrução de terminar manualmente na página.
- **O passo inicial da página pode não ser o matcher multivariação** para todo anúncio (o wizard tem EXPERIENCE_DECIDER, VARIATIONS_HUB etc.). A extensão só age quando o estado tem a forma do matcher (grupos com variações e `match_product`); qualquer outra forma → `manual`, com o `step` registrado no relatório. O dry-run da Task 7 mede quantos dos 114 caem direto no matcher.

## Decisões que precisam do Diego antes da Task 7

1. **`family_diff` sem decisão no matcher:** se uma variação `family_diff` aparecer sem `status` e sem vínculo confirmado, o anúncio inteiro vira `manual` (default conservador deste plano). Alternativa: declarar `null` ("não encontro") também para elas — plausível (mantém o anúncio vivo), mas é decisão de negócio. O dry-run vai mostrar quantos anúncios caem nesse caso.
2. **Escolha do primeiro anúncio de envio real** (critérios na Task 7 — a escolha final é dele).

## Estrutura de arquivos

```
extensao-ml/
  manifest.json          MV3, permissões mínimas
  sw.js                  service worker: recebe o lote, guarda, abre o painel
  content-publiai.js     content script no app: handshake de detecção + captura do lote
  painel.html            UI do lote: dry-run, confirmação, relatório
  painel.js              orquestração (abas ML, executeScript, envio)
  lib/payload.js         FUNÇÕES PURAS (contrato) — únicas testadas por vitest
  __tests__/payload.test.ts
src/lib/catalogo-risco.ts        (+variacoesRisco, vinculos, itemPlano no agregador)
src/lib/queries.ts               (fetchCatalogoEmRisco passa a trazer vinculado + catalog_product_id)
src/hooks/useExtensaoCatalogo.ts (detecção da extensão)
src/components/catalogo-em-risco.tsx (botão "Resolver todos no ML")
vitest.config.ts                 (+include de extensao-ml)
```

---

### Task 1: Agregador do PubliAI carrega o que a extensão precisa

O card hoje só tem contagens. A extensão precisa, por anúncio: as variações em risco (`ml_variation_id`) e os vínculos confirmados a preservar (`ml_variation_id → catalog_product_id`).

**Files:**
- Modify: `src/lib/catalogo-risco.ts`
- Modify: `src/lib/queries.ts:874-883` (`fetchCatalogoEmRisco`)
- Test: `src/lib/__tests__/catalogo-risco.test.ts`

**Interfaces:**
- Produces: `AnuncioEmRisco` ganha `variacoesRisco: string[]`, `vinculos: Record<string, string>`, `itemPlano: boolean`. `FamiliaRiscoRow.variacoes[i]` ganha `catalog_product_id: string | null`. Task 6 (botão) consome esses campos para montar o lote.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/lib/__tests__/catalogo-risco.test.ts` (seguir o padrão dos testes existentes do arquivo):

```ts
describe('agruparCatalogoRisco — dados para a extensão (Fase 3)', () => {
  const fam = (over: Partial<FamiliaRiscoRow>): FamiliaRiscoRow => ({
    id: 'f1', ml_item_id: 'MLB1', titulo_ml: 'Anúncio', nome_pai: null, variacoes: [], ...over,
  });

  it('coleta variacoesRisco (só as publicadas em status de risco)', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'pendente', ml_variation_id: '222', catalog_product_id: null },
        { catalog_status: 'pendente', ml_variation_id: null, catalog_product_id: null }, // nunca publicada
      ],
    })]);
    expect(r[0].variacoesRisco).toEqual(['111', '222']);
  });

  it('coleta vinculos das variações vinculado do MESMO anúncio', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'vinculado', ml_variation_id: '333', catalog_product_id: 'MLB999' },
      ],
    })]);
    expect(r[0].vinculos).toEqual({ '333': 'MLB999' });
  });

  it('vinculado sem catalog_product_id não entra em vinculos', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'vinculado', ml_variation_id: '333', catalog_product_id: null },
      ],
    })]);
    expect(r[0].vinculos).toEqual({});
  });

  it('família só com vinculado não vira anúncio em risco, mas seus vinculos agregam no mesmo ml_item_id', () => {
    const r = agruparCatalogoRisco([
      fam({ id: 'f1', variacoes: [{ catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null }] }),
      fam({ id: 'f2', variacoes: [{ catalog_status: 'vinculado', ml_variation_id: '444', catalog_product_id: 'MLB777' }] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].vinculos).toEqual({ '444': 'MLB777' });
  });

  it('marca itemPlano quando ml_variation_id === ml_item_id', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [{ catalog_status: 'pendente', ml_variation_id: 'MLB1', catalog_product_id: null }],
    })]);
    expect(r[0].itemPlano).toBe(true);
  });

  it('multivariação normal tem itemPlano false', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [{ catalog_status: 'pendente', ml_variation_id: '555', catalog_product_id: null }],
    })]);
    expect(r[0].itemPlano).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/lib/__tests__/catalogo-risco.test.ts`
Expected: FAIL (campos inexistentes / erro de tipo).

- [ ] **Step 3: Implementar**

Em `src/lib/catalogo-risco.ts`:

```ts
export interface FamiliaRiscoRow {
  id: string;
  ml_item_id: string | null;
  titulo_ml: string | null;
  nome_pai: string | null;
  variacoes: Array<{
    catalog_status: string | null;
    ml_variation_id: string | null;
    catalog_product_id: string | null;
  }>;
}

export interface AnuncioEmRisco {
  mlItemId: string;
  titulo: string;
  qtdSemFicha: number;
  motivoPredominante: StatusRisco;
  url: string;
  /** ml_variation_id publicados em status de risco — a extensão manda null para eles. */
  variacoesRisco: string[];
  /** ml_variation_id -> catalog_product_id das variações 'vinculado' — a extensão preserva exatamente estes. */
  vinculos: Record<string, string>;
  /** ml_variation_id === ml_item_id (ADR-0084): fluxo individual no ML, fora do lote da extensão. */
  itemPlano: boolean;
}
```

No `agruparCatalogoRisco`: o acumulador por item ganha `variacoesRisco: string[]`, `vinculos: Record<string,string>`, `itemPlano: boolean`. Mudanças no laço:

- A entrada agora traz também linhas `vinculado` (a query da Fase 3 amplia o `.in(...)`); o filtro `emRisco` continua idêntico (só `STATUS_RISCO`), então família sem linha de risco continua fora da lista — **mas** antes do `continue`, se a família tem `ml_item_id` que JÁ está no mapa (ou vier a estar), os vínculos precisam agregar. Implementação simples: duas passadas — primeira passada monta o mapa de risco como hoje (+ `variacoesRisco`, `itemPlano`); segunda passada percorre todas as rows e, para `ml_item_id` presente no mapa, agrega `vinculos` de toda variação com `catalog_status === 'vinculado'`, `ml_variation_id` e `catalog_product_id` não nulos.
- `variacoesRisco`: push de `v.ml_variation_id` dentro do laço `for (const v of emRisco)` existente.
- `itemPlano`: `true` se alguma variação em risco tem `ml_variation_id === f.ml_item_id`.

Em `src/lib/queries.ts`, `fetchCatalogoEmRisco`:

```ts
export async function fetchCatalogoEmRisco(): Promise<FamiliaRiscoRow[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, ml_item_id, titulo_ml, nome_pai, variacoes!inner(catalog_status, ml_variation_id, catalog_product_id)')
    .not('ml_item_id', 'is', null)
    .not('variacoes.ml_variation_id', 'is', null)
    .in('variacoes.catalog_status', [...STATUS_RISCO, 'vinculado']);
  if (error) throw error;
  return (data ?? []) as FamiliaRiscoRow[];
}
```

Atenção: o `!inner` agora deixa passar famílias só-vinculado — é intencional (segunda passada do agregador); elas não geram card porque o agregador as descarta como risco.

- [ ] **Step 4: Rodar testes (novos e os antigos do arquivo) e ver passar**

Run: `pnpm test src/lib/__tests__/catalogo-risco.test.ts`
Expected: PASS, incluindo os testes pré-existentes (regressão do filtro `ml_variation_id is not null`).

- [ ] **Step 5: Conferir os testes do card que consomem o tipo**

Run: `pnpm test src/components/__tests__/catalogo-em-risco.test.tsx && pnpm lint`
Expected: PASS (se o fixture do teste do card construir `AnuncioEmRisco` literal, completar os campos novos).

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalogo-risco.ts src/lib/queries.ts src/lib/__tests__/catalogo-risco.test.ts src/components/__tests__/catalogo-em-risco.test.tsx
git commit -m "feat(catalogo): agregador de risco carrega variacoes, vinculos e item plano para a extensao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Funções puras do contrato (`extensao-ml/lib/payload.js`) — o coração do risco

Replica `getMappedGroups` do ML e aplica a política de decisão por variação. É aqui que "preservar os matches corretos" vira código testado exaustivamente.

**Files:**
- Create: `extensao-ml/lib/payload.js` (ESM puro, sem dependências — roda no navegador via import dinâmico e no vitest)
- Create: `extensao-ml/__tests__/payload.test.ts`
- Modify: `vitest.config.ts` (include)

**Interfaces:**
- Produces (Tasks 3–5 consomem):
  - `extrairEstadoOptin(ctx: unknown): { step: unknown, stepData: any, contextData: any } | null`
  - `montarPlanoAnuncio(estado, variacoesRisco: string[], vinculos: Record<string,string>): PlanoAnuncio`
    onde `PlanoAnuncio = { tipo:'ok', productId, flow, confirmedProductMatches, resumo } | { tipo:'manual', motivo: string, resumo?: Resumo }`
    e `Resumo = { null_enviados: string[], preservados: string[], excluidos_por_status: string[], risco_ausente: string[] }`
  - `montarUrlOptinUp(basePath: string, itemId: string, recurso: string): string`
  - `interpretarRespostaMatcher(corpo: any, plano: PlanoAnuncio): { acao:'summary', parentProductId, productAssociations } | { acao:'manual', motivo: string }`

- [ ] **Step 1: Habilitar o diretório no vitest**

Em `vitest.config.ts`, adicionar ao `include`:

```ts
'./extensao-ml/__tests__/**/*.test.{ts,js}',
```

- [ ] **Step 2: Escrever os testes que falham**

`extensao-ml/__tests__/payload.test.ts` — fixture base espelha a estrutura confirmada no bundle (`groups[].match_product.attributes`, `groups[].variations[].{id,status,match}`; ids de variação são **números** no estado do ML):

```ts
import { describe, it, expect } from 'vitest';
import {
  extrairEstadoOptin, montarPlanoAnuncio, montarUrlOptinUp, interpretarRespostaMatcher,
} from '../lib/payload.js';

const attrs = [
  { id: 'COLOR', name: 'Cor', value_id: '52049', value_name: 'Preto', extra_chave: 'DEVE_SUMIR' },
];

const grupo = (variations: unknown[]) => ({
  type: 'SIMPLE',
  match_product: { attributes: attrs },
  variations,
});

const estadoBase = (groups: unknown[]) => ({
  stepData: { groups, parent_catalog_product: { id: 'MLB28848109' } },
  contextData: { flow: 'REPRODUCTIZE', entity_id: 'MLB4888109497' },
  step: 'MULTI_VARIATION_MATCHER',
});

describe('extrairEstadoOptin', () => {
  it('acha {step, step_data} em qualquer profundidade do ctx SSR', () => {
    const ctx = { a: { b: [{ step: 'X', step_data: { groups: [] }, flow: 'REPRODUCTIZE' }] } };
    const e = extrairEstadoOptin(ctx);
    expect(e?.step).toBe('X');
    expect(e?.stepData).toEqual({ groups: [] });
    expect(e?.contextData.flow).toBe('REPRODUCTIZE');
  });
  it('devolve null quando não há initialOptinData', () => {
    expect(extrairEstadoOptin({ qualquer: 'coisa' })).toBeNull();
    expect(extrairEstadoOptin(null)).toBeNull();
  });
  it('não entra em loop com referência circular', () => {
    const ctx: any = {}; ctx.eu = ctx;
    expect(extrairEstadoOptin(ctx)).toBeNull();
  });
});

describe('montarPlanoAnuncio — matriz de decisão por variação', () => {
  it('variação em risco vai com catalog_product_id null (o "não encontro")', () => {
    const estado = estadoBase([grupo([{ id: 205157946311, match: null }])]);
    const p = montarPlanoAnuncio(estado, ['205157946311'], {});
    expect(p.tipo).toBe('ok');
    if (p.tipo !== 'ok') return;
    expect(p.confirmedProductMatches[0].matches).toEqual([
      { entity_id: 205157946311, catalog_product_id: null },
    ]);
    expect(p.resumo.null_enviados).toEqual(['205157946311']);
  });

  it('variação em risco COM sugestão do ML ainda vai null (nunca aceitar sugestão)', () => {
    const estado = estadoBase([grupo([{ id: 111, match: { product: { id: 'MLB_SUGESTAO' } } }])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches[0].catalog_product_id).toBeNull();
  });

  it('variação vinculada no PubliAI é preservada com o MESMO product id', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 333, match: { product: { id: 'MLB999' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], { '333': 'MLB999' });
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches).toEqual([
      { entity_id: 111, catalog_product_id: null },
      { entity_id: 333, catalog_product_id: 'MLB999' },
    ]);
    expect(p.resumo.preservados).toEqual(['333']);
  });

  it('match na página DIVERGENTE do vínculo do PubliAI → manual (não sobrescrever nem confiar)', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 333, match: { product: { id: 'MLB_OUTRA' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], { '333': 'MLB999' });
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'vinculo_divergente:333' });
  });

  it('match presente mas SEM vínculo no PubliAI (ex.: sugestão para family_diff) → manual', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 444, match: { product: { id: 'MLB_SUGESTAO' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'match_nao_confirmado:444' });
  });

  it('variação fora da lista, sem status e sem match → manual (payload ficaria incompleto)', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 555, match: null },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'variacao_sem_decisao:555' });
  });

  it('variação com status (hidden/disabled) sai do payload — MESMO filtro do getMappedGroups', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 666, status: 'hidden', match: { product: { id: 'MLB1' } } },
      { id: 777, status: 'disabled', match: null },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches).toHaveLength(1);
    expect(p.resumo.excluidos_por_status.sort()).toEqual(['666', '777']);
  });

  it('variação em risco que só existe com status entra em risco_ausente (banco defasado), sem bloquear', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 666, status: 'hidden' },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111', '666'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.resumo.risco_ausente).toEqual(['666']);
  });

  it('nenhuma variação em risco presente e ativa → manual (nada a fazer aqui)', () => {
    const estado = estadoBase([grupo([{ id: 333, match: { product: { id: 'MLB999' } } }])]);
    const p = montarPlanoAnuncio(estado, ['666'], { '333': 'MLB999' });
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'nenhuma_variacao_risco_no_matcher' });
  });

  it('group_attributes: só {id,name,value_id,value_name}, chaves extras caem', () => {
    const estado = estadoBase([grupo([{ id: 111, match: null }])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].group_attributes).toEqual([
      { id: 'COLOR', name: 'Cor', value_id: '52049', value_name: 'Preto' },
    ]);
  });

  it('múltiplos grupos preservam a ordem e a separação', () => {
    const estado = estadoBase([
      grupo([{ id: 111, match: null }]),
      grupo([{ id: 222, match: null }]),
    ]);
    const p = montarPlanoAnuncio(estado, ['111', '222'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches).toHaveLength(2);
    expect(p.confirmedProductMatches[0].matches[0].entity_id).toBe(111);
    expect(p.confirmedProductMatches[1].matches[0].entity_id).toBe(222);
  });

  it('productId: parent_catalog_product.id; fallback original_catalog_product_id do contexto', () => {
    const semParent = {
      stepData: { groups: [grupo([{ id: 111, match: null }])] },
      contextData: { flow: 'REPRODUCTIZE', original_catalog_product_id: 'MLB_FALLBACK' },
      step: 'X',
    };
    const p = montarPlanoAnuncio(semParent, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.productId).toBe('MLB_FALLBACK');
  });

  it.each([
    ['estado nulo', null, ['111'], 'estado_nao_encontrado'],
    ['sem groups', { stepData: {}, contextData: { flow: 'R' }, step: 'X' }, ['111'], 'sem_groups_no_estado'],
    ['groups vazio', estadoBase([]), ['111'], 'sem_groups_no_estado'],
  ])('%s → manual', (_nome, estado, risco, motivo) => {
    expect(montarPlanoAnuncio(estado as any, risco as string[], {})).toMatchObject({ tipo: 'manual', motivo });
  });

  it('sem productId → manual; sem flow → manual; variação sem id → manual', () => {
    const semPid = { stepData: { groups: [grupo([{ id: 111, match: null }])] }, contextData: { flow: 'R' }, step: 'X' };
    expect(montarPlanoAnuncio(semPid as any, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'sem_parent_product_id' });
    const semFlow = { stepData: { groups: [grupo([{ id: 111, match: null }])], parent_catalog_product: { id: 'P' } }, contextData: {}, step: 'X' };
    expect(montarPlanoAnuncio(semFlow as any, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'sem_flow' });
    const semId = estadoBase([grupo([{ match: null }])]);
    expect(montarPlanoAnuncio(semId, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'variacao_sem_id' });
  });
});

describe('montarUrlOptinUp', () => {
  it('normaliza a barra final do basePath', () => {
    expect(montarUrlOptinUp('/produzir/catalogo/', 'MLB1', 'multivariation_matcher_confirm'))
      .toBe('/produzir/catalogo/api/optin-up/MLB1/multivariation_matcher_confirm');
    expect(montarUrlOptinUp('/produzir/catalogo', 'MLB1', 'massive_summary_confirm'))
      .toBe('/produzir/catalogo/api/optin-up/MLB1/massive_summary_confirm');
  });
});

describe('interpretarRespostaMatcher — guard de eco antes do summary', () => {
  const planoOk = {
    tipo: 'ok' as const, productId: 'P', flow: 'REPRODUCTIZE',
    confirmedProductMatches: [], resumo: { null_enviados: ['111'], preservados: ['333'], excluidos_por_status: [], risco_ausente: [] },
  };
  const respostaOk = {
    step: 'MULTI_VARIATION_SUMMARY',
    step_data: {
      parent_catalog_product: { id: 'P' },
      product_associations: [
        { entity_id: 111, catalog_product_id: null },
        { entity_id: 333, catalog_product_id: 'MLB999' },
      ],
    },
  };

  it('prossegue quando o eco bate com o plano', () => {
    expect(interpretarRespostaMatcher(respostaOk, planoOk)).toEqual({
      acao: 'summary', parentProductId: 'P',
      productAssociations: respostaOk.step_data.product_associations,
    });
  });

  it('associação null fora do plano → manual (o servidor entendeu outra coisa)', () => {
    const resposta = { ...respostaOk, step_data: { ...respostaOk.step_data, product_associations: [
      { entity_id: 111, catalog_product_id: null },
      { entity_id: 333, catalog_product_id: null }, // preservada virou null!
    ] } };
    expect(interpretarRespostaMatcher(resposta, planoOk)).toMatchObject({ acao: 'manual', motivo: 'eco_divergente' });
  });

  it('add_invoice → manual; anatel_data → manual', () => {
    expect(interpretarRespostaMatcher({ step_data: { ...respostaOk.step_data, add_invoice: true } }, planoOk))
      .toMatchObject({ acao: 'manual', motivo: 'exige_invoice' });
    expect(interpretarRespostaMatcher({ step_data: { ...respostaOk.step_data, anatel_data: { value_name: 'X' } } }, planoOk))
      .toMatchObject({ acao: 'manual', motivo: 'exige_anatel' });
  });

  it('sem product_associations ou sem parent product → manual', () => {
    expect(interpretarRespostaMatcher({ step_data: {} }, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_product_associations' });
    expect(interpretarRespostaMatcher({ step_data: { product_associations: [] } }, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_parent_product' });
    expect(interpretarRespostaMatcher(null, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_product_associations' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test extensao-ml/__tests__/payload.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Implementar `extensao-ml/lib/payload.js`**

```js
// Contrato do matcher confirm do ML, extraído do bundle optin-user-products (2026-08-13).
// REPLICA getMappedGroups literalmente: variations.filter(e => !e.status), entity_id sem
// conversão de tipo, match?.product?.id || null. Ver spec 2026-08-12, seção "Contrato".
// Puro: sem chrome.*, sem DOM — testado por vitest, importado pelo painel via ESM.

export function extrairEstadoOptin(ctx) {
  // Busca estrutural pelo initialOptinData ({step, step_data, ...contexto}) no JSON SSR da
  // página — o invólucro exato do __NORDIC_RENDERING_CTX__ não é documentado, a forma interna é.
  const visto = new Set();
  const fila = [ctx];
  while (fila.length) {
    const atual = fila.shift();
    if (!atual || typeof atual !== 'object' || visto.has(atual)) continue;
    visto.add(atual);
    if ('step' in atual && 'step_data' in atual) {
      const { step, step_data: stepData, ...contextData } = atual;
      return { step, stepData, contextData };
    }
    for (const v of Object.values(atual)) fila.push(v);
  }
  return null;
}

export function montarPlanoAnuncio(estado, variacoesRisco, vinculos) {
  if (!estado) return { tipo: 'manual', motivo: 'estado_nao_encontrado' };
  const groups = estado.stepData?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return { tipo: 'manual', motivo: 'sem_groups_no_estado' };
  const productId = estado.stepData?.parent_catalog_product?.id
    ?? estado.contextData?.original_catalog_product_id ?? null;
  if (!productId) return { tipo: 'manual', motivo: 'sem_parent_product_id' };
  const flow = estado.contextData?.flow ?? estado.contextData?.flow_type ?? null;
  if (!flow) return { tipo: 'manual', motivo: 'sem_flow' };

  const risco = new Set(variacoesRisco.map(String));
  const confirmedProductMatches = [];
  const resumo = { null_enviados: [], preservados: [], excluidos_por_status: [], risco_ausente: [] };

  for (const g of groups) {
    const todas = Array.isArray(g?.variations) ? g.variations : [];
    const matches = [];
    for (const v of todas) {
      if (v?.status) { resumo.excluidos_por_status.push(String(v.id)); continue; } // filtro do ML
      if (v?.id == null) return { tipo: 'manual', motivo: 'variacao_sem_id' };
      const id = String(v.id);
      if (risco.has(id)) {
        matches.push({ entity_id: v.id, catalog_product_id: null }); // "Não encontro minha variação"
        resumo.null_enviados.push(id);
        continue;
      }
      const naPagina = v?.match?.product?.id ?? null;
      if (!naPagina) return { tipo: 'manual', motivo: `variacao_sem_decisao:${id}` };
      const confirmado = vinculos[id];
      if (!confirmado) return { tipo: 'manual', motivo: `match_nao_confirmado:${id}` };
      if (confirmado !== naPagina) return { tipo: 'manual', motivo: `vinculo_divergente:${id}` };
      matches.push({ entity_id: v.id, catalog_product_id: naPagina }); // preserva
      resumo.preservados.push(id);
    }
    confirmedProductMatches.push({
      group_attributes: (g?.match_product?.attributes ?? []).map(
        ({ id, name, value_id, value_name }) => ({ id, name, value_id, value_name }),
      ),
      matches,
    });
  }

  for (const id of risco) if (!resumo.null_enviados.includes(id)) resumo.risco_ausente.push(id);
  if (resumo.null_enviados.length === 0) return { tipo: 'manual', motivo: 'nenhuma_variacao_risco_no_matcher', resumo };
  return { tipo: 'ok', productId, flow, confirmedProductMatches, resumo };
}

export function montarUrlOptinUp(basePath, itemId, recurso) {
  return `${String(basePath).replace(/\/+$/, '')}/api/optin-up/${itemId}/${recurso}`;
}

export function interpretarRespostaMatcher(corpo, plano) {
  const sd = corpo?.step_data;
  if (!sd || !Array.isArray(sd.product_associations)) return { acao: 'manual', motivo: 'resposta_sem_product_associations' };
  if (sd.add_invoice) return { acao: 'manual', motivo: 'exige_invoice' };
  if (sd.anatel_data) return { acao: 'manual', motivo: 'exige_anatel' };
  const parentProductId = sd.parent_catalog_product?.id;
  if (!parentProductId) return { acao: 'manual', motivo: 'resposta_sem_parent_product' };
  // Guard de eco: o conjunto de entity_ids que o servidor computou como null tem que ser
  // exatamente o que o plano mandou como null. Divergiu → o servidor entendeu outra coisa; parar.
  const nullServidor = sd.product_associations
    .filter((a) => !a?.catalog_product_id).map((a) => String(a.entity_id)).sort();
  const nullPlano = [...(plano?.resumo?.null_enviados ?? [])].sort();
  if (JSON.stringify(nullServidor) !== JSON.stringify(nullPlano)) {
    return { acao: 'manual', motivo: 'eco_divergente' };
  }
  return { acao: 'summary', parentProductId, productAssociations: sd.product_associations };
}
```

Nota: no teste, `{ step_data: { product_associations: [] } }` cai em `resposta_sem_parent_product` (o array vazio passa pela primeira checagem e o fixture não tem `parent_catalog_product`) — o teste descreve exatamente isso.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test extensao-ml/__tests__/payload.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Lint e suíte inteira**

Run: `pnpm lint && pnpm test`
Expected: PASS. Se o eslint reclamar do dir novo, adicionar `extensao-ml/` ao escopo dele (ou um override de env browser/webextensions no config do eslint — seguir o formato do config existente).

- [ ] **Step 7: Commit**

```bash
git add extensao-ml/lib/payload.js extensao-ml/__tests__/payload.test.ts vitest.config.ts
git commit -m "feat(extensao-ml): funcoes puras do contrato do matcher confirm (payload, url, eco)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Esqueleto da extensão — manifest, ponte com o PubliAI, painel com dry-run

**Files:**
- Create: `extensao-ml/manifest.json`
- Create: `extensao-ml/sw.js`
- Create: `extensao-ml/content-publiai.js`
- Create: `extensao-ml/painel.html`
- Create: `extensao-ml/painel.js`

**Interfaces:**
- Consumes: `extrairEstadoOptin`, `montarPlanoAnuncio` (Task 2).
- Produces: protocolo com o app (Task 6 consome): o content script marca `document.documentElement.dataset.publiaiExtensao = <versão>`; o app envia `window.postMessage({ tipo: 'publiai:resolver-catalogo', lote }, location.origin)` onde `lote: Array<{ mlItemId, titulo, url, variacoesRisco, vinculos }>`.
- Produces: `chrome.storage.session` chave `lote` (o painel lê ao abrir).

- [ ] **Step 1: `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "PubliAI — Resolver catálogo no ML",
  "version": "0.1.0",
  "description": "Aplica 'Não encontro minha variação' em massa, na sessão logada do operador. Dry-run por padrão.",
  "permissions": ["storage", "scripting"],
  "host_permissions": [
    "*://*.mercadolivre.com.br/*",
    "https://ean2marketplace-frontend.onrender.com/*",
    "http://localhost/*"
  ],
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["https://ean2marketplace-frontend.onrender.com/*", "http://localhost/*"],
      "js": ["content-publiai.js"],
      "run_at": "document_idle"
    }
  ]
}
```

(`http://localhost/*` cobre o dev server do Vite em qualquer porta — match pattern de host ignora porta.)

- [ ] **Step 2: `content-publiai.js`**

```js
// Ponte PubliAI -> extensão. Sem CORS e sem credencial: o app fala por postMessage na própria
// página; a extensão nunca chama a API do PubliAI.
document.documentElement.dataset.publiaiExtensao = chrome.runtime.getManifest().version;

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const msg = ev.data;
  if (msg?.tipo !== 'publiai:resolver-catalogo' || !Array.isArray(msg.lote) || msg.lote.length === 0) return;
  chrome.runtime.sendMessage({ tipo: 'abrir-painel', lote: msg.lote });
});
```

- [ ] **Step 3: `sw.js`**

```js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tipo !== 'abrir-painel') return;
  chrome.storage.session.set({ lote: msg.lote }).then(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('painel.html') });
  });
});
```

- [ ] **Step 4: `painel.html` + `painel.js` (fase dry-run)**

`painel.html`: página simples (sem framework): título, aviso "DRY-RUN — nada foi enviado", tabela de anúncios (título, contagens do resumo, estado), `<details>` por anúncio com o JSON do payload, botões "Rodar dry-run" e (desabilitado nesta task) "Enviar". Estilo mínimo inline.

`painel.js` (o orquestrador; envio real fica para a Task 4):

```js
import { extrairEstadoOptin, montarPlanoAnuncio, montarUrlOptinUp, interpretarRespostaMatcher } from './lib/payload.js';

const ESPERA_ENTRE_ANUNCIOS_MS = 3000; // não martelar o ML

async function lerCtxDaAba(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const ctx = window.__NORDIC_RENDERING_CTX__ ?? null;
      try { return JSON.parse(JSON.stringify(ctx)); } catch { return null; }
    },
  });
  return result;
}

async function abrirEAguardar(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await new Promise((resolve) => {
    const ouvinte = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(ouvinte);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(ouvinte);
  });
  return tab;
}

export async function dryRunAnuncio(anuncio) {
  const tab = await abrirEAguardar(anuncio.url); // a MESMA url do card (produzir/catalogo/<item>)
  try {
    const ctx = await lerCtxDaAba(tab.id);
    const estado = extrairEstadoOptin(ctx);
    const plano = montarPlanoAnuncio(estado, anuncio.variacoesRisco, anuncio.vinculos);
    const basePath = estadoBasePath(estado, anuncio.url);
    return { anuncio, plano, basePath, step: estado?.step ?? null, tabId: tab.id };
  } catch (erro) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    return { anuncio, plano: { tipo: 'manual', motivo: `erro_leitura:${String(erro)}` }, tabId: null };
  }
}

function estadoBasePath(estado, urlAnuncio) {
  // basePath vem do contexto SSR quando existe; senão deriva do caminho conhecido da página.
  return estado?.contextData?.basePath ?? new URL(urlAnuncio).pathname.replace(/\/MLB\d+.*/, '');
}

async function main() {
  const { lote } = await chrome.storage.session.get('lote');
  if (!Array.isArray(lote) || lote.length === 0) { renderVazio(); return; }
  renderLote(lote); // tabela inicial, tudo "pendente"
  document.querySelector('#rodar-dry-run').addEventListener('click', async () => {
    for (const anuncio of lote) {
      const resultado = await dryRunAnuncio(anuncio);
      renderResultado(resultado); // payload em <details>, contagens, motivo se manual
      if (resultado.tabId) await chrome.tabs.remove(resultado.tabId).catch(() => {});
      guardarResultado(resultado); // em memória, para a Task 4 usar no envio
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_ANUNCIOS_MS));
    }
    renderRodape(); // total ok / manual, aviso de que NADA foi enviado
  });
}

main();
```

As funções `renderVazio/renderLote/renderResultado/renderRodape/guardarResultado` são DOM puro no próprio `painel.js` (sem framework; ~60 linhas). O relatório por anúncio mostra: `tipo`, `motivo` (se manual), `null_enviados` (contagem e ids), `preservados`, `excluidos_por_status`, `risco_ausente`, `step` lido, e o JSON completo do payload dentro de `<details>`. Um botão "Copiar relatório JSON" serializa tudo (vira fixture de teste e evidência).

Nota: manter a aba do anúncio aberta até depois do envio (Task 4) exigiria gestão de estado maior; nesta task a aba fecha após a leitura — a Task 4 reabre na hora do envio e RELÊ o estado antes de enviar (estado fresco > estado cacheado).

- [ ] **Step 5: Verificação manual sem tocar o ML**

1. `chrome://extensions` → "Carregar sem compactação" → `extensao-ml/`. Expected: carrega sem erro de manifest.
2. Criar `extensao-ml/dev-teste.html` local **temporário** (não commitar) com um botão que faz `window.postMessage({tipo:'publiai:resolver-catalogo', lote:[{mlItemId:'MLB0000000000', titulo:'Teste', url:'https://www.mercadolivre.com.br/produzir/catalogo/MLB0000000000', variacoesRisco:['1'], vinculos:{}}]}, location.origin)` — servir via `python3 -m http.server` em localhost e conferir: painel abre, lote aparece.
   (O dry-run contra esse item inexistente pode rodar: é leitura de uma página de erro do ML; o resultado esperado é `manual`/`estado_nao_encontrado` — nenhuma escrita.)
3. Conferir no console do painel que não há erros.

- [ ] **Step 6: Commit**

```bash
git add extensao-ml/manifest.json extensao-ml/sw.js extensao-ml/content-publiai.js extensao-ml/painel.html extensao-ml/painel.js
git commit -m "feat(extensao-ml): esqueleto MV3 com ponte PubliAI e painel de dry-run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Envio real no painel — confirmação explícita, duas chamadas, relatório

**Files:**
- Modify: `extensao-ml/painel.js`
- Modify: `extensao-ml/painel.html` (botões de envio)

**Interfaces:**
- Consumes: `montarUrlOptinUp`, `interpretarRespostaMatcher` (Task 2); resultados de dry-run da Task 3.
- Produces: fluxo de envio com resultado por anúncio `{ ok: boolean, etapa: 'matcher'|'summary', status, corpo }`.

- [ ] **Step 1: Função injetada de envio (roda DENTRO da página do ML)**

Em `painel.js`:

```js
// Injetada via executeScript — roda na página do ML, onde o navegador anexa cookies e o CSRF
// está na meta tag. NUNCA chamada sem confirmação explícita do operador.
function enviarNaPagina(url, metodo, body) {
  const token = document.querySelector('meta[name=csrf-token]')?.content ?? '';
  return fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));
}

async function executarEnvio(tabId, url, metodo, body) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: enviarNaPagina, args: [url, metodo, body],
  });
  return result;
}
```

- [ ] **Step 2: Sequência de envio por anúncio**

```js
async function enviarAnuncio(anuncio) {
  // Reabre e RELÊ: o estado do dry-run pode ter envelhecido.
  const { plano, basePath, tabId } = await dryRunAnuncio(anuncio);
  try {
    if (plano.tipo !== 'ok') return { ok: false, etapa: 'releitura', motivo: plano.motivo };

    // Chamada 1: multivariation_matcher_confirm (PATCH)
    const urlMatcher = montarUrlOptinUp(basePath, anuncio.mlItemId, 'multivariation_matcher_confirm');
    const r1 = await executarEnvio(tabId, urlMatcher, 'PATCH', {
      productId: plano.productId,
      confirmedProductMatches: plano.confirmedProductMatches,
      flow: plano.flow,
    });
    if (r1.status === 403) return { ok: false, etapa: 'matcher', status: 403, motivo: 'sessao_ml_caida_ou_csrf', corpo: r1.corpo };
    if (r1.status < 200 || r1.status >= 300) return { ok: false, etapa: 'matcher', status: r1.status, corpo: r1.corpo };

    // Guard de eco + gates (invoice/anatel)
    const seguinte = interpretarRespostaMatcher(r1.corpo, plano);
    if (seguinte.acao !== 'summary') {
      return { ok: false, etapa: 'pos-matcher', motivo: seguinte.motivo, corpo: r1.corpo,
        aviso: 'Wizard iniciado no servidor; terminar este anúncio MANUALMENTE na página do ML.' };
    }

    // Chamada 2: massive_summary_confirm (POST) — payload ECOADO da resposta 1
    const urlSummary = montarUrlOptinUp(basePath, anuncio.mlItemId, 'massive_summary_confirm');
    const r2 = await executarEnvio(tabId, urlSummary, 'POST', {
      parentProductId: seguinte.parentProductId,
      productAssociations: seguinte.productAssociations,
      flow: plano.flow,
      invoice: null,
    });
    if (r2.status < 200 || r2.status >= 300) {
      return { ok: false, etapa: 'summary', status: r2.status, corpo: r2.corpo,
        aviso: 'Matcher confirmado mas summary falhou; terminar este anúncio MANUALMENTE na página do ML.' };
    }
    return { ok: true, etapa: 'summary', status: r2.status, corpo: r2.corpo };
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
  }
}
```

- [ ] **Step 3: Gate de confirmação no painel**

- O botão "Enviar" só habilita depois de um dry-run concluído na mesma sessão do painel.
- Dois modos: "Enviar este" (por anúncio, ao lado do resultado do dry-run) e "Enviar todos os OK" (lote).
- Ambos abrem um `confirm()` nativo com o resumo: `N anúncios, X variações vão receber "não encontro", Y vínculos preservados. Enviar?` — só prossegue no OK.
- Erro `sessao_ml_caida_ou_csrf` interrompe o lote inteiro e instrui: "Faça login no mercadolivre.com.br e rode o dry-run de novo."
- Relatório final por anúncio (ok/erro/manual + corpo da resposta em `<details>`), com "Copiar relatório JSON".
- Ao fim do lote, o painel mostra a instrução fixa: "No PubliAI, re-enfileire vincular-catalogo para as famílias deste lote (scripts/backfill-catalogo-pendente.ts) — a tela Catálogo em risco só reflete o novo estado depois disso."

- [ ] **Step 4: Verificação (sem tocar anúncio real)**

1. Recarregar a extensão; repetir o fluxo da Task 3 Step 5 com o item inexistente `MLB0000000000`. Expected: dry-run devolve `manual`, botão "Enviar este" NÃO habilita para anúncio manual, "Enviar todos os OK" mostra `0 anúncios` e não faz nada.
2. `pnpm test` (as puras seguem passando) e `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add extensao-ml/painel.js extensao-ml/painel.html
git commit -m "feat(extensao-ml): envio em duas chamadas com confirmacao explicita e guard de eco

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Detecção da extensão no app (`useExtensaoCatalogo`)

**Files:**
- Create: `src/hooks/useExtensaoCatalogo.ts`
- Test: `src/hooks/__tests__/useExtensaoCatalogo.test.ts`

**Interfaces:**
- Consumes: marcador `document.documentElement.dataset.publiaiExtensao` (Task 3).
- Produces: `useExtensaoCatalogo(): boolean` — Task 6 consome.

- [ ] **Step 1: Teste que falha**

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useExtensaoCatalogo } from '@/hooks/useExtensaoCatalogo';

afterEach(() => {
  delete document.documentElement.dataset.publiaiExtensao;
  vi.useRealTimers();
});

describe('useExtensaoCatalogo', () => {
  it('false quando a extensão não está instalada', () => {
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(false);
  });

  it('true quando o marcador já existe no mount', () => {
    document.documentElement.dataset.publiaiExtensao = '0.1.0';
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(true);
  });

  it('true quando o marcador aparece depois (content script em document_idle)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(false);
    document.documentElement.dataset.publiaiExtensao = '0.1.0';
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/hooks/__tests__/useExtensaoCatalogo.test.ts`
Expected: FAIL (hook inexistente).

- [ ] **Step 3: Implementar**

```ts
import { useEffect, useState } from 'react';

/**
 * Detecta a extensão "PubliAI — Resolver catálogo no ML" pelo marcador que o content script
 * dela grava em <html data-publiai-extensao>. O content script roda em document_idle, depois
 * do mount do React — daí a rechecagem única com timer.
 */
export function useExtensaoCatalogo(): boolean {
  const [presente, setPresente] = useState(
    () => document.documentElement.dataset.publiaiExtensao != null,
  );
  useEffect(() => {
    if (presente) return;
    const t = window.setTimeout(
      () => setPresente(document.documentElement.dataset.publiaiExtensao != null),
      1500,
    );
    return () => window.clearTimeout(t);
  }, [presente]);
  return presente;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/hooks/__tests__/useExtensaoCatalogo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useExtensaoCatalogo.ts src/hooks/__tests__/useExtensaoCatalogo.test.ts
git commit -m "feat(catalogo): hook de deteccao da extensao de navegador

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Botão "Resolver todos no ML" no card — com degradação sem extensão

**Files:**
- Modify: `src/components/catalogo-em-risco.tsx`
- Test: `src/components/__tests__/catalogo-em-risco.test.tsx`

**Interfaces:**
- Consumes: `AnuncioEmRisco` estendido (Task 1), `useExtensaoCatalogo` (Task 5), protocolo postMessage (Task 3).

- [ ] **Step 1: Testes que falham**

Adicionar em `src/components/__tests__/catalogo-em-risco.test.tsx` (seguir o setup existente do arquivo; mockar o hook):

```tsx
import { vi } from 'vitest';

vi.mock('@/hooks/useExtensaoCatalogo', () => ({ useExtensaoCatalogo: vi.fn() }));
import { useExtensaoCatalogo } from '@/hooks/useExtensaoCatalogo';

const anuncio = (over: Partial<AnuncioEmRisco>): AnuncioEmRisco => ({
  mlItemId: 'MLB1', titulo: 'Linha Xik', qtdSemFicha: 2, motivoPredominante: 'sem_produto',
  url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB1',
  variacoesRisco: ['111'], vinculos: {}, itemPlano: false, ...over,
});

describe('CatalogoEmRisco — botão da extensão (Fase 3)', () => {
  it('sem extensão: sem botão (degrada para o card da Fase 1)', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(false);
    render(<CatalogoEmRisco itens={[anuncio({})]} />);
    expect(screen.queryByRole('button', { name: /resolver todos no ml/i })).toBeNull();
  });

  it('com extensão: botão presente e postMessage com o lote (sem item plano)', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(true);
    const post = vi.spyOn(window, 'postMessage');
    render(<CatalogoEmRisco itens={[anuncio({}), anuncio({ mlItemId: 'MLB2', itemPlano: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: /resolver todos no ml/i }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'publiai:resolver-catalogo',
        lote: [expect.objectContaining({ mlItemId: 'MLB1' })], // item plano ficou de fora
      }),
      window.location.origin,
    );
    post.mockRestore();
  });

  it('com extensão mas só item plano: botão não aparece', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(true);
    render(<CatalogoEmRisco itens={[anuncio({ itemPlano: true })]} />);
    expect(screen.queryByRole('button', { name: /resolver todos no ml/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/components/__tests__/catalogo-em-risco.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar no card**

Em `catalogo-em-risco.tsx`: dentro do `<summary>` (depois do texto), quando `useExtensaoCatalogo()` e `itens.some((i) => !i.itemPlano)`:

```tsx
const elegiveis = itens.filter((i) => !i.itemPlano);
// ...
<button
  type="button"
  onClick={(e) => {
    e.preventDefault(); // não alternar o <details>
    window.postMessage(
      {
        tipo: 'publiai:resolver-catalogo',
        lote: elegiveis.map(({ mlItemId, titulo, url, variacoesRisco, vinculos }) => ({
          mlItemId, titulo, url, variacoesRisco, vinculos,
        })),
      },
      window.location.origin,
    );
  }}
  className="ml-auto rounded border border-warning/40 px-2 py-1 text-xs font-medium hover:bg-warning/20"
>
  Resolver todos no ML ({elegiveis.length})
</button>
```

(o link "Resolver no ML" por anúncio permanece intocado — é a degradação sem extensão; itens `itemPlano` continuam com o link individual).

- [ ] **Step 4: Rodar e ver passar + lint**

Run: `pnpm test src/components/__tests__/catalogo-em-risco.test.tsx && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/catalogo-em-risco.tsx src/components/__tests__/catalogo-em-risco.test.tsx
git commit -m "feat(catalogo): botao Resolver todos no ML no card, condicionado a extensao instalada

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Validação end-to-end guiada (COM Diego; envio real só aqui)

Não é tarefa de subagente: escrita em marketplace fica no loop principal (regra de roteamento de modelos do CLAUDE.md). Cada passo tem gate humano.

**Files:** nenhum código novo previsto; ajustes que surgirem voltam como correções com teste.

- [ ] **Step 1: Dry-run em 3 anúncios reais (nenhum envio)**

No Chrome do Diego, extensão carregada, logado no ML:
1. Um anúncio 100% risco (sem vínculos): esperado `tipo: 'ok'`, todos null.
2. Um dos 21 anúncios com vínculos a preservar: esperado `ok` com `preservados` OU `manual` com motivo claro (`match_nao_confirmado`/`vinculo_divergente`) — qualquer `manual` aqui é informação, não bug.
3. Um anúncio `family_diff` misturado: esperado `manual` (decisão pendente do Diego — ver seção "Decisões").

Conferência 1:1: abrir a página do ML do anúncio 1 e comparar linha a linha com o payload exibido (variações visíveis ⊆ payload; nenhuma variação visível fora do payload sem motivo). "Copiar relatório JSON" e guardar os três relatórios — **as amostras de estado viram fixtures adicionais** no `payload.test.ts` (anonimizadas), cobrindo a forma real de `match`/`status` que o bundle não revela.

Gate: se a leitura do `__NORDIC_RENDERING_CTX__` falhar ou a forma dos `groups` divergir das fixtures, PARAR, ajustar `extrairEstadoOptin`/fixtures com TDD, e repetir.

- [ ] **Step 2: Primeiro envio real — UM anúncio escolhido a dedo**

Critérios de escolha (SQL de apoio abaixo; escolha final é do Diego):
- multivariação, poucas variações (≤ 6), TODAS em risco (zero vínculos a preservar — elimina o pior risco no primeiro tiro);
- sem venda recente, valor baixo;
- dry-run do Step 1 limpo para ele.

```sql
select f.ml_item_id, f.titulo_ml, count(*) as variacoes_risco
from familias f join variacoes v on v.familia_id = f.id
where f.ml_item_id is not null and v.ml_variation_id is not null
  and v.catalog_status in ('ficha_divergente','sem_produto','nao_elegivel','pendente')
  and v.ml_variation_id <> f.ml_item_id
  and not exists (select 1 from familias f2 join variacoes v2 on v2.familia_id = f2.id
                  where f2.ml_item_id = f.ml_item_id and v2.ml_variation_id is not null
                    and v2.catalog_status in ('vinculado','family_diff'))
group by 1, 2 having count(*) <= 6 order by 3;
```

Executar "Enviar este" no painel. **Como conferir o resultado:**
1. O relatório do painel: `ok: true` na etapa `summary` (status 2xx).
2. Reabrir a página `produzir/catalogo/<item>`: as variações devem aparecer como resolvidas ("Não encontro" aplicado) — não mais pedindo decisão.
3. No painel do vendedor do ML: o anúncio sai do filtro "Próximos a serem pausados" (pode demorar; a fonte primária é o item 2).
4. Re-enfileirar `vincular-catalogo` só desta família (arquivo com 1 uuid → `scripts/backfill-catalogo-pendente.ts --executar`) e conferir o `catalog_status` resultante no banco.

**Como reverter se der errado:** a declaração "não encontro" é reversível pela própria página do matcher (o fluxo REPRODUCTIZE permite refazer a busca da variação e vincular de novo); e para vínculo desfeito indevidamente, a rede de segurança real é o próprio PubliAI: `vincular-catalogo` refaz o opt-in por GTIN com a trava `fichaEquivalente` (fluxo sancionado do ADR-0021). Se o resultado for inesperado de forma não-reversível por essas duas vias, PARAR o lote e tratar como incidente (nenhum outro envio).

Gate extra: se o PATCH devolver 403 **com** csrf presente, não insistir — capturar UMA confirmação manual do operador no DevTools (anúncio que ele resolveria manualmente de qualquer forma), comparar headers com os nossos, ajustar e repetir o Step 2.

- [ ] **Step 3: Segundo envio real — anúncio COM vínculos a preservar**

Escolher um dos 21 com dry-run `ok` e `preservados` não-vazio. Enviar. Conferir, além do Step 2: **os vínculos preservados continuam de pé** — `variacoes.catalog_listing_id` inalterado no banco e, no ML, `GET /items/{id}?attributes=item_relations` (leitura via fluxo normal do worker re-enfileirado) ainda mostra as relações. Este é o teste de aceitação do maior risco da feature.

- [ ] **Step 4: Lote completo**

"Enviar todos os OK" com o restante. Throttle de 3s já embutido. Ao final:
1. Gerar `familias.txt` das famílias afetadas:

```sql
select distinct f.id from familias f join variacoes v on v.familia_id = f.id
where f.ml_item_id in (/* ml_item_ids do lote enviado */)
  and v.ml_variation_id is not null;
```

2. Rodar `scripts/backfill-catalogo-pendente.ts familias.txt --executar` (env de produção; silencioso por padrão — `alertar: false`).
3. Depois das rodadas: card "Catálogo em risco" deve encolher; sobras são os `manual` do relatório (trabalho manual conhecido, não silêncio).

- [ ] **Step 5: Commit de fixtures/ajustes colhidos na validação**

```bash
git add extensao-ml/__tests__/
git commit -m "test(extensao-ml): fixtures de estado real colhidas na validacao dirigida

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, ADR e correção da spec

**Files:**
- Create: `docs/decisions/0118-extensao-navegador-no-match-catalogo.md`
- Modify: `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md` (seção "Contrato")
- Modify: `docs/explanation/arquitetura.md`
- Modify: `docs/how-to/operacoes-rotineiras.md`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md`, `obsidian-vault/06-Roadmap/Sprint Atual.md`

- [ ] **Step 1: ADR-0118**

Decisão não-trivial nova (canal de execução via extensão de navegador na sessão do operador) → ADR cabe, sim. Conteúdo mínimo: contexto (403 EBADCSRFTOKEN reverificado; cookie no Vault descartado — referenciar a spec), decisão (extensão MV3 sem build, dry-run obrigatório, duas chamadas por anúncio com eco, política estrita de preservação via `vinculos` do banco, item plano fora), consequências (dependência de endpoint interno — se o ML mudar, a extensão quebra e o fluxo manual continua; a Parte 1 não depende dela), e o registro das regras de segurança (nunca aceitar sugestão do ML; `manual` em qualquer ambiguidade).

- [ ] **Step 2: Corrigir a spec**

Na seção "Contrato do matcher confirm — RESOLVIDO", corrigir: **são duas chamadas por anúncio** (`multivariation_matcher_confirm` → resposta com `MULTI_VARIATION_SUMMARY` → `massive_summary_confirm` com o payload ecoado); `massive_summary_confirm` sai de "não usados nesta fase". Registrar também os gates `add_invoice`/`anatel_data` e a fonte do CSRF (`meta[name=csrf-token]` → header `x-csrf-token`), com data 2026-08-13 e origem (bundle `useConfirmFooterButton`/`useOptinUpAction`).

- [ ] **Step 3: Tabela do CLAUDE.md — o que atualizar**

| Mudou | Doc |
|---|---|
| arquitetura/fluxos (componente novo: extensão) | `docs/explanation/arquitetura.md` |
| procedimento do operador (instalar unpacked, rodar lote, re-enfileirar) | `docs/how-to/operacoes-rotineiras.md` |
| nova decisão arquitetural | `docs/decisions/0118` + `obsidian-vault/04-Decisões/Índice de ADRs.md` |
| trabalho relevante concluído | `docs/TASKS.md` |
| épico/estado | `obsidian-vault/06-Roadmap/Sprint Atual.md` |

Não muda: `docs/reference/edge-functions.md` (nenhuma função nova/alterada), `docs/reference/modelo-de-dados.md` (zero migration).

- [ ] **Step 4: Graphify**

Atualizar o grafo canônico (`graphify-out/` na raiz) com `extensao-ml/` e os docs novos; terminar com `python3 scripts/graphify-podar-falsos.py --aplicar` + reclusterização (regra do CLAUDE.md).

- [ ] **Step 5: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(catalogo): ADR-0118 da extensao, spec corrigida para duas chamadas e docs operacionais

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Plano de validação end-to-end (resumo executável)

1. **Dry-run primeiro, sempre** (Task 7 Step 1): 3 anúncios reais, zero envio, conferência 1:1 com a tela do ML, relatórios viram fixtures.
2. **Primeiro envio real em UM anúncio** escolhido a dedo (Task 7 Step 2): pequeno, todo em risco, sem vínculos; conferência pela própria página do matcher + re-enfileiramento de `vincular-catalogo` (a verdade continua sendo o ML); reversão pela página do matcher e, para vínculos, pelo opt-in do worker (ADR-0021).
3. **Envio com preservação** (Task 7 Step 3): um dos 21; aceitação = vínculos intactos (`catalog_listing_id`/`item_relations`).
4. **Lote** (Task 7 Step 4) + backfill silencioso + card encolhendo.

## Self-review (feito)

- Spec coberta: entrada de dados (SSR, Task 2/3), payload com preservação (Task 2), dry-run default (Tasks 3–4), duas chamadas + eco (Task 4, corrige a spec na Task 8), sem escrita no banco (nenhuma task escreve), erros de sessão/parciais (Task 4), botão e degradação (Tasks 5–6), item plano fora (Tasks 1/6), re-enfileiramento pós-lote (Task 7).
- Tipos consistentes: `AnuncioEmRisco.{variacoesRisco,vinculos,itemPlano}` (Task 1) = o que o botão manda (Task 6) = o que o painel consome (Task 3) = assinatura `montarPlanoAnuncio(estado, variacoesRisco, vinculos)` (Task 2).
- Sem placeholders: todo step tem código ou comando concreto; os únicos passos "a decidir" estão nomeados na seção "Decisões que precisam do Diego".
