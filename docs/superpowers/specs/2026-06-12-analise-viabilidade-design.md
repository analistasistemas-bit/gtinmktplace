# Análise de viabilidade — design

**Data:** 2026-06-12
**Status:** aprovado (brainstorming) — aguardando plano de implementação
**Branch:** `worktree-analise-viabilidade`

## Problema

Hoje o Diego só descobre se um produto é viável **depois** de subir o lote: o `process-familia`
busca concorrência, calcula preço sugerido (ADR-0020/0023) e o front mostra o semáforo na Revisão.
Isso significa importar planilha + imagens, processar com IA, gastar tempo/tokens — só então saber
que metade dos itens é inviável (ex.: itens baratos cuja tarifa fixa do ML come a margem).

Ele quer responder **antes de subir o lote**: *"esses produtos valem a pena? consigo entrar
no ML competindo e ainda recebendo meu mínimo?"* — pesquisando por GTIN(s) ou por planilha enxuta.

## Objetivo

Uma área de **consulta avulsa** (menu próprio, fora do fluxo de lotes) onde o Diego informa
produtos — por planilha ou colando GTINs — e vê, por produto:

1. Se o produto **já vende no ML** (catálogo) e por quanto (menor preço + nº de vendedores).
2. A **viabilidade**: se ele igualar o menor preço do mercado, quanto sobra de líquido após a
   comissão do ML, e se isso cobre o seu mínimo (PRECO da planilha) — com semáforo 🟢🟡🔴.
3. Um **simulador**: editar o seu mínimo / custo recalcula a análise ao vivo, comparando
   Clássico vs Premium.

## Não-objetivos (YAGNI)

- **Não persiste** nada: não cria lote, não grava no banco, não salva histórico de análises.
- **Não toca** em publicação, imagens, IA de copy, nem no ML (só leitura de catálogo/tarifas).
- Sem exportar relatório, sem agendar, sem alertas.
- Não reaproveita a estrutura pai/filho: a análise é **linha a linha por GTIN**.

## Visão geral

```
┌─ Frontend: /viabilidade ──────────────────────────────────────┐
│  Aba "Subir planilha"  │  Aba "Colar GTINs"                    │
│        │                          │                            │
│        ▼ (xlsx base64)            ▼ ([{gtin, preco_min, custo}])│
│             POST edge: analisar-viabilidade                    │
│        ◀─────────────── [ItemAnalisado]  ◀────────────────     │
│  Tabela + linha expansível (simulador, Clássico vs Premium)    │
└────────────────────────────────────────────────────────────────┘

┌─ Edge: analisar-viabilidade ──────────────────────────────────┐
│  1. Resolve itens (parseia xlsx em memória OU usa o JSON)      │
│  2. Por item com GTIN:  buscarConcorrencia (catálogo)          │
│       achado → category_id → listing_prices Clássico+Premium   │
│       → avaliarViabilidade (puro)                              │
│       não achado → { existeNoML: false }                       │
│  3. Resiliente: um item que falha não derruba os outros        │
└────────────────────────────────────────────────────────────────┘
```

## Entrada

### Aba "Subir planilha"
Aceita **qualquer uma das duas** formas, detectando pelas colunas presentes:

- **Planilha enxuta** — só `NOME`, `UNIDADE`, `GTIN`, `PRECO`, `CUSTO`.
- **Planilha completa do lote** — todas as colunas; usa só essas 5, ignora o resto.

Regras do parser de análise (`extrairItensAnalise`, função pura nova, mais simples que `agruparPorPai`):

- Exige a presença das 5 colunas (`NOME`, `UNIDADE`, `GTIN`, `PRECO`, `CUSTO`); colunas extras
  são aceitas sem erro. Faltando alguma → erro de validação claro (qual coluna falta).
- **Cada linha com `GTIN`, `PRECO` e `CUSTO` válidos = 1 item a analisar.**
- Se a planilha tiver a coluna `PAI`, pula as linhas de agrupador (`PAI = 0`) — analisa só os
  vendáveis. Na enxuta (sem `PAI`), analisa todas as linhas com GTIN.
