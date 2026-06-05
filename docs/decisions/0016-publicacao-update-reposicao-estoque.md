# ADR-0016: Publicação UPDATE — reposição de estoque herdando o anúncio anterior

**Status:** Aceito
**Data:** 2026-06-04
**Decisores:** Diego
**Refina:** ADR-0005 (imutável)

## Contexto

O ADR-0005 definiu que re-importar a planilha deve atualizar anúncios já
publicados ("modo UPDATE"), mas deixou aberto o escopo exato e o tratamento de
mudanças estruturais. Ao implementar, decidimos os detalhes abaixo.

## Decisão

1. **Escopo do UPDATE = só estoque.** Preço de venda, título, descrição, fotos e
   categoria do anúncio são preservados. No `PUT /items/{id}` mandamos apenas
   `available_quantity` por variação (omitir `price` preserva o preço no ML).
2. **Herança sem IA.** O `ingest-lote`, ao detectar família já publicada
   (`codigo_pai` com `ml_item_id`), herda do registro anterior `ml_item_id`,
   `ml_permalink`, título/descrição/categoria/atributos (só para exibição) e,
   casando por `codigo`, `ml_variation_id`/`cor`/`ml_picture_id` por variação;
   grava `estoque_anterior` (snapshot do diff) e marca a família `pronto` sem
   enfileirar `process-familia`. UPDATE não gasta IA nem busca de concorrência.
3. **Mudança estrutural detecta + sinaliza, não aplica.** Cor nova (no lote, sem
   variação no anúncio) não é adicionada; cor removida (no anúncio, ausente no
   lote) não é deletada. Ambas aparecem como selo na Revisão.
4. **PUT inclui todas as variações reais.** O ML deleta qualquer variação omitida
   do `variations[]`. Por isso o worker faz `GET /items/{id}` antes e reenvia
   todas as variações atuais: as casadas com o novo estoque, as não-casadas
   (cor removida) com o estoque atual (preserva).

## Consequências

- UPDATE é barato (sem IA) e seguro para anúncios no ar (nunca mexe em preço,
  nunca deleta variação).
- Mudança estrutural exige ação manual do operador no ML (aceito no MVP).
- O diff da UI usa o snapshot `estoque_anterior` (o que publicamos por último),
  não um GET ao vivo; o worker usa o GET real na hora de aplicar.

## Alternativas consideradas

- Atualizar preço junto: rejeitado a pedido do Diego (preço de venda é gerido no
  ML / definido no CREATE).
- Adicionar/remover variação no ML: fora do MVP (ML restringe remoção com vendas;
  adicionar exige foto/atributos).
- GET ao vivo para o diff da UI: descartado (frontend não tem token; snapshot
  basta para decisão).

---

## Adendo (2026-06-04) — Cor nova publicável

A decisão original (item 3) tratava cor nova como "apenas sinalizada". Refinamento
a pedido do Diego: a **cor nova passa a ser publicável (opt-in)**.

- A cor nova aparece na Revisão **desmarcada** (`excluida_da_publicacao=true`); o
  operador marca para adicioná-la como **variação nova no anúncio existente**.
- O nome da cor é resolvido só para as cores novas, na ordem do [ADR-0004](0004-atribuicao-de-cor.md)
  (descrição/nome primeiro; Vision apenas como fallback). Implementado por um
  `process-familia` em **modo parcial** que não mexe nos campos herdados.
- Foto obrigatória (igual CREATE); preço da cor nova = preço da planilha.
- O worker faz um único `PUT /items/{id}` que **cria** as variações sem `id` e
  **atualiza** as com `id` no mesmo request.
- **Cor removida continua apenas sinalizada** (não deleta) — inalterado.

## Adendo (2026-06-05) — BRAND sincronizado no UPDATE

Exceção pontual à preservação de atributos: o UPDATE passa a reenviar **apenas o atributo
BRAND** no `PUT /items/{id}`, usando o `fornecedor` da família, para corrigir a marca de anúncios
publicados antes da adoção do FORNECEDOR (ADR-0009 adendo). Os demais atributos
(RIBBON_TYPE/MATERIAL/MODEL etc.) continuam **preservados** — não são recalculados nem
reenviados. Se a família não tem fornecedor (vazio), o BRAND **não** é enviado (preserva o
existente, evita sobrescrever com o fallback "Avil"). Preço/título/fotos seguem preservados como
antes. Implementação: `update-familia-ml` calcula a marca e a envia via `atualizarItemML(..., atributos)`.
