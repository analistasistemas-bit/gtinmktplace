# Contrato das seções 2, 3 e 7 — relatório da Análise PubliAI

**Status:** referência normativa. Fecha o item "contrato das seções 2, 3 e 7" do
[Spike 040](../spikes/040-revisao-adversarial-adr-0140.md), que apontou que essas três seções
tinham título mas nenhuma definição — sem campos, fontes, unidades ou critério de aceite, duas
implementações diferentes poderiam alegar conformidade.

**Data:** 2026-08-28
**Rege:** [ADR-0140](../decisions/0140-analise-publiai-joompulse-radar-e-sonar.md) (D-2, D-5, D-7, D-9, D-10, D-17, D-18, D-28)
**Reusa:** [ADR-0137](../decisions/0137-sonar-disputa-caminho-b-concentracao-por-anuncio.md) (concentração), [ADR-0124](../decisions/0124-veredito-de-oportunidade-do-sonar.md) / [ADR-0138](../decisions/0138-sonar-linguagem-comercial-e-condicao-de-entrada.md) (veredito), [ADR-0127](../decisions/0127-sonar-tabela-por-anuncio-e-historico.md) (modos termo e EAN)
**Mede-se contra:** [Spike 039](../spikes/039-joompulse-cobertura-medida.md) e [Spike 041](../spikes/041-joompulse-censo-do-radar-e-validacao-da-d4.md)

---

## Regras globais

Valem para todo campo das três seções.

1. **Todo número exibido carrega fonte, unidade e janela** (D-7). Nunca "vendas": ou
   `vendidos (acumulado, amostra — Apify)` ou `vendas/mês (estimativa JoomPulse)`.
2. **Nenhum número nasce na IA** (D-2). A IA recebe os campos abaixo já calculados e escreve
   apenas o texto interpretativo. Um número no texto que não exista nesta tabela é defeito.
3. **Ausência tem estado próprio, nunca zero.** Os quatro estados do Spike 038/041 valem em todo
   campo derivado da JoomPulse: `sem dado` (não rastreado), `sem venda estimada no período`,
   `valor`, e — para dinheiro — `indisponível` quando a proveniência não é `official` (D-28).
4. **`orderCount1m = 0` em anúncio que não detém o buy-box nunca é renderizado como venda zero.**
   É ausência de atribuição. Medido: 89% dos anúncios de concorrentes caem nesse caso.
5. **Modo importa.** O Sonar tem dois modos (ADR-0127 Errata 1): **termo** (nicho heterogêneo,
   vários produtos) e **EAN** (um produto específico). Campos marcados `EAN-only` **não são
   exibidos** no modo termo — não são exibidos vazios, não existem.
6. **`N elegível`** significa: anúncios da amostra com **venda estimada E preço** — os que entram
   em qualquer conta de faturamento. É diferente de `N da amostra`. Toda regra de mínimo testa o
   elegível (D-10 corrigida).

---

## Seção 2 — Resumo das Métricas & Validação

| # | Campo | Fonte | Unidade | Cálculo | Quando falta |
|---|---|---|---|---|---|
| 2.1 | Categoria oficial | API do ML: `/items/{id}` → `category_id`, e `/categories/{id}` → `path_from_root` | texto | Categoria do **anúncio líder** da amostra (maior faturamento estimado). Exibe o caminho completo. | Sem líder elegível → usar a categoria mais frequente da amostra e **dizer que é a modal, não a do líder** |
| 2.2 | Comissão da categoria | API do ML `/sites/MLB/listing_prices` (D-18) | % e R$ | Duas linhas: **Clássico** consultado em R$ 149,99 e **Premium** em R$ 150,00 — os dois pontos que definem a modalidade. Nunca alíquota genérica. | Proveniência ≠ `official` → **seção 2 não exibe comissão** e diz "não foi possível confirmar a comissão oficial" (D-28) |
| 2.3 | Preço médio sem extremos | Top 5 da seção 4 | R$ | **EAN-only** (D-9). Ordena os elegíveis por preço, descarta o menor e o maior, média aritmética do restante. | `N elegível < 5` → **não calcula** e diz por quê, citando `N` (D-10) |
| 2.4 | Preço equivalente por unidade | Top 5 da seção 4 | R$/unidade e % | **Termo-only** (D-9). Substitui 2.3 no modo termo. Preço ÷ quantidade declarada por embalagem; a saída principal é o **percentual** de distância entre o candidato e a mediana dos elegíveis. | Quantidade por embalagem não parseável em ≥3 elegíveis → **não calcula**; nunca cai para o valor absoluto |
| 2.5 | Menor e maior preço retido | Top 5 | R$ | Os dois valores **descartados** por 2.3, exibidos nomeadamente para o operador ver o que saiu. | Só existe quando 2.3 existe |
| 2.6 | Faturamento do Top N | JoomPulse | R$/mês (estimativa) | `Σ(vendas/mês × preço)` sobre os elegíveis do Top 5. **O rótulo diz o N real** — "faturamento do Top 3", não "do Top 5", quando só 3 são elegíveis. | `N elegível = 0` → "nenhum anúncio da amostra tem venda estimada"; a seção continua com 2.1 e 2.2 |
| 2.7 | Piso de nicho | Regra do operador | R$/mês | Constante **R$ 30.000/mês**, comparada a 2.6. É **regra comercial de Diego**, não medição — exibida como tal. | — |
| 2.8 | Meta de entrada | Derivado | R$/mês | `2.6 × 10%`. Objetivo declarado, não previsão. | Só existe quando 2.6 existe |
| 2.9 | Parecer de tamanho do nicho | Derivado | texto | `2.6 ≥ 2.7` → "nicho comporta entrada"; abaixo → "nicho pequeno para a meta". **Compara faturamento com piso, nada mais.** | `N elegível = 0` → "não dá para medir o tamanho deste nicho" |

