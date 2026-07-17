# ADR-0078 — Preço por variação, split por faixa de preço e controle de preço no UPDATE

**Status:** Aceito — implementado (F1+F2) — 2026-07-17
**Decisores:** Diego
**Relacionado:** ADR-0016 (UPDATE reposição de estoque + adendo preço propaga), ADR-0017 (selo de desconto % OFF estacionado), ADR-0041 (preço de atacado PxQ B2B), ADR-0048 (split de produto em N anúncios), ADR-0064 (concorrência agregada por variação), ADR-0076 (gross-up itera frete por variação)
**Spec:** `docs/superpowers/specs/2026-07-15-preco-por-variacao-split-design.md`

## Contexto

Hoje o preço é **uniforme por família**: o `process-familia` calcula `preco_publicacao` por variação (`process-familia/index.ts:393-401`, frete por variação — ADR-0076), mas o publish/update **colapsa** para um único preço (`precoFamilia` = 1º `preco_publicacao` não-nulo, `update-familia-ml/index.ts:135`) e a UI replica qualquer edição para todas as cores (`familia-expanded.tsx:180`). As configs de **desconto de marketing** (de→para, `familias.exibir_com_desconto`) e **atacado** (`familias.atacado`, PxQ) são **uma por família**.

Diego quer, quando as variações têm **preços diferentes**, definir **de→para e atacado por faixa de preço** (variações de mesmo preço = uma única config). Consulta anterior concluiu que isso exige **split na publicação**, porque hoje é uma publicação única.

Restrições externas confirmadas na investigação:

1. **Atacado (PxQ) é por-item, preço-base único** (`POST /items/{id}/prices/standard/quantity`, `amount` absoluto — ADR-0041, `_shared/ml/atacado.ts`). Não há dimensão por-variação. → Faixas de preço distintas com atacado próprio **obrigam anúncios separados**. Esta é a única forçante técnica do split.
2. **Preço uniforme entre variações de um mesmo anúncio** é premissa assumida em produção (`atualizar.ts:66-75`, "o ML exige preço único entre variações"). Um anúncio por faixa de preço **satisfaz** essa premissa valendo ela dura ou não — a arquitetura não depende de confirmá-la. Confirmação autenticada fica para a implementação.
3. **de→para (% OFF) via `original_price`** foi constatado **descartado** pelo ML (ADR-0017, jun/2026); o acesso público a `/items` está agora fechado (403 PolicyAgent), então a renderização real será **validada no browser** num anúncio ao vivo antes da entrega. Segue-se construindo o de→para por-variação (o payload já o envia por variação — `publicar.ts:112-126`, `atualizar.ts:99-104`); se não renderizar, vale como preview interno e fica pronto para o `PRICE_DISCOUNT` (também por-item → o mesmo split serve) quando as promoções desbloquearem.
4. **Split já existe em produção** (ADR-0048, `publicar-split-ml`): 1 produto → N anúncios, particionado alfabeticamente por cor (100/anúncio) com ancoragem sku→partição, título distinto por IA e cap de estoque. É a infra a estender.

Fonte adicional de divergência de preço: o **re-ingest recalcula** `preco_publicacao` por variação (concorrência ao vivo + frete por variação), exceto variações com `preco_editado_pelo_operador = true` (`process-familia/index.ts:395`). Logo, preços divergentes não nascem só de edição manual — o recálculo automático também pode divergir.

## Decisão

### 1. Preço por variação com pinagem

O publish/update para de colapsar para `precoFamilia`: cada variação usa seu `preco_publicacao`. Ao editar o preço na Revisão, o sistema **pergunta "aplicar às demais variações?"** (em vez de replicar no automático). Preços definidos pelo operador ficam **pinados** via o flag já existente `preco_editado_pelo_operador`, imunes ao recálculo do re-ingest. Grupos de preço não reembaralham sozinhos.

### 2. Split por faixa de preço (aditivo ao ADR-0048)

Na publicação, variações são agrupadas por `preco_publicacao`; cada grupo vira **um anúncio** (partição em `anuncios_externos`). Chave de particionamento passa a ser **preço primeiro**; um grupo de preço com >100 cores ainda subdivide pela regra alfabética atual. Cada anúncio tem **preço único** (satisfaz a premissa de uniformidade). Caminho comum (todas as cores no mesmo preço — 32/32 famílias hoje) fica **idêntico** ao atual: um grupo, um anúncio.

### 3. Config de desconto + atacado por grupo

`exibir_com_desconto`/`desconto_pct` e `atacado` passam a ser **por faixa de preço** (não mais só por família). Cada anúncio recebe seu de→para e seu PxQ, com o `amount` do atacado calculado sobre o **preço do grupo** — corrige a limitação assumida no ADR-0041 ("faixa por-variação fora de escopo; usa preço representativo"). Uniforme = um grupo = comportamento de hoje. Na Revisão, com preços divergentes as variações aparecem **agrupadas por preço**, cada grupo com sua config; os botões **"Ativar desconto no lote" / "Atacado no lote" ficam desabilitados** (config deixa de ser uniforme).

