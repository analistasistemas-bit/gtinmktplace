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

### Elegibilidade medida nas duas contas reais (2026-09-06)

A pergunta que estava em aberto — "os anúncios do PubliAI servem como componente?" — foi
respondida contra a API de produção, só com chamadas de leitura
(`POST /users/$SELLER_ID/kits/components/search`, `GET /items`, `GET /user-products/...`).
Nenhum kit foi criado.

**O que decide a elegibilidade é o item no ML ser um user product nativo — ou seja, NÃO ter
`variations[]`.** Não é o modelo do banco: `anuncios_externos.variacoes_externas` existir não diz
nada, o que vale é o item publicado.

| Conta | Anúncios publicados | User product nativo (podem ser componente) | Com `variations[]` (fora) |
|---|---|---|---|
| AVILBV (org Avil) | 147 | **79** | 68 |
| $ANALISTA$ (org DSA) | 24 | **24** | 0 |

Na busca de componentes (que enumera por UP, não por anúncio):

- **Avil:** 138 UPs elegíveis. Os inelegíveis vêm todos do mesmo anúncio multi-cor
  ("Linha Para Costura … Várias Cores", 100 variações no ML) com o motivo
  `COMPONENT_NOT_MIGRATED_TO_UP` — *"Não está atualizado para a nova experiência de variações e
  não pode ser vendido em kit"*. Os itens planos do [ADR-0088](../decisions/0088-publicacao-user-products-multi-item.md)
  são elegíveis (75 dos 138 casam com `anuncios_externos_itens`).
- **DSA:** 24 UPs no buscador, **14 elegíveis**. Aqui a recusa não é estrutural — é operacional:
  8 × `OUT_OF_STOCK_ERROR` (anúncios pausados sem estoque), 1 × `IS_KIT_ARTISANAL` (o anúncio já
  é um kit), 1 × `LOGISTIC_TYPE_MISMATCH` (forma de entrega ainda não liberada para kit).

Confirmações pontuais:

- `GET /items/MLB6914358210` (anúncio multi-cor): `variations` com 100 entradas, **item sem
  `user_product_id`** — cada variação tem o seu, e todos vêm marcados como não migrados.
- `GET /items/MLB4796544265` (produto de variação única) e `MLB4959730161` (item plano ADR-0088):
  `variations: []`, tag `user_product_listing`, `user_product_id` no próprio item → elegíveis.
- Um kit vinculado do [ADR-0151](../decisions/0151-kit-vinculado-a-partir-de-produto-existente.md)
  ("Kit 2un Centrum") aparece **elegível** como componente; outro ("Kit 2 Unidades Leite Ninho")
  caiu por `LOGISTIC_TYPE_MISMATCH`. Ou seja, kit vinculado pode entrar num Kit Virtual, mas não é
  garantido — depende da logística do anúncio.
- Nenhuma ativação especial foi necessária: as duas contas já respondem `200` no buscador de
  componentes. A nota da doc sobre cadastrar usuário de teste vale para *parceiro não certificado*
  criando kit, não para a busca.

**Consequência para o escopo:** a feature é viável hoje sem migração nenhuma — cobre 100% da DSA e
54% dos anúncios da Avil. O que fica de fora é o bloco multi-cor publicado por `variations[]`, que
só entra se esses anúncios forem migrados para User Products (caminho que o ADR-0088 e
`reconciliar-convergencia-up` já trilham para outra finalidade).

### Não confunde com o ADR-0151

O "kit vinculado" que entrou em produção em 2026-09-03 ([ADR-0151](../decisions/0151-kit-vinculado-a-partir-de-produto-existente.md))
é **N unidades do mesmo produto** (`SALE_FORMAT=Kit`/`UNITS_PER_PACK=N`, estoque derivado por
`floor(estoque_base/N)`) — anúncio novo montado pelo PubliAI, sem nenhum recurso de kit do ML. O
Kit Virtual é **produtos distintos** agrupados pelo próprio ML, com estoque e pedidos calculados
do lado dele. São features independentes; uma não implementa a outra.

## 4. Decisão

Nenhuma. Diego optou por só registrar a pesquisa por ora — retomar com Fase 1 (Define) completa
quando houver decisão de avançar. Próximos passos possíveis (não iniciados):

1. ~~Confirmar a elegibilidade dos anúncios reais~~ — **feito em 2026-09-06**, ver §3.
   Não há bloqueio técnico: 79 anúncios da Avil e os 24 da DSA já servem como componente.
2. Decidir o escopo da v1 à luz do número acima (só o subconjunto UP-nativo, ou esperar a
   migração do bloco multi-cor).
3. Desenhar 2-3 abordagens de arquitetura (nova tela "Kits", fluxo de composição fora do
   pipeline de planilha/família, ponto de integração com `ChannelConnector`/`anuncios_externos`)
4. Aprovação do design antes de qualquer código
