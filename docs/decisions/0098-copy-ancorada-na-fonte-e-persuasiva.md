# ADR-0098: Copy de anúncio ancorada na fonte e persuasiva

**Status:** Aceito
**Data:** 2026-08-02
**Decisores:** Diego
**Relacionado:** ADR-0052 (camada 2 de atributos IA-first com fallback — mesmo espírito anti-invenção); ADR-0054 (categoria/título/tipo de produto genérico); ADR-0074 (seleção de modelo de IA por organização); ADR-0030 (reprocessamento de família em erro — copy é a única etapa de IA sem fallback resiliente)

## Contexto

Uma análise externa de conversão avaliou um anúncio gerado pelo PubliAI (`LINHA DE COST
10.000MT PRETO`) e deu nota **7,3/10**, com 12 pontos de melhoria. O diagnóstico resumido:
a descrição informa bem, mas "vende o produto em vez do resultado que o cliente procura",
não conversa com a dor do comprador, não diferencia o produto e faz afirmações difíceis de
comprovar.

A investigação do código e do banco separou esses 12 pontos em **três causas distintas**
que estavam sendo tratadas como uma só.

### Causa A — a IA ecoa a fonte, não inventa

A frase mais criticada pela análise — *"amplamente reconhecida como a melhor do mercado"* —
**está literalmente na `familias.descricao_pai`**, vinda da planilha:

```
LINHA PARA COSTURA 120 TEX 29. CONTÉM: 1 CONE COM 10.000 METROS. COMPOSIÇÃO: 100%
POLIÉSTER. A LINHA DE COSTURA BÚFALO, AMPLAMENTE RECONHECIDA COMO A MELHOR DO MERCADO
POR PROFISSIONAIS QUE NÃO ABREM MÃO DE EXCELÊNCIA EM SUAS PRODUÇÕES. […]
```

A regra anti-alucinação do `SYSTEM` (`copywriter-prompt.ts`, linhas 109–111) foi
**obedecida**. O modelo copiou um superlativo que a fonte forneceu. O prompt nunca teve
regra sobre *ecoar* superlativo da fonte — só sobre *inventar*.

Consequência: reforçar a regra anti-alucinação não resolveria nada, porque ela funciona. É
preciso uma regra nova sobre superlativo que já vem da fonte.

### Causa B — o prompt não pede persuasão

O `SYSTEM` tinha 96 linhas e era quase inteiramente **proibitivo**: o que não inventar, o
que omitir, o que nunca escrever. Não havia nenhuma instrução sobre *como vender*. A IA
cumpria o template e parava.

Isso explica os pontos de maior gravidade da análise: sem dor do comprador, sem gatilhos,
sem termos de busca, sem perguntas respondidas.

### Causa C — o prompt prescreve literalmente os bullets genéricos

Este é o achado central. A linha 154 do `SYSTEM` instruía:

> `(4 a 7 bullets. Use características reais do produto + benefícios genéricos do tipo:`
> `"Alta resistência", "Costura firme", "Bom rendimento", "Não desfia facilmente",`
> `"Ótimo custo-benefício".)`

Medição no catálogo real (166 famílias com descrição gerada):

| Bullet listado no prompt | Aparece em |
|---|---|
| "Alta resistência" | **125 de 166** (75%) |
| "Ótimo custo-benefício" | **78 de 166** (47%) |
| "Não desfia facilmente" | 34 |
| "Bom rendimento" | 16 |

Os pontos "benefícios muito genéricos" e "não existe diferenciação" da análise externa são
**o prompt se auto-cumprindo**. Não são falha do modelo nem falta de regra: são os
exemplos few-shot do próprio `SYSTEM` voltando na saída, verbatim, em três quartos do
catálogo.

E a linha 154 não era a única. A linha 146 mandava escrever `Ideal para [aplicações
típicas do tipo de produto — (confecções, facções, malharias…)]`, que é exatamente a forma
"afirmação sobre este produto" sem fonte que sustente; a linha 174 instruía os bullets de
indicações de uso sem exigir ancoragem.

**Princípio que decorre disso: exemplo few-shot vence regra declarada.** Escrever regras
novas e deixar os exemplos antigos tornaria as regras inertes.

### Contexto operacional

