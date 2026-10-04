# Migrar o multiget do Mercado Livre de `/items?ids=` para `/items/bulk` (prazo: 25/10/2026)

**Status:** spec. A instrução de handoff original foi reescrita com a verificação de 03/10/2026, que cruzou grep, Graphify e obsidian-vault, e com o spike real nas 4 orgs.
**Executor:** Claude (Opus), seguindo o workflow Superpowers.
**Revisão:** o Codex `gpt-6.1-sol` high revisa o plano, o diff de cada fatia e o pré-merge, por pedido explícito do Diego. A consultoria em caso de dúvida é o Codex `gpt-6-astra` high.
**Meta:** tudo em produção até **15/10/2026**, com folga de 10 dias antes do desligamento.

## 1. Contexto

O Mercado Livre desliga `GET /items?ids=…` em **25/10/2026**. O substituto é `GET /items/bulk?ids=…`. A resposta do bulk traz `status_code` onde o endpoint antigo trazia `code`. Trocar só a URL faz todo `entry.code === 200` virar falso, e os módulos passam a tratar todos os anúncios como ausentes **sem erro nenhum**.

A implementação de referência já está em produção desde 03/10, no commit `6f8f6c9b`:
- `supabase/functions/coletar-trafego-ml/deps.ts:135`;
- `_shared/trafego/fiacao.ts` → `parseMultigetStatus`, que aceita `code ?? status_code`;
- o fixture `_shared/trafego/__tests__/fixtures/multiget-status-ampliado.json`.

Ela fica **intocada** nesta migração, porque já funciona.

## 2. Contrato do bulk, medido no spike real de 03/10/2026 (só GET)

O spike rodou nas orgs Avil, DSA, Daludi Shop e Hairfly. Para cada conjunto de campos usado por um módulo, ele chamou o endpoint antigo e o bulk com os mesmos ids e comparou os `body` campo a campo. A tabela abaixo é a fonte da verdade desta spec.

| Fato | Medido |
|---|---|
| Sintaxe | `/items/bulk?ids=A,B&attributes=status_code,body.id,body.status,…`. Os campos do item levam o prefixo `body.` |
| Envelope | `[{status_code, body}]`. Sem `attributes=` o envelope traz também `id` no topo |
| `status_code` fora da seleção | O envelope vem só com `body` e o código se perde. É obrigatório incluir `status_code` |
| Campo sem o prefixo `body.` | Volta só `{id, status_code}`, sem body. É erro silencioso |
| Igualdade de conteúdo | **Os `body` são idênticos ao endpoint antigo** nos 13 conjuntos de campos dos módulos: 18 anúncios Avil, mais catálogo (`item_relations`) e relacionados nas 4 orgs e 2 kits DSA. Única diferença: a **ordem** do array `tags` |
| `include_attributes=all` | É aceito e devolve o mesmo conteúdo (promoções) |
| Vírgula codificada (`%2C`) | É aceita |
| id inexistente | O antigo devolve `{code:404, body:{id,…}}`. O bulk devolve **`{status_code:404}` sem body**, então não dá para saber de qual id é |
| id duplicado no lote | O antigo deduplica e responde 200. **O bulk responde HTTP 400 e o lote inteiro falha** |
| 21 ids | Os dois respondem HTTP 400 (bulk: `Too many IDs. Maximum allowed: 20`) |
| Latência e tamanho | De 250 a 470 ms por lote de 20. Tamanho igual ao antigo, +10 bytes |
| Docs do ML | A página respondeu 403. Tudo acima foi descoberto testando |

As respostas cruas ficam em `$CLAUDE_JOB_DIR/tmp/spike/`, fora do repo. Os fixtures do repo são versões **enxutas** delas.

## 3. Inventário verificado (grep + Graphify + obsidian-vault, 03/10/2026, `main` = `3b68f702`)

**Chamadas reais: 13 arquivos, 14 chamadas.** Nenhuma pede o item inteiro: todas têm `attributes=`, às vezes na linha de continuação.

