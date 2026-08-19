# ADR-0125 — Sonar: cruzamento ficha↔anúncio e paridade Hunter na tabela

- **Status:** aceito
- **Data:** 2026-08-19
- **Relacionados:** ADR-0120 (Sonar catálogo-only), ADR-0122 (vendas via Apify), ADR-0124 (veredito)

## Contexto

O Sonar tem dois universos que hoje não se cruzam: as ~40 **fichas de catálogo** (`pulse-sonar`,
API oficial) e a amostra de ~20 **anúncios** (`pulse-sonar-vendas`, Apify). A tabela de fichas
descarta quase tudo que a Apify já paga (vendidos, avaliação, posição, patrocinado, desconto,
selo) e não mostra paridade com o Hunter Hub (Vendas, Faturamento, Posição, Patrocinado).

Payload real do actor Apify (dataset de produção, 20 registros, termo "abraçadeira nylon",
medido em 2026-08-18) — cobertura por campo:

| Campo | Cobertura | Uso |
|---|---|---|
| `idPublicacao` | 20/20 | chave primária de casamento (= `item_id` do anúncio) |
| `idProdutoCatalogo` | 6/20 | atalho de casamento quando o anúncio está em catálogo |
| `idProdutoUsuario` | 20/20 | **não usar** — não identifica o anúncio (é o "usuário-produto") |
| `posicaoItem` | 20/20 | posição orgânica |
| `tipoResultado` | 20/20 (`'ORGANIC'`/outro) | patrocinado — campo `patrocinado` do actor vem vazio em 0/20 |
| `quantidadeVendida` | maioria | vendidos (faixas arredondadas pelo ML) |
| `produtoReviews` / `numeroAvaliacoes` | parcial | avaliação |
| `zProdutoLink` | 20/20, mas só carrega `MLBU…` | **inútil para casar** |
| `vendedorID` | 0/20 | **inútil para casar** |

## Decisões

**D1 — Agregação de "vendidos" quando a ficha casa com vários anúncios: MAIOR, nunca soma.**
`quantidadeVendida` vem em faixas arredondadas pelo ML sobre uma amostra parcial (top ~20 da
busca); somar faixas arredondadas de uma amostra parcial produz um número que parece total mas é
inventado. O maior é um piso verificável ("pelo menos N"). **Anúncio principal** da ficha = o de
maior `vendidos`; empate ou todos-null → o de menor `posicao`; se posição também empatar/faltar
→ o primeiro candidato (ordem de relevância da busca, mesma convenção do destaque em
`sonar-vendas.ts:110-111` e da colisão de `indexarPorAnuncio`). Faturamento, avaliação, desconto e
selo vêm todos do mesmo anúncio principal — nunca colados de anúncios diferentes.

**D2 — Cache da `pulse-sonar-vendas`: mantém `v4`, ganha campo opcional `por_anuncio`.**
Bump v4→v5 re-cobraria ~US$0,10 por termo já buscado nos últimos 7 dias. Campo aditivo é
retrocompatível: entrada v4 antiga não tem o índice, a UI mostra "—" até o TTL (≤7d) expirar
sozinho — custo forçado zero. A partir desta entrega, shape aditivo opcional não exige bump; bump
segue reservado para mudança incompatível ou de corte (convenção já registrada no ADR-0122 §4).

**D3 — Cache da `pulse-sonar`: bump `sonar:v2` → `sonar:v3`.** Aqui o bump é grátis (API oficial,
sem custo monetário) e segue a convenção existente (v1→v2 pelo mesmo motivo, `index.ts:120-121`).
Único custo: a primeira busca de um termo cacheado volta a demorar ~15s.

**D4 — Casamento ficha↔anúncio no FRONTEND, por função pura, chaveado por `idPublicacao`.**
Primário: `idPublicacao ∈ ficha.item_ids`. Atalho: `idProdutoCatalogo === ficha.product_id`
quando não vazio. Nunca por link (`zProdutoLink` só carrega `MLBU…`) nem por vendedor
(`vendedorID` vazio em 0/20). Isso torna a exposição de `item_ids` pela `pulse-sonar` obrigatória
— sem ela não existe casamento. As edges continuam desacopladas (ADR-0122): `pulse-sonar-vendas`
só expõe o índice `por_anuncio` chaveado por `idPublicacao`; o cruzamento vive no front.

**D9 (referência, sonda ainda não implementada nesta leva)** — Grupo C ("Criação (dias)") é sonda
condicional via multiget `/items?ids=...&attributes=id,date_created`, auto-desligável por flag
Redis em 403. Fora do escopo desta leva (T0–T5); registrado aqui porque a decisão de design faz
parte do mesmo plano.

## Consequências

- `ItemVendas` (shared) ganha 10 campos novos, todos deriváveis do payload já pago — zero chamada
  nova à Apify.
- `ResultadoFicha` (shared, pulse-sonar) ganha `item_ids: string[]` — obrigatório para D4.
- Cache `sonar:v3` convive com `sonar:v2` até o TTL de 24h expirar sozinho; nenhuma leitura
  cruzada.
- Fichas de cauda longa (sem `idProdutoCatalogo` e fora do top ~20 da busca) não casam — célula
  mostra "—", comportamento esperado, não bug.
