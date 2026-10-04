# Migrar o multiget do Mercado Livre de `/items?ids=` para `/items/bulk` (prazo: 25/10/2026)

**Status:** spec v2 (03/10/2026). A v1 foi revisada pelo Codex `gpt-6.1-sol` high (18 achados, veredito REVISAR) e passou por consultoria do `gpt-6-astra` high. Esta versão incorpora os dois e o spike 3.
**Executor:** Claude (Opus), seguindo o workflow Superpowers.
**Revisão:** o Codex `gpt-6.1-sol` high revisa o plano, o diff de cada fatia e o pré-merge, por pedido explícito do Diego. A consultoria em caso de dúvida é o `gpt-6-astra` high.
**Meta:** tudo em produção até **15/10/2026**, com deploy e observação incluídos e folga de 10 dias antes do desligamento.

## 1. Contexto

O Mercado Livre desliga `GET /items?ids=…` em **25/10/2026**. O substituto, `GET /items/bulk?ids=…`, tem outro envelope e outro comportamento em casos-limite (§2). Trocar só a URL faz todo `entry.code === 200` virar falso, e os módulos passam a tratar todos os anúncios como ausentes **sem erro**.

A referência já migrada está em produção desde 03/10 (commit `6f8f6c9b`):
- `coletar-trafego-ml/deps.ts:135`;
- `_shared/trafego/fiacao.ts` (`parseMultigetStatus`, que lê `code ?? status_code`).

Ela fica **intocada**.

**Promessa desta migração:** as **decisões de negócio** ficam equivalentes: status, preço, estoque, GTIN, vínculos e o que é escrito ou deixa de ser escrito no ML. As diferenças de protocolo ficam **explicitamente delimitadas** (§4.3). Não se promete igualdade literal de logs nem de ordem de listas, porque a ordem do endpoint antigo já era arbitrária.

## 2. Contrato do bulk (medido; spikes de 03/10/2026, só GET, 4 orgs)

| Fato | Medido |
|---|---|
| Sintaxe | `/items/bulk?ids=A,B&attributes=status_code,body.id,body.status,…`. Os campos do item levam o prefixo `body.` |
| Envelope | `[{status_code, body}]`. Sem `attributes=`, ganha também `id` no topo |
| `status_code` fora da seleção | O envelope perde o código |
| Campo sem o prefixo `body.` | Volta só `{id, status_code}`, sem body, em silêncio |
| Conteúdo | **Os `body` são idênticos ao endpoint antigo** nos 13 conjuntos de campos dos módulos: 18 anúncios Avil, catálogo e relacionados (`item_relations`) nas 4 orgs, 2 kits DSA. Única diferença dentro do body: a ordem do array `tags` |
| Ordem dos envelopes | **Antigo: arbitrária, muda de chamada para chamada.** Bulk: a ordem dos ids pedidos |
| id inexistente | Antigo: `{code:404, body:{id, message, error, status, cause}}`. Bulk: **`{status_code:404}` sem body**, **na mesma posição do id pedido** (lote `[ok, ruim, ok, ruim, ok]` → `[200, 404, 200, 404, 200]`) |
| id repetido | Antigo: deduplica e responde 200. Bulk: **HTTP 400 no lote inteiro** |
| Limite | Os dois respondem 400 a 21 ids distintos. O antigo **deduplica antes de aplicar o limite** (21 posições com 20 únicos → 200 com 20 itens) |
| `include_attributes=all` e `%2C` | Aceitos pelo bulk |
| Item de outro vendedor | Não medido: a busca pública respondeu 403. Nenhum dos 13 módulos lê item de terceiro por multiget; `vendedores-do-catalogo.ts` usa outra rota de propósito (ADR-0143) |
| Latência | De 250 a 470 ms por lote de 20; tamanho igual ao antigo |

As respostas cruas ficam em `$CLAUDE_JOB_DIR/tmp/spike/`, fora do repo.

## 3. Inventário verificado (grep + Graphify + obsidian-vault; `main` = `3b68f702`)

**Chamadas reais: 13 arquivos, 14 chamadas.** Nenhuma pede o item inteiro.