| # | Arquivo:linha | `attributes=` hoje | Como reage a erro | Quem usa em produção |
|---|---|---|---|---|
| 1 | `_shared/canais/mercado-livre.ts:415` (`lerStatus`) | id,status,sub_status,available_quantity,price,listing_type_id,tags | bloco com erro → `[]`; não-200 → `null` → `indisponivel` | `status-publicados` (tela), `sincronizar-estoque` (**decide reativar = PUT**), `publicar-split-ml` (**preço vivo → faixa**), `monitorar-moderados`; o fecho de imports cobre 11 edges |
| 2 | `_shared/ml/buscar-item.ts:79` | id,category_id,family_name,seller_id,date_created | `throw` | adoção UP (`update-familia-ml`, `reconciliar-*`, `remover-publicado`) |
| 3 | `_shared/ml/atualizar-item.ts:183` (`propagarStatusRelacionadosML`) | id,status,sub_status | `throw` (relacionado ilegível → 502) | pausar/reativar (ADR-0060), estoque. **Antecede um PUT** |
| 4 | `_shared/ml/vendas.ts:139` | id,title,attributes | — | métricas de vendas (via canais) |
| 5 | `_shared/ml/pedidos.ts:35` | id,attributes | — | GTIN no faturamento: `sync-venda`, `sync-devolucao`, `backfill-faturamento`, `reconciliar-faturamento` |
| 6 | `_shared/ml/kit-virtual.ts:91` | id,listing_type_id | — | `criar-kit-virtual`, `status-publicados` |
| 7 | `buscar-componentes-kit-virtual/index.ts:55` | id,user_product_id,price,category_id | — | tela de kit (admin) |
| 8 | `_shared/promocoes/ml.ts:126` | id,title,thumbnail,secure_thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations + `include_attributes=all` | — | `sincronizar-promocoes` (cron), `operacoes-massa`, `coletar-ads-ml`, `coletar-trafego-ml` |
| 9 | `_shared/operacoes/ml.ts:40` | id,catalog_listing,item_relations / id,catalog_listing | `throw falha(r)`; ausente → Error | `operacoes-massa` (**antecede escrita em promoção**) |
| 10 | `_shared/ml/varrer-itens.ts:83` | id,title,status,permalink,available_quantity,seller_custom_field,catalog_listing | `throw` | `varrer-anuncios-orfaos` (admin, leitura) |
| 11 | `_shared/ml/descobrir-familia-up.ts:129` | id,seller_id,category_id,family_id,family_name,status,variations,attributes | `throw` | `update-familia-ml` |
| 12 | `pulse-coletar/processar.ts:687` (parser `_shared/pulse/parse.ts:105`) | id,status,sub_status,category_id,listing_type_id,price | não-200 ignorado | `pulse-coletar` (cron) |
| 13 | `acompanhar-migracao-pxv/index.ts:97` e `:175` | id,attributes / id,available_quantity | `throw` | worker QStash da migração PxV |

**Não mudam** (eram falso positivo da lista original):
- `_shared/analise/vendedores-do-catalogo.ts:3`: é só um comentário, que diz para *não* usar multiget.
- `buscar-componentes-kit-virtual/processar.ts:26`: é só comentário.

**Leitores do envelope `code`:** foram varridos com `grep "\.code\s*[!=]==?\s*200"`. Todos estão nos 13 arquivos acima, mais o `fiacao.ts` de referência.

**Testes afetados:**
- Com a URL antiga escrita por inteiro: `operacoes/__tests__/ml.test.ts:125-126` e `ml/__tests__/kit-virtual-status.test.ts:122`.
- Roteando por `includes('/items?ids=')`: `ml/__tests__/buscar-item.test.ts`, `ml/__tests__/descobrir-familia-up.test.ts:35,163`.
- Com envelope `code`: `canais/__tests__/mercado-livre.test.ts`, `ml/__tests__/varrer-itens.test.ts`, `pulse/__tests__/parse.test.ts`, `promocoes/__tests__/ml.test.ts` + `fixtures/multiget.json`, `promocoes/__tests__/sincronizar.test.ts`.
- **Sem teste do multiget hoje:** `atualizar-item.ts` (propagação) e `pedidos.ts`. As fatias desses dois **criam** o teste.

**Docs vivas a atualizar:**
- `docs/reference/edge-functions.md`;
- `obsidian-vault/03-Módulos/Estoque.md:231`;
- os runbooks afetados.

ADRs antigos, `plans/`, `specs/` e spikes são histórico e não são reescritos. `scripts/spike-trafego-ml.py:81` é um script de spike histórico e fica.

## 4. Design

### Abordagem escolhida: helper **puro** (URL + lotes + parse), com o transporte em cada módulo

A instrução original pedia um `multigetItens()` que também fizesse o fetch. Esta spec escolhe não fazer isso. Os módulos usam 4 transportes diferentes:
- `fetchLike` com headers;
- o `get` de promoções, com tratamento próprio de 429;
- o `chamar` de operações;
- o `fetch` do Pulse.

E cada um tem semântica de erro diferente: `throw`, `[]` ou `falha(r)`. Centralizar o fetch mudaria retry e propagação de erro em fluxos que escrevem no ML. O helper puro centraliza exatamente o que muda (URL, envelope, lotes e dedup) e deixa intacto o que não muda.