| Fato | Valor |
|---|---|
| Famílias com descrição gerada | 166 |
| Comprimento médio da descrição | 1.414 chars (mín. 55, máx. 2.545) |
| Descrições editadas pelo operador | 5 |
| Modelo de copy | `openai/gpt-4o-mini`, temperatura 0.4 |
| Custo médio de IA por família | ~1,2 centavo |
| Testes que travavam o `SYSTEM` | nenhum |

## Decisão

O `SYSTEM` do copywriter passa a implementar as regras abaixo. Elas são o contrato de
saída da descrição de anúncio.

### R1 — Conversão de Benefícios

Para cada característica técnica da fonte, nesta ordem de preferência:

1. **Usar a característica literal**, quando ela já comunica valor por si.
2. **Traduzir em benefício funcional direto**, desde que seja consequência objetiva do dado.
3. **Nunca** adicionar prova social, autoridade ou intenção de projeto sem respaldo
   explícito na fonte.
4. Sem benefício objetivo derivável, **manter apenas o fato técnico**.

### R1b — Proibição de quantificação e comparação implícita

**Qualquer número, unidade, comparação quantitativa ou causalidade numérica presente na
saída deve estar literalmente na fonte, ou resultar de transformação matemática
determinística e documentada.**

| Fonte | Proibido | Correto |
|---|---|---|
| `10.000 metros` | "menos trocas de cone" (comparado a quê?) | "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone" |
| `Tex 29` | "30% mais resistente" | "Tex 29, espessura indicada para tecidos leves a médios" |

### R2 — Superlativos absolutos

Superlativo vindo da fonte (`melhor do mercado`, `incomparável`, `impecável`, `qualidade
superior`, `extraordinário`) é substituído pelo benefício específico, característica
técnica ou aplicação verificável que o sustenta.

**Não havendo fato verificável, o superlativo é removido — nunca reproduzido nem reescrito
em versão mais fraca.**

### R3 — Lista negra de fórmulas

Proibidas mesmo quando soam inofensivas, porque afirmam sem fonte: `reconhecida por…`,
`preferida pelos profissionais…`, `utilizada por…`, `desenvolvida para…`, `projetada
para…`, `pensada para…`, `a melhor…`, `a mais…`, e `ideal para produção intensa` quando a
fonte não disser.

### R4 — Abertura pela dor da categoria

O parágrafo de abertura parte do problema **genérico do tipo de produto**, sob o carve-out
de conhecimento de domínio público que o prompt já reconhecia.

A dor é **contexto geral da categoria**, nunca promessa. A transição para o produto **não
pode afirmar que ele elimina, reduz ou resolve a dor** sem sustentação explícita na fonte.

| | Exemplo |
|---|---|
| Permitido | "Quem trabalha com costura sabe que quebras de linha e trocas frequentes de cone podem interromper o ritmo do trabalho." |
| Proibido | "Chega de linha arrebentando e máquina parada." |

### R5 — Termos de busca

Repetir naturalmente, dentro de frases, os termos pelos quais o comprador procuraria o
produto — derivados do nome, da descrição detalhada e do tipo de produto que a própria
geração identificar. Proibido empilhar palavra-chave fora de frase.

`tipo_produto_busca` é **saída** do schema, não campo de entrada: a regra é fraseada como
"o tipo de produto que você identificar", nunca como um dado disponível no input.

### R6 — Perguntas sobre este produto

Seção nova, `❓ PERGUNTAS SOBRE ESTE PRODUTO`:

> Gerada exclusivamente a partir dos campos existentes na fonte. Cada pergunta corresponde
> diretamente a um dado disponível. É proibido criar pergunta cuja resposta dependa de
> informação ausente. Não havendo dados para ao menos três perguntas relevantes, a seção é
> omitida.

**O dado gera a pergunta, nunca o inverso.** Exemplos do mecanismo, atravessando
segmentos: composição → "Qual a composição?"; comprimento → "Quantos metros possui?";
voltagem → "Qual a voltagem?"; capacidade → "Quantos litros comporta?".

O nome é "Perguntas sobre este produto", não "FAQ" — deixa explícito que são perguntas
respondidas pelas informações disponíveis, e não as perguntas que qualquer comprador
faria. Perguntas de compatibilidade ("serve para máquina industrial?") exigiriam um campo
`Compatibilidade` na planilha, que não existe; sem ele, nunca aparecem.

