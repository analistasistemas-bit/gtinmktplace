# Copy premium na descrição de anúncio — design

**Data:** 2026-08-02
**Origem:** análise externa de conversão do anúncio `LINHA DE COST 10.000MT PRETO` (nota 7,3/10, 12 pontos de melhoria)
**ADR associado:** ADR-0098 (a escrever antes da implementação)
**Arquivo central:** `supabase/functions/_shared/ai/copywriter-prompt.ts`

---

## 1. Diagnóstico

A análise externa aponta 12 problemas na descrição gerada. Investigação no código e no
banco separa esses 12 pontos em **duas causas distintas** que estavam sendo tratadas como
uma só.

### Causa A — a IA ecoa a fonte, não inventa

A frase mais criticada pela análise — *"amplamente reconhecida como a melhor do mercado"* —
**está literalmente na `familias.descricao_pai`** do produto, vinda da planilha:

```
LINHA PARA COSTURA 120 TEX 29. CONTÉM: 1 CONE COM 10.000 METROS. COMPOSIÇÃO: 100%
POLIÉSTER. A LINHA DE COSTURA BÚFALO, AMPLAMENTE RECONHECIDA COMO A MELHOR DO MERCADO
POR PROFISSIONAIS QUE NÃO ABREM MÃO DE EXCELÊNCIA EM SUAS PRODUÇÕES. […]
```

A regra anti-alucinação do `SYSTEM` (linha 111) foi **obedecida**. O modelo copiou um
superlativo que a fonte forneceu. O prompt nunca teve regra sobre *ecoar* superlativo da
fonte — só sobre *inventar*.

Consequência: o fix não é reforçar a regra anti-alucinação (ela funciona). É criar uma
regra nova de tratamento de superlativo sourced.

### Causa B — o prompt não pede persuasão

O `SYSTEM` atual tem 96 linhas e é quase inteiramente **proibitivo**: o que não inventar,
o que omitir, o que nunca escrever. Não há nenhuma instrução sobre *como vender*. A IA
cumpre o template e para.

