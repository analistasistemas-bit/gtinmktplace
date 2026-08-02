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

Isso explica os pontos ⭐⭐⭐⭐⭐ da análise: sem dor do comprador (#3), sem gatilhos (#8),
sem SEO (#10), sem perguntas respondidas (#11).

### Causa C — o prompt prescreve literalmente os bullets genéricos

`copywriter-prompt.ts:154` instrui:

> `(4 a 7 bullets. Use características reais do produto + benefícios genéricos do tipo:`
> `"Alta resistência", "Costura firme", "Bom rendimento", "Não desfia facilmente",`
> `"Ótimo custo-benefício".)`

Medição no catálogo real (166 famílias com descrição):

| Bullet listado no prompt | Aparece em |
|---|---|
| "Alta resistência" | **125 de 166** (75%) |
| "Ótimo custo-benefício" | **78 de 166** (47%) |
| "Não desfia facilmente" | 34 |
| "Bom rendimento" | 16 |

Os pontos #5 ("benefícios muito genéricos") e #6 ("não existe diferenciação") da análise
externa são **o prompt se auto-cumprindo**. Não são falha do modelo nem falta de regra:
são os exemplos few-shot do próprio `SYSTEM` voltando na saída, verbatim, em três quartos
do catálogo.

Consequência prática, e é a mais importante deste design: **exemplo few-shot vence regra
declarada.** Escrever R1 e deixar a linha 154 intacta tornaria R1 inerte. Todo exemplo
dentro do `SYSTEM` precisa ser substituído por um exemplo R1-conforme — o prompt novo
ensina pelo exemplo, não só pela regra.

E a linha 154 não é a única armadilha. São **três**, e as outras duas produzem exatamente
a forma que R8 proíbe:

| Linha | Texto atual | Regra que viola |
|---|---|---|
| 146 | `Ideal para [aplicações típicas do tipo de produto — … (confecções, facções, malharias, artesanato…)]` | R8 — manda afirmar sobre *este* produto |
| 154 | `benefícios genéricos do tipo: "Alta resistência", "Costura firme", "Bom rendimento"…` | R1, R1b |
| 174 | `(4 a 6 bullets sobre aplicações típicas. Conhecimento de domínio público é permitido…)` | R8 — sem exigir forma de categoria |

As três precisam ser reescritas. Enumerá-las aqui evita que a regra genérica ("todo
exemplo precisa ser substituído") deixe alguma passar na implementação.

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

Repetir naturalmente, dentro de frases, os termos de busca formados a partir do **nome e
da descrição detalhada recebidos no input, mais o tipo de produto que a própria geração
identificar** — *linha de costura, linha 100% poliéster, cone de linha, linha para
máquina, linha 10000 metros*.

Proibido empilhar palavra-chave fora de frase (keyword stuffing).

> **Nota de implementação:** `tipo_produto_busca` é **saída** do `SCHEMA`, não campo de
> entrada — `montarUserPrompt` não o envia. A regra no `SYSTEM` precisa ser fraseada como
> "o tipo de produto que você identificar", nunca como se fosse um campo disponível no
> input, ou o modelo procura um dado que não existe.

### R6 — Perguntas sobre este produto

Seção nova. Redação normativa:

> A seção "Perguntas sobre este produto" é gerada exclusivamente a partir dos campos
> existentes na fonte. Cada pergunta deve corresponder diretamente a um dado disponível.
> É proibido criar perguntas cuja resposta dependa de informação ausente. Se não houver
> dados suficientes para compor ao menos três perguntas relevantes, a seção deve ser
> omitida.

**O dado gera a pergunta, nunca o inverso.**

Exemplos do mecanismo, atravessando segmentos — **não é lista fechada** (ver R9):

| Campo na fonte | Pergunta destravada | Segmento |
|---|---|---|
| Composição | "Qual a composição?" | qualquer |
| Metragem / comprimento | "Quantos metros possui?" | aviamento |
| Tex / título | "Qual o Tex?" | aviamento |
| Voltagem | "Qual a voltagem?" | eletro / ferramenta |
| Capacidade | "Quantos litros comporta?" | utilidade |
| Conteúdo da embalagem | "O que acompanha o produto?" | qualquer |

Qualquer campo quantitativo ou descritivo presente na fonte destrava sua pergunta pelo
mesmo mecanismo, mesmo que não apareça nesta tabela.

O nome da seção é **"Perguntas sobre este produto"**, não "FAQ" — deixa explícito que são
perguntas respondidas pelas informações disponíveis, e não as perguntas que qualquer
comprador faria.

**Tipo B (compatibilidade) fica dormente.** Perguntas como "serve para máquina
industrial?" exigiriam um campo `Compatibilidade` na planilha, que não existe. Sem esse
campo, a pergunta nunca aparece.

### R7 — Fechamento

O CTA final liga-se ao ganho concreto do produto, derivado da fonte. Frase genérica de
urgência ("garanta já o seu") é insuficiente.

### R9 — Neutralidade de segmento nos exemplos

O `SYSTEM` declara desde a linha 104 atender **qualquer tipo de produto** — aviamentos,
ferramentas, papelaria, decoração, adesivos, utilidades. As regras R1–R8 são neutras por
construção: operam sobre o dado que a fonte fornece, não sobre um vocabulário de segmento.

**O risco está nos exemplos, não nas regras.** Os few-shot de hoje são todos de aviamento
(linha 146: *confecções, facções, malharias*; linha 154: *não desfia facilmente, costura
firme*). Parte dos 75% de "Alta resistência" no catálogo é esse viés. Substituir esses
exemplos por outros exemplos de aviamento replicaria o problema com roupa nova — agora
mais difícil de detectar, porque coberto por regras melhores.

Portanto, todo exemplo que entrar no `SYSTEM` obedece a duas condições:

1. **Cobertura multi-segmento.** Os exemplos de um mesmo bloco atravessam segmentos
   distintos, nunca todos do mesmo ramo.

   | Fonte | Benefício derivado (R1) | Segmento |
   |---|---|---|
   | `10.000 metros` | maior tempo de uso antes da substituição do cone | aviamento |
   | `capacidade 5 litros` | menos reabastecimentos por aplicação | utilidade |
   | `bateria 20V` | compatível com as demais ferramentas da mesma plataforma 20V | ferramenta |
   | `bloco com 100 folhas` | rende 100 registros antes da reposição | papelaria |

2. **Ensinam o mecanismo, não a frase.** O exemplo demonstra a *transformação*
   `dado → benefício derivado`, e o `SYSTEM` diz explicitamente que o padrão é o que se
   reaplica, jamais o texto. Cardápio de frases prontas é o que produziu a Causa C.

O mesmo vale para a tabela de campos de R6: ela ilustra o mecanismo *o dado gera a
pergunta* com campos de segmentos variados, e não é uma lista fechada.

**Limitação declarada:** o catálogo atual é majoritariamente aviamento, então o
experimento (§5) valida bem esse segmento e fracamente os demais. A amostra prioriza
diversidade dentro do que existe, mas a generalidade para segmentos ausentes fica
sustentada pelo desenho das regras, não por evidência medida. Ao entrar um segmento novo
em volume, reavaliar.

### R8 — Alcance das regras

**R1, R1b, R2 e R3 valem para TODAS as seções da descrição**, não apenas intro e
benefícios. Isso inclui explicitamente `🎯 INDICAÇÕES DE USO`.

A restrição aqui é de **forma**, não de existência da seção. Aplicação típica do tipo de
produto continua permitida — é o mesmo carve-out de conhecimento de domínio público
(`SYSTEM` linha 115) do qual R4 depende para abrir pela dor. O que muda é que ela precisa
ser enunciada **como declaração sobre a categoria**, nunca como afirmação sobre este
produto, quando a fonte não a sustenta.

| | Exemplo |
|---|---|
| ❌ Proibido sem fonte | "Indicado para confecções, facções, artesanato e reparos." — afirma sobre *este* produto |
| ✅ Permitido sem fonte | "Fitas de cetim são usadas em lembrancinhas, convites e acabamento de embalagens." — declara sobre a *categoria* |
| ✅ Permitido com fonte | "Indicado para lembrancinhas de casamento e batizado." — quando `descricao_pai` diz isso |

**Coerência com R4:** dor da categoria e aplicação da categoria são a mesma permissão sob
o mesmo carve-out, e recebem a mesma restrição — contexto sobre a categoria é livre,
promessa sobre o produto exige fonte. Um implementador que ler R4 e R8 lado a lado deve
ver uma única regra aplicada a dois lugares.

A seção só é omitida quando não houver **nem** aplicação na fonte **nem** aplicação
conhecida da categoria — na prática, produto cujo tipo o prompt não conseguiu identificar.

**Efeito esperado nos dados reais:** `LINHA DE COST 10.000MT` tem aplicação genérica na
fonte ("para costuras que exigem alta resistência", "para a sua confecção", "tecidos leves
a médios") e mantém a seção com formulação ancorada. As linhas `FITA CETIM BUFALO` têm
aplicações explícitas e detalhadas na fonte e mantêm a seção com formulação direta. Sob a
leitura estrita alternativa — omitir sem fonte — a linha perderia a seção; esta spec
rejeita esse resultado.

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
| `copywriter-prompt.ts` — const `SYSTEM` | reescrita incorporando R1–R8, **inclusive substituição dos exemplos few-shot da linha 154** (Causa C) e do `❓` na whitelist de emojis da linha 199 | nenhum teste trava o `SYSTEM` |
| `copywriter-prompt.ts:46` — `CABECALHOS_APOS_ESPECIFICACOES` | acrescentar `'❓ PERGUNTAS SOBRE ESTE PRODUTO'` | uma linha; preserva os guards |
| `copywriter-prompt.ts` — novo export | `detectarFormulasProibidas(texto): string[]` | função pura |
| `scripts/experimento-copy.ts` — novo | harness A/B/C | offline, não toca produção |

**Intocados nesta entrega:** `montarUserPrompt`, `copywriter.ts`, `SCHEMA`, os guards
`garantirLarguraDescricao` / `garantirMetragemDescricao`, e todas as edge functions.
(`copywriter.ts` só é alterado na fase 2, seção 6, se o experimento a justificar.)

### Por que a whitelist de emojis precisa do `❓`

`SYSTEM:199` termina com: *"Emojis APENAS nos cabeçalhos de seção (🧵 ✅ 📌 🎯 🎨 📦 🚚)"*.
Sem acrescentar `❓` a essa lista, o modelo tende a suprimir o emoji do cabeçalho novo — e
o cabeçalho sem emoji deixa de casar com a string em `CABECALHOS_APOS_ESPECIFICACOES`,
quebrando silenciosamente a injeção dos guards. Duas mudanças de uma linha que dependem
uma da outra.

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

| Cenário | Prompt | Modelo | Origem |
|---|---|---|---|
| **A — baseline de produção** | histórico | `gpt-4o-mini` | **`familias.descricao_ml` já gravada** — não re-executa |
| **B** | novo | `gpt-4o-mini` | geração nova |
| **C** | novo | `gpt-4o` | geração nova |

O cenário A é rotulado **baseline de produção**, não "prompt atual": as 166 descrições
foram geradas ao longo da evolução do prompt, e parte delas é anterior aos guards e às
correções que entraram depois. É a linha de base real que a análise externa criticou —
que é o que interessa — mas não é uma execução limpa do `SYSTEM` de hoje. Para reduzir a
dispersão, a amostra prefere famílias geradas recentemente, dentro dos critérios de
diversidade acima.

**B − A** mede o ganho do prompt. **C − B** mede o ganho do modelo. Rodar os dois juntos
tornaria a causa inatribuível.

**Cenário A não é re-executado.** Assim que `SYSTEM` for editado, o prompt antigo deixa de
existir na árvore e A só seria reproduzível com ginástica de git. A alternativa é melhor:
usar a `descricao_ml` que já está no banco. É a saída real de produção, é mais fiel do que
uma regeração, e custa zero. Filtrar `descricao_editada_pelo_operador = false` para que as
5 edições manuais não contaminem a linha de base.

**Paridade de pós-processamento.** Produção aplica `garantirLarguraDescricao` e
`garantirMetragemDescricao` *depois* de `gerarCopy`. A `descricao_ml` do cenário A já
passou por eles. O harness deve aplicar os mesmos guards às saídas de B e C antes de
comparar — senão a comparação estrutural e a de fidelidade ficam enviesadas contra os
cenários novos.

**Montagem do input.** `InputCopy` exige `variacoes` (`codigo`, `cor`, `preco`) além dos
campos de `familias`. A query da amostra precisa do join com `variacoes`; sem ele a seção
`🎨 CORES` e o `rotuloQuantidade` não são exercitados.

**Prior esperado.** Dada a Causa C (§1), a expectativa é que **B − A seja grande**: os
bullets genéricos são prescritos pelo prompt, não escolhidos pelo modelo. Se C − B vier
pequeno, isso confirma que "genérico" era problema de prompt, não teto do `gpt-4o-mini` —
e o modelo barato fica. Registrar essa expectativa antes de rodar evita ler o resultado a
favor da hipótese mais cara.

Custo estimado: menos de R$ 5 no total (A não consome tokens).

### Critérios de avaliação

Três são automáticos e não dependem de julgamento:

| Critério | Como se mede |
|---|---|
| Ausência de afirmação não comprovada | `detectarFormulasProibidas` — contagem de violações por cenário |
| Fidelidade numérica | todo número, unidade, comparação quantitativa e causalidade numérica da saída presente literalmente na fonte, ou transformação matemática determinística documentada (R1b) — ver redução operacional abaixo |
| Variedade entre anúncios | taxa de bullets idênticos entre os 30 do mesmo cenário |

Dois são subjetivos e ficam para leitura do operador, comparando pares B vs C:

- qualidade da tradução característica → benefício
- fluidez e naturalidade da copy

#### Redução operacional da fidelidade numérica

R1b como está redigida exige interpretação e por isso não é diretamente calculável. O
harness a reduz a três checagens mecânicas:

1. **Extrair pares número+unidade** da saída e da fonte.
2. **Normalizar formato antes de comparar** — `10.000`, `10000` e "10 mil" são o mesmo
   valor. Sem essa normalização a métrica acusa falso positivo contra a própria fonte,
   que escreve `10.000 METROS`.
3. **Sinalizar padrões de comparação** para revisão manual: `%`, `X vezes`, `mais que`,
   `menos que`, `até`, `superior a`. Comparação quantitativa raramente é derivável da
   fonte, e a lista é curta o bastante para o operador conferir uma a uma.

A checagem 3 sinaliza, não reprova — é a fronteira onde a métrica automática entrega para
o julgamento humano.

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
- Testes novos:
  - `detectarFormulasProibidas` (função pura), cobrindo cada fórmula de R3.
  - Guards de largura/metragem com `❓ PERGUNTAS SOBRE ESTE PRODUTO` presente e ausente.
  - **Caso específico:** metragem citada apenas dentro de uma resposta da seção de
    perguntas ("Quantos metros possui? 10.000 metros"). `contemMetragem` considera o dado
    presente e `garantirMetragemDescricao` não injeta o bullet em `📌 ESPECIFICAÇÕES`.
    Esse é o comportamento pré-existente e desejado — a tolerância a menção em prosa
    evita duplicar o dado — mas a seção nova cria um lugar a mais onde ele dispara, e o
    teste tem que fixar isso de propósito, não por acidente.
- Experimento executado, saída comparativa gerada e as três métricas automáticas
  registradas no ADR.
- Documentação atualizada no mesmo commit da entrega:
  `docs/reference/edge-functions.md` (se houver impacto), `docs/decisions/0098-*.md`,
  `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/TASKS.md`.
- Trabalho em worktree, PR draft. Nada é publicado no Mercado Livre sem revisão humana.