`supabase/functions/_shared/ml/multiget.ts`, sem import Deno/npm, para o vitest carregar:

```ts
export const LIMITE_MULTIGET = 20;

/** Ids únicos (ordem preservada, vazios fora) em blocos de ≤20. O bulk responde 400 ao lote inteiro com id repetido. */
export function blocosMultiget(ids: readonly string[]): string[][];

/** `/items/bulk?ids=…&attributes=status_code,body.<campo>,…[extra]`. Garante `id` na seleção.
 *  Lança erro (de programação) se o bloco tiver 0 ou mais de 20 ids, ou id repetido. */
export function caminhoMultiget(bloco: readonly string[], campos: readonly string[], extra?: string): string;

/** Normaliza os dois envelopes (`code` antigo, `status_code` bulk) → `{ code, body }`. Não-array → []. */
export function entradasMultiget<T = Record<string, unknown>>(json: unknown): Array<{ code: number | null; body: T | null }>;

/** Só os bodies com código 200 e `body.id` string, o filtro que 12 dos 13 módulos repetem hoje. */
export function itensMultiget<T extends { id?: unknown }>(json: unknown): T[];
```

Cada módulo troca três coisas:
1. o laço de blocos por `blocosMultiget(ids)`;
2. a URL por `${API}${caminhoMultiget(bloco, CAMPOS)}` ou pelo caminho relativo no transporte dele;
3. o filtro `code === 200` por `itensMultiget` ou `entradasMultiget`.

O resto do módulo não muda: tratamento de `!resp.ok`, `throw` contra `[]`, mapa por id e saída.

### Comportamentos preservados de propósito
- **`lerStatus`:** um id que não volta com 200 continua virando `null` → `indisponivel`, pelo `porId.get(id) ?? null`. Hoje o 404 já vira `null`. No bulk ele vem sem body e cai no mesmo `?? null`.
- **Ordem de `tags`:** o consumidor só usa `includes`. A fatia 1 confirma isso no código antes de mudar.
- **Dedup:** o endpoint antigo já deduplicava, e o helper só reproduz isso.

### Riscos e onde cada um é pego

| Risco | Efeito se escapar | Onde é pego |
|---|---|---|
| Parse lê `code` e ignora `status_code` | Tudo vira ausente: status `indisponivel`, preço nulo, GTIN nulo | teste com fixture real do bulk + A/B |
| Id duplicado chega ao bulk | Lote inteiro em 400: promoções, faturamento ou status param naquele lote | `blocosMultiget` deduplica + teste |
| Campo esquecido sem `body.` ou sem `status_code` | Body vazio em silêncio | `caminhoMultiget` monta a seleção sozinho; o teste compara a URL exata |
| `lerStatus` errado alimentando escrita | Reativação indevida (`sincronizar-estoque`) ou faixa de preço errada (`publicar-split-ml`) | A/B: saída idêntica, campo a campo, à da `main` nos mesmos anúncios |
| Propagação de status (`atualizar-item`) | PUT em relacionado errado ou faltando | teste novo + A/B com **PUT bloqueado e registrado**: compara os PUTs que *seriam* feitos |
| Redeploy incompleto de `_shared` | Edge antiga chamando `/items?ids=` depois de 25/10 | lista por `deno info` (não por grep) + `supabase functions list` + varredura final |

## 5. Como validar sem tocar nos anúncios (obrigatório em toda fatia)

1. **Regra inviolável:** no ML, só GET durante spike, A/B e validação. Nenhum PUT/POST em anúncio fora do fluxo normal do app, nem para teste. UPDATE, publicação, pausa e reativação reais só são validados quando acontecem pelo fluxo do app.
2. **Teste unitário com fixture real enxuta** de cada conjunto de campos, cobrindo:
   - o envelope novo e o antigo;
   - 404 sem body;
   - lote com duplicado;
   - mais de 20 ids.
3. **Contraprova A/B local, a rede de segurança principal.** Um script Deno descartável em `$CLAUDE_JOB_DIR/tmp`:
   - importa a função de leitura do módulo duas vezes, uma da árvore `origin/main` (extraída com `git archive`) e outra da branch;
   - roda as duas com o token real (SQL read-only, sem refresh, nunca impresso) nos mesmos anúncios das 4 orgs;
   - exige saída **idêntica**.

   O `fetch` global é trocado **antes** do import por uma guarda que:
   - deixa passar só `GET https://api.mercadolibre.com/*`;
   - recusa qualquer outro método ou host **sem tocar a rede** e registra a tentativa (método, URL, corpo).

   A guarda tem teste próprio: um PUT de teste precisa ser bloqueado e registrado sem sair da máquina. Nas funções que escrevem depois da leitura (`propagarStatusRelacionadosML`, operações), o A/B compara a lista de escritas **bloqueadas** do antigo com a do novo.
