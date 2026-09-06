# Spike 036 — Kits Virtuais do Mercado Livre (pesquisa para futura feature)

**Status:** spike (pesquisa, não implementação — nenhuma decisão tomada)
**Data:** 2026-07-24 · **contrato de API verificado em 2026-09-06**
**Relacionado:** [ADR-0088](../decisions/0088-publicacao-user-products-multi-item.md) (user products/item plano), [ADR-0084/0087](../decisions/) (item plano), [ADR-0063](../decisions/0063-publicacao-kit-preco-categoria-concorrencia.md)/[0071](../decisions/0071-units-per-pack-forca-sale-format-kit.md)/[0073](../decisions/0073-cores-conta-como-unidade-no-kit.md) (SALE_FORMAT=Kit — feature diferente, ver colisão de nome abaixo)

## 1. Gatilho

Diego identificou que o Mercado Livre lançou uma feature de "Kits" e pediu uma consulta sobre
como funciona, para avaliar se vira uma feature nova do PubliAI.

## 2. O que é "Kits Virtuais" no ML

Recurso que agrupa **2 a 6 produtos diferentes** (não variações do mesmo produto) já publicados
pelo vendedor em uma única oferta nova. Diferente de uma variação (cor/tamanho do mesmo item), o
kit combina itens distintos — ex.: "Fernet + 2 Cocas".

### Confirmado por múltiplas fontes independentes (blog oficial ML + guias de integradores/ERPs)

- Composição: 2 a 6 produtos diferentes, quantidade 1–10 por componente
- Só produtos com `item_condition = "new"`
- **Estoque virtual**: calculado em tempo real como o mínimo entre
  `estoque_do_componente / quantidade_exigida` entre todos os componentes — não precisa montar
  pacote físico antecipado. Se um componente zera, o kit pausa.
- Preço: manual, ou automático (desconto % aplicado sobre a soma dos componentes)
- Componentes são referenciados pelo **`user_product_id`** (não pelo `item_id` do anúncio)
- Após criado, a composição/quantidades/canal são **imutáveis** — só título, preço manual,
  descrição e imagem são editáveis
- Venda de um kit gera **1 pedido por componente**, todos linkados entre si

### Contrato da API — verificado contra a doc oficial (2026-09-06)

Fonte: `developers.mercadolivre.com.br/pt_br/kits-virtuais` (bloqueia fetch autenticado com 403;
lida com user-agent de navegador e conferida no HTML cru, não em resumo). Rodapé da própria
página: **última atualização 30/01/2026**; recurso **em produção desde outubro de 2025**.

| Operação | Método + path |
|---|---|
| Buscar componentes elegíveis | `POST /users/$SELLER_ID/kits/components/search?searchText=&limit=` |
| Criar kit | `POST /items/kits` |
| Ver se um UP é kit | `GET /user-products/$USER_PRODUCT_ID` (tag `bundle`, nó `bundle.type = "kit"`) |
| Kits que contêm um UP | `GET /user-products/$USER_PRODUCT_ID/bundles` |
| Editar condições de venda | `PUT /items/$ITEM_ID` |
| Preço de venda vigente | `GET /items/$ITEM_ID/sale_price?context=channel_marketplace` |
| Ler/gravar desconto automático | `GET`/`PUT /items/$ITEM_ID/bundle/prices_configuration` |
| Estoque calculado | `GET /user-products/$USER_PRODUCT_ID/stock` |
| Pedidos irmãos de uma venda de kit | `GET /orders/$ORDER_ID/bundle` |

Payload de criação (confirmado; o do rascunho anterior estava certo):

```json
{
  "family_name": "Kit Aventura: 1 Motosserra + 1 Canivete",
  "channels": ["marketplace"],
  "thumbnail": { "id": "981862-MLA82943132520_032025" },
  "price": 2001,
  "currency_id": "BRL",
  "listing_type_id": "gold_pro",
  "official_store_id": null,
  "bundle": {
    "type": "kit",
    "components": [
      { "type": "user_product", "user_product_id": "MLBU3256534109", "quantity": 1, "automatic_price": null }
    ]
  }
}
```

Regras confirmadas na doc:

- 2 a 6 produtos distintos, no máximo 10 unidades de cada.
- Só `item_condition = "new"`; kit duplicado (mesmos componentes e quantidades) é recusado.
- O **primeiro componente da lista é o principal** — dele vêm categoria e `domain_id`.
- Composição, quantidades, canal, estoque, frete e `domain_id` são **imutáveis** após publicar
  (`PUT` no nó `bundle` devolve 400 `"Updating the bundle node is not allowed"`). Editáveis:
  preço (só sem `automatic_price`), título (só antes da 1ª venda), descrição, imagem e
  `listing_type_id`.