### Trava obrigatória: 2.9 não é o veredito

O Sonar já tem um veredito 🟢/🟡/🔴 calibrado no Apify (ADR-0124/0137/0138), que a D-6 manda **não
recalibrar**. O campo 2.9 mede **uma coisa só — tamanho financeiro do nicho** — e precisa de nome
e visual distintos do veredito, sem semáforo e sem as três cores. Dois vereditos com aparência
igual e critérios diferentes na mesma tela é defeito de aceite, não questão de gosto.

---

## Seção 3 — Painel de Vendas

> **Decidido por Diego em 2026-08-28: movidos para a seção 6.** O pedido original colocava
> "Peso Físico × Peso Volumétrico" e "Enquadramento da Taxa Fixa / Frete" nesta seção, mas os dois
> dependem de **peso e dimensões**, que o operador só informa no bloco da DRE (D-5), e a D-16 exige
> **um único lugar para digitar peso**. Mantê-los aqui obrigaria a pedir dado antes das seções de
> mercado ou a duplicar o campo. **A seção 3 é puramente demanda do nicho**, e com isso a promessa
> da D-5 — as 6 seções de mercado saem imediatamente, sem pedir nada — continua valendo integralmente.

| # | Campo | Fonte | Unidade | Cálculo | Quando falta |
|---|---|---|---|---|---|
| 3.1 | Faturamento dos líderes | JoomPulse | R$/mês (estimativa) | Mesmo número de 2.6, repetido aqui como cabeçalho do painel. **Uma origem, um valor** — nunca recalculado. | herda de 2.6 |
| 3.2 | Volume de vendas do nicho | JoomPulse, `catalogOrderCount1m` | unidades/mês (estimativa) | `Σ` sobre os **catálogos distintos** representados na amostra — nunca soma por anúncio, que sofreria a atribuição de buy-box. Exibe também **quantos anúncios da amostra ficaram de fora** por não terem catálogo. | Nenhum anúncio da amostra com catálogo → "não dá para estimar o volume deste nicho" |
| 3.3 | Cobertura da estimativa | Derivado | contagem | `anúncios com catálogo rastreado / total da amostra`. **Campo obrigatório**, não opcional: sem ele o operador lê 3.2 como se cobrisse o nicho inteiro. | — |
| 3.4 | Anúncios sem venda atribuída | JoomPulse | contagem | Quantos elegíveis-candidatos devolveram `orderCount1m = 0`. Rotulado **"sem venda atribuída a esta listagem"**, jamais "não venderam". | — |
| 3.5 | Custos operacionais básicos | Cálculo do PubliAI | R$ | Comissão (2.2) e imposto da organização por origem (D-17). **Sem frete** — frete depende de peso, que vive na seção 6. | Alíquota não confirmada → trava LOUD, **não calcula** (D-17) |

### O que a seção 6 herda desta mudança

Fora do escopo deste contrato (a seção 6 é regida pelas D-15, D-16 e D-28), mas registrado para não
se perder: a seção 6 passa a ser dona de **peso físico**, **peso volumétrico**
(`C × L × A ÷ 6000`), **peso taxável** (o maior dos dois) e do **enquadramento de taxa fixa e
frete** resultante do cruzamento peso × faixa de preço. São os mesmos campos que a
`calcularSimulacaoML()` já consome, então não nasce entrada nova — apenas deixa de existir uma
segunda.

### Sobre 3.2 — limitação registrada

O Spike 041 observou que `catalogOrderCount1m` **parece discretizado em faixas** (valores repetem
num conjunto pequeno; dois catálogos distintos devolveram exatamente `1021`). Enquanto isso não for
confirmado, **3.2 é exibido como faixa/aproximação, nunca como contagem exata**, e o rótulo diz
"estimativa". Se a discretização se confirmar, o formato já estará certo; se não, ganha-se precisão
sem retrabalho.

---

## Seção 7 — Tradicional vs. Catálogo & Plano de Ação

