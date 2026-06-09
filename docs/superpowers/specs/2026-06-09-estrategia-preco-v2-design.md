# Spec — Estratégia de preço v2 (PRECO = líquido mínimo + semáforo)

**Data:** 2026-06-09
**Autor:** Diego (brainstorming) + Claude
**Status:** Aprovado no brainstorming; aguardando plano de implementação
**ADR relacionado:** substitui/refina [ADR-0008](../../decisions/0008-estrategia-de-preco-condicional.md) → novo **ADR-0020** a ser escrito antes da implementação

---

## 1. Problema

Hoje (ADR-0008) a coluna `PRECO` da planilha é tratada como **preço de venda**:

- Com concorrência → `menor_concorrente − R$ 0,01`
- Sem concorrência → `PRECO` puro

Diego inverteu a semântica: **`PRECO` passa a ser o líquido mínimo que ele aceita receber _depois_ da comissão do ML** — um piso sobre o que sobra no bolso, não o preço de etiqueta. O sistema precisa **calcular o preço de venda** que respeite esse piso (ou avisar quando o mercado não deixa), e dar um **sinal visual fácil** (semáforo) de se vale a pena publicar cada produto.

## 2. Regra de preço

Computada **por variação**, em `process-familia` (server-side, como hoje). `PRECO = variacoes.preco` (piso de líquido); `CUSTO = variacoes.custo` (custo do produto).

### 2.1 Com concorrente (`vendedores > 0` e `preco_min ≠ null`)

```
preço_venda = arredonda5_proximo( menor_concorrente × 0,95 )
estrategia  = 'competitivo'
```

O preço é puxado pelo mercado: 5% abaixo do menor concorrente. **Não** sobe para garantir o piso — se o líquido resultante ficar abaixo do `PRECO`, o semáforo sinaliza (amarelo/vermelho) e o operador decide na revisão (revisão humana é obrigatória).

### 2.2 Sem concorrente

```
preço_venda = gross_up(PRECO)  → menor múltiplo de R$ 0,05 cujo
              líquido (após comissão ML) ≥ PRECO
estrategia  = 'proprio'
```

**Gross-up:** inverte a comissão. Com `comissão(P) = percentual · P + tarifa_fixa`:

```
P = (PRECO + tarifa_fixa) / (1 − percentual)
```

A comissão vem de `GET /sites/MLB/listing_prices` (mesma fonte do card "Você recebe"), usando o tipo **Clássico** (`gold_special`) como base. A tarifa fixa do ML some acima de ~R$ 29 e o percentual pode variar por faixa, então a inversão **itera 1–2×**: estima `P`, busca a comissão real naquele `P`, recalcula, até estabilizar (mudança < R$ 0,05). Depois aplica `arredonda5_cima`.

### 2.3 Arredondamento (centavos sempre terminando em 0 ou 5)

Múltiplos de R$ 0,05. Duas direções, conforme a intenção:

- `arredonda5_proximo(x)` — múltiplo de 0,05 mais próximo. Usado no **competitivo** (ex.: 28,56 → 28,55; 28,58 → 28,60).
- `arredonda5_cima(x)` — menor múltiplo de 0,05 ≥ x. Usado no **gross-up**, para o líquido nunca cair abaixo do piso por causa do arredondamento.

## 3. Semáforo "vale a pena publicar?"

Cor calculada **por variação**; a cor exibida na **família é o pior caso** entre as variações incluídas na publicação. Detalhe cor-a-cor no card expandido.

```
líquido = preço_venda − comissão_ML(preço_venda)   // Clássico por padrão
```

| Cor | Condição | Leitura |
|---|---|---|
| 🟢 Verde | `líquido ≥ PRECO` | recebe o mínimo desejado ou mais |
| 🟡 Amarelo | `CUSTO ≤ líquido < PRECO` | abaixo do mínimo, mas ainda cobre o custo (sem prejuízo de caixa) |
| 🔴 Vermelho | `líquido < CUSTO` | prejuízo real — vende e perde dinheiro |

**Frete:** acima de ~R$ 19 o ML dá frete grátis cobrado do vendedor, e a API **não expõe** esse custo (documentado no projeto). Tratamento: **badge separado** (ícone 🚚 "frete por sua conta") quando `preço_venda > R$ 19`, **sem alterar a cor** do semáforo. O semáforo reflete só o que dá para medir (comissão), de forma honesta.