- Linhas sem GTIN ou sem PRECO/CUSTO válidos são descartadas e **contadas** (aviso "N linhas
  ignoradas"), não bloqueiam.
- `UNIDADE` entra só pra exibição/contexto; não afeta o cálculo.
- O xlsx é lido em memória na edge (`npm:xlsx`, mesmo padrão do `ingest-lote`); **nada vai pro
  Storage** (análise efêmera). O front envia o arquivo como base64 no corpo do POST.

### Aba "Colar GTINs"
Textarea, um GTIN por linha. Fluxo:
1. Cola os GTINs → POST sem custo/preço → a edge devolve, por GTIN, se existe no ML + mercado.
2. A tabela mostra os achados; para cada linha **achada**, o Diego preenche **custo** e **preço de
   venda (seu mínimo)** inline. O simulador recalcula a viabilidade no front a cada edição
   (sem custo/preço, a linha mostra só o mercado e o semáforo fica "informe seu mínimo").

## Motor por GTIN (backend)

Reusa o que já existe, com **uma extensão**: capturar o `category_id` do produto de catálogo
(necessário para `listing_prices`). Hoje `buscarConcorrencia` devolve `product_id` e `ofertas`,
mas não a categoria.

Por item com GTIN válido:
1. `buscarConcorrencia(userId, { nome_pai: nome, variacoes: [{ gtin }] })` → `ResultadoConcorrencia`.
   - `origem='titulo'` ou `vendedores=0`/`product_id` nulo → **não existe no ML** para este GTIN.
2. Achado: buscar `GET /products/{product_id}` → `category_id`.
3. `listing_prices` no **menor preço do mercado** (`ofertas.preco_min`) para `gold_special` (Clássico)
   e `gold_pro` (Premium) → comissão exata de cada tipo (`buscarListingPrice` + `comissaoDe`, reuso
   de `_shared/ml/listing-prices.ts`).
4. `avaliarViabilidade(...)` (puro, ver abaixo).

Cache: o cache Redis de concorrência (`cacheConcorrencia*`) já cobre a busca por GTIN. Comissão pode
reusar o cache de `calcular-tarifa-ml` (Redis 6h) ou recalcular — decisão no plano (preferir reuso).

## Modelo de viabilidade (validado no brainstorming)

Notação por item, dado um tipo de anúncio (Clássico ou Premium):
- `minimo` = PRECO da planilha / valor informado = **líquido mínimo desejado** (o que quer receber).
- `custo` = CUSTO do produto.
- `menor_ml` = menor preço entre quem já vende no ML (`ofertas.preco_min`).
- `comissao(preco)` = comissão real do ML naquele preço (via `listing_prices`), **incluindo a
  tarifa fixa** — que abaixo do abismo de R$ 12,50 é ~50% do preço (ADR-0023). Por isso o líquido
  **nunca** é calculado por fórmula linear: sempre vem do `listing_prices` no preço real.

Cálculos:
- `liquido_no_mercado = menor_ml − comissao(menor_ml)` — "se eu igualar o menor preço, quanto sobra".
- `etiqueta_necessaria` = menor preço cujo líquido ≥ `minimo`. Como há a descontinuidade do abismo,
  é o **gross-up do ADR-0023** (`sugerirPrecoVenda` no ramo PRÓPRIO já resolve isto) — exibido como
  "pra receber seu mínimo, anuncie a R$ X".

Semáforo (eixo: igualar o mercado):
- 🟢 **Viável** — `liquido_no_mercado ≥ minimo`. Anuncio ≤ mercado e recebo ≥ meu mínimo.
- 🟡 **Apertado** — `custo ≤ liquido_no_mercado < minimo`. Pra bater o mercado eu recebo menos que
  meu mínimo, mas ainda acima do custo.
- 🔴 **Inviável** — `liquido_no_mercado < custo`. Igualar o mercado dá prejuízo.
- ⚪ **Sem dado** — sem `minimo`/`custo` informado (modo GTIN antes de preencher), ou comissão
  indisponível.

`avaliarViabilidade` é uma função pura nova (`_shared/preco/viabilidade.ts`, TDD). Reaproveita o
conceito de `calcularSemaforo` (`src/lib/semaforo.ts`), mas aqui o "líquido" é o **líquido no preço
de mercado**, não num preço sugerido. As duas vão conviver (contextos diferentes); avaliar extrair
o núcleo comum no plano.

## Tela / UX

Re-skin com o design system atual (tokens, `PageHeader`, `Tabs`, `Table`, `StatusPill`, `EmptyState`,
`Input`). Item de menu novo na `NAV_ITEMS` da `sidebar` (ícone `Search`/`Scale`), rota `/viabilidade`.

- **Abas** no topo: "Subir planilha" | "Colar GTINs".
- **Tabela** (resultado): colunas **Produto · Menor ML · Vendedores · Seu mínimo · Líquido se
  igualar · 🚦**. Semáforo da tabela usa **Clássico**. Linhas "não vende no ML" aparecem em cinza.
- **Linha expansível** = simulador:
  - inputs **Seu mínimo** e **Custo** (no modo planilha já vêm preenchidos; editáveis).
  - **Clássico vs Premium lado a lado**: para cada um, comissão (%+fixa), `liquido_no_mercado`,
    semáforo e `etiqueta_necessaria`.
  - detalhe do mercado: faixa de preço (min–max), nº com frete grátis, nº FULL.
  - recálculo ao vivo ao editar mínimo/custo (debounce; segue o padrão de `useTarifaML`).
- **Estados**: loading (skeleton por linha), erro por item (badge "ML indisponível" sem derrubar a
  tabela), vazio (`EmptyState`).

## Backend — contrato da edge `analisar-viabilidade`

`POST` (verify_jwt true; usa o token ML do usuário via `getValidAccessToken`).

Request (um dos dois):
```jsonc
{ "modo": "planilha", "arquivoBase64": "<xlsx>" }
{ "modo": "gtins", "itens": [{ "gtin": "789...", "preco_min": 4.0, "custo": 1.5 }] }
```

Response:
```jsonc
{
  "itens": [
    {
      "gtin": "789...", "nome": "...", "unidade": "UN",
      "existeNoML": true,
      "mercado": { "menor": 25.0, "maior": 39.9, "vendedores": 6, "freteGratis": 4, "full": 2 },
      "minimo": 4.0, "custo": 1.5,
      "classico": { "comissaoPct": 14, "comissaoFixa": 0, "liquidoNoMercado": 21.5,
                    "etiquetaNecessaria": 12.55, "semaforo": "verde" },
      "premium":  { "comissaoPct": 19, "comissaoFixa": 0, "liquidoNoMercado": 20.25,
                    "etiquetaNecessaria": 12.55, "semaforo": "verde" }
    },
    { "gtin": "3000...", "nome": "...", "existeNoML": false }
  ],
  "ignorados": 0
}
```

No modo `gtins` sem `preco_min`/`custo`, os blocos `classico`/`premium` trazem só comissão e
mercado; o semáforo é resolvido no front quando o Diego preenche os campos (reuso da função pura
no cliente).

## Resiliência / erros

- Um GTIN cuja busca/comissão falha → `existeNoML` indeterminado vira linha com aviso, os demais
  seguem (Promise.allSettled, padrão dos workers).
- Sem credencial ML conectada → erro claro na tela ("conecte sua conta do ML em Configurações").
- Rate limit: a busca por GTIN tem cache Redis; processa com concorrência limitada (ex.: lotes de
  ~5) para não estourar a API do ML numa planilha grande. Logar quantos itens, sem cap silencioso.
- Planilha sem as 5 colunas → 400 com mensagem dizendo qual coluna falta.

## Testes (TDD)

Funções puras novas, testadas isoladamente:
- `extrairItensAnalise(rows)` — enxuta vs completa, pula `PAI=0`, descarta/conta inválidos, exige colunas.
- `avaliarViabilidade(minimo, custo, menorMl, comissao)` — os 4 casos do semáforo, incluindo o
  abismo (item barato → 🔴 mesmo com menor_ml acima do custo bruto).
- `extrairCategoriaProduto(json)` — pega `category_id` do `/products/{id}`.

UI: smoke test da página (render, troca de abas, recálculo do simulador) seguindo o padrão dos
testes de página existentes.

## Arquivos (estimativa)

Backend:
- `supabase/functions/_shared/preco/viabilidade.ts` (novo, puro) + teste.
- `supabase/functions/_shared/analise/extrair-itens.ts` (novo, puro) + teste.
- `supabase/functions/_shared/ml/concorrencia.ts` — estender para expor `category_id` (ou helper
  `buscarCategoriaProduto`).
- `supabase/functions/analisar-viabilidade/index.ts` (nova edge).

Frontend:
- `src/pages/Viabilidade.tsx` (nova página) + componentes (`TabelaViabilidade`, `LinhaSimulador`).
- `src/lib/viabilidade.ts` (adapter + semáforo no cliente) + teste.
- `src/components/sidebar.tsx` (item de menu) + `src/App.tsx` (rota).

## Fora de escopo / decisões adiadas

- Reaproveitamento exato entre `calcularSemaforo` e `avaliarViabilidade` (decidir no plano).
- Reuso do cache de `calcular-tarifa-ml` vs recálculo (preferir reuso; confirmar no plano).
- Bug bash com token real: confirmar que `/products/{id}` traz `category_id` utilizável e que a
  comissão por tipo bate (validável como no card "Você recebe").