4. **Depois do deploy**, observar uma execução real (cron, QStash ou tela):
   - logs da edge pelo endpoint de analytics da Management API, com `iso_timestamp_start/end`;
   - zero erro de parse e zero HTTP 400 do bulk;
   - o resultado bate com o anterior (status, preço e GTIN iguais nos mesmos anúncios).
5. **Rollback por fatia:** antes do deploy, anotar a versão ativa de cada edge (`supabase functions list`). Para voltar, redeployar as mesmas edges a partir do commit anterior da `main` (via `git archive` num diretório temporário). O endpoint antigo vale até 25/10, então o rollback é seguro até lá.

## 6. Fatias (uma por vez: commit, revisão, merge, deploy e observação)

| Fatia | Conteúdo | Validação em produção |
|---|---|---|
| **F0** | `_shared/ml/multiget.ts` + testes + fixtures do spike + ADR-0177 + harness A/B com teste da guarda. Sem deploy: nenhuma edge importa o helper ainda | — |
| **F1** | `canais/mercado-livre.ts` (`lerStatus`), `ml/buscar-item.ts`, `ml/atualizar-item.ts` (+ teste novo da propagação) | `monitorar-moderados`/`sincronizar-estoque` sem erro nos logs; tela Publicados com a mesma contagem por status do A/B |
| **F2** | `ml/vendas.ts`, `ml/pedidos.ts` (+ teste novo) | `sync-venda` da próxima venda real com GTIN preenchido; `reconciliar-faturamento` (cron `0 * * * *`) sem erro |
| **F3** | `ml/kit-virtual.ts`, `buscar-componentes-kit-virtual/index.ts` | `status-publicados` com kit (DSA); preview de kit sem erro, se o Diego abrir |
| **F4** | `promocoes/ml.ts`, `operacoes/ml.ts`, `ml/varrer-itens.ts`, `ml/descobrir-familia-up.ts` | `sincronizar-promocoes` (cron `10 */6`) com o mesmo número de itens/categorias da rodada anterior; `coletar-trafego-ml` (cron `17 9`) seguindo ok |
| **F5** | `pulse/parse.ts` + `pulse-coletar/processar.ts`, `acompanhar-migracao-pxv/index.ts` (2 chamadas); comentário de `buscar-componentes-kit-virtual/processar.ts` | `pulse-coletar` quente (`0 */6`) sem erro e com status gravado; PxV sem migração ativa → A/B basta |
| **F6** | Varredura final + docs vivas + nota no ADR | `grep -rn "items?ids=" supabase/functions src` = 0 fora de comentários históricos |

O conjunto de edges de cada fatia sai de `deno info` sobre cada `index.ts`, porque `canais/mercado-livre.ts` entra pelas edges via `registry.ts`. Estimativa feita por fecho de imports em 03/10, a confirmar com `deno info`:
- F1: 15 edges (`process-familia`, `publish-familia-ml`, `update-familia-ml`, `status-publicados`, `sincronizar-estoque`…);
- F2: canais + 4 edges de faturamento;
- F3: 3 edges;
- F4: 6 edges, incluindo `coletar-trafego-ml`;
- F5: 3 edges;
- total: cerca de 29 das 77.

**Ciclo de cada fatia:**
1. TDD;
2. A/B idêntico;
3. revisão do diff pelo Codex sol (minuciosa);
4. `pnpm preflight`;
5. push na branch e CI verde (`frontend`, `backend-lint`);
6. **parar e voltar ao Diego** com o resumo (testes, A/B, edges, decisões);
7. com o OK do Diego: merge fast-forward na `main`;
8. `supabase functions deploy` das edges da fatia;
9. conferir a versão ativa;
10. observar em produção;
11. só então a próxima fatia.

O deploy só sai depois do merge, para o código no ar nunca ficar à frente da `main`.

## 7. Critério de pronto
- Nenhuma chamada a `/items?ids=` em `supabase/functions` nem em `src`, e todos os 13 módulos usando o helper.
- Cada fatia com fixture real, testes verdes, A/B idêntico, deploy feito e versão ativa conferida.
- Uma execução real por fatia observada em produção, sem erro.
- `pnpm preflight` e o CI verdes.
- ADR-0177 e docs vivas atualizadas.
- Tudo em produção até 15/10/2026.

## 8. Fora de escopo
- `fiacao.ts`/`coletar-trafego-ml/deps.ts` (referência já migrada) continuam como estão.
- Outros endpoints do ML.
- `scripts/spike-trafego-ml.py`.
