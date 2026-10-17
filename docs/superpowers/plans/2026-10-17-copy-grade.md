# Plano — Copy de produto em grade (ADR-0183)

Branch `worktree-copy-grade`. Decisão em [ADR-0183](../../decisions/0183-copy-de-produto-em-grade.md).
Fixtures reais:
- **Conjunto `00000043`:** `nome = cor = "Estampa 1..5"` × tamanhos 2/4/6/8, com `grade_tamanho='infantil'`.
- **Short `00000010`:** cores × P/M/G/GG, com `grade_tamanho` null.

## T1 — Núcleo puro em `_shared/ai/copywriter-prompt.ts` (TDD)

Teste novo: `_shared/ai/__tests__/copywriter-grade.test.ts`.

1. Ampliar `InputCopy.variacoes[]` com os campos opcionais `tamanho?: string | null` e
   `excluida_da_publicacao?: boolean`.
2. `tamanhosDaGradeCopy(variacoes): string[] | null`
   - Retorna `null` quando `classificarFamilia` (de `_shared/produto/tipos-produto-valores.ts`) não
     é `'grade'`. Mista e simples ficam como estão.
   - Retorna os tamanhos distintos das variações incluídas, na ordem P, M, G, GG e depois a ordem
     numérica.
3. `linhaTamanhos(t)`
   - Formato: `"Tamanhos disponíveis: 2, 4, 6 e 8 anos."`
   - O sufixo " anos" entra só se todos os tamanhos estiverem em `TAMANHOS_INFANTIL`, que é disjunto
     das outras grades.
4. `atualizarSecaoTamanhos(descricao, tamanhos)`
   - Troca só a linha que começa com `Tamanhos disponíveis:`.
   - Sem essa linha, ou com lista vazia, devolve o texto intacto. É idempotente.
5. `posProcessarDescricao` passa a ter um ramo de grade quando `tamanhosDaGradeCopy` não é null. A
   ordem dos passos faz parte da correção:
   1. Remover as seções 🎯 e 📦. Remove o cabeçalho e as linhas seguintes que forem vazias ou
      bullet; a frase de fechamento em prosa sobrevive.
   2. Remover bullets (`✔ • ▪ -`) que contenham medida (`\d+([.,]\d+)?\s*(cm|mm|m|metros?|centímetros?)\b`).
      Sempre a linha inteira, nunca um corte na prosa.
   3. `garantirPerguntaTamanho`. Pergunta fixa: `▪ Como escolher o tamanho? Confira nas fotos do
      anúncio as medidas em centímetros de cada peça.` Entra após o último `▪` da seção ❓, só se a
      seção existir e ainda não tiver a pergunta.
   4. `removerPerguntasIncompletas` e depois `garantirPerguntas`.
   5. `garantirPerguntaTamanho` de novo, para cobrir a seção reconstruída no passo 4.
   6. Pular `garantirLargura/MetragemDescricao` e `garantirConteudoEmbalagem`.
   7. Injetar o bloco 📏 antes do primeiro cabeçalho posterior a 📌, com
      `inserirAntesDoProximoCabecalho`. Se 📏 já existir, não injeta de novo.
   8. Rodar `garantirDisclaimerTonalidade` e `formatarDescricao`.

   O ramo não-grade **fica byte a byte igual** ao atual.
6. Incluir 📏 em `CABECALHOS_APOS_ESPECIFICACOES` e em `EMOJIS_CABECALHO`. Não incluir em
   `CABECALHOS_APOS_PERGUNTAS`, porque 📏 vem antes de ❓.
7. `montarUserPrompt` em grade:
   - A seção 🎨 lista as cores distintas das variações incluídas, sem as indefinidas.
   - Rótulo `ESTAMPAS DISPONÍVEIS` se toda cor casar com `/^estampa\s*\d+$/i`; caso contrário,
     `CORES DISPONÍVEIS`.
   - Acrescentar a linha "Este produto é vendido em GRADE de tamanhos — aplique o bloco PRODUTO EM
     GRADE." Os tamanhos **não** vão para a IA, porque o sistema escreve o guia.
