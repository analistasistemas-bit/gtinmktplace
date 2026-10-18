# Plano — Título de produto em grade (ADR-0184)

Branch `worktree-titulo-grade`, base `99ca113e`. Decisão em [ADR-0184](../../decisions/0184-titulo-de-produto-em-grade.md).

Fixtures reais:
- Short `00000010`: "Short Linho Mauricinho Masculino Bermuda Esporte Fino", masculino, 8 cores.
- Jaqueta `00000140`: "Jaqueta Corta Vento com Detalhes na Manga Feminino Ultra Leve Esportivo", feminino.
- Conjunto `00000043`: "Conjunto Infantil Proteção Solar UV", meninas, 5 estampas.

## T1 — Slots (`_shared/ai/titulo-slots.ts`)

- `TituloSlots` ganha `publico`, `caracteristica` e `caracteristica2`.
- `SLOTS_VAZIOS` passa a ter os 13 slots.
- `ORDEM_LEITURA` e `ORDEM_CORTE` ficam como estão, com os 10 slots, para não mudar nada fora da
  grade.
- Constantes novas:
  - `TODOS_SLOTS = [...ORDEM_LEITURA, 'publico', 'caracteristica', 'caracteristica2']`;
  - `ORDEM_LEITURA_GRADE = ['produto', 'publico', 'marca', 'caracteristica', 'caracteristica2', 'material', 'variacao', 'quantidade']`;
  - `ORDEM_CORTE_GRADE = ['caracteristica2', 'material']`.

## T2 — Schema e coerção (`copywriter.ts`)

- `PROPRIEDADES_SLOTS`, `required` e `coagirSlots` passam a usar `TODOS_SLOTS`.

## T3 — Montagem (`titulo-montar.ts`)

- `ContextoCorte` ganha `grade?: boolean`.
- `render` recebe a ordem de leitura.
- Na grade:
  - a montagem usa `ORDEM_LEITURA_GRADE` (os slots fora dela não renderizam);
  - o corte segue `ORDEM_CORTE_GRADE`;
  - incortáveis: produto, publico, marca, caracteristica e variacao (quando discrimina).
- `presentes` passa a ser derivado da ordem ativa.

## T4 — Guards (`titulo-guards.ts`)

- `DadosFonteTitulo` ganha `grade?: boolean` e `genero?: string | null`.
- `normalizarSlots`, `validarSlotsAncorados` e os loops que percorrem todos os slots passam a
  iterar `TODOS_SLOTS`.
- `removerSlotsRedundantes(slots, ordem = ORDEM_LEITURA)`: a grade passa `ORDEM_LEITURA_GRADE`.
- `textoDuravel` do guard de tipo usa a ordem ativa.
- Funções puras novas:
  - `guardPublicoGrade(slots, fonte)`: lista fechada por gênero, "Plus Size" só com respaldo na
    fonte, fallback por concordância, e `""` sem gênero;
  - `ancorarCaracteristicas`: material e características — todo token (inclusive número e sigla), exceto átonas, precisa estar na fonte;
  - `removerProibidosGrade`: remove por token; "top" é poupado em `produto`.
- Siglas: UV e FPU entram em `titulo-case.ts`.

## T5 — Pipeline (`titulo-pos.ts`)

- `diagnosticarTitulo`:
  - **Fora da grade:** zera os 3 slots novos logo de início e registra isso como `normalizacao`.
  - **Na grade:** depois de `validarSlotsAncorados`, aplica `guardPublicoGrade`,
    `ancorarCaracteristicas` e `removerProibidosGrade`. Em seguida roda
    `removerSlotsRedundantes(…, ORDEM_LEITURA_GRADE)` e monta com `grade: true`.
- `diff` itera `TODOS_SLOTS`.

## T6 — Prompt (`copywriter-prompt.ts`)