### R7 — Fechamento

O fechamento liga-se ao ganho concreto que os dados do produto sustentam. Frase genérica
de urgência é insuficiente.

### R8 — Alcance das regras

**R1, R1b, R2 e R3 valem para todas as seções**, inclusive `🎯 INDICAÇÕES DE USO`.

A restrição é de **forma**, não de existência da seção. Aplicação típica do tipo de
produto continua permitida — mesmo carve-out de que R4 depende — mas precisa ser enunciada
**como declaração sobre a categoria**, nunca como afirmação sobre este produto, quando a
fonte não a sustenta.

| | Exemplo |
|---|---|
| Proibido sem fonte | "Indicado para confecções, facções, artesanato e reparos." — afirma sobre *este* produto |
| Permitido sem fonte | "Fitas de cetim são usadas em lembrancinhas, convites e acabamento de embalagens." — declara sobre a *categoria* |
| Permitido com fonte | "Indicado para lembrancinhas de casamento e batizado." — quando a fonte diz isso |

Dor da categoria e aplicação da categoria são a mesma permissão sob o mesmo carve-out, com
a mesma restrição: contexto sobre a categoria é livre, promessa sobre o produto exige
fonte.

### R9 — Neutralidade de segmento nos exemplos

O `SYSTEM` atende **qualquer tipo de produto**. As regras R1–R8 são neutras por construção
— operam sobre o dado que a fonte fornece, não sobre vocabulário de segmento.

**O risco está nos exemplos.** Os few-shot antigos eram todos de aviamento. Substituí-los
por outros exemplos de aviamento replicaria a Causa C com roupa nova, agora mais difícil
de detectar porque coberta por regras melhores.

Todo exemplo no `SYSTEM` obedece a duas condições:

1. **Cobertura multi-segmento** — os exemplos de um mesmo bloco atravessam ramos distintos:

   | Fonte | Benefício derivado | Segmento |
   |---|---|---|
   | `10.000 metros` | maior tempo de uso antes da substituição do cone | aviamento |
   | `capacidade 5 litros` | menos reabastecimentos por aplicação | utilidade |
   | `bateria 20V` | compartilhada com as demais ferramentas da mesma plataforma | ferramenta |
   | `bloco com 100 folhas` | rende 100 registros antes da reposição | papelaria |

2. **Ensinam o mecanismo, não a frase** — o exemplo demonstra a transformação
   `dado → benefício derivado`, e o `SYSTEM` diz explicitamente que o padrão é o que se
   reaplica. Cardápio de frases prontas foi o que produziu a Causa C.

### Verificação: detectar, nunca editar

`detectarFormulasProibidas(texto: string): string[]` verifica R3 e devolve as fórmulas
encontradas. **Nunca edita o texto.**

Regex é adequada para detectar, contar, sinalizar, bloquear uma saída inteira e alimentar
testes. É inadequada para editar prosa gerada: remover `reconhecida por profissionais` de
*"A Linha Búfalo, reconhecida por profissionais, oferece excelente rendimento."* deixa
pontuação defeituosa e pode alterar o sentido. Além disso a lista tem falsos positivos
legítimos — `desenvolvida para` pode aparecer numa citação do fabricante.

| Camada | Papel |
|---|---|
| prompt | previne |
| detector | verifica |
| teste / experimento | mede |
| runtime (fase 2) | decide aceitar, repetir ou rejeitar |
| nunca | remendar a frase com substituição parcial |

## Consequências

**Muda:**

- O formato de saída da descrição ganha a seção `❓ PERGUNTAS SOBRE ESTE PRODUTO`.
- O símbolo `❓` entra na whitelist de emojis do `SYSTEM` **e** em
  `CABECALHOS_APOS_ESPECIFICACOES`. As duas mudanças dependem uma da outra: sem a primeira
  o modelo suprime o emoji do cabeçalho, e a string deixa de casar com a lista, quebrando
  silenciosamente a injeção dos guards determinísticos.
- Descrições novas ficam ancoradas no dado e sem prova social inventada.

**Não muda:**

- A **ordem das seções**. A própria análise externa dá 8/10 para estrutura, e enterrar
  `📌 ESPECIFICAÇÕES` prejudicaria o comprador em fase de comparação, que escaneia o
  anúncio atrás de composição, metragem, dimensões e conteúdo da embalagem.
