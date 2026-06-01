# ADR-0009: Campos obrigatórios do payload Mercado Livre + categoria via lookup determinístico

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego (aprovação após revisão crítica do spec)
**Relacionado:** Substitui parcialmente a regra de geração de `categoria_ml_id` definida em [ADR-0003](0003-variacoes-agrupadas-por-pai.md) e no spec original

## Contexto

A revisão independente do spec (2026-05-26) identificou duas lacunas críticas:

1. **Risco de alucinação de categoria pela IA:** o prompt original mandava o GPT-4o-mini "identificar a categoria ML adequada (formato MLB####)". GPT-4o-mini não tem conhecimento confiável da árvore de categorias do Mercado Livre. Vai gerar IDs inexistentes ou incorretos com frequência, derrubando a taxa de publicação muito abaixo dos 95% exigidos pelo MVP.

2. **Schema incompleto para o payload da API ML:** os campos obrigatórios no `POST /items` da API do Mercado Livre não estão todos cobertos pelo schema atual (`familias` + `variacoes`). Campos como `listing_type_id`, `condition`, `shipping.mode`, `currency_id`, `sale_terms`, e o formato esperado de `attribute_combinations` por variação não têm origem definida — vão travar a implementação no M4.

Este ADR resolve ambos.

## Decisão

### Parte 1 — Categoria determinística por tipo de aviamento

Removemos do prompt do copywriter a responsabilidade de escolher a categoria. A categoria do anúncio no ML passa a vir de um **mapeamento determinístico** baseado no `tipo_aviamento` da família.

**Lookup table (config no código, fácil de evoluir):**

```ts
const CATEGORIA_ML_POR_TIPO = {
  linha:  'MLB1132',  // Linhas de Costura
  botao:  'MLB1430',  // Botões (verificar ID exato na implementação)
  fita:   'MLB1429',  // Fitas e Bordados (verificar ID exato)
  // outros tipos entram aqui em v2
};
```

**Como o tipo é detectado** (em ordem de preferência):

1. **Detecção por palavras-chave no nome (regex/dicionário PT-BR)** — primeiro tentar identificar:
   - `linha`, `linhas`, `linhão`, `costura`, `bobina`, `cone` → `tipo = 'linha'`
   - `botão`, `botões`, `pressão` → `tipo = 'botao'`
   - `fita`, `fitas`, `cetim`, `gorgurão`, `viés` → `tipo = 'fita'`

2. **Fallback de IA classificadora** — se o regex não bater, fazer 1 chamada barata ao GPT-4o-mini com prompt restrito de classificação:

   ```
   SISTEMA: Você é um classificador. Dado o nome de um produto de aviamento,
   responda APENAS com uma das opções: linha | botao | fita | outro.
   Não invente categorias. Se não tiver certeza, responda "outro".
   ENTRADA: {pai_nome}
   SAÍDA: <uma palavra>
   ```

3. **Tipo = `outro`** — família vai pra revisão com badge "categoria indefinida"; operador escolhe manualmente em dropdown na tela de revisão. Não tenta publicar sem categoria determinada.

### Parte 2 — Campos obrigatórios do payload ML

Define onde cada campo do payload vive:

| Campo ML | Origem | Notas |
|---|---|---|
| `title` | `familias.titulo_ml` | gerado pela IA copywriter |
| `category_id` | lookup determinístico (Parte 1) | `familias.categoria_ml_id` populado no `process-familia` |
| `price` | `variacoes.preco_publicacao` (novo campo) | preço após estratégia condicional ([ADR-0008](0008-estrategia-de-preco-condicional.md)) |
| `currency_id` | hardcoded `'BRL'` | nunca varia no MVP |
| `available_quantity` | `variacoes.estoque` | da planilha |
| `condition` | hardcoded `'new'` | empresa vende apenas produtos novos no MVP |
| `listing_type_id` | hardcoded `'gold_special'` no MVP | (anúncio Clássico). Avaliar `gold_pro` (Premium) em v2 conforme volume |
| `pictures` | upload prévio + URLs do Storage | uma por variação no MVP (ADR-0003) |
| `attributes` | `familias.atributos_ml` (jsonb) | gerado pela IA, validado contra obrigatórios da categoria |
| `variations[]` | composto de `variacoes` | cada variação contribui com `price`, `available_quantity`, `attribute_combinations`, `picture_ids` |
| `variations[].attribute_combinations[]` | composto de `{id: 'COLOR', value_name: variacoes.cor_nome}` | 1 atributo de variação por enquanto: COLOR |
| `shipping.mode` | `familias.shipping_mode` (novo campo, default `'me2'`) | Mercado Envios 2 (recomendado) |
| `shipping.free_shipping` | `familias.frete_gratis` (novo campo, default `false`) | configurável no MVP via Configurações |
| `shipping.local_pick_up` | hardcoded `false` | retirada no local não suportada |
| `sale_terms` | `familias.sale_terms` (jsonb) | warranty default: 30 dias garantia do vendedor |
| `seller_custom_field` | `familias.codigo_pai` | rastreabilidade interna |

### Novos campos a adicionar no schema

**Tabela `familias`:**
- `tipo_aviamento enum('linha','botao','fita','outro')` — preenchido na ingestão
- `tipo_origem enum('regex','ia','manual')` — auditoria de como o tipo foi atribuído
- `categoria_ml_id text` — preenchido após detecção do tipo (já estava no spec, mas agora é populado deterministicamente)
- `shipping_mode text default 'me2'` — modo de envio
- `frete_gratis boolean default false` — opção de frete grátis (ajustável em Configurações)
- `sale_terms jsonb default '[{"id":"WARRANTY_TYPE","value_id":"2230279"},{"id":"WARRANTY_TIME","value_name":"30 dias"}]'` — termos de venda

**Tabela `variacoes`:**
- `preco_publicacao numeric` — preço após cálculo da estratégia (separado do `preco` original da planilha, para auditoria)

## Alternativas consideradas

- **Opção A: Manter categoria no prompt da IA**
  - Pros: simples
  - Cons: alucinação garantida (ver achado crítico da revisão)
  - Rejeitada

- **Opção B: Operador escolhe categoria a cada lote**
  - Pros: 100% confiável
  - Cons: fricção alta; operador não-técnico precisa conhecer árvore de categorias do ML
  - Rejeitada como caminho principal (mantida como fallback no caso `tipo=outro`)

- **Opção C: Lookup determinístico por tipo de aviamento (escolhida)**
  - Pros: 100% confiável dentro dos tipos conhecidos; fácil de evoluir adicionando entradas na tabela; cobre 95%+ dos casos no MVP
  - Cons: depende de detecção correta do tipo (mitigada por 3 camadas: regex → IA classificadora → manual)
  - Aceita

## Consequências

**Boas:**
- Taxa de publicação não fica mais à mercê de alucinação de categoria
- Schema agora cobre todos os campos obrigatórios do `POST /items`
- Configurações como frete grátis e tempo de garantia ficam editáveis (em Configurações) sem mudança de código
- Auditoria de tipo (`tipo_origem`) permite medir precisão do regex no futuro

**Tradeoffs aceitos:**
- Mais 5 colunas no schema (`tipo_aviamento`, `tipo_origem`, `shipping_mode`, `frete_gratis`, `sale_terms`, `preco_publicacao`) — manuseável
- Manutenção do dicionário de palavras-chave para detecção de tipo — esperado conforme novos sub-tipos aparecem (ex: "linhão", "linha de bordar")
- Operador precisa de UI pra escolher categoria manualmente quando `tipo=outro` — fricção pontual aceitável

**Impacto no prompt do copywriter (spec §8):**

O prompt fica mais simples:

```
ANTES (cortar):
- Identifique a categoria ML adequada (formato MLB####)
- "categoria_ml_id": "MLB..."

DEPOIS (manter só):
- Título (≤60 chars)
- Descrição (800-1500 chars)
- Atributos da categoria (lista ESPECÍFICA passada como input, não escolhida pela IA)
```

Ou seja, o prompt agora recebe a categoria como **input** (decidida pelo lookup) e gera apenas os atributos daquela categoria. Isso reduz drasticamente a superfície de alucinação.

## Notas de implementação

- A lista exata de `attributes` obrigatórios por categoria ML pode ser obtida via `GET /categories/{category_id}/attributes` da API ML. Recomendo cachear localmente no banco (tabela `ml_category_attributes` futura) ou em memória no boot da edge function.
- Para `WARRANTY_TYPE` o `value_id` "2230279" corresponde a "Garantia do vendedor". Verificar na implementação se o ID é estável (Meli pode mudar).
- `listing_type_id = 'gold_special'` é Clássico (4% de comissão). Custo zero pra criar. Em v2 considerar `gold_pro` (Premium) que dá mais exposição mas tem 5-7% de comissão.

## Como reverter

Se um dia for desejável que o operador volte a escolher categoria a cada lote, o campo `categoria_ml_id` já existe no schema; basta plugar UI em vez de lookup. Lookup table permanece como sugestão.

---

## Adendo (2026-06-01) — IDs reais validados na API + atributos obrigatórios

Os IDs de categoria citados na Parte 1 (`MLB1132`/`MLB1430`/`MLB1429`) eram **chutes**
("verificar ID exato na implementação") e estavam **todos errados** — apontavam para
categorias raiz não-publicáveis ("Brinquedos e Hobbies", "Calçados, Roupas e Bolsas", "Outros").
Descobertos via `GET /sites/MLB/domain_discovery/search` + `GET /categories/{id}` com token de
produção. Os IDs reais (categorias-folha, `listing_allowed:true`, 12 fotos):

| Tipo | category_id real | Nome ML |
|---|---|---|
| linha | **MLB270273** | Fios e Cadarços de Armarinho |
| fita | **MLB255054** | Fitas de Cetim |
| botao | **MLB270272** | Botões |

**Atributos obrigatórios** (`tags.required`, via `GET /categories/{id}/attributes`):

| Categoria | Obrigatórios | Observação |
|---|---|---|
| linha (MLB270273) | `BRAND`, `MODEL` | ambos texto livre |
| fita (MLB255054) | `BRAND`, `RIBBON_TYPE` | RIBBON_TYPE = 8 value_ids fixos (Cetim/Estampada/Fita/Gorgorão/Organza/Renda/Veludo/Viés) |
| botao (MLB270272) | `BRAND`, `MATERIAL` | MATERIAL = Acrílico/Madeira |

`COLOR` é variation-capable em todas → vai como `attribute_combinations` por variação (na publicação).

**Decisões de preenchimento (2026-06-01):**
- `BRAND` = **fixo "Avil"** (decisão de negócio do Diego; ML aceita texto livre).
- `MODEL` (linha) = nome do PAI.
- `RIBBON_TYPE` (fita) = inferido do nome por palavra-chave (default value_id `22691456` "Fita").
- `MATERIAL` (botão) = "Madeira" se o nome menciona, senão "Acrílico" (default).

**Implementação:** `_shared/categoria/detectar.ts` (regex de tipo) + `_shared/categoria/atributos.ts`
(`categoriaParaTipo`, `montarAtributosML`, `atributosFaltantes`), TDD 17 testes. Integrado no
`process-familia` **v17**: popula `tipo_aviamento`, `tipo_origem`, `categoria_ml_id`, `atributos_ml`.
`tipo='outro'` deixa `categoria_ml_id` null → badge "categoria indefinida" na revisão (não publica
às cegas). A **camada IA classificadora** (Parte 1, item 2) não foi implementada — o regex cobre os
casos reais; fica como melhoria se aparecerem nomes que o regex não classifica.
