# Spec — Preço por variação, split por faixa de preço e controle de preço no UPDATE

**Data:** 2026-07-15
**Branch:** `worktree-preco-por-variacao-split`
**ADR:** [0078](../../decisions/0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md)
**Status:** Design em aprovação (Diego) — revisão adversarial Fable aplicada (2026-07-15)

## Objetivo

Quando as variações de um produto têm **preços diferentes**, permitir configurar **de→para (% OFF) e preço de atacado por faixa de preço** (variações de mesmo preço = uma config). Como o atacado (PxQ) é por-item, cada faixa de preço vira um **anúncio próprio** (split). Além disso, devolver ao operador o **controle do preço no UPDATE** (badge + filtro + escolha "atualizar tudo × só estoque").

Vale para **CREATE** e **UPDATE**. Caminho comum (preço uniforme — 32/32 famílias hoje) permanece **idêntico**.

## Não-objetivos

- Fazer o de→para renderizar no ML se ele estiver descartado (ADR-0017) — será **validado no browser**; se não renderizar, entrega como preview interno + pronto para `PRICE_DISCOUNT`.
- PxQ por-variação dentro de um único anúncio — impossível (ADR-0041); é o motivo do split.
- Migrar automaticamente variação já publicada entre anúncios (perda de histórico) — sempre LOUD + decisão humana.

## Glossário

- **Faixa de preço / grupo:** conjunto de variações com o mesmo `preco_publicacao` (comparado por **centavos inteiros** — arredondamento a 2 casas antes de agrupar).
- **Partição:** uma linha de `anuncios_externos` = um anúncio ML (ADR-0048).
- **Pinado:** variação com `preco_editado_pelo_operador = true` — imune ao recálculo do re-ingest.

## Invariantes de segurança (guias inegociáveis do design)

1. **Nunca existe preço divergente publicado sem split.** Até a Fase 2 existir, o app **força uniforme** (comportamento de hoje). A UI que cria divergência e o split que a suporta entram **juntos** (F2). Nunca há janela em que o operador crie preços divergentes e o publish colapse/rejeite em silêncio.
2. **Config financeira nunca órfã em silêncio.** A config de desconto/atacado **viaja na variação** (não é chaveada por valor de preço). No publish, se um grupo de preço não tem config explícita e há divergência, é **LOUD**, nunca fallback mudo (regra do projeto: nada financeiro defaulta em silêncio — ADR-0055).
3. **"Só estoque" não empurra preço por nenhum caminho.** Nem `precoFamilia`, nem o ramo de desconto, nem cor nova a preço divergente.
4. **Ancoragem manda; migração nunca é silenciosa.** Variação publicada não muda de anúncio sozinha — cruzar faixa ⇒ LOUD + decisão humana.

## Modelo de dados (proposta — confirmar no plano/TDD)

Aditivo; caminho uniforme não usa nada novo.

- **Config por VARIAÇÃO** (não por valor de preço — resolve a orfandade silenciosa): `variacoes.exibir_com_desconto` (bool), `variacoes.desconto_pct` (numeric, nullable), `variacoes.atacado` (jsonb, nullable, mesmo shape `FaixaAtacado[]` de hoje).
  - Default no ingest = herda a config família-level atual (`familias.exibir_com_desconto`/`desconto_pct`/`atacado`), preservando o comportamento uniforme.
  - **Grupo de preço** (no publish) = variações com o mesmo preço; a config do grupo = a config **compartilhada** das suas variações. A UI edita o grupo escrevendo em **todas** as variações do grupo (mantém consistência). Se um grupo tiver variações com config divergente (não deveria acontecer pela UI) → **LOUD**.
  - `familias.*` permanece como **legado/uniforme**: fonte de verdade quando todas as variações têm config idêntica; a UI uniforme continua editando via `familias.*` e replicando às variações.
- **Pinagem:** reusa `variacoes.preco_editado_pelo_operador` (já existe; já pulado no recálculo — `process-familia:395`). Setado **sempre que o operador define preço** — tanto "Sim, aplicar às demais" (pina **todas** as afetadas, preservando o comportamento atual de `updateVariacaoPreco`, `queries.ts:182`) quanto "Não" (pina só a editada). Impede que o re-ingest reembaralhe um grupo recém-montado.
- **Detecção de preço alterado (badge):** `variacoes.preco_publicado_ml` (numeric, nullable) — o preço **efetivamente confirmado no ML** no último PUT/POST bem-sucedido **daquela variação** (gravado **por partição, a cada sucesso** — não ao fim do worker, senão falha parcial do split faz o badge mentir). Sincronizado **oportunisticamente** a partir do `GET /items` que o update já faz (corrige stale se o preço foi mexido no painel do ML). Badge = `round2(preco_publicacao) != round2(preco_publicado_ml)` com `preco_publicado_ml` não-nulo.
- **Status de atacado por partição (F3):** `anuncios_externos.atacado_status`/`atacado_erro` — `familias.atacado_status` escalar não representa falha parcial (grupo A aplicado, grupo B erro) com N anúncios. Migra de família-level para por-partição na F3.
- **Escolha do UPDATE:** transiente — carregada no **payload do job de publicação** (a escolha global + o mapa de overrides por produto). O payload **inclui** essas decisões para o retry do QStash ser idempotente (a decisão não pode se perder no reprocessamento).

