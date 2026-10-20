# Plano — aba Campanhas do /ads (emenda ADR-0179 de 2026-10-20)

**Fonte:** emenda "aba Campanhas" no `docs/decisions/0179-painel-de-ads.md`, spike 057
(`docs/spikes/057-ads-campanhas-agora.md`), glossário (Campanha de Ads, Anúncio patrocinado, ACOS de equilíbrio
pelo preço, ROAS objetivo acima da margem).
**Branch:** `worktree-ads-campanhas-design`. **Sem migration.** Só GET no ML.

## Objetivo

O `/ads` ganha abas **Desempenho** (painel atual, intocado) e **Campanhas** (estado atual). Campanhas lista as
campanhas ativas e pausadas da org; em cada uma, as **famílias** patrocinadas (expansíveis até os MLBs) com ACOS de
equilíbrio pelo preço e três alertas. Nunca mostra gasto, ROAS/ACOS realizado nem resultado.

## Contrato da edge `ads-campanhas`

`POST` (JWT do usuário, `verify_jwt = true`), body `{ fresco?: boolean }`. `requireUserOrg(req, {access:'read'})`;
depois `if (!(await exigirModulo(admin, orgId, 'ads'))) return 403` (devolve boolean, fecha em erro) **antes** do cache
e de qualquer chamada ML. O `orgId` resolvido alimenta todas as deps. Resposta 200:

```ts
type RespostaCampanhas =
  | { ok: true; estado: 'sem_conexao' | 'sem_advertiser' | 'sem_acesso' | 'sem_permissao' }
  | { ok: true; estado: 'ok'; lidoEm: string /* ISO */; aliquotasConfirmadas: boolean;
      projecaoLimitada: boolean; publicadosPorFamilia: Record<string, string[]> | null /* codigoPai → MLBs; null = erro de leitura */;
      campanhas: CampanhaAds[]; anuncios: AnuncioPatrocinado[] };
interface CampanhaAds { id: number; nome: string; status: 'active' | 'paused'; estrategia: string | null;
  roasObjetivo: number | null; acosObjetivo: number | null /* % */; orcamentoDiario: number | null }
interface AnuncioPatrocinado { mlb: string; campanhaId: number; grupoId: number | null; statusAds: string;
  catalogo: boolean; titulo: string | null; thumbnail: string | null; permalink: string | null;
  item: { status: string; subStatus: string[]; estoque: number | null; preco: number | null } | null;
  equilibrio: { acosPct: number | null; motivo: string | null } }
```

Erro inesperado → 500 `{ ok:false, erro }`; 401/403 de `requireUserOrg`/módulo passam como vêm.

### Fluxo (só GET)

1. `resolverConexao(admin, orgId, 'mercado_livre')`; sem conexão → `sem_conexao`. Token via
   `getValidAccessTokenConexao`.
2. **Cache:** Redis `ads:camp:v1:{orgId}`, TTL 600 s; `fresco: true` ignora a leitura (grava de novo). Só o estado
   `ok` é cacheado.
3. Advertiser: `urlAdvertiser()` + `HEADERS_ADVERTISER` + `parseAdvertiser`; `null` → `sem_advertiser`.
   `classificarResposta` → `sem_acesso`/`sem_permissao` em 401/403.
4. Campanhas: `GET {BASE}/advertisers/{adv}/product_ads/campaigns/search?limit=50&offset=0&date_from=D-7&date_to=D`
   `&filters[status]=active,paused` (`HEADERS_ADS`), paginado até `paging.total`. `D` = hoje BRT.
5. Anúncios por campanha: `GET {BASE}/advertisers/{adv}/product_ads/ads/search?limit=50&offset=N&date_from=…&date_to=…`
   `&filters[campaign_id]={id}`, paginado. **Teto:** 40 páginas no total (2.000 anúncios); estourou → erro explícito
   (nunca lista truncada em silêncio).
6. Itens: `/items/bulk` via `caminhoMultiget(ids, 'id,status,sub_status,available_quantity,price')` em blocos de 20
   + `comoEnvelopeAntigo`. Entrada ≠ 200 (404, 500, corpo inválido) ou bloco inteiro com erro → `item: null`
   (**desconhecido**, nunca "parado").
