# ADR-0167 — Guia de tamanhos do Mercado Livre, gerenciado via API

**Status:** Aceito
**Data:** 2026-09-19
**Decisor:** Diego
**Relacionado:** [ADR-0166](0166-tipo-de-produto-por-organizacao.md) (tipo de produto por org);
conclui, para roupa/calçado, o modelo que [ADR-0084](0084-family-name-categoria-zipper.md) abriu
(item plano) e [ADR-0088](0088-publicacao-user-products-multi-item.md) generalizou (N itens por
família via saga User Products); base real: [Spike 051](../spikes/051-guia-tamanhos-ml-api.md).

## Contexto

O Spike 051 (chamadas reais à API do Mercado Livre, token de produção da org piloto Daludi Shop)
confirmou dois fatos que fecham a lacuna deixada em aberto pelo plano original desta feature:

1. **Nenhuma categoria de roupa/calçado testada aceita `variations[]`** (camiseta, jaqueta, tênis;
   calça e vestido por schema idêntico, não testados em `/items/validate`). A publicação sempre
   passa pelo modelo item-plano/User Products — e esse modelo **já está implementado e em
   produção** neste projeto: o ADR-0088 generalizou o caso multi-SKU (a saga
   `publicar-grupo.ts`/`publicar-familia-up.ts`), reaproveitando `montarPayloadItem`
   (`_shared/ml/publicar.ts`) por SKU. Isso significa que **não há redesenho de schema/saga a
   fazer** — o delta é só o payload de cada item ganhar os atributos de tamanho.
2. **Nesses domínios, `SIZE_GRID_ID` + `SIZE_GRID_ROW_ID` são obrigatórios** junto com `SIZE`
   (texto) e `GENDER` — confirmado via erro real do ML (`missing.fashion_grid.grid_id.values` /
   `missing.fashion_grid.size.values`), não deduzido de resumo de busca. `SIZE_GRID_ID` referencia
   uma tabela de medidas (`chart`) que o vendedor precisa possuir; `SIZE_GRID_ROW_ID` referencia
   uma linha específica dessa tabela (um tamanho).

O `POST /catalog/charts` (contrato real, Spike 051 §3) cria essa tabela. Cada linha exige, além do
tamanho, uma medida corporal real (para vestuário: contorno do peito, `CHEST_CIRCUMFERENCE_FROM`) —
dado que o PubliAI não tem hoje em nenhum cadastro. Diego decidiu (2026-09-19, ao ser perguntado
diretamente) usar a tabela de medidas padrão do varejo brasileiro (P/M/G/GG por contorno de peito:
88/96/104/112 cm como piso de cada faixa) como referência para o piloto, em vez de medir cada peça
— decisão de produto, registrada aqui porque muda o que este ADR pode assumir como fonte da medida.

## Decisão

**Decisão 1 — o PubliAI cria e gerencia as tabelas via API; o operador nunca entra no Seller
Central do ML para isso.** Reafirma a decisão original do grilling: o cadastro já é manual, e
pedir ao operador que crie a tabela fora do app reintroduziria o passo que o produto existe para
eliminar.

**Decisão 2 — granularidade: uma tabela por conexão ML × domínio × gênero.** Não por família nem
por org isolada: o `chart` é propriedade da conta ML (Spike 051 §9, confirmado — o chart criado
pertence à conta que o criou), e o ML exige que o `GENDER` do chart bata com o do item
(`grid_template_required`). Duas famílias da mesma org, mesmo domínio, mesmo gênero, reaproveitam
a mesma tabela — evita recriar uma tabela idêntica por família (o ML já recusa nome duplicado com
as mesmas características, Spike 051 §3). Uma nova combinação de tamanhos dentro do mesmo
domínio+gênero (ex.: adicionar "Tamanho Único" depois) também reaproveita: charts são tratados
como **imutáveis** (Decisão 4) — a tabela nasce com o superset de tamanhos do tipo de produto da
org (todos os `TAMANHOS_ROUPA`/`NUMERACOES_CALCADO` cabíveis no domínio), não um subconjunto por
família, para minimizar recriação.