A config **viaja na variação** (colunas em `variacoes`), **não** é chaveada pelo valor do preço — repreçar não pode orfanar config financeira em silêncio. Grupo com preço divergente **sem config explícita** → **LOUD**, nunca fallback mudo (regra do projeto: nada financeiro defaulta em silêncio, ADR-0055). Como o split nunca aplicou atacado (só `publish/update-familia-ml` chamam `aplicarAtacado`), a F2 fecha essa lacuna aplicando PxQ **por partição**, e o `atacado_status`/`atacado_erro` migram de família-level (escalar) para `anuncios_externos` (representa falha parcial entre anúncios).

### 4. Controle de preço no UPDATE (devolve o controle que o adendo do ADR-0016 tirou)

- **Badge "preço alterado"** em cada produto já publicado cujo preço a publicar difere do preço no ar.
- **Filtro** na Revisão para ver só esses casos.
- **Escolha ao publicar UPDATEs:** o sistema informa quantos produtos têm alteração de preço e o operador escolhe **global no lote** (Atualizar tudo × Somente estoque) **com override por produto**. **"Somente estoque"** restaura o comportamento **original** do corpo do ADR-0016 (envia só `available_quantity`, preserva o preço no ML) — agora como escolha explícita, não hardcoded. Enquanto "só estoque", o preço não é empurrado → nenhuma variação cruza faixa → **nenhum split reembaralha e nenhum LOUD dispara**.
  - "Só estoque" suprime o preço **por todos os caminhos**: não envia `precoFamilia` **nem** o `price`/`original_price` do ramo de desconto (que hoje tem precedência — `atualizar.ts:99-106`). E **cor nova** — que obriga `price` no PUT (`atualizar.ts:37`) — entra no **preço vivo do anúncio** (via `GET /items` que o conector já faz), evitando o erro `Found different prices in variations` (regressão do lote #31); sem preço vivo utilizável → **LOUD**, não publica em silêncio.
  - A escolha (global + overrides) viaja no **payload do job** de publicação, para o retry do QStash ser idempotente.

### 5. UPDATE seguro: ancoragem manda, migração nunca é silenciosa

A ancoragem sku→partição do ADR-0048 continua absoluta: variação publicada **não migra** de anúncio sozinha. Se um UPDATE (com preço ligado) tornaria a variação incompatível com o grupo do seu anúncio — cruzar faixa, ou tornar divergente um anúncio hoje uniforme —, o sistema **sinaliza LOUD** na Revisão e **o operador decide**. Nunca deleta+recria em silêncio.

## Consequências

- **Positivas:** de→para e atacado corretos por faixa de preço; atacado deixa de usar preço representativo; operador recupera o controle "preço × só estoque" no UPDATE com visibilidade (badge/filtro); caminho uniforme intocado; reuso da infra de split (partição, ancoragem, título, cap de estoque, Relatório/Publicados já mostram N anúncios).
- **Limitação honesta (custo imposto pelo ML):** tornar **divergente** um produto **já publicado como anúncio único** exige dividi-lo em N anúncios — e mover uma variação já publicada entre itens no ML = **deletar+recriar**, perdendo histórico/vendas/perguntas dela. Não há contorno de código. Coberto pela decisão #5: o sistema **avisa LOUD** e o operador decide (repreçar uniforme, aceitar a perda, ou adiar). **Produtos novos** com preços divergentes são limpos (nada a perder).
- **Custos de implementação:** particionamento ganha dimensão de preço; config de atacado/desconto migra de família-level para faixa-level (modelo de dados); UI da Revisão agrupa por preço e ganha badge/filtro/diálogo de publicação; detecção de "preço alterado vs no ar" no UPDATE.
- **Risco residual:** ML tratar anúncios do mesmo produto (fotos iguais, títulos distintos) como similares — já mitigado no ADR-0048 por títulos genuinamente diferentes por IA.

## Alternativas consideradas

- **Atacado por-variação sem split:** impossível — PxQ é por-item (ADR-0041). Rejeitada (validado em produção).
- **Mover variação automaticamente entre anúncios no UPDATE:** atacado sempre correto, mas perde histórico/vendas/perguntas da variação (delete+recriar). **Rejeitada** por Diego em favor de congelar + LOUD.
- **Manter só-estoque hardcoded (corpo do ADR-0016):** simples, mas tira do operador a decisão de repreçar. Substituída pela escolha explícita (decisão #4).
- **Desconto (% OFF) fora do escopo:** considerada (o selo hoje não renderiza — ADR-0017), mas Diego confirmou querer o de→para por-variação; segue-se construindo, com validação no browser e caminho pronto para `PRICE_DISCOUNT`.

## Faseamento (entrega incremental e segura)

Invariante que ordena as fases: **nunca existe preço divergente publicado sem split**. Até a divergência ser suportada, o app segue forçando uniforme (comportamento de hoje).

1. **Fase 1 — Controle de preço no UPDATE (sem split, sem divergência):** `preco_publicado_ml` + badge + filtro + escolha global/override + "só estoque" completo. Entrega valor isolada, zero risco de split.
2. **Fase 2 — Preço por variação + agrupamento + split por faixa + config por grupo (juntos):** para de colapsar, prompt "aplicar às demais?", agrupamento na Revisão, publicação N-anúncios por preço, atacado/de→para por grupo (por partição), LOUD no UPDATE. Divergência e split entram **atomicamente** — divergência-sem-split nunca chega a produção. (Pode ser fatiada no plano, respeitando o invariante.)

Detalhe de implementação, modelo de dados e casos de teste no spec.
