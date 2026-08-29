# ADR-0142 — Vendas mensais estimadas por vendedor

> **Errata 1 (2026-08-29, revisada no mesmo dia pelo
> [Spike 047](../spikes/047-joompulse-comparada-com-a-nossa-metrica.md)):** a API devolve
> `{"period": "historic"}`, o que sugeriu por algumas horas que o total fosse **vitalício**.
> **Medição posterior refutou essa leitura** (0,24x contra 1,41x em 40 vendedores; contas abertas
> entre 2002 e 2010 com totais baixos demais para serem de vida inteira; `RON_VIANA2010`, de 2010,
> marca zero). **A janela de ~365 dias desta ADR se sustenta**, e com ela a explicação original do
> delta negativo.
>
> O que muda de fato: **nenhum rótulo promete a janela do fornecedor**. A tela declara a **nossa**
> janela de observação ("movimento observado em N dias"), correta sob qualquer leitura e
> independente de o ML documentar o campo. Ver ADR-0145 D-4.
>
> A D-1 (a unidade é o vendedor) e a fórmula da D-5 seguem válidas. A **população** sobre a qual
> elas se aplicam foi restringida pela ADR-0145: só vendedor com ≥ 50 vendas históricas.

**Status:** Aceito, **liberado para implementação**. Ver Errata 1 acima. Decisão de Diego em 2026-08-29 (opção C), depois de três candidatas medidas. Substitui a proveniência JoomPulse dos campos 2.6, 3.1, 3.2, 3.3 e 3.4 do relatório.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0141](0141-analise-publiai-joompulse-radar-e-sonar.md) (o relatório — ver Errata 1), [0132](0132-analise-avancada-joompulse.md) (Gateway JoomPulse, **abandonado**), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (o 403 do ML e o pivot por vendedor, Errata de 16/08), [0122](0122-sonar-vendas-estimadas-via-apify.md) (Apify), [0127](0127-sonar-tabela-por-anuncio-e-historico.md) (`sonar_snapshots`), [Spike 043](../spikes/043-como-a-joompulse-estima-vendas.md), [Spike 044](../spikes/044-vendas-mensais-sem-joompulse.md)
**Contrato regido:** [contrato-analise-publiai-secoes-2-3-7.md](../reference/contrato-analise-publiai-secoes-2-3-7.md)

---

## Contexto

O relatório da Análise PubliAI precisa de **faturamento mensal do nicho** (campos 2.6, 2.8, 2.9,
3.1, 3.2). Até 2026-08-29 esse número viria da JoomPulse. Ela saiu: passou a cobrar pelo
`client_id` OAuth em condições recusadas, e sem ele nenhum login é possível.

O problema não é trocar de fornecedor — é que **a API do Mercado Livre não expõe venda de terceiro**.
Medido com token real em 16/08 e registrado na Errata da ADR-0119: `/items/{id}` de anúncio de
terceiro devolve **403 sempre**, e `/sites/MLB/search` também. Não existe fonte oficial.

Três candidatas foram medidas antes desta decisão.

## Medições que destravam a decisão (2026-08-29)

### A JoomPulse não contava vendas — ela dividia

`orderCount1m = orderGmv1m ÷ buyBoxPriceAmount`, **exato em 15/15 linhas** ([Spike 043](../spikes/043-como-a-joompulse-estima-vendas.md)).
Numa amostra de 100 produtos, `orderCount1m` e `catalogOrderCount1m` vieram **idênticos em 100/100**.

Isso reenquadra a perda: não abrimos mão de observação, e sim de uma derivação opaca — que dividia
o faturamento de 30 dias pelo preço **de hoje**, e cujo GMV de origem nunca foi auditável por nós.
Também resolve a suspeita de discretização do [Spike 041](../spikes/041-joompulse-censo-do-radar-e-validacao-da-d4.md) §5:
os valores repetidos eram quocientes coincidentes, não faixas.

### Candidata A — delta do badge "+N vendidos": refutada

Único termo com dois ciclos em `sonar_snapshots` (`abraçadeira nylon`, 19/08 → 27/08, 8 dias):
**delta zero em 7 de 7 anúncios**. Os valores (100, 500, 1.000, 10.000) são degraus que o ML
publica arredondados para baixo; sair de um exige atravessar a faixa inteira.

**Aumentar a cadência não resolve** — o gargalo é a resolução da fonte, não a frequência da amostra.