| # | Campo | Fonte | Unidade | Cálculo | Quando falta |
|---|---|---|---|---|---|
| 7.1 | Tipo de anúncio | **API do ML**, não JoomPulse | 3 estados | `catalog_product_id` presente no item → **catálogo**; ausente → **tradicional**. | Item não retornado pelo ML → **não rastreado**. Nunca inferir "tradicional" de ausência na JoomPulse |
| 7.2 | Mistura do nicho | Derivado de 7.1 | contagem e % | Quantos da amostra são catálogo, quantos tradicionais, quantos não rastreados. | — |
| 7.3 | Concentração por anúncio | Apify (já existente) | % | **Fórmula da ADR-0137, sem alteração:** `top1 = maior(vendidos × preço) ÷ Σ(vendidos × preço)` sobre elegíveis; corte `max(30%, 2 × (100% ÷ elegíveis))`. | `N elegível < 5` → "não medida", com o motivo verdadeiro ("só N de M anúncios têm venda registrada") |
| 7.4 | **Concentração por vendedor** | JoomPulse, `buyBoxShopName` | % | **Novo, e é o ganho real desta seção.** Sobre os catálogos da amostra: share do vendedor que detém mais buy-boxes, e quantos vendedores distintos os detêm. | Nenhum catálogo rastreado → "não medida" |
| 7.5 | Plano de ação | IA, sobre 7.1–7.4 e a seção 6 | texto | Três passos: precificação inicial, estratégia no Full, otimização da oferta. **Cita apenas números já calculados** (D-2). | Sem seção 6 (custo não informado) → o passo de precificação diz o que falta, não inventa preço |
| 7.6 | Síntese final | IA | texto | Amarra faturamento (2.6), ponto de equilíbrio e margens (seção 6). | Idem |

### Por que 7.4 é o item mais valioso da seção

A ADR-0137 registra explicitamente a limitação do caminho B: *"N anúncios do mesmo vendedor contam
como N rivais, então a concentração por anúncio **subestima** a real"* — e por isso o caminho B
**nunca declara nicho aberto (🟢)**, só chega a 🟡.

A JoomPulse entrega `buyBoxShopName` por catálogo, que é exatamente o agrupamento por vendedor que
faltava. **7.4 mede o que a 0137 queria medir e não podia.**

**Trava:** 7.4 **não recalibra o veredito** — a D-6 é explícita em que o 🟢/🟡/🔴 continua no Apify
e não muda nesta entrega. 7.4 é informação exibida ao operador, não entrada do semáforo. Mudar isso
exige ADR própria.

---

## Critérios de aceite

Um teste por linha. A seção está implementada quando todos passam.

1. **Modo termo nunca exibe 2.3 nem 2.5.** Entrada: busca por termo com 10 elegíveis. Esperado: 2.4
   presente, 2.3 e 2.5 ausentes do payload — não vazios, ausentes.
2. **`N elegível < 5` suprime 2.3 e 7.3** com a mensagem citando o `N` real. Entrada: 20 anúncios,
   2 elegíveis. Esperado: nenhuma média, nenhuma concentração, e o texto diz "2 de 20".
3. **2.6 rotula o N real.** Entrada: 3 elegíveis. Esperado: rótulo "Top 3", não "Top 5".
4. **Falha de comissão suprime 2.2 e 3.5.** Entrada: `/listing_prices` responde 200 sem
   `sale_fee_details`. Esperado: "não foi possível confirmar a comissão oficial"; **nenhum R$ 0**.
5. **Alíquota não confirmada trava 3.5.** Entrada: organização sem `aliquota_nacional_pct`.
   Esperado: falha explícita, sem cálculo (D-17).
6. **3.2 nunca soma por anúncio.** Entrada: 6 anúncios do mesmo catálogo. Esperado: a demanda do
   catálogo entra **uma vez**.
7. **3.3 é obrigatório sempre que 3.2 existe.** Esperado: payload com 3.2 e sem 3.3 é inválido.
8. **3.4 nunca usa a palavra "venderam".** Teste de string no texto renderizado.
9. **7.1 devolve `não rastreado`**, não `tradicional`, quando o item não volta do ML.
10. **A IA não cita número fora do contrato.** Extrair todo numeral do texto gerado e conferir
    contra os campos calculados; qualquer sobra reprova.
11. **2.9 e o veredito do Sonar não compartilham visual.** Revisão de UI, não teste automatizado —
    mas é critério de aceite.

## O que este contrato deliberadamente não fecha

- **Seções 1, 4, 5 e 6** — já especificadas por Diego e regidas pelas D-9, D-10, D-15, D-16 e D-28.
- **A discretização de `catalogOrderCount1m`** — pergunta aberta do Spike 041; o contrato a
  contorna exibindo faixa, não a resolve.
- **O detalhamento da seção 6** — ela recebeu peso e enquadramento de frete nesta decisão, mas seu
  contrato campo a campo continua regido pelas D-15, D-16 e D-28, não por este documento.
