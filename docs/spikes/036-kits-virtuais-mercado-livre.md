# Spike 036 — Kits Virtuais do Mercado Livre (pesquisa para futura feature)

**Status:** spike (pesquisa, não implementação — nenhuma decisão tomada)
**Data:** 2026-07-24
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

### Não verificado — fonte única, baixa confiança

A doc oficial (`developers.mercadolivre.com.br/pt_br/kits-virtuais`) bloqueou fetch direto (403).
Consegui o conteúdo só via proxy de leitura (jina.ai) processado por um resumidor — os endpoints
exatos e o payload JSON abaixo **não foram cross-verificados** e não devem ser tratados como
contrato final:

```
POST /users/$SELLER_ID/kits/components/search   — busca componentes elegíveis
POST /items/kits                                — cria o kit
GET  /user-products/$USER_PRODUCT_ID             — nó "bundle" se for kit
GET  /user-products/$USER_PRODUCT_ID/bundles     — kits que contêm esse produto
PUT  /items/$ITEM_ID                             — edita campos editáveis
GET/PUT /items/$ITEM_ID/bundle/prices_configuration — sync de desconto automático
GET  /user-products/$USER_PRODUCT_ID/stock       — estoque calculado
GET  /orders/$ORDER_ID/bundle                    — detalhe do pedido do kit
```

payload de criação (não verificado):
```json
{
  "family_name": "Nome do kit",
  "channels": ["marketplace"],
  "thumbnail": { "id": "..." },
  "price": 2001,
  "currency_id": "BRL",
  "listing_type_id": "gold_pro",
  "bundle": {
    "type": "kit",
    "components": [
      { "type": "user_product", "user_product_id": "MLBU...", "quantity": 1, "automatic_price": null }
    ]
  }
}
```

**Antes de qualquer implementação, confirmar isso contra a doc oficial autenticada (login do
Diego no dev portal) ou testando direto na API.**

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

## 4. Decisão

Nenhuma. Diego optou por só registrar a pesquisa por ora — retomar com Fase 1 (Define) completa
quando houver decisão de avançar. Próximos passos possíveis (não iniciados):

1. Validar o contrato real da API (endpoints exatos + `user_product_id` em item não-plano)
2. Desenhar 2-3 abordagens de arquitetura (nova tela "Kits", fluxo de composição fora do
   pipeline de planilha/família, ponto de integração com `ChannelConnector`/`anuncios_externos`)
3. Aprovação do design antes de qualquer código