**Reatividade:** o semáforo recalcula no front quando o operador edita o preço ou alterna Clássico/Premium — o hook `useTarifaML` já reage a mudança de preço; estendê-lo/parametrizá-lo para o tipo de anúncio.

## 4. Onde computa / arquitetura

- **Server-side em `process-familia`** (igual hoje): persiste `preco_publicacao` por variação e `estrategia_preco`/`estrategia_motivo` na família. Reordenar o pipeline para computar **categoria antes do preço** (o gross-up precisa de `categoria_ml_id` para chamar `listing_prices`). Token já disponível (`getValidAccessToken`), igual à busca de concorrência.
- **Reuso de código:** extrair o fetch de `listing_prices` (hoje dentro de `calcular-tarifa-ml/index.ts`) para `_shared/ml/` para que `process-familia` e a edge compartilhem a mesma fonte de comissão.
- **Front (Revisão):** o semáforo deriva de dados já presentes — `preco_publicacao`, `variacoes.preco` (PRECO), `variacoes.custo` (CUSTO) — mais o líquido vindo do `useTarifaML` (que já chama `calcular-tarifa-ml`). Função pura nova (ex.: `calcularSemaforo(liquido, piso, custo)`).

### Resiliência

- Falha do ML ou `categoria_ml_id` nulo (tipo `outro`): o gross-up não consegue inverter a comissão → cai para `preço_venda = PRECO` como ponto de partida e o semáforo aparece como **"indisponível"** (cinza), nunca travando a revisão. Mantém o padrão resiliente das edges do projeto.

## 5. Escopo e guardas

- **Só CREATE.** UPDATE preserva preço (ADR-0016); a regra v2 não roda em reposição.
- **Respeita `preco_editado_pelo_operador`:** variação editada manualmente não é sobrescrita (igual hoje).
- **5% e thresholds fixos** nesta versão (sem config por lote/categoria — incremento futuro sem breaking change).
- **Preço por variação:** no caso competitivo o valor sai igual para todas as cores naturalmente (mesmo `preco_min` da família); no gross-up cada variação parte do seu próprio piso.

## 6. Modelo de dados

**Nenhuma migration.** Tudo já existe:

- `variacoes.preco_publicacao` — preço de venda sugerido
- `variacoes.preco` — `PRECO` (piso de líquido)
- `variacoes.custo` — `CUSTO`
- `variacoes.preco_editado_pelo_operador` — guarda da edição manual
- `familias.estrategia_preco` (enum `proprio` | `competitivo` | `manual`) e `familias.estrategia_motivo`

O semáforo é cálculo derivado on-demand — não persiste.

## 7. Funções puras (testáveis, TDD)

- `arredondar5Proximo(x)` / `arredondar5Cima(x)` — arredondamento para múltiplo de R$ 0,05.
- `sugerirPrecoVenda(piso, conc, comissaoFn)` — orquestra competitivo vs gross-up; retorna `{ preco, estrategia, motivo }`.
- `grossUp(piso, percentual, fixa)` — inversão algébrica da comissão (a iteração que busca a comissão real fica na camada de IO).
- `calcularSemaforo(liquido, piso, custo)` — retorna `'verde' | 'amarelo' | 'vermelho' | 'indisponivel'`.
- `freteSobConta(preco)` — `preco > 19`.

## 8. Casos de teste-chave

| Cenário | Esperado |
|---|---|
| Concorrente R$ 30,00, piso R$ 20, custo R$ 10 | preço 28,50; líquido > piso → 🟢 |
| Concorrente R$ 12,00, piso R$ 10, custo R$ 8, comissão alta (item barato) | preço 11,40; líquido pode cair < piso → 🟡 ou < custo → 🔴 |
| Concorrente R$ 28,56 (arredonda) | 28,55 (mais próximo) |
| Sem concorrente, piso R$ 20 | gross-up acima de 20 + comissão; líquido ≥ 20 → 🟢 |
| Gross-up que cai em 23,01 | arredonda **pra cima** → 23,05 |
| Variação com `preco_editado_pelo_operador` | não sobrescreve |
| `categoria_ml_id` nulo | preço = piso, semáforo "indisponível" |
| preço de venda R$ 25 (> 19) | badge 🚚 ligado |
| família com 1 cor 🔴 e 2 cores 🟢 | cor da família = 🔴 (pior caso) |

## 9. Fora de escopo (YAGNI)

- Config de % de desconto e thresholds por lote/categoria.
- Estimar custo de frete (API não expõe; fica no badge).
- Aplicar a regra no UPDATE.
- Persistir o semáforo no banco.
