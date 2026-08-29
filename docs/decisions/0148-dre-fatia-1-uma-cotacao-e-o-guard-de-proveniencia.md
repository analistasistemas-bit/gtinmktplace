# ADR-0148 — DRE, fatia 1: uma cotação real e o guard de proveniência

**Status:** Aceito. Recorte escolhido por Diego em 2026-08-29 entre três opções dimensionadas.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0141](0141-analise-publiai-joompulse-radar-e-sonar.md) (**implementa a D-28 e parte da D-5/D-15**),
[0055](0055-imposto-por-origem-nacional-importado.md) (alíquota por origem),
[Spike 040](../spikes/040-revisao-adversarial-adr-0141.md) (levantou os buracos),
[Spike 042](../spikes/042-zero-silencioso-quantas-vezes-aconteceu.md) (mediu que o zero nunca ocorreu)

---

## Contexto

A seção 6 do relatório da Análise PubliAI (a DRE) foi desenhada na ADR-0141 com peças que **não
têm definição em lugar nenhum**:

- **os "5 cenários comerciais" da D-15** nunca foram enumerados;
- **o ROI prometido na D-5** não tem quantidade, capital imobilizado nem horizonte
  (levantado pelo Spike 040 e nunca respondido).

Construir qualquer um dos dois hoje seria inventar regra financeira — proibido pelo CLAUDE.md.

Diego escolheu, entre três recortes dimensionados, a **fatia vertical fina**: a DRE calculada com
**uma cotação real**, no preço do anúncio, com o guard de proveniência da D-28 nascendo junto —
como a própria D-28 exige, para o guard não virar código sem chamador.

## Decisões

### D-1 — A DRE desta fatia calcula um preço só: o do anúncio

Sem cenários, sem sensibilidade, sem ROI. A pergunta respondida é **"este produto dá lucro a este
preço?"**.

**Consequência explícita:** `calcularSensibilidade()` **não é usada** por esta fatia. Ela extrapola
comissão linearmente e congela taxa fixa e frete, então erra ao cruzar os degraus de R$ 79 e R$ 150
(Spike 040). Usá-la aqui seria exibir erro com aparência de precisão. Ela continua servindo a
calculadora existente, que é outra tela e outro contrato.

### D-2 — Os helpers de dinheiro ganham variante com proveniência; nenhum muda de contrato

Três pontos convertem falha em zero hoje:

| Onde | O que colapsa |
|---|---|
| `_shared/ml/frete.ts:buscarFreteVendedor` | `catch` de rede → 0; `!resp.ok` → 0; e dimensões ausentes/inválidas viram `DIMENSOES_DEFAULT` (16×11×6 cm, 300 g) **em silêncio** |
| `_shared/ml/tarifa.ts:tipo` | `sale_fee_amount ?? 0`, `percentage_fee ?? 0`, `fixed_fee ?? 0` |
| `_shared/ml/listing-prices.ts:comissaoDe` | `percentage_fee ?? 0`, `fixed_fee ?? 0` |

**Eles não mudam de contrato.** Servem `process-familia` (publicação, 3 call sites),
`pulse-coletar/processar.ts:594`, `analisar-viabilidade` e `calcular-tarifa-ml`; trocar o `0` por
exceção quebraria a publicação.

Cada um ganha uma **variante** que devolve `{ valor, proveniencia, motivo? }`, e o helper atual
vira **wrapper fino** que colapsa para `.valor`. Só a DRE usa a variante.

> **Cuidado herdado da D-28:** existem **duas funções com o nome `buscarFreteVendedor`** e
> contratos opostos — `_shared/ml/frete.ts` devolve `0` em falha, `_shared/faturamento/io.ts:193`
> devolve `number | null`. **Esta ADR fala exclusivamente da de `_shared/ml/frete.ts`**, e o mesmo
> vale para todo código e teste que ela gera.

### D-3 — Três proveniências, e só `official` habilita a DRE

