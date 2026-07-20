# ADR-0084 — `family_name` no payload de publicação para a categoria Zíperes (MLB271227)

**Status:** Aceito
**Data:** 2026-07-20
**Decisores:** Diego
**Relaciona:** estende [ADR-0003](0003-variacoes-agrupadas-por-pai.md) (variações agrupadas por PAI);
mesma categoria do [ADR-0083](0083-cursor-de-zíper-tipo-aviamento-determinístico.md) (cursor de zíper).

## Contexto

Lote #36: as 2 famílias "CURSOR N.3" (única cor cada, `02841061`/Prata e `02841096`/Cinza) receberam
a categoria correta `MLB271227` (ADR-0083), mas falharam no `POST /items` com erro 400. Investigado
via log bruto da função (`function_logs`, Management API — `console.error('ML recusou POST /items:', ...)`
em `criar-item.ts:19`):

```json
{
  "cause": [
    {"code": "body.required_fields", "cause_id": 369, "references": ["body"],
     "message": "The body does not contains some or none of the following properties [family_name, price, available_quantity]"},
    {"code": "body.invalid_fields", "cause_id": 374, "references": ["field.invalid"],
     "message": "The field variations is invalid with family name"}
  ],
  "message": "body.required_fields", "error": "validation_error", "status": 400
}
```

Descartado por evidência antes de chegar aqui:
- **Não é "variação única inválida"** — famílias com 1 variação já publicam com sucesso hoje em
  produção em 6+ categorias, incluindo `catalog_required` (`MLB270273` 8×, `MLB255054` 6×).
- **Não é diferença de config de categoria** — `settings`, tags de atributos (`COLOR`/`MAIN_COLOR`),
  obrigatórios (`BRAND`/`MODEL`) são idênticos entre `MLB271227` e as categorias já em produção
  (comparado via `GET /categories/{id}` e `/categories/{id}/attributes`, API pública).
- **Não é atributo faltando** — `atributos_faltantes` vazio; BRAND/MODEL/dimensões presentes no payload.

Pesquisa na documentação oficial do Mercado Livre (`developers.mercadolivre.com.br`, "User Products"):
o campo `family_name` é gerenciado pelo vendedor e usado para calcular um `family_id` — itens da mesma
família aparecem como "pickers" (seletores) diferentes na User Products Page. Isso é consistente com o
padrão do erro: a categoria rejeitou o array `variations` clássico e caiu num validador que espera os
campos de item plano.

## Decisão

Testado em 2 rodadas contra produção (republicação real das 2 famílias pendentes do lote #36 — um
`POST /items` que falha com 400 não cria recurso nenhum no ML, então testar contra os dois casos reais
é validação de graça, mesmo padrão de "chamada real" do ADR-0083/ADR-0021):

**Rodada 1 (aditiva, rejeitada pela ML):** só adicionar `family_name` ao payload existente, mantendo
`variations`. Resultado real: a ML aceitou o `family_name` (esse requisito some da lista de propriedades
faltando) mas **continuou rejeitando o array `variations` em si** — `"The field variations is invalid
with family name"` persiste, agora exigindo só `[price, available_quantity]` no corpo raiz. Prova que a
categoria não aceita o modelo de variações agrupadas de jeito nenhum, com ou sem `family_name`.

**Rodada 2 (item plano, decisão final):** para `categoriaExigeFamilyName` **com exatamente 1 variação**,
publicar um **item plano** — sem array `variations`, com `price`/`available_quantity`/`seller_custom_field`
no corpo raiz, `COLOR`/`GTIN`/`EMPTY_GTIN_REASON` movidos para `attributes` (deixam de ser
`attribute_combinations` por variação), e `family_name: <título do anúncio>`.

**Escopo explicitamente limitado a 1 variação.** Para famílias com >1 cor nessa categoria, o modelo
correto seria N itens planos (um por cor) compartilhando o mesmo `family_name` — quebra a suposição
1:1 família→anúncio (schema hoje só tem `familias.ml_item_id` singular; precisaria de um id por
variação, não só `ml_variation_id` como sub-recurso). Redesenho maior, fora de escopo. `montarPayloadItem`
**falha alto (`throw`)** nesse caso em vez de arriscar publicar algo errado — sem fallback silencioso.

**Rodada 3 (removendo `title`/`original_price`, sucesso):** a rodada 2 ainda falhou —
`"The fields [original_price, title] are invalid for requested call"` — confirmando a doc oficial
("o título é auto-preenchido pela ML a partir de domínio/atributos/family_name"; `original_price` não é
suportado no item plano). Removidos os dois do payload plano (`title` vira opcional em `PayloadItem`).
**Resultado: as 2 famílias publicaram** — `MLB7209437722` (Prata) e `MLB7209468002` (Cinza/Branco).