Isso explica os pontos ⭐⭐⭐⭐⭐ da análise: sem dor do comprador (#3), sem diferenciação
(#6), sem gatilhos (#8), sem SEO (#10), sem perguntas respondidas (#11).

### O que NÃO é o problema

A própria análise dá **8/10 para estrutura**. Os problemas graves são todos de conteúdo
dentro das seções, não de ordem entre elas. Reordenar seria custo sem retorno — e
enterrar `📌 ESPECIFICAÇÕES` prejudica o comprador em fase de comparação, que escaneia o
anúncio atrás de composição, metragem, dimensões e conteúdo da embalagem.

**Decisão: a ordem das seções é preservada.**

### Contexto factual levantado

| Fato | Valor |
|---|---|
| Famílias com descrição gerada | 166 |
| Comprimento médio da descrição | 1.414 chars (mín. 55, máx. 2.545) |
| Descrições editadas pelo operador | 5 |
| Modelo de copy | `openai/gpt-4o-mini`, temperatura 0.4 |
| Custo médio de IA por família | ~1,2 centavo |
| Testes que travam o `SYSTEM` | nenhum |
| Testes que travam `montarUserPrompt` | `copywriter-prompt.test.ts` (62 linhas) |
| Testes que travam os guards determinísticos | `copywriter-largura.test.ts` (194 linhas) |

O modelo é resolvível por organização via `configuracoes.ai_model_texto` (ADR-0074), o
que permite trocar de modelo sem código novo.

---

## 2. Regras normativas novas

Estas regras entram no `SYSTEM` como texto normativo. Elas são o coração da mudança.

### R1 — Regra de Conversão de Benefícios

Para cada característica técnica presente na fonte, nesta ordem de preferência:

1. **Usar a característica literal**, quando ela já comunica valor por si (`10.000 metros`).
2. **Traduzir em benefício funcional direto**, desde que seja consequência objetiva do
   dado.
3. **Nunca** adicionar prova social, autoridade ou intenção de projeto sem respaldo
   explícito na fonte.
4. Quando não houver benefício objetivo derivável, **manter apenas o fato técnico**.

### R1b — Proibição de quantificação e comparação implícita

Um benefício derivado não pode introduzir comparação com uma base não identificada nem
quantificação ausente da fonte.

| Fonte | Proibido | Correto |
|---|---|---|
| `10.000 metros` | "menos trocas de cone" (comparado a quê?) | "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone" |
| `Tex 29` | "30% mais resistente" | "Tex 29, espessura indicada para tecidos leves a médios" |

Regra formal: **qualquer número, unidade, comparação quantitativa ou causalidade numérica
presente na saída deve estar literalmente na fonte, ou resultar de transformação
matemática determinística e documentada.**

### R2 — Superlativos absolutos

Superlativo absoluto vindo da fonte (`melhor do mercado`, `incomparável`, `impecável`,
`qualidade superior`, `extraordinário`) deve ser substituído por benefício específico,
característica técnica ou aplicação verificável.

**Não havendo fato verificável que o sustente, o superlativo é removido — nunca
reproduzido.**

### R3 — Lista negra de fórmulas

Proibidas mesmo quando soam inofensivas, porque afirmam sem fonte:

- `reconhecida por…` / `preferida pelos profissionais…` / `utilizada por…`
- `desenvolvida para…` / `projetada para…` / `pensada para…`
- `a melhor…` / `a mais…` (superlativo absoluto)
- `ideal para produção intensa` e equivalentes, quando a fonte não disser

### R4 — Abertura pela dor da categoria

O parágrafo 1 abre pelo problema **genérico do tipo de produto** — permitido hoje pelo
carve-out de conhecimento de domínio público (`SYSTEM` linha 115).

A dor é apresentada como **contexto geral da categoria**, nunca como promessa. A transição
para o produto **não pode afirmar que ele elimina, reduz ou resolve a dor** sem sustentação
explícita na fonte.

| | Exemplo |
|---|---|
| ✅ Seguro | "Quem trabalha com costura sabe que quebras de linha e trocas frequentes de cone podem interromper o ritmo do trabalho." |
| ❌ Arriscado | "Chega de linha arrebentando e máquina parada." |

### R5 — SEO

Repetir naturalmente, dentro de frases, os termos de busca formados a partir de
`nome_pai` + `descricao_pai` + `tipo_produto_busca` — *linha de costura, linha 100%
poliéster, cone de linha, linha para máquina, linha 10000 metros*.

Proibido empilhar palavra-chave fora de frase (keyword stuffing).

### R6 — Perguntas sobre este produto

Seção nova. Redação normativa:

> A seção "Perguntas sobre este produto" é gerada exclusivamente a partir dos campos
> existentes na fonte. Cada pergunta deve corresponder diretamente a um dado disponível.
> É proibido criar perguntas cuja resposta dependa de informação ausente. Se não houver
> dados suficientes para compor ao menos três perguntas relevantes, a seção deve ser
> omitida.

**O dado gera a pergunta, nunca o inverso.**

| Campo na fonte | Pergunta destravada |
|---|---|
| Composição | "Qual a composição?" |
| Metragem / comprimento | "Quantos metros possui?" |
| Tex / título | "Qual o Tex?" |
| Largura / diâmetro | "Qual a largura?" |
| Conteúdo da embalagem | "O que acompanha o produto?" |

O nome da seção é **"Perguntas sobre este produto"**, não "FAQ" — deixa explícito que são
perguntas respondidas pelas informações disponíveis, e não as perguntas que qualquer
comprador faria.

**Tipo B (compatibilidade) fica dormente.** Perguntas como "serve para máquina
industrial?" exigiriam um campo `Compatibilidade` na planilha, que não existe. Sem esse
campo, a pergunta nunca aparece.

### R7 — Fechamento

O CTA final liga-se ao ganho concreto do produto, derivado da fonte. Frase genérica de
urgência ("garanta já o seu") é insuficiente.

### R8 — Alcance das regras

**R1, R1b, R2 e R3 valem para TODAS as seções da descrição**, não apenas intro e
benefícios. Isso inclui explicitamente `🎯 INDICAÇÕES DE USO`.

Aplicações genéricas do tipo de produto continuam permitidas *como categoria*. O que é
proibido é convertê-las em afirmação específica sobre este produto quando a fonte não as
sustenta.

| | Exemplo |
|---|---|
| ❌ Proibido sem fonte | "Indicado para confecções, facções, artesanato e reparos." (afirmação sobre o produto) |
| ✅ Permitido | Aplicação típica da categoria, formulada como tal, ou derivada de dado da fonte |

Sem fonte que sustente aplicações, a seção `🎯 INDICAÇÕES DE USO` é omitida — mesmo
padrão de omissão que já governa os bullets de `📌 ESPECIFICAÇÕES`.

---

## 3. Estrutura da descrição

Ordem preservada. Uma seção nova, marcada abaixo.

```
🧵 [CABEÇALHO INTRO em CAPS]        ← R4 (dor da categoria) + R5 (SEO)
✅ BENEFÍCIOS                        ← R1, R1b (derivados de dado, não adjetivos)
📌 ESPECIFICAÇÕES                    ← inalterada
🎯 INDICAÇÕES DE USO                 ← R8 (ancoragem, omitir se sem fonte)
❓ PERGUNTAS SOBRE ESTE PRODUTO       ← NOVA (R6)
🎨 CORES DISPONÍVEIS                 ← inalterada
📦 CONTEÚDO DA EMBALAGEM             ← inalterada
🚚 ENVIO RÁPIDO                      ← inalterada
[fechamento]                         ← R7
```

A posição de `❓ PERGUNTAS SOBRE ESTE PRODUTO` — após indicações de uso, antes de cores —
segue a leitura: o comprador entendeu o produto e o uso, as dúvidas técnicas fecham
objeção, e cores/embalagem/envio são operacionais.

---

## 4. Mudanças em código

| Arquivo | Mudança | Risco |
|---|---|---|
| `copywriter-prompt.ts` — const `SYSTEM` | reescrita incorporando R1–R8 | nenhum teste trava o `SYSTEM` |
| `copywriter-prompt.ts:46` — `CABECALHOS_APOS_ESPECIFICACOES` | acrescentar `'❓ PERGUNTAS SOBRE ESTE PRODUTO'` | uma linha; preserva os guards |
| `copywriter-prompt.ts` — novo export | `detectarFormulasProibidas(texto): string[]` | função pura |
| `scripts/experimento-copy.ts` — novo | harness A/B/C | offline, não toca produção |

**Intocados nesta entrega:** `montarUserPrompt`, `copywriter.ts`, `SCHEMA`, os guards
`garantirLarguraDescricao` / `garantirMetragemDescricao`, e todas as edge functions.
(`copywriter.ts` só é alterado na fase 2, seção 6, se o experimento a justificar.)

### Por que `CABECALHOS_APOS_ESPECIFICACOES` precisa da entrada nova

Esse array (`copywriter-prompt.ts:46`) diz aos guards determinísticos onde a seção
`📌 ESPECIFICAÇÕES` termina, para injetar `• Largura:` / `• Metragem:` no lugar certo
quando a IA os omite. Se a IA pular `🎯 INDICAÇÕES DE USO` mas gerar
`❓ PERGUNTAS SOBRE ESTE PRODUTO`, sem a entrada nova o bullet seria injetado depois da
seção de perguntas.

---

## 5. Experimento A/B/C

O único ponto do design que **não tem resposta teórica**: quanto do texto genérico é
limitação do prompt e quanto é limitação do modelo.

### Seleção da amostra

30 famílias reais do banco, escolhidas por **diversidade**, não por aleatoriedade — a
métrica de variedade entre anúncios (abaixo) só é informativa se a amostra cobrir casos
diferentes. Critérios de cobertura, nesta prioridade:

1. tipos de produto distintos (linha, fita, botão, zíper, papelaria etc.);
2. unidades distintas (metro, kg, unidade, peça) — exercita `rotuloQuantidade`;
3. com e sem variação de cor — exercita a omissão da seção `🎨 CORES`;
4. `descricao_pai` rica em prosa de marketing e `descricao_pai` puramente técnica —
   exercita R2 nos dois extremos;
5. ao menos um produto com largura ou metragem no nome — exercita os guards
   determinísticos junto da seção nova.

A lista final dos 30 códigos é fixada e registrada, para que os três cenários rodem sobre
exatamente o mesmo conjunto.

### Cenários

Três cenários sobre a mesma amostra:

| Cenário | Prompt | Modelo |
|---|---|---|
| **A** | atual | `gpt-4o-mini` |
| **B** | novo | `gpt-4o-mini` |
| **C** | novo | `gpt-4o` |

**B − A** mede o ganho do prompt. **C − B** mede o ganho do modelo. Rodar os dois juntos
tornaria a causa inatribuível.

Custo estimado: menos de R$ 5 no total.

### Critérios de avaliação

Três são automáticos e não dependem de julgamento:

| Critério | Como se mede |
|---|---|
| Ausência de afirmação não comprovada | `detectarFormulasProibidas` — contagem de violações por cenário |
| Fidelidade numérica | todo número, unidade, comparação quantitativa e causalidade numérica da saída presente literalmente na fonte, ou transformação matemática determinística documentada (R1b) |
| Variedade entre anúncios | taxa de bullets idênticos entre os 30 do mesmo cenário |

Dois são subjetivos e ficam para leitura do operador, comparando pares B vs C:

- qualidade da tradução característica → benefício
- fluidez e naturalidade da copy

### Saída

Arquivo comparável lado a lado, um bloco por produto com os três cenários, mais um
sumário com as três métricas automáticas por cenário.

---

## 6. Fase 2 — validador com regeneração controlada

**Condicionada ao resultado do experimento; fora do escopo da primeira entrega.**

A detecção não deve viver só nos testes para sempre. Depois do experimento medir a taxa
real de violação, o detector vira validador **não destrutivo** em runtime:

```
gerar descrição
  → detectarFormulasProibidas
      → sem violação: aceitar
      → com violação: UMA regeneração com feedback explícito
          → segunda saída limpa: aceitar
          → segunda saída ainda viola: registrar erro,
            manter saída anterior ou encaminhar para revisão humana
```

Feedback da regeneração (exemplo):

> Reescreva a descrição removendo as seguintes afirmações não sustentadas pela fonte:
> "reconhecida por", "desenvolvida para". Preserve os fatos técnicos, a estrutura e os
> benefícios objetivamente derivados. Não acrescente novas afirmações.

### Por que nunca editar por regex em runtime

Regex é adequada para detectar, contar, sinalizar, bloquear uma saída inteira, alimentar
testes e comparar cenários. É inadequada para **editar prosa gerada**.

Remover `reconhecida por profissionais` de

> "A Linha Búfalo, reconhecida por profissionais, oferece excelente rendimento."

deixa pontuação defeituosa e pode alterar o sentido do período. Além disso, lista negra
tem falsos positivos: `desenvolvida para` pode aparecer numa citação legítima do
fabricante, e apagá-la cegamente seria transformação editorial não auditável.

Separação de responsabilidades:

| Camada | Papel |
|---|---|
| prompt | previne |
| detector | verifica |
| teste / experimento | mede |
| runtime (fase 2) | decide aceitar, repetir ou rejeitar |
| nunca | remendar a frase com substituição parcial |

---

## 7. Rollout

- O prompt novo vale para **tudo que entrar a partir da entrega**.
- As 166 famílias já publicadas **não são tocadas em lote**. A regeração é sob demanda,
  família a família, pela edge function `regenerar-copy-familia` que já existe.
- A ordem de regeração é escolhida pelo operador por giro de vendas, o que também permite
  medir efeito real em conversão antes de padronizar o catálogo.
- As 5 descrições editadas manualmente ficam intactas por construção — nada é regerado
  sem ação explícita.

---

## 8. Fora de escopo

Registrados no ADR-0098 como evolução futura, não implementados agora:

- **Campo `diferencial_comprovado` / `prova_documentada` na planilha.** Seria o caminho
  honesto para prova e diferenciação reais (pontos 4, 6 e 7 da análise externa). Muda o
  contrato da planilha e vira trabalho manual por produto. Enquanto não existir, a
  diferenciação vem exclusivamente da tradução dos dados técnicos que a fonte já fornece.
- **Campo `Compatibilidade` na planilha.** Destravaria o FAQ Tipo B (R6). Sem ele, as
  perguntas de compatibilidade nunca são geradas.
- **Troca definitiva de modelo.** Decidida pelo experimento, não por este design.

---

## 9. Critérios de conclusão

- `pnpm lint` e `pnpm test` verdes.
- ADR-0098 escrito **antes** da implementação do prompt, registrando a decisão e as
  regras R1–R8. O resultado do experimento (seção 5) é acrescentado ao mesmo ADR depois
  que ele roda — o ADR nasce com a decisão e ganha a evidência.
- Testes novos: `detectarFormulasProibidas` (função pura) e cobertura dos guards de
  largura/metragem com a seção nova presente e ausente.
- Experimento executado, saída comparativa gerada e as três métricas automáticas
  registradas no ADR.
- Documentação atualizada no mesmo commit da entrega:
  `docs/reference/edge-functions.md` (se houver impacto), `docs/decisions/0098-*.md`,
  `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/TASKS.md`.
- Trabalho em worktree, PR draft. Nada é publicado no Mercado Livre sem revisão humana.