- Preço automático: `automatic_price.discount` decimal (0–1), **idêntico em todos os
  componentes**; nesse modo o campo `price` é omitido. Preço vigente só pelo `/sale_price`, que
  devolve o rateio por componente (`unit_amount`/`total_amount`) — é o que a contabilidade de
  margem precisaria consumir.
- Estoque = mínimo de `estoque_componente / quantidade_no_kit`; chegando a 0 o kit é pausado
  (`sub_status = "out_of_stock"`, comportamento padrão, nada específico de kit).
- Componentes ganham a tag `kit_component`; o item kit ganha a tag `bundle`.
- Kit em Full **não tem `inventory_id`**.
- Uma venda de kit gera **1 order por componente**, ligadas por `pack_id`; cada order traz
  `bundle.parent_item` apontando para o item kit e a tag `bundle_component`.
- Parceiro não certificado precisa cadastrar o usuário de teste num formulário do ML antes de
  conseguir criar kits.

## 3. Cruzamento com o domínio atual do PubliAI

### Colisão de nome

O termo "kit" já está em uso no codebase para uma feature **completamente diferente**:
`SALE_FORMAT=Kit` (ADR-0063/0071/0073) é um único SKU vendido em N unidades físicas iguais do
mesmo produto (ex.: "24 lápis de cor" = 1 SKU, `UNITS_PER_PACK=24`). O recurso novo do ML agrupa
**produtos distintos** em um anúncio novo — não tem nada a ver com `UNITS_PER_PACK`. Para não
confundir os dois no código/docs, nomear o recurso novo como **"Kit Virtual"** ou **"Combo"**.

### A pergunta que decide o tamanho da feature (em aberto)

O ML referencia componentes de um kit por `user_product_id`. Hoje o PubliAI só grava
`user_product_id` para o subconjunto **item plano** (`anuncios_externos_itens`, ADR-0088 —
categorias que forçam item plano por causa de múltiplas cores). O caminho normal de publicação
(`variations[]`, a maioria dos anúncios do PubliAI) **não tem essa coluna** em `anuncios_externos`.

Não verificado: se `GET /items/{item_id}` do ML devolve `user_product_id` para **qualquer** item
(inclusive os publicados via `variations[]`), o PubliAI pode buscar sob demanda e a feature cobre
todo o catálogo. Se só existir para item plano (ou só após alguma ativação de
"user_product_seller"), a feature nasceria restrita ao subconjunto item-plano — escopo bem menor.
A doc de User Products (`developers.mercadolivre.com.br/pt_br/user-products`) sugere que a relação
`item_id ↔ user_product_id` é 1:1 por padrão antes de uma "ativação" — o que indicaria que todo
item tem um `user_product_id`, mas isso precisa ser confirmado na prática, não assumido.

### Não confunde com o ADR-0151

O "kit vinculado" que entrou em produção em 2026-09-03 ([ADR-0151](../decisions/0151-kit-vinculado-a-partir-de-produto-existente.md))
é **N unidades do mesmo produto** (`SALE_FORMAT=Kit`/`UNITS_PER_PACK=N`, estoque derivado por
`floor(estoque_base/N)`) — anúncio novo montado pelo PubliAI, sem nenhum recurso de kit do ML. O
Kit Virtual é **produtos distintos** agrupados pelo próprio ML, com estoque e pedidos calculados
do lado dele. São features independentes; uma não implementa a outra.

## 4. Decisão

Nenhuma. Diego optou por só registrar a pesquisa por ora — retomar com Fase 1 (Define) completa
quando houver decisão de avançar. Próximos passos possíveis (não iniciados):

1. **Único bloqueio que resta:** confirmar na prática que os anúncios publicados por
   `variations[]` (a maioria do catálogo) aparecem como componentes elegíveis — rodar
   `POST /users/$SELLER_ID/kits/components/search` com `only_eligible` na conta real e ler o campo
   `reasons` dos produtos recusados. Se só o subconjunto item-plano ([ADR-0088](../decisions/0088-publicacao-user-products-multi-item.md))
   for elegível, a feature nasce restrita.
2. Desenhar 2-3 abordagens de arquitetura (nova tela "Kits", fluxo de composição fora do
   pipeline de planilha/família, ponto de integração com `ChannelConnector`/`anuncios_externos`)
3. Aprovação do design antes de qualquer código