**Decisão 3 — a medida corporal por tamanho vem de uma tabela fixa no código, não de cadastro do
operador.** Para o piloto (jaqueta, domínio `JACKETS_AND_COATS`, mas a mesma regra vale para
`SPORT_T_SHIRTS`/TOPS — Spike 051 §3 confirmou a mesma coluna `CHEST_CIRCUMFERENCE_FROM` nas
duas), a medida é a tabela padrão do varejo brasileiro (Decisão do Diego, ver Contexto):
P=88cm, M=96cm, G=104cm, GG=112cm de contorno de peito (piso da faixa). **Não é medida do produto
real de cada fornecedor** — é uma referência de mercado, suficiente para o ML aceitar a
publicação; se um cliente futuro precisar de medida exata por peça, isso exige campo novo de
cadastro (fora de escopo aqui, registrado como lacuna).

**Decisão 4 — chart é imutável; conjunto de tamanhos novo = chart novo.** O Spike 051 §8 não
confirmou update/edição de chart existente (nenhuma fonte primária testada). Em vez de arriscar
uma escrita não confirmada sobre uma tabela já vinculada a itens publicados, a regra é: nunca
editar um chart depois de criado. Se o tipo de produto da org ganhar um tamanho fora do superset
original (raro — os tamanhos são a lista fixa do ADR-0166), cria-se um chart novo e as publicações
seguintes passam a referenciar o novo id; o antigo permanece intocado (itens já publicados
continuam válidos, o ML não invalida um item por o chart ter sido "substituído" por outro).

**Decisão 5 — idempotência via tabela de cache `ml_size_charts`.** Chave
`(connection_id, domain_id, gender)`, valor `chart_id` + `rows` (jsonb, mapa tamanho→row_id).
Antes de criar um chart, checa a tabela; só chama `POST /catalog/charts` em cache-miss. Mesmo
padrão de `ml_formato_publicacao` (ADR-0088) — cache por conexão, nunca por família.

**Decisão 6 — GENDER é obrigatório e vem de `familias.genero` (ADR-0166), mapeado para o
`value_id` real do ML** (Spike 051 §5, confirmado: masculino=339666, feminino=339665,
unissex="Sem gênero"=110461 — não existe "Unissex" literal no ML). Falha alto se `familias.genero`
for nulo numa família com tamanho — nunca publica sem gênero (o ML rejeita, `catalog_required`).

## Consequências

- **O escopo de código encolhe em relação ao plano original.** Não há payload novo de
  `attribute_combinations` com 2 atributos por variação, não há `variations[]` para uma categoria
  de roupa/calçado — a saga UP (ADR-0088) já publica N itens por família; o delta é só:
  `VariacaoCanonica`/`VariacaoInput` ganham `tamanho` + `sizeGridRowId`; `montarPayloadItem` grava
  `SIZE`/`SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` em `attributes` quando presentes; `montarAnuncioCanonico`
  lê `variacoes.tamanho`; um novo módulo `_shared/ml/size-chart.ts` resolve/cria o chart antes de
  montar os payloads da família.
- **Medida de mercado, não medida real, é uma dívida assumida conscientemente** (Decisão 3) — se
  um comprador reclamar de caimento, a causa possível é a tabela genérica. Aceitável para o piloto;
  registrado para não virar suposição escondida depois.
- **BOTTOMS/DRESSES/FOOTWEAR além do domínio testado exigem confirmar a coluna de medida real
  antes de publicar** (Spike 051 §7, NÃO CONFIRMADO para esses domínios) — `size-chart.ts` não
  pode assumir `CHEST_CIRCUMFERENCE_FROM` como coluna universal; falha alto (não uma
  suposição silenciosa) se o `POST /catalog/charts` exigir uma coluna desconhecida.

## Como reverter

Remover `_shared/ml/size-chart.ts` e a tabela `ml_size_charts` (não destrutivo — não referenciada
por dado de negócio, só por cache); reverter `montarPayloadItem`/`montarAnuncioCanonico` aos
campos anteriores. Famílias com tamanho voltam a falhar alto na publicação (mesmo comportamento de
antes desta feature — nunca publicava roupa/calçado com tamanho).