8. Bloco `PRODUTO EM GRADE` no `SYSTEM`:
   - intro com no máximo 2 parágrafos curtos;
   - ✅ com no máximo 6 bullets;
   - 📌 com no máximo 8 bullets, sem medida, sem tamanho e sem cm;
   - não escrever 🎯, 📦 nem 📏;
   - nenhuma pergunta sobre medida ou tamanho (o sistema insere);
   - fechamento com convite para comprar, ancorado em ganho concreto.

   Acrescentar 📏 à whitelist de TOM E ESTILO.

Testes, todos com as fixtures reais:
- Conjunto → 📏 com "2, 4, 6 e 8 anos"; rótulo ESTAMPAS; sem 🎯/📦; pergunta de tamanho presente.
- Short → "P, M, G e GG", sem "anos".
- Bullet com "Comprimento: 40 cm" é removido e não vira pergunta.
- Família simples → saída idêntica à da função antiga (snapshot com a fixture de
  `copywriter-perguntas.test.ts`).
- `atualizarSecaoTamanhos` troca a linha e é idempotente.
- Mista → `null`.

## Revisão Codex r1 (REVISE) — incorporada
1. Pergunta fixa conta no mínimo: `garantirPerguntas(desc, fixas=[PERGUNTA_TAMANHO])` (param opcional,
   default [] → não-grade idêntico) e a fixa é inserida ANTES de `removerPerguntasIncompletas`.
2. Regenerar não empurra para anúncio publicado: comportamento pré-existente (ADR-0160, gate
   `houveMudanca`) para TODA família — fora de escopo; ADR corrigido para não prometer.
3. Trava ampliada: unidades `cm|cms|mm|m|metros?|cent[ií]metros?|mil[ií]metros?`; em grade, bullet de
   📌 com rótulo Tamanho/Medidas/Dimensões/Comprimento/Largura/Altura/Metragem sai inteiro. Prosa:
   só instrução (doutrina do arquivo: nunca editar oração).
4. 📏 normalizado: qualquer 📏 da IA é removido no passo 1; o do sistema é inserido antes do 1º
   cabeçalho que aparece DEPOIS do índice de 📌 (sem 📌: antes do 1º de ❓🎨🚚; sem nenhum: fim antes
   da frase final não importa — anexa ao fim).
5. Constantes globais (`CABECALHOS_APOS_*`) NÃO mudam: 📏 só existe depois de `garantirPerguntas`.
   Só `EMOJIS_CABECALHO` ganha 📏 (inócuo sem 📏 no texto). `preview-kit-virtual`/`titulo-particao`
   não passam tamanho → `null` → caminho antigo (teste cobre).

## Revisão Codex r2 — ponto 4 fechado
📏 tem regra própria: sai do cabeçalho até o PRÓXIMO cabeçalho (prosa inclusa), não só bullets. Limite
aceito (comentário `ponytail:`): 📏 da IA posto por último leva a frase final junto. Teste cobre 📏 em
prosa + idempotência.

## T2 — Call sites

- `process-familia/index.ts`:
  - Acrescentar `tamanho, excluida_da_publicacao` ao select de `variacoes` (linha 127).
  - Passar os dois campos em `variacoesCopy`.
- `regenerar-copy-familia/index.ts`: os mesmos dois campos no embed `variacoes(...)` e no map.
- `_shared/user-products/atualizar-familia-up.ts:464`:
  `atualizarSecaoCores(atualizarSecaoTamanhos(descricao_ml, tamanhosDaGradeCopy(variacoes) ?? []), cores)`.
- O UPDATE legado (`resolverDescricaoUpdate`) fica fora: grade publica só por UP.

## T3 — Verificação

- `pnpm test -- copywriter` e `pnpm test -- atualizar-familia-up`.
- `pnpm preflight:static`.

## T4 — Docs

- `docs/reference/edge-functions.md`, na parte de copy.
- `docs/TASKS.md`.
- Nota em `obsidian-vault/07-IA/Prompts.md`.

## T5 — Entrega

- Revisão do diff pelo Grok.
- Deploy das edges que importam `copywriter-prompt.ts` direta ou indiretamente (lista gerada pelo
  grafo de imports) e conferência de versão.
- Merge só a pedido do Diego.