- `SCHEMA`, `montarUserPrompt`, `copywriter.ts`, os guards
  `garantirLarguraDescricao`/`garantirMetragemDescricao`, e todas as edge functions.

**Rollout:** o prompt novo vale para o que entrar a partir da entrega. As 166 famílias já
publicadas não são tocadas em lote — a regeração é sob demanda, família a família, pela
edge function `regenerar-copy-familia` que já existe, na ordem de giro que o operador
escolher. As 5 descrições editadas manualmente ficam intactas por construção.

**Fase 2, condicionada ao experimento:** o detector vira validador não destrutivo em
runtime — gera, detecta, aceita se limpo, e havendo violação faz **uma** regeração com
feedback explícito; se a segunda saída ainda violar, registra erro e mantém a saída
anterior ou encaminha para revisão humana. Nunca edita a frase.

## Alternativas rejeitadas

**Omitir `🎯 INDICAÇÕES DE USO` quando a fonte não lista aplicações.** Rejeitada em favor
da formulação de categoria (R8). A alternativa removeria conteúdo útil e honesto de
produtos cuja fonte traz aplicação genérica, e criaria incoerência com R4, que depende do
mesmo carve-out para abrir pela dor.

**Editar prosa por regex em runtime.** Rejeitada: quebra pontuação e concordância, e a
lista negra tem falsos positivos legítimos. O detector verifica; quem decide é o validador
da fase 2.

**Trocar o modelo junto com o prompt.** Rejeitada: tornaria a causa inatribuível. Se
prompt e modelo mudam juntos e o resultado melhora, não se sabe qual dos dois melhorou.
Daí o experimento abaixo.

**Criar o campo `diferencial_comprovado` na planilha agora.** Adiada. Seria o caminho
honesto para prova e diferenciação reais, mas muda o contrato da planilha e vira trabalho
manual por produto. Enquanto não existir, a diferenciação vem exclusivamente da tradução
dos dados técnicos que a fonte já fornece. O mesmo vale para o campo `Compatibilidade`,
que destravaria as perguntas de compatibilidade em R6.

## Experimento A/B/C

O único ponto sem resposta teórica: quanto do texto genérico é limitação do prompt e
quanto é limitação do modelo.

| Cenário | Prompt | Modelo | Origem |
|---|---|---|---|
| **A — baseline de produção** | histórico | `gpt-4o-mini` | `familias.descricao_ml` já gravada, não re-executa |
| **B** | novo | `gpt-4o-mini` | geração nova |
| **C** | novo | `gpt-4o` | geração nova |

**B − A** mede o ganho do prompt; **C − B** mede o ganho do modelo.

O cenário A não é re-executado: assim que o `SYSTEM` é editado, o prompt antigo deixa de
existir na árvore. Usar a `descricao_ml` já gravada é mais fiel (é a saída real de
produção) e custa zero. Filtra-se `descricao_editada_pelo_operador = false` para as 5
edições manuais não contaminarem a linha de base. As saídas de B e C recebem os mesmos
guards que produção aplica depois de `gerarCopy`, senão a comparação ficaria enviesada.

**Previsão registrada antes de rodar:** dada a Causa C, espera-se **B − A grande** — os
bullets genéricos são prescritos pelo prompt, não escolhidos pelo modelo. Um **C − B
pequeno** confirmaria que "genérico" era problema de prompt e não teto do `gpt-4o-mini`,
mantendo o modelo barato. Registrar a expectativa antes evita ler o resultado a favor da
hipótese mais cara.

Métricas automáticas: fórmulas de R3 detectadas, medidas não ancoradas na fonte (com
normalização de separador de milhar — `10.000` e `10000` são a mesma medida, senão a
métrica acusa falso positivo contra a própria fonte) e taxa de bullets repetidos entre os
anúncios da amostra. Qualidade da tradução característica→benefício e fluidez ficam para
avaliação humana comparando pares B vs C.

**Limitação declarada:** o catálogo é majoritariamente aviamento, então o experimento
valida bem esse segmento e fracamente os demais. A generalidade para segmentos ausentes
fica sustentada pelo desenho das regras (R9), não por evidência medida. Ao entrar um
segmento novo em volume, reavaliar.

## Resultado do experimento

Pendente — preenchido após a execução do harness.