7. Equilíbrio — **só para MLBs de campanhas `active`**, com tetos fixos por leitura (constantes exportadas):
   **cadastro ≤ 20.000 variações** (contagem `head:true` antes de `carregarCadastro`; acima → nenhuma projeção),
   **≤ 100 MLBs**, **≤ 150 cores** e **≤ 300 consultas de tarifa** (contador no wrapper de `tarifaEm`; estourou →
   erro `LimiteTarifa`). Ordem: campanha, MLB. Um MLB só é projetado se **todas** as suas cores cabem no orçamento
   restante; senão ele inteiro (e os seguintes) → `{acosPct:null, motivo:'fora_da_projecao'}` — nunca mínimo sobre
   cores truncadas; `LimiteTarifa` no meio de um MLB também o marca inteiro `fora_da_projecao`. MLBs de campanhas
   pausadas → `fora_da_projecao`. `projecaoLimitada=true` se algum MLB de campanha ativa ficou de fora. Peças reaproveitadas da Central (ADR-0170): `carregarCadastro`, `lerAliquotas`,
   `criarTarifaEm(cx, { fresco })` (o Atualizar força tarifa nova), `buscarItensML(get, ids)` (categoria, listing
   type, variações, unidades/kit), `resolverPack`, `liquidoNoPreco`. **Não** usa `projetarItem`/`projetarCor`: elas
   exigem piso (`sincronizar.ts:85`) e o piso não entra no equilíbrio. Função própria `equilibrioDoMlb` em
   `_shared/ads/campanhas.ts`, mesmo enumerador de cores do `projetarItem` (`sincronizar.ts:124-127`):
   - Por cor, motivo na ordem: `resolverPack` → `kit_*`/`sem_cadastro`; `custo == null || custo <= 0` → `sem_custo`;
     `origem == null` → `sem_origem`; `dim == null` → `sem_dimensao` (frete viria do pacote padrão 16×11×6/300 g,
     `ml/frete.ts:28` — recusado); `preco` do item nulo/≤ 0 → `sem_preco`; sem categoria/listing type →
     `sem_categoria`; tarifa lança (inclui `TarifaEstimada`) → `erro_tarifa`; item ausente do multiget → `erro_item`.
   - Sem motivo: `acos = (liquidoNoPreco(preco, tarifa, aliquota) − custo) ÷ preco`, alíquota por origem.
   - Por MLB: qualquer cor com motivo → `{acosPct:null, motivo: <1º motivo>}` (pior variação desconhecida = sem
     referência; nunca valor parcial). Senão `acosPct = min(acos) × 100`.
   - `lerAliquotas` → `null` ⇒ todos `motivo:'sem_aliquota'`, `aliquotasConfirmadas:false`.
   - Concorrência `emParalelo(…, 4)`. CPU/tempo medidos no deploy com cache frio na Avil (log da edge); orçamento
     < 2 s de CPU.
8. Publicados por família (para o alerta de parcial), com o admin client e `org_id`: `anuncios_externos`
   (`canal='mercado_livre'`, `status='publicado'`, `item_externo_id` não nulo) ∪ `anuncios_externos_itens`
   (`retirado=false` **e `item_externo_id` não nulo** — filho UP pendente ainda sem MLB não conta; `codigo_pai` vem
   do pai via `anuncio_externo_id`), ambas paginadas (`.range`, 1000) com **ordem estável por `id`**, deduplicado
   por MLB (padrão de `src/lib/queries.ts:243`). Teste com filho pendente e com > 1.000 linhas.
   Lê a org inteira em colunas mínimas, porque o mapeamento MLB → família é feito no front. Erro de leitura → `publicadosPorFamilia: null` (front não alerta).

### Código

- **`supabase/functions/_shared/ads/campanhas.ts`** (puro, sem Deno): `urlCampanhas(adv, desde, ate, offset)`,
  `urlAnunciosCampanha(adv, cid, desde, ate, offset)`, `parseCampanhas(corpo)`, `parseAnunciosPatrocinados(corpo)`
  (no estilo dos parsers atuais: nunca lança, `null` em corpo inválido; MLB validado por `MLB_RE`),
  `parseItensBulk`, `equilibrioDoMlb(...)`, e o orquestrador `lerCampanhasAds(deps)` com IO injetado
  (`get`, `projetar`, `hoje`) — testável no vitest.
- **`supabase/functions/ads-campanhas/index.ts`**: auth, módulo, conexão, cache, fiação real das deps.
- `supabase/config.toml`: bloco na seção `verify_jwt = true`.

## Front

- **`src/lib/ads-campanhas.ts`** (puro): `montarCampanhas({ resposta, codigosPorMlb, familiaDoCodigo,
  nomeDaFamilia, mlbsPublicadosPorFamilia })` →
  ```ts
  interface CampanhaVista extends CampanhaAds { familias: FamiliaCampanha[]; foraDoPubliai: AnuncioPatrocinado[];
    totalAlertas: number }
  interface FamiliaCampanha { codigoPai: string; nome: string | null; anuncios: AnuncioPatrocinado[];
    equilibrioPct: number | null; motivoEquilibrio: string | null; patrocinados: number; publicados: number;
    alertas: AlertaCampanha[] }
  type AlertaCampanha = 'roas_acima_margem' | 'patrocinado_parado' | 'parcialmente_patrocinada';
  ```
  - MLB → família: **mesmo critério do Desempenho** (`buscarCodigosMlbs` + catálogo: código → `codigoPai`,
    `ads-painel.ts:74`): **todos** os códigos do MLB resolvidos e para uma única família; sem código, código sem
    família ou 2+ famílias → `foraDoPubliai`.
  - Família: `equilibrioPct` = mínimo dos MLBs; qualquer MLB sem referência → família sem referência (motivo dele).
  - `roas_acima_margem`: campanha `active`, `acosObjetivo != null`, `equilibrioPct != null` e
    `acosObjetivo > equilibrioPct`.
  - `patrocinado_parado`: campanha `active` e algum MLB com `item != null` e (`item.status !== 'active'` ou
    `item.estoque === 0`). `item == null` = desconhecido, sem alerta, mostra "status indisponível". O `hold` do Ads
    sozinho nunca alerta (spike 057).
  - `parcialmente_patrocinada`: família em campanha `active` com algum MLB de `publicadosPorFamilia[codigoPai]` que
    **não está em nenhuma campanha ativa** da org (família dividida entre campanhas A e B não alerta).
    `publicadosPorFamilia == null` → sem alerta. `publicados`/`patrocinados` contam esse conjunto.
  - Ordenação: campanhas ativas antes; dentro, famílias com alerta primeiro, depois por nome.
