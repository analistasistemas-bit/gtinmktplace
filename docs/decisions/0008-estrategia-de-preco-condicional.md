# ADR-0008: Estratégia de preço condicional baseada em concorrência

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

A proposta original do Leonardo descrevia 3 estratégias de preço **selecionáveis pelo operador** em cada lote:

1. **Preço próprio** — usa o preço da planilha sem alteração
2. **Competitivo** — menor preço dos concorrentes menos R$ 0,01
3. **Margem mínima** — operador define margem; sistema avisa se violada

Essa abordagem coloca a decisão estratégica em cada lote, o que é trabalhoso para o operador e desconectado da realidade do mercado (a estratégia "certa" depende de existir ou não concorrência).

Diego propôs uma regra automática mais inteligente:

> "Quero trabalhar com preço competitivo caso eu tenha concorrência e preço próprio quando não houver concorrência."

## Decisão

A estratégia de preço **default do MVP** é **condicional baseada na concorrência detectada**:

```
SE concorrência detectada (1 ou mais vendedores no ML para o produto):
   → Estratégia = COMPETITIVO
   → Preço sugerido = (menor preço dos concorrentes) - R$ 0,01

SE não há concorrência:
   → Estratégia = PRÓPRIO
   → Preço sugerido = preço da planilha (sem alteração)
```

A estratégia aplicada é **explicitamente sinalizada na tela de revisão** com badge visual, antes do operador aprovar a publicação. O operador pode sobrescrever inline em qualquer caso (edição manual do preço).

## Alternativas consideradas

- **Opção A: 3 estratégias fixas no nível do lote (proposta original)**
  - Pros: máxima flexibilidade; operador decide caso a caso
  - Cons: trabalho extra a cada lote; operador pode não saber qual escolher; ignora dinâmica do mercado
  - Rejeitada como default — fica como opção de configuração futura se Diego quiser

- **Opção B: Sempre competitivo (assume concorrência)**
  - Pros: sempre tenta vender mais
  - Cons: força queda de preço onde não há concorrência (queima margem sem benefício); pode publicar a R$ 0,00 se a busca falhar
  - Rejeitada

- **Opção C: Sempre preço próprio**
  - Pros: nunca queima margem
  - Cons: perde oportunidades em mercados com concorrência leve (onde uma pequena queda gera muito mais vendas)
  - Rejeitada

- **Opção D: Híbrida condicional (escolhida)**
  - Pros: ajusta automaticamente ao contexto de cada produto; operador foca no que importa (validar) em vez de configurar
  - Cons: precisa de UI clara mostrando QUAL estratégia foi aplicada em cada família (transparência)
  - Aceita

## Regra completa (incluindo edge cases)

```
Input:
  preco_planilha = preço definido pela empresa na planilha
  concorrencia = {
    vendedores: int (0 se não houver),
    preco_min: numeric ou null
  }

Cálculo:
  SE concorrencia.vendedores == 0:
    estrategia = 'proprio'
    preco_sugerido = preco_planilha
    razao = 'sem concorrência detectada'

  SENÃO SE concorrencia.preco_min <= preco_planilha:
    estrategia = 'competitivo'
    preco_sugerido = concorrencia.preco_min - 0.01
    razao = 'concorrência presente — bater menor preço'

  SENÃO (concorrência existe mas o menor preço deles > nosso preço):
    estrategia = 'proprio'
    preco_sugerido = preco_planilha
    razao = 'nosso preço já é mais competitivo que o mercado'
```

**Edge case importante:** se a concorrência existe mas o menor preço deles já é maior que o nosso, **mantém nosso preço** (não tem motivo para baixar gratuitamente). A flag de estratégia exibida ao operador é "PRÓPRIO" com a observação "nosso preço já é mais competitivo".

## Sinalização visual obrigatória na UX

Na tela de revisão, cada família deve mostrar **claramente**:

| Cenário | Badge | Linha de preço |
|---|---|---|
| Sem concorrência | 🔵 **PRÓPRIO** (sem concorrência) | `R$ 5,85 — mantém preço da planilha` |
| Competitivo com queda | 🟠 **COMPETITIVO** | `R$ 5,85 → R$ 5,69` (-2,7% vs concorrência) |
| Nosso preço já é menor | 🔵 **PRÓPRIO** (já competitivo) | `R$ 5,85 — abaixo do menor concorrente (R$ 5,90)` |

Sempre que a estratégia for competitiva, exibir também:
- Quantos vendedores foram encontrados
- Menor preço encontrado
- Diferença percentual

Se o operador editar o preço inline, o sistema marca `preco_editado_pelo_operador = true` no banco e a estratégia muda para `manual` na auditoria.

## Consequências

**Boas:**
- Operador faz menos cliques de configuração — sistema decide a estratégia óbvia
- Quando não há concorrência, não queima margem desnecessariamente
- Quando há concorrência, busca posição de BuyBox automaticamente
- Auditável: campo `estrategia_preco` na tabela `familias` registra o que foi aplicado (`proprio`, `competitivo`, `manual`)

**Tradeoffs aceitos:**
- Operador perde controle granular do "qual estratégia usar" — mitigado pela edição inline
- Depende da qualidade da busca de concorrência no ML (busca por GTIN é confiável; busca por título tem falsos positivos/negativos)

**Modelo de dados (impacto):**

A tabela `familias` precisa do campo `estrategia_preco` como enum:
```
estrategia_preco enum ('proprio', 'competitivo', 'manual')
```

Mais um campo opcional para o motivo:
```
estrategia_motivo text NULL
-- ex: "sem concorrência detectada"
-- ex: "concorrência presente — bater menor preço"
-- ex: "nosso preço já é mais competitivo que o mercado"
-- ex: "preço editado manualmente pelo operador"
```

## Configuração futura (fora do MVP)

A regra acima é o **default**. Em uma versão futura, podemos expor configurações como:
- Margem mínima permitida (impede preço sugerido abaixo de X% sobre custo)
- Estratégia padrão por categoria (linhas competitivas, botões próprio, etc.)
- Margem competitiva variável (em vez de fixar R$ 0,01 abaixo, usar percentual)

Esses são incrementos sem breaking change.

## Como reverter

Trocar de "condicional automática" para "estratégia fixa por lote": adicionar dropdown na tela de upload, salvar em `lotes.estrategia_preco_default`, usar isso em vez da regra automática. Refactor de poucas horas.