| # | Arquivo:linha | `attributes=` | Blocos hoje | Uso em produção (escrita a jusante) |
|---|---|---|---|---|
| 1 | `_shared/canais/mercado-livre.ts:415` (`lerStatus`) | id,status,sub_status,available_quantity,price,listing_type_id,tags | 20, em paralelo | `status-publicados`, `sincronizar-estoque` (**reativa se `pausado`**), `publicar-split-ml` (**`preco` → faixa**), `monitorar-moderados` |
| 2 | `_shared/ml/buscar-item.ts:79` | id,category_id,family_name,seller_id,date_created | 20 | adoção UP (`ambiguo`/`um` **libera atualização**) |
| 3 | `_shared/ml/atualizar-item.ts:183` (`propagarStatusRelacionadosML`) | id,status,sub_status | **nenhum** | pausar/reativar (ADR-0060), estoque. **Antecede PUT** |
| 4 | `_shared/ml/vendas.ts:139` (`buscarTitulosEGtins`, não exportada) | id,title,attributes | 20 | métricas de vendas |
| 5 | `_shared/ml/pedidos.ts:35` | id,attributes | 20 | GTIN → markup no faturamento |
| 6 | `_shared/ml/kit-virtual.ts:91` | id,listing_type_id | 20 | `criar-kit-virtual`, `status-publicados` |
| 7 | `buscar-componentes-kit-virtual/index.ts:55` (inline) | id,user_product_id,price,category_id | 20 | tela de kit (admin) |
| 8 | `_shared/promocoes/ml.ts:126` | id,title,thumbnail,secure_thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations + `include_attributes=all` | 20 | `sincronizar-promocoes`, `operacoes-massa`, `coletar-ads-ml`, `coletar-trafego-ml` |
| 9 | `_shared/operacoes/ml.ts:40` | id,catalog_listing,item_relations / id,catalog_listing | **nenhum** | `operacoes-massa` (**antecede escrita em promoção**) |
| 10 | `_shared/ml/varrer-itens.ts:83` | id,title,status,permalink,available_quantity,seller_custom_field,catalog_listing | 20 | `varrer-anuncios-orfaos` (leitura) |
| 11 | `_shared/ml/descobrir-familia-up.ts:129` | id,seller_id,category_id,family_id,family_name,status,variations,attributes | 20 | `update-familia-ml` (vínculo de cor → escrita) |
| 12 | `pulse-coletar/processar.ts:687` (inline; parser `_shared/pulse/parse.ts`) | id,status,sub_status,category_id,listing_type_id,price | 20, ids já únicos | `pulse-coletar` (grava a situação) |
| 13 | `acompanhar-migracao-pxv/index.ts:97` e `:175` (inline) | id,attributes / id,available_quantity | **nenhum** | worker da migração PxV (casamento, reposição) |

**Não mudam:** `vendedores-do-catalogo.ts:3` e `buscar-componentes-kit-virtual/processar.ts:26`. São só comentários; o segundo é atualizado.

**Testes afetados:**
- URL antiga escrita por inteiro: `operacoes/__tests__/ml.test.ts:125-126`, `ml/__tests__/kit-virtual-status.test.ts:122`.
- Roteamento por `includes('/items?ids=')`: `buscar-item.test.ts:24`, `descobrir-familia-up.test.ts:35,163`.
- Envelope `code`: `canais/__tests__/mercado-livre.test.ts` (inclusive a propagação, 531-597), `varrer-itens.test.ts`, `pulse/__tests__/parse.test.ts`, `promocoes/__tests__/ml.test.ts` + `fixtures/multiget.json`, `promocoes/__tests__/sincronizar.test.ts`.
- **Sem teste do multiget hoje:** `pedidos.ts`, os três trechos inline (componentes, PxV, Pulse).

**Docs vivas a atualizar:** `docs/reference/edge-functions.md`, `obsidian-vault/03-Módulos/Estoque.md:231` e o runbook `coletar-trafego-ml.md`. Histórico (ADRs antigos, plans, specs, spikes) não é reescrito.

## 4. Design

### 4.1 Adaptador de envelope (o helper)

`supabase/functions/_shared/ml/multiget.ts`, puro (sem import Deno/npm):

```ts
/** Caminho relativo do bulk. Deduplica DENTRO da requisição (o antigo deduplicava antes do limite).
 *  Não divide em blocos, não filtra, não lança: o particionamento e os erros continuam com o módulo. */
export function caminhoMultiget(ids: readonly string[], campos: string, extra?: string): string;

/** Converte a resposta do bulk no ENVELOPE ANTIGO `[{code, body}]` (regra final, plano v3.1):
 *  - só reinterpreta entrada SEM a chave `code` (formato bulk): vira `{code: status_code, body?}`;
 *  - entrada no formato antigo (tem `code`, inclusive `code: null`) volta byte a byte intacta;
 *  - SÓ o 404 sem body ganha `body: {id}`, pela posição, e só se a cardinalidade bate com os ids
 *    únicos enviados E todo id presente está na sua posição; 200/500 sem body nunca ganham body;
 *  - resposta não-array e entrada não-objeto voltam intactas. */
export function comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown;
```

