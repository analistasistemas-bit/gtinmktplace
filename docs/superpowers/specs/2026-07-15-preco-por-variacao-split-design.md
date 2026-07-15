# Spec — Preço por variação, split por faixa de preço e controle de preço no UPDATE

**Data:** 2026-07-15
**Branch:** `worktree-preco-por-variacao-split`
**ADR:** [0078](../../decisions/0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md)
**Status:** Design em aprovação (Diego) — antes do plano de implementação

## Objetivo

Quando as variações de um produto têm **preços diferentes**, permitir configurar **de→para (% OFF) e preço de atacado por faixa de preço** (variações de mesmo preço = uma config). Como o atacado (PxQ) é por-item, cada faixa de preço vira um **anúncio próprio** (split). Além disso, devolver ao operador o **controle do preço no UPDATE** (badge + filtro + escolha "atualizar tudo × só estoque").

Vale para **CREATE** e **UPDATE**. Caminho comum (preço uniforme — 32/32 famílias hoje) permanece **idêntico**.

## Não-objetivos

- Fazer o de→para renderizar no ML se ele estiver descartado (ADR-0017) — será **validado no browser**; se não renderizar, entrega como preview interno + pronto para `PRICE_DISCOUNT`.
- PxQ por-variação dentro de um único anúncio — impossível (ADR-0041); é o motivo do split.
- Migrar automaticamente variação já publicada entre anúncios (perda de histórico) — sempre LOUD + decisão humana.

## Glossário

- **Faixa de preço / grupo:** conjunto de variações com o mesmo `preco_publicacao`.
- **Partição:** uma linha de `anuncios_externos` = um anúncio ML (ADR-0048).
- **Pinado:** variação com `preco_editado_pelo_operador = true` — imune ao recálculo do re-ingest.

## Modelo de dados (proposta — confirmar no plano/TDD)

Aditivo; caminho uniforme não usa nada novo.

- **Config por faixa:** `familias.config_por_faixa` (jsonb, nullable). Map `centavos(preco) → { exibir_com_desconto: bool, desconto_pct: number|null, atacado: FaixaAtacado[]|null }`.
  - Chave = preço em **centavos inteiros** como string (evita `12.5` vs `12.50`).
  - `null`/`{}` = usar config família-level de hoje (`exibir_com_desconto`/`desconto_pct`/`atacado`) → comportamento atual.
  - Popula só quando há preços divergentes.
- **Pinagem:** reusa `variacoes.preco_editado_pelo_operador` (já existe; já pulado no recálculo — `process-familia:395`). Setado quando o operador define preço de uma variação e escolhe "não aplicar às demais".
- **Detecção de preço alterado (badge):** `variacoes.preco_publicado_ml` (numeric, nullable) — o preço **efetivamente confirmado no ML** no último publish/update bem-sucedido. Badge = `preco_publicacao != preco_publicado_ml` (com `preco_publicado_ml` não-nulo). Gravado ao fim de publish/update com sucesso.
- **Escolha do UPDATE:** transiente, **não** persiste em coluna — é decisão do momento da publicação (global do lote + override por produto), carregada no payload do job de publicação. (Se precisar sobreviver a reload da Revisão, avaliar `familias.atualizar_apenas_estoque bool` no plano — decisão adiada; YAGNI até provar necessário.)

> **Migration:** `add column if not exists` para `config_por_faixa` e `preco_publicado_ml`. Sem backfill destrutivo. `preco_publicado_ml` começa null; a 1ª publicação/update de cada família o preenche.

## Fluxo CREATE

1. `process-familia` já calcula `preco_publicacao` por variação; para de ser colapsado.
2. Operador, na Revisão, ajusta preços (com o prompt "aplicar às demais?") e, por grupo de preço, o de→para e o atacado.
3. Publicação (estende `publicar-split-ml`): agrupa variações por `preco_publicacao` → particiona por preço (e subdivide por 100 cores dentro do grupo). Cada anúncio:
   - preço uniforme (o do grupo);
   - `original_price` por variação, se o grupo tem de→para (via `_shared/preco/desconto.ts`, já por-variação);
   - PxQ do grupo via `aplicarAtacado(ctx, itemId, precoDoGrupo, faixasDoGrupo)` (base = preço **do grupo**, não representativo);
   - título distinto por IA (ADR-0048).
4. `anuncios_externos`: uma linha por (faixa de preço × chunk de cor). `preco_publicado_ml` das variações gravado no sucesso.

## Fluxo UPDATE