- O `SYSTEM` documenta os 3 slots novos: `""` quando o input não disser GRADE.
- Novo bloco "TÍTULO EM GRADE":
  - a estrutura;
  - o público concordando com a peça;
  - característica decisiva: 1 ou 2 itens, da fonte;
  - usar o espaço até perto de 60 com dados da fonte (inverte o T6);
  - sem tamanho e sem cor quando há várias.
- `montarUserPrompt`: na grade, acrescenta a linha `Gênero cadastrado: <genero>`. `InputCopy`
  ganha `genero?: string | null`.

## T7 — Call sites

- `process-familia`: passa `genero: claimed.genero` em `gerarCopy`. Em `diagnosticarTitulo`,
  passa `grade: tamanhosDaGradeCopy(variacoesCopy) !== null` e `genero`.
- `regenerar-copy-familia`: acrescenta `genero` ao select e faz o mesmo.

## Revisão Codex r1 (REVISE) — incorporada
- A1 marca: Diego escolheu (b) — marca só ancorada na fonte (regra atual); sem respaldo, título sem
  marca. Incortável só quando presente. Público/característica ausentes: título sai sem eles (nunca inventa).
- A2 proibidos por token na grade + `envio, garantia, pagamento, frete, gratis`; na grade remove
  `! ? *`, emojis e traços decorativos (` - `, `–`, `—`) dos slots.
- A3 ancoragem na grade para `material`, `caracteristica`, `caracteristica2`: TODO token (inclusive
  número e sigla curta) precisa existir na fonte, exceto átonas.
- A4 Title Case da grade: toda palavra maiúscula (sem exceção de átona); siglas UV/FPU só na grade
  (`tituloCase(texto, primeiro, { grade })`) — não-grade e split byte a byte iguais.
- A5 kit: na grade `quantidade` aceita "Kit N"/"Pacote N" (N>1 ancorado na fonte; `Nun/Npc` vira
  "Kit N") e é incortável.
- B2 cor na grade: cobertura conferida só contra slots renderizados (`produto`, `publico`); sem cor
  única, `variacao` = "" (nunca tamanho).
- B3 repetição: na grade, dedupe por TOKEN em ordem de leitura — slot posterior perde tokens já vistos
  (sem acento/minúsculo); slot que fica sem letra (ex. "100%") ou só com conectivo sai. `produto` nunca perde.
- B4 descartes: loop de corte e `diff` iteram `TODOS_SLOTS`.
- B5 testes: coerção dos 13 slots, 60/61 chars, não-grade idêntico, frase T6 global preservada.

- B1 (r1): UV/FPU e caixa-alta-em-toda-palavra só com `grade` — não-grade e split idênticos.

## Revisão Codex r2 (REVISE) — incorporada
- Dedupe nunca tira token de `produto`, `variacao` (cor) nem `quantidade` (kit): esses tokens entram
  primeiro no conjunto visto, e os demais slots é que perdem a palavra repetida.
- Kit incortável; contrato de ancoragem único (todo token exceto átonas).

## Testes (TDD)

Arquivo novo: `_shared/ai/__tests__/titulo-grade.test.ts`.
- Ordem de leitura da grade.
- Corte: sai caracteristica2, depois material; kit nunca é cortado (obrigatórios > 60 → `TituloInviavelError`).
- Público:
  - "Masculino" aceito;
  - "Feminina" numa família masculino vira o fallback "Masculino" para Short e "Masculina" para
    Jaqueta;
  - meninas → Infantil;
  - sem gênero → nenhum público.
- "Premium" e "Top" removidos, mas "Top" fica em `produto`.
- Característica não ancorada sai.
- Cor única entra; várias cores, nenhuma.
- "Uv" vira "UV".
- Não-grade: os testes de título existentes passam sem alteração.

## Verificação, docs e entrega

- `pnpm preflight`.
- Docs: `edge-functions.md`, `TASKS.md` e o vault `07-IA/Prompts.md`.
- Revisão do diff pelo Codex gpt-6.1-sol (high).
- Deploy das mesmas 6 edges do ADR-0183, só sob "atualizar".