Cada módulo troca **duas coisas**:
1. a URL, por `${API}${caminhoMultiget(bloco, '<os mesmos campos de hoje>')}`;
2. o JSON lido, por `comoEnvelopeAntigo(json, bloco)`, antes do código que já existe.

**Nenhum predicado, laço, `throw`/`[]`/`continue`, tipo ou acesso a `entry.code` muda.** Os módulos continuam lendo o envelope antigo.

**Por que adaptador, e não um parser novo.** A v1 trocava os filtros de cada módulo por um filtro comum, e o Codex mostrou 6 classes de diferença:
- id numérico, vazio ou ausente;
- `null` contra objeto;
- prioridade entre `code` e `status_code`;
- dedup global mudando `ambiguo` para `um`;
- erro transitório que vira definitivo no PxV;
- 404 sem id que deixa de sobrescrever um status anterior.

Devolver o envelope antigo elimina todas: o código a jusante recebe a mesma forma de sempre.

### 4.2 Extração mínima de leituras inline (só para testar o transporte real)

`buscar-componentes-kit-virtual/index.ts`, `acompanhar-migracao-pxv/index.ts` (`lerCores` e estoque vivo) e o laço do `pulse-coletar/processar.ts` não podem ser importados em teste, porque `index.ts` sobe `Deno.serve`. Eles ganham funções exportadas num arquivo próprio, **num commit de refatoração pura antes do bulk**. A extração move só URL → requisição → leitura → retorno, preservando:
- laços, predicados e comportamento com não-array;
- **quando e quantas vezes `getToken()` é chamado**.

A função `buscarTitulosEGtins` de `vendas.ts` só ganha `export`.

### 4.3 Diferenças de protocolo aceitas (declaradas)
- **Ordem dos envelopes:** antes arbitrária, agora a ordem pedida. Saídas que conservam a ordem (lista de órfãos, `porCor` na descoberta) são comparadas como **multiconjunto**. A escolha do primeiro `family_name` na descoberta só pode divergir se irmãos da mesma família tiverem nomes diferentes. O A/B verifica isso, e qualquer divergência vai ao Diego.
- **Body do 404:** antes `{id, message, error, status, cause}`, agora `{id}`. Nenhum consumidor lê os outros campos do 404 (Codex, achado 17).
- **Ordem de `tags`:** só lida por `includes` (`_shared/ml/status.ts:76`).
- **Logs e mensagens:** onde o módulo imprime a URL (o `mlGet` imprime a URL inteira) ou cita a rota, a nova aparece. Filtros de log operacionais passam a procurar `/items/bulk`.
- **Número de entradas devolvidas:** igual (dedup por requisição dos dois lados).

### 4.4 Riscos e onde cada um é pego

| Risco | Onde é pego |
|---|---|
| Parser não lê `status_code` | o adaptador entrega `code`; teste por módulo com fixture real do bulk |
| Id repetido no bloco → 400 | `caminhoMultiget` deduplica; teste por módulo com repetido no bloco |
| Repetido **entre** blocos (200 num bloco, 404 no outro) | o adaptador recoloca o id no 404, então o comportamento antigo de sobrescrever volta; teste no `lerStatus` |
| `lerStatus` → reativação ou faixa de preço | teste com o `lerStatus` real dentro do `sincronizar-estoque` + A/B |
| Propagação de status (PUT em relacionados) | testes parametrizados nos dois envelopes, casos mistos nos dois sentidos, sequência de PUTs caracterizada (inclusive o PUT antes do 502 que já existe hoje) + A/B com as escritas simuladas |
| Deploy parcial ou com conteúdo errado | manifesto por edge: hash do código baixado de produção contra a árvore do SHA, antes e depois |

## 5. Validação sem tocar nos anúncios