1. Re-ingest recalcula preços (exceto pinados). Revisão mostra **badge** nos produtos com `preco_publicacao != preco_publicado_ml` e oferece **filtro** "só com alteração de preço".
2. Ao publicar, se há produtos com alteração de preço, diálogo: **Atualizar tudo (preço + estoque) × Somente estoque** — global, com **override por produto**.
   - **Somente estoque:** `precoFamilia`/preço não enviado (só `available_quantity`) — comportamento original do corpo do ADR-0016. Sem split/LOUD.
   - **Atualizar tudo:** empurra os preços.
3. **Ancoragem + LOUD:** para cada variação cujo novo preço a tornaria incompatível com o grupo do seu anúncio (cruzar faixa; ou tornar divergente um anúncio hoje uniforme):
   - **não move** a variação;
   - marca **LOUD** na Revisão (mesmo padrão de trava-que-falha-alto das regras financeiras, ADR-0055): "honrar este preço exige dividir/migrar; X variações perderiam histórico — decida";
   - operador escolhe: repreçar o grupo uniforme, aceitar a divisão (com a perda explícita), ou adiar (só estoque).
4. Variações compatíveis: preço/atacado/de→para reaplicados por anúncio, como hoje. `preco_publicado_ml` atualizado no sucesso.

## UI da Revisão

- **Uniforme (comum):** tela de hoje intocada — controles de desconto/atacado por família, edição de preço replica para todas.
- **Divergente:** variações **agrupadas por preço**; cada grupo mostra seu preview de de→para + editor de atacado. Botões **"Ativar desconto no lote" / "Atacado no lote" desabilitados** (tooltip: "preços divergentes — configure por faixa").
- **Edição de preço:** prompt "aplicar às demais variações?" (Sim = replica + mantém uniforme; Não = preço próprio + pina a variação).
- **Badge "preço alterado"** por produto + **filtro** dedicado.
- **Diálogo de publicação (UPDATE):** resumo "N produtos com alteração de preço" + escolha global + override por produto + destaque LOUD dos casos que exigem decisão.

## Particionamento por preço (estende ADR-0048)

`particionar(...)` ganha o preço por sku. Ordem: **agrupa por preço → dentro do grupo aplica a regra alfabética/100 atual → respeita ancoragem existente** (sku ancorado nunca migra; se o preço o tornaria incompatível → LOUD, não migra). `anuncios_externos.particao` continua smallint sequencial; a identidade do anúncio (`org_id,canal,codigo_pai,particao`) não muda. O mapa sku→partição segue sendo a ancoragem.

## Casos de teste (TDD — RED antes de implementar)

- Uniforme: 1 grupo, 1 anúncio, payload e PxQ idênticos ao atual (caracterização — não regride).
- 2 preços → 2 anúncios, cada um com preço/atacado/de→para próprios; PxQ base = preço do grupo.
- Grupo de preço com >100 cores → subdivide por cor dentro do grupo.
- Pinagem: variação pinada não recalcula no re-ingest; não-pinada recalcula.
- Badge: `preco_publicacao != preco_publicado_ml` → badge; igual → sem badge; `preco_publicado_ml` null → sem badge (nunca publicado).
- UPDATE "só estoque": não envia preço; PxQ não reaplica por preço; nenhum LOUD.
- UPDATE "tudo" sem cruzar faixa: reprecifica no mesmo anúncio, sem LOUD.
- UPDATE "tudo" cruzando faixa / uniforme→divergente em anúncio publicado: **LOUD**, variação **não migra**, publicação não perde histórico sem decisão.
- Override por produto sobrepõe a escolha global.
- `montarFaixasPxQ`: `amount` correto sobre o preço do grupo (não representativo).

## Validação de fim de branch

- `pnpm lint` + `pnpm test` verdes.
- **browser (leitura, Chrome do Diego):** abrir um anúncio ao vivo e confirmar se o de→para renderiza via `original_price` ou vem do atacado B2B — decide o texto do preview e se há follow-up. Comparar Revisão 1:1 com o publicado.
- Regressão de publicação ML real (CREATE de teste) fica no fluxo controlado do Diego.
- Docs: atualizar `docs/reference/modelo-de-dados.md` (colunas), `docs/reference/edge-functions.md` (publish/update/split), `obsidian-vault/04-Decisões/Índice de ADRs.md` (ADR-0078).

## Limitação honesta (repetida do ADR)

Tornar **divergente** um produto **já publicado como anúncio único** = dividir em N anúncios = mover variação entre itens no ML = **deletar+recriar** (perde histórico/vendas/perguntas). Sem contorno de código. Sempre **LOUD + decisão humana**; produtos novos são limpos.