**Lacuna do UPDATE — encontrada, corrigida e testada de ponta a ponta na mesma sessão:** o item plano
não tem sub-recurso `variations`, então o SKU não ganha um `ml_variation_id` "de verdade" — usamos o
próprio `ml_item_id` como substituto (`mercado-livre.ts`, ver Implementação). Uma simulação real de
UPDATE (bump de estoque +1 e preço +R$1) revelou um **bug de no-op silencioso**: `atualizarAnuncio` fazia
`GET /items/{id}` e `montarVariacoesUpdate` mapeava sobre `atual.variations` (vazio pro item plano) — o
PUT saía com `variations: []`, a ML aceitava sem erro, `familia.status` voltava a `'publicado'`, e
**nada mudava no anúncio real** (`preco_publicado_ml` ficou travado no valor antigo). Sem erro nenhum —
pior que falhar, porque parecia sucesso.

**Fix implementado:** quando `atual.variations` vem vazio e há exatamente 1 variação existente a
atualizar (mesmo escopo do CREATE), `atualizarAnuncio` faz um PUT plano — `price`/`available_quantity`
direto no corpo raiz do item, sem `variations`, sem `original_price` (a ML rejeita esse campo em item
plano, mesma validação real do CREATE). Com >1 variação ou cor nova, continua falhando alto — esse caso
seguiria exigindo o redesenho de N-itens-por-família, fora de escopo.

**Validação end-to-end real:** bump de estoque+preço → `update-familia-ml` → confirmado no banco
(`preco_publicado_ml` mudou de `129.9` para `130.9`, log sem erro) → revert → `update-familia-ml` de
novo → confirmado de volta a `129.9`. UPDATE de item plano funciona.

### Implementação

- `categoria/atributos.ts`: `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` (hoje `{MLB271227}`) +
  `categoriaExigeFamilyName(categoriaId)`, mesmo padrão de `CATEGORIAS_COM_EMPTY_GTIN_REASON`.
- `ml/publicar.ts`: `montarPayloadItem` ganha um branch cedo — quando `categoriaExigeFamilyName` é
  verdadeiro, monta item plano (1 variação) ou lança erro (>1 variação) em vez de montar `variations`.
  `PayloadItem.variations` passa a ser opcional; ganha `price`/`available_quantity`/`seller_custom_field`.
- `ml/atualizar-item.ts`: `buscarItemML` passa a ler também `price`/`available_quantity` do item (não só
  `variations`/`pictures`); nova `atualizarItemPlanoML` faz o PUT plano (`{price?, available_quantity}`,
  nunca `original_price`).
- `canais/mercado-livre.ts`: `criarAnuncio` sintetiza `variacoesExternas = {sku: itemId}` quando a ML
  não devolve `variations` (item plano com exatamente 1 SKU enviado) — sem isso `ml_variation_id` nunca
  seria gravado pro SKU. `atualizarAnuncio` detecta item plano (`atual.variations` vazio + existentes a
  atualizar) e, se for exatamente 1 variação sem cor nova, faz o PUT plano; caso contrário falha alto
  (evita PUT `{variations: []}` — no-op silencioso confirmado empiricamente).

## Como reverter

Reverter o branch de item plano em `montarPayloadItem` (volta a sempre montar `variations`), o fallback
de `variacoesExternas` em `mercado-livre.ts`, e `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` de `atributos.ts`.
Categoria volta a sempre enviar `variations` sem `family_name` (comportamento pré-ADR — sabidamente
rejeitado pela ML pra essa categoria, útil só se a ML mudar a validação no futuro).

## Validação

Republicação real das 2 famílias pendentes do lote #36, 2026-07-20:
- `02841061` (Prata) → `MLB7209437722`,
  `produto.mercadolivre.com.br/MLB-7209437722-cursor-n3-niq-strava-26cm-prata-pziper-nylon-1000und-prata-_JM`
- `02841096` (Cinza/Branco) → `MLB7209468002`,
  `produto.mercadolivre.com.br/MLB-7209468002-cursor-n3-strava-ziper-nylon-1000un-cinza-branco-cinza-_JM`

Ambas com `status='publicado'`, `ml_variation_id` gravado (fallback do item plano) e espelhadas em
`anuncios_externos`. `lotes` (nº 36): `total_erros=0`, `total_publicadas=2` (as outras 2 famílias do
lote, "CURSOR N.5", são um problema à parte — categoria mal resolvida, ADR-0083 — fora de escopo aqui).

**UPDATE testado, corrigido e confirmado funcionando** (2 rodadas de simulação real via
`update-familia-ml`: 1ª rodada achou o no-op silencioso, revertida sem risco pois nada tinha mudado na
ML; implementado o PUT plano; 2ª rodada — bump de estoque+preço → confirmado no banco
(`preco_publicado_ml` 129.9→130.9) → revert → confirmado de volta a 129.9). Editar preço/estoque desses
2 anúncios pelo app **funciona** agora, para o caso de 1 variação (escopo do CREATE). Multi-cor/cor nova
nessa categoria segue não suportado — falha alto em vez de tentar; exigiria o redesenho de
N-itens-por-família (fora de escopo, ver Decisão). Sincronização de vendas (`vendas.ts`) continua não
testada — só uma venda real confirmaria.