### Candidata B — velocidade vitalícia (`acumulado ÷ idade`): bloqueada

Precisa da idade do anúncio, que não existe em fonte alguma disponível:

- **Não vem do scrape.** Run real do actor Apify (20 itens, US$ 0,10) devolveu **40 campos**; nenhum
  é data de criação. O único campo temporal, `Tiempo`, é o timestamp do próprio scrape.
- ~~**Não vem da JoomPulse.** `createdAt` não existe no schema de `MlbProductsSortedByProductId`.~~
  > **Errata 2 (2026-08-29, [Spike 047](../spikes/047-joompulse-comparada-com-a-nossa-metrica.md)):**
  > **errado** — o schema expõe `adPublishDate` e `daysInAd`. E é exatamente daí que sai o número
  > dela: `catalogOrderCount1m = catalogSales ÷ daysInAd × 30`, exato em 9 de 9. **A candidata B é
  > o método da JoomPulse**, com o selo (potência de 10) no numerador e a idade no denominador —
  > o que também expõe os dois defeitos dela. A refutação continua válida **para nós**: nenhuma
  > fonte nossa traz a idade do anúncio.
- **Não vem do ID.** Calibrando com `familias` (`ml_item_id` × `publicado_em`), duas faixas
  disjuntas aparecem **no mesmo dia** (11/06: `MLB4765…` e `MLB6943…`). Dentro de cada faixa a
  ordem cresce com a data, mas são **sequências paralelas** — uma curva única erra por ordens de
  grandeza.

### Candidata C — delta de `transactions.total` por vendedor: **validada em produção**

Já aprovada na Errata de 16/08 da ADR-0119 (pivot de Diego), e agora medida com o dado real:

| `pulse_vendedores` | |
|---|---|
| Linhas | 4.237 |
| Vendedores distintos | 495 |
| Dias de série | 14 (16/08 → 29/08) |
| `transactions_total` preenchido | **4.237 / 4.237 (100%)** |

Delta entre o primeiro e o último snapshot de cada vendedor (janela média 9,9 dias):

| Resultado | Vendedores | % |
|---|---|---|
| **Cresceu** | 305 | **64%** |
| Parado | 109 | 23% |
| Negativo | 62 | 13% |

**64% de movimento, contra 0% do badge no mesmo tipo de teste.** Distribuição do delta em ~10 dias:
mediana **7**, p90 **513**.

---

## Decisões

### D-1 — A unidade da venda mensal é o **vendedor**, não o anúncio

Vendas mensais por anúncio **não são reproduzíveis por nenhuma fonte disponível** — nem a JoomPulse
as tinha. O relatório para de prometê-las.

O número passa a ser: *"este vendedor movimentou N unidades no último mês, somando toda a loja"*.

**Consequência obrigatória na UI:** o rótulo diz "vendedor" e diz a janela. Um concorrente com 40
anúncios tem tudo somado, e apresentar isso como venda de um anúncio é defeito de aceite.

### D-2 — O relatório passa a usar duas unidades, cada uma na pergunta que responde

Decisão de Diego (opção C), porque as duas perguntas do operador são diferentes e as duas importam:

| Pergunta do operador | Unidade | Fonte | Rótulo |
|---|---|---|---|
| "Quem está ganhando aqui e a que preço?" | **anúncio** | badge da página (Apify) | `+N vendidos desde a publicação` |
| "Esse nicho comporta minha entrada?" | **vendedor** | `transactions.total` (API do ML) | **Errata 1:** `N/mês estimado — loja inteira, movimento observado em D dias` — declara a nossa janela, não a do ML |

O Top 5 da seção 4 é **ordenado pelo acumulado por anúncio**. O tamanho do nicho (2.6, 2.9, 3.1,
3.2) sai da agregação **por vendedor**. Nunca misturar os dois num mesmo número.

### D-3 — Delta negativo é ausência, nunca zero

**Errata 1 (revisada):** a janela de 365 dias **se sustenta** — a leitura "vitalício" foi refutada pelo Spike 047. Este parágrafo volta a valer, com a ressalva de que o ML **não documenta o campo assim** (`period: "historic"`). `transactions.total` cobre **365 dias móveis**: quando uma venda de um ano atrás sai pela cauda, o
total cai sem nada ter acontecido no presente. Pior caso medido: **−4.875**.

