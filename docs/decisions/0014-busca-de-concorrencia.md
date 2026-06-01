# ADR-0014 — Busca de concorrência no Mercado Livre

**Status:** Aceito (aditado em 2026-06-01 — ver §Adendo)
**Data:** 2026-05-31
**Decisores:** Diego (decisões de produto/UX)
**Relacionado:** alimenta [ADR-0008 (estratégia de preço condicional)](0008-estrategia-de-preco-condicional.md); consome [ADR-0012 (`getValidAccessToken`)](0012-refresh-token-oauth-ml-com-lock-redis.md); resolve o gap §558 do `TASKS.md`
**Spec:** [docs/superpowers/specs/2026-05-31-m4-busca-concorrencia-design.md](../superpowers/specs/2026-05-31-m4-busca-concorrencia-design.md)

---

## Contexto

A estratégia de preço condicional (ADR-0008) precisa saber, para cada família, se há
concorrência no Mercado Livre e qual o menor preço dos concorrentes. Faltava definir **como**
buscar isso, em **que granularidade**, e **como classificar** o resultado — o gap §558 deixou
essas regras em aberto.

Restrições do domínio:
- O **GTIN existe por variação** (cada cor), mas muitos produtos de aviamento têm GTIN **nulo**
  ou **interno `3000*`** (não é EAN real GS1 — ver glossário do CLAUDE.md).
- Uma família pode ter **centenas de variações** (caso real do M2: 290) → buscar por variação
  estouraria o rate limit da API do ML.
- A busca por GTIN (catálogo) é confiável; a busca por título tem falsos positivos/negativos.

## Decisões

**1. Granularidade: 1 busca por família.**
Uma única busca por família, cujo resultado (`vendedores`, `preco_min`) vale para todas as
variações. Justificativa: rate-limit-safe e, para aviamentos, o preço de mercado não varia por
cor (concorrentes vendem o produto, não a cor específica).

**2. Identificador representativo + fallback.**
- Usa o GTIN da **primeira variação com GTIN válido** (não nulo, não `3000*`, formato EAN) →
  busca por **catálogo/GTIN**, `origem='gtin'`, **confiança alta**.
- Se nenhuma variação tem GTIN válido → busca por **título do PAI** (`/sites/MLB/search?q=`),
  `origem='titulo'`, **confiança baixa** (sinalizada na revisão para o operador conferir antes
  de aprovar preço competitivo).

**3. Classificação informativa (não afeta o preço).**
`sem` (0 vendedores) / `moderada` (1–5) / `alta` (6+). É apenas rótulo na tela de revisão. O
cálculo de preço (ADR-0008) continua **binário**: só liga para `vendedores > 0` e `preco_min`.

**4. Resiliência → PRÓPRIO seguro.**
Erro/timeout/429/resultado vazio é tratado como **sem concorrência** (`vendedores=0`), o que
leva à estratégia PRÓPRIO (mantém o preço da planilha). A busca **nunca derruba** o
`process-familia` — a copy é o que define a família como "pronta".

## Alternativas consideradas

- **Busca por variação (Nx):** precisão máxima, mas inviável (290 chamadas/família estouram
  rate limit). Rejeitada.
- **Híbrido (variação quando tem GTIN, senão família):** mais complexo e ainda arriscado em
  lotes grandes. Rejeitada.
- **Sem GTIN → tratar como PRÓPRIO (não buscar):** mais seguro contra falso positivo, mas
  perde oportunidades competitivas em produtos sem EAN real (que são muitos). Rejeitada em
  favor de "título + baixa confiança", que aproveita a oportunidade sem esconder o risco.
- **`alta` concorrência influenciar o preço:** rejeitada no MVP — mantém a regra binária do
  ADR-0008; a classe fica só informativa.

## Consequências

**Boas:**
- Rate-limit-safe; 1 busca por família + cache reduzem drasticamente as chamadas.
- Primeiro consumidor real do `getValidAccessToken` (ADR-0012).
- Degrada com segurança: indisponibilidade do ML → PRÓPRIO, nunca preço errado a R$ 0.

**Tradeoffs aceitos:**
- Resultado por família não captura diferença de preço por cor (irrelevante em aviamentos).
- Busca por título pode trazer falso positivo → mitigado pela flag de **baixa confiança** na
  revisão e pelo futuro alerta de "preço perigoso" (gap §551, bloco de preço).

## Modelo de dados (migration aditiva em `familias`)

- `concorrencia_vendedores int default 0`
- `concorrencia_preco_min numeric null`
- `concorrencia_origem enum('gtin','titulo','nenhuma') default 'nenhuma'`
- `concorrencia_classe enum('sem','moderada','alta') default 'sem'`
- A **confiança** deriva de `origem` (gtin→alta, titulo→baixa); não há coluna dedicada.

## Cache

`cache:concorrencia:{gtin}` ou `cache:concorrencia:titulo:{hash-do-titulo-normalizado}`,
TTL **6h**, no Upstash Redis já no stack.

## Como reverter

A busca é isolada em `_shared/ml/concorrencia.ts` + funções puras. Para desligar, basta o
`process-familia` não chamá-la (campos ficam no default `nenhuma`/`0`, levando todo mundo a
PRÓPRIO). Trocar o endpoint do ML é localizado nessa função.

---

## Adendo (2026-06-01) — endpoint real do ML após bug bash

O bug bash (Task 10 do plano-07) com token de produção (AVILBV) revelou que o endpoint
`/sites/MLB/search` usado na 1ª implementação retorna **HTTP 403 forbidden** mesmo com token
válido — o Mercado Livre **descontinuou o search de itens por site para apps**. A
implementação foi corrigida para usar o **catálogo** (que era a intenção original da Decisão 2):

**Ramo GTIN (confiança alta) — fluxo de 2 chamadas:**
1. `GET /products/search?status=active&site_id=MLB&q={gtin}` → `results[0].id` (product_id de
   catálogo). `paging.total=0` ou sem id → `origem='gtin'`, sem concorrência.
2. `GET /products/{product_id}/items` → conta `seller_id` distintos (= `vendedores`) e
   `min(price)` (= `preco_min`). Campos vêm no **topo** de cada oferta (`seller_id`/`price`),
   não em `seller.id`.

Validado em 2026-06-01: GTIN `7891521360659` (Fita Cetim Progresso N.3) → produto
`MLB34175726` → 8 ofertas, 6 vendedores distintos, preço mín R$ 12,62, classe `alta`.

**Ramo título (confiança baixa) — não quantifica.** `/products/search?q={título}` retorna ~10k
resultados irrelevantes (ruído de catálogo textual sem âncora de EAN). Em vez de inventar um
número, a busca registra `origem='titulo'` com `vendedores=0`/`classe='sem'` → estratégia
PRÓPRIO segura. Isso troca a 2ª parte da Decisão 2 ("título via `/sites/MLB/search`"): o ramo
título deixa de tentar contar concorrência e passa a só sinalizar "sem EAN → sem dado
confiável". A Decisão 4 (resiliência → PRÓPRIO) e a classificação informativa (Decisão 3)
permanecem.

**Cache:** chave `cache:concorrencia:gtin:{gtin}` (TTL 6h). O ramo título não cacheia (retorno
imediato, sem I/O). A normalização por hash de título citada na seção "Cache" deixa de ser
usada.
