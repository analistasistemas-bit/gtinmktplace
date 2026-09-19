# Variação por Tamanho / Numeração (roupa e calçado) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma organização com tipo de produto `roupa` e/ou `calcado` habilitado cadastre manualmente um produto cujo SKU é o par **cor × tamanho/numeração**, informe o **gênero** da peça, e publique esse anúncio no Mercado Livre com os atributos que o ML exige (COLOR + guia de tamanhos), **sem alterar em nada o comportamento de qualquer organização que não tenha nenhum tipo de produto habilitado**.

**Architecture:** Três camadas aditivas, cada uma condicionada a `organizations.tipos_produto_habilitados`. (1) Configuração por org — coluna `text[]` nova em `organizations`, gate de edge espelhando `_shared/produto/modulo.ts`, e um card **separado** da lista de módulos pagos na tela do super-admin. (2) Dado de produto — `familias.genero` e `variacoes.tamanho`, gravados só pelo cadastro manual (ADR-0094); planilha (`ingest-lote`) fica fora desta entrega. (3) Publicação — `VariacaoCanonica` (`_shared/canais/contrato.ts`) ganha os campos, e `_shared/ml/publicar.ts` passa a emitir `attribute_combinations` com COLOR **+** `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` quando a família tem tamanho; sem tamanho o payload sai byte a byte igual ao de hoje. O guia de tamanhos do ML (tabelas `POST /catalog/charts`) é gerenciado pelo próprio PubliAI via API, e **todo o código dessa camada é bloqueado até um spike técnico confirmar o contrato real da API** — a documentação oficial do ML recusa acesso automatizado (403 medido em 2026-09-18) e nenhum payload pode ser escrito por suposição.

**Tech Stack:** React 19 + TypeScript + Vite + TanStack Query + shadcn/ui (frontend); Supabase Edge Functions (Deno) + Postgres com RLS por `org_id` (backend); Vitest (`pnpm test`, três árvores de teste: `tests/`, `src/**/__tests__/`, `supabase/functions/**/__tests__/`); Supabase CLI para migrations (`supabase migration new` + `supabase db push`, ADR-0043); QStash para os workers.

**Spec:** Sessão de grilling/domain-modeling de 2026-09-18, registrada em `docs/reference/glossario.md` (seção "Domínio de produto", verbetes **Tipo de produto habilitado (roupa / calçado)**, **Tamanho (roupa)**, **Numeração (calçado)**, **Guia de tamanhos (roupa)**). Esse arquivo é a fonte de vocabulário oficial deste plano — nenhum termo novo é inventado aqui.

---

## Histórico de revisão

2026-09-19 — **Renumeração de ADR (execução da Task 5).** `origin/main` já publicou ADR-0165 (faixas regressivas de cobrança, branch `cobranca-faixas-modalidade`, já mergeada) — colisão real, o mesmo risco já sinalizado no grilling. Todo o documento foi deslocado: o que era ADR-0165 (tipo de produto por org) virou **ADR-0166**, e o que era ADR-0166 (guia de tamanhos via API) virou **ADR-0167**. A migration da Task 5 já foi aplicada em produção com o número corrigido (`20260919105517_adr166_tipos_produto_por_org.sql`, commit `bd154e38`); o worktree também precisou de merge de `origin/main` (29 commits, sem conflito) para `db:check` ficar verde antes do push. Tasks 2 e 3 (ADRs) ainda não foram escritas — vão nascer já com os números corretos.

2026-09-18 — Revisão do Fable (aprovado com ressalvas): 7 achados aplicados — ver correções nas Fases 2, 3, 4, 5 e 6.

Os rótulos **R1-R7** abaixo identificam os **achados** e aparecem no corpo do plano, em comentário de código, junto de cada correção. Não confundir com **F1-F8** da tabela "Revisão do Fable — checklist consolidado" no fim do documento, que são os **checkpoints** de revisão.

| # | Sev. | Achado | Onde foi corrigido |
|---|---|---|---|
| **R1** | Alta | O resolvedor da tabela de medidas estava ligado em `publicar-anuncio` (worker de canais ≠ ML); o CREATE do ML roda em `publish-familia-ml` — toda família com tamanho falharia "sem tabela de medidas". O miolo passa a viver em `_shared/ml/size-chart-wiring.ts` (dois workers do ML o consomem). Junto: o teste da Task 20 chamava `montarAnuncioCanonico` com a assinatura errada, e o deploy esquecia `publish-familia-ml`. | Fase 5 (Tasks 20 e 23) e Fase 6 (Task 26, Step 4) |
| **R2** | Alta | Rename de cor derrubava o PUT em família com tamanho: `montarVariacoesUpdate` troca `attribute_combinations` por só `[COLOR]` e perde o `SIZE_GRID_ROW_ID` (classe do incidente lote #45). Rename nessas famílias sai do escopo do v1 e falha LOUD. | Fase 5 (Tasks 20 e 22) |
| **R3** | Alta | Gênero era opcional no cadastro e obrigatório na publicação, sem tela para corrigir — produto nascia impublicável. Agora é obrigatório (front e backend) quando alguma variação tem tamanho. | Fase 3 (Tasks 12 e 15) |
| **R4** | Média | O fluxo "adicionar variação a família publicada" (ADR-0129) escapava de todas as travas e criaria família mista; a coluna nova ainda quebrava a paridade de chaves do insert multi-row. | Fase 3 (Task 16A, nova) |
| **R5** | Média | Sob concorrência (fila serial é por **usuário**, não por org) duas publicações criavam duas tabelas de medidas no ML. Passa a reservar a linha local **antes** de chamar a API. | Fase 4 (Tasks 17 e 19) |
| **R6** | Baixa | A "prova" do CHECK de gênero fazia um INSERT real em `familias` (produção) que nem chegava ao CHECK. Trocada por consulta read-only em `pg_constraint`, com o CHECK nomeado. | Fase 2 (Task 10) |
| **R7** | Baixa | A whitelist de tipos estava redigitada em três arquivos e as listas de tamanho só existiam no frontend (backend sem como validar). Fonte única em `_shared/produto/tipos-produto-valores.ts` + validação de backend (400). | Fase 1 (Tasks 6, 7, 8), Fase 3 (Tasks 11 e 16) |

2026-09-19 — Revisão do Fable (2ª rodada, em cima da correção do R2; inclui dois nits do R1): a correção anterior do R2 **não fechava o problema** — o guard existia mas nunca disparava em produção. Rótulos **R2b/R2c** (o R2 refeito) e **R1b/R1c** (os nits).

| # | Sev. | Achado | Onde foi corrigido |
|---|---|---|---|
| **R2b** | Alta | **O sinal da correção anterior era morto em produção.** `motivoRenameBloqueado` e `familiaTemTamanho` liam `AtualizacaoCanonica.existentes[].tamanho`, preenchido em `update-familia-ml/processar.ts:323` a partir das `variacoes` da própria família do lote UPDATE. Só que os **dois únicos** produtores de lote UPDATE no v1 nunca põem tamanho ali: `adicionar-variacoes-familia` já está bloqueado para família com tamanho (R4), e `ingest-lote/index.ts:314-328` herda da variação anterior apenas `ml_variation_id`, `cor`, `cor_origem`, `ml_picture_id`, `estoque_anterior` e `preco_publicacao` — **nunca `tamanho`**. Logo `existentes[].tamanho` seria sempre `null`, o guard jamais dispararia e o PUT continuaria sendo derrubado exatamente como antes. Sinal trocado pela **fonte de verdade certa, o próprio ML**: `buscarItemML` passa a ler `SIZE_GRID_ROW_ID` das `attribute_combinations` (`MLVariacaoAtual.temSizeGrid`) e o bloqueio decide por `atuaisNoML.some((v) => v.temSizeGrid)`. Consequência: o campo `existentes[].tamanho` sai do contrato — não tinha outro consumidor. | Fase 5 (Tasks 20 e 22) |
| **R2c** | Média | **Bônus do mesmo sinal** (fecha uma porta que o R4 deixou aberta): re-ingest de planilha numa família com tamanho, com um CÓDIGO novo, gera `a.novas` sem `sizeGridRowId` — payload incompleto vazando ao ML e erro cru da API de volta ao operador. Trava LOUD (400, `VARIACAO`) no conector, o único ponto onde `a.novas` e o estado real do item se encontram. | Fase 5 (Task 22, Step 5.2) |
| **R1b** | Baixa | Task 23, Step 5: `resolverComSupabase(admin, token)` usava um `token` que **não existe** no escopo de `publish-familia-ml/processar.ts` — o worker só tem `ctx.getToken()` (montado em `:88-92`). Passa a ser `await ctx.getToken()`, nos dois workers. | Fase 5 (Task 23, Steps 5 e 6) |
| **R1c** | Baixa | Task 23, Steps 5 e 6: o `select` extra de `conta_externa_id` era redundante — `resolverConexao` (`_shared/canais/conexao.ts:22-27`) já devolve `ConexaoCanal.contaExternaId`, e os dois workers já têm `conexao` em escopo (`publish-familia-ml/processar.ts:87`, `update-familia-ml/processar.ts:109`). Select removido; usa-se o campo que já está na mão. | Fase 5 (Task 23, Steps 5 e 6) |

2026-09-19 — Revisão do Fable (3ª rodada, escopo estreito no R2b/R2c/R1b/R1c): **veredito "sim, pronto para a Fase 1"**, com uma emenda que não bloqueia o início mas tem que entrar antes da Fase 5 rodar.

| # | Sev. | Achado | Onde foi corrigido |
|---|---|---|---|
| **R2d** | Média | `motivoRenameBloqueado` comparava `e.cor !== corNoML.get(e.sku)` byte a byte — o dicionário de COLOR do ML reescreve grafia ao publicar (`Rosa Claro` → `Rosa-claro`, ver glossário), então isso não é só risco de `somenteEstoque`: qualquer UPDATE completo/re-ingest de família com tamanho cuja cor já foi normalizada pelo ML bloquearia com 400, mandando "repor um nome" que o operador nunca mudou. Não fere INV-1 (família sem size grid não entra). Adicionado `foldCor` (minúsculas, hífen/underscore/espaço colapsados, trim) antes da comparação; teste que antes provava "grafia divergente CONTA como rename" invertido para "NÃO conta", mais um caso novo provando que rename de verdade (`Azul`×`Azul Marinho`) continua bloqueado, e um caso de UPDATE completo (não só `somenteEstoque`) com a mesma grafia divergente saindo `ok: true`. | Fase 5 (Task 22, `motivoRenameBloqueado` + Step 5.1) |

---

## Global Constraints

Estas regras valem para **toda** tarefa deste plano. O implementador de qualquer tarefa as tem como requisito implícito.

- **Invariante inegociável (INV-1):** organização com `tipos_produto_habilitados = '{}'` (todas as orgs em produção hoje) tem comportamento **byte a byte idêntico** ao de antes desta entrega, em UI, edge, payload de publicação e payload de UPDATE. Toda lógica nova é condicional. Não existe "default razoável" — ausência de tipo é ausência de feature.
- **Migrations (ADR-0043):** só `supabase migration new <nome>` + `supabase db push`, validando com `npm run db:check`. Nunca `apply_migration`, nunca painel, nunca editar migration antiga. Em worktree novo, `supabase link --project-ref txvncrgkoynoxwopfkbp` **antes** do primeiro `db push` — worktree nunca vem linkado.
- **RLS:** toda coluna nova entra em tabela que já tem RLS por `org_id`; nenhuma policy nova é criada nem afrouxada nesta entrega. Se alguma tarefa parecer exigir policy nova, pare e escale.
- **Deploy obrigatório:** qualquer diff que toque `supabase/functions/**` (inclusive `_shared/`) exige `supabase functions deploy <funcoes>` antes de considerar a entrega concluída. O CI do GitHub Actions **não** faz deploy. Mudança em `_shared/` → redeployar **todas** as funções que importam o arquivo alterado.
- **Roteamento de modelos:** cada Fase declara o `model:` dos subagents de execução. `opus` é obrigatório em migration, RLS, e qualquer código que monte payload de publicação/UPDATE no marketplace (regra financeira/marketplace do `CLAUDE.md`). `sonnet` no resto. Nunca rebaixar.
- **Valores canônicos:** tipos de produto = `'roupa' | 'calcado'` (sem acento, sem cedilha no id; o rótulo exibido é "Calçado"). Gênero = `'masculino' | 'feminino' | 'unissex'`. Tamanho de roupa = `'P' | 'M' | 'G' | 'GG' | 'Tamanho Único'`.
- **Escopo fechado (v1):** cadastro manual → Revisão → publicação, com Cor + Tamanho/Numeração. **Fora do escopo:** planilha (`ingest-lote`), Kit vinculado, Kit Virtual, Catálogo (matching por GTIN) e Pulse. Nenhum deles ganha tamanho e nenhum deles pode quebrar.
- **Nada de payload chutado:** nenhuma tarefa da Fase 4 ou 5 pode conter um corpo JSON de `/catalog/charts` que não tenha sido copiado do documento de spike da Fase 0. Se o spike não confirmou, a tarefa não executa.
- **Testes:** TDD obrigatório (RED → GREEN → commit). `pnpm test <caminho>` roda um arquivo. Portão de pré-push é `pnpm preflight:static` (~27s) ou `pnpm preflight` (~3min37) — nunca remontar o checklist à mão.
- **Commits:** frequentes, um por tarefa, em português, prefixo convencional (`feat:`, `fix:`, `docs:`, `test:`). Trabalho sai nesta branch/worktree — nunca na `main`.

---

## File Structure

Arquivos que este plano cria ou modifica, com a responsabilidade de cada um.

**Configuração por org (Fase 1)**
- `supabase/migrations/<ts>_tipos_produto_por_org.sql` — cria `organizations.tipos_produto_habilitados` + RPC `tipos_produto_da_org()`.
- `supabase/functions/_shared/produto/tipos-produto-valores.ts` — **novo. FONTE ÚNICA** dos valores canônicos (`TIPOS_PRODUTO_VALIDOS`, `TAMANHOS_ROUPA`, `NUMERACOES_CALCADO`). Módulo folha, **sem nenhum import** — por isso o Vite consegue importá-lo do `src/` (mesmo truque de `src/lib/custos.ts` → `_shared/platform-admin/sales-costs.ts`). Ninguém redigita essas listas (R7).
- `src/lib/tipos-produto.ts` — **novo.** Registry do frontend: **importa** os ids da fonte única e acrescenta só rótulo/descrição de UI.
- `supabase/functions/_shared/produto/tipo-produto.ts` — **novo.** Gate de backend: `tiposProdutoDaOrg`, `temTipoProduto`. **Importa** a whitelist da fonte única. Espelha `_shared/produto/modulo.ts`.
- `src/hooks/useTiposProdutoHabilitados.ts` — **novo.** Hook de leitura, espelha `useModulosHabilitados.ts`.
- `supabase/functions/usuarios/index.ts` — ganha a action `set_tipos_produto_org`.
- `src/components/platform-admin/org-settings.tsx` — ganha o card "Tipo de produto", **separado** do card "Módulos".

**Dado de produto (Fase 2)**
- `supabase/migrations/<ts>_genero_e_tamanho_variacao.sql` — `familias.genero`, `variacoes.tamanho`.
- `src/lib/database.types.ts` — regerado.

**Cadastro manual (Fase 3)**
- `src/lib/tamanhos.ts` — **novo.** **Reexporta** `TAMANHOS_ROUPA`/`NUMERACOES_CALCADO` da fonte única e acrescenta o que é só de UI: `opcoesDeTamanho` + `gerarCombinacoes` (produto cartesiano cor × tamanho).
- `src/components/estoque/gerador-variacoes.tsx` — **novo.** Bloco de UI: lista de cores, multi-select de tamanhos, botão "Gerar variações".
- `src/components/estoque/linha-variacao-form.tsx` — campo Tamanho por linha.
- `src/components/estoque/dialog-cadastro-produto.tsx` — campo Gênero (**obrigatório quando alguma linha tem tamanho**) + integração do gerador.
- `src/lib/produto-entrada.ts` e `supabase/functions/_shared/produto/validar.ts` — contrato de entrada ganha `genero` e `tamanho`, e `validarProdutoNovo` passa a **exigir gênero quando há tamanho** (R3).
- `supabase/functions/cadastrar-produto/processar.ts` — `variacoesDivergem` passa a comparar `tamanho`; `entradaTamanhoEfetiva` + `validarTamanhosDaEntrada` (valor fora da lista do tipo da org = 400, R7).
- `supabase/functions/adicionar-variacoes-familia/index.ts` e `processar.ts` — recusa (400) adicionar variação a família que já tem tamanho (fora do escopo v1) e `montarVariacaoNova` ganha `tamanho: null` para o conjunto de chaves continuar igual ao de `clonarVariacao` (R4).

**Guia de tamanhos (Fase 4 — bloqueada pelo spike)**
- `docs/spikes/051-guia-tamanhos-ml-api.md` — **novo, escrito na Fase 0.**
- `supabase/migrations/<ts>_size_chart_vinculo.sql` — colunas de vínculo da tabela de medidas.
- `supabase/functions/_shared/ml/size-chart.ts` — **novo.** CRUD das tabelas via API ML.

**Publicação (Fase 5)**
- `supabase/functions/_shared/canais/contrato.ts` — `VariacaoCanonica`/`AnuncioCanonico` ganham os campos. `AtualizacaoCanonica.existentes` **não** muda: o sinal de "esta família tem tamanho" vem do ML, não do banco (R2b).
- `supabase/functions/_shared/anuncios/montar-canonico.ts`, `publicar-anuncio/processar.ts`, `update-familia-ml/processar.ts`, `publicar-split-ml/index.ts` — os cinco sítios de construção do canônico (`publish-familia-ml` não é um sexto: ele **chama** `montarAnuncioCanonico`).
- `supabase/functions/_shared/ml/publicar.ts` — `attribute_combinations` com COLOR + SIZE_GRID.
- `supabase/functions/_shared/ml/atualizar.ts` — cor nova com tamanho; variação existente **nunca** recebe atributo novo.
- `supabase/functions/_shared/ml/atualizar-item.ts` — **R2b.** `buscarItemML` passa a marcar `temSizeGrid` em cada variação lida do ML (`SIZE_GRID_ROW_ID` nas `attribute_combinations`), via o helper novo `temSizeGridNaVariacaoML`. É a **única** fonte confiável de "este anúncio tem eixo de tamanho" no UPDATE.
- `supabase/functions/_shared/canais/mercado-livre.ts` — em anúncio publicado **com** `SIZE_GRID_ROW_ID` (lido do ML), o rename de cor **não é montado** e a tentativa de rename falha LOUD (fora do escopo v1, R2b); e variação nova sem `sizeGridRowId` nessa família falha LOUD antes de virar payload (R2c).
- `supabase/functions/_shared/ml/resolver-size-chart.ts` — **novo.** Resolução idempotente da tabela (reserva a linha local ANTES de chamar a API, nunca cria duas).
- `supabase/functions/_shared/ml/size-chart-wiring.ts` — **novo.** Miolo puro que liga o resolvedor aos **workers do ML**: `publish-familia-ml` (CREATE) e `update-familia-ml` (cor nova). Mora em `_shared/` porque **dois** workers o consomem — e **não** em `publicar-anuncio`, que atende canais ≠ ML (R1).

**Regressão (Fase 6)**
- `supabase/functions/_shared/ml/__tests__/publicar-sem-tamanho.test.ts` — **novo.** Prova INV-1 no payload.
- `supabase/functions/criar-kit-vinculado/__tests__/kit-multivariacao.test.ts` — **novo.** Prova que kit continua recusando base multi-variação.

---

# Fase 0 — Pesquisa técnica, spike e ADRs

**model: opus** (decisão de schema + contrato de marketplace; nunca rebaixar).

**Por que esta fase existe:** o guia de tamanhos do ML é pré-requisito **obrigatório** para publicar em vestuário e calçado, e a documentação oficial (`developers.mercadolivre.com.br`, `global-selling.mercadolibre.com`) **recusa acesso automatizado**. Medido em 2026-09-18: as 6 URLs oficiais do assunto, mais 4 variantes, devolveram **HTTP 403** no fetch. O que existe hoje são resumos de busca, contraditórios entre si e com IDs de atributo suspeitos. Escrever código de payload a partir disso seria inventar dado de marketplace — proibido pelo `CLAUDE.md`.

### Task 1: Spike do guia de tamanhos do ML (documento, sem código)

**Files:**
- Create: `docs/spikes/051-guia-tamanhos-ml-api.md`
- Test: nenhum (tarefa de pesquisa; o artefato é o documento e a evidência bruta)

**Interfaces:**
- Consumes: nada.
- Produces: o documento `docs/spikes/051-guia-tamanhos-ml-api.md`, que é **pré-requisito bloqueante** das Fases 4 e 5. Toda constante de payload usada lá é copiada literalmente deste arquivo.

- [ ] **Step 1: Confirmar que 051 é o próximo número livre**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/roupas-sapatos-grilling"
/usr/bin/git fetch origin
ls docs/spikes/ | sort | tail -5
```

Esperado: o maior número em disco é `050-a-formula-da-joompulse-reconstruida.md`. Se `git fetch` trouxer um `051-*` de outra branch, use `052` e siga — quem já está na `main` não renumera (regra do projeto sobre numeração paralela).

- [ ] **Step 2: Levantar a categoria real do produto-alvo e descobrir o ramo de publicação**

Esta é a **pergunta nº 1 do spike**, acima do payload: a categoria de camisa/calça/calçado da org publica como **Legacy `variations[]`** ou como **User Products / item plano**? Ela decide todo o resto:

- Se for item plano, `montarPayloadItem` **lança** com mais de uma variação (`supabase/functions/_shared/ml/publicar.ts:148-154`) e `mercado-livre.ts:110` recusa antes da rede com `formatoIncompativel`. Um cartesiano cor × tamanho é sempre `> 1` variação — ou seja, a feature não publica de jeito nenhum sem redesenho.
- Se for Legacy, o ramo `variations[]` é o único ponto a mudar e o UPDATE importa.

Com o token da conexão ML da organização (leitura apenas — **nunca** escrever em anúncio real), rode:

```bash
# 1. Descobrir a categoria de uma camisa/calça/calçado a publicar
curl -s -H "Authorization: Bearer $ML_TOKEN" \
  "https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=camisa%20polo%20masculina" | head -c 2000

# 2. Ler o schema de atributos da categoria retornada (procurar SIZE_GRID_ID, SIZE, GENDER)
curl -s -H "Authorization: Bearer $ML_TOKEN" \
  "https://api.mercadolibre.com/categories/MLB<ID>/attributes" \
  | python3 -c "import json,sys; [print(a['id'], '|', a.get('value_type'), '|', [t for t,v in (a.get('tags') or {}).items() if v]) for a in json.load(sys.stdin)]"
```

- [ ] **Step 3: Validar o payload sem criar anúncio**

`POST /items/validate` valida um corpo completo **sem criar nada**. Ler o campo `type` da resposta, **não** o status 400 (regra já aprendida no projeto sobre GTIN de pack).

```bash
curl -s -X POST -H "Authorization: Bearer $ML_TOKEN" -H "Content-Type: application/json" \
  -d @/tmp/payload-teste.json \
  "https://api.mercadolibre.com/items/validate" | python3 -m json.tool
```

Fazer no mínimo três rodadas: (a) item com `variations[]` só com COLOR — esperado: erro citando `SIZE_GRID_ID`; (b) item com COLOR + SIZE como texto solto — confirma se o ML recusa `SIZE` livre no domínio; (c) item com COLOR + `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` de uma chart criada no passo 4.

- [ ] **Step 4: Ler e criar uma tabela de medidas de teste**

```bash
# Tabelas que a conta já tem (confirma o endpoint de listagem e a forma da resposta)
curl -s -H "Authorization: Bearer $ML_TOKEN" \
  "https://api.mercadolibre.com/catalog/charts/search?site_id=MLB&domain_id=<DOMINIO>" | python3 -m json.tool

# Estrutura exigida para o domínio (quais colunas, quais required, qual é main_attribute_candidate)
curl -s -H "Authorization: Bearer $ML_TOKEN" \
  "https://api.mercadolibre.com/catalog/charts/domains/<DOMINIO>/attributes" | python3 -m json.tool
```

Se algum path acima devolver 404, **isso é achado do spike** — registre o path testado e a resposta, e procure o correto a partir da resposta de erro do `/items/validate`, que costuma citar o recurso esperado. Não invente path.

- [ ] **Step 5: Escrever o documento do spike**

Siga o formato de `docs/spikes/036-kits-virtuais-mercado-livre.md`: título `# Spike 051 — …`, linha `**Status:** spike (pesquisa, não implementação)`, `**Data:**`, `**Relacionado:**` com links relativos para os ADRs, e depois seções numeradas. Seções obrigatórias:

1. **Gatilho** — por que o spike existe (403 na doc oficial, medido em 2026-09-18; lista das 10 URLs bloqueadas).
2. **Ramo de publicação da categoria-alvo** — Legacy `variations[]` ou User Products/item plano, com a resposta crua de `/categories/{id}/attributes` que prova.
3. **Contrato de `POST /catalog/charts`** — corpo JSON **literal** que o ML aceitou, com a resposta.
4. **Referência no item** — onde entram `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID`: em `attributes` do item raiz, em `attribute_combinations` da variação, ou nos dois. Com o payload que `/items/validate` aprovou.
5. **Gênero** — id do atributo e `value_id` de masculino/feminino/unissex, lidos de `/categories/{id}/attributes`, não de resumo de busca.
6. **Domínios** — quais exigem chart; se DRESSES é domínio próprio; se FOOTWEAR exige.
7. **Colunas por domínio** — required vs opcional, e qual é o `main_attribute_candidate`.
8. **Update e ciclo de vida** — chart existente é editável? linhas são imutáveis? o que acontece com anúncio vinculado?
9. **Restrições** — chart pertence à conta que criou (não compartilhável entre orgs), rate limits observados.
10. **Numeração de calçado** — a lista real de valores que a categoria aceita, para calibrar `NUMERACOES_CALCADO` da Fase 3.
11. **O que ficou sem resposta** — explicitamente, para não virar suposição depois.

Cada afirmação leva `CONFIRMADO` (com o comando + trecho da resposta) ou `NÃO CONFIRMADO`. Nada entra sem rótulo.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add docs/spikes/051-guia-tamanhos-ml-api.md
/usr/bin/git commit -m "docs(spike): contrato real da API de guia de tamanhos do ML (051)"
```

---

### Task 2: ADR do tipo de produto por organização

**Files:**
- Create: `docs/decisions/0166-tipo-de-produto-por-organizacao.md`
- Modify: `docs/decisions/README.md` (entrada no índice)

**Interfaces:**
- Consumes: nada.
- Produces: o número de ADR que as Fases 1-3 citam nos comentários de código e nas mensagens de commit.

- [ ] **Step 1: Escolher o número livre**

```bash
/usr/bin/git fetch origin
ls docs/decisions/ | sort | tail -3
```

Esperado: `0164-implantacao-sobrevive-a-renegociacao.md` é o último. Use `0166`. Se `git fetch` revelou um `0166` em outra branch, use o próximo livre e ajuste todas as citações deste plano de uma vez.

- [ ] **Step 2: Escrever o ADR**

Formato exato de `docs/decisions/0164-implantacao-sobrevive-a-renegociacao.md`: `# ADR-0166 — <título>`, depois `**Status:** Aceito`, `**Decisor:** Diego, 2026-09-18`, `**Relacionado:**` com links, e as seções `## Contexto`, `## Decisão`, `## Consequências`.

Conteúdo mínimo que o ADR precisa registrar:

- **Contexto:** o modelo de variação do PubliAI é cor (ADR-0004, ADR-0115). Roupa e calçado variam por cor **e** tamanho. A org piloto vende os dois — roupa e sapato — então a classificação não pode ser exclusiva.
- **Decisão 1:** `organizations.tipos_produto_habilitados text[]`, valores `'roupa'`/`'calcado'`, **combináveis**. Não é enum.
- **Decisão 2:** é **coluna separada** de `modulos_habilitados`, e **área separada** na UI. Justificativa registrada: módulo é acesso pago a uma tela inteira (Estoque/Pulse/Fiscal, ADR-0047); tipo de produto muda a **estrutura do cadastro** e não é cobrado. Misturar os dois faria o super-admin ligar um "módulo" que não gera fatura e aparecer na régua de cobrança do ADR-0155.
- **Decisão 3 (a mais importante):** lista vazia é o estado de toda org hoje e **tem que continuar significando "nada muda"**. Toda leitura do campo é condicional; não há default.
- **Decisão 4:** origem do dado é **só cadastro manual** (ADR-0094). Planilha fica registrada como feature futura, com o motivo: a org piloto não tem ERP e não opera por planilha; construir agora seria especulação.
- **Consequências:** `variacoes.tamanho` passa a existir para toda org, sempre `null` fora dos tipos habilitados; `resolverEixoVariacao` (ADR-0115) continua intocado porque o eixo por sufixo não é alcançado quando há tamanho explícito.

- [ ] **Step 3: Indexar**

Abra `docs/decisions/README.md`, localize a última linha da tabela/lista de ADRs e acrescente a entrada de 0166 no mesmo formato das vizinhas (não invente formato — copie o da linha do 0164).

- [ ] **Step 4: Verificar os links do doc**

Run: `pnpm docs:links`
Expected: PASS, sem link quebrado.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add docs/decisions/0166-tipo-de-produto-por-organizacao.md docs/decisions/README.md
/usr/bin/git commit -m "docs(adr): ADR-0166 tipo de produto por organizacao (roupa/calcado combinaveis)"
```

---

### Task 3: ADR do guia de tamanhos gerenciado via API

**Files:**
- Create: `docs/decisions/0167-guia-de-tamanhos-gerenciado-via-api.md`
- Modify: `docs/decisions/README.md`

**Interfaces:**
- Consumes: `docs/spikes/051-guia-tamanhos-ml-api.md` (Task 1) — **este ADR não pode ser escrito antes do spike**: a forma final (uma tabela por org × gênero × domínio? por família?) depende do que a API aceita.
- Produces: o número de ADR que a Fase 4 cita.

- [ ] **Step 1: Confirmar que o spike está escrito e tem as seções 3, 4 e 8 com `CONFIRMADO`**

```bash
grep -n "CONFIRMADO" docs/spikes/051-guia-tamanhos-ml-api.md | head -20
```

Se as seções 3 (payload de `POST /catalog/charts`), 4 (referência no item) ou 8 (update) estiverem `NÃO CONFIRMADO`, **pare**: o ADR não tem base e a Fase 4 continua bloqueada. Volte à Task 1.

- [ ] **Step 2: Escrever o ADR**

Mesmo formato do Task 2. Conteúdo mínimo:

- **Contexto:** copiar do spike o fato medido de que o ML exige `SIZE_GRID_ID` + `SIZE_GRID_ROW_ID` nos domínios confirmados, e que a tabela pertence à conta do vendedor.
- **Decisão 1:** o PubliAI **cria e gerencia** as tabelas via API. O operador nunca entra no Seller Central. Justificativa: o cadastro já é manual e o operador não é integrador; obrigá-lo a criar tabela no painel do ML reintroduziria um passo fora do app, que é exatamente o que o produto existe para eliminar.
- **Decisão 2:** granularidade da tabela — **decidir com o número do spike**: quantas tabelas por org (org × gênero × domínio, ou org × domínio com gênero por linha). Registrar o trade-off medido, não a preferência.
- **Decisão 3:** a tabela é por **conexão ML** (`marketplace_connections`), não global — o spike confirma que não é compartilhável. Org que troca de conta ML precisa recriar.
- **Decisão 4:** idempotência — como o PubliAI reconhece uma tabela que já criou antes de criar outra (regra inegociável de edge idempotente).
- **Consequências:** o que acontece com anúncio publicado se a tabela mudar; o que acontece se o ML recusar a criação no meio de uma publicação (falha LOUD, nunca publicar sem tabela em domínio que a exige).

- [ ] **Step 3: Indexar, verificar e commitar**

```bash
pnpm docs:links
/usr/bin/git add docs/decisions/0167-guia-de-tamanhos-gerenciado-via-api.md docs/decisions/README.md
/usr/bin/git commit -m "docs(adr): ADR-0167 guia de tamanhos do ML gerenciado via API"
```

---

### Task 4: Registrar planilha como feature futura (comentário documentado)

**Files:**
- Modify: `supabase/functions/ingest-lote/index.ts` (só um bloco de comentário no topo)

**Interfaces:**
- Consumes: ADR-0166 (Task 2).
- Produces: nada em runtime.

- [ ] **Step 1: Localizar o topo do arquivo**

Run: `head -20 supabase/functions/ingest-lote/index.ts`

- [ ] **Step 2: Inserir o comentário logo abaixo do bloco de comentários existente do topo**

```ts
// ADR-0166 — TAMANHO/NUMERAÇÃO NÃO ENTRA POR AQUI (feature futura, deliberada).
// O eixo de variação por tamanho (roupa) / numeração (calçado) é gravado APENAS pelo cadastro
// manual (`cadastrar-produto`, ADR-0094). A planilha não tem coluna TAMANHO e não deve ganhar
// uma nesta entrega: a org piloto do segmento não tem ERP nem opera por planilha, então a
// coluna seria especulação. Quando aparecer cliente de roupa/calçado que opere por planilha,
// a decisão a tomar é como uma linha de planilha expressa o par cor × tamanho (duas colunas?
// sufixo no NOME?) — e isso é decisão de produto, não de código.
// Consequência hoje: família vinda de planilha nasce com `variacoes.tamanho = null` e
// `familias.genero = null`, que é exatamente o caminho de quem não tem tipo habilitado.
```

- [ ] **Step 3: Verificar que nada de runtime mudou**

Run: `pnpm check:functions`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add supabase/functions/ingest-lote/index.ts
/usr/bin/git commit -m "docs(ingest): registra tamanho por planilha como feature futura (ADR-0166)"
```

---

> ### **Checkpoint Fable — fim da Fase 0** (BLOQUEANTE)
>
> Antes de tocar em qualquer schema, o agente revisor **Fable** (`fable-advisor`) revisa, nesta ordem:
>
> 1. `docs/spikes/051-guia-tamanhos-ml-api.md` — em especial: a resposta da pergunta nº 1 (Legacy `variations[]` vs User Products) e se cada afirmação tem rótulo `CONFIRMADO`/`NÃO CONFIRMADO` com o comando que a produziu.
> 2. `docs/decisions/0166-*.md` — a decisão de coluna separada e o invariante INV-1 estão escritos de forma que sobrevivem a quem ler só o ADR?
> 3. `docs/decisions/0167-*.md` — a granularidade da tabela foi decidida com o número do spike, ou com preferência estética?
>
> **Pergunta explícita ao Fable:** "Alguma decisão deste ADR está baseada em resumo de busca em vez de resposta real da API?"
>
> **Não prosseguir para a Fase 1 sem o parecer.** Se o Fable apontar que o ramo de publicação ficou indefinido, a Fase 4 e a Fase 5 permanecem bloqueadas, mas as Fases 1, 2, 3 e 6 podem seguir — elas não dependem do contrato do ML.

---

> ### **Checkpoint Fable — plano completo, antes da Fase 1** (BLOQUEANTE)
>
> Além do parecer sobre a Fase 0, o Fable revisa **este documento inteiro** antes da primeira linha de código de implementação. Perguntas explícitas:
>
> - A Fase 1 e a Fase 2 podem ser duas migrations separadas sem deixar o banco num estado incoerente entre elas?
> - O INV-1 está testável como está escrito na Fase 6, ou é só uma afirmação?
> - Falta alguma superfície que lê `variacoes` e quebraria com uma coluna nova (`variacoesDivergem` já está coberta — há outra)?

---

# Fase 1 — Migration de configuração + gate + UI da org

**model: opus** nas Tasks 5 e 6 (migration + gate de acesso). **model: sonnet** nas Tasks 7, 8 e 9 (registry, hook e UI).

Objetivo da fase: a org passa a ter tipos de produto habilitáveis pelo super-admin, com gate real no backend, **sem que nada mais no sistema leia esse campo ainda**. Ao fim da fase o app se comporta exatamente como hoje para qualquer org — o campo existe e é editável, e só.

### Task 5: Migration — coluna `tipos_produto_habilitados` + RPC de leitura

**Files:**
- Create: `supabase/migrations/<timestamp>_adr166_tipos_produto_por_org.sql`
- Modify: `src/lib/database.types.ts` (regerado, não editado à mão)

**Interfaces:**
- Consumes: ADR-0166 (Task 2).
- Produces: coluna `public.organizations.tipos_produto_habilitados text[] not null default '{}'` e função `public.tipos_produto_da_org() returns text[]`.

- [ ] **Step 1: Linkar o projeto (worktree novo nunca vem linkado)**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/roupas-sapatos-grilling"
supabase link --project-ref txvncrgkoynoxwopfkbp
```

Expected: `Finished supabase link.` Se pedir a senha do banco, use a que já está no gerenciador de credenciais do Diego — **nunca** colar senha em arquivo do repo.

- [ ] **Step 2: Criar o arquivo de migration**

```bash
supabase migration new adr166_tipos_produto_por_org
```

Expected: imprime o caminho do arquivo criado, no formato `supabase/migrations/2026MMDDHHMMSS_adr166_tipos_produto_por_org.sql`. **Anote esse caminho** — os passos seguintes escrevem nele.

- [ ] **Step 3: Escrever o SQL**

Conteúdo **completo** do arquivo (sem acentos nos comentários, seguindo a convenção das migrations existentes do projeto):

```sql
-- ADR-0166: tipo de produto (roupa / calcado) por organizacao.
--
-- Coluna SEPARADA de modulos_habilitados de proposito. Modulo e acesso pago a uma tela inteira
-- (Estoque/Pulse/Fiscal, ADR-0047) e entra na regua de cobranca do ADR-0155. Tipo de produto nao
-- e cobrado: ele muda a ESTRUTURA do cadastro (o SKU passa a ser cor x tamanho). Misturar os dois
-- faria o super-admin ligar um "modulo" que nao gera fatura.
--
-- INVARIANTE: lista vazia e o estado de TODA org existente hoje e significa "nada muda". Nao ha
-- default diferente de '{}' e nao ha backfill. Toda leitura no codigo e condicional.
--
-- Valores validos: 'roupa', 'calcado' (combinaveis — quem vende roupa costuma vender sapato).
-- A trava de valor fica na edge `usuarios` (whitelist, como em set_modulos_org) e nao em CHECK
-- constraint: modulos_habilitados/canais_habilitados seguem o mesmo padrao, e um CHECK sobre
-- array obrigaria migration a cada valor novo.

alter table public.organizations
  add column if not exists tipos_produto_habilitados text[] not null default '{}';

comment on column public.organizations.tipos_produto_habilitados is
  'ADR-0166: tipos de produto habilitados (roupa/calcado), combinaveis. Vazio = comportamento padrao (so cor como eixo de variacao).';

-- Leitura pelo frontend. Copia EXATA da forma de modulos_habilitados_da_org
-- (20260729124711_e6b_origem_lote_e_modulos.sql): security definer + stable + search_path vazio,
-- ancorada em current_org_id() (ADR-0027), com revoke/grant explicitos.
create or replace function public.tipos_produto_da_org()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(tipos_produto_habilitados, '{}')
  from public.organizations
  where id = public.current_org_id()
$$;

revoke all on function public.tipos_produto_da_org() from public;
grant execute on function public.tipos_produto_da_org() to authenticated;
```

- [ ] **Step 4: Aplicar e validar**

```bash
supabase db push
npm run db:check
```

Expected: `db push` aplica a migration nova (e só ela); `db:check` termina sem divergência. Atenção: `db push` **não roda em transação** — se falhar no meio, leia o erro e corrija com uma migration nova, nunca editando esta.

- [ ] **Step 5: Regerar os tipos e conferir**

```bash
supabase gen types typescript --project-id txvncrgkoynoxwopfkbp --schema public > src/lib/database.types.ts
grep -n "tipos_produto_habilitados" src/lib/database.types.ts
```

Expected: três ocorrências no bloco `organizations` (Row: `string[]`, Insert: `string[] | undefined`, Update: `string[] | undefined`), e uma entrada `tipos_produto_da_org` no bloco `Functions`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add supabase/migrations/ src/lib/database.types.ts
/usr/bin/git commit -m "feat(org): coluna tipos_produto_habilitados + RPC de leitura (ADR-0166)"
```

---

### Task 6: Fonte única de valores + gate de backend — `_shared/produto/tipo-produto.ts`

**Files:**
- Create: `supabase/functions/_shared/produto/tipos-produto-valores.ts` (**fonte única**, módulo folha sem imports)
- Create: `supabase/functions/_shared/produto/tipo-produto.ts`
- Test: `supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts`

**Interfaces:**
- Consumes: coluna `organizations.tipos_produto_habilitados` (Task 5).
- Produces:
  - de `tipos-produto-valores.ts`: `export type TipoProduto = 'roupa' | 'calcado'`; `export const TIPOS_PRODUTO_VALIDOS`; `export const TAMANHOS_ROUPA`; `export const NUMERACOES_CALCADO`; `export function tamanhosValidosParaTipos(tipos: readonly string[]): string[]`.
  - de `tipo-produto.ts`: `export async function tiposProdutoDaOrg(admin: SupabaseClient, orgId: string): Promise<TipoProduto[]>`; `export function temTipoProduto(tipos: readonly string[], tipo: TipoProduto): boolean`.

**Por que a fonte única existe (R7 da revisão do Fable):** a mesma whitelist aparecia em três lugares (`_shared/produto/tipo-produto.ts`, `usuarios/tipos-produto.ts`, `src/lib/tipos-produto.ts`) e as listas de tamanho só existiam no frontend, onde o backend não as alcança para validar. Uma lista redigitada é uma lista que diverge. Este arquivo **não importa nada** — por isso o Vite consegue importá-lo do `src/`, exatamente como `src/lib/custos.ts` já importa `_shared/platform-admin/sales-costs.ts`. Não acrescente `import` nenhum aqui (nem `import type` de `jsr:`), senão o build do frontend quebra.

- [ ] **Step 0: Criar a fonte única de valores**

Crie `supabase/functions/_shared/produto/tipos-produto-valores.ts`:

```ts
// ADR-0166: FONTE ÚNICA dos valores canônicos de tipo de produto e de tamanho/numeração.
//
// ATENÇÃO: este arquivo NÃO pode ganhar nenhum import — nem `import type` de `jsr:`. Ele é
// importado tanto pelo Deno (edges) quanto pelo Vite (`src/lib/tipos-produto.ts`,
// `src/lib/tamanhos.ts`), e o Vite não resolve especificador `jsr:`. Mesmo contrato de
// `_shared/platform-admin/sales-costs.ts`, que `src/lib/custos.ts` já importa.
//
// Antes desta consolidação a whitelist estava redigitada em três arquivos e as listas de
// tamanho só existiam no frontend — o que deixava a edge sem como validar o valor recebido.

export type TipoProduto = 'roupa' | 'calcado';

/** Ordem canônica: toda saída saneada respeita esta ordem, não a do payload. */
export const TIPOS_PRODUTO_VALIDOS = ['roupa', 'calcado'] as const;

/** Conjunto fechado decidido no grilling de 2026-09-18. */
export const TAMANHOS_ROUPA = ['P', 'M', 'G', 'GG', 'Tamanho Único'] as const;

/** Numeração adulta brasileira + os pares de meio-número que o ML usa. A seção 10 do spike 051
 *  confirma a lista contra a categoria real; ajustar é editar UMA linha, aqui. */
export const NUMERACOES_CALCADO = [
  '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46',
  '33/34', '35/36', '37/38', '39/40', '41/42', '43/44', '45/46',
] as const;

/** Todos os valores de tamanho aceitáveis para uma org, dados os tipos habilitados.
 *  Org sem tipo → lista vazia → nenhum tamanho é aceitável (INV-1). */
export function tamanhosValidosParaTipos(tipos: readonly string[]): string[] {
  const valores: string[] = [];
  if (tipos.includes('roupa')) valores.push(...TAMANHOS_ROUPA);
  if (tipos.includes('calcado')) valores.push(...NUMERACOES_CALCADO);
  return valores;
}
```

- [ ] **Step 1: Escrever o teste que falha**

Crie `supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { temTipoProduto, tiposProdutoDaOrg } from '../tipo-produto.ts';

/** Stub mínimo do supabase-js: só o caminho from().select().eq().maybeSingle(). */
function fakeAdmin(resposta: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve(resposta) }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('temTipoProduto', () => {
  it('org sem nenhum tipo nao tem roupa nem calcado', () => {
    expect(temTipoProduto([], 'roupa')).toBe(false);
    expect(temTipoProduto([], 'calcado')).toBe(false);
  });

  it('tipos sao combinaveis, nao exclusivos', () => {
    expect(temTipoProduto(['roupa', 'calcado'], 'roupa')).toBe(true);
    expect(temTipoProduto(['roupa', 'calcado'], 'calcado')).toBe(true);
  });

  it('ignora valor desconhecido gravado no array', () => {
    expect(temTipoProduto(['brinquedo'], 'roupa')).toBe(false);
  });
});

describe('tiposProdutoDaOrg', () => {
  it('devolve os tipos gravados', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: ['roupa'] }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual(['roupa']);
  });

  it('coluna nula vira lista vazia', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: null }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual([]);
  });

  it('filtra valor invalido gravado no banco', async () => {
    const admin = fakeAdmin({ data: { tipos_produto_habilitados: ['roupa', 'xpto'] }, error: null });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).resolves.toEqual(['roupa']);
  });

  // Falha de leitura NAO pode virar [] em silencio: [] significa "org padrao" e mandaria o
  // cadastro seguir sem tamanho, gravando produto errado. Lanca para o QStash retentar.
  it('erro de leitura LANCA em vez de devolver lista vazia', async () => {
    const admin = fakeAdmin({ data: null, error: { message: 'timeout' } });
    await expect(tiposProdutoDaOrg(admin, 'org-1')).rejects.toThrow(/tipos_produto_da_org|timeout/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts`
Expected: FAIL — `Failed to resolve import "../tipo-produto.ts"`.

- [ ] **Step 3: Escrever a implementação**

Crie `supabase/functions/_shared/produto/tipo-produto.ts`:

```ts
// ADR-0166: tipo de produto (roupa/calcado) por organizacao. Espelha a forma de
// `_shared/produto/modulo.ts`, mas NAO e modulo: modulo libera tela paga (ADR-0047), tipo de
// produto muda a estrutura do cadastro (o SKU passa a ser cor x tamanho).
//
// INVARIANTE (INV-1): lista vazia = comportamento padrao do sistema inteiro. Todo chamador
// trata `[]` como "nada muda". Nao existe default.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
// R7: a whitelist vive num lugar só (`tipos-produto-valores.ts`). Reexportada aqui por
// conveniencia dos chamadores Deno — nunca redigitada.
import { TIPOS_PRODUTO_VALIDOS, type TipoProduto } from './tipos-produto-valores.ts';

export { TIPOS_PRODUTO_VALIDOS };
export type { TipoProduto };

export function temTipoProduto(tipos: readonly string[], tipo: TipoProduto): boolean {
  return tipos.includes(tipo);
}

// Diferente de `exigirModulo` (que fecha o gate em erro de leitura, porque menos acesso e o lado
// seguro), aqui `false`/`[]` NAO e o lado seguro: uma falha transitoria de banco viraria "org
// padrao" e o cadastro gravaria um produto de roupa SEM tamanho, em silencio. Por isso lanca —
// quem chama deixa o throw propagar como falha transitoria (sem `.status`, o QStash retenta).
// Mesma logica de `moduloHabilitadoStrict`.
export async function tiposProdutoDaOrg(
  admin: SupabaseClient, orgId: string,
): Promise<TipoProduto[]> {
  const { data, error } = await admin.from('organizations')
    .select('tipos_produto_habilitados').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`tiposProdutoDaOrg: organizations: ${error.message}`);
  const brutos = (data?.tipos_produto_habilitados ?? []) as string[];
  // Filtra valor desconhecido: um valor gravado por engano nunca deve ligar um caminho novo.
  return TIPOS_PRODUTO_VALIDOS.filter((t) => brutos.includes(t));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/produto/tipo-produto.ts supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts
/usr/bin/git commit -m "feat(produto): gate de tipo de produto por org (ADR-0166)"
```

---

### Task 7: Registry do frontend — `src/lib/tipos-produto.ts`

**Files:**
- Create: `src/lib/tipos-produto.ts`
- Test: `src/lib/__tests__/tipos-produto.test.ts`

**Interfaces:**
- Consumes: `TIPOS_PRODUTO_VALIDOS` e `TipoProduto` de `supabase/functions/_shared/produto/tipos-produto-valores.ts` (Task 6, Step 0) — **import de verdade**, não cópia. O arquivo é folha e sem imports, então o Vite o resolve (precedente: `src/lib/custos.ts`).
- Produces: `export type TipoProdutoId = TipoProduto`; `export interface TipoProdutoUI { id: TipoProdutoId; nome: string; descricao: string }`; `export const TIPOS_PRODUTO: TipoProdutoUI[]`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/lib/__tests__/tipos-produto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TIPOS_PRODUTO } from '@/lib/tipos-produto';

