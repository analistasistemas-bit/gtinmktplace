# ADR-0026: Generalização da categorização e atributos por IA (resolução híbrida + schema dinâmico)

**Status:** Aceito (detalhado no início dos épicos E3/E4)
**Data:** 2026-06-13 (stub) · 2026-06-14 (detalhado, escopo E3/E4)
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E3/E4); estende ADR-0009/0022 (categoria determinística); a taxonomia canônica fica para o ADR do E5 (2º canal)

## Contexto

A categorização atual é determinística por nicho (regex `linha|fita|botão|cola` → categoria MLB fixa +
atributos hard-coded por tipo em `_shared/categoria/atributos.ts`). Funciona porque o domínio é fechado
(aviamentos). Para vender "qualquer produto de qualquer segmento" é preciso generalizar **sem perder a
precisão atual** (zero regressão nos aviamentos) e **sem alucinar atributos**.

## Decisão de escopo (brainstorming 2026-06-14)

A direção do stub previa **4 camadas**, incluindo uma **taxonomia canônica** (Shopify ~12k) + tabela
`mapping_categoria_canal`. Decisão: **adiar a taxonomia canônica para o E5** (2º canal). Ela só rende
quando há ≥2 marketplaces para mapear entre si (problema N×M); com **um único canal (ML)**, o preditor
nativo do ML (`domain_discovery`) já devolve a categoria-folha diretamente. Adotar a taxonomia agora seria
indireção sem retorno (YAGNI). Aplica [[feedback_pragmatic_speed]].

Portanto o trabalho fica em **duas camadas**, divididas em dois épicos:

- **E3 — Resolução de categoria + schema dinâmico de atributos** (este ciclo): saber *qual categoria* e
  *quais atributos são obrigatórios*, para qualquer produto, sem código novo por nicho.
- **E4 — Preenchimento de valores de atributo por IA (closed-set) + validação** (ciclo seguinte): preencher
  *com quais valores*, escolhendo dentro da lista permitida da categoria, sem alucinar.

## Decisão técnica — E3

### 1. Resolução de categoria em camadas (primeira que vencer manda)
1. **Override determinístico por vertical.** O `detectarTipoAviamento` atual vira um "registro de overrides
   plugável": casou um tipo conhecido → categoria-folha fixa do override (`origem='regex'`,
   confiança alta). **Zero regressão** nos aviamentos.
2. **Preditor nativo do ML.** `GET /sites/MLB/domain_discovery/search?limit=8&q={nome}` devolve um array
   **ordenado por relevância** de `{domain_id, domain_name, category_id, category_name}`; o topo é a melhor
   categoria-folha (`origem='preditor'`, confiança média). Cache no Redis por query normalizada.
3. **LLM-texto como desempate** — só quando o override não casa **e** o preditor devolve candidatos
   genuinamente ambíguos (≥2 *domains* distintos sem vencedor claro). O LLM recebe nome+descrição e
   **escolhe dentro do closed-set** das categorias que o `domain_discovery` retornou — **nunca inventa
   `category_id`** (`origem='ia'`, confiança baixa).
4. **Fallback manual.** `domain_discovery` vazio ou tudo falhou → `outro`; o operador escolhe na Revisão
   (`definir-categoria-familia`, já existe), `origem='manual'`.

### 2. Schema dinâmico de atributos
`GET /categories/{id}/attributes` devolve `[{id, name, tags:{required, conditional_required,
catalog_required, variation_attribute,…}, values:[{id,name}], value_type}]`. Lido por categoria e
**cacheado no Redis**. `atributosFaltantes` ganha versão **genérica**: compara os atributos que temos
contra os `required` (e os `conditional_required` que já tratamos, ex.: GTIN/EMPTY_GTIN_REASON) lidos da
API — não mais hard-coded por tipo. No E3 os obrigatórios faltantes são apenas **exibidos** na Revisão; o
preenchimento por IA é o E4.

### 3. Persistência (aditiva mínima)
- Migration aditiva: `ALTER TYPE tipo_origem ADD VALUE 'preditor'`.
- Reusa `familias.categoria_ml_id`, `familias.tipo_origem`, `familias.atributos_ml`.
- Duas colunas aditivas que servem direto ao critério de saída do E3 (exibir categoria + obrigatórios na
  Revisão): `familias.categoria_nome` (text, nome humano — rótulo do override **ou** `category_name` do
  preditor) e `familias.atributos_faltantes` (jsonb, nomes dos atributos `required` ainda não preenchidos,
  snapshot do processamento).