> **Migration:** `add column if not exists` para `variacoes.exibir_com_desconto`/`desconto_pct`/`atacado` e `variacoes.preco_publicado_ml`; `anuncios_externos.atacado_status`/`atacado_erro` (F3). Backfill não-destrutivo: config das variações herda o família-level; `preco_publicado_ml` começa null e é preenchido no 1º publish/update de cada variação. RLS por `org_id` mantida (colunas em tabelas já sob RLS).

## Fases (revisadas — cada uma segura isolada)

### Fase 1 — Controle de preço no UPDATE (sem split, sem divergência)

- `variacoes.preco_publicado_ml` + gravação por sucesso + sync do GET.
- **Badge "preço alterado"** + **filtro** na Revisão.
- **Diálogo de publicação:** "N produtos com alteração de preço" → escolha **global** (Atualizar tudo × Somente estoque) + **override por produto**; escolha no payload do job.
- **"Somente estoque"** — comportamento original do corpo do ADR-0016, agora explícito. Suprime **todo** push de preço:
  - não envia `precoFamilia`;
  - **suprime também o ramo de desconto** (`atualizar.ts:99-106` hoje envia `price`+`original_price` quando `exibir_com_desconto`): em "só estoque", nem `price` nem `original_price` vão;
  - **cor nova** (que obriga `price` no PUT — `atualizar.ts:37`, `VariacaoNovaPut.price` required): entra **no preço vivo do anúncio** (o conector já faz `GET /items`; usa o `price` retornado), evitando `Found different prices in variations` (regressão do lote #31). Se não houver preço vivo utilizável → **LOUD**, não publica em silêncio.
- Preço uniforme continua forçado (nenhuma divergência ainda). **Entrega valor sozinha; zero risco de split.**

### Fase 2 — Preço por variação + agrupamento + split por faixa + config por grupo (juntos)

Divergência e split entram **atomicamente** (invariante #1).

- `process-familia` para de colapsar; publish/update passam a agrupar por preço.
- UI: prompt "aplicar às demais?"; agrupamento por preço; config de de→para/atacado **por grupo**; botões de lote desabilitados na divergência.
- `ehSplit` (roteamento em `publicar-familias`) ganha a condição de **divergência de preço** (hoje decide split só por contagem >100) — em CREATE **e** UPDATE.
- `particionar` recebe o preço por sku (ver "Particionamento").
- Split worker (`publicar-split-ml`) passa a **aplicar atacado por partição** — **lacuna pré-existente:** hoje só `publish-familia-ml`/`update-familia-ml` chamam `aplicarAtacado`; o split nunca aplicou. F3/F2 fecha isso.

*(Se o tamanho exigir, F2 pode ser fatiada no plano — mas divergência-sem-split nunca pode chegar a produção.)*

## Fluxo CREATE

1. `process-familia` calcula `preco_publicacao` por variação (não colapsa).
2. Operador ajusta preços (prompt "aplicar às demais?") e, por grupo, de→para + atacado (gravados nas variações do grupo).
3. Publicação (`publicar-split-ml`): agrupa por `round2(preco_publicacao)` → particiona por preço (subdivide por 100 cores dentro do grupo). Cada anúncio:
   - preço uniforme (o do grupo);
   - `original_price` por variação, se o grupo tem de→para (`_shared/preco/desconto.ts`, já por-variação);
   - PxQ via `aplicarAtacado(ctx, itemId, precoDoGrupo, faixasDoGrupo)` (base = preço **do grupo**);
   - título distinto por IA (ADR-0048).
4. `preco_publicado_ml` de cada variação gravado **quando a partição dela sobe com sucesso** (não ao fim). `anuncios_externos.atacado_status` por partição.

## Fluxo UPDATE

1. Re-ingest recalcula preços (exceto pinados). Revisão mostra **badge** e **filtro**.
2. Diálogo de publicação: **Atualizar tudo × Somente estoque** (global + override). "Só estoque" = invariante #3.
3. **Ancoragem + LOUD:** para cada variação cujo novo preço a tornaria incompatível com a **faixa da partição** dela (cruzar faixa; ou tornar divergente um anúncio hoje uniforme):
   - **não move** a variação;
   - **LOUD** na Revisão: "honrar este preço exige dividir/migrar; X variações perderiam histórico — decida";
   - operador: repreçar o grupo uniforme, aceitar a divisão (perda explícita), ou adiar (só estoque).
4. Variações compatíveis: preço/atacado/de→para reaplicados por anúncio. `preco_publicado_ml` atualizado por sucesso.

## Particionamento por preço (estende ADR-0048)

- **Faixa de uma partição = preço vivo das suas variações ancoradas** (`preco_publicado_ml`). Quando null (família legada, sem backfill), a faixa é resolvida pelo **`GET /items`** ao vivo no UPDATE — nunca por inferência local ambígua.
- `particionar(...)` recebe `preco_publicacao` por sku. Ordem: **agrupa por preço → dentro do grupo aplica a regra alfabética/100 atual → respeita ancoragem** (sku ancorado nunca migra; preço incompatível → LOUD, não migra).
- **Desempate determinístico:** cor **nova** cujo preço casa com mais de uma partição vai para a de **menor `particao`**. Mantém idempotência.
- `anuncios_externos.particao` continua smallint sequencial; identidade (`org_id,canal,codigo_pai,particao`) inalterada. Mapa sku→partição segue sendo a ancoragem.

## UI da Revisão

- **Uniforme (comum):** tela de hoje intocada.
- **Divergente:** variações **agrupadas por preço**; cada grupo com seu preview de de→para + editor de atacado. Botões **"Ativar desconto no lote"/"Atacado no lote" desabilitados** (tooltip: "preços divergentes — configure por faixa").
- **Edição de preço:** prompt "aplicar às demais variações?" — **Sim** = replica + **pina todas**; **Não** = preço próprio + pina só a editada.
- **Badge "preço alterado"** + **filtro** dedicado.
- **Diálogo de publicação (UPDATE):** resumo + escolha global + override por produto + destaque **LOUD** dos casos que exigem decisão.

## Casos de teste (TDD — RED antes de implementar)

- Uniforme: 1 grupo, 1 anúncio, payload e PxQ idênticos ao atual (caracterização — não regride).
- 2 preços → 2 anúncios, cada um com preço/atacado/de→para próprios; PxQ base = preço do grupo.
- Grupo de preço com >100 cores → subdivide por cor dentro do grupo.
- **Config viaja na variação:** repreçar uma variação não órfã a config; grupo sem config explícita + divergência → **LOUD** (nunca aplica em silêncio).
- Pinagem: "Sim" pina todas; "Não" pina só a editada; variação pinada não recalcula no re-ingest; não-pinada recalcula.
- Badge: divergente → badge; igual → sem badge; `preco_publicado_ml` null → sem badge.
- **"Só estoque" + cor nova a preço divergente:** cor nova entra no **preço vivo**, PUT **não** falha (`Found different prices`); sem preço vivo → LOUD.
- **"Só estoque" + desconto ativo:** ramo de desconto **não** empurra `price`/`original_price`.
- UPDATE "tudo" sem cruzar faixa: reprecifica no mesmo anúncio, sem LOUD.
- UPDATE "tudo" cruzando faixa / uniforme→divergente publicado: **LOUD**, variação **não migra**.
- **Falha parcial do split:** partição 0 sobe, 1 falha → `preco_publicado_ml` da 0 gravado, badge não mente.
- Override por produto sobrepõe a escolha global; escolha sobrevive ao retry do QStash (está no payload).
- `montarFaixasPxQ`: `amount` correto sobre o preço do grupo.
- Desempate de partição: cor nova em preço que casa 2 partições → menor `particao`.

## Validação de fim de branch

- `pnpm lint` + `pnpm test` verdes.
- **browser (leitura, Chrome do Diego):** abrir um anúncio ao vivo e confirmar se o de→para renderiza via `original_price` ou vem do atacado B2B — decide o texto do preview e se há follow-up. Comparar Revisão 1:1 com o publicado.
- Regressão de publicação ML real (CREATE de teste) no fluxo controlado do Diego.
- Docs: `docs/reference/modelo-de-dados.md` (colunas), `docs/reference/edge-functions.md` (publish/update/split), `obsidian-vault/04-Decisões/Índice de ADRs.md` (ADR-0078).

## Limitação honesta (repetida do ADR)

Tornar **divergente** um produto **já publicado como anúncio único** = dividir em N anúncios = mover variação entre itens no ML = **deletar+recriar** (perde histórico/vendas/perguntas). Sem contorno de código. Sempre **LOUD + decisão humana**; produtos novos são limpos.