describe('TIPOS_PRODUTO', () => {
  it('tem exatamente roupa e calcado, nesta ordem', () => {
    expect(TIPOS_PRODUTO.map((t) => t.id)).toEqual(['roupa', 'calcado']);
  });

  it('o id de calcado nao tem cedilha (vai para o banco), mas o rotulo tem', () => {
    const calcado = TIPOS_PRODUTO.find((t) => t.id === 'calcado')!;
    expect(calcado.id).toBe('calcado');
    expect(calcado.nome).toBe('Calçado');
  });

  it('todo tipo tem descricao nao vazia (a tela explica o que o checkbox faz)', () => {
    for (const t of TIPOS_PRODUTO) expect(t.descricao.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test src/lib/__tests__/tipos-produto.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tipos-produto"`.

- [ ] **Step 3: Escrever a implementação**

Crie `src/lib/tipos-produto.ts`:

```ts
// ADR-0166: tipo de produto habilitado por organizacao (roupa / calcado), COMBINAVEL.
// Espelha o formato de src/lib/modulos.ts, mas e um conceito separado e por isso vive em arquivo
// e em card proprios: modulo e funcionalidade PAGA que liga uma tela (ADR-0047 / ADR-0155);
// tipo de produto nao e cobrado e muda a ESTRUTURA do cadastro (o SKU vira cor x tamanho).
//
// R7 da revisao do Fable: os IDS NAO SAO REDIGITADOS aqui — vem da fonte unica
// `supabase/functions/_shared/produto/tipos-produto-valores.ts` (modulo folha sem imports, que o
// Vite resolve; mesmo precedente de src/lib/custos.ts). Este arquivo so acrescenta rotulo e
// descricao, que sao de UI e nao existem no backend.
//
// INVARIANTE: org sem nenhum tipo marcado opera exatamente como hoje (so Cor como eixo).
import {
  TIPOS_PRODUTO_VALIDOS, type TipoProduto,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';

export type TipoProdutoId = TipoProduto;

export interface TipoProdutoUI {
  id: TipoProdutoId;
  nome: string;
  descricao: string;
}

// Um rotulo por id da fonte unica. Se alguem acrescentar um tipo la e esquecer aqui, o
// TypeScript acusa (Record com chave exaustiva), em vez de a tela simplesmente nao mostrar.
const ROTULOS: Record<TipoProdutoId, Omit<TipoProdutoUI, 'id'>> = {
  roupa: {
    nome: 'Roupa',
    descricao: 'O cadastro ganha Tamanho (P, M, G, GG, Tamanho Único) como segundo eixo, além da cor.',
  },
  calcado: {
    nome: 'Calçado',
    descricao: 'O cadastro ganha Numeração como segundo eixo, além da cor.',
  },
};

export const TIPOS_PRODUTO: TipoProdutoUI[] = TIPOS_PRODUTO_VALIDOS.map(
  (id) => ({ id, ...ROTULOS[id] }),
);
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test src/lib/__tests__/tipos-produto.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/tipos-produto.ts src/lib/__tests__/tipos-produto.test.ts
/usr/bin/git commit -m "feat(org): registry de tipos de produto no frontend (ADR-0166)"
```

---

### Task 8: Action `set_tipos_produto_org` na edge `usuarios`

**Files:**
- Modify: `supabase/functions/usuarios/index.ts` (linha 31 — lista `platformAction`; linha 128 — `select` de `list_orgs`; linha 135 — mapeamento da resposta; novo `case` depois do bloco `set_modulos_org`)
- Test: `supabase/functions/usuarios/__tests__/tipos-produto-org.test.ts`

**Interfaces:**
- Consumes: coluna de Task 5; `TipoProdutoId` de Task 7 (como referência de valores, não como import).
- Produces: a action `set_tipos_produto_org` (body: `{ action, org_id, tipos: string[] }`) e o campo `tipos_produto_habilitados` na resposta de `list_orgs`.

- [ ] **Step 1: Escrever o teste que falha**

O handler inteiro não é testável isoladamente (mesma limitação já documentada em `cadastrar-produto`), então extraímos e testamos a **regra de saneamento**, que é o que pode errar em silêncio. Crie `supabase/functions/usuarios/__tests__/tipos-produto-org.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sanearTiposProduto } from '../tipos-produto.ts';

describe('sanearTiposProduto', () => {
  it('lista vazia e estado valido — nao ha tipo obrigatorio', () => {
    expect(sanearTiposProduto([])).toEqual([]);
  });

  it('aceita os dois juntos (combinavel, nao exclusivo)', () => {
    expect(sanearTiposProduto(['roupa', 'calcado'])).toEqual(['roupa', 'calcado']);
  });

  it('descarta valor fora da whitelist', () => {
    expect(sanearTiposProduto(['roupa', 'movel', 'calcado'])).toEqual(['roupa', 'calcado']);
  });

  it('deduplica', () => {
    expect(sanearTiposProduto(['roupa', 'roupa'])).toEqual(['roupa']);
  });

  it('corpo que nao e array vira lista vazia, nunca lanca', () => {
    expect(sanearTiposProduto(undefined)).toEqual([]);
    expect(sanearTiposProduto('roupa')).toEqual([]);
    expect(sanearTiposProduto(null)).toEqual([]);
  });

  it('ordem de saida e sempre a canonica, nao a do payload', () => {
    expect(sanearTiposProduto(['calcado', 'roupa'])).toEqual(['roupa', 'calcado']);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/usuarios/__tests__/tipos-produto-org.test.ts`
Expected: FAIL — `Failed to resolve import "../tipos-produto.ts"`.

- [ ] **Step 3: Criar o miolo testável**

Crie `supabase/functions/usuarios/tipos-produto.ts`:

```ts
// ADR-0166: saneamento do payload de `set_tipos_produto_org`. Extraido do handler porque o
// handler inteiro nao e testavel (mesma limitacao ja documentada em cadastrar-produto/processar.ts).
//
// R7 da revisao do Fable: a whitelist NAO e redigitada aqui — vem da fonte unica. Uma lista
// copiada em tres arquivos e uma lista que diverge no primeiro valor novo.
import { TIPOS_PRODUTO_VALIDOS } from '../_shared/produto/tipos-produto-valores.ts';

/** Saida SEMPRE na ordem canonica de TIPOS_PRODUTO_VALIDOS, nao na ordem do payload: assim duas
 *  gravacoes equivalentes produzem o mesmo array e um diff de auditoria nao acusa mudanca falsa.
 *  Diferente de set_canais_org, NAO ha valor obrigatorio: lista vazia e o default de toda org. */
export function sanearTiposProduto(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const pedidos = new Set(bruto.filter((t): t is string => typeof t === 'string'));
  return TIPOS_PRODUTO_VALIDOS.filter((t) => pedidos.has(t));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/usuarios/__tests__/tipos-produto-org.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Ligar a action no handler**

Em `supabase/functions/usuarios/index.ts`:

(a) No topo, junto dos outros imports locais, acrescente:

```ts
import { sanearTiposProduto } from './tipos-produto.ts';
```

(b) Linha 31 — acrescente a action à lista de ações de plataforma:

```ts
  const platformAction = ['list_orgs', 'create_org', 'set_canais_org', 'set_modulos_org', 'set_tipos_produto_org', 'set_tipo_pessoa_org', 'delete_org'].includes(action);
```

(c) Linha 128 — acrescente a coluna ao `select` de `list_orgs`:

```ts
        db.from('organizations').select('id, nome, slug, criado_em, canais_habilitados, modulos_habilitados, tipos_produto_habilitados, is_test, tipo_pessoa').order('criado_em'),
```

(d) Linha 135 — acrescente o campo ao objeto de resposta, logo após `modulos_habilitados`:

```ts
          canais_habilitados: o.canais_habilitados, modulos_habilitados: o.modulos_habilitados ?? [],
          tipos_produto_habilitados: o.tipos_produto_habilitados ?? [],
```

(e) Logo **depois** do `case 'set_modulos_org': { … }` inteiro, insira o novo case. Ele espelha `set_modulos_org` na íntegra: gate de super-admin, whitelist e a **tripla de auditoria** (intent / success|failure) — sem a tripla, uma mudança de configuração de org ficaria fora da trilha do ADR-0155.

```ts
    case 'set_tipos_produto_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // ADR-0166. Diferente de set_canais_org: NAO ha tipo obrigatorio — lista vazia e o estado
      // padrao de toda org e significa "so cor como eixo de variacao", o comportamento de hoje.
      const tipos = sanearTiposProduto(body.tipos);
      const intentAuditError = await auditPlatformAction(alvo, action, 'intent', { tipos });
      if (intentAuditError) return auditWriteError('intent', intentAuditError);
      const { error } = await db.from('organizations')
        .update({ tipos_produto_habilitados: tipos, atualizado_em: new Date().toISOString() })
        .eq('id', alvo);
      const resultAuditError = await auditPlatformAction(alvo, action, error ? 'failure' : 'success', { tipos });
      if (resultAuditError) return auditWriteError(error ? 'failure' : 'success', resultAuditError);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
```

- [ ] **Step 6: Verificar tipos e lint da edge**

Run: `pnpm check:functions && pnpm lint:functions`
Expected: PASS nos dois.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/functions/usuarios/
/usr/bin/git commit -m "feat(usuarios): action set_tipos_produto_org com auditoria (ADR-0166)"
```

---

### Task 9: Hook de leitura + card "Tipo de produto" na tela do super-admin

**Files:**
- Create: `src/hooks/useTiposProdutoHabilitados.ts`
- Modify: `src/lib/queries.ts` (nova chave em `QK`)
- Modify: `src/components/platform-admin/org-settings.tsx` (tipo `OrgRow`, estado, efeito de carga, e um `<Card>` novo)
- Test: `src/components/platform-admin/__tests__/org-settings-tipos-produto.test.tsx`

**Interfaces:**
- Consumes: `TIPOS_PRODUTO` (Task 7), action `set_tipos_produto_org` (Task 8), RPC `tipos_produto_da_org` (Task 5).
- Produces: `useTiposProdutoHabilitados(): UseQueryResult<string[]>` — consumido pela Fase 3.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/platform-admin/__tests__/org-settings-tipos-produto.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgSettings } from '@/components/platform-admin/org-settings';
import { supabase } from '@/lib/supabase';

const ORG = {
  id: 'org-1', nome: 'Avil', slug: 'avil',
  canais_habilitados: ['mercado_livre'],
  modulos_habilitados: ['estoque'],
  tipos_produto_habilitados: [] as string[],
  tipo_pessoa: 'pj' as const,
};

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><OrgSettings orgId="org-1" /></QueryClientProvider>,
  );
}

describe('OrgSettings — card Tipo de produto (ADR-0166)', () => {
  beforeEach(() => {
    vi.spyOn(supabase.functions, 'invoke').mockImplementation(async (_fn, opts) => {
      const body = (opts as { body: Record<string, unknown> }).body;
      if (body.action === 'list_orgs') return { data: { orgs: [ORG] }, error: null } as never;
      return { data: { ok: true }, error: null } as never;
    });
  });

  it('o card Tipo de produto e SEPARADO do card Modulos', async () => {
    renderizar();
    await waitFor(() => expect(screen.getByText('Módulos')).toBeInTheDocument());
    expect(screen.getByText('Tipo de produto')).toBeInTheDocument();
    // Prova que nao virou item da lista de modulos pagos.
    expect(screen.getByRole('button', { name: 'Salvar módulos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar tipo de produto' })).toBeInTheDocument();
  });

  it('org sem tipo comeca com os dois checkboxes desmarcados', async () => {
    renderizar();
    await waitFor(() => expect(screen.getByLabelText(/Roupa/)).toBeInTheDocument());
    expect(screen.getByLabelText(/Roupa/)).not.toBeChecked();
    expect(screen.getByLabelText(/Calçado/)).not.toBeChecked();
  });

  it('marca os dois e envia set_tipos_produto_org com os dois', async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(screen.getByLabelText(/Roupa/)).toBeInTheDocument());
    await user.click(screen.getByLabelText(/Roupa/));
    await user.click(screen.getByLabelText(/Calçado/));
    await user.click(screen.getByRole('button', { name: 'Salvar tipo de produto' }));
    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith('usuarios', {
        body: { action: 'set_tipos_produto_org', org_id: 'org-1', tipos: ['roupa', 'calcado'] },
      });
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test src/components/platform-admin/__tests__/org-settings-tipos-produto.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Tipo de produto`.

- [ ] **Step 3: Acrescentar a chave de query**

Em `src/lib/queries.ts`, dentro do objeto `QK`, logo abaixo da linha de `modulosHabilitados`, acrescente:

```ts
  tiposProdutoHabilitados: ['tipos-produto-habilitados'] as const,
```

- [ ] **Step 4: Criar o hook**

Crie `src/hooks/useTiposProdutoHabilitados.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** ADR-0166: tipos de produto (roupa/calcado) habilitados para a org, ligados pelo super-admin.
 *
 *  SEM retry, igual a useModulosHabilitados: `data === undefined` significa "nao sei", NAO
 *  "a org nao tem tipo". Quem consome precisa distinguir os dois — tratar falha de rede como
 *  "org padrao" faria o cadastro esconder o campo Tamanho de uma org de roupa e gravar o produto
 *  sem o eixo, em silencio. Ver o gerador de variacoes na Fase 3. */
export function useTiposProdutoHabilitados() {
  return useQuery<string[]>({
    queryKey: QK.tiposProdutoHabilitados,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tipos_produto_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 5: Acrescentar o card em `org-settings.tsx`**

(a) No bloco de imports, junto de `MODULOS`:

```ts
import { TIPOS_PRODUTO } from '@/lib/tipos-produto';
```

(b) No tipo `OrgRow` (linha 13), acrescente o campo logo depois de `modulos_habilitados`:

```ts
  tipos_produto_habilitados: string[];
```

(c) Junto dos outros `useState` (logo abaixo de `modules`):

```ts
  const [productTypes, setProductTypes] = useState<Set<string>>(new Set());
```

(d) Dentro do `useEffect` que carrega a org (o que hoje chama `setModules`), acrescente:

```ts
    setProductTypes(new Set(org.tipos_produto_habilitados ?? []));
```

(e) Depois do `<Card>` de Módulos e **antes** do fechamento da `<div className="grid gap-4 lg:grid-cols-2">`, insira o card novo:

```tsx
      {/* ADR-0166: card SEPARADO do de Módulos de propósito. Módulo é funcionalidade paga que
          liga uma tela (ADR-0047) e entra na régua de cobrança (ADR-0155); tipo de produto não é
          cobrado e muda a estrutura do cadastro. Mesma caixinha, grupo diferente. */}
      <Card>
        <CardHeader><CardTitle>Tipo de produto</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Não é módulo pago. Define quais eixos de variação o cadastro oferece além da cor.
            Nenhum marcado = a organização cadastra só por cor, como sempre.
          </p>
          <div className="space-y-2">
            {TIPOS_PRODUTO.map((tipo) => (
              <label key={tipo.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={productTypes.has(tipo.id)}
                  onCheckedChange={(checked) => setProductTypes((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(tipo.id); else next.delete(tipo.id);
                    return next;
                  })}
                />
                <span>{tipo.nome}<span className="block text-xs text-muted-foreground">{tipo.descricao}</span></span>
              </label>
            ))}
          </div>
          {error?.key === 'productTypes' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => run(
                'productTypes',
                () => callUsuarios({
                  action: 'set_tipos_produto_org',
                  org_id: orgId,
                  // Ordem canônica (mesma de TIPOS_PRODUTO), não a ordem de clique: assim o
                  // payload é estável e a auditoria não acusa mudança falsa.
                  tipos: TIPOS_PRODUTO.filter((t) => productTypes.has(t.id)).map((t) => t.id),
                }),
                'Tipo de produto atualizado.',
              )}
              disabled={saving === 'productTypes'}
            >
              Salvar tipo de produto
            </Button>
            {cardFooter('productTypes')}
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `pnpm test src/components/platform-admin/__tests__/org-settings-tipos-produto.test.tsx`
Expected: PASS, 3 testes.

- [ ] **Step 7: Rodar a suíte inteira do frontend para provar que nada quebrou**

Run: `pnpm test src/components/platform-admin`
Expected: PASS, incluindo os testes pré-existentes de `org-settings`.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add src/hooks/useTiposProdutoHabilitados.ts src/lib/queries.ts src/components/platform-admin/
/usr/bin/git commit -m "feat(admin): card de tipo de produto separado dos modulos (ADR-0166)"
```

---

> ### **Checkpoint Fable — fim da Fase 1 (mexe em schema)** (BLOQUEANTE)
>
> O Fable revisa o diff completo da Fase 1. Perguntas explícitas:
>
> 1. A migration é puramente aditiva? `add column if not exists ... not null default '{}'` em `organizations` (3 linhas em produção) trava a tabela por quanto tempo?
> 2. `tiposProdutoDaOrg` lança em erro de leitura e `exigirModulo` devolve `false` — a divergência está justificada, ou é inconsistência?
> 3. A RPC `tipos_produto_da_org()` tem `revoke all from public` + `grant execute to authenticated`, igual à de módulos? Sem o `revoke`, a função fica exposta.
> 4. A action nova tem a tripla de auditoria completa (intent, e depois success **ou** failure)?
> 5. O card novo pode ser confundido com um módulo pago por quem olha a tela?
>
> **Não prosseguir para a Fase 2 sem o parecer.**

---

# Fase 2 — Schema de `familias` (gênero) e `variacoes` (tamanho)

**model: opus** (migration + decisão de schema).

Esta fase cria **só** as colunas que o operador preenche. As colunas de vínculo com a tabela de medidas do ML (`SIZE_GRID_ID`/`SIZE_GRID_ROW_ID`) **não** entram aqui: a forma delas depende do que o spike da Fase 0 confirmar, e uma migration chutada seguida de uma corretiva é pior do que duas migrations deliberadas. Elas nascem na Fase 4.

**Decisão de schema registrada aqui (não repetir por engano em outra tarefa):** guardamos o **valor do operador** (`'masculino'`, `'P'`, `'42'`), nunca o `value_id` do ML. O id do ML é detalhe do canal e muda por categoria; traduzir na hora de publicar é o mesmo padrão que o projeto já usa para cor (ADR-0004, onde o dicionário do ML reescreve `value_name` na publicação sem o banco saber).

### Task 10: Migration — `familias.genero` e `variacoes.tamanho`

**Files:**
- Create: `supabase/migrations/<timestamp>_adr166_genero_e_tamanho.sql`
- Modify: `src/lib/database.types.ts` (regerado)

**Interfaces:**
- Consumes: ADR-0166 (Task 2).
- Produces: `public.familias.genero text null` (CHECK em `'masculino'|'feminino'|'unissex'`) e `public.variacoes.tamanho text null`.

- [ ] **Step 1: Criar o arquivo**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/roupas-sapatos-grilling"
supabase migration new adr166_genero_e_tamanho
```

Expected: imprime o caminho do arquivo criado. Anote-o.

- [ ] **Step 2: Escrever o SQL**

Conteúdo completo do arquivo:

```sql
-- ADR-0166: genero da familia e tamanho/numeracao da variacao.
--
-- Guardamos o VALOR DO OPERADOR ('masculino', 'P', '42'), nunca o value_id do ML. O id do ML e
-- detalhe do canal, muda por categoria e e resolvido na publicacao — mesmo padrao ja usado para
-- cor (ADR-0004: o dicionario do ML reescreve value_name ao publicar e o banco nao sabe disso).
--
-- AS DUAS COLUNAS SAO NULLABLE E NASCEM NULL EM TODA LINHA EXISTENTE. Nao ha backfill e nao ha
-- default: null e o estado de quem nao tem tipo de produto habilitado (INV-1). Familia vinda de
-- planilha (ingest-lote) continua nascendo com as duas nulas — e isso e deliberado, ver o
-- comentario de feature futura no topo de supabase/functions/ingest-lote/index.ts.
--
-- Por que CHECK em genero e nao em tamanho:
--   genero tem 3 valores fechados e o ML exige que o genero do anuncio bata com o da tabela de
--   medidas — valor errado ali derruba a publicacao inteira, entao a trava fica no banco.
--   tamanho e lista de PICK do operador (P/M/G/GG/Tamanho Unico para roupa, numeracao para
--   calcado) e a lista de numeracao ainda sera calibrada contra a categoria real do ML
--   (spike 051). Um CHECK aqui obrigaria migration a cada ajuste de lista; a trava vive na UI
--   (multi-select sobre lista fixa) e na validacao da edge.

-- CHECK NOMEADO de proposito (`familias_genero_valido`): a prova do Step 4 e read-only e
-- localiza o constraint por nome em pg_constraint. Constraint anonimo obrigaria a adivinhar o
-- nome gerado pelo Postgres, ou a escrever numa tabela de producao so para "provar" a trava.
alter table public.familias
  add column if not exists genero text
  constraint familias_genero_valido
  check (genero is null or genero in ('masculino', 'feminino', 'unissex'));

comment on column public.familias.genero is
  'ADR-0166: genero da peca (masculino/feminino/unissex). NULL = nao informado (org sem tipo de produto habilitado). O ML exige que o genero do anuncio bata com o da tabela de medidas.';

alter table public.variacoes
  add column if not exists tamanho text;

comment on column public.variacoes.tamanho is
  'ADR-0166: tamanho (roupa: P/M/G/GG/Tamanho Unico) ou numeracao (calcado). NULL = variacao sem eixo de tamanho, o caso de toda org sem tipo de produto habilitado. Nunca guarda value_id do ML.';
```

- [ ] **Step 3: Aplicar e validar**

```bash
supabase db push
npm run db:check
```

Expected: as duas colunas aplicadas; `db:check` sem divergência.

- [ ] **Step 4: Provar que o CHECK de gênero existe — consulta 100% read-only**

**Correção R6 da revisão do Fable:** a versão anterior deste passo tentava provar o CHECK com
`insert into public.familias (id, genero) values (gen_random_uuid(), 'masc')`. Isso não provava
nada — o insert morre por violação de NOT NULL das outras colunas **antes** de chegar ao CHECK —
e, pior, era uma **escrita real numa tabela de produção** disparada por um passo de verificação.
Nenhuma verificação deste plano escreve no banco.

Pelo SQL read-only da Management API (ou `psql` contra o container local), rode:

```sql
-- Definição do constraint, sem escrever nada.
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.familias'::regclass
  and contype = 'c'
  and conname = 'familias_genero_valido';

-- Coluna nova nasceu nullable e sem backfill: toda linha existente tem genero null.
select count(*) as total, count(genero) as com_genero from public.familias;
```

Expected: a primeira devolve **uma** linha, com `definicao` contendo
`genero IS NULL OR genero = ANY (ARRAY['masculino'::text, 'feminino'::text, 'unissex'::text])`
— é isso que prova que o CHECK aceita nulo e recusa valor fora da lista. A segunda devolve
`com_genero = 0`.

Se a primeira consulta vier vazia, o `constraint familias_genero_valido` não foi aplicado (ou a
coluna já existia de uma tentativa anterior e o `if not exists` pulou a cláusula inteira) —
nesse caso, corrija com uma **migration nova** (`alter table ... add constraint ...`), nunca
editando a migration já aplicada.

- [ ] **Step 5: Regerar os tipos**

```bash
supabase gen types typescript --project-id txvncrgkoynoxwopfkbp --schema public > src/lib/database.types.ts
grep -n "genero" src/lib/database.types.ts | head -5
grep -n "tamanho" src/lib/database.types.ts | head -5
```

Expected: `genero: string | null` no Row de `familias`; `tamanho: string | null` no Row de `variacoes`.

- [ ] **Step 6: Provar que o build ainda passa (coluna nova não quebra nenhum tipo existente)**

Run: `pnpm preflight:static`
Expected: PASS (~27s).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/migrations/ src/lib/database.types.ts
/usr/bin/git commit -m "feat(schema): familias.genero e variacoes.tamanho (ADR-0166)"
```

---

> ### **Checkpoint Fable — fim da Fase 2 (mexe em schema)** (BLOQUEANTE)
>
> O Fable revisa a migration da Fase 2. Perguntas explícitas:
>
> 1. `variacoes` é tabela grande e quente (estoque, push, reconciliação). `add column ... text` sem default é metadata-only no Postgres — confirmar que é, e que não há reescrita de tabela.
> 2. O CHECK em `familias.genero` aceita `null`? Uma linha existente com `genero` nulo pode ser atualizada por qualquer fluxo que não conheça a coluna?
> 3. Guardar o valor do operador em vez do `value_id` do ML está coerente com o que o spike 051 descobriu sobre o atributo de gênero, ou o spike mostrou que o ML exige o id na própria tabela de medidas?
> 4. Alguma trigger, view ou RPC existente faz `select *` em `variacoes` e passaria a carregar a coluna nova para um lugar inesperado (ex.: `criar-kit-vinculado/processar.ts:346` faz `select('*')`)?
>
> **Não prosseguir para a Fase 3 sem o parecer.** A pergunta 4 é a mais provável de gerar trabalho: `clonarVariacao` no kit vinculado copia colunas por lista — se `tamanho` precisar entrar na lista de `strip`, isso vira tarefa da Fase 6.

---

# Fase 3 — UX do cadastro manual + contrato da edge

**model: sonnet** (implementação padrão, feature já planejada).

Ao fim desta fase, um operador de org com `roupa` habilitado cadastra "Camiseta Básica", digita as cores, marca os tamanhos, clica **Gerar variações**, ajusta as linhas e salva — e o produto chega à Revisão com `familias.genero` e `variacoes.tamanho` preenchidos. Org sem tipo habilitado vê a tela **exatamente** como hoje.

### Task 11: Listas fixas e produto cartesiano — `src/lib/tamanhos.ts`

**Files:**
- Create: `src/lib/tamanhos.ts`
- Test: `src/lib/__tests__/tamanhos.test.ts`

**Interfaces:**
- Consumes: `TipoProdutoId` de `src/lib/tipos-produto.ts` (Task 7); `TAMANHOS_ROUPA`/`NUMERACOES_CALCADO` da fonte única `supabase/functions/_shared/produto/tipos-produto-valores.ts` (Task 6, Step 0) — **importados, não redigitados** (R7). É essa fonte que permite a edge validar o valor recebido (Task 16).
- Produces:
  - `export { TAMANHOS_ROUPA, NUMERACOES_CALCADO }` (reexport da fonte única)
  - `export function opcoesDeTamanho(tipos: readonly string[]): { grupo: string; valores: readonly string[] }[]`
  - `export const LIMITE_VARIACOES_GERADAS = 60`
  - `export function gerarCombinacoes(cores: string[], tamanhos: string[]): { cor: string; tamanho: string | null }[]`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/lib/__tests__/tamanhos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO, LIMITE_VARIACOES_GERADAS,
  opcoesDeTamanho, gerarCombinacoes,
} from '@/lib/tamanhos';

describe('TAMANHOS_ROUPA', () => {
  it('e a lista fechada decidida no grilling', () => {
    expect(TAMANHOS_ROUPA).toEqual(['P', 'M', 'G', 'GG', 'Tamanho Único']);
  });
});

describe('opcoesDeTamanho', () => {
  it('org sem tipo nao oferece nenhum grupo — o campo Tamanho nem aparece', () => {
    expect(opcoesDeTamanho([])).toEqual([]);
  });

  it('so roupa oferece so Tamanho', () => {
    expect(opcoesDeTamanho(['roupa']).map((g) => g.grupo)).toEqual(['Tamanho']);
  });

  it('so calcado oferece so Numeracao', () => {
    expect(opcoesDeTamanho(['calcado']).map((g) => g.grupo)).toEqual(['Numeração']);
  });

  it('os dois habilitados oferecem os dois grupos (combinavel, nao exclusivo)', () => {
    expect(opcoesDeTamanho(['calcado', 'roupa']).map((g) => g.grupo)).toEqual(['Tamanho', 'Numeração']);
  });
});

describe('gerarCombinacoes', () => {
  it('produto cartesiano na ordem cor-externa, tamanho-interno', () => {
    expect(gerarCombinacoes(['Azul', 'Preto'], ['P', 'M'])).toEqual([
      { cor: 'Azul', tamanho: 'P' },
      { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' },
      { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('sem tamanho marcado devolve uma linha por cor, com tamanho nulo', () => {
    expect(gerarCombinacoes(['Azul', 'Preto'], [])).toEqual([
      { cor: 'Azul', tamanho: null },
      { cor: 'Preto', tamanho: null },
    ]);
  });

  it('sem cor e sem tamanho devolve lista vazia — nao inventa uma linha', () => {
    expect(gerarCombinacoes([], [])).toEqual([]);
  });

  it('sem cor mas com tamanho devolve uma linha por tamanho, com cor vazia', () => {
    expect(gerarCombinacoes([], ['P', 'M'])).toEqual([
      { cor: '', tamanho: 'P' },
      { cor: '', tamanho: 'M' },
    ]);
  });

  it('deduplica e apara cor e tamanho', () => {
    expect(gerarCombinacoes([' Azul ', 'Azul', ''], ['P', 'P'])).toEqual([
      { cor: 'Azul', tamanho: 'P' },
    ]);
  });

  // Trava LOUD: `proximo_codigo_produto` reserva variacoes.length + 1 codigos de 8 digitos, e o
  // cartesiano estoura facil. Descobrir o limite em producao (D-5) seria um cadastro perdido.
  it('acima do limite LANCA com mensagem acionavel, nunca trunca', () => {
    const cores = Array.from({ length: 13 }, (_, i) => `Cor ${i}`);
    expect(() => gerarCombinacoes(cores, ['P', 'M', 'G', 'GG', 'Tamanho Único']))
      .toThrow(/65 variações.*limite de 60/i);
  });

  it('exatamente no limite nao lanca', () => {
    const cores = Array.from({ length: 12 }, (_, i) => `Cor ${i}`);
    expect(gerarCombinacoes(cores, ['P', 'M', 'G', 'GG', 'Tamanho Único']))
      .toHaveLength(LIMITE_VARIACOES_GERADAS);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test src/lib/__tests__/tamanhos.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tamanhos"`.

- [ ] **Step 3: Escrever a implementação**

Crie `src/lib/tamanhos.ts`:

```ts
// ADR-0166: listas fixas de Tamanho (roupa) e Numeração (calçado), e o produto cartesiano
// cor × tamanho que alimenta o botão "Gerar variações" do cadastro manual.
//
// São listas de PICK, nunca texto livre: o ML normaliza valor de atributo (o mesmo que já
// acontece com COLOR, onde `Rosa Claro` vira `Rosa-claro` na publicação), e texto livre aqui
// produziria uma linha de tabela de medidas por digitação divergente.
//
// NÃO confundir com `TAMANHOS_KIT` (src/lib/kit.ts), que é quantidade de unidades dentro de um
// Kit vinculado (2 a 6) e não tem relação nenhuma com tamanho de peça.
//
// R7 da revisão do Fable: as LISTAS vêm da fonte única do backend e são só reexportadas aqui.
// Antes elas só existiam no frontend — e por isso a edge não tinha como recusar um valor de
// tamanho fora da lista do tipo da org. Este arquivo guarda apenas o que é de UI.
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';

export { TAMANHOS_ROUPA, NUMERACOES_CALCADO };

export interface GrupoTamanho { grupo: string; valores: readonly string[] }

/** Grupos oferecidos ao operador, conforme os tipos habilitados na org.
 *  Lista vazia = nenhum grupo = o campo Tamanho não é renderizado (INV-1). */
export function opcoesDeTamanho(tipos: readonly string[]): GrupoTamanho[] {
  const grupos: GrupoTamanho[] = [];
  if (tipos.includes('roupa')) grupos.push({ grupo: 'Tamanho', valores: TAMANHOS_ROUPA });
  if (tipos.includes('calcado')) grupos.push({ grupo: 'Numeração', valores: NUMERACOES_CALCADO });
  return grupos;
}

/** Teto de linhas geradas de uma vez. `proximo_codigo_produto` reserva `variacoes.length + 1`
 *  códigos de oito dígitos (D-5 do ADR-0094) e o cartesiano estoura rápido; além disso o ML tem
 *  limite de variações por anúncio. Falha LOUD e acionável em vez de truncar em silêncio ou
 *  deixar o operador descobrir na edge. */
export const LIMITE_VARIACOES_GERADAS = 60;

export interface Combinacao { cor: string; tamanho: string | null }

function limparLista(valores: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of valores) {
    const v = bruto.trim();
    if (!v || vistos.has(v)) continue;
    vistos.add(v);
    saida.push(v);
  }
  return saida;
}

/** Produto cartesiano cor × tamanho. Cor é o eixo externo para as linhas saírem agrupadas por
 *  cor na tabela — é como o operador confere a foto, que é por cor. */
export function gerarCombinacoes(cores: string[], tamanhos: string[]): Combinacao[] {
  const c = limparLista(cores);
  const t = limparLista(tamanhos);
  const total = Math.max(c.length, 1) * Math.max(t.length, 1);
  if (c.length === 0 && t.length === 0) return [];
  if (total > LIMITE_VARIACOES_GERADAS) {
    throw new Error(
      `Essa combinação geraria ${total} variações, acima do limite de ${LIMITE_VARIACOES_GERADAS} `
      + 'por cadastro. Cadastre em dois produtos ou reduza as cores/tamanhos.',
    );
  }
  if (t.length === 0) return c.map((cor) => ({ cor, tamanho: null }));
  if (c.length === 0) return t.map((tamanho) => ({ cor: '', tamanho }));
  return c.flatMap((cor) => t.map((tamanho) => ({ cor, tamanho })));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test src/lib/__tests__/tamanhos.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/tamanhos.ts src/lib/__tests__/tamanhos.test.ts
/usr/bin/git commit -m "feat(cadastro): listas de tamanho/numeracao e produto cartesiano (ADR-0166)"
```

---

### Task 12: Contrato de entrada — `genero` e `tamanho` na edge e no espelho do frontend

**Files:**
- Modify: `supabase/functions/_shared/produto/validar.ts` (interfaces `VariacaoEntrada`/`ProdutoEntrada`, `validarProdutoNovo`, `montarLinhasProduto`)
- Modify: `src/lib/produto-entrada.ts` (espelho — os dois têm que andar juntos)
- Test: `supabase/functions/_shared/produto/__tests__/validar-tamanho.test.ts`

**Interfaces:**
- Consumes: colunas de Task 10.
- Produces: `VariacaoEntrada.tamanho?: string | null`; `ProdutoEntrada.genero?: 'masculino' | 'feminino' | 'unissex' | null`. `montarLinhasProduto` passa a gravar `familia.genero` e `variacao.tamanho`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `supabase/functions/_shared/produto/__tests__/validar-tamanho.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { montarLinhasProduto, validarProdutoNovo, type ProdutoEntrada } from '../validar.ts';

const CTX = {
  loteId: 'lote-1', userId: 'user-1', orgId: 'org-1',
  codigoPai: '00000001', codigos: ['00000002', '00000003'], chaveCadastro: 'k',
};

function base(over: Partial<ProdutoEntrada> = {}): ProdutoEntrada {
  return {
    nomePai: 'Camiseta Básica',
    origem: 'nacional',
    chaveCadastro: '11111111-1111-4111-8111-111111111111',
    variacoes: [{ nome: 'Azul', preco: 50 }],
    ...over,
  };
}

describe('genero', () => {
  it('ausente e valido — e o caso de toda org sem tipo de produto habilitado', () => {
    expect(validarProdutoNovo(base())).toEqual([]);
  });

  it('valor fora dos tres aceitos e recusado, nunca corrigido em silencio', () => {
    const erros = validarProdutoNovo(base({ genero: 'masc' as never }));
    expect(erros).toContainEqual({ campo: 'genero', mensagem: expect.stringMatching(/masculino.*feminino.*unissex/i) });
  });

  it('aceita os tres valores', () => {
    for (const g of ['masculino', 'feminino', 'unissex'] as const) {
      expect(validarProdutoNovo(base({ genero: g }))).toEqual([]);
    }
  });

  // R3 da revisao do Fable: o genero era opcional no cadastro e obrigatorio na publicacao, sem
  // nenhuma tela para corrigir — o produto nascia impublicavel e o operador nao tinha caminho.
  // Agora o cadastro RECUSA na entrada, com 400 explicito, no momento em que da para arrumar.
  it('tamanho preenchido SEM genero e recusado JA no cadastro', () => {
    const erros = validarProdutoNovo(base({
      genero: null,
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }));
    expect(erros).toContainEqual({
      campo: 'genero',
      mensagem: expect.stringMatching(/g[eê]nero/i),
    });
  });

  it('basta UMA variacao com tamanho para o genero virar obrigatorio', () => {
    const erros = validarProdutoNovo(base({
      variacoes: [{ nome: 'Azul', preco: 50 }, { nome: 'Preto', tamanho: 'M', preco: 50 }],
    }));
    expect(erros.some((e) => e.campo === 'genero')).toBe(true);
  });

  it('com tamanho E genero informado, passa', () => {
    expect(validarProdutoNovo(base({
      genero: 'feminino',
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }))).toEqual([]);
  });

  it('sem tamanho nenhum, genero ausente continua valido — INV-1 intacto', () => {
    expect(validarProdutoNovo(base({ variacoes: [{ nome: 'Azul', preco: 50 }] }))).toEqual([]);
  });
});

describe('tamanho', () => {
  it('duas variacoes com a MESMA cor e MESMO tamanho sao recusadas (SKU duplicado)', () => {
    const erros = validarProdutoNovo(base({
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }, { nome: 'Azul', tamanho: 'P', preco: 60 }],
    }));
    expect(erros).toContainEqual({ campo: 'variacoes', mensagem: expect.stringMatching(/Azul.*P/) });
  });

  it('mesma cor com tamanhos diferentes e o caso NORMAL da feature', () => {
    expect(validarProdutoNovo(base({
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }, { nome: 'Azul', tamanho: 'M', preco: 50 }],
    }))).toEqual([]);
  });

  it('duas variacoes sem tamanho e sem cor continuam aceitas (comportamento de hoje)', () => {
    expect(validarProdutoNovo(base({
      variacoes: [{ preco: 50 }, { preco: 60 }],
    }))).toEqual([]);
  });
});

describe('montarLinhasProduto', () => {
  it('sem genero nem tamanho, as colunas novas saem null — payload de hoje intacto', () => {
    const { familia, variacoes } = montarLinhasProduto(base(), CTX);
    expect(familia.genero).toBeNull();
    expect(variacoes[0].tamanho).toBeNull();
  });

  it('grava genero na familia e tamanho na variacao, aparados', () => {
    const { familia, variacoes } = montarLinhasProduto(base({
      genero: 'feminino',
      variacoes: [{ nome: 'Azul', tamanho: '  P  ', preco: 50 }],
    }), CTX);
    expect(familia.genero).toBe('feminino');
    expect(variacoes[0].tamanho).toBe('P');
  });

  it('tamanho vazio vira null, nunca string vazia', () => {
    const { variacoes } = montarLinhasProduto(base({
      variacoes: [{ nome: 'Azul', tamanho: '   ', preco: 50 }],
    }), CTX);
    expect(variacoes[0].tamanho).toBeNull();
  });

  it('cor continua vindo de `nome` com cor_origem manual (ADR-0004 intacto)', () => {
    const { variacoes } = montarLinhasProduto(base({
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }), CTX);
    expect(variacoes[0].cor).toBe('Azul');
    expect(variacoes[0].cor_origem).toBe('manual');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/_shared/produto/__tests__/validar-tamanho.test.ts`
Expected: FAIL — o primeiro erro é de tipo (`genero` não existe em `ProdutoEntrada`) ou `familia.genero` é `undefined`.

- [ ] **Step 3: Estender as interfaces em `_shared/produto/validar.ts`**

Em `VariacaoEntrada`, acrescente depois de `nome`:

```ts
  /** ADR-0166: tamanho (roupa) ou numeração (calçado). Ausente/null = variação sem esse eixo,
   *  que é o caso de toda org sem tipo de produto habilitado. */
  tamanho?: string | null;
```

Em `ProdutoEntrada`, acrescente depois de `origem`:

```ts
  /** ADR-0166: gênero da peça. Ausente/null = não informado. O ML exige que o gênero do anúncio
   *  bata com o da tabela de medidas, então valor inválido FALHA em vez de virar default. */
  genero?: 'masculino' | 'feminino' | 'unissex' | null;
```

- [ ] **Step 4: Estender `validarProdutoNovo`**

Logo abaixo do bloco que valida `origem` (o comentário "TRAVA LOUD DO IMPOSTO POR ORIGEM"), acrescente:

```ts
  // ADR-0166. Ausente é válido (org sem tipo habilitado). Presente e fora da lista FALHA: o ML
  // recusa a publicação inteira quando o gênero do anúncio não bate com o da tabela de medidas,
  // e "corrigir para unissex" seria afirmar sobre o produto um dado que ninguém informou.
  const GENEROS_VALIDOS = ['masculino', 'feminino', 'unissex'];
  if (p.genero != null && !GENEROS_VALIDOS.includes(p.genero)) {
    erros.push({
      campo: 'genero',
      mensagem: 'Gênero inválido — use masculino, feminino ou unissex.',
    });
  }

  // R3 (revisão do Fable): gênero é OBRIGATÓRIO quando alguma variação tem tamanho. O ML exige
  // que o gênero do anúncio bata com o da tabela de medidas (ADR-0167) — sem ele a publicação
  // falha LOUD e, antes desta trava, não havia tela nenhuma para informar o dado depois: o
  // produto nascia impublicável. A recusa acontece aqui, no cadastro, que é onde o operador
  // ainda está com a tela aberta e consegue corrigir.
  //
  // INV-1 intacto por construção: `entradaTamanhoEfetiva` (Task 16) roda ANTES deste validador
  // e zera `tamanho` de org sem tipo de produto habilitado, então esta regra nunca é alcançada
  // por quem não contratou o eixo — nem por um payload forjado.
  if (p.variacoes?.some((v) => v.tamanho?.trim())) {
    if (!p.genero) {
      erros.push({
        campo: 'genero',
        mensagem: 'Informe o gênero (masculino, feminino ou unissex) — ele é obrigatório para '
          + 'produto com tamanho/numeração e define a tabela de medidas usada na publicação.',
      });
    }
  }
```

E, **depois** do `forEach` que valida cada variação (antes do `return erros`), acrescente a trava de SKU duplicado:

```ts
  // ADR-0166: com dois eixos, o par (cor, tamanho) é a identidade do SKU. Duas linhas com o mesmo
  // par são dois SKUs indistinguíveis — o ML recusa a variação duplicada e, pior, o casamento
  // POSICIONAL de foto e de estoque inicial (cadastrar-produto/index.ts) passaria a depender de
  // qual das duas o operador quis. Sem tamanho em nenhuma das duas, nada muda: cores repetidas
  // sem tamanho continuam aceitas, como sempre foram.
  const vistos = new Set<string>();
  for (const v of p.variacoes) {
    const cor = v.nome?.trim() || '';
    const tam = v.tamanho?.trim() || '';
    if (!tam) continue;
    const chave = `${cor}\u0000${tam}`;
    if (vistos.has(chave)) {
      erros.push({
        campo: 'variacoes',
        mensagem: `Variação repetida: ${cor || '(sem cor)'} / ${tam}. Cada combinação de cor e tamanho pode aparecer uma vez só.`,
      });
      break;
    }
    vistos.add(chave);
  }
```

- [ ] **Step 5: Estender `montarLinhasProduto`**

No objeto `familia`, logo depois da linha `origem: p.origem,`:

```ts
    // ADR-0166: explícito, e null quando não informado — a coluna é nullable sem default e null
    // é o estado de toda família de org sem tipo de produto habilitado.
    genero: p.genero ?? null,
```

No objeto devolvido dentro do `map` de `variacoes`, logo depois de `gtin:`:

```ts
      // ADR-0166: tamanho (roupa) / numeração (calçado). Mesma normalização de nome/gtin —
      // `trim() || null` — para nunca gravar string vazia, que viraria um valor de atributo
      // vazio no payload do ML.
      tamanho: v.tamanho?.trim() || null,
```

- [ ] **Step 6: Espelhar no frontend**

Em `src/lib/produto-entrada.ts`, acrescente os **mesmos** dois campos, com os mesmos comentários curtos, em `VariacaoEntrada` e `ProdutoEntrada`. O arquivo já avisa no topo que os dois precisam andar juntos — se divergirem, a tela simplesmente não consegue enviar o campo.

- [ ] **Step 7: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/_shared/produto/__tests__/validar-tamanho.test.ts`
Expected: PASS, 14 testes (10 originais + os 4 de gênero obrigatório com tamanho, R3).

- [ ] **Step 8: Rodar os testes pré-existentes do cadastro**

Run: `pnpm test supabase/functions/cadastrar-produto`
Expected: PASS — nenhum teste antigo pode ter quebrado.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/produto/ src/lib/produto-entrada.ts
/usr/bin/git commit -m "feat(cadastro): genero na familia e tamanho na variacao no contrato de entrada (ADR-0166)"
```

---

### Task 13: Guard de retry idempotente passa a comparar `tamanho`

**Files:**
- Modify: `supabase/functions/cadastrar-produto/processar.ts` (interface `VariacaoGravada` e função `variacoesDivergem`, linhas 38-106)
- Test: `supabase/functions/cadastrar-produto/__tests__/processar.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `VariacaoEntrada.tamanho` (Task 12).
- Produces: nada novo — corrige um buraco que a Task 12 abriu.

**Por que esta tarefa existe e é separada:** `variacoesDivergem` compara uma lista curada de colunas e o próprio docstring dela diz que cobre **TODAS** as colunas que `montarLinhasProduto` grava. A Task 12 passou a gravar `tamanho` sem incluí-lo aqui. Consequência concreta: o operador troca **só** o tamanho entre duas tentativas com a mesma `chaveCadastro` → `variacoesDivergem` devolve `false` → o handler entra no caminho "já cadastrado" → `estoqueInicialDiverge` casa por **índice** → o estoque inicial é conferido contra um SKU cujo tamanho não é mais o do formulário. Silencioso, e alimenta markup e preço.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao final de `supabase/functions/cadastrar-produto/__tests__/processar.test.ts`, dentro de um `describe` novo:

```ts
describe('variacoesDivergem — tamanho (ADR-0166)', () => {
  const gravada = {
    nome: 'Azul', gtin: null, preco: '50.00', custo: null,
    peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
    tamanho: 'P',
  };

  it('trocar SO o tamanho entre as tentativas DIVERGE', () => {
    expect(variacoesDivergem(
      [{ nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: 'M' }],
      [gravada],
    )).toBe(true);
  });

  it('mesmo tamanho nao diverge — o retry legitimo continua passando', () => {
    expect(variacoesDivergem(
      [{ nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: 'P' }],
      [gravada],
    )).toBe(false);
  });

  it('tamanho com espaco extra nao diverge (mesma normalizacao da gravacao)', () => {
    expect(variacoesDivergem(
      [{ nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: '  P  ' }],
      [gravada],
    )).toBe(false);
  });

  it('remover o tamanho DIVERGE (P gravado, vazio enviado)', () => {
    expect(variacoesDivergem(
      [{ nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: '' }],
      [gravada],
    )).toBe(true);
  });

  it('os dois lados sem tamanho nao divergem — o caso de toda org sem tipo habilitado', () => {
    expect(variacoesDivergem(
      [{ nome: 'Azul', gtin: null, preco: 50, custo: null }],
      [{ ...gravada, tamanho: null }],
    )).toBe(false);
  });

  // Reordenar duas linhas que so diferem no tamanho: sem esta cobertura, a contagem bate, todas
  // as outras colunas batem, e o estoque inicial entra no SKU errado em silencio.
  it('reordenar duas linhas que so diferem no tamanho DIVERGE', () => {
    const gravadas = [{ ...gravada, tamanho: 'P' }, { ...gravada, tamanho: 'M' }];
    expect(variacoesDivergem(
      [
        { nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: 'M' },
        { nome: 'Azul', gtin: null, preco: 50, custo: null, tamanho: 'P' },
      ],
      gravadas,
    )).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/cadastrar-produto/__tests__/processar.test.ts -t "tamanho (ADR-0166)"`
Expected: FAIL — "trocar SO o tamanho entre as tentativas DIVERGE" recebe `false`, esperava `true`.

- [ ] **Step 3: Estender `VariacaoGravada`**

Em `supabase/functions/cadastrar-produto/processar.ts`, na interface `VariacaoGravada`, acrescente:

```ts
  /** ADR-0166. Coluna `text` nullable — vem crua do PostgREST. */
  tamanho?: string | null;
```

- [ ] **Step 4: Estender `variacoesDivergem`**

Ajuste a assinatura para incluir `'tamanho'` no `Pick`:

```ts
export function variacoesDivergem(
  enviadas: Pick<VariacaoEntrada, 'nome' | 'gtin' | 'preco' | 'custo' | 'pesoGramas' | 'alturaCm' | 'larguraCm' | 'comprimentoCm' | 'tamanho'>[],
  gravadas: VariacaoGravada[],
): boolean {
```

E acrescente a comparação na cadeia de `||`, logo depois da linha de `gtin`:

```ts
      // ADR-0166: MESMA normalização da gravação (`trim() || null`, montarLinhasProduto). Sem
      // esta linha, trocar só o tamanho entre duas tentativas com a mesma chave passaria pelo
      // guard, e `estoqueInicialDiverge` (que casa por índice) conferiria o estoque contra um SKU
      // cujo tamanho já não é o do formulário — silencioso, e alimenta markup e preço.
      || (v.tamanho?.trim() || null) !== (g.tamanho ?? null)
```

- [ ] **Step 5: Atualizar o docstring da função**

Na lista de colunas do comentário de `variacoesDivergem`, troque a enumeração para incluir `tamanho`:

```
 * Compara TODAS as colunas que `montarLinhasProduto` grava e têm contrapartida armazenada —
 * `nome, gtin, tamanho, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm`.
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/cadastrar-produto/__tests__/processar.test.ts`
Expected: PASS — os 6 casos novos e **todos** os pré-existentes.

- [ ] **Step 7: Incluir a coluna no `select` do handler**

Em `supabase/functions/cadastrar-produto/index.ts`, linha 98, acrescente `tamanho` ao select — sem isso `g.tamanho` chega `undefined` e a comparação nova é um no-op:

```ts
      .select('id, codigo, nome, tamanho, gtin, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm')
```

- [ ] **Step 8: Verificar tipos**

Run: `pnpm check:functions`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add supabase/functions/cadastrar-produto/
/usr/bin/git commit -m "fix(cadastro): guard de retry idempotente compara tamanho (ADR-0166)"
```

---

### Task 14: Campo Tamanho na linha de variação

**Files:**
- Modify: `src/components/estoque/linha-variacao-form.tsx` (interface `LinhaVariacao`, `novaLinha`, e o grid de identificação na linha 161-164)
- Test: `src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`

**Interfaces:**
- Consumes: `GrupoTamanho`/`opcoesDeTamanho` de `src/lib/tamanhos.ts` (Task 11).
- Produces: `LinhaVariacao.tamanho: string`; nova prop opcional `gruposTamanho?: GrupoTamanho[]` em `LinhaVariacaoForm`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinhaVariacaoForm, novaLinha } from '@/components/estoque/linha-variacao-form';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

function renderizar(gruposTamanho?: { grupo: string; valores: readonly string[] }[]) {
  const onMudar = vi.fn();
  render(
    <LinhaVariacaoForm
      linha={novaLinha()}
      indice={0}
      podeRemover={false}
      tentouSalvar={false}
      gruposTamanho={gruposTamanho}
      onMudar={onMudar}
      onRemover={() => {}}
    />,
  );
  return { onMudar };
}

describe('LinhaVariacaoForm — Tamanho (ADR-0166)', () => {
  it('sem grupos, o campo Tamanho NAO existe — tela byte a byte igual a de hoje', () => {
    renderizar();
    expect(screen.queryByLabelText(/Tamanho da variação 1/)).not.toBeInTheDocument();
  });

  it('lista vazia de grupos tambem nao renderiza o campo', () => {
    renderizar([]);
    expect(screen.queryByLabelText(/Tamanho da variação 1/)).not.toBeInTheDocument();
  });

  it('com o grupo Tamanho, oferece as 5 opcoes + a opcao vazia', () => {
    renderizar([{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }]);
    const select = screen.getByLabelText(/Tamanho da variação 1/);
    expect(select).toBeInTheDocument();
    for (const t of TAMANHOS_ROUPA) {
      expect(screen.getByRole('option', { name: t })).toBeInTheDocument();
    }
  });

  it('escolher um tamanho chama onMudar com o valor', async () => {
    const user = userEvent.setup();
    const { onMudar } = renderizar([{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }]);
    await user.selectOptions(screen.getByLabelText(/Tamanho da variação 1/), 'G');
    expect(onMudar).toHaveBeenCalledWith({ tamanho: 'G' });
  });

  it('novaLinha nasce com tamanho vazio', () => {
    expect(novaLinha().tamanho).toBe('');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`
Expected: FAIL — `novaLinha().tamanho` é `undefined` e o select não existe.

- [ ] **Step 3: Estender o tipo e o construtor**

Em `src/components/estoque/linha-variacao-form.tsx`:

Na interface `LinhaVariacao`, acrescente depois de `nome: string; gtin: string;`:

```ts
  /** ADR-0166: tamanho (roupa) / numeração (calçado). String vazia = sem eixo de tamanho. */
  tamanho: string;
```

Em `novaLinha()`, acrescente `tamanho: ''` ao objeto devolvido:

```ts
    nome: '', gtin: '', tamanho: '', preco: '', custo: '', estoqueInicial: '',
```

Em `erroCampo`, acrescente `tamanho` à guarda dos campos não-numéricos (senão `parseNum('P')` devolve `NaN` e a linha vira "Valor inválido"):

```ts
  if (campo === 'nome' || campo === 'gtin' || campo === 'tamanho') return null;
```

- [ ] **Step 4: Acrescentar a prop e o select**

No import, acrescente:

```ts
import type { GrupoTamanho } from '@/lib/tamanhos';
```

Na lista de props desestruturadas, acrescente `gruposTamanho`, e na assinatura de tipos:

```ts
  /** ADR-0166: grupos de tamanho oferecidos pela org (`opcoesDeTamanho`). `undefined` ou vazio =
   *  org sem tipo de produto habilitado: o campo não é renderizado e a linha fica idêntica à de
   *  hoje. Não usar `[]` como "ainda carregando" — ver useTiposProdutoHabilitados. */
  gruposTamanho?: GrupoTamanho[];
```

Substitua o grid de identificação (hoje `{campoTexto('nome', 'Cor / nome')}` + `{campoTexto('gtin', 'GTIN')}`) por:

```tsx
      <div className={cn('grid gap-2', gruposTamanho?.length ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {campoTexto('nome', 'Cor / nome')}
        {!!gruposTamanho?.length && (
          <div className="flex flex-col gap-1">
            <label htmlFor={id('tamanho')} className="text-xs text-muted-foreground">
              {gruposTamanho.length === 1 ? gruposTamanho[0].grupo : 'Tamanho / Numeração'}
            </label>
            <select
              id={id('tamanho')}
              aria-label={`Tamanho da variação ${n}`}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={linha.tamanho}
              onChange={(e) => onMudar({ tamanho: e.target.value })}
            >
              <option value="">—</option>
              {gruposTamanho.map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.valores.map((v) => <option key={v} value={v}>{v}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {campoTexto('gtin', 'GTIN')}
      </div>
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm test src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx`
Expected: PASS, 5 testes.

- [ ] **Step 6: Rodar os testes pré-existentes do Estoque (a linha é compartilhada com "Adicionar variação", ADR-0129)**

Run: `pnpm test src/components/estoque`
Expected: PASS, sem regressão.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/components/estoque/linha-variacao-form.tsx src/components/estoque/__tests__/linha-variacao-tamanho.test.tsx
/usr/bin/git commit -m "feat(cadastro): campo de tamanho na linha de variacao (ADR-0166)"
```

---

### Task 15: Gerador de variações (cores × tamanhos) e campo Gênero no diálogo

**Files:**
- Create: `src/components/estoque/gerador-variacoes.tsx`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (estado de gênero, uso do hook, bloco do gerador, `montarPayload`, **`podeSalvar` — trava de submit sem gênero quando há tamanho, R3**)
- Test: `src/components/estoque/__tests__/gerador-variacoes.test.tsx`
- Test: `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx` (**modificar** — `describe` novo da trava de submit, R3)

**Interfaces:**
- Consumes: `gerarCombinacoes`, `opcoesDeTamanho` (Task 11); `useTiposProdutoHabilitados` (Task 9); `novaLinha`, `LinhaVariacao` (Task 14).
- Produces: `export function GeradorVariacoes(props: { gruposTamanho: GrupoTamanho[]; onGerar: (combinacoes: Combinacao[]) => void }): JSX.Element`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/components/estoque/__tests__/gerador-variacoes.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

const GRUPOS = [{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }];

describe('GeradorVariacoes (ADR-0166)', () => {
  it('gera o cartesiano das cores digitadas pelos tamanhos marcados', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);

    await user.type(screen.getByLabelText('Cores'), 'Azul, Preto');
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));

    expect(onGerar).toHaveBeenCalledWith([
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('mostra a contagem ANTES de gerar, para o operador nao ser surpreendido', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Cores'), 'Azul, Preto, Verde');
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    expect(screen.getByText(/3 variações/)).toBeInTheDocument();
  });

  it('botao travado enquanto nao ha cor nem tamanho', () => {
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Gerar variações' })).toBeDisabled();
  });

  it('acima do limite mostra o erro e NAO chama onGerar', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);
    const cores = Array.from({ length: 13 }, (_, i) => `Cor${i}`).join(', ');
    await user.type(screen.getByLabelText('Cores'), cores);
    for (const t of TAMANHOS_ROUPA) await user.click(screen.getByRole('checkbox', { name: t }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/limite de 60/i);
  });

  it('separa cores por virgula E por quebra de linha, e ignora vazio', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);
    await user.type(screen.getByLabelText('Cores'), 'Azul,,{enter}Preto,');
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).toHaveBeenCalledWith([
      { cor: 'Azul', tamanho: null }, { cor: 'Preto', tamanho: null },
    ]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test src/components/estoque/__tests__/gerador-variacoes.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/estoque/gerador-variacoes"`.

- [ ] **Step 3: Escrever o componente**

Crie `src/components/estoque/gerador-variacoes.tsx`:

```tsx
// ADR-0166: o operador digita a lista de cores UMA vez e marca os tamanhos UMA vez; o botão
// monta o produto cartesiano como linhas editáveis. Sem isto, cadastrar 4 cores × 5 tamanhos
// seria preencher 20 cards à mão — o que o operador faz hoje é justamente por isso que a org
// piloto não cadastrava roupa no app.
//
// O componente NÃO decide nada sobre a org: quem manda os grupos é o diálogo, a partir de
// `opcoesDeTamanho(tiposHabilitados)`. Lista vazia de grupos = o bloco nem é renderizado.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { gerarCombinacoes, type Combinacao, type GrupoTamanho } from '@/lib/tamanhos';

/** Cores separadas por vírgula OU quebra de linha — o operador cola de uma planilha tanto num
 *  formato quanto no outro, e exigir um só produziria uma linha "Azul\nPreto". */
function separarCores(texto: string): string[] {
  return texto.split(/[,\n]/).map((c) => c.trim()).filter(Boolean);
}

export function GeradorVariacoes({ gruposTamanho, onGerar }: {
  gruposTamanho: GrupoTamanho[];
  /** Chamado só quando a geração é válida. O diálogo é quem substitui as linhas. */
  onGerar: (combinacoes: Combinacao[]) => void;
}) {
  const [cores, setCores] = useState('');
  const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const listaCores = separarCores(cores);
  const listaTamanhos = [...tamanhos];
  // Prévia da contagem: o operador vê o número ANTES de clicar, em vez de descobrir 40 cards.
  const total = Math.max(listaCores.length, 1) * Math.max(listaTamanhos.length, 1);
  const vazio = listaCores.length === 0 && listaTamanhos.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <span className="text-sm font-medium">Gerar variações</span>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ger-cores" className="text-xs text-muted-foreground">Cores</label>
        <Textarea
          id="ger-cores" rows={2} value={cores}
          placeholder="Azul, Preto, Branco"
          onChange={(e) => { setCores(e.target.value); setErro(null); }}
        />
        <span className="text-xs text-muted-foreground">
          Separe por vírgula ou por linha. Produto sem cor? Deixe em branco e marque só os tamanhos.
        </span>
      </div>
      {gruposTamanho.map((g) => (
        <div key={g.grupo} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{g.grupo}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {g.valores.map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  aria-label={v}
                  checked={tamanhos.has(v)}
                  onCheckedChange={(checked) => {
                    setErro(null);
                    setTamanhos((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(v); else next.delete(v);
                      return next;
                    });
                  }}
                />
                {v}
              </label>
            ))}
          </div>
        </div>
      ))}
      {erro && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button" variant="outline" size="sm" disabled={vazio}
          onClick={() => {
            try {
              onGerar(gerarCombinacoes(listaCores, listaTamanhos));
              setErro(null);
            } catch (e) {
              // Erro do limite (LIMITE_VARIACOES_GERADAS): mensagem acionável, e NADA é gerado.
              setErro(e instanceof Error ? e.message : 'Não foi possível gerar as variações.');
            }
          }}
        >
          Gerar variações
        </Button>
        {!vazio && <span className="text-xs text-muted-foreground">{total} variações</span>}
      </div>
      <span className="text-xs text-muted-foreground">
        Gerar substitui as variações abaixo. Depois é só ajustar preço, estoque, GTIN e foto de
        cada linha — ou remover as combinações que você não tem.
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test src/components/estoque/__tests__/gerador-variacoes.test.tsx`
Expected: PASS, 5 testes.

- [ ] **Step 5: Integrar no diálogo de cadastro**

Em `src/components/estoque/dialog-cadastro-produto.tsx`:

(a) Imports novos:

```ts
import { useTiposProdutoHabilitados } from '@/hooks/useTiposProdutoHabilitados';
import { opcoesDeTamanho } from '@/lib/tamanhos';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
```

(b) Logo abaixo de `const fiscalAtivo = …`:

```ts
  // ADR-0166. `data === undefined` é "não sei" (falha de rede), não "org sem tipo": nos dois
  // casos a tela fica igual à de hoje, que é o lado seguro — nunca oferecemos um eixo de
  // variação que a org talvez não tenha.
  const { data: tiposProduto } = useTiposProdutoHabilitados();
  const gruposTamanho = opcoesDeTamanho(tiposProduto ?? []);
  const temEixoTamanho = gruposTamanho.length > 0;
```

(c) Estado novo, junto dos outros `useState`:

```ts
  // ADR-0166: só existe com tipo de produto habilitado.
  //
  // R3 (revisão do Fable): COM TRAVA DE SUBMIT quando alguma linha tem tamanho. A versão
  // anterior deste plano deixava o gênero opcional aqui e obrigatório na publicação, sem
  // nenhuma tela para completá-lo depois — o produto nascia impublicável e o operador não
  // tinha caminho de correção. Agora o gate é o mesmo de `origem`: sem o dado, não salva.
  const [genero, setGenero] = useState<'masculino' | 'feminino' | 'unissex' | ''>('');
```

(d) No `useEffect` de reset (o que roda ao fechar), acrescente `setGenero('');` junto de `setOrigem(null);`.

(e) Em `montarPayload`, acrescente o parâmetro e os campos. Assinatura do primeiro parâmetro passa a incluir `genero`:

```ts
function montarPayload(
  pai: {
    nomePai: string; descricaoPai: string; unidade: string; fornecedor: string;
    origem: 'nacional' | 'importado';
    genero: 'masculino' | 'feminino' | 'unissex' | null;
  },
  linhas: LinhaVariacao[],
  chaveCadastro: string,
  fiscal?: FiscalForm,
): ProdutoEntrada {
```

No `map` de `variacoes`, acrescente depois de `nome`:

```ts
    // ADR-0166: string vazia vira null — a edge normaliza de novo, mas mandar '' faria o guard
    // de retry comparar '' contra null e divergir num retry legítimo.
    tamanho: l.tamanho.trim() || null,
```

E no objeto devolvido, depois de `origem: pai.origem,`:

```ts
    genero: pai.genero,
```

(f) Na chamada de `montarPayload` dentro de `salvar()`, passe o gênero:

```ts
      const r = await cadastrarProduto(montarPayload(
        { nomePai, descricaoPai, unidade, fornecedor, origem, genero: genero || null },
        linhas, chaveCadastro,
        fiscalAtivo ? fiscal : undefined,
      ));
```

(g) No grid de 3 colunas que hoje tem Unidade / Fornecedor / Origem, **depois** do bloco de Origem, acrescente o campo Gênero — condicional:

```tsx
              {temEixoTamanho && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cad-genero" className="text-sm font-medium">
                    Gênero{algumaLinhaComTamanho && <span className="text-destructive"> *</span>}
                  </label>
                  <select
                    id="cad-genero"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={genero}
                    onChange={(e) => setGenero(e.target.value as typeof genero)}
                  >
                    <option value="">Não informar</option>
                    <option value="masculino">Masculino</option>
                    <option value="feminino">Feminino</option>
                    <option value="unissex">Unissex</option>
                  </select>
                  {/* R3: mesma forma da dica de `origem` — explica por que o botão está travado,
                      em vez de deixar o operador procurar o campo que falta. */}
                  {algumaLinhaComTamanho && !genero && (
                    <span className="text-xs text-muted-foreground">
                      Obrigatório com tamanho/numeração — define a tabela de medidas do anúncio.
                    </span>
                  )}
                </div>
              )}
```

(h) No bloco "Variações", **antes** do `{linhas.map(...)}` e depois do cabeçalho, acrescente o gerador — condicional:

```tsx
              {temEixoTamanho && (
                <GeradorVariacoes
                  gruposTamanho={gruposTamanho}
                  onGerar={(combinacoes) => setLinhas(combinacoes.map((c) => ({
                    ...novaLinha(), nome: c.cor, tamanho: c.tamanho ?? '',
                  })))}
                />
              )}
```

(i) Passe os grupos para cada linha, no `<LinhaVariacaoForm>`:

```tsx
                    gruposTamanho={temEixoTamanho ? gruposTamanho : undefined}
```

(j) A dica "Produto sem variação?" hoje aparece quando `linhas.length === 1`. Mantenha, mas não a mostre quando há eixo de tamanho (ela contradiz o gerador):

```tsx
              {linhas.length === 1 && !temEixoTamanho && (
```

(k) **R3 — trava de submit (correção da revisão do Fable).** Junto do cálculo de `podeSalvar`
(hoje na linha ~241), acrescente o derivado e a condição:

```ts
  // ADR-0166 / R3: gênero é obrigatório QUANDO alguma linha tem tamanho — não quando a org tem
  // o tipo habilitado. Uma org de roupa também cadastra produto sem tamanho (embalagem, brinde),
  // e travar por tipo habilitado impediria esse cadastro. O gate acompanha o DADO, não a org.
  const algumaLinhaComTamanho = linhas.some((l) => l.tamanho.trim() !== '');

  const podeSalvar = !!nomePai.trim() && !!origem && linhas.length > 0
    // Sem gênero, a publicação falharia LOUD em `prepararSizeChart` (ADR-0167) e não haveria
    // tela para completar o dado depois. Trava aqui, igual a `origem`.
    && (!algumaLinhaComTamanho || !!genero)
    && linhas.every((l) => CAMPOS_NUMERICOS.every((c) => !erroCampo(c, l[c])));
```

- [ ] **Step 5.1: Teste da trava de submit (R3)**

Acrescente um `describe` novo ao arquivo **já existente** `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx`, reusando o helper `renderDialogCom` que já está lá (não crie um render novo). Mocke o hook para simular a org de roupa:

```tsx
// No topo do arquivo, junto dos outros vi.mock:
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({
  useTiposProdutoHabilitados: () => ({ data: ['roupa'] }),
}));

describe('DialogCadastroProduto — gênero obrigatório com tamanho (ADR-0166 / R3)', () => {
  it('linha COM tamanho e sem gênero mantém o botão de salvar travado', async () => {
    const user = userEvent.setup();
    renderDialogCom();
    await user.type(screen.getByLabelText(/Nome do produto/i), 'Camiseta Básica');
    await user.click(screen.getByRole('radio', { name: /Nacional/i }));
    await user.type(screen.getByLabelText(/Cor \/ nome/i), 'Azul');
    await user.type(screen.getByLabelText(/Preço da variação 1/i), '50');
    await user.selectOptions(screen.getByLabelText(/Tamanho da variação 1/i), 'P');

    expect(screen.getByRole('button', { name: /Avançar|Cadastrar/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    expect(screen.getByRole('button', { name: /Avançar|Cadastrar/i })).toBeEnabled();
  });

  it('SEM tamanho, gênero continua opcional — o botão libera sem ele (INV-1 do fluxo)', async () => {
    const user = userEvent.setup();
    renderDialogCom();
    await user.type(screen.getByLabelText(/Nome do produto/i), 'Zíper Nº5');
    await user.click(screen.getByRole('radio', { name: /Nacional/i }));
    await user.type(screen.getByLabelText(/Cor \/ nome/i), 'Azul');
    await user.type(screen.getByLabelText(/Preço da variação 1/i), '50');
    expect(screen.getByRole('button', { name: /Avançar|Cadastrar/i })).toBeEnabled();
  });
});
```

Ajuste os seletores de rótulo aos que o arquivo de teste existente já usa (ele é a referência do
que renderiza hoje); o nome do botão depende de o módulo fiscal estar ativo (`Avançar`) ou não
(`Cadastrar`) — use o mesmo caminho dos testes vizinhos, não invente um terceiro.

- [ ] **Step 6: Rodar a suíte do Estoque inteira**

Run: `pnpm test src/components/estoque`
Expected: PASS. Os testes pré-existentes do diálogo rodam sem o hook mockado — `useTiposProdutoHabilitados` devolve `undefined` (a RPC falha no ambiente de teste, sem retry), `gruposTamanho` fica `[]` e a tela renderiza exatamente como antes. **Se algum teste antigo quebrar, isso é sinal de que a condicional vazou — não ajuste o teste antigo, ajuste a condicional.**

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/components/estoque/
/usr/bin/git commit -m "feat(cadastro): gerador de variacoes cor x tamanho e campo genero (ADR-0166)"
```

---

### Task 16: Edge `cadastrar-produto` recusa tamanho de org sem tipo habilitado — e valor fora da lista do tipo

**Files:**
- Modify: `supabase/functions/cadastrar-produto/index.ts` (depois do gate de módulo, linha 39-41)
- Modify: `supabase/functions/cadastrar-produto/processar.ts` (novas funções `entradaTamanhoEfetiva` e `validarTamanhosDaEntrada`)
- Test: `supabase/functions/cadastrar-produto/__tests__/processar.test.ts` (novos `describe`)

**Interfaces:**
- Consumes: `tiposProdutoDaOrg` (Task 6); `tamanhosValidosParaTipos` da fonte única (Task 6, Step 0); `ProdutoEntrada.genero`/`VariacaoEntrada.tamanho` (Task 12).
- Produces:
  - `export function entradaTamanhoEfetiva(p: ProdutoEntrada, tipos: readonly string[]): ProdutoEntrada`
  - `export function validarTamanhosDaEntrada(p: ProdutoEntrada, tipos: readonly string[]): ErroValidacao[]` (**R7**)

**Por que:** `montarLinhasProduto` grava as colunas pela mera presença do campo — exatamente o mesmo risco que `fiscalEfetivo` já trata para o módulo fiscal. Uma chamada HTTP direta (ou um bug de front) mandando `tamanho` para uma org sem tipo habilitado gravaria um eixo de variação que a org não contratou, e esse eixo iria parar no payload do ML.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `supabase/functions/cadastrar-produto/__tests__/processar.test.ts`:

```ts
describe('entradaTamanhoEfetiva (ADR-0166)', () => {
  const base = {
    nomePai: 'Camiseta', origem: 'nacional' as const,
    chaveCadastro: '11111111-1111-4111-8111-111111111111',
    genero: 'masculino' as const,
    variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
  };

  it('org SEM tipo habilitado tem genero e tamanho descartados', () => {
    const r = entradaTamanhoEfetiva(base, []);
    expect(r.genero).toBeUndefined();
    expect(r.variacoes[0].tamanho).toBeUndefined();
  });

  it('org sem tipo mantem todo o resto intacto', () => {
    const r = entradaTamanhoEfetiva(base, []);
    expect(r.nomePai).toBe('Camiseta');
    expect(r.variacoes[0].nome).toBe('Azul');
    expect(r.variacoes[0].preco).toBe(50);
  });

  it('org COM roupa habilitado preserva genero e tamanho', () => {
    const r = entradaTamanhoEfetiva(base, ['roupa']);
    expect(r.genero).toBe('masculino');
    expect(r.variacoes[0].tamanho).toBe('P');
  });

  it('org com calcado tambem preserva — os tipos sao combinaveis, o gate e por presenca', () => {
    const r = entradaTamanhoEfetiva(base, ['calcado']);
    expect(r.variacoes[0].tamanho).toBe('P');
  });

  it('nao muta a entrada original', () => {
    const entrada = { ...base, variacoes: [{ ...base.variacoes[0] }] };
    entradaTamanhoEfetiva(entrada, []);
    expect(entrada.genero).toBe('masculino');
    expect(entrada.variacoes[0].tamanho).toBe('P');
  });
});

// R7 da revisao do Fable: ate aqui SO A UI restringia o valor de tamanho. Uma chamada HTTP
// direta (ou um front desatualizado) gravava 'XG' numa org de roupa, e esse valor virava uma
// linha de tabela de medidas no ML — dado de marketplace inventado, que e proibido.
describe('validarTamanhosDaEntrada (ADR-0166 / R7)', () => {
  const comTamanho = (tamanho: string) => ({
    nomePai: 'Camiseta', origem: 'nacional' as const,
    chaveCadastro: '11111111-1111-4111-8111-111111111111',
    genero: 'masculino' as const,
    variacoes: [{ nome: 'Azul', tamanho, preco: 50 }],
  });

  it('org de roupa aceita os tamanhos de roupa', () => {
    for (const t of ['P', 'M', 'G', 'GG', 'Tamanho Único']) {
      expect(validarTamanhosDaEntrada(comTamanho(t), ['roupa'])).toEqual([]);
    }
  });

  it('org de roupa RECUSA numeracao de calcado', () => {
    const erros = validarTamanhosDaEntrada(comTamanho('42'), ['roupa']);
    expect(erros).toHaveLength(1);
    expect(erros[0].campo).toBe('variacoes[0].tamanho');
    expect(erros[0].mensagem).toMatch(/42/);
  });

  it('org de calcado aceita numeracao e recusa P', () => {
    expect(validarTamanhosDaEntrada(comTamanho('42'), ['calcado'])).toEqual([]);
    expect(validarTamanhosDaEntrada(comTamanho('P'), ['calcado'])).toHaveLength(1);
  });

  it('org com os DOIS tipos aceita as duas listas', () => {
    expect(validarTamanhosDaEntrada(comTamanho('P'), ['roupa', 'calcado'])).toEqual([]);
    expect(validarTamanhosDaEntrada(comTamanho('42'), ['roupa', 'calcado'])).toEqual([]);
  });

  it('valor inventado e recusado com o valor na mensagem, nunca corrigido', () => {
    expect(validarTamanhosDaEntrada(comTamanho('XGG'), ['roupa'])[0].mensagem).toMatch(/XGG/);
  });

  it('variacao sem tamanho nao produz erro nenhum — INV-1', () => {
    const sem = { ...comTamanho('P'), variacoes: [{ nome: 'Azul', preco: 50 }] };
    expect(validarTamanhosDaEntrada(sem, ['roupa'])).toEqual([]);
    expect(validarTamanhosDaEntrada(sem, [])).toEqual([]);
  });
});
```

Acrescente `entradaTamanhoEfetiva` e `validarTamanhosDaEntrada` ao import do topo do arquivo de teste.

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/cadastrar-produto/__tests__/processar.test.ts -t "entradaTamanhoEfetiva"`
Expected: FAIL — `entradaTamanhoEfetiva is not a function`.

- [ ] **Step 3: Escrever a função**

Em `supabase/functions/cadastrar-produto/processar.ts`, logo abaixo de `fiscalEfetivo`:

```ts
/** ADR-0166. Mesmo motivo de `fiscalEfetivo`: `montarLinhasProduto` grava as colunas pela mera
 *  PRESENÇA do campo, então um payload com `genero`/`tamanho` vindo de uma org SEM tipo de
 *  produto habilitado (engano do front, ou chamada HTTP direta) tem que ser descartado ANTES de
 *  chegar lá. Sem isto a org grava um eixo de variação que não contratou, e esse eixo chega ao
 *  payload do Mercado Livre.
 *
 *  Não muta a entrada — devolve cópia rasa com as variações também copiadas. */
export function entradaTamanhoEfetiva(
  p: ProdutoEntrada, tipos: readonly string[],
): ProdutoEntrada {
  if (tipos.length > 0) return p;
  return {
    ...p,
    genero: undefined,
    variacoes: p.variacoes.map((v) => ({ ...v, tamanho: undefined })),
  };
}

/** R7 (revisão do Fable): o valor de `tamanho` tem que pertencer à lista do TIPO da org. Antes
 *  disto só a UI restringia — uma chamada HTTP direta gravava 'XG' numa org de roupa, e esse
 *  valor viraria uma linha da tabela de medidas no ML (dado de marketplace inventado, proibido
 *  pelo CLAUDE.md).
 *
 *  Roda DEPOIS de `entradaTamanhoEfetiva`: para org sem tipo habilitado o campo já chegou aqui
 *  zerado, então esta função é um no-op para ela (INV-1). A lista vem da fonte única
 *  (`_shared/produto/tipos-produto-valores.ts`), a mesma que o frontend usa — não há segunda
 *  cópia para divergir. */
export function validarTamanhosDaEntrada(
  p: ProdutoEntrada, tipos: readonly string[],
): ErroValidacao[] {
  const validos = tamanhosValidosParaTipos(tipos);
  const erros: ErroValidacao[] = [];
  p.variacoes?.forEach((v, i) => {
    const t = v.tamanho?.trim();
    if (!t) return;
    if (!validos.includes(t)) {
      erros.push({
        campo: `variacoes[${i}].tamanho`,
        mensagem: `Tamanho "${t}" não pertence à lista do tipo de produto desta organização.`,
      });
    }
  });
  return erros;
}
```

Imports novos no topo de `processar.ts`:

```ts
import { tamanhosValidosParaTipos } from '../_shared/produto/tipos-produto-valores.ts';
import type { ErroValidacao } from '../_shared/produto/validar.ts';
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/cadastrar-produto/__tests__/processar.test.ts`
Expected: PASS — os 5 casos de `entradaTamanhoEfetiva`, os 6 de `validarTamanhosDaEntrada` (R7) e todos os anteriores.

- [ ] **Step 5: Ligar no handler**

Em `supabase/functions/cadastrar-produto/index.ts`:

(a) No import de `./processar.ts`, acrescente `entradaTamanhoEfetiva`.

(b) Acrescente o import do gate:

```ts
import { tiposProdutoDaOrg } from '../_shared/produto/tipo-produto.ts';
```

(c) Logo **depois** da linha `produto.fiscal = fiscalEfetivo(produto, moduloFiscal);` e **antes** de `const erros = validarProdutoNovo(produto);`:

```ts
  // ADR-0166: gênero/tamanho só existem para org com tipo de produto habilitado. Diferente do
  // gate de módulo (que devolve 403), aqui o payload é SANEADO em vez de recusado: o campo é
  // aditivo e o cadastro sem ele é um cadastro válido — recusar transformaria um front
  // desatualizado num cadastro impossível. `tiposProdutoDaOrg` LANÇA em erro de leitura (nunca
  // devolve [] silencioso), e o throw sobe como 500 — o operador retenta.
  const tiposProduto = await tiposProdutoDaOrg(admin, orgId);
  produto = entradaTamanhoEfetiva(produto, tiposProduto);

  // R7: valor de tamanho fora da lista do tipo da org é 400 explícito, na MESMA forma dos erros
  // de `validarProdutoNovo` (o handler já sabe responder `{ erros }` com 400). Nunca corrigir
  // para o valor "mais parecido": isso é inventar dado de produto.
  const errosTamanho = validarTamanhosDaEntrada(produto, tiposProduto);
  if (errosTamanho.length > 0) return json({ erros: errosTamanho }, 400);
```

Em (a), o import de `./processar.ts` leva `entradaTamanhoEfetiva` **e** `validarTamanhosDaEntrada`.

Atenção: `produto` é declarado com `let` (linha 55), então a reatribuição funciona sem mudança de declaração.

- [ ] **Step 6: Verificar tipos e lint**

Run: `pnpm check:functions && pnpm lint:functions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/functions/cadastrar-produto/
/usr/bin/git commit -m "feat(cadastro): edge descarta genero/tamanho de org sem tipo habilitado (ADR-0166)"
```

---

### Task 16A: Família com tamanho recusa o fluxo "Adicionar variação" (R4 da revisão do Fable)

**model: sonnet.**

**Files:**
- Modify: `supabase/functions/adicionar-variacoes-familia/index.ts` (guard novo, logo depois da leitura de `variacoesVivas`, linha ~127-131, junto dos outros 409/400 de pré-condição)
- Modify: `supabase/functions/adicionar-variacoes-familia/processar.ts` (`montarVariacaoNova` ganha `tamanho: null`)
- Test: `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts` (o `describe` de paridade de chaves, linha ~228)

**Interfaces:**
- Consumes: `variacoes.tamanho` (Task 10).
- Produces: nada novo — fecha dois buracos que a Fase 2 abriu.

**Por que esta tarefa existe.** O fluxo "adicionar variação a família já publicada" (ADR-0129)
insere `variacoes` por um caminho **próprio**, que não passa por `cadastrar-produto`,
`validarProdutoNovo` nem `entradaTamanhoEfetiva`. Dois defeitos concretos:

1. **Família mista.** O diálogo `src/components/estoque/dialog-adicionar-variacao.tsx` reusa
   `LinhaVariacaoForm` **sem** `gruposTamanho`, então a cor nova nasce com `tamanho: null`. Numa
   família que já tem tamanho isso produz uma variação sem `SIZE_GRID_ROW_ID` no meio de um
   anúncio que tem — o ML recusa o PUT inteiro, e junto vai o estoque. A trava da Task 21
   (`v.tamanho && !v.sizeGridRowId`) **não pega** este caso, porque aqui `tamanho` é nulo.
   *Regra:* **se a família tem QUALQUER variação com tamanho preenchido, toda variação nova
   precisa ter tamanho.* No v1, a única forma de garantir isso sem construir meia-feature de UI
   é **recusar o fluxo inteiro** para essas famílias, com mensagem clara.
2. **Conjunto de chaves.** `clonarVariacao` copia de `select('*')` — com a coluna nova ele passa
   a carregar `tamanho`, enquanto `montarVariacaoNova` (processar.ts:191) enumera as chaves à
   mão. O invariante documentado em processar.ts:176-190 (o bug de 2026-08-21: insert multi-row
   com chaves heterogêneas preenche NULL explícito e atropela o DEFAULT da coluna) quebra, e o
   teste de paridade de chaves **falha**. Isso não é opcional nem "da Fase 6": é regressão
   direta da migration da Fase 2.

> **Nota (checkpoint Fable — fim da Fase 2, 2026-09-19):** o item 2 acima (regressão da paridade de
> chaves) já foi corrigido **fora de ordem**, na hora, para não deixar a branch com CI vermelho
> entre a Fase 2 e a Fase 3 — commit `9387234f`, `tamanho: null` já está em `montarVariacaoNova`
> (posição ligeiramente diferente do Step 2 abaixo: logo depois de `cor_editada_pelo_operador:
> false,`, não de `cor_origem: 'manual',` — funcionalmente idêntico). **O Step 1 abaixo vai PASSAR,
> não falhar** — isso é esperado, não sinal de migration não aplicada. **Pule o Step 2** (já feito)
> e vá direto para o Step 3 (o guard de 400 no `index.ts`, item 1 acima — esse continua pendente).

- [ ] **Step 1: Ver o teste de paridade de chaves falhar depois da Fase 2**

```bash
pnpm test supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts -t "paridade de chaves"
```

Expected: **FAIL** — `chavesClone()` tem `tamanho` e `chavesNova()` não. Se passar, confirme que
a migration da Fase 2 já está aplicada no banco de onde o fixture do teste foi tirado (o teste
compara contra a lista de colunas esperada, linha ~251 — ela também precisa ganhar `tamanho`).

- [ ] **Step 2: Acrescentar `tamanho` ao builder da linha nova (JÁ FEITO — ver nota acima, pule para o Step 3)**

Em `supabase/functions/adicionar-variacoes-familia/processar.ts`, dentro de `montarVariacaoNova`,
logo depois de `cor_origem: 'manual',`:

```ts
    // ADR-0166: a linha nova NASCE sem eixo de tamanho. Presente explicitamente (não omitido)
    // porque `clonarVariacao` copia de `select('*')` e leva `tamanho` junto: chave presente num
    // objeto e ausente no outro faz o PostgREST montar a UNIÃO e gravar NULL explícito no lado
    // que não a tem — foi exatamente o bug de 2026-08-21 descrito acima. O valor null aqui é o
    // correto porque o Step 3 recusa o fluxo quando a família TEM tamanho; se algum dia este
    // fluxo passar a aceitar família com tamanho, este campo deixa de ser null e vira entrada.
    tamanho: null,
```

E acrescente `'tamanho'` à lista de colunas esperadas no teste de paridade (linha ~251), na
mesma posição em que a coluna aparece no schema real.

- [ ] **Step 3: Escrever o teste do guard (na suíte da edge) e o guard**

O guard depende da família **existente**, não do corpo da requisição — por isso ele **não** vai
em `validarEntrada` (que só enxerga o body) e sim no handler, junto dos outros 409/400 de
pré-condição, logo depois da leitura de `variacoesVivas`:

```ts
  // ADR-0166 / R4: adicionar cor a família COM tamanho está fora do escopo do v1.
  //
  // O diálogo deste fluxo não oferece o campo Tamanho, então a cor nova nasceria sem
  // SIZE_GRID_ROW_ID dentro de um anúncio que tem — o ML recusa o PUT INTEIRO e derruba o
  // estoque junto (mesma classe do lote #45). Recusar é a opção honesta: melhor um erro claro
  // do que um anúncio quebrado. O caminho para o operador é o cadastro completo, que gera o
  // cartesiano cor × tamanho de uma vez.
  if ((variacoesVivas ?? []).some((v) => (v.tamanho as string | null)?.trim())) {
    return json({
      error: 'Este produto usa tamanho/numeração — adicionar cor por aqui ainda não é suportado. '
        + 'Cadastre as combinações de cor e tamanho pelo cadastro de produto.',
    }, 400);
  }
```

Teste (no estilo dos que já existem na suíte da edge; se não houver teste de handler, cubra a
regra extraindo-a como função pura `familiaTemTamanho(variacoes)` em `processar.ts` e teste-a):

```ts
describe('familiaTemTamanho (ADR-0166 / R4)', () => {
  it('familia sem tamanho nenhum libera o fluxo', () => {
    expect(familiaTemTamanho([{ tamanho: null }, { tamanho: '  ' }])).toBe(false);
  });

  it('UMA variacao com tamanho ja bloqueia — familia mista nao pode nascer', () => {
    expect(familiaTemTamanho([{ tamanho: null }, { tamanho: 'P' }])).toBe(true);
  });

  it('lista vazia nao bloqueia', () => {
    expect(familiaTemTamanho([])).toBe(false);
  });
});
```

- [ ] **Step 4: Deixar explícito que o diálogo NÃO ganha o campo nesta entrega**

Em `src/components/estoque/dialog-adicionar-variacao.tsx`, no comentário de topo do componente:

```tsx
// ADR-0166 / R4: este fluxo NÃO oferece o campo Tamanho de propósito (v1). A edge
// `adicionar-variacoes-familia` recusa com 400 a família que tem tamanho, e o erro aparece aqui
// pelo caminho de erro que já existe. Meia-feature (campo sem resolver a tabela de medidas nem o
// SIZE_GRID_ROW_ID da cor nova) publicaria um anúncio quebrado — por isso recusa, não remendo.
```

- [ ] **Step 5: Rodar e commitar**

```bash
pnpm test supabase/functions/adicionar-variacoes-familia
pnpm check:functions
/usr/bin/git add supabase/functions/adicionar-variacoes-familia/ src/components/estoque/dialog-adicionar-variacao.tsx
/usr/bin/git commit -m "fix(addvar): recusa adicionar cor a familia com tamanho e mantem paridade de chaves (ADR-0166)"
```

---

> ### **Checkpoint Fable — fim da Fase 3** (recomendado, não bloqueante)
>
> O Fable revisa o diff da Fase 3 antes de a Fase 4 começar. Perguntas explícitas:
>
> 1. O casamento **posicional** de foto e de estoque inicial (`cadastrar-produto/index.ts`, comentário do laço) continua correto com o cartesiano? A ordem de `linhas` no front é a mesma de `produto.variacoes` no payload e a mesma de `codigos[i]`?
> 2. A trava de SKU duplicado (cor, tamanho) da Task 12 cobre o caso em que o operador gera 4×5 e depois edita duas linhas até coincidirem?
> 3. `entradaTamanhoEfetiva` sanear em vez de recusar está certo, ou deveria devolver 400 como `validarFiscalDaEntrada` faz?
> 4. Algum teste antigo do diálogo precisou ser alterado? (Se sim, é sinal de vazamento do INV-1.)

---

# Fase 4 — Guia de tamanhos do ML (tabelas de medidas)

**model: opus** (marketplace-sensível: um payload errado aqui derruba a publicação de um anúncio real, ou pior, publica com a tabela de outro gênero).

> ## ⛔ **NÃO EXECUTAR até o spike da Fase 0 estar aprovado pelo Fable**
>
> Nenhuma tarefa desta fase pode ser iniciada enquanto:
>
> 1. `docs/spikes/051-guia-tamanhos-ml-api.md` não existir **e** tiver as seções 2, 3, 4, 5 e 8 marcadas `CONFIRMADO` com o comando e a resposta que as produziram; **e**
> 2. `docs/decisions/0167-guia-de-tamanhos-gerenciado-via-api.md` não estiver escrito; **e**
> 3. o **Checkpoint Fable do fim da Fase 0** não tiver parecer favorável.
>
> Motivo, medido: em 2026-09-18 as 10 URLs da documentação oficial do ML sobre size charts devolveram **HTTP 403**. Os únicos dados disponíveis são resumos de busca, contraditórios entre si (os `value_id` de gênero que apareceram não foram confirmados em nenhuma fonte primária). **Nenhum corpo JSON desta fase pode ser escrito por dedução.** Toda constante, todo path e todo id de atributo é copiado literalmente do spike.
>
> As Fases 1, 2, 3 e 6 **não** dependem deste bloqueio e podem ser executadas antes.

### Task 17: Migration — vínculo com a tabela de medidas

**Files:**
- Create: `supabase/migrations/<timestamp>_adr167_size_chart_vinculo.sql`
- Modify: `src/lib/database.types.ts` (regerado)

**Interfaces:**
- Consumes: spike 051 seção 4 (onde os ids entram no item) e seção 9 (a tabela pertence à conta ML) → ADR-0167.
- Produces: colunas de vínculo. **Os nomes exatos e a tabela de destino saem do ADR-0167** — as duas formas possíveis, e o critério de escolha, estão no Step 1.

- [ ] **Step 1: Ler o ADR-0167 e travar a forma**

```bash
grep -n "Decisão 2" -A 12 docs/decisions/0167-guia-de-tamanhos-gerenciado-via-api.md
```

O ADR decidiu uma destas duas formas (e só uma):

- **Forma A — a tabela é por org × gênero × domínio.** Então nasce uma tabela nova `ml_size_charts (id, org_id, conta_externa_id, dominio, genero, chart_id, criado_em)` com `unique (org_id, conta_externa_id, dominio, genero)`, mais `variacoes.size_chart_row_id text null`. `familias` não ganha coluna: a chart é resolvida por `(domínio, gênero)` no momento de publicar.

  **`chart_id` é NULLABLE, de propósito (R5 da revisão do Fable).** A fila de publicação é serial
  por **usuário** (`publish-ml-${userId}`, `_shared/queue.ts:87`), **não** por organização: dois
  usuários da mesma org publicando ao mesmo tempo correm em paralelo. Uma unique que só é
  verificada no `upsert` final dedupe a LINHA depois de a API do ML já ter sido chamada duas
  vezes — e aí a conta do vendedor fica com duas tabelas de medidas para o mesmo gênero+domínio,
  uma delas órfã. Por isso a linha é **reservada com `chart_id` nulo ANTES** da chamada à API
  (Task 19): a unique passa a arbitrar a corrida no ponto certo, antes da escrita externa.
- **Forma B — a tabela é por família.** Então `familias.size_chart_id text null` e `variacoes.size_chart_row_id text null`, sem tabela nova.

Se o ADR-0167 não deixa claro qual das duas, **pare e volte ao Task 3** — esta migration não é o lugar de decidir.

- [ ] **Step 2: Criar e escrever a migration**

```bash
supabase migration new adr167_size_chart_vinculo
```

O corpo segue o padrão das migrations do projeto: cabeçalho de comentário sem acentos explicando o porquê e citando o ADR-0167 e o spike 051; `add column if not exists`; `comment on column`. Na **Forma A**, a tabela nova precisa de `chart_id` nulável, da unique que arbitra a corrida e da RLS:

```sql
-- chart_id NULL = linha RESERVADA: alguem ganhou a corrida e esta chamando a API do ML agora.
-- A reserva existe porque a fila serial e por USUARIO (publish-ml-${userId}), nao por org: dois
-- usuarios da mesma org publicam em paralelo e criariam duas tabelas de medidas na conta do
-- vendedor se a unique so fosse verificada DEPOIS da chamada externa (R5).
create table if not exists public.ml_size_charts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conta_externa_id text not null,
  dominio text not null,
  genero text not null,
  chart_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ml_size_charts_unica unique (org_id, conta_externa_id, dominio, genero)
);

comment on column public.ml_size_charts.chart_id is
  'ADR-0167: id da tabela de medidas no ML. NULL = linha reservada, criacao em andamento (R5).';

alter table public.ml_size_charts enable row level security;

create policy ml_size_charts_org on public.ml_size_charts
  for all
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
```

RLS por `org_id` é regra inegociável do projeto — tabela de domínio nova **não** entra sem policy.

- [ ] **Step 3: Aplicar, validar e regerar**

```bash
supabase db push
npm run db:check
supabase gen types typescript --project-id txvncrgkoynoxwopfkbp --schema public > src/lib/database.types.ts
```

Expected: `db:check` sem divergência; os tipos refletem as colunas/tabela novas.

- [ ] **Step 4: Provar o isolamento por org (Forma A)**

Se a Forma A foi escolhida, rode pelo SQL read-only e confirme que a policy existe e que não há `using (true)`:

```sql
select polname, pg_get_expr(polqual, polrelid) as usando
from pg_policy where polrelid = 'public.ml_size_charts'::regclass;
```

Expected: uma policy, com `current_org_id()` na expressão.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/migrations/ src/lib/database.types.ts
/usr/bin/git commit -m "feat(schema): vinculo com a tabela de medidas do ML (ADR-0167)"
```

---

### Task 18: Cliente da API de tabelas de medidas — `_shared/ml/size-chart.ts`

**Files:**
- Create: `supabase/functions/_shared/ml/size-chart.ts`
- Test: `supabase/functions/_shared/ml/__tests__/size-chart.test.ts`

**Interfaces:**
- Consumes: spike 051 seções 3, 5 e 7 (payload, endpoints, colunas por domínio).
- Produces:
  - `export interface LinhaChart { rowId: string; tamanho: string }`
  - `export function montarCorpoChart(args: { dominio: string; genero: string; tamanhos: string[] }): Record<string, unknown>` — **o corpo é copiado literalmente do spike, seção 3**
  - `export async function criarChart(token: string, corpo: Record<string, unknown>): Promise<{ chartId: string; linhas: LinhaChart[] }>`
  - `export async function buscarChart(token: string, chartId: string): Promise<{ chartId: string; linhas: LinhaChart[] }>`

- [ ] **Step 1: Copiar o corpo confirmado do spike para o teste**

Abra `docs/spikes/051-guia-tamanhos-ml-api.md` seção 3 e copie o JSON **exatamente como o ML aceitou**. O teste é escrito contra ele:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { montarCorpoChart, criarChart, buscarChart } from '../size-chart.ts';

// COLE AQUI o corpo literal da seção 3 do spike 051, sem editar nada.
const CORPO_ESPERADO = { /* ← do spike */ };

describe('montarCorpoChart', () => {
  it('monta exatamente o corpo que o ML aceitou no spike 051', () => {
    expect(montarCorpoChart({ dominio: '<do spike>', genero: '<do spike>', tamanhos: ['P', 'M', 'G'] }))
      .toEqual(CORPO_ESPERADO);
  });

  it('uma linha por tamanho, na ordem recebida', () => {
    const corpo = montarCorpoChart({ dominio: '<do spike>', genero: '<do spike>', tamanhos: ['P', 'M'] });
    expect((corpo.rows as unknown[]).length).toBe(2);
  });

  it('lista de tamanhos vazia LANCA — chart sem linha nao serve para nada', () => {
    expect(() => montarCorpoChart({ dominio: 'X', genero: 'Y', tamanhos: [] }))
      .toThrow(/sem tamanho/i);
  });
});

describe('criarChart', () => {
  afterEach(() => vi.restoreAllMocks());

  it('devolve chartId e a linha de cada tamanho', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      // COLE AQUI a resposta real do spike 051, seção 3.
      json: () => Promise.resolve({ /* ← do spike */ }),
    }));
    const r = await criarChart('tok', montarCorpoChart({ dominio: '<do spike>', genero: '<do spike>', tamanhos: ['P'] }));
    expect(r.chartId).toBeTruthy();
    expect(r.linhas).toHaveLength(1);
  });

  it('erro do ML vira Error com .status — o QStash precisa distinguir 4xx de 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: () => Promise.resolve({ message: 'invalid' }),
    }));
    await expect(criarChart('tok', {})).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/size-chart.test.ts`
Expected: FAIL — `Failed to resolve import "../size-chart.ts"`.

- [ ] **Step 3: Escrever o módulo**

Estrutura obrigatória (o miolo de cada função vem do spike; o que está fixado aqui é a forma):

- Cabeçalho de comentário citando `docs/spikes/051-guia-tamanhos-ml-api.md` e o ADR-0167, e a frase: *"todo path e todo campo deste arquivo foi copiado do spike; nada foi deduzido"*.
- `erroML(status, json)` — reusar `humanizarErroML` de `./erro-ml.ts`, exatamente como `atualizar-item.ts` faz, e anexar `.status` ao `Error` (sem isso o `decidirRetryPorErro` trata 400 como retentável e a fila retenta cinco minutos um erro definitivo).
- `montarCorpoChart` puro (sem `fetch`), para ser testável sem rede.
- `criarChart`/`buscarChart` usando `fetch` com `Authorization: Bearer`.
- **Idempotência (regra inegociável):** `criarChart` nunca é chamado sem antes consultar o vínculo já gravado (Task 17). Quem orquestra é a Task 19 — este módulo é só o cliente HTTP.

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/size-chart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/ml/size-chart.ts supabase/functions/_shared/ml/__tests__/size-chart.test.ts
/usr/bin/git commit -m "feat(ml): cliente da API de tabelas de medidas (ADR-0167, spike 051)"
```

---

### Task 19: Resolver a tabela de medidas antes de publicar (idempotente)

**Files:**
- Create: `supabase/functions/_shared/ml/resolver-size-chart.ts`
- Test: `supabase/functions/_shared/ml/__tests__/resolver-size-chart.test.ts`

**Interfaces:**
- Consumes: `criarChart`/`buscarChart` (Task 18); as colunas de Task 17.
- Produces:
  - `export async function resolverSizeChart(deps, args: { orgId: string; contaExternaId: string; dominio: string; genero: string; tamanhos: string[] }): Promise<{ chartId: string; rowIdPorTamanho: Record<string, string> }>` — miolo puro, dependências injetadas.
  - `export function resolverComSupabase(admin: SupabaseClient, token: string)` — adaptador real, consumido pela Task 23.
- Dependências injetadas (**mudou na R5**): `lerVinculo`, **`reservarVinculo`** (INSERT com `chart_id` nulo), **`liberarReserva`** (DELETE da reserva quando o ML falha), **`confirmarVinculo`** (UPDATE com o `chart_id` devolvido pelo ML), `criar`, `buscar`. O antigo `gravarVinculo` (upsert depois da API) **não existe mais** — era exatamente o desenho que duplicava a tabela no ML.

**Ordem obrigatória (R5 da revisão do Fable): reserva local → chamada ao ML → confirmação local.**
A fila serial é por **usuário** (`publish-ml-${userId}`), não por organização, então duas
publicações da mesma org correm em paralelo. Com o upsert depois da API, as duas chamavam
`POST /catalog/charts` antes de qualquer unique morder: a conta do vendedor ficava com duas
tabelas de medidas para o mesmo gênero+domínio e o anúncio apontando para uma delas ao acaso.
Reservando a linha primeiro, a unique `(org_id, conta_externa_id, dominio, genero)` decide quem
chama a API — e quem perdeu **não chama**.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolverSizeChart } from '../resolver-size-chart.ts';

function deps(over: Partial<Parameters<typeof resolverSizeChart>[0]> = {}) {
  return {
    lerVinculo: vi.fn().mockResolvedValue(null),
    // R5: reserva a linha ANTES de chamar o ML. Devolve false quando a unique recusou
    // (outra requisicao ja reservou).
    reservarVinculo: vi.fn().mockResolvedValue(true),
    liberarReserva: vi.fn().mockResolvedValue(undefined),
    confirmarVinculo: vi.fn().mockResolvedValue(undefined),
    criar: vi.fn().mockResolvedValue({ chartId: 'CH1', linhas: [{ rowId: 'R1', tamanho: 'P' }] }),
    buscar: vi.fn().mockResolvedValue({ chartId: 'CH1', linhas: [{ rowId: 'R1', tamanho: 'P' }] }),
    ...over,
  };
}
const ARGS = { orgId: 'o1', contaExternaId: 'c1', dominio: 'D', genero: 'masculino', tamanhos: ['P'] };

describe('resolverSizeChart', () => {
  it('sem vinculo: reserva, cria a chart e confirma o vinculo — NESTA ordem', async () => {
    const d = deps();
    const r = await resolverSizeChart(d, ARGS);
    expect(d.reservarVinculo).toHaveBeenCalledTimes(1);
    expect(d.criar).toHaveBeenCalledTimes(1);
    expect(d.confirmarVinculo).toHaveBeenCalledWith(expect.objectContaining({ chartId: 'CH1' }));
    // A ordem e o ponto da correcao: reservar DEPOIS de criar nao dedupe nada.
    expect(d.reservarVinculo.mock.invocationCallOrder[0])
      .toBeLessThan(d.criar.mock.invocationCallOrder[0]);
    expect(r.rowIdPorTamanho).toEqual({ P: 'R1' });
  });

  // R5: a corrida real — dois usuarios da MESMA org publicando ao mesmo tempo (a fila serial e
  // por usuario, nao por org). Quem perde a reserva NAO chama a API do ML: duas charts na conta
  // do vendedor e um estrago que nenhuma unique local desfaz.
  it('reserva recusada pela unique: NAO chama a API e lanca erro RETENTAVEL (sem .status)', async () => {
    const d = deps({ reservarVinculo: vi.fn().mockResolvedValue(false) });
    await expect(resolverSizeChart(d, ARGS)).rejects.toMatchObject({ status: undefined });
    expect(d.criar).not.toHaveBeenCalled();
  });

  // Reserva ganha por outro que ainda nao terminou a chamada ao ML: `chart_id` nulo NAO pode ser
  // lido como "nao existe chart", senao a segunda requisicao cria a duplicata assim mesmo.
  it('vinculo reservado mas ainda sem chart_id: retentavel, e NAO cria', async () => {
    const d = deps({ lerVinculo: vi.fn().mockResolvedValue({ chartId: null }) });
    await expect(resolverSizeChart(d, ARGS)).rejects.toThrow(/em andamento|reservad/i);
    expect(d.criar).not.toHaveBeenCalled();
  });

  // Compensacao: sem ela, UMA falha transitoria do ML deixava a linha reservada para sempre e
  // toda publicacao seguinte desse genero/dominio caia no caso (2) — bloqueio permanente.
  it('falha do ML depois da reserva LIBERA a reserva e propaga o erro', async () => {
    const d = deps({ criar: vi.fn().mockRejectedValue(Object.assign(new Error('ml 500'), { status: 500 })) });
    await expect(resolverSizeChart(d, ARGS)).rejects.toThrow(/ml 500/);
    expect(d.liberarReserva).toHaveBeenCalledTimes(1);
    expect(d.confirmarVinculo).not.toHaveBeenCalled();
  });

  it('depois da liberacao, a proxima tentativa reserva de novo e conclui', async () => {
    const criar = vi.fn()
      .mockRejectedValueOnce(new Error('ml 500'))
      .mockResolvedValue({ chartId: 'CH1', linhas: [{ rowId: 'R1', tamanho: 'P' }] });
    const d = deps({ criar });
    await expect(resolverSizeChart(d, ARGS)).rejects.toThrow(/ml 500/);
    const r = await resolverSizeChart(d, ARGS);
    expect(r.chartId).toBe('CH1');
    expect(d.reservarVinculo).toHaveBeenCalledTimes(2);
  });

  // Idempotencia (regra inegociavel): a segunda publicacao da mesma familia NAO pode criar uma
  // segunda tabela na conta do vendedor.
  it('com vinculo: reusa e NAO cria', async () => {
    const d = deps({ lerVinculo: vi.fn().mockResolvedValue({ chartId: 'CH1' }) });
    await resolverSizeChart(d, ARGS);
    expect(d.criar).not.toHaveBeenCalled();
    expect(d.buscar).toHaveBeenCalledWith('CH1');
  });

  it('tamanho pedido que a chart existente nao tem LANCA — publicar sem a linha certa poria o SKU no tamanho errado', async () => {
    const d = deps({
      lerVinculo: vi.fn().mockResolvedValue({ chartId: 'CH1' }),
      buscar: vi.fn().mockResolvedValue({ chartId: 'CH1', linhas: [{ rowId: 'R1', tamanho: 'P' }] }),
    });
    await expect(resolverSizeChart(d, { ...ARGS, tamanhos: ['P', 'GG'] })).rejects.toThrow(/GG/);
  });

  it('gênero diferente resolve para outra chart', async () => {
    const d = deps();
    await resolverSizeChart(d, { ...ARGS, genero: 'feminino' });
    expect(d.lerVinculo).toHaveBeenCalledWith(expect.objectContaining({ genero: 'feminino' }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/resolver-size-chart.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Injeção de dependências explícita (`lerVinculo`/`reservarVinculo`/`confirmarVinculo`/`criar`/`buscar`) para o miolo ser testável sem Supabase nem rede — mesmo padrão de `_shared/user-products/portas-supabase.ts`. Esqueleto obrigatório do corpo:

```ts
export async function resolverSizeChart(deps: DepsSizeChart, args: ArgsSizeChart) {
  const vinculo = await deps.lerVinculo(args);

  // (1) Vínculo COMPLETO → reusa. Nunca cria uma segunda tabela na conta do vendedor.
  if (vinculo?.chartId) return mapear(await deps.buscar(vinculo.chartId), args.tamanhos);

  // (2) Vínculo RESERVADO (chart_id nulo): outra requisição está criando a chart agora. Ler isso
  // como "não existe" recria a duplicata que a reserva existe para evitar. Erro SEM `.status`,
  // que é como o sistema marca falha transitória — o QStash retenta e na volta o (1) resolve.
  if (vinculo) {
    throw new Error(
      'Tabela de medidas em andamento para este gênero/domínio (linha reservada por outra '
      + 'publicação). Retentando.',
    );
  }

  // (3) Reserva a linha ANTES de tocar na API do ML. A unique (org, conta, dominio, genero) é
  // quem arbitra a corrida — a fila serial do projeto é por USUÁRIO, e não protege duas
  // publicações da mesma org (R5).
  const ganhou = await deps.reservarVinculo(args);
  if (!ganhou) {
    // Perdeu a corrida por conflito de unique. NÃO chama a API: quem ganhou está criando.
    // Sem `.status` de propósito → retry normal da fila, não um 4xx definitivo.
    throw new Error('Outra publicação já reservou a tabela de medidas deste gênero/domínio. Retentando.');
  }

  // (4) Só agora a escrita externa — e com compensação. Se o ML falhar, a reserva TEM que ser
  // liberada: sem isso a linha fica com `chart_id` nulo para sempre, todo retry cai no caso (2)
  // e a org nunca mais publica nesse gênero/domínio. Uma falha transitória do ML viraria um
  // bloqueio permanente — pior do que a duplicata que a reserva evita.
  let criada;
  try {
    criada = await deps.criar(montarCorpoChart({ ...args }));
  } catch (e) {
    await deps.liberarReserva(args); // DELETE ... where chart_id is null — nunca toca confirmada
    throw e;
  }
  await deps.confirmarVinculo({ ...args, chartId: criada.chartId });
  return mapear(criada, args.tamanhos);
}
```

Mais duas regras no `mapear`:

- Tamanho pedido que não existe na chart → `throw` com o tamanho na mensagem e `.status = 400`. Publicar sem a linha certa poria o SKU no tamanho errado no anúncio real — falha LOUD, nunca fallback. `.status = 400` porque é dado do produto que não fecha: retentar cinco minutos não conserta.
- Erro de **leitura** (banco) e perda de corrida → `throw` **sem** `.status` (transitório).

> **Teto conhecido (`ponytail`):** a compensação do passo (4) cobre a falha do ML, que é o caso
> comum. O que ela **não** cobre é o worker morrer entre a reserva e a compensação (timeout duro
> do runtime): aí a linha fica reservada e todo retry cai no caso (2). É raro e visível (o
> operador vê o erro, e a linha é uma só por gênero+domínio); se aparecer em produção, a saída é
> expirar reservas com `criado_em` antigo (`chart_id is null and criado_em < now() - interval
> '10 minutes'`), **não** afrouxar o caso (2) — afrouxar recria a duplicata no ML.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/resolver-size-chart.test.ts`
Expected: PASS, 9 testes (os 4 originais + 3 da corrida + 2 da compensação da reserva, R5).

- [ ] **Step 5: Criar o adaptador real (`resolverComSupabase`), no mesmo arquivo**

O miolo acima é injetável para ser testável. O adaptador que amarra as quatro dependências ao Supabase e ao `fetch` real mora ao lado dele, mesmo padrão de `_shared/user-products/portas-supabase.ts`. Acrescente ao fim de `resolver-size-chart.ts`:

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { criarChart, buscarChart } from './size-chart.ts';

/** Liga `resolverSizeChart` ao banco e à API real. Na **Forma A** do ADR-0167 o vínculo vive em
 *  `ml_size_charts (org_id, conta_externa_id, dominio, genero, chart_id)`; na **Forma B**, em
 *  `familias.size_chart_id`. Use a que o ADR-0167 fixou — o `select`/`upsert` abaixo é o da
 *  Forma A e precisa ser trocado se a decisão foi a B. */
export function resolverComSupabase(admin: SupabaseClient, token: string) {
  return (args: Parameters<typeof resolverSizeChart>[1]) => resolverSizeChart({
    lerVinculo: async (k) => {
      const { data, error } = await admin.from('ml_size_charts')
        .select('chart_id')
        .eq('org_id', k.orgId).eq('conta_externa_id', k.contaExternaId)
        .eq('dominio', k.dominio).eq('genero', k.genero)
        .maybeSingle();
      // Erro de leitura NUNCA vira "não existe": isso criaria uma segunda tabela na conta do
      // vendedor a cada falha transitória. Lança e o QStash retenta.
      if (error) throw new Error(`lerVinculo: ml_size_charts: ${error.message}`);
      // Linha presente com `chart_id` nulo é RESERVA em andamento — devolvida como
      // `{ chartId: null }`, e o miolo trata como transitório. Devolver `null` aqui seria dizer
      // "não existe" e recriar a chart duplicada no ML (R5).
      return data ? { chartId: (data.chart_id as string | null) ?? null } : null;
    },
    // R5: INSERT puro (sem upsert, sem ignoreDuplicates) — a violação de unique é o SINAL de
    // que outra requisição ganhou a corrida, e é ela que impede a segunda chamada à API do ML.
    // `23505` é o único código tratado como "perdi a corrida"; qualquer outro erro sobe.
    reservarVinculo: async (k) => {
      const { error } = await admin.from('ml_size_charts').insert({
        org_id: k.orgId, conta_externa_id: k.contaExternaId,
        dominio: k.dominio, genero: k.genero, chart_id: null,
      });
      if (!error) return true;
      if (error.code === '23505') return false;
      throw new Error(`reservarVinculo: ml_size_charts: ${error.message}`);
    },
    // Compensação da reserva quando o ML falha. O filtro `is('chart_id', null)` garante que
    // uma chart JÁ confirmada (por outra requisição que ganhou a corrida) nunca é apagada.
    liberarReserva: async (k) => {
      const { error } = await admin.from('ml_size_charts').delete()
        .eq('org_id', k.orgId).eq('conta_externa_id', k.contaExternaId)
        .eq('dominio', k.dominio).eq('genero', k.genero)
        .is('chart_id', null);
      // Falha aqui NÃO substitui o erro original do ML (que é o que o operador precisa ver);
      // loga e deixa a reserva para a expiração citada no teto conhecido.
      if (error) console.error('liberarReserva: ml_size_charts:', error.message);
    },
    confirmarVinculo: async (v) => {
      // Fecha a reserva com o id devolvido pelo ML. Filtra `chart_id is null` para nunca
      // sobrescrever uma chart já confirmada com outra recém-criada.
      const { error } = await admin.from('ml_size_charts')
        .update({ chart_id: v.chartId, atualizado_em: new Date().toISOString() })
        .eq('org_id', v.orgId).eq('conta_externa_id', v.contaExternaId)
        .eq('dominio', v.dominio).eq('genero', v.genero)
        .is('chart_id', null);
      if (error) throw new Error(`confirmarVinculo: ml_size_charts: ${error.message}`);
    },
    criar: (corpo) => criarChart(token, corpo),
    buscar: (chartId) => buscarChart(token, chartId),
  }, args);
}
```

- [ ] **Step 6: Verificar tipos**

Run: `pnpm check:functions`
Expected: PASS. Se a Task 17 escolheu a **Forma B**, o TypeScript acusa `ml_size_charts` inexistente — troque o corpo do adaptador para `familias`, sem mudar a assinatura.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/ml/resolver-size-chart.ts supabase/functions/_shared/ml/__tests__/resolver-size-chart.test.ts
/usr/bin/git commit -m "feat(ml): resolucao idempotente da tabela de medidas (ADR-0167)"
```

---

> ### **Checkpoint Fable — fim da Fase 4 (schema + marketplace)** (BLOQUEANTE)
>
> O Fable revisa o diff da Fase 4. Perguntas explícitas:
>
> 1. Algum campo, path ou id neste diff **não** aparece literalmente no spike 051? (Se sim, é dedução — remover.)
> 2. A migration da Task 17 criou tabela de domínio nova? Ela tem RLS por `org_id` com `current_org_id()`?
> 3. `resolverSizeChart` pode, sob concorrência (duas publicações da mesma org ao mesmo tempo, em fila serial por **usuário**), criar duas tabelas na conta do ML? A reserva local (INSERT com `chart_id` nulo) acontece mesmo **antes** da chamada à API, e `chart_id is null` é lido como "em andamento" e não como "não existe"? (R5)
> 4. O que acontece com um anúncio já publicado se alguém apagar a chart no Seller Central?

---

# Fase 5 — Payload de publicação (COLOR + SIZE_GRID)

**model: opus** (publicação em marketplace — nunca rebaixar).

**Pré-requisito:** Fases 2 e 4 concluídas e com parecer do Fable.

### Task 20: `VariacaoCanonica` e `AnuncioCanonico` ganham os campos

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts:104-134`
- Modify: `supabase/functions/_shared/anuncios/montar-canonico.ts:115`
- Modify: `supabase/functions/publicar-anuncio/processar.ts:89`
- Modify: `supabase/functions/update-familia-ml/processar.ts:325`
- Modify: `supabase/functions/publicar-split-ml/index.ts:263` **e** `:333`
- Test: `supabase/functions/_shared/anuncios/__tests__/montar-canonico-tamanho.test.ts`

**Interfaces:**
- Consumes: `variacoes.tamanho` (Task 10); `resolverSizeChart` (Task 19).
- Produces — **nomes definidos aqui uma vez só, para nenhuma tarefa posterior renomeá-los:**
  - `VariacaoCanonica.tamanho: string | null`
  - `VariacaoCanonica.sizeGridRowId: string | null`
  - `AnuncioCanonico.sizeGridId: string | null`

> **Correção R2b (2ª rodada do Fable) — o que esta tarefa NÃO faz mais.** A versão anterior
> acrescentava aqui `AtualizacaoCanonica.existentes[].tamanho`, para o conector saber que a família
> tem tamanho numa reposição pura. **Campo removido**: ele nasceria sempre `null` em produção —
> `update-familia-ml/processar.ts:323` o preencheria a partir das `variacoes` do lote UPDATE, e
> nenhum produtor de lote UPDATE do v1 carrega `tamanho` (`ingest-lote/index.ts:314-328` herda só
> `ml_variation_id`/`cor`/`cor_origem`/`ml_picture_id`/`estoque_anterior`/`preco_publicacao`;
> `adicionar-variacoes-familia` está bloqueado pelo R4). O sinal certo é o do **próprio ML**
> (`MLVariacaoAtual.temSizeGrid`, Task 22). Efeito colateral bom: `publicar-split-ml` e
> `publicar-anuncio` não precisam de mudança nenhuma em `existentes`, e o diff encolhe.

**Por que é uma tarefa própria:** os dois `attribute_combinations: [{ id: 'COLOR', … }]` hardcodados em `publicar.ts` não podem ser corrigidos isoladamente — o valor **não tem por onde chegar lá**. São cinco sítios de construção do canônico; deixar um de fora produz um anúncio publicado sem tamanho, em silêncio.

**Nota (R1):** `publish-familia-ml` — o worker de CREATE do ML — **não** é um sexto sítio: ele chama `montarAnuncioCanonico` (`publish-familia-ml/processar.ts:158`), que é o sítio central. Quem constrói `VariacaoCanonica` à mão é `publicar-anuncio/processar.ts:90`, `update-familia-ml/processar.ts:326` e `publicar-split-ml/index.ts:264` e `:334`. Confirme com `grep -rn "fotoId:" supabase/functions --include=*.ts | grep -v __tests__` antes de editar; se aparecer um sítio a mais, ele entra na lista.

- [ ] **Step 1: Copiar o fixture que já existe e escrever o teste que falha**

```bash
ls supabase/functions/_shared/anuncios/__tests__/
grep -n "montarAnuncioCanonico(" supabase/functions/_shared/anuncios/__tests__/*.test.ts | head -3
```

Copie o objeto de família e o array de variações do teste existente **sem alterar nada**, e acrescente apenas as duas colunas novas (`tamanho`, `size_chart_row_id`). O fixture tem que ser o mesmo — inventar um novo esconderia exatamente a regressão que este teste procura.

**Correção R1 da revisão do Fable — a assinatura real.** A versão anterior deste teste chamava
`montarAnuncioCanonico(FAMILIA, [VAR])`. A função é **`async`** e recebe **seis** parâmetros
(`montar-canonico.ts:51`):

```ts
montarAnuncioCanonico(admin, conn, ctx, familia, variacoes, listingTypeId?): Promise<AnuncioCanonico>
```

Não invente os stubs de `admin`/`conn`/`ctx`: `supabase/functions/_shared/anuncios/__tests__/montar-canonico.test.ts`
já tem `fakeAdmin()` (linhas 6-25) e usa `fakeConnector` de `../../canais/fake` com
`{ getToken: async () => 'token' }`. Copie essa forma e **`await`** a chamada.

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { montarAnuncioCanonico, type FamiliaParaMontar, type VariacaoParaMontar } from '../montar-canonico';
import { fakeConnector } from '../../canais/fake';

// fakeAdmin(): copie a função do arquivo montar-canonico.test.ts existente (storage.createSignedUrl
// + chain de from/select/eq/update). Não reescreva — é o mesmo stub, e divergir dele é criar
// um segundo comportamento fake para a mesma dependência.
function fakeAdmin() { /* ← cópia literal de montar-canonico.test.ts:6-25 */ }

const CTX = { getToken: async () => 'token' };

// FAMILIA_BASE e VARIACAO_BASE: colados do fixture existente (montar-canonico.test.ts:27-51),
// com as duas colunas novas acrescentadas e nada mais mudado.
const FAMILIA_BASE: FamiliaParaMontar = { /* ← cópia literal */ genero: null } as FamiliaParaMontar;
const VARIACAO_BASE: VariacaoParaMontar = {
  /* ← cópia literal */ tamanho: null, size_chart_row_id: null,
} as VariacaoParaMontar;

describe('montarAnuncioCanonico — tamanho (ADR-0166)', () => {
  beforeEach(() => fakeConnector.reset());

  it('variacao sem tamanho produz tamanho e sizeGridRowId nulos', async () => {
    const a = await montarAnuncioCanonico(fakeAdmin(), fakeConnector, CTX, FAMILIA_BASE, [VARIACAO_BASE]);
    expect(a.variacoes[0].tamanho).toBeNull();
    expect(a.variacoes[0].sizeGridRowId).toBeNull();
    expect(a.sizeGridId).toBeNull();
  });

  it('variacao com tamanho carrega o valor ate o canonico', async () => {
    const a = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, CTX,
      { ...FAMILIA_BASE, genero: 'masculino' },
      [{ ...VARIACAO_BASE, tamanho: 'P', size_chart_row_id: 'R1' }],
    );
    expect(a.variacoes[0].tamanho).toBe('P');
    expect(a.variacoes[0].sizeGridRowId).toBe('R1');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/anuncios/__tests__/montar-canonico-tamanho.test.ts`
Expected: FAIL — `tamanho` é `undefined`, esperava `null`.

- [ ] **Step 3: Estender o contrato**

Em `supabase/functions/_shared/canais/contrato.ts`, em `VariacaoCanonica`:

```ts
  /** ADR-0166: tamanho (roupa) / numeração (calçado). `null` = a variação não tem esse eixo —
   *  o caso de toda org sem tipo de produto habilitado. Alimenta a descrição e o eixo de
   *  variação; NÃO é o que vai no atributo do ML (isso é `sizeGridRowId`). */
  tamanho: string | null;
  /** ADR-0167: linha da tabela de medidas do ML que corresponde a este tamanho
   *  (`SIZE_GRID_ROW_ID`). `null` quando não há tamanho ou o domínio não exige tabela. */
  sizeGridRowId: string | null;
```

E em `AnuncioCanonico`, depois de `variacoes`:

```ts
  /** ADR-0167: tabela de medidas do anúncio (`SIZE_GRID_ID`). `null` = anúncio sem tabela, que é
   *  o caso de tudo que é publicado hoje. */
  sizeGridId: string | null;
```

`AtualizacaoCanonica.existentes` (linha ~157) fica **intacto** — ver a correção R2b no topo desta
tarefa. Nada a fazer em `update-familia-ml/processar.ts:323`, `publicar-split-ml/index.ts:331` nem
no acumulador de `publicar-anuncio/processar.ts:82`.

- [ ] **Step 4: Preencher nos cinco sítios**

Em cada um dos cinco pontos, o objeto de variação ganha as duas chaves. `montar-canonico.ts:115` é o sítio central:

```ts
      sku: v.codigo, cor: v.cor, estoque: v.estoque,
      preco: v.preco_publicacao as number | null, gtin: v.gtin, fotoId: v.ml_picture_id,
      // ADR-0166/0167. `?? null` explícito: a coluna é nullable e `undefined` no payload
      // produziria `attribute_combinations` com valor ausente em vez de atributo omitido.
      tamanho: (v.tamanho as string | null) ?? null,
      sizeGridRowId: (v.size_chart_row_id as string | null) ?? null,
```

E o objeto do anúncio ganha `sizeGridId`. Repita o mesmo par de linhas em:
- `supabase/functions/publicar-anuncio/processar.ts:89`
- `supabase/functions/update-familia-ml/processar.ts:325`
- `supabase/functions/publicar-split-ml/index.ts:263`
- `supabase/functions/publicar-split-ml/index.ts:333`

Nos `select` que alimentam esses pontos, acrescente `tamanho` e `size_chart_row_id` — sem isso as colunas chegam `undefined` e o `?? null` esconde o esquecimento.

- [ ] **Step 5: Rodar e ver passar; depois a suíte inteira das funções**

```bash
pnpm test supabase/functions/_shared/anuncios/__tests__/montar-canonico-tamanho.test.ts
pnpm test supabase/functions
```

Expected: PASS nos dois. O TypeScript vai acusar qualquer um dos cinco sítios esquecido — `tamanho` e `sizeGridRowId` são obrigatórios em `VariacaoCanonica`, não opcionais, **de propósito**.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add supabase/functions/
/usr/bin/git commit -m "feat(canais): tamanho e size grid no contrato canonico (ADR-0166/0167)"
```

---

### Task 21: `montarPayloadItem` emite COLOR + SIZE_GRID

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts` (interface `VariacaoInput`, função `atributoVariacaoPlano`, ramo plano linha ~157, ramo `variations` linha ~203)
- Test: `supabase/functions/_shared/ml/__tests__/publicar-tamanho.test.ts`

**Interfaces:**
- Consumes: `VariacaoCanonica.tamanho`/`sizeGridRowId`, `AnuncioCanonico.sizeGridId` (Task 20).
- Produces: `montarPayloadItem` passa a aceitar `sizeGridId` e a emitir os atributos.

**Colisão pré-existente que esta tarefa precisa resolver explicitamente:** `atributoVariacaoPlano` (linhas 68-73) já tem um ramo de tamanho — ele olha a **string da cor** e, se ela casar com `/^TAM(?:ANHO)?(?:\s|$)/i`, emite `{ name: 'Tamanho', value_name }` em vez de `COLOR`. É um hack antigo, anterior a esta feature. Com uma coluna `tamanho` de verdade, ele passa a conviver com o campo novo. **Decisão: o hack fica intacto.** Ele só é alcançado quando `cor` começa com "TAM", o que nenhuma org de roupa produz (a cor vem de lista digitada), e mexer nele mudaria o payload de anúncios já publicados. A Fase 6 tem um teste que **prova** que ele continua idêntico.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { montarPayloadItem } from '../publicar.ts';

const FAMILIA = { titulo_ml: 'Camiseta Básica', descricao_ml: null, categoria_ml_id: 'MLB1430', atributos_ml: [] };
const VAR = {
  codigo: '00000002', cor: 'Azul', estoque: 5, preco_publicacao: 50,
  gtin: null, ml_picture_id: 'p1', tamanho: null as string | null, sizeGridRowId: null as string | null,
};

describe('montarPayloadItem — sem tamanho (INV-1)', () => {
  it('ramo variations sai identico ao de hoje: so COLOR', () => {
    const p = montarPayloadItem(FAMILIA, [VAR, { ...VAR, codigo: '00000003', cor: 'Preto' }], null, null, null);
    expect(p.variations![0].attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Azul' }]);
  });
});

describe('montarPayloadItem — com tamanho (ADR-0167)', () => {
  it('ramo variations emite COLOR + SIZE_GRID_ROW_ID por variacao', () => {
    const p = montarPayloadItem(
      FAMILIA,
      [
        { ...VAR, tamanho: 'P', sizeGridRowId: 'R1' },
        { ...VAR, codigo: '00000003', tamanho: 'M', sizeGridRowId: 'R2' },
      ],
      null, null, null, undefined, undefined, undefined, undefined, 'CH1',
    );
    expect(p.variations![0].attribute_combinations).toEqual([
      { id: 'COLOR', value_name: 'Azul' },
      { id: 'SIZE_GRID_ROW_ID', value_id: 'R1' },
    ]);
    expect(p.variations![1].attribute_combinations).toContainEqual({ id: 'SIZE_GRID_ROW_ID', value_id: 'R2' });
  });

  it('SIZE_GRID_ID entra UMA vez, nos atributos do item, nao por variacao', () => {
    const p = montarPayloadItem(
      FAMILIA, [{ ...VAR, tamanho: 'P', sizeGridRowId: 'R1' }],
      null, null, null, undefined, undefined, undefined, undefined, 'CH1',
    );
    expect(p.attributes).toContainEqual({ id: 'SIZE_GRID_ID', value_id: 'CH1' });
    expect(p.variations![0].attribute_combinations).not.toContainEqual(
      expect.objectContaining({ id: 'SIZE_GRID_ID' }),
    );
  });

  it('tamanho preenchido SEM sizeGridRowId LANCA — nunca publica o SKU sem a linha certa', () => {
    expect(() => montarPayloadItem(
      FAMILIA, [{ ...VAR, tamanho: 'P', sizeGridRowId: null }],
      null, null, null, undefined, undefined, undefined, undefined, 'CH1',
    )).toThrow(/tabela de medidas/i);
  });

  it('sizeGridId ausente com tamanho preenchido LANCA', () => {
    expect(() => montarPayloadItem(
      FAMILIA, [{ ...VAR, tamanho: 'P', sizeGridRowId: 'R1' }],
      null, null, null,
    )).toThrow(/tabela de medidas/i);
  });
});
```

> **Atenção:** a posição exata de `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` (em `attributes` do item, em `attribute_combinations` da variação, ou nos dois) e o uso de `value_id` vs `value_name` **vêm da seção 4 do spike 051**. Se o spike disser algo diferente do que está escrito acima, **o spike vence** e o teste é reescrito antes da implementação.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/publicar-tamanho.test.ts`
Expected: FAIL — o primeiro caso ("sem tamanho") passa; os de tamanho falham.

- [ ] **Step 3: Estender `VariacaoInput` e a assinatura**

Em `publicar.ts`, na interface `VariacaoInput`:

```ts
  /** ADR-0166/0167. `tamanho` é o valor do operador (só para decidir se há eixo);
   *  `sizeGridRowId` é o que o ML recebe. */
  tamanho: string | null;
  sizeGridRowId: string | null;
```

E acrescente o parâmetro final a `montarPayloadItem`, **depois** de `formato` (nunca antes — cinco chamadores passam posicionalmente):

```ts
  formato?: 'plano',
  /** ADR-0167: `SIZE_GRID_ID` do anúncio. Obrigatório quando alguma variação tem tamanho. */
  sizeGridId?: string | null,
```

- [ ] **Step 4: Emitir os atributos**

Logo no início da função, depois do cálculo de `variacaoUnica`:

```ts
  // ADR-0167: publicar um SKU de vestuário sem a linha da tabela de medidas é publicá-lo no
  // tamanho errado (o ML não aceita SIZE como texto solto nos domínios que exigem chart). Falha
  // LOUD antes do POST em vez de mandar um payload que o ML aceita pela metade.
  const temTamanho = variacoes.some((v) => v.tamanho != null && v.tamanho !== '');
  if (temTamanho) {
    if (!sizeGridId) {
      throw new Error(
        'Família com tamanho e sem tabela de medidas (SIZE_GRID_ID) — não é possível publicar. '
        + 'Resolva a tabela antes de montar o payload (ADR-0167).',
      );
    }
    const semLinha = variacoes.filter((v) => v.tamanho && !v.sizeGridRowId).map((v) => v.codigo);
    if (semLinha.length > 0) {
      throw new Error(
        `Variações sem linha na tabela de medidas (SIZE_GRID_ROW_ID): ${semLinha.join(', ')} — `
        + 'não é possível publicar sem elas (ADR-0167).',
      );
    }
  }
```

No ramo `variations`, substitua a montagem de `attribute_combinations`:

```ts
    const combinacoes: AtributoItem[] = [{ id: 'COLOR', value_name: cor }];
    // Só quando há tamanho — sem isso o payload sai byte a byte igual ao de hoje (INV-1).
    if (v.sizeGridRowId) combinacoes.push({ id: 'SIZE_GRID_ROW_ID', value_id: v.sizeGridRowId });
    const variation: VariacaoItem = {
      attribute_combinations: combinacoes,
```

No ramo plano, depois de `atributoVariacaoPlano(cor)` dentro de `atributosFlat`:

```ts
    if (v.sizeGridRowId) atributosFlat.push({ id: 'SIZE_GRID_ROW_ID', value_id: v.sizeGridRowId });
```

E, nos **dois** `return`, acrescente `SIZE_GRID_ID` ao array `attributes` quando `sizeGridId` existir:

```ts
    attributes: [
      ...(familia.atributos_ml ?? []), ...atributosPacote,
      ...(sizeGridId ? [{ id: 'SIZE_GRID_ID', value_id: sizeGridId }] : []),
    ],
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/publicar-tamanho.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 6: Rodar TODOS os testes de `publicar.ts` pré-existentes**

Run: `pnpm test supabase/functions/_shared/ml`
Expected: PASS. Nenhum teste antigo pode ter mudado de saída — se algum mudou, a condicional vazou.

- [ ] **Step 7: Ligar o `sizeGridId` no conector**

Em `supabase/functions/_shared/canais/mercado-livre.ts`, na função `montar` (linha ~132), acrescente `a.sizeGridId` como último argumento de `montarPayloadItem`, e acrescente `tamanho`/`sizeGridRowId` ao `variacoesInput` (linha ~126):

```ts
    const variacoesInput = a.variacoes.map((v) => ({
      codigo: v.sku, cor: v.cor, estoque: capCriar.get(v.sku) ?? v.estoque,
      preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
      tamanho: v.tamanho, sizeGridRowId: v.sizeGridRowId,
    }));
```

Faça o mesmo em `_shared/user-products/publicar-familia-up.ts:85` e `_shared/user-products/atualizar-familia-up.ts:224`.

- [ ] **Step 8: Verificar tipos e commitar**

```bash
pnpm check:functions
/usr/bin/git add supabase/functions/
/usr/bin/git commit -m "feat(ml): payload com COLOR + SIZE_GRID no CREATE (ADR-0167)"
```

---

### Task 22: UPDATE — tamanho só em variação NOVA, e rename de cor recusado em família com tamanho

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar-item.ts` (helper novo `temSizeGridNaVariacaoML` + o mapper de `buscarItemML`, linhas ~42-71) — **R2b**
- Modify: `supabase/functions/_shared/ml/atualizar.ts` (`CorNovaInput`, `montarVariacaoNova`, `MLVariacaoAtual`, + as duas regras puras `motivoRenameBloqueado` e `motivoVariacaoNovaSemTamanho`)
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts` (a montagem de `corDesejadaPorCodigo`, linhas ~275-307) — **R2b/R2c**
- Test: `supabase/functions/_shared/ml/__tests__/atualizar-tamanho.test.ts`
- Test: `supabase/functions/_shared/canais/__tests__/` — caso do rename recusado e da reposição pura NÃO bloqueada (use o arquivo de testes do conector que já existir; se não houver, o caso equivalente vive no teste das funções puras + um teste de integração do conector)

**Interfaces:**
- Consumes: `VariacaoCanonica.sizeGridRowId` (Task 20) e `MLVariacaoAtual.temSizeGrid` — este último **produzido aqui mesmo**, no `buscarItemML`.
- Produces: `CorNovaInput.sizeGridRowId: string | null`, `MLVariacaoAtual.temSizeGrid?: boolean`, `motivoRenameBloqueado`, `motivoVariacaoNovaSemTamanho`.

**Requisito duro (aprendido em produção):** `montarVariacoesUpdate` reenvia **todas** as variações do anúncio, e o ML **recusa o PUT inteiro** quando `attribute_combinations` chega numa variação com vendas (`"You cannot change attribute combinations if the variation has bids"`, lote #45, 9 famílias, estoque incluído — ADR-0062, comentário em `_shared/ml/atualizar.ts:75-89`). Por isso: o tamanho entra **apenas** em variação nova (`montarVariacaoNova`) e **nunca** é reenviado para variação existente. Sem exceção, e sem "só quando muda".

**Correção R2 da revisão do Fable — o rename de cor é a mesma armadilha, por outra porta.**
A versão anterior desta tarefa fixava por teste o comportamento atual de `montarVariacoesUpdate`
(linhas 105-106 de `atualizar.ts`): fora de `somenteEstoque`, quando a cor desejada difere da que
está no ML, ele **substitui** `attribute_combinations` por `[{ id: 'COLOR', … }]`. Numa variação
publicada com **COLOR + SIZE_GRID_ROW_ID** isso monta uma combinação **incompleta** — o
`SIZE_GRID_ROW_ID` some — e o ML derruba o PUT inteiro, levando junto a atualização de estoque.
É a mesma classe do incidente do lote #45. Fixar aquilo como "correto" era travar o defeito.

**Decisão do v1 (a mais barata que é honesta):** renomear cor em família **com tamanho** está
**fora do escopo**. Em `mercado-livre.ts`, `corDesejadaPorCodigo` **não é montado** para essas
famílias; e se o UPDATE de fato pedir um rename, a operação **falha LOUD** com erro explícito,
em vez de sair um payload incompleto. `montarVariacoesUpdate` continua sem mudar uma linha.

**Correção R2b (2ª rodada do Fable) — de onde vem o sinal "esta família tem tamanho".**
A 1ª correção decidia o bloqueio por `AtualizacaoCanonica.existentes[].tamanho`. Esse campo é
**morto em produção**: `update-familia-ml/processar.ts:323` o preencheria a partir das `variacoes`
do lote UPDATE, e os **dois únicos** produtores de lote UPDATE do v1 nunca põem tamanho lá —
`adicionar-variacoes-familia` está bloqueado para família com tamanho (R4, Task 16A) e
`ingest-lote/index.ts:314-328` herda da variação anterior apenas `ml_variation_id`, `cor`,
`cor_origem`, `ml_picture_id`, `estoque_anterior` e `preco_publicacao` — **nunca `tamanho`**.
Com o sinal sempre `null`, o guard jamais dispararia e o bug original seguiria acontecendo igual.

O sinal correto é o **estado real do anúncio no ML**: uma variação publicada com eixo de tamanho
carrega `SIZE_GRID_ROW_ID` nas suas `attribute_combinations`, e `buscarItemML` já lê esse array
(é de lá que sai `cor`, via `corDaVariacaoML`). Então `MLVariacaoAtual` ganha `temSizeGrid` e o
bloqueio decide por `atuaisNoML.some((v) => v.temSizeGrid)`. Vantagens: (1) não depende de nenhum
produtor de lote lembrar de propagar coluna, (2) vale para anúncio publicado antes desta entrega,
(3) é a mesma fonte que já decide o rename (a cor **no ML**). Nenhuma chamada de rede a mais — o
GET do UPDATE já traz `variations` completo.

**Correção R2c (bônus da mesma rodada) — variação nova sem linha da tabela de medidas.**
O R4 fechou o fluxo "Adicionar variação", mas sobrou uma porta: **re-ingest de planilha** de uma
família que tem tamanho, com um CÓDIGO que a planilha não tinha antes, cai em `a.novas` sem
`sizeGridRowId` (a planilha não tem coluna de tamanho — está fora do escopo v1). Hoje isso viraria
um `attribute_combinations` só com COLOR numa família cujas irmãs têm COLOR + SIZE_GRID_ROW_ID, e
o operador receberia um erro cru da API do ML. Vira **400 explícito**, no conector — o único ponto
onde `a.novas` e o estado real do item se encontram, e que por isso cobre **todos** os produtores
de lote UPDATE de uma vez (`update-familia-ml` e `publicar-split-ml`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import {
  montarVariacaoNova, montarVariacoesUpdate,
  motivoRenameBloqueado, motivoVariacaoNovaSemTamanho,
} from '../atualizar.ts';
import { temSizeGridNaVariacaoML } from '../atualizar-item.ts';

const NOVA = {
  codigo: '00000004', cor: 'Verde', estoque: 3, preco_publicacao: 50,
  gtin: null, ml_picture_id: 'p9', sizeGridRowId: null as string | null,
};

describe('montarVariacaoNova — tamanho (ADR-0167)', () => {
  it('sem sizeGridRowId sai identica a de hoje: so COLOR', () => {
    expect(montarVariacaoNova(NOVA, null, null, null, 'MLB1430').attribute_combinations)
      .toEqual([{ id: 'COLOR', value_name: 'Verde' }]);
  });

  it('com sizeGridRowId acrescenta SIZE_GRID_ROW_ID', () => {
    expect(montarVariacaoNova({ ...NOVA, sizeGridRowId: 'R3' }, null, null, null, 'MLB1430').attribute_combinations)
      .toEqual([
        { id: 'COLOR', value_name: 'Verde' },
        { id: 'SIZE_GRID_ROW_ID', value_id: 'R3' },
      ]);
  });
});

describe('montarVariacoesUpdate — variacao EXISTENTE nunca recebe tamanho', () => {
  const atuais = [{ id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Azul' }];

  it('nenhum corpo de variacao existente carrega chave de size grid', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000002', estoque: 9 }]);
    const corpo = JSON.stringify(r);
    expect(corpo).not.toMatch(/SIZE_GRID/);
    expect(r[0]).toEqual({ id: 1, available_quantity: 9 });
  });

  // Comportamento de HOJE, preservado para família SEM tamanho: o rename de cor sai como
  // attribute_combinations só com COLOR. Correto aqui — a variação não tem SIZE_GRID_ROW_ID,
  // então a combinação não está incompleta.
  it('rename de cor em familia SEM tamanho continua saindo so com COLOR (ADR-0062)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000002', estoque: 9 }], undefined, null, { '00000002': 'Azul Marinho' });
    expect(r[0].attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Azul Marinho' }]);
    expect(JSON.stringify(r)).not.toMatch(/SIZE_GRID/);
  });
});

// R2b: o sinal. Sai das attribute_combinations do ITEM REAL NO ML, nunca do banco.
describe('temSizeGridNaVariacaoML (R2b)', () => {
  it('so COLOR: falso', () => {
    expect(temSizeGridNaVariacaoML([{ id: 'COLOR', value_name: 'Azul' }])).toBe(false);
  });
  it('COLOR + SIZE_GRID_ROW_ID: verdadeiro', () => {
    expect(temSizeGridNaVariacaoML([
      { id: 'COLOR', value_name: 'Azul' }, { id: 'SIZE_GRID_ROW_ID', value_id: 'R3' },
    ])).toBe(true);
  });
  it('ausente/nao-array: falso, sem lancar', () => {
    expect(temSizeGridNaVariacaoML(undefined)).toBe(false);
    expect(temSizeGridNaVariacaoML(null)).toBe(false);
  });
});

// R2b: a regra que decide se o rename pode ser montado. Pura, testável sem rede — o conector só
// a consulta. `null` = pode montar; string = motivo da recusa (falha LOUD).
//
// O SINAL É `atuaisNoML[].temSizeGrid`, lido do ML. A versão anterior lia `existentes[].tamanho`,
// que em produção é SEMPRE null (ingest-lote nunca herda tamanho) — guard que nunca dispara.
describe('motivoRenameBloqueado (ADR-0166 / R2b)', () => {
  const existentes = (cor: string | null = 'Azul') => [{ sku: '00000002', estoque: 9, cor }];
  const noML = (temSizeGrid: boolean, cor = 'Azul') => [
    { id: 1, seller_custom_field: '00000002', available_quantity: 5, cor, temSizeGrid },
  ];

  it('anuncio SEM size grid: nao bloqueia nada, nem com rename pedido', () => {
    expect(motivoRenameBloqueado(existentes('Azul Marinho'), noML(false))).toBeNull();
  });

  it('variacao antiga sem o campo (fixture legado, temSizeGrid ausente) nao bloqueia', () => {
    const legado = [{ id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Azul' }];
    expect(motivoRenameBloqueado(existentes('Azul Marinho'), legado)).toBeNull();
  });

  it('anuncio COM size grid e SEM rename pedido: nao bloqueia — reposicao e o caminho comum', () => {
    expect(motivoRenameBloqueado(existentes('Azul'), noML(true))).toBeNull();
  });

  // (a) do pedido: rename REAL em familia com tamanho e bloqueado.
  it('anuncio COM size grid e COM rename pedido: BLOQUEIA, citando o SKU', () => {
    const motivo = motivoRenameBloqueado(existentes('Azul Marinho'), noML(true));
    expect(motivo).toMatch(/00000002/);
    expect(motivo).toMatch(/tamanho|numera/i);
  });

  it('basta UMA variacao do anuncio ter size grid (o eixo e do anuncio inteiro)', () => {
    const misto = [
      { id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Azul', temSizeGrid: false },
      { id: 2, seller_custom_field: '00000003', available_quantity: 5, cor: 'Preto', temSizeGrid: true },
    ];
    expect(motivoRenameBloqueado(existentes('Azul Marinho'), misto)).not.toBeNull();
  });

  it('cor nula no banco nao conta como rename (nada a renomear)', () => {
    expect(motivoRenameBloqueado(existentes(null), noML(true))).toBeNull();
  });

  it('sku que nao existe no ML nao conta como rename (e cor nova, nao rename)', () => {
    expect(motivoRenameBloqueado([{ sku: '00000099', estoque: 1, cor: 'Verde' }], noML(true))).toBeNull();
  });
});

// R2c (bônus): variação NOVA sem linha da tabela de medidas num anúncio que tem size grid.
// Caminho real: re-ingest de planilha com um CÓDIGO novo numa família de roupa/calçado.
describe('motivoVariacaoNovaSemTamanho (R2c)', () => {
  const noML = (temSizeGrid: boolean) => [
    { id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Azul', temSizeGrid },
  ];

  it('anuncio SEM size grid: nova sem sizeGridRowId e o caso normal de hoje — nao bloqueia (INV-1)', () => {
    expect(motivoVariacaoNovaSemTamanho([{ sku: '00000004', sizeGridRowId: null }], noML(false))).toBeNull();
  });

  // (c) do pedido.
  it('anuncio COM size grid e nova SEM sizeGridRowId: BLOQUEIA citando o SKU, sem erro cru do ML', () => {
    const motivo = motivoVariacaoNovaSemTamanho([{ sku: '00000004', sizeGridRowId: null }], noML(true));
    expect(motivo).toMatch(/00000004/);
    expect(motivo).toMatch(/tamanho|numera/i);
  });

  it('anuncio COM size grid e nova COM sizeGridRowId: segue', () => {
    expect(motivoVariacaoNovaSemTamanho([{ sku: '00000004', sizeGridRowId: 'R3' }], noML(true))).toBeNull();
  });

  it('sem variacao nova nenhuma: nunca bloqueia (reposicao pura)', () => {
    expect(motivoVariacaoNovaSemTamanho([], noML(true))).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/atualizar-tamanho.test.ts`
Expected: FAIL — o caso "com sizeGridRowId acrescenta SIZE_GRID_ROW_ID", e os imports de
`temSizeGridNaVariacaoML`/`motivoRenameBloqueado`/`motivoVariacaoNovaSemTamanho`, que ainda não
existem.

- [ ] **Step 3: Implementar**

Em `atualizar.ts`, na interface `CorNovaInput`:

```ts
  /** ADR-0167: linha da tabela de medidas. Só existe em cor nova de família com tamanho. */
  sizeGridRowId?: string | null;
```

Em `montarVariacaoNova`, substitua a montagem de `attribute_combinations`:

```ts
  const combinacoes: AtributoVar[] = [{ id: 'COLOR', value_name: v.cor ?? '' }];
  // ADR-0167: só na variação NOVA. Reenviar atributo em variação existente derruba o PUT inteiro
  // quando ela tem vendas ("You cannot change attribute combinations if the variation has bids",
  // lote #45 / ADR-0062) — e derrubar o PUT derruba o estoque junto. `montarVariacoesUpdate`
  // continua sem tocar em size grid, de propósito e para sempre.
  if (v.sizeGridRowId) combinacoes.push({ id: 'SIZE_GRID_ROW_ID', value_id: v.sizeGridRowId });
  const variation: VariacaoNovaPut = {
    attribute_combinations: combinacoes,
```

`montarVariacoesUpdate` **não muda uma linha**. Isso é a implementação correta, não uma pendência.

**(R2b) O sinal — em `atualizar-item.ts`.** Ao lado de `corDaVariacaoML` (linha ~42), que já faz o
mesmo tipo de leitura, acrescente o helper irmão:

```ts
// R2b (ADR-0166): a variação foi publicada com eixo de tamanho? `SIZE_GRID_ROW_ID` nas
// attribute_combinations é a prova — e a ÚNICA fonte confiável disso no UPDATE. O banco local
// NÃO serve: nenhum produtor de lote UPDATE do v1 carrega `tamanho` nas variações
// (ingest-lote herda só ml_variation_id/cor/foto/preço; adicionar-variacoes-familia está
// bloqueado para família com tamanho, R4). Um guard lido do banco nunca dispararia.
export function temSizeGridNaVariacaoML(attributeCombinations: unknown): boolean {
  return Array.isArray(attributeCombinations)
    && attributeCombinations.some(
      (a) => a && typeof a === 'object' && (a as { id?: string }).id === 'SIZE_GRID_ROW_ID',
    );
}
```

e, no mapper de `buscarItemML` (linhas ~61-71), logo depois de `cor:`:

```ts
    // R2b: eixo de tamanho do anúncio, lido do próprio ML. O GET já pede `variations` inteiro
    // (é de lá que sai `cor`) — nenhuma chamada de rede a mais.
    temSizeGrid: temSizeGridNaVariacaoML(v.attribute_combinations),
```

Em `atualizar.ts`, `MLVariacaoAtual` (linha ~60) ganha o campo — **opcional de propósito**: todo
fixture do repositório monta essa interface como `{ id, seller_custom_field, available_quantity,
cor }`, e exigir o campo quebraria a compilação da suíte inteira sem ganho nenhum.

```ts
  /** R2b (ADR-0166): variação publicada com SIZE_GRID_ROW_ID (eixo de tamanho)? Preenchido por
   *  `buscarItemML`. Ausente em fixture antigo = tratado como `false`. */
  temSizeGrid?: boolean;
```

**(R2b/R2c) As duas regras puras — em `atualizar.ts`**, junto do comentário do lote #45 e não no
conector (o conector só as consulta):

```ts
/** R2b (ADR-0166): em anúncio COM eixo de tamanho, renomear a cor de uma variação já publicada
 *  está fora do escopo do v1.
 *
 *  Por quê: `montarVariacoesUpdate` SUBSTITUI `attribute_combinations` por `[COLOR]` quando a cor
 *  desejada difere da que está no ML. Numa variação publicada com COLOR + SIZE_GRID_ROW_ID isso
 *  manda uma combinação INCOMPLETA (perde o SIZE_GRID_ROW_ID) e o ML recusa o PUT INTEIRO —
 *  levando junto a atualização de estoque, exatamente como no lote #45 (ver o comentário acima).
 *
 *  O sinal é `atuaisNoML[].temSizeGrid`, do GET ao vivo. NÃO use coluna do banco: a versão
 *  anterior desta regra lia `existentes[].tamanho`, que é sempre `null` em produção, e por isso
 *  nunca bloqueava nada.
 *
 *  Devolve `null` quando pode seguir, ou a mensagem do bloqueio. Anúncio sem size grid: sempre
 *  `null` — o comportamento de hoje fica byte a byte igual (INV-1).
 *
 *  ponytail: o teto conhecido é "não dá para renomear cor de peça com tamanho pelo app". A saída
 *  futura é reenviar a combinação COMPLETA (COLOR + SIZE_GRID_ROW_ID) — que exige resolver a
 *  tabela de medidas também no UPDATE de variação existente, e isso é escopo de outra entrega.
 *
 *  R2 (emenda 2026-09-19, Fable 3ª rodada): o ML normaliza a grafia da cor ao publicar (ex.:
 *  "Rosa Claro" -> "Rosa-claro", ver `reference_ml.md`/glossário — dicionário de COLOR reescreve
 *  `value_name`). Comparar `e.cor !== corNoML.get(e.sku)` byte a byte trata ISSO como rename e
 *  bloqueia toda atualização completa/re-ingest de qualquer família com tamanho cuja cor já foi
 *  normalizada pelo ML — mesmo quando o operador nunca tocou no nome. Por isso a comparação usa
 *  `foldCor` (minúsculas, hífen/underscore/espaço repetido colapsados em 1 espaço, trim) antes de
 *  decidir se é rename de verdade. Não existe helper de normalização de cor reaproveitável em
 *  `_shared/` — este fold é local, só para esta comparação. */
function foldCor(cor: string): string {
  return cor.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

export function motivoRenameBloqueado(
  existentes: Array<{ sku: string; cor: string | null }>,
  atuaisNoML: MLVariacaoAtual[],
): string | null {
  if (!atuaisNoML.some((v) => v.temSizeGrid === true)) return null;
  const corNoML = new Map(atuaisNoML.map((v) => [v.seller_custom_field ?? '', v.cor ?? null]));
  const renomeadas = existentes
    .filter((e) => {
      if (!e.cor || !corNoML.has(e.sku)) return false;
      const corAtual = corNoML.get(e.sku);
      if (!corAtual) return false;
      return foldCor(e.cor) !== foldCor(corAtual);
    })
    .map((e) => e.sku);
  if (renomeadas.length === 0) return null;
  return `Renomear a cor de um produto com tamanho/numeração ainda não é suportado `
    + `(variações ${renomeadas.join(', ')}). Reponha o nome anterior da cor no cadastro e `
    + `atualize de novo — o Mercado Livre recusa a alteração parcial de atributos nessas variações.`;
}

/** R2c (ADR-0167): variação NOVA sem linha da tabela de medidas num anúncio que TEM eixo de
 *  tamanho. Caminho real: re-ingest de planilha (fora do escopo v1, sem coluna de tamanho) com um
 *  CÓDIGO que a planilha não tinha antes — a cor nova entraria com `attribute_combinations` só
 *  com COLOR enquanto as irmãs têm COLOR + SIZE_GRID_ROW_ID, e o ML devolveria erro cru de API.
 *
 *  Falha LOUD antes de virar payload: 400 (definitivo, não retentável — nenhuma retentativa
 *  inventa o tamanho que falta). Anúncio sem size grid devolve `null` sempre: é o caminho de toda
 *  cor nova publicada hoje (INV-1). */
export function motivoVariacaoNovaSemTamanho(
  novas: Array<{ sku: string; sizeGridRowId?: string | null }>,
  atuaisNoML: MLVariacaoAtual[],
): string | null {
  if (!atuaisNoML.some((v) => v.temSizeGrid === true)) return null;
  const sem = novas.filter((v) => !v.sizeGridRowId).map((v) => v.sku);
  if (sem.length === 0) return null;
  return `Variação nova em produto com tamanho/numeração precisa ter o tamanho definido antes de `
    + `atualizar o anúncio (variações ${sem.join(', ')}). Cadastre o tamanho dessas variações no `
    + `produto e atualize de novo — planilha ainda não traz tamanho (ADR-0166).`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/atualizar-tamanho.test.ts`
Expected: PASS em todos os `describe` — `montarVariacaoNova`, `montarVariacoesUpdate`,
`temSizeGridNaVariacaoML` (R2b), `motivoRenameBloqueado` (R2b) e `motivoVariacaoNovaSemTamanho`
(R2c). Nenhum caso pode passar por acidente: se `temSizeGrid` não for propagado no mapper de
`buscarItemML`, os dois últimos `describe` seguem verdes aqui e o bug volta em produção — por isso
o Step 5.1 e o 5.2 travam a regra **no conector**, com o estado vindo do GET.

- [ ] **Step 5: Ligar no conector — cor nova COM tamanho, rename BLOQUEADO (R2b), nova sem tamanho BLOQUEADA (R2c)**

Em `_shared/canais/mercado-livre.ts`:

(a) No `map` que monta as novas variações (linha ~303), repasse `sizeGridRowId: v.sizeGridRowId`.

(b) Acrescente `motivoRenameBloqueado` e `motivoVariacaoNovaSemTamanho` ao import que o arquivo já
faz de `../ml/atualizar.ts` (o mesmo de `montarVariacoesUpdate`/`montarVariacaoNova`) — sem isso o
Step não compila.

(c) Substitua a montagem de `corDesejadaPorCodigo` (linhas ~275-277) por:

```ts
      // R2b (ADR-0166): este anúncio tem eixo de tamanho? O sinal vem do PRÓPRIO ML — a variação
      // publicada carrega SIZE_GRID_ROW_ID nas attribute_combinations, e `buscarItemML` marca
      // isso em `temSizeGrid`. NÃO existe sinal equivalente no banco: nenhum produtor de lote
      // UPDATE do v1 propaga `tamanho` (ingest-lote herda só ml_variation_id/cor/foto/preço;
      // adicionar-variacoes-familia recusa família com tamanho, R4). Guard lido do banco seria
      // um guard que nunca dispara.
      const temSizeGrid = atual.variations.some((v) => v.temSizeGrid === true);

      // Renomear cor de variação já publicada (ADR-0062): sku → cor desejada no banco.
      //
      // Em anúncio COM size grid o mapa NÃO é montado. Montá-lo faria `montarVariacoesUpdate`
      // trocar `attribute_combinations` por só `[COLOR]` numa variação que tem
      // COLOR + SIZE_GRID_ROW_ID — combinação incompleta, PUT inteiro recusado pelo ML, estoque
      // junto. Se o rename foi realmente pedido, falha LOUD abaixo: recusar é honesto, ignorar em
      // silêncio seria descartar uma edição do operador.
      //
      // O bloqueio só vale onde o rename REALMENTE sairia. `somenteEstoque` já zera a cor
      // desejada (linha ~104 de ml/atualizar.ts) e `preservarPublicadas` nem passa por
      // `montarVariacoesUpdate`: nesses dois caminhos nenhum atributo é enviado, e bloquear
      // ali transformaria uma reposição pura de estoque em 400 — justamente por causa do
      // falso rename (`Rosa Claro` no banco × `Rosa-claro` no ML), que é o caso COMUM.
      const podeRenomear = !a.somenteEstoque && !a.preservarPublicadas;
      const bloqueio = podeRenomear
        ? motivoRenameBloqueado(a.existentes, atual.variations)
        : null;
      if (bloqueio) {
        // `NAO_SUPORTADO` é o código existente que significa exatamente isto ("o canal/o v1 não
        // faz essa operação"). Não inventar membro novo em `ErroCanalCodigo`: nenhum consumidor
        // decide retry pelo código — `publicar-anuncio/processar.ts:64` e
        // `update-familia-ml/processar.ts:453` leem `retentavel`/`status` do objeto.
        return {
          ok: false,
          erro: { codigo: 'NAO_SUPORTADO', mensagemOperador: bloqueio, retentavel: false, status: 400 },
        };
      }

      // R2c: variação NOVA sem linha da tabela de medidas em anúncio com size grid. Vale nos TRÊS
      // caminhos (inclusive `somenteEstoque`/`preservarPublicadas`): a cor nova sempre sai por
      // `montarVariacaoNova`, e sem `sizeGridRowId` ela iria ao ML com a combinação incompleta.
      // Aqui, e não em `update-familia-ml`: este é o único ponto em que `a.novas` encontra o
      // estado real do item, e ele cobre TODOS os produtores de lote UPDATE de uma vez
      // (`update-familia-ml/processar.ts:324` e `publicar-split-ml/index.ts`).
      const semTamanho = motivoVariacaoNovaSemTamanho(a.novas, atual.variations);
      if (semTamanho) {
        return {
          ok: false,
          erro: { codigo: 'VARIACAO', mensagemOperador: semTamanho, retentavel: false, status: 400 },
        };
      }

      const corDesejadaPorCodigo: Record<string, string | null> = {};
      if (!temSizeGrid) {
        for (const e of a.existentes) corDesejadaPorCodigo[e.sku] = e.cor;
      }
```

Mantenha a chamada de `montarVariacoesUpdate` como está — com o mapa vazio ela não emite
`attribute_combinations` nenhum, que é exatamente o comportamento desejado.

(d) **Há um SEGUNDO chamador de `montarVariacoesUpdate` e ele NÃO leva guard nenhum**:
`atualizarEstoque` (`mercado-livre.ts:~392`, o push barato de estoque do `sincronizar-estoque`)
chama `montarVariacoesUpdate(atual.variations, desejados, undefined, null, undefined, true)` —
`corDesejadaPorCodigo` **`undefined`** e `somenteEstoque` **`true`**. Nenhum atributo sai por ali,
nunca, por construção. Pôr o bloqueio nesse caminho pararia o push de estoque de toda peça de
roupa — e ele roda sozinho, sem operador olhando. Confirme antes de editar:
`grep -rn "montarVariacoesUpdate(" supabase/functions --include=*.ts | grep -v __tests__` deve
devolver exatamente estes dois sítios (`:296` e `:392`) mais a definição em `ml/atualizar.ts:91`.

> **Atenção ao falso rename (emenda 2026-09-19, Fable 3ª rodada):** o dicionário do ML reescreve
> `value_name` de COLOR ao publicar (`Rosa Claro` → `Rosa-claro`), então divergência de GRAFIA
> **não** significa que o operador pediu um rename. Isso não é só caso de `somenteEstoque` — um
> UPDATE completo ("Atualizar tudo"/re-ingest) de uma família com tamanho cuja cor já foi
> normalizada pelo ML bateria nesse mesmo falso positivo e devolveria 400 em **toda** atualização,
> com mensagem mandando "repor o nome anterior" que o operador nunca mudou. Por isso o bloqueio
> tem DUAS camadas, não uma: (1) a função pura já ignora diferença de grafia via `foldCor`
> (minúsculas + hífen/underscore/espaço repetido colapsados + trim) antes de decidir se é rename
> de verdade, e (2) o bloqueio só roda quando o rename realmente sairia
> (`!somenteEstoque && !preservarPublicadas`). Reposição de estoque numa família com tamanho
> **nunca** pode ser bloqueada — é o caminho que roda sozinho, sem operador olhando.

- [ ] **Step 5.1: Teste de que reposição pura NÃO é bloqueada (R2b) — este é do CONECTOR**

Acrescente ao `describe('motivoRenameBloqueado …')` da Step 1:

```ts
  // Divergencia de grafia por NORMALIZACAO do ML (dicionario de COLOR reescreve
  // `Rosa Claro` -> `Rosa-claro`) NAO e rename de verdade — a funcao pura ja ignora isso via
  // foldCor. Sem essa camada, todo UPDATE completo de uma familia com tamanho cuja cor ja foi
  // normalizada pelo ML bloquearia com uma mensagem mandando repor um nome que o operador nunca
  // mudou.
  it('grafia divergente por normalizacao do ML NAO conta como rename na funcao pura', () => {
    const existentes = [{ sku: '00000002', estoque: 9, cor: 'Rosa Claro' }];
    const noML = [{ id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Rosa-claro', temSizeGrid: true }];
    expect(motivoRenameBloqueado(existentes, noML)).toBeNull();
  });

  // Rename de verdade (nao e so grafia — o nome muda de fato) continua bloqueado mesmo com
  // fold: "Azul" e "Azul Marinho" nao colapsam pro mesmo valor normalizado.
  it('rename de verdade continua bloqueado mesmo com o fold de grafia', () => {
    const existentes = [{ sku: '00000003', estoque: 2, cor: 'Azul' }];
    const noML = [{ id: 1, seller_custom_field: '00000003', available_quantity: 2, cor: 'Azul Marinho', temSizeGrid: true }];
    expect(motivoRenameBloqueado(existentes, noML)).not.toBeNull();
  });
```

**(b) do pedido — a prova de ponta a ponta é no conector**, porque é lá que vive o gate `podeRenomear` (a segunda camada, para o caso de `somenteEstoque`/`preservarPublicadas` que nem chega a montar `existentes`/`atuaisNoML` para a função pura decidir).

> **Obrigatório nos dois Steps seguintes:** o stub de `buscarItemML` tem que devolver
> `temSizeGrid: true` **explicitamente** no fixture. Fixture sem o campo vale `undefined`, os dois
> guards viram no-op e os testes passam (5.1) ou falham de forma confusa (5.2) **sem provar nada**
> — é a mesma armadilha do guard morto, vista do outro lado.

Caso obrigatório (no arquivo de testes do conector, ou num teste de integração equivalente que
stuba `buscarItemML`/`atualizarItemML`): anúncio com `temSizeGrid: true`, `somenteEstoque: true`,
cor do banco `Rosa Claro` × cor no ML `Rosa-claro`, **sem** variação nova →

- resultado `ok: true` (nunca 400);
- o corpo enviado ao `atualizarItemML` traz `available_quantity` e **nenhum**
  `attribute_combinations` (`expect(JSON.stringify(payload)).not.toMatch(/attribute_combinations/)`).

O mesmo caso com `preservarPublicadas: true` também tem que sair `ok: true`.

Este é o teste que impede a correção de virar um freio no push de estoque — que roda sozinho, sem
operador olhando.

**Caso obrigatório extra (emenda 2026-09-19):** o mesmo par `Rosa Claro`/`Rosa-claro`, mas agora
num UPDATE **completo** (`somenteEstoque: false`, sem `preservarPublicadas`) — o caminho de
"Atualizar tudo"/re-ingest, não só de reposição de estoque. Resultado esperado: `ok: true`, PUT
enviado com `attribute_combinations` normal (COLOR + SIZE_GRID_ROW_ID), sem 400. É este caso —
não o de `somenteEstoque` — que a 1ª versão do fix deixava passar batido, porque antes do `foldCor`
a única proteção era o gate `!somenteEstoque`, que aqui está desligado de propósito.

- [ ] **Step 5.2: Teste do bônus R2c no conector — variação nova sem tamanho**

**(c) do pedido.** No mesmo arquivo de teste do conector: anúncio com `temSizeGrid: true` +
`a.novas` com um SKU cujo `sizeGridRowId` é `null` (exatamente o que um re-ingest de planilha com
código novo produz) →

- resultado `ok: false`, `erro.status === 400`, `erro.retentavel === false`;
- `erro.mensagemOperador` cita o SKU e fala em tamanho/numeração — **nenhum** erro cru da API do ML
  chega ao operador;
- `atualizarItemML` **não é chamado** (o PUT nem sai).

E o contra-caso, que prova o INV-1: anúncio **sem** size grid + cor nova sem `sizeGridRowId` →
`ok: true`, payload idêntico ao de hoje. É o caminho de toda cor nova publicada em produção.

- [ ] **Step 6: Rodar a suíte inteira das funções e commitar**

```bash
pnpm test supabase/functions
pnpm check:functions
/usr/bin/git add supabase/functions/
/usr/bin/git commit -m "feat(ml): tamanho em cor nova no UPDATE, nunca em variacao existente (ADR-0167)

Rename de cor e variacao nova sem tamanho recusados em anuncio com SIZE_GRID_ROW_ID,
decidindo pelo estado real do item no ML (temSizeGrid), nao por coluna do banco."
```

---

### Task 23: Ligar o resolvedor da tabela de medidas aos workers do ML (CREATE e cor nova)

**Files:**
- Create: `supabase/functions/_shared/ml/size-chart-wiring.ts` (**R1** — era `publicar-anuncio/size-chart-wiring.ts`; vive em `_shared/ml/` porque **dois** workers o importam, e cross-import entre funções não é a convenção do projeto)
- Modify: `supabase/functions/publish-familia-ml/processar.ts` (antes da chamada a `montarAnuncioCanonico`, linha ~158)
- Modify: `supabase/functions/update-familia-ml/processar.ts` (idem, no caminho de cor nova)
- Modify: `supabase/functions/_shared/anuncios/montar-canonico.ts` (aceitar os valores resolvidos)
- Test: `supabase/functions/_shared/ml/__tests__/size-chart-wiring.test.ts`

> **Correção R1 da revisão do Fable — worker certo.** A versão anterior desta tarefa punha
> `prepararSizeChart` em `publicar-anuncio/processar.ts`. Esse é o worker genérico do fan-out por
> canal do E6 (ADR-0061) e atende **canais ≠ ML** (`_shared/queue.ts:160-161`). O CREATE do
> Mercado Livre roda em `publish-familia-ml` (`queue.ts:109` → `WORKER_POR_ALVO.publish`), que
> monta o canônico em `publish-familia-ml/processar.ts:158`. Do jeito que estava, **toda** família
> com tamanho chegaria a `montarPayloadItem` sem `sizeGridId` e ele lançaria "sem tabela de
> medidas" — 100% das publicações, sempre.
>
> `publicar-anuncio` **não** é ligado nesta entrega, de propósito: nenhum canal ≠ ML tem guia de
> tamanhos aqui, e ligar os dois duplicaria a resolução. Quando a Shopee (E5) entrar, a decisão
> se refaz com o contrato dela na mão.

**Interfaces:**
- Consumes: `resolverSizeChart` (Task 19); `AnuncioCanonico.sizeGridId` e `VariacaoCanonica.sizeGridRowId` (Task 20); `montarPayloadItem` que **lança** sem eles (Task 21).
- Produces: nada novo — fecha o circuito. Sem esta tarefa, uma família com tamanho falha LOUD em `montarPayloadItem` e nunca publica.

**Por que é tarefa própria:** as Tasks 19, 20 e 21 produzem, respectivamente, o resolvedor, os campos e o consumidor — mas ninguém chama o resolvedor. A Task 21 falha alto de propósito nesse buraco; esta tarefa o fecha.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it, vi } from 'vitest';
// Importe a função de orquestração real que o Step 2 revelar.
import { prepararSizeChart } from '../size-chart-wiring.ts';

describe('prepararSizeChart (ADR-0167)', () => {
  it('familia SEM tamanho nao chama o resolvedor e devolve nulos — INV-1', async () => {
    const resolver = vi.fn();
    const r = await prepararSizeChart(
      { genero: null }, [{ codigo: 'a', tamanho: null }], { resolver, orgId: 'o1', contaExternaId: 'c1', dominio: 'D' },
    );
    expect(resolver).not.toHaveBeenCalled();
    expect(r).toEqual({ sizeGridId: null, rowIdPorTamanho: {} });
  });

  it('familia COM tamanho resolve e devolve o mapa por tamanho', async () => {
    const resolver = vi.fn().mockResolvedValue({ chartId: 'CH1', rowIdPorTamanho: { P: 'R1', M: 'R2' } });
    const r = await prepararSizeChart(
      { genero: 'masculino' },
      [{ codigo: 'a', tamanho: 'P' }, { codigo: 'b', tamanho: 'M' }],
      { resolver, orgId: 'o1', contaExternaId: 'c1', dominio: 'D' },
    );
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ genero: 'masculino', tamanhos: ['P', 'M'] }));
    expect(r.sizeGridId).toBe('CH1');
    expect(r.rowIdPorTamanho).toEqual({ P: 'R1', M: 'R2' });
  });

  it('familia com tamanho e SEM genero LANCA com status 400 — o ML exige o genero batendo com a tabela', async () => {
    const resolver = vi.fn();
    await expect(prepararSizeChart(
      { genero: null }, [{ codigo: 'a', tamanho: 'P' }], { resolver, orgId: 'o1', contaExternaId: 'c1', dominio: 'D' },
    )).rejects.toMatchObject({ status: 400 });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('deduplica os tamanhos antes de pedir a tabela (4 cores x 2 tamanhos = 2 linhas, nao 8)', async () => {
    const resolver = vi.fn().mockResolvedValue({ chartId: 'CH1', rowIdPorTamanho: { P: 'R1', M: 'R2' } });
    await prepararSizeChart(
      { genero: 'unissex' },
      [
        { codigo: 'a', tamanho: 'P' }, { codigo: 'b', tamanho: 'M' },
        { codigo: 'c', tamanho: 'P' }, { codigo: 'd', tamanho: 'M' },
      ],
      { resolver, orgId: 'o1', contaExternaId: 'c1', dominio: 'D' },
    );
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ tamanhos: ['P', 'M'] }));
  });

  // Nit R1c: `contaExternaId` vem de `ConexaoCanal` e pode ser null. Com tamanho isso e 400 LOUD
  // (a tabela de medidas pertence a conta); SEM tamanho nao pode virar erro novo — INV-1.
  it('com tamanho e sem contaExternaId LANCA 400; sem tamanho devolve nulos e nao lanca', async () => {
    const resolver = vi.fn();
    await expect(prepararSizeChart(
      { genero: 'masculino' }, [{ codigo: 'a', tamanho: 'P' }],
      { resolver, orgId: 'o1', contaExternaId: null, dominio: 'D' },
    )).rejects.toMatchObject({ status: 400 });

    const r = await prepararSizeChart(
      { genero: null }, [{ codigo: 'a', tamanho: null }],
      { resolver, orgId: 'o1', contaExternaId: null, dominio: 'D' },
    );
    expect(r).toEqual({ sizeGridId: null, rowIdPorTamanho: {} });
    expect(resolver).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/size-chart-wiring.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o orquestrador puro**

Crie `supabase/functions/_shared/ml/size-chart-wiring.ts` (miolo puro, testável sem rede — mesmo padrão de `cadastrar-produto/processar.ts`):

```ts
// ADR-0167: prepara a tabela de medidas ANTES de montar o AnuncioCanonico. Puro e com o
// resolvedor injetado para ser testável sem Supabase nem rede.
//
// INV-1: família sem nenhum tamanho nem toca no resolvedor e devolve nulos — o caminho de toda
// org sem tipo de produto habilitado não ganha nem uma chamada de rede a mais.
//
// Mora em `_shared/ml/` porque DOIS workers do ML o consomem — `publish-familia-ml` (CREATE) e
// `update-familia-ml` (cor nova). `publicar-anuncio` (canais ≠ ML) não o importa (R1).
import type { resolverSizeChart } from './resolver-size-chart.ts';

export interface PrepararSizeChartDeps {
  resolver: (args: Parameters<typeof resolverSizeChart>[1]) => Promise<{ chartId: string; rowIdPorTamanho: Record<string, string> }>;
  orgId: string;
  /** Nit R1c: vem de `ConexaoCanal.contaExternaId`, que os dois workers já têm em escopo — sem
   *  `select` extra. Nullable de propósito: a recusa é LOUD e acontece abaixo, DEPOIS do
   *  short-circuit de "sem tamanho", para não transformar publicação sem tamanho em erro novo. */
  contaExternaId: string | null;
  dominio: string;
}

export async function prepararSizeChart(
  familia: { genero: string | null },
  variacoes: readonly { codigo: string; tamanho: string | null }[],
  deps: PrepararSizeChartDeps,
): Promise<{ sizeGridId: string | null; rowIdPorTamanho: Record<string, string> }> {
  // Dedup preservando a ordem de aparição: 4 cores × 2 tamanhos precisa de 2 linhas na tabela,
  // não de 8. A tabela é de tamanhos, não de SKUs.
  const tamanhos = [...new Set(
    variacoes.map((v) => v.tamanho?.trim()).filter((t): t is string => !!t),
  )];
  if (tamanhos.length === 0) return { sizeGridId: null, rowIdPorTamanho: {} };

  // O ML exige que o gênero do anúncio bata com o da tabela. Sem gênero não dá para escolher a
  // tabela certa, e "assumir unissex" publicaria a peça no gênero errado — falha LOUD. status 400
  // = definitivo: sem isso o QStash retentaria por ~5 min um erro que nenhuma retentativa resolve.
  if (!familia.genero) {
    // R3: com a trava do cadastro (Task 12 + Task 15) este caminho só é alcançável por dado
    // legado ou payload forjado — vira rede de segurança, não o guard principal. A mensagem
    // aponta para onde o operador REALMENTE consegue corrigir: o cadastro do produto. (A versão
    // anterior mandava "informe o gênero na Revisão", e a Revisão não tem esse campo.)
    const e = new Error(
      'Família com tamanho e sem gênero informado — o Mercado Livre exige que o gênero do anúncio '
      + 'bata com o da tabela de medidas. Corrija o gênero no cadastro do produto e publique de '
      + 'novo (ADR-0167).',
    ) as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  // Nit R1c: a tabela de medidas pertence à CONTA que a criou (spike 051 §9). Sem conta não há
  // onde criá-la, e deixar passar publicaria a peça sem tabela ou na conta errada. 400, nunca
  // default silencioso. Só alcançável com tamanho — publicação sem tamanho já retornou acima.
  if (!deps.contaExternaId) {
    const e = new Error(
      'Família com tamanho e organização sem conta do Mercado Livre resolvida — a tabela de '
      + 'medidas pertence à conta que a criou. Reconecte o Mercado Livre e publique de novo '
      + '(ADR-0167).',
    ) as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  const { chartId, rowIdPorTamanho } = await deps.resolver({
    orgId: deps.orgId, contaExternaId: deps.contaExternaId,
    dominio: deps.dominio, genero: familia.genero, tamanhos,
  });
  return { sizeGridId: chartId, rowIdPorTamanho };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/size-chart-wiring.test.ts`
Expected: PASS, 5 testes (o 5º é o nit R1c: `contaExternaId` nulo).

- [ ] **Step 5: Ligar no caminho real de CREATE (`publish-familia-ml`, R1)**

Duas das quatro dependências precisam de origem explícita — não são variáveis que já existem no escopo:

- **`contaExternaId`** — a conta ML da org. A tabela de medidas pertence à conta que a criou (spike 051 §9), então trocar de conta exige tabela nova. **Nit R1c da 2ª rodada do Fable:** *não* faça `select` nenhum — o worker já resolveu a conexão em `publish-familia-ml/processar.ts:87` (`const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre')`) e `ConexaoCanal` já carrega `contaExternaId` (`_shared/canais/conexao.ts:5-11`, que seleciona `conta_externa_id`). Passe `conexao?.contaExternaId ?? null` — a recusa LOUD por conta ausente vive dentro de `prepararSizeChart` (Step 3), depois do short-circuit de "sem tamanho", para publicação sem tamanho não ganhar um erro novo (INV-1).
- **`dominio`** — o `domain_id` do ML da categoria da família. **De onde ele vem é a seção 2 do spike 051**: se a resposta for "derivado de `/categories/{id}/attributes`", leia de lá e cacheie; se for "vem no `domain_discovery`", grave no CREATE. **Se o spike não respondeu isso, este Step está bloqueado** — não deduza.

```ts
import { prepararSizeChart } from '../_shared/ml/size-chart-wiring.ts';
import { resolverComSupabase } from '../_shared/ml/resolver-size-chart.ts';
```

Em `supabase/functions/publish-familia-ml/processar.ts`, **imediatamente antes** da linha que
chama `montarAnuncioCanonico` (hoje `:158`, logo depois de `aplicarEstoqueDerivado`):

```ts
  // ADR-0167: resolve a tabela de medidas antes de montar o canônico. `sizeGridId` nulo e
  // `rowIdPorTamanho` vazio é o caminho de toda família sem tamanho — nenhuma chamada extra
  // de banco nem de rede para quem não tem tipo de produto habilitado (INV-1).
  //
  // Aqui e NÃO em `publicar-anuncio`: este é o worker de CREATE do ML (fila `publish-ml-${userId}`,
  // `_shared/queue.ts:109`); `publicar-anuncio` atende canais ≠ ML (`queue.ts:160-161`).
  const { sizeGridId, rowIdPorTamanho } = await prepararSizeChart(
    { genero: familia.genero as string | null },
    variacoesParaPublicar.map((v) => ({
      codigo: v.codigo as string, tamanho: (v.tamanho as string | null) ?? null,
    })),
    // Nit R1b (2ª rodada do Fable): NÃO existe `token` no escopo deste worker. Ele tem `ctx`,
    // montado em `:88-92` com `getToken` — o mesmo caminho que `lerSchemaAtributos` já usa em
    // `:183` (`await ctx.getToken()`). E `contaExternaId` sai de `conexao`, já resolvida em `:87`
    // (nit R1c) — sem `select` extra.
    {
      // Resolver PREGUIÇOSO: `ctx.getToken()` só roda se o resolvedor for de fato chamado, isto
      // é, se houver tamanho. Passar `await ctx.getToken()` aqui obrigaria um refresh de token em
      // TODA publicação, inclusive das orgs sem tipo de produto habilitado — regressão de INV-1.
      resolver: async (args) => resolverComSupabase(admin, await ctx.getToken())(args),
      orgId: familia.org_id as string,
      // Nit R1c: já está na mão, sem `select` extra. Pode ser null; quem recusa é
      // `prepararSizeChart`, e só quando há tamanho (ver Step 3).
      contaExternaId: conexao?.contaExternaId ?? null,
      dominio,
    },
  );
```

Use **`variacoesParaPublicar`** (a lista já filtrada e com o estoque derivado do kit), não
`variacoes` cru — é ela que vai para `montarAnuncioCanonico` na linha seguinte, e resolver a
tabela sobre um conjunto diferente do publicado é como o tamanho errado entra no anúncio.

`montarAnuncioCanonico` ganha um parâmetro opcional para receber os dois valores resolvidos
(acrescentado **depois** de `listingTypeId`, nunca antes — os dois chamadores passam
posicionalmente):

```ts
  listingTypeId?: string,
  /** ADR-0167: tabela de medidas já resolvida pelo worker. Ausente = anúncio sem tabela, que é
   *  o caso de tudo que é publicado hoje e de todo canal ≠ ML. */
  sizeChart?: { sizeGridId: string | null; rowIdPorTamanho: Record<string, string> },
```

E dentro dele, no objeto de variação:

```ts
        sizeGridRowId: v.tamanho
          ? (sizeChart?.rowIdPorTamanho[v.tamanho as string] ?? (v.size_chart_row_id as string | null) ?? null)
          : null,
```

com `sizeGridId: sizeChart?.sizeGridId ?? null` no objeto do anúncio. Os demais chamadores
(inclusive `publicar-anuncio`) não passam o parâmetro e continuam produzindo `null` nos dois
campos — payload byte a byte igual ao de hoje (INV-1).

- [ ] **Step 6: Ligar no caminho de UPDATE (cor nova)**

Em `supabase/functions/update-familia-ml/processar.ts`, antes da montagem do canônico (linha ~325), o **mesmo** bloco — importando de `../_shared/ml/size-chart-wiring.ts` (o módulo é compartilhado; **não** importe de dentro de `publish-familia-ml/`, cross-import entre funções não é a convenção do projeto):

```ts
import { prepararSizeChart } from '../_shared/ml/size-chart-wiring.ts';
import { resolverComSupabase } from '../_shared/ml/resolver-size-chart.ts';
```

As duas dependências que não são variáveis de escopo vêm das **mesmas** fontes do Step 5, e valem
para este worker também:

- **`contaExternaId`** — **nit R1c:** nenhum `select` novo. Este worker já resolve a conexão em `update-familia-ml/processar.ts:109` e usa `conexao?.contaExternaId` no ramo do ADR-0104 (`:346`). Passe `conexao?.contaExternaId ?? null`.
- **token** — **nit R1b:** `await ctx.getToken()` (o `ctx` de `:110-113`), dentro do resolver preguiçoso, exatamente como no Step 5. Não existe variável `token` aqui.
- **`dominio`** — a mesma origem definida na seção 2 do spike 051 (Step 5). **Se o spike não respondeu isso, este Step está bloqueado** — não deduza.

Passe a lista de variações que de fato vai ao canônico neste caminho (a que inclui a cor nova),
não a lista bruta do banco.

O UPDATE de reposição pura **não** chama o resolvedor de fato: `prepararSizeChart` devolve nulos
quando nenhuma variação tem tamanho, e variação existente nunca recebe atributo (Task 22).

- [ ] **Step 7: Persistir o row id resolvido**

Depois de resolver, grave `variacoes.size_chart_row_id` para cada variação — assim uma republicação não depende de resolver de novo e o dado fica auditável:

```ts
  for (const [tamanho, rowId] of Object.entries(rowIdPorTamanho)) {
    await admin.from('variacoes').update({ size_chart_row_id: rowId })
      .eq('familia_id', familiaId).eq('tamanho', tamanho);
  }
```

- [ ] **Step 8: Verificar e commitar**

```bash
pnpm check:functions && pnpm test supabase/functions
/usr/bin/git add supabase/functions/
/usr/bin/git commit -m "feat(ml): resolve a tabela de medidas antes de publicar (ADR-0167)"
```

---

> ### **Checkpoint Fable — fim da Fase 5 (payload de marketplace)** (BLOQUEANTE — obrigatório antes de qualquer publicação real)
>
> O Fable revisa o diff completo das Fases 4 e 5. Perguntas explícitas:
>
> 1. Para uma família **sem** tamanho, o payload de CREATE e o de UPDATE saem byte a byte iguais aos de antes deste diff? Onde está o teste que prova?
> 2. `montarVariacoesUpdate` continua **sem** enviar qualquer atributo novo para variação existente? (Se enviar, é o incidente do lote #45 de volta: 9 famílias com estoque não atualizado.)
> 3. O ramo plano (`atributoVariacaoPlano`) e a colisão com o hack `/^TAM/` estão cobertos por teste?
> 4. Os cinco sítios de construção de `VariacaoCanonica` foram todos atualizados? Algum `select` esqueceu a coluna nova (o `?? null` esconderia)?
> 5. A publicação falha **LOUD** quando há tamanho e não há tabela de medidas, ou existe algum caminho que publica sem ela?
> 6. (**R1**) `prepararSizeChart` está no worker **`publish-familia-ml`** — o do CREATE do ML — e não em `publicar-anuncio` (canais ≠ ML)? Existe teste ou execução real que prove que uma família com tamanho chega a `montarPayloadItem` **com** `sizeGridId`?
> 7. (**R2b**) De onde vem o sinal "esta família tem tamanho" no UPDATE? Tem que ser
>    `atual.variations.some((v) => v.temSizeGrid)` — lido do **item real no ML** por `buscarItemML`.
>    Se o diff decidir por qualquer coluna do banco (`existentes[].tamanho` ou parente), o guard é
>    morto: nenhum produtor de lote UPDATE do v1 propaga `tamanho` (ingest-lote não herda).
>    Com o sinal certo: `corDesejadaPorCodigo` deixa de ser montado e o rename pedido devolve 400
>    explícito? Existe caso **do conector** provando que uma reposição pura de estoque
>    (`somenteEstoque`, grafia divergente por normalização do ML) nessa família **não** é bloqueada?
> 8. (**R2c**) Variação nova sem `sizeGridRowId` em anúncio com size grid devolve 400 explícito
>    **antes** do PUT, com o SKU na mensagem — ou o erro cru da API do ML ainda chega ao operador?
> 9. (**R1b/R1c**) O wiring da tabela de medidas usa `await ctx.getToken()` (não uma variável
>    `token` inexistente) e `conexao.contaExternaId` (não um `select` redundante)? O `getToken` é
>    chamado **só** quando há tamanho, ou toda publicação passou a pagar um refresh de token?
> 10. (**R2d**) `motivoRenameBloqueado` compara a cor via `foldCor` (não byte a byte)? Existe teste
>     do conector provando que um UPDATE **completo** (não só `somenteEstoque`) com grafia
>     divergente por normalização do ML (`Rosa Claro`×`Rosa-claro`) sai `ok: true`, E um teste
>     separado provando que rename de verdade (`Azul`×`Azul Marinho`) continua bloqueado mesmo
>     com o fold?
>
> **Nenhuma publicação em conta real do ML antes deste parecer.** Validação até aqui é só `POST /items/validate` (que não cria anúncio).

---

# Fase 6 — Regressão explícita: INV-1, Kit, Catálogo e Pulse

**model: sonnet** (testes).

Esta fase **não assume** que nada quebrou — ela prova. Cada teste aqui existe porque uma superfície específica poderia ter sido afetada.

**Atenção às três árvores de teste** (`vitest.config.ts`): `tests/`, `src/**/__tests__/` e `supabase/functions/**/__tests__/`. Uma triagem de falhas ancorada em `src/` é cega para metade da suíte.

### Task 24: Prova do INV-1 no payload de publicação

**Files:**
- Create: `supabase/functions/_shared/ml/__tests__/publicar-sem-tamanho.test.ts`

**Interfaces:**
- Consumes: `montarPayloadItem` (Task 21), `montarVariacaoNova`/`montarVariacoesUpdate` (Task 22).
- Produces: nada — é a rede de segurança do invariante central do plano.

- [ ] **Step 1: Escrever o teste (este nasce VERDE de propósito — é um teste de regressão, não de feature)**

```ts
// INV-1 (ADR-0166): org sem tipo de produto habilitado tem comportamento byte a byte igual ao de
// antes desta entrega. Este arquivo é a prova, não a afirmação. Se algum destes falhar, a
// condicional de tamanho vazou para o caminho padrão e o defeito já está em produção.
import { describe, expect, it } from 'vitest';
import { montarPayloadItem } from '../publicar.ts';
import { montarVariacaoNova, montarVariacoesUpdate } from '../atualizar.ts';

const FAMILIA = { titulo_ml: 'Zíper Nº5', descricao_ml: null, categoria_ml_id: 'MLB1430', atributos_ml: [{ id: 'BRAND', value_name: 'Genérica' }] };
const SEM_TAMANHO = {
  codigo: '00000002', cor: 'Azul', estoque: 5, preco_publicacao: 50,
  gtin: null, ml_picture_id: 'p1', tamanho: null, sizeGridRowId: null,
};

describe('INV-1 — CREATE de org sem tipo de produto habilitado', () => {
  it('ramo variations: attribute_combinations tem SÓ COLOR', () => {
    const p = montarPayloadItem(FAMILIA, [SEM_TAMANHO, { ...SEM_TAMANHO, codigo: '00000003', cor: 'Preto' }], null, null, null);
    for (const v of p.variations!) {
      expect(v.attribute_combinations).toEqual([{ id: 'COLOR', value_name: expect.any(String) }]);
    }
  });

  it('nenhum SIZE_GRID em lugar nenhum do payload', () => {
    const p = montarPayloadItem(FAMILIA, [SEM_TAMANHO], null, null, null);
    expect(JSON.stringify(p)).not.toMatch(/SIZE_GRID/);
  });

  it('o hack pre-existente de cor "TAM ..." no ramo plano continua IDENTICO', () => {
    // publicar.ts:68-73 — se a cor comeca com TAM/TAMANHO, o ramo plano emite
    // { name: 'Tamanho', value_name } em vez de COLOR. E anterior a esta feature e NAO pode ter
    // mudado: anuncios publicados dependem dele. Este e o melhor teste concreto do INV-1 porque
    // exercita justamente a colisao entre o hack antigo e a coluna nova.
    const p = montarPayloadItem(
      FAMILIA, [{ ...SEM_TAMANHO, cor: 'TAM 40' }], null, null, null,
      undefined, undefined, undefined, 'plano',
    );
    expect(p.attributes).toContainEqual({ name: 'Tamanho', value_name: 'TAM 40' });
    expect(p.attributes).not.toContainEqual(expect.objectContaining({ id: 'COLOR' }));
    expect(JSON.stringify(p)).not.toMatch(/SIZE_GRID/);
  });

  it('cor comum no ramo plano continua saindo como COLOR', () => {
    const p = montarPayloadItem(
      FAMILIA, [SEM_TAMANHO], null, null, null,
      undefined, undefined, undefined, 'plano',
    );
    expect(p.attributes).toContainEqual({ id: 'COLOR', value_name: 'Azul' });
  });
});

describe('INV-1 — UPDATE de org sem tipo de produto habilitado', () => {
  it('cor nova sem size grid sai so com COLOR', () => {
    const nova = montarVariacaoNova(
      { codigo: '00000004', cor: 'Verde', estoque: 3, preco_publicacao: 50, gtin: null, ml_picture_id: null },
      null, null, null, 'MLB1430',
    );
    expect(nova.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Verde' }]);
  });

  it('reposicao pura de estoque nao carrega atributo nenhum', () => {
    const r = montarVariacoesUpdate(
      [{ id: 1, seller_custom_field: '00000002', available_quantity: 5, cor: 'Azul' }],
      [{ codigo: '00000002', estoque: 9 }],
      undefined, null, undefined, true,
    );
    expect(r).toEqual([{ id: 1, available_quantity: 9 }]);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `pnpm test supabase/functions/_shared/ml/__tests__/publicar-sem-tamanho.test.ts`
Expected: PASS, 6 testes. **Se algum falhar, pare** — é um defeito real introduzido pela Fase 5, não um teste a ajustar.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/ml/__tests__/publicar-sem-tamanho.test.ts
/usr/bin/git commit -m "test(ml): prova o INV-1 no payload de CREATE e UPDATE (ADR-0166)"
```

---

### Task 25: Kit vinculado continua recusando base multi-variação

**Files:**
- Create: `supabase/functions/criar-kit-vinculado/__tests__/kit-multivariacao.test.ts`

**Interfaces:**
- Consumes: `processarKits` (ou o nome real exportado de `criar-kit-vinculado/processar.ts`).
- Produces: nada — prova que o escopo v1 do ADR-0151 sobrevive.

**Por que este teste:** uma família cor × tamanho tem trivialmente mais de uma variação, e `criar-kit-vinculado/processar.ts:350` recusa base multi-variação com `motivo: 'base_multivariacao'`. Isso é o comportamento **desejado** (ADR-0151, decisão 10, escopo v1) — e precisa continuar. Além disso, `processar.ts:346` faz `select('*')` em `variacoes`, então a coluna `tamanho` nova passa a vir junto; `clonarVariacao` copia colunas por lista e pode carregar `tamanho` para o kit sem querer.

- [ ] **Step 1: Ler as exportações reais do módulo**

```bash
grep -n "^export" supabase/functions/criar-kit-vinculado/processar.ts
grep -n "clonarVariacao\|STRIP\|strip" supabase/functions/criar-kit-vinculado/processar.ts | head -20
```

Use os nomes que aparecerem — não invente assinatura.

- [ ] **Step 2: Escrever o teste**

Dois casos, no estilo dos testes já existentes em `supabase/functions/criar-kit-vinculado/__tests__/`:

```ts
import { describe, expect, it } from 'vitest';
// Importe o que o Step 1 revelou.
import { clonarVariacao } from '../processar.ts';

describe('Kit vinculado x variação por tamanho (ADR-0151 escopo v1 / ADR-0166)', () => {
  // A trava vive em processar.ts:350 — `variacoesBase.length > 1` → 'base_multivariacao'.
  // Uma família cor × tamanho tem sempre > 1 variação, logo o kit continua recusado. Este teste
  // exercita a função de clone (que é testável sem Supabase) e a trava fica coberta pelo teste
  // de integração já existente do módulo; se o Step 1 revelar a trava numa função pura,
  // acrescente aqui o caso `expect(...).toEqual({ ok: false, motivo: 'base_multivariacao' })`.
  it('clonarVariacao NAO leva tamanho para o kit — kit e unidade unica, sem eixo de tamanho', () => {
    const baseVar = {
      id: 'v1', codigo: '00000002', cor: 'Azul', tamanho: 'P',
      custo: 10, peso_gramas: 100, preco: 50, estoque: 5,
    };
    const clone = clonarVariacao(baseVar as never, /* demais args conforme a assinatura real */);
    expect(clone.tamanho ?? null).toBeNull();
  });
});
```

Se `clonarVariacao` **não** zera `tamanho`, essa é uma **correção obrigatória**, não um ajuste de teste: acrescente `tamanho: null` ao objeto que ela devolve, junto de `cor: null` / `cor_hex: null` / `cor_origem: null` (linhas 196-199), com o comentário:

```ts
    // ADR-0166: kit é unidade única sem eixo de tamanho. Herdar o tamanho da base publicaria o
    // kit como "Kit 3 unidades tamanho P", que não é o que o kit é.
    tamanho: null,
```

- [ ] **Step 3: Rodar**

Run: `pnpm test supabase/functions/criar-kit-vinculado`
Expected: PASS — o teste novo e todos os pré-existentes.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add supabase/functions/criar-kit-vinculado/
/usr/bin/git commit -m "test(kit): kit vinculado nao herda tamanho e segue recusando base multivariacao"
```

---

### Task 26: Varredura de regressão nas três árvores + Catálogo e Pulse

**Files:**
- Test: nenhum arquivo novo — esta tarefa **roda** a suíte e prova que Catálogo e Pulse não foram tocados.

**Interfaces:**
- Consumes: todo o trabalho anterior.
- Produces: evidência para o Checkpoint Fable final.

- [ ] **Step 1: Provar que o diff não toca Catálogo nem Pulse**

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/roupas-sapatos-grilling"
/usr/bin/git diff --stat origin/main...HEAD -- \
  supabase/functions/vincular-catalogo \
  supabase/functions/monitorar-catalogo \
  supabase/functions/_shared/catalogo \
  supabase/functions/_shared/concorrencia \
  src/pages/Pulse.tsx src/components/pulse
```

Expected: **saída vazia**. Se algum arquivo aparecer, é escopo vazado — reverta ou justifique no Checkpoint Fable.

- [ ] **Step 2: Rodar a suíte inteira (as três árvores)**

Run: `pnpm test`
Expected: PASS. Se houver falha, **prove** se é pré-existente rodando o mesmo arquivo em `origin/main` — nunca infira do diff:

```bash
/usr/bin/git stash push -u -m "regressao-tamanho-$(date +%s)"
/usr/bin/git stash list --format='%H %gs' | head -1   # anote o SHA
/usr/bin/git checkout origin/main -- <arquivo do teste que falhou>
pnpm test <arquivo>
```

E restaure com `git stash apply <sha>` (nunca `pop`), removendo a entrada depois. Atenção: o stash é **compartilhado** entre worktrees.

Se o CI vermelho aparecer num arquivo **fora** do seu diff, suspeite primeiro de teste com data fixa cruzando janela temporal antes de chamar de flake.

- [ ] **Step 3: Portão de pré-push**

Run: `pnpm preflight`
Expected: PASS (~3min37). Este é o único portão que reproduz o CI — não remontar o checklist à mão.

- [ ] **Step 4: Deploy do backend (obrigatório, o CI não faz)**

Liste o que mudou e deploye **tudo** que importa os `_shared/` tocados:

```bash
/usr/bin/git diff --name-only origin/main...HEAD -- supabase/functions/ supabase/migrations/
```

Para cada `_shared/` alterado (`produto/`, `ml/`, `canais/`, `anuncios/`, `user-products/`), redeploye **todas** as funções que o importam — no mínimo: `cadastrar-produto`, `usuarios`, **`publish-familia-ml`**, `publicar-anuncio`, `update-familia-ml`, `publicar-split-ml`, `adicionar-variacoes-familia`, `criar-kit-vinculado`, `process-familia`.

> **Correção R1 da revisão do Fable:** `publish-familia-ml` estava **fora** desta lista — e é
> justamente o worker de CREATE do ML, o que recebe `size-chart-wiring.ts` (Task 23). Sem ele no
> deploy, a feature inteira fica no repositório e nada muda em produção.

```bash
supabase functions deploy cadastrar-produto usuarios publish-familia-ml publicar-anuncio update-familia-ml publicar-split-ml adicionar-variacoes-familia criar-kit-vinculado process-familia
supabase functions list | grep -E "cadastrar-produto|usuarios|publish-familia-ml|publicar-anuncio|update-familia-ml"
```

Expected: versão nova ativa em cada uma. **Ordem obrigatória quando há migration junto: `db push` → `functions deploy` → merge.** O merge deploya o front, nunca as functions.

- [ ] **Step 5: Validação em runtime real (não substituível por teste)**

Com a skill `playwright-cli`, em **sessão isolada** (nunca disputar o Chrome do Diego via CDP) e com a conta VALIDATION:

1. Org **sem** tipo habilitado: abrir Estoque → Cadastrar produto. Tirar **screenshot**. Confirmar que não há campo Gênero, não há bloco "Gerar variações" e não há select de Tamanho na linha.
2. Org **com** `roupa`: mesma tela. Digitar "Azul, Preto", marcar P e M, clicar "Gerar variações", confirmar 4 cards. Screenshot.
3. Conferir o número na tela 1:1 com o banco (`select tamanho from variacoes where familia_id = …`).

Snapshot de acessibilidade **não** pega bug de layout CSS — screenshot real é obrigatório.

- [ ] **Step 6: Commit da evidência (se houver ajuste) e fim da fase**

```bash
/usr/bin/git status --short
```

Expected: árvore limpa, ou só ajustes que a validação revelou (cada um com seu commit).

---

# Revisão do Fable — checklist consolidado

O agente revisor **Fable** (`fable-advisor`) é chamado nos pontos abaixo. Cada um é **nomeado e obrigatório**; nenhum é nota de rodapé. Chamar o Fable vale inclusive em execução em background.

| # | Quando | O que ele recebe | Bloqueia? |
|---|---|---|---|
| **F1** | Fim da **Fase 0**, antes de tocar em schema | `docs/spikes/051-*.md` + os dois ADRs (0166, 0167) | **Sim** |
| **F2** | **Plano completo**, antes de começar a Fase 1 | Este documento inteiro | **Sim** |
| **F3** | Fim da **Fase 1** (migration `organizations`) | Diff completo da Fase 1 | **Sim** |
| **F4** | Fim da **Fase 2** (migration `familias`/`variacoes`) | Diff da migration + `database.types.ts` | **Sim** |
| **F5** | Fim da **Fase 3** (UX + contrato de entrada) | Diff da Fase 3 | Recomendado |
| **F6** | Fim da **Fase 4** (migration + API do ML) | Diff das Tasks 17-19 + o spike | **Sim** |
| **F7** | Fim da **Fase 5** (payload de publicação) | Diff das Tasks 20-23 | **Sim — nenhuma publicação real antes** |
| **F8** | **Diff final completo**, antes do merge | `git diff origin/main...HEAD` inteiro | **Sim** |

### Perguntas obrigatórias no F8 (diff final)

1. **INV-1:** existe algum caminho em que uma org com `tipos_produto_habilitados = '{}'` se comporta diferente de antes? Aponte o teste que prova o contrário, não a intenção.
2. **Marketplace:** o payload de CREATE e o de UPDATE de uma família sem tamanho são idênticos aos de antes? `montarVariacoesUpdate` continua sem enviar atributo em variação existente?
3. **Financeiro:** o guard de retry idempotente (`variacoesDivergem`) cobre `tamanho`? Um retry que trocou só o tamanho devolve 409?
4. **Schema:** as três migrations são aditivas? Alguma tabela nova ficou sem RLS por `org_id`?
5. **Deploy:** todas as edges que importam os `_shared/` tocados foram redeployadas e estão com versão nova ativa?
6. **Escopo:** Kit, Kit Virtual, Catálogo e Pulse aparecem no diff? (Devem estar ausentes, salvo o `tamanho: null` do clone de kit.)
7. **Dedução:** algum valor de payload do ML neste diff não está literalmente no spike 051?

### Caminho de entrega (depois do F8 favorável)

1. `pnpm preflight` verde.
2. Push da branch → aguardar CI (`frontend`, `backend-lint`) verde.
3. `supabase db push` (as três migrations) e `supabase functions deploy` das funções afetadas — **antes** do merge.
4. Merge fast-forward na `main`. Nunca `--admin` sobre check vermelho, nunca force-push.
5. Deletar a branch, remover a worktree (`rm -rf` + `git worktree prune`, nunca `git worktree remove`), e **`git pull` na `main` local** — o ciclo só fecha aí.
6. Atualizar o Graphify após a mudança estrutural (skill `graphify-update-maintenance`).
7. Atualizar `docs/project-status.md` e `docs/reference/glossario.md` (os verbetes do grilling passam de "decidido" para "em produção").