1. **Inviolável:** no ML, só GET em spike, A/B e validação. UPDATE, publicação, pausa e reativação reais só são validados quando acontecem pelo fluxo normal do app.
2. **Testes unitários** com fixtures reais **alinhados pelos mesmos ids** nos dois envelopes. Preservam os atributos que os cenários usam (GTIN, COLOR, `attribute_combinations`) e incluem a entrada 404.
3. **A/B em duas fases** (harness descartável em `$CLAUDE_JOB_DIR/tmp/ab`):
   - Fase A: roda a árvore **baseline** com a guarda. Só GET em `api.mercadolibre.com` vai à rede. Toda escrita recebe uma resposta **simulada por rota** e é registrada, e todo GET é gravado.
   - Fase B: roda a árvore **nova**. GETs que não são multiget vêm do **replay** da fase A; GET inesperado ou gravação não consumida reprova, nunca cai na rede em silêncio. Só o multiget é ao vivo.
   - Depois roda A de novo: se A ≠ B mas A' = B, a diferença é preço ou estoque mudando entre as fases, e a comparação é repetida.
   - A comparação é estrita. Multiconjunto só onde o §4.3 declara. As escritas simuladas são comparadas em sequência, com método, alvo e corpo.
   - Reprova com: 401/403 (token expirado não é renovado), HTTP inesperado, org faltando, amostra vazia ou cenário positivo sem resultado positivo.
4. **Baseline:**
   - código baixado de produção (`supabase functions download --use-api`, um diretório por edge) ≡ árvore do commit anterior à fatia;
   - se divergir, bloqueia até explicar;
   - SHAs fixos, nunca `origin/main` móvel.
5. **Pós-deploy** (forma final, plano v3.1):
   - novo download por edge, com hash por arquivo igual à árvore do SHA implantado e `verify_jwt` igual. Como a árvore implantada é a que passou no A/B, esse hash é a prova de que o código implantado é o testado; não há A/B pós-deploy;
   - observação de execuções reais (cron/QStash) sem erro, mais comparação **por id e campo** do resultado do código implantado. Ela é feita pela conta de teste, com sessão por magic link via Admin API (sem trocar a senha) e logout local; o consultor aprovou trocar a Avil pela DSA;
   - caminho que depende do operador ou que escreveria no ML fica registrado como "não observado; coberto por teste + A/B + manifesto".
6. **Rollback** (só até 25/10):
   - redeploy do snapshot baixado antes do deploy, com `--project-ref` explícito e `verify_jwt` do manifesto;
   - reverter o código por branch → CI → fast-forward.
   - Rollback restaura código, não desfaz o que o fluxo normal já fez. Depois de 25/10, só correção para a frente (o bulk é o único caminho).

## 6. Fatias

| Fatia | Conteúdo |
|---|---|
| **F0** | Helper + testes + fixtures alinhados + ADR-0177 + harness A/B (com testes da guarda e do replay) + manifesto de deploy. Sem deploy |
| **F1** | `lerStatus`, `buscar-item`, `atualizar-item` |
| **F2** | `vendas`, `pedidos` |
| **F3** | `kit-virtual`; `buscar-componentes-kit-virtual` (extração + bulk) |
| **F4** | `promocoes`, `operacoes`, `varrer-itens`, `descobrir-familia-up` |
| **F5** | Pulse (extração + bulk) e PxV (extração + bulk, 2 leituras) |
| **F6** | Varredura final, docs, Graphify |

**Ciclo de cada fatia:**
1. TDD;
2. A/B;
3. revisão do diff pelo Codex sol;
4. `pnpm preflight`;
5. CI verde;
6. **parar e voltar ao Diego**;
7. merge fast-forward;
8. download pré-deploy + manifesto;
9. deploy das edges listadas por `deno info`;
10. download pós-deploy + hash (prova de que o implantado é o testado; sem A/B pós-deploy, §5.5);
11. observação;
12. só então a próxima fatia.

Deploy parcial interrompe o avanço até completar ou reverter todas as edges da fatia.

## 7. Critério de pronto
- Nenhuma chamada a `/items?ids=` em código executável de `supabase/functions` e `src`.
- Os 13 módulos usam o adaptador.
- Em cada fatia: fixtures reais alinhados, testes verdes, A/B aprovado, deploy com hash conferido e observação registrada.
- `pnpm preflight` e CI verdes.
- ADR-0177 e docs vivas atualizadas.
- Tudo em produção até 15/10/2026.

## 8. Fora de escopo
- Melhorias funcionais: mais de 20 relacionados na propagação, mais de 20 ids no PxV, dedup global. Hoje esses casos já respondem 400 e continuam assim.
- `fiacao.ts` e `coletar-trafego-ml/deps.ts`.
- Outros endpoints do ML.
- `scripts/spike-trafego-ml.py`.