- **Sem coluna de confiança** — derivada de `tipo_origem` no front (regex=alta, preditor=média, ia=baixa).
  YAGNI.

## Decisão técnica — E4 (direção; detalhada no spec do E4)
- LLM extrai `value_id`/`value_name` **escolhendo dentro de `values[]`** (closed-set) da categoria.
- `montarAtributosML` generaliza de "por tipo fixo" para "registro de overrides por vertical + schema
  dinâmico"; aviamentos seguem 100% determinísticos → zero regressão.
- `atributosFaltantes` vira validador genérico contra os `required` lidos da API; correção fuzzy para o
  valor permitido mais próximo; defaults seguros (como o `IS_DOUBLE_FACE='Não'` atual).
- UI: selo "categoria/atributo sugerido por IA — confirme" na Revisão; seletor manual permanece como
  escape hatch universal; registrar `tipo_origem` + confiança; correções do operador vão para fila humana
  (não auto-treino).

## Validação com token real (probe descartável 2026-06-14)
- `domain_discovery/search` em **PT-BR** (sem necessidade do inglês do global-selling): caneta→`MLB44014`,
  furadeira→`MLB189007`, shampoo→`MLB1265`, caderno→`MLB105305`. Array ordenado, topo correto.
- O preditor **concorda com os overrides**: "fita cetim…" → `MLB255054` (mesmo ID que o override hard-coda).
- `/categories/MLB189007/attributes`: 90 atributos; obrigatórios reais BRAND+MODEL (texto livre), VOLTAGE
  (closed-set 21 valores, `allow_variations`), GTIN/EMPTY_GTIN_REASON (`conditional_required`).

## Questões em aberto resolvidas
- **Taxonomia canônica?** Adiada para o E5 (multicanal). E3/E4 usam o preditor do ML direto.
- **Idioma/endpoint do preditor?** `GET /sites/MLB/domain_discovery/search?q=` em PT-BR, validado.
- **Custo/latência de IA?** Overrides resolvem verticais conhecidas a custo zero; preditor é um GET barato
  cacheado; LLM só como desempate raro (E3) e preenchimento closed-set (E4). Vision adiado (E4/ambiguidade).

## Consequências
- Aceita qualquer produto no ML sem código novo por nicho. Revisão humana segue como gate final.
- Overrides e IDs do canal são **cache verificável**, não verdade eterna (ML recategoriza desde 29/10/2025);
  o preditor nativo alinha com isso. Monitorar status pós-publicação.
- A taxonomia canônica continua sendo pré-requisito do mapeamento N×M e entra no E5.

## Emenda 2026-10-17 — desempate vê o caminho da categoria e o gênero do produto

**Caso:** short adulto masculino (00000010, org Zaven). O `domain_discovery` devolveu 1º `MLB188064`
(Bermudas e Shorts) e 2º `MLB278065` (Bebês › Roupas de Bebê › Shorts), os dois no domínio `MLB-SHORTS`.
O prompt do desempate só mostrava "domínio > folha" ("Shorts > Bermudas e Shorts" × "Shorts > Shorts"),
sem o público, e a IA escolheu o de bebê. Categorias-irmãs do mesmo domínio diferem por público
(adulto/infantil/bebê/gestante), e isso é sistemático em vestuário.

**Decisão:**
- Quando o desempate roda, cada candidato passa a aparecer com o **caminho completo**
  (`GET /categories/{id}` público → `path_from_root[].name` unido por " > "). A leitura é em paralelo, com
  cache no Redis (`catpath:{id}`, 30 dias) e orçamento total de ~3 s. Uma falha num candidato deixa só
  aquele com a linha antiga "domínio > folha", e a falha nunca impede a chamada ao LLM.
- O prompt passa a levar o **gênero cadastrado** (`familias.genero`) com o público explícito:
  masculino/feminino/unissex = adulto; meninos/meninas/sem gênero infantil = infantil. Leva também a
  instrução de respeitar o público mostrado nos caminhos e no gênero.
- **Sem veto determinístico.** Um veto por "mesmo domínio" erraria no sentido inverso (ex.: "Short bebê"
  com o adulto em 1º), então a IA continua livre para corrigir nas duas direções.
- O fallback por nome do catálogo do concorrente (process-familia, lote #27) aplicava o 1º específico
  sem desempate. Agora ele passa pelo **mesmo** desempate (`escolherEntreCandidatos`). Abstenção, só
  genérico ou falha mantêm o resultado textual, como antes.
- A pista forte de vertical (ferramenta elétrica) não muda.