| Proveniência | Quando | Efeito na DRE |
|---|---|---|
| `official` | o ML respondeu, e as dimensões são as informadas pelo operador | calcula |
| `partial` | o ML respondeu, mas o frete usou o pacote default | **recusa** |
| `estimated` | o ML não respondeu, ou o schema veio sem o campo | **recusa** |

Frete legítimo de **zero** (comprador paga, abaixo do limite da categoria) é `official` — é
resposta, não ausência. Essa distinção é o ponto todo: hoje "comprador paga" e "o ML caiu" são o
mesmo `0`.

### D-4 — Recusar é uma resposta, e ela diz o motivo

Fora de `official` a tela **não calcula** e escreve por que:

> ⚠ DRE indisponível — o Mercado Livre não devolveu a comissão. Não calculamos com estimativa.

Nunca um zero, nunca um traço mudo, nunca um número com asterisco.

### D-5 — O que a fatia não pede, ela declara

`EntradaCalculadoraML` exige `custosFixos`, `custosVariaveis`, `rebate` e `margemAlvoPct`. O
formulário da D-5 pede apenas custo, origem, peso e dimensões — os demais entrariam como **zero
implícito, inflando o lucro** (Spike 040).

Nesta fatia eles são **zero declarado na tela**, não zero silencioso: a DRE diz que não inclui
custos fixos, variáveis nem rebate. O operador vê o que ficou de fora do número.

### D-6 — Imposto sai da origem, e origem não defaulta

Alíquota por origem da ADR-0055, com o padrão que o `montarAliquotaResolver` (`src/lib/custos.ts:137`)
já estabeleceu: **origem não informada ⇒ sem imposto e sem cálculo**, jamais um percentual
presumido. O operador escolhe `NACIONAL` ou `IMPORTADO` explicitamente, como a planilha já exige
(ADR-0107).

### D-7 — Não nasce motor financeiro novo

A DRE usa `calcularSimulacaoML()` (`src/lib/calculadora-ml.ts`), como manda a D-15. O projeto já
tem quatro superfícies calculando margem; **não haverá uma quinta**.

## O que esta fatia NÃO entrega

- **Os 5 cenários comerciais** — sem definição; exigem 5 cotações reais (15 chamadas ao ML) e a
  correção de `calcularSensibilidade()`.
- **O ROI** — sem definição de quantidade, capital ou horizonte.
- **A D-16** (mover peso taxável da seção 3 para a 6).
- **Sensibilidade** de qualquer espécie, pela razão da D-1.

Tudo isso permanece aberto no `TASKS.md`, e a definição dos cenários e do ROI é de Diego.

## Consequências

**Ganhamos** a primeira resposta financeira do relatório, com número oficial ou recusa explícita, e
o guard da D-28 entra com chamador real — como a decisão exigia.

**Perdemos** a comparação entre preços: o operador vê o lucro no preço do anúncio e em nenhum
outro.

**Fica registrado** que a recusa vai ser mais frequente do que o Spike 042 sugere. Ele mediu que o
zero silencioso nunca ocorreu **em produção**, mas media só o `0`; a proveniência `partial` do
pacote default é caminho novo, e no Sonar o produto é do concorrente — dimensões faltando ali é o
caso comum, não a exceção.

## Critérios de aceite

1. Os três helpers atuais mantêm assinatura e comportamento — os chamadores de produção não mudam.
2. Frete zero por "comprador paga" é `official`; frete zero por falha é `estimated`.
3. Dimensões ausentes produzem `partial`, e a DRE recusa.
4. Fault injection cobrindo 400/401/429/500, timeout, schema sem `sale_fee_amount`, `list_cost`
   ausente e `me2=false`: **todo caso produz "DRE indisponível", nunca zero**.
5. A tela declara que custos fixos, variáveis e rebate estão fora do número.
6. Origem não informada não calcula imposto nem DRE.
7. Nenhum texto da seção 6 promete cenário, sensibilidade ou ROI.
8. `pnpm test`, `pnpm lint`, `npx tsc -b --force` e `pnpm docs:links` verdes.