- **`src/lib/ads-campanhas-dados.ts`**: `buscarCampanhasAds(fresco)` (`supabase.functions.invoke`, erro via
  `erroDaEdge`).
- **`src/hooks/useAdsCampanhas.ts`**: react-query (`staleTime` 5 min, `enabled` só com a aba aberta), reaproveita
  `buscarCodigosMlbs` e `useCatalogoVendasSku`; `atualizar()` chama com `fresco: true`.
- **`src/pages/Ads.tsx`**: `Tabs` (`src/components/ui/tabs.tsx`) "Desempenho" | "Campanhas". O seletor de período
  só aparece em Desempenho. Aba inicial: Campanhas quando o painel do período está em
  `sem_ads`, `aguardando_mes`, `sem_coleta` ou `coletando` (Desempenho sem dado; campanha recém-criada); a escolha manual
  fica em localStorage (`ads-aba`, try/catch). O EmptyState de `sem_ads` ganha a ação "Ver campanhas".
- **`src/components/ads/campanhas/`**: cabeçalho da campanha (nome, estado, estratégia, orçamento diário, ROAS
  objetivo ↔ ACOS-alvo), lista de famílias com selos de alerta, linha expansível com os MLBs (thumb, título,
  status no Ads, status do item, estoque, preço, link para o ML), linha "Fora do PubliAI", rodapé "Lido às HH:mm ·
  Atualizar". Design premium consistente com o `/ads` atual (skill de UI/UX), mobile em cartões, `Select` Radix se
  houver dropdown, sem `<select>` nativo.
- **Link para Desempenho:** "Ver desempenho" na família só quando ela tem linha no painel do período atual
  (`painel.familias` com o mesmo `codigoPai`); troca de aba e abre o detalhe da família no ranking.
- Estados: carregando (Skeleton), erro (`role="alert"` + tentar de novo), `sem_conexao` (aviso novo: conectar o ML
  em Canais) / `sem_advertiser` / `sem_acesso` / `sem_permissao` (mapa de avisos da página), nenhuma campanha
  ativa/pausada, aviso de `projecaoLimitada`, motivo legível para cada `motivoEquilibrio`.

## Tarefas

| # | Tarefa | Modelo | Verificação |
|---|---|---|---|
| 1 | `_shared/ads/campanhas.ts` + testes (parsers com fixtures do spike 057 mascarados; `equilibrioDoMlb` com `resolverPack` real: kit próprio sem multiplicação dupla, pack escalado, cada `kit_*`, sem piso com custo válido, `sem_dimensao`, `erro_tarifa`; bulk 404/500/inválido; orquestrador com deps falsas: paginação, teto de páginas, tetos de cadastro/MLB/cores/tarifa sem truncar cores, só ativas projetadas, publicados com filho pendente e > 1.000 linhas, estados) | opus (cálculo de margem) | `pnpm test -- supabase/functions/_shared/ads` |
| 2 | Edge `ads-campanhas` (módulo desligado → 403 antes do ML, publicados paginados) + `config.toml` + `docs/reference/edge-functions.md` | sonnet | `deno check` da função, `pnpm preflight:static` |
| 3 | `src/lib/ads-campanhas.ts` + testes (agrupamento, fora do PubliAI, 3 alertas, hold não alerta, sem referência propaga) | sonnet | `pnpm test -- ads-campanhas` |
| 4 | Dados + hook + testes | sonnet | `pnpm test -- useAdsCampanhas` |
| 5 | UI: abas + componentes premium + teste de página (aba inicial, troca, estados) | sonnet + skill UI/UX | `pnpm test -- Ads`, `pnpm build` |
| 6 | Revisão Codex por task (diff), `pnpm preflight`, deploy `supabase functions deploy ads-campanhas` + versão, validação visual (Hairfly sem gasto → abre em Campanhas; Avil com gasto → Desempenho intacto + Campanhas), docs (TASKS, ADR produção, obsidian), Codex pré-merge, merge ff, pull main | opus | screenshots desktop + mobile |

## Fora do escopo

Escrita no ML; histórico de configuração; candidata fora da campanha (v2); orçamento ÷ margem; diagnóstico/tipo da
campanha (não vêm na API).