Delta negativo devolve o estado **`sem estimativa no período`** — nunca zero, nunca negativo
exibido. É a regra global 3 do contrato aplicada aqui: ausência tem estado próprio.

Sem esta trava, um concorrente ativo apareceria como "vendeu −4.875".

### D-4 — Menos de dois snapshots é `série insuficiente`, não zero

Vendedor visto uma única vez não tem delta. Estado próprio, distinto de D-3 e distinto de "vendeu
zero" — as três coisas significam coisas diferentes para o operador.

### D-5 — A extrapolação normaliza por dias decorridos

A série tem espaçamento irregular (o coletor não roda em intervalo fixo por vendedor). A conta é:

```
vendas_mes = (t1 - t0) / dias_decorridos * 30
```

Nunca comparar deltas de janelas diferentes sem normalizar.

### D-6 — Agregação do universo usa **mediana**, nunca média

Medido: a média do universo rastreado é **3.553/mês** contra mediana de **~21/mês**. A distribuição
é dominada por outliers, e a média não descreve vendedor nenhum.

Qualquer número que resuma o conjunto (tamanho do nicho, "vendedor típico") usa mediana. A média
**não vai para tela**.

### D-7 — Nenhuma migration

`pulse_vendedores` já existe com `seller_id`, `transactions_total` e `dia`, e o `pulse-coletar` já
a popula diariamente. Isto é **código de leitura**. Criar tabela ou coluna aqui é retrabalho.

### D-8 — Função pura, testável sem banco

O cálculo vive em `supabase/functions/_shared/pulse/`, recebe a série já carregada e devolve o
resultado. Sem I/O dentro da função — o mesmo padrão de `sonar-vendas.ts`.

Forma sugerida (o nome exato fica a critério de quem implementa, o contrato não):

```ts
type SnapshotVendedor = { seller_id: string; transactions_total: number; dia: string };

type VendasMensais =
  | { estado: 'valor'; vendas_mes: number; dias_janela: number }
  | { estado: 'sem_estimativa_no_periodo' }   // D-3
  | { estado: 'serie_insuficiente' };          // D-4

function estimarVendasMensais(serie: SnapshotVendedor[]): Map<string, VendasMensais>
```

### D-9 — A IA não chega perto destes números

Vale a D-2 da ADR-0141 sem exceção: a IA recebe os campos já calculados e escreve apenas o texto
interpretativo. Um numeral no texto que não exista na tabela de campos é defeito, não estilo.

---

## Refutações registradas (não tentar de novo)

1. **Coletar o badge com mais frequência.** O delta é zero por causa do degrau, não do intervalo.
2. **Estimar a idade do anúncio pelo ID do MLB.** Há pelo menos duas sequências paralelas.
3. **Buscar `date_created` de terceiro na API.** 403, medido com e sem token.
4. **Buscar a página do anúncio por HTTP simples.** Devolve `suspicious-traffic-frontend`, mesmo de
   IP residencial. O desbloqueio é o que a Apify vende.
5. **Extensão de navegador como coletor do relatório.** Um content script só lê a página que o
   operador abriu; os 5 concorrentes do Top 5 são descobertos no servidor e ninguém os tem abertos.

---

## Consequências

**Ganhamos** um número exato onde antes havia um quociente opaco: `transactions.total` se move todo
dia, e a janela é conhecida e declarável.

**Perdemos** a granularidade por anúncio na dimensão mensal — que, medido, **nunca existiu de
verdade** em nenhuma fonte, inclusive na que estava sendo paga.

**Fica em aberto:** a atribuição de quanto do movimento de um vendedor vem do anúncio analisado.
Não há dado que resolva isso hoje; o relatório deve declarar a limitação em vez de estimá-la.

## Critérios de aceite

1. Delta negativo devolve `sem_estimativa_no_periodo` — teste com o caso real de −4.875.
2. Vendedor com um único snapshot devolve `serie_insuficiente`.
3. Duas janelas de tamanhos diferentes com a mesma taxa diária produzem o mesmo `vendas_mes`.
4. Nenhuma agregação do conjunto usa média aritmética.
5. `pnpm test` e `pnpm lint` verdes.
6. **Validado contra os dados reais de `pulse_vendedores`**, não apenas mock — regra do projeto para
   feature nova, após o incidente da ADR-0129 (passou mockada, quebrou em produção).
