# Copy premium na descrição de anúncio — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever o prompt de geração de descrição de anúncio para produzir copy ancorada na fonte e persuasiva, eliminando os bullets genéricos que o próprio prompt prescreve hoje.

**Architecture:** Toda a mudança de comportamento vive em uma constante de string (`SYSTEM`) e em duas listas de uma linha no mesmo arquivo. Nenhuma edge function, nenhum schema e nenhum guard determinístico é alterado. Uma função pura nova (`detectarFormulasProibidas`) verifica saídas sem editá-las, e um script offline compara o prompt novo contra a produção atual.

**Tech Stack:** TypeScript, Deno (edge functions), vitest, OpenRouter (`gpt-4o-mini` / `gpt-4o`), Supabase.

**Spec:** `docs/superpowers/specs/2026-08-02-copy-premium-descricao-design.md` — leia antes de começar. As regras são citadas aqui como R1–R9 e estão definidas lá.

## Global Constraints

- **Nunca editar a main.** Todo trabalho na branch `worktree-copy-premium-descricao`.
- **ADR antes da implementação.** Task 1 precede Task 3 obrigatoriamente (regra do CLAUDE.md).
- **`pnpm lint` e `pnpm test` verdes** ao fim de cada task que toca código.
- **Testes rodam com `pnpm vitest run <caminho>`.** O `vitest.config.ts` inclui `./tests/**/*.test.{ts,tsx}` e `./supabase/functions/**/__tests__/**/*.test.ts`. Um arquivo de teste fora desses dois padrões **não é executado**.
- **`copywriter-prompt.ts` é puro** — nenhum import de `Deno`, `jsr:` ou `npm:`. Sua cadeia (`../cor/ordenar.ts`, `../cor/indefinida.ts`, `./unidade.ts`, `./titulo.ts`) também. Isso é o que permite importá-lo em vitest e em script Node. **Não introduza dependência Deno neste arquivo.**
- **`client.ts` NÃO roda em Node** (usa `npm:openai@^4` e `Deno.env`). O script do experimento fala com o OpenRouter por `fetch` direto.
- **Nada é publicado no Mercado Livre** por este plano. O experimento é offline e o rollout é sob demanda.
- Mensagens de commit em português, sem acentos no corpo (padrão do repositório), terminando com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md` | decisão arquitetural + evidência do experimento | criar |
| `supabase/functions/_shared/ai/copywriter-prompt.ts` | prompt (`SYSTEM`), montagem do user prompt, guards, detector | modificar |
| `supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts` | testes do detector | criar |
| `supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts` | guards com a seção nova | modificar |
| `scripts/experimento-copy/metricas.ts` | três métricas automáticas, funções puras | criar |
| `tests/experimento-copy-metricas.test.ts` | testes das métricas | criar |
| `scripts/experimento-copy/index.ts` | harness A/B/C | criar |
| `docs/TASKS.md`, `obsidian-vault/` | registro do trabalho | modificar |

`detectarFormulasProibidas` fica em `copywriter-prompt.ts` (código de produção) porque a fase 2 da spec o promove a validador de runtime. As métricas do experimento ficam em `scripts/` porque só o experimento as usa.

---

## Task 1: ADR-0098

**Files:**
- Create: `docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md`

**Interfaces:**
- Consumes: nada.
- Produces: o número `ADR-0098`, referenciado nos comentários de código das Tasks 2 e 3.

- [ ] **Step 1: Ler o formato do ADR vizinho**

Leia `docs/decisions/0074-selecao-de-modelo-ia-por-organizacao.md` inteiro. Ele é o ADR mais próximo em assunto (seleção de modelo de IA) e define o formato: cabeçalho com `**Status:**`, `**Data:**`, `**Decisores:**`, `**Relacionado:**`, depois `## Contexto`, `## Decisão`, `## Consequências`.

- [ ] **Step 2: Escrever o ADR**

Crie `docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md` com este cabeçalho exato:

```markdown
# ADR-0098: Copy de anúncio ancorada na fonte e persuasiva

**Status:** Aceito
**Data:** 2026-08-02
**Decisores:** Diego
**Relacionado:** ADR-0052 (anti-invenção em atributos por IA); ADR-0054 (tipo de produto genérico no título); ADR-0074 (seleção de modelo de IA por organização); ADR-0030 (copy é a única etapa de IA sem fallback resiliente)
```

O corpo cobre, nesta ordem:

1. **Contexto** — a análise externa de conversão (nota 7,3/10, 12 pontos) e as três causas apuradas na spec. Inclua a evidência quantitativa da Causa C, que é o achado central:

   | Bullet listado no prompt (linha 154) | Aparece em |
   |---|---|
   | "Alta resistência" | 125 de 166 anúncios (75%) |
   | "Ótimo custo-benefício" | 78 de 166 (47%) |
   | "Não desfia facilmente" | 34 |
   | "Bom rendimento" | 16 |

   Registre também que a frase "amplamente reconhecida como a melhor do mercado" está literalmente na `familias.descricao_pai` do produto `LINHA DE COST 10.000MT PRETO` — a IA obedeceu a regra anti-alucinação e ecoou a fonte.

2. **Decisão** — as regras R1 a R9, copiadas da spec com a mesma numeração e a mesma redação normativa. Este é o contrato que o `SYSTEM` implementa.

3. **Consequências** — o que muda (formato de saída da descrição, seção nova), o que não muda (schema, guards, edge functions, ordem das seções), o rollout sob demanda, e a fase 2 condicionada ao experimento.

4. **Alternativas rejeitadas** — omitir `🎯 INDICAÇÕES DE USO` sem fonte (rejeitada em favor da formulação de categoria, R8); editar prosa por regex em runtime (rejeitada, §6 da spec); trocar modelo junto com o prompt (rejeitada, tornaria a causa inatribuível).

5. **Resultado do experimento** — deixe a seção criada com o título `## Resultado do experimento` e uma linha: `Pendente — preenchido na Task 6.` Esta é a única pendência permitida no ADR, e ela é fechada dentro deste plano.

- [ ] **Step 3: Indexar no obsidian-vault**

Abra `obsidian-vault/04-Decisões/Índice de ADRs.md`, localize o padrão das entradas existentes e acrescente a linha do ADR-0098 seguindo exatamente esse padrão. Não invente formato — copie o das linhas vizinhas.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md "obsidian-vault/04-Decisões/Índice de ADRs.md"
git commit -m "docs(adr): ADR-0098 copy de anuncio ancorada na fonte e persuasiva

Registra as tres causas apuradas: a IA ecoa superlativo vindo da
descricao_pai, o SYSTEM e quase todo proibitivo sem instrucao de
persuasao, e o proprio prompt prescreve os bullets genericos na linha
154 (Alta resistencia em 125/166 anuncios).

Define R1-R9 como contrato do prompt novo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: detector de fórmulas proibidas

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts`
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `export function detectarFormulasProibidas(texto: string): string[]` — devolve a lista de fórmulas de R3 encontradas no texto, em ordem de aparição, sem duplicatas. Array vazio quando o texto está limpo. Usada pela Task 5 (harness) e, na fase 2 fora deste plano, pelo validador de runtime.

- [ ] **Step 1: Escrever o teste falhando**

Crie `supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectarFormulasProibidas } from '../copywriter-prompt';

describe('detectarFormulasProibidas — R3', () => {
  it('texto limpo não acusa nada', () => {
    expect(detectarFormulasProibidas('Cone com 10.000 metros. Composição 100% poliéster.')).toEqual([]);
  });

  it('detecta prova social', () => {
    expect(detectarFormulasProibidas('A linha, reconhecida por profissionais, rende bem.'))
      .toContain('reconhecida por');
  });

  it('detecta intenção de projeto', () => {
    expect(detectarFormulasProibidas('Desenvolvida para suportar produção diária.'))
      .toContain('desenvolvida para');
  });

  it('detecta superlativo absoluto', () => {
    expect(detectarFormulasProibidas('Amplamente reconhecida como a melhor do mercado.'))
      .toContain('a melhor');
  });

  it('é insensível a acento e caixa', () => {
    expect(detectarFormulasProibidas('PREFERIDA PELOS PROFISSIONAIS DA COSTURA'))
      .toContain('preferida pelos profissionais');
  });

  it('não duplica a mesma fórmula repetida', () => {
    const r = detectarFormulasProibidas('Desenvolvida para X. Desenvolvida para Y.');
    expect(r.filter((f) => f === 'desenvolvida para')).toHaveLength(1);
  });

  it('acumula fórmulas distintas', () => {
    const r = detectarFormulasProibidas('Reconhecida por artesãos e desenvolvida para durar.');
    expect(r).toHaveLength(2);
  });

  it('não acusa "a mais" dentro de palavra maior (limite de palavra)', () => {
    expect(detectarFormulasProibidas('Produto para camas e roupas.')).toEqual([]);
  });

  it('não acusa quando o texto apenas cita metragem', () => {
    expect(detectarFormulasProibidas('A metragem de 10.000 metros permite maior tempo de uso.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
pnpm vitest run supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts
```

Esperado: FAIL — `detectarFormulasProibidas is not a function` (o export ainda não existe).

- [ ] **Step 3: Implementar**

Em `copywriter-prompt.ts`, logo abaixo da função `validarTipoProdutoBusca` (que termina na linha 40), acrescente. Reaproveite a função `normalizar` que já existe no arquivo (linha 14) — ela remove acento e baixa a caixa, que é exatamente o que R3 precisa:

```ts
/**
 * Fórmulas de R3 (ADR-0098): afirmam prova social, autoridade ou intenção de projeto sem
 * respaldo na fonte. VERIFICA apenas — nunca edita. Remover a expressão por substituição
 * parcial quebraria a pontuação e a concordância da frase em volta, e a lista tem falsos
 * positivos legítimos (uma citação do fabricante pode conter "desenvolvida para").
 * Quem decide o que fazer com o achado é o harness do experimento hoje, e o validador com
 * regeneração controlada na fase 2 — jamais um replace cego.
 */
const FORMULAS_PROIBIDAS = [
  'reconhecida por', 'reconhecido por',
  'preferida pelos profissionais', 'preferido pelos profissionais',
  'utilizada por', 'utilizado por',
  'desenvolvida para', 'desenvolvido para',
  'projetada para', 'projetado para',
  'pensada para', 'pensado para',
  'a melhor', 'o melhor', 'a mais', 'o mais',
  'ideal para producao intensa',
] as const;

export function detectarFormulasProibidas(texto: string): string[] {
  const alvo = normalizar(texto ?? '');
  return FORMULAS_PROIBIDAS.filter((f) => new RegExp(`\\b${f}\\b`).test(alvo));
}
```

Nota sobre o `\b` final: ele é o que faz o teste "não acusa 'a mais' dentro de palavra maior" passar. `normalizar` já devolve o texto sem acento e em minúsculas, então o regex não precisa da flag `i`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
pnpm vitest run supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts
```

Esperado: PASS, 9 testes.

Se o teste "não duplica" falhar, verifique que você usou `.filter()` sobre a lista de fórmulas (cada fórmula é testada uma vez) e não um `matchAll` sobre o texto.

- [ ] **Step 5: Rodar a suíte inteira**

```bash
pnpm test
```

Esperado: verde. Nada existente depende do novo export.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter-prompt.ts supabase/functions/_shared/ai/__tests__/copywriter-formulas.test.ts
git commit -m "feat(copy): detectarFormulasProibidas verifica R3 sem editar prosa

Funcao pura que devolve as formulas de prova social, autoridade e
intencao de projeto encontradas no texto. Verifica apenas -- substituicao
parcial quebraria pontuacao e concordancia, e a lista tem falso positivo
legitimo (citacao do fabricante pode conter \"desenvolvida para\").

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: reescrita do SYSTEM

Esta é a task central. Ela muda o comportamento da IA em produção.

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts` (constante `SYSTEM`, linhas 104–199; array `CABECALHOS_APOS_ESPECIFICACOES`, linhas 46–51)
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts`

**Interfaces:**
- Consumes: `detectarFormulasProibidas` da Task 2 (indiretamente — as fórmulas de R3 aparecem como proibições no texto do `SYSTEM`).
- Produces: `SYSTEM` com a seção `❓ PERGUNTAS SOBRE ESTE PRODUTO` e `CABECALHOS_APOS_ESPECIFICACOES` contendo essa string. A Task 5 importa ambos.

- [ ] **Step 1: Acrescentar a seção nova ao array de cabeçalhos**

Em `copywriter-prompt.ts`, o array das linhas 46–51 hoje é:

```ts
const CABECALHOS_APOS_ESPECIFICACOES = [
  '🎯 INDICAÇÕES DE USO',
  '🎨 CORES DISPONÍVEIS',
  '📦 CONTEÚDO DA EMBALAGEM',
  '🚚 ENVIO RÁPIDO',
];
```

Passe a:

```ts
const CABECALHOS_APOS_ESPECIFICACOES = [
  '🎯 INDICAÇÕES DE USO',
  '❓ PERGUNTAS SOBRE ESTE PRODUTO',
  '🎨 CORES DISPONÍVEIS',
  '📦 CONTEÚDO DA EMBALAGEM',
  '🚚 ENVIO RÁPIDO',
];
```

A ordem dentro do array não afeta o resultado — `inserirAntesDoProximoCabecalho` usa `Math.min` das posições encontradas — mas mantenha a ordem do template para quem for ler.

- [ ] **Step 2: Escrever o teste do guard com a seção nova**

Em `supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts`, leia primeiro os testes existentes para seguir o estilo do arquivo. Acrescente ao final:

```ts
describe('guards × seção "Perguntas sobre este produto" (ADR-0098)', () => {
  it('injeta largura ANTES da seção de perguntas quando ESPECIFICAÇÕES foi pulada', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'Texto.',
      '',
      '❓ PERGUNTAS SOBRE ESTE PRODUTO',
      '',
      '▪ Qual a composição? 100% poliéster.',
    ].join('\n');

    const r = garantirLarguraDescricao(descricao, 'FITA CETIM N.3 16MM', '');

    expect(r).toContain('📌 ESPECIFICAÇÕES');
    expect(r).toContain('• Largura: 16mm');
    expect(r.indexOf('📌 ESPECIFICAÇÕES')).toBeLessThan(r.indexOf('❓ PERGUNTAS SOBRE ESTE PRODUTO'));
  });

  it('metragem citada SÓ na resposta de uma pergunta suprime o bullet — tolerância a prosa é intencional', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Composição: 100% poliéster',
      '',
      '❓ PERGUNTAS SOBRE ESTE PRODUTO',
      '',
      '▪ Quantos metros possui? 10 metros.',
    ].join('\n');

    const r = garantirMetragemDescricao(descricao, 'FITA CETIM N.3 16MM 10MT');

    expect(r).not.toContain('• Metragem:');
    expect(r).toBe(descricao);
  });
});
```

O segundo teste **fixa comportamento pré-existente de propósito**: `contemMetragem` aceita a menção em prosa para não duplicar o dado. A seção nova cria mais um lugar onde isso dispara, e o teste torna a decisão explícita em vez de acidental. Se ele falhar, não "conserte" o guard — releia `contemMetragem` em `titulo.ts` e confirme o que ela aceita.

- [ ] **Step 3: Rodar e confirmar que o primeiro teste falha**

```bash
pnpm vitest run supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts
```

Esperado antes do Step 1: o primeiro teste falha (largura injetada depois da seção de perguntas). Se você já fez o Step 1, ele passa — nesse caso confirme revertendo mentalmente e siga.

Verifique também os nomes dos imports no topo do arquivo de teste: `garantirLarguraDescricao` e `garantirMetragemDescricao` já são importados pelos testes existentes.

- [ ] **Step 4: Substituir a constante SYSTEM**

Substitua integralmente a constante `SYSTEM` (da linha 104 até o fim da template string na linha 199) por:

````ts
export const SYSTEM = `Você é um copywriter de e-commerce que escreve anúncios no Mercado Livre Brasil para QUALQUER tipo de produto (aviamentos, ferramentas, papelaria, decoração, adesivos, utilidades etc.). Adapte o vocabulário ao produto real informado no input — não assuma que é aviamento ou que é vendido por metro. Gere TÍTULO e DESCRIÇÃO para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

Sua descrição precisa fazer duas coisas ao mesmo tempo: convencer quem ainda está decidindo e entregar rápido o dado técnico para quem já está comparando. Tudo o que você escrever nasce da fonte.

═══════════════════════════════════════════════════════
REGRA ABSOLUTA — TUDO NASCE DA FONTE
═══════════════════════════════════════════════════════
NUNCA invente especificações técnicas (marca, modelo, composição, gramatura, metragem, dimensões, certificações, normas ISO/INMETRO). Use APENAS o que está em "Descrição detalhada (fonte de verdade)".

NUNCA escreva prova social, autoridade ou intenção de projeto sem respaldo explícito na fonte. Estas fórmulas são PROIBIDAS mesmo quando soam inofensivas:
- "reconhecida por…", "preferida pelos profissionais…", "utilizada por…"
- "desenvolvida para…", "projetada para…", "pensada para…"
- "a melhor…", "a mais…", ou superlativo absoluto sob qualquer forma
- "ideal para produção intensa" e equivalentes, quando a fonte não disser

Se um dado não foi fornecido, OMITA o bullet correspondente. NÃO escreva "Não informado" nem "N/A". Uma descrição mais curta é melhor que uma com dado inventado.

═══════════════════════════════════════════════════════
SUPERLATIVOS QUE VÊM DA FONTE
═══════════════════════════════════════════════════════
A fonte PODE conter superlativo absoluto ("a melhor do mercado", "qualidade superior", "acabamento impecável", "incomparável", "extraordinário", "esbanja força"). NÃO os reproduza, mesmo estando na fonte.

Substitua cada um pelo fato verificável que o sustenta:
- fonte diz "esbanja força" e também "Tex 29, título 120" → escreva "Tex 29 e título 120, espessura indicada para tecidos leves a médios"
- fonte diz "a melhor do mercado" e nenhum fato sustenta isso → REMOVA a afirmação inteira

Não havendo fato verificável, o superlativo é REMOVIDO — nunca reescrito em versão mais fraca.

═══════════════════════════════════════════════════════
CONVERSÃO DE CARACTERÍSTICA EM BENEFÍCIO
═══════════════════════════════════════════════════════
Para cada característica técnica da fonte, nesta ordem de preferência:

1. Use a característica literal, quando ela já comunica valor sozinha.
2. Traduza em benefício funcional DIRETO, quando for consequência objetiva do dado.
3. Sem benefício objetivo derivável, mantenha apenas o fato técnico.

Dos exemplos abaixo você copia o MECANISMO da transformação, JAMAIS a frase pronta. Eles atravessam segmentos diferentes de propósito — aplique o mesmo raciocínio ao produto que estiver na sua frente:

- "10.000 metros" → "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone"
- "capacidade de 5 litros" → "a capacidade de 5 litros reduz o número de reabastecimentos por aplicação"
- "bateria 20V" → "a bateria de 20V é compartilhada com as demais ferramentas da mesma plataforma"
- "bloco com 100 folhas" → "as 100 folhas rendem 100 registros antes da reposição"

PROIBIDO introduzir número, unidade, percentual, comparação ou causalidade numérica que não esteja na fonte:
- ERRADO: "30% mais resistente" — o percentual não existe na fonte
- ERRADO: "menos trocas de cone" — comparado a quê? a base não está identificada
- CERTO: "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone"

═══════════════════════════════════════════════════════
CATEGORIA versus PRODUTO
═══════════════════════════════════════════════════════
Conhecimento de domínio público sobre o TIPO de produto é permitido, desde que enunciado como declaração sobre a CATEGORIA. O que é proibido é convertê-lo em afirmação sobre ESTE produto quando a fonte não sustenta.

- PERMITIDO sem fonte: "Fitas de cetim são usadas em lembrancinhas, convites e acabamento de embalagens."
- PROIBIDO sem fonte: "Indicado para lembrancinhas, convites e embalagens." — isso afirma sobre este produto
- PERMITIDO com fonte: "Indicado para lembrancinhas de casamento e batizado." — quando a fonte diz isso

A mesma distinção vale para o problema que o comprador enfrenta: descreva o contexto geral da categoria, nunca prometa que este produto elimina, reduz ou resolve esse problema sem a fonte sustentar.

- PERMITIDO: "Quem trabalha com costura sabe que quebras de linha e trocas frequentes de cone podem interromper o ritmo do trabalho."
- PROIBIDO: "Chega de linha arrebentando e máquina parada."

═══════════════════════════════════════════════════════
TERMOS DE BUSCA
═══════════════════════════════════════════════════════
Repita naturalmente, DENTRO de frases, os termos pelos quais o comprador procuraria este produto — formados a partir do nome, da descrição detalhada e do tipo de produto que VOCÊ identificar. Para uma linha de costura preta de 10.000 metros: "linha de costura", "linha 100% poliéster", "cone de linha", "linha para máquina", "linha 10000 metros".

PROIBIDO empilhar palavra-chave fora de frase.

═══════════════════════════════════════════════════════
TIPO DE PRODUTO (campo tipo_produto_busca)
═══════════════════════════════════════════════════════
Preencha "tipo_produto_busca" com um substantivo curto (2-5 palavras) que identifica O QUE o produto FISICAMENTE É (ex.: "barbante de crochê", "fita de cetim", "tesoura de costura", "bainha adesiva"). REGRA ABSOLUTA: só preencha se essa palavra aparecer literalmente no nome OU na descrição — nunca infira o tipo só a partir da marca. Se nenhuma palavra do tipo de produto aparecer no texto-fonte, devolva "" (vazio).

═══════════════════════════════════════════════════════
TÍTULO
═══════════════════════════════════════════════════════
- Até 60 caracteres.
- Formato: \`MARCA MODELO MEDIDA | CARACTERÍSTICA PRINCIPAL | DIFERENCIAL\`
- Exemplo: \`FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE\`
- TUDO EM CAPS.
- Se o NOME do produto não contém uma palavra que identifique o tipo do produto (ex.: "EUROROMA 4/6 CORES 600G" não diz o que é), mas a descrição diz (ex.: "BARBANTE"), esse substantivo é OBRIGATÓRIO como primeiro segmento do título — à frente até da marca. Prioridade de conteúdo quando faltar espaço: TIPO DE PRODUTO > MEDIDA > MARCA > DIFERENCIAL (corte o DIFERENCIAL antes de cortar o tipo).
- SE o nome do produto contém medida ou quantidade (ex.: 10MT, 100MT, 50M, 1KG, 500G), inclua-a OBRIGATORIAMENTE no título logo após o modelo. É dado crucial que diferencia o produto (10MT e 100MT são produtos distintos; 1KG e 500G também) — priorize a medida real sobre adjetivos genéricos de "DIFERENCIAL".
- O segmento "DIFERENCIAL" é OPCIONAL. Só inclua se a palavra/frase couber INTEIRA dentro dos 60 caracteres. NUNCA corte uma palavra no meio nem termine o título com conectivo solto (ex.: "... VERSÁTIL E", "... DE", "... COM"). Prefira um título mais curto e completo (ex.: "... | 100% POLIÉSTER") a um terminado em fragmento.
- NUNCA mencione quantidade de cores nem "Disponível em N cores".
- Use apenas dados do input.

═══════════════════════════════════════════════════════
DESCRIÇÃO — TEMPLATE OBRIGATÓRIO
═══════════════════════════════════════════════════════
Estruture EXATAMENTE nesta ordem, com os emojis indicados como cabeçalhos de seção. Pule uma seção inteira SE não houver dados suficientes para ela.

🧵 [CABEÇALHO DA SEÇÃO INTRO em CAPS — adapte ao tipo de produto]

[Parágrafo 1 — abra pelo contexto real de quem usa este TIPO de produto: o que atrapalha o trabalho dele hoje. Declaração sobre a categoria, nunca promessa sobre este produto.]

[Parágrafo 2 — o que este produto é, com os dados da fonte já convertidos em benefício pela regra acima.]

✅ BENEFÍCIOS

✔ [benefício 1]
✔ [benefício 2]
✔ [benefício 3]
✔ [...]
(4 a 7 bullets. CADA bullet nasce de um dado concreto da fonte, convertido pela regra de conversão. Um bullet que serviria igual para qualquer produto concorrente é um bullet inútil — reescreva-o ancorado no dado ou remova-o.)

📌 ESPECIFICAÇÕES

• Marca: [só se vier no input]
• Modelo: [só se vier no input]
• Composição: [só se vier no input]
• [QUANTIDADE/CONTEÚDO — rotule conforme a NATUREZA do dado: "Peso" para massa (kg/g), "Volume" para líquido (l/ml), "Metragem" para comprimento (m/cm), "Conteúdo" para contagem/embalagem (peças, unidades). Se vier um "Rótulo sugerido para a quantidade" no input, use EXATAMENTE esse rótulo.]
• [outros campos quantitativos que vierem no input, ex.: Jardas, Tex, Largura, Diâmetro, Voltagem, Capacidade]

REGRA CRÍTICA: NUNCA rotule como "Metragem" um dado que não seja comprimento (ex.: "1kg" é Peso, NÃO Metragem). A metragem só aparece se o produto for medido em metros.
NÃO inclua "Cor:" nessa seção — cores vão em seção própria.
OMITA o bullet inteiro se o dado não vier. Nada de "Não informado".

🎯 INDICAÇÕES DE USO

✔ [uso 1]
✔ [uso 2]
✔ [uso 3]
✔ [...]
(4 a 6 bullets. Se a fonte listar aplicações, use-as diretamente. Se não listar, escreva as aplicações típicas da CATEGORIA na forma de declaração sobre a categoria, conforme a regra CATEGORIA versus PRODUTO. Não invente nicho específico.)

❓ PERGUNTAS SOBRE ESTE PRODUTO

▪ [pergunta 1] [resposta 1]
▪ [pergunta 2] [resposta 2]
▪ [pergunta 3] [resposta 3]

REGRA INEGOCIÁVEL: o DADO gera a pergunta, nunca o contrário. Só escreva uma pergunta cuja resposta já esteja na fonte. É PROIBIDO criar pergunta cuja resposta dependa de informação ausente — se a fonte não diz para qual máquina o produto serve, a pergunta sobre máquina NÃO EXISTE.
Exemplos do mecanismo, em segmentos diferentes: composição → "Qual a composição?"; comprimento → "Quantos metros possui?"; voltagem → "Qual a voltagem?"; capacidade → "Quantos litros comporta?"; conteúdo da embalagem → "O que acompanha o produto?".
Não havendo dados para ao menos TRÊS perguntas, OMITA a seção inteira.

🎨 CORES DISPONÍVEIS

- [cor 1]
- [cor 2]
- [...]

REGRA INEGOCIÁVEL: liste APENAS os nomes das cores. NUNCA inclua códigos de produto, preços, estoques ou números ao lado.
CORRETO: "- Preto" / "- Branco"
PROIBIDO: "- Preto (Código: 123) - R$ 5,00" ou "- Branco - R$ 5,85"

📦 CONTEÚDO DA EMBALAGEM

• 1 unidade do produto na cor de sua escolha

🚚 ENVIO RÁPIDO

Produto à pronta entrega com envio rápido e seguro para todo o Brasil.

[Frase final de 1 linha — feche pelo ganho concreto que os dados deste produto sustentam, não por urgência genérica. "Garanta já o seu" é insuficiente.]

═══════════════════════════════════════════════════════
TOM E ESTILO
═══════════════════════════════════════════════════════
Profissional, direto, focado em utilidade. Emojis APENAS nos cabeçalhos de seção (🧵 ✅ 📌 🎯 ❓ 🎨 📦 🚚) e nos bullets (✔ • - ▪). Evite emojis decorativos no meio dos parágrafos.`;
````

Três coisas para conferir depois de colar, porque quebram silenciosamente:

1. O `❓` está na lista de emojis permitidos do bloco TOM E ESTILO. Sem ele o modelo suprime o emoji do cabeçalho, a string deixa de casar com `CABECALHOS_APOS_ESPECIFICACOES` e a injeção dos guards vai para o lugar errado.
2. As crases internas do bloco TÍTULO continuam escapadas (`\``). São necessárias dentro de template string.
3. Nenhum exemplo de benefício ou de aplicação ficou restrito a aviamento (R9).

- [ ] **Step 5: Rodar os testes**

```bash
pnpm vitest run supabase/functions/_shared/ai/__tests__/
```

Esperado: PASS em todos os quatro arquivos. Nenhum teste importa `SYSTEM`, então a reescrita não deveria quebrar nada — se quebrou, você provavelmente danificou a sintaxe da template string.

- [ ] **Step 6: Lint e suíte completa**

```bash
pnpm lint && pnpm test
```

Esperado: ambos verdes.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter-prompt.ts supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts
git commit -m "feat(copy): reescreve o SYSTEM com as regras R1-R9 do ADR-0098

Troca os exemplos few-shot que prescreviam os bullets genericos (linhas
146, 154 e 174 antigas) por exemplos multi-segmento que ensinam o
MECANISMO dado->beneficio em vez de oferecer frase pronta. Essa era a
causa de \"Alta resistencia\" aparecer em 125/166 anuncios.

Acrescenta a secao Perguntas sobre este produto, ancorada em campo, e
regras de superlativo sourced, categoria versus produto, quantificacao
implicita e termos de busca.

O simbolo da secao nova entra na whitelist de emojis E em
CABECALHOS_APOS_ESPECIFICACOES -- as duas mudancas dependem uma da
outra, senao a injecao dos guards vai para o lugar errado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: métricas do experimento

**Files:**
- Create: `scripts/experimento-copy/metricas.ts`
- Test: `tests/experimento-copy-metricas.test.ts`

**Interfaces:**
- Consumes: `detectarFormulasProibidas` da Task 2.
- Produces:
  - `export function extrairMedidas(texto: string): string[]` — pares número+unidade normalizados, sem duplicatas.
  - `export function medidasNaoAncoradas(saida: string, fonte: string): string[]` — medidas da saída ausentes da fonte.
  - `export function padroesDeComparacao(texto: string): string[]` — trechos que sinalizam comparação quantitativa, para revisão manual.
  - `export function taxaBulletsRepetidos(descricoes: string[]): number` — de 0 a 1.

- [ ] **Step 1: Escrever os testes falhando**

Crie `tests/experimento-copy-metricas.test.ts`. Este caminho importa: o `vitest.config.ts` inclui `./tests/**/*.test.ts`, mas **não** inclui `scripts/**`. Um teste dentro de `scripts/` não roda.

```ts
import { describe, it, expect } from 'vitest';
import {
  extrairMedidas,
  medidasNaoAncoradas,
  padroesDeComparacao,
  taxaBulletsRepetidos,
} from '../scripts/experimento-copy/metricas';

describe('extrairMedidas', () => {
  it('extrai número + unidade', () => {
    expect(extrairMedidas('Cone com 10.000 metros e Tex 29.')).toContain('10000metros');
  });

  it('normaliza separador de milhar — 10.000 e 10000 são a mesma medida', () => {
    expect(extrairMedidas('10.000 metros')).toEqual(extrairMedidas('10000 metros'));
  });

  it('normaliza espaço entre número e unidade', () => {
    expect(extrairMedidas('16 mm')).toEqual(extrairMedidas('16mm'));
  });

  it('não duplica a mesma medida repetida', () => {
    expect(extrairMedidas('16mm de largura, fita de 16mm')).toEqual(['16mm']);
  });
});

describe('medidasNaoAncoradas', () => {
  it('não acusa quando a saída só repete medidas da fonte, em formato diferente', () => {
    expect(medidasNaoAncoradas('Rolo de 10000 metros.', 'CONTÉM 10.000 METROS.')).toEqual([]);
  });

  it('acusa medida que a saída inventou', () => {
    expect(medidasNaoAncoradas('Resiste a 200 graus.', 'CONTÉM 10.000 METROS.'))
      .toContain('200graus');
  });
});

describe('padroesDeComparacao', () => {
  it('sinaliza percentual', () => {
    expect(padroesDeComparacao('30% mais resistente')).not.toHaveLength(0);
  });

  it('sinaliza comparação sem base', () => {
    expect(padroesDeComparacao('rende mais que os concorrentes')).not.toHaveLength(0);
  });

  it('não sinaliza texto ancorado sem comparação', () => {
    expect(padroesDeComparacao('A metragem de 10.000 metros permite maior tempo de uso.')).toEqual([]);
  });
});

describe('taxaBulletsRepetidos', () => {
  it('0 quando todos os bullets são distintos', () => {
    expect(taxaBulletsRepetidos(['✔ Rende 100 folhas', '✔ Bateria 20V'])).toBe(0);
  });

  it('alta quando o mesmo bullet se repete entre anúncios', () => {
    const r = taxaBulletsRepetidos([
      '✔ Alta resistência\n✔ Único A',
      '✔ Alta resistência\n✔ Único B',
      '✔ Alta resistência\n✔ Único C',
    ]);
    expect(r).toBeGreaterThan(0.4);
  });

  it('lista vazia devolve 0 em vez de dividir por zero', () => {
    expect(taxaBulletsRepetidos([])).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm vitest run tests/experimento-copy-metricas.test.ts
```

Esperado: FAIL — módulo `../scripts/experimento-copy/metricas` não existe.

- [ ] **Step 3: Implementar**

Crie `scripts/experimento-copy/metricas.ts`:

```ts
/**
 * Métricas automáticas do experimento A/B/C (ADR-0098). Funções puras, sem I/O.
 *
 * Vivem em scripts/ e não em supabase/functions/ porque só o experimento as usa —
 * o código de produção não depende delas. O detector de fórmulas de R3, esse sim,
 * mora em copywriter-prompt.ts porque a fase 2 o promove a validador de runtime.
 */

const UNIDADES = 'mm|cm|m|metros|metro|kg|g|gramas|l|ml|litros|litro|un|unidades|pecas|folhas|v|w|tex|graus';

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pares número+unidade normalizados. "10.000 metros", "10000 metros" e "10000metros"
 * colapsam na mesma chave — sem isso a métrica acusaria falso positivo contra a
 * própria fonte, que escreve "10.000 METROS" com separador de milhar.
 */
export function extrairMedidas(texto: string): string[] {
  const alvo = normalizar(texto ?? '');
  const re = new RegExp(`(\\d[\\d.,]*)\\s*(${UNIDADES})\\b`, 'g');
  const achados = new Set<string>();
  for (const [, num, uni] of alvo.matchAll(re)) {
    // separador de milhar cai; vírgula decimal vira ponto
    const limpo = num.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').replace(/\.0+$/, '');
    achados.add(`${limpo}${uni}`);
  }
  return [...achados];
}

/** Medidas presentes na saída e ausentes da fonte — candidatas a invenção (R1b). */
export function medidasNaoAncoradas(saida: string, fonte: string): string[] {
  const daFonte = new Set(extrairMedidas(fonte));
  return extrairMedidas(saida).filter((m) => !daFonte.has(m));
}

/**
 * Sinaliza — não reprova. Comparação quantitativa raramente é derivável da fonte,
 * mas pode ser legítima; a lista é curta o bastante para o operador conferir uma a uma.
 */
export function padroesDeComparacao(texto: string): string[] {
  const alvo = normalizar(texto ?? '');
  const padroes = [
    /\d+\s*%/g,
    /\b\d+\s*vezes\b/g,
    /\bmais (?:que|do que)\b/g,
    /\bmenos (?:que|do que)\b/g,
    /\bsuperior a\b/g,
    /\binferior a\b/g,
  ];
  return padroes.flatMap((p) => [...alvo.matchAll(p)].map((m) => m[0]));
}

function bullets(descricao: string): string[] {
  return descricao
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[✔•\-▪]/.test(l))
    .map((l) => normalizar(l.replace(/^[✔•\-▪]\s*/, '')));
}

/**
 * Fração dos bullets do conjunto que aparecem em mais de um anúncio. Alto = os anúncios
 * se parecem, que é exatamente o sintoma medido no catálogo atual ("Alta resistência"
 * em 75% das descrições).
 */
export function taxaBulletsRepetidos(descricoes: string[]): number {
  const contagem = new Map<string, number>();
  for (const d of descricoes) {
    for (const b of new Set(bullets(d))) contagem.set(b, (contagem.get(b) ?? 0) + 1);
  }
  const total = [...contagem.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const repetidos = [...contagem.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  return repetidos / total;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm vitest run tests/experimento-copy-metricas.test.ts
```

Esperado: PASS, 12 testes.

Se `extrairMedidas` falhar no caso `10.000` vs `10000`, confira o lookahead `(?=\d{3}\b)` — ele é o que distingue separador de milhar de vírgula decimal.

- [ ] **Step 5: Suíte completa e commit**

```bash
pnpm lint && pnpm test
git add scripts/experimento-copy/metricas.ts tests/experimento-copy-metricas.test.ts
git commit -m "feat(exp): metricas automaticas do experimento de copy

Tres funcoes puras: medidas nao ancoradas na fonte (com normalizacao de
separador de milhar, senao acusa falso positivo contra a propria fonte),
padroes de comparacao para revisao manual, e taxa de bullets repetidos
entre anuncios.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: harness do experimento

**Files:**
- Create: `scripts/experimento-copy/index.ts`

**Interfaces:**
- Consumes: `SYSTEM`, `montarUserPrompt`, `garantirLarguraDescricao`, `garantirMetragemDescricao`, `detectarFormulasProibidas` de `copywriter-prompt.ts`; tudo de `metricas.ts`.
- Produces: `scripts/experimento-copy/resultado.md` (comparação lado a lado) e `resultado.json` (métricas).

- [ ] **Step 1: Ler o script de referência**

Leia `scripts/verificar-isolamento-tenant.ts`. Ele define o padrão de script standalone do projeto: cabeçalho JSDoc com a linha de uso, credenciais por variável de ambiente, `main()` no fim. Siga esse padrão.

- [ ] **Step 2: Escrever o harness**

Crie `scripts/experimento-copy/index.ts`:

```ts
/**
 * Experimento A/B/C de copy (ADR-0098).
 *
 *   A = baseline de produção  → familias.descricao_ml já gravada, NÃO re-executa
 *   B = prompt novo           → gpt-4o-mini
 *   C = prompt novo           → gpt-4o
 *
 * B−A mede o ganho do prompt; C−B mede o ganho do modelo. Rodar os dois juntos
 * tornaria a causa inatribuível.
 *
 * NÃO importa ../ai/client.ts: aquele módulo usa `npm:openai@^4` e `Deno.env`, que não
 * resolvem em Node. Fala com o OpenRouter por fetch direto.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... \
 *     pnpm tsx scripts/experimento-copy/index.ts
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SYSTEM,
  montarUserPrompt,
  garantirLarguraDescricao,
  garantirMetragemDescricao,
  detectarFormulasProibidas,
  type InputCopy,
} from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import {
  medidasNaoAncoradas,
  padroesDeComparacao,
  taxaBulletsRepetidos,
} from './metricas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TAMANHO_AMOSTRA = 30;

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Familia = {
  id: string;
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string | null;
  descricao_ml: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
};

/**
 * Amostra por diversidade, não aleatória: a métrica de variedade só é informativa se os
 * 30 cobrirem casos diferentes. Prioriza famílias recentes porque o cenário A é a
 * descrição histórica de produção, gerada ao longo da evolução do prompt.
 */
async function amostra(): Promise<Familia[]> {
  const { data, error } = await db
    .from('familias')
    .select('id, codigo_pai, nome_pai, descricao_pai, unidade, descricao_ml, variacoes(codigo, cor, preco)')
    .not('descricao_ml', 'is', null)
    .eq('descricao_editada_pelo_operador', false)
    .order('criado_em', { ascending: false })
    .limit(120);
  if (error) throw new Error(`amostra: ${error.message}`);

  const vistos = new Set<string>();
  const escolhidas: Familia[] = [];
  for (const f of (data ?? []) as Familia[]) {
    // primeira palavra do nome como proxy grosseira de tipo de produto
    const tipo = (f.nome_pai ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    const chave = `${tipo}|${f.unidade ?? ''}|${f.variacoes.some((v) => v.cor) ? 'cor' : 'sem'}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escolhidas.push(f);
    if (escolhidas.length === TAMANHO_AMOSTRA) break;
  }
  // completa com o que sobrou, se a diversidade não rendeu 30
  for (const f of (data ?? []) as Familia[]) {
    if (escolhidas.length === TAMANHO_AMOSTRA) break;
    if (!escolhidas.includes(f)) escolhidas.push(f);
  }
  return escolhidas;
}

async function gerar(input: InputCopy, modelo: string): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'copy_anuncio',
          schema: {
            type: 'object',
            properties: {
              titulo: { type: 'string' },
              descricao: { type: 'string' },
              tipo_produto_busca: { type: 'string' },
            },
            required: ['titulo', 'descricao', 'tipo_produto_busca'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  const json = await r.json();
  return JSON.parse(json.choices[0].message.content).descricao as string;
}

/**
 * Paridade com produção: process-familia aplica os dois guards DEPOIS de gerarCopy, e a
 * descricao_ml do cenário A já passou por eles. Sem aplicar aqui, B e C seriam comparados
 * crus contra um A pós-processado.
 */
function comoEmProducao(descricao: string, f: Familia): string {
  return garantirMetragemDescricao(
    garantirLarguraDescricao(descricao, f.nome_pai, f.descricao_pai),
    f.nome_pai,
  );
}

function metricas(descricoes: string[], fontes: string[]) {
  return {
    formulas_proibidas: descricoes.reduce((n, d) => n + detectarFormulasProibidas(d).length, 0),
    medidas_nao_ancoradas: descricoes.reduce((n, d, i) => n + medidasNaoAncoradas(d, fontes[i]).length, 0),
    comparacoes_a_revisar: descricoes.reduce((n, d) => n + padroesDeComparacao(d).length, 0),
    taxa_bullets_repetidos: Number(taxaBulletsRepetidos(descricoes).toFixed(3)),
  };
}

async function main() {
  const familias = await amostra();
  console.log(`Amostra: ${familias.length} famílias`);

  const linhas: string[] = ['# Experimento de copy — A/B/C\n'];
  const saidas = { A: [] as string[], B: [] as string[], C: [] as string[] };
  const fontes: string[] = [];

  for (const [i, f] of familias.entries()) {
    const input: InputCopy = {
      nome: f.nome_pai,
      descricao_detalhado: f.descricao_pai,
      variacoes: f.variacoes,
      unidade: f.unidade,
    };
    const fonte = `${f.nome_pai}\n${f.descricao_pai}`;
    fontes.push(fonte);

    const a = f.descricao_ml;
    const b = comoEmProducao(await gerar(input, 'openai/gpt-4o-mini'), f);
    const c = comoEmProducao(await gerar(input, 'openai/gpt-4o'), f);

    saidas.A.push(a); saidas.B.push(b); saidas.C.push(c);

    linhas.push(
      `\n---\n\n## ${i + 1}. ${f.codigo_pai} — ${f.nome_pai}\n`,
      `### Fonte\n\n\`\`\`\n${f.descricao_pai}\n\`\`\`\n`,
      `### A — baseline de produção\n\n\`\`\`\n${a}\n\`\`\`\n`,
      `### B — prompt novo, gpt-4o-mini\n\n\`\`\`\n${b}\n\`\`\`\n`,
      `### C — prompt novo, gpt-4o\n\n\`\`\`\n${c}\n\`\`\`\n`,
    );
    console.log(`  ${i + 1}/${familias.length} ${f.codigo_pai}`);
  }

  const resumo = {
    A: metricas(saidas.A, fontes),
    B: metricas(saidas.B, fontes),
    C: metricas(saidas.C, fontes),
  };

  writeFileSync(join(AQUI, 'resultado.md'), linhas.join('\n'), 'utf-8');
  writeFileSync(join(AQUI, 'resultado.json'), JSON.stringify(resumo, null, 2), 'utf-8');
  console.table(resumo);
  console.log('\nresultado.md e resultado.json gravados.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verificar que o script compila sem executar**

```bash
pnpm exec tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --skipLibCheck scripts/experimento-copy/index.ts
```

Esperado: sem erro de tipo. Se reclamar da extensão `.ts` nos imports, confirme que `allowImportingTsExtensions` está ligado no `tsconfig` do projeto; se não estiver, remova as extensões `.ts` dos dois imports locais.

Não execute o script neste passo — a Task 6 cuida disso, e ele gasta tokens de API.

- [ ] **Step 4: Ignorar os artefatos de saída**

Acrescente ao `.gitignore`:

```
scripts/experimento-copy/resultado.md
scripts/experimento-copy/resultado.json
```

O `resultado.md` tem dezenas de milhares de caracteres de descrição de produto — o que vai para o repositório é o resumo no ADR, não o dump.

- [ ] **Step 5: Commit**

```bash
git add scripts/experimento-copy/index.ts .gitignore
git commit -m "feat(exp): harness A/B/C de copy

Cenario A usa a descricao_ml ja gravada em vez de re-executar o prompt
antigo, que deixa de existir apos a Task 3. Filtra
descricao_editada_pelo_operador para as 5 edicoes manuais nao
contaminarem a linha de base.

Aplica os dois guards a B e C antes de comparar -- producao aplica
depois de gerarCopy, entao a descricao_ml de A ja passou por eles.

Nao importa client.ts (npm: e Deno.env nao resolvem em Node); fala com
o OpenRouter por fetch direto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: executar o experimento e fechar a documentação

Esta task exige credenciais que não estão no `.env.local` (`SUPABASE_SERVICE_ROLE_KEY`). **Peça ao Diego antes de começar** — não tente contornar com a chave anônima, a RLS bloqueia a leitura.

**Files:**
- Modify: `docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/06-Roadmap/Sprint Atual.md`

**Interfaces:**
- Consumes: o harness da Task 5.
- Produces: seção `## Resultado do experimento` preenchida no ADR-0098.

- [ ] **Step 1: Rodar o experimento**

```bash
SUPABASE_URL=https://txvncrgkoynoxwopfkbp.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<pedir ao Diego> \
OPENROUTER_API_KEY=<de .env.local> \
  pnpm tsx scripts/experimento-copy/index.ts
```

Esperado: `resultado.md` e `resultado.json` gravados, tabela de métricas no console. Custo estimado abaixo de R$ 5.

- [ ] **Step 2: Registrar as métricas no ADR**

Preencha a seção `## Resultado do experimento` do ADR-0098 com a tabela das três métricas por cenário, mais a leitura:

- **B − A grande** confirma a hipótese da Causa C: o texto genérico vinha dos exemplos do prompt, não do teto do `gpt-4o-mini`. Nesse caso o modelo barato fica.
- **C − B pequeno** reforça a mesma conclusão.
- **C − B grande** indicaria que a variação entre anúncios realmente depende do modelo — aí a troca via `configuracoes.ai_model_texto` (ADR-0074) passa a valer a pena, e o custo sobe de ~1,2 para ~9 centavos por família.

Registre o número medido, não a expectativa. A previsão foi registrada na spec **antes** de rodar justamente para que o resultado não seja lido a favor da hipótese mais cara.

Acrescente também a avaliação qualitativa do Diego sobre os pares B vs C (tradução característica→benefício e fluidez), que as métricas automáticas não cobrem.

- [ ] **Step 3: Atualizar TASKS.md e o obsidian-vault**

Em `docs/TASKS.md`, registre a entrega seguindo o padrão das entradas existentes — leia as últimas antes de escrever.

Em `obsidian-vault/06-Roadmap/Sprint Atual.md`, registre o impacto funcional: a descrição de anúncio passa a seguir o contrato do ADR-0098, com rollout sob demanda.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md docs/TASKS.md "obsidian-vault/06-Roadmap/Sprint Atual.md"
git commit -m "docs(adr): registra o resultado do experimento A/B/C no ADR-0098

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Abrir o PR draft**

```bash
git push -u origin worktree-copy-premium-descricao
gh pr create --draft --title "Copy premium na descrição de anúncio (ADR-0098)" --body "$(cat <<'EOF'
Reescreve o prompt de geração de descrição de anúncio para produzir copy ancorada na fonte e persuasiva.

## O achado

O prompt **prescrevia** os bullets genéricos. A linha 154 listava "Alta resistência", "Ótimo custo-benefício" como exemplos — e eles aparecem em 125/166 (75%) e 78/166 (47%) do catálogo, verbatim. Os pontos "benefícios genéricos" e "não existe diferenciação" da análise de conversão eram o prompt se auto-cumprindo.

Separadamente: a frase "amplamente reconhecida como a melhor do mercado" está literalmente na `descricao_pai` da planilha. A IA obedeceu a regra anti-alucinação e ecoou a fonte — o problema não era invenção.

## O que muda

- `SYSTEM` reescrito com as regras R1–R9 do ADR-0098
- Exemplos few-shot trocados por exemplos multi-segmento que ensinam o mecanismo `dado → benefício`, não a frase pronta
- Seção nova `❓ PERGUNTAS SOBRE ESTE PRODUTO`, ancorada em campo
- `detectarFormulasProibidas` — verifica, nunca edita

## O que NÃO muda

Ordem das seções, `SCHEMA`, guards determinísticos, edge functions, e os 166 anúncios publicados (rollout sob demanda via `regenerar-copy-familia`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Cobertura da spec:**

| Seção da spec | Task |
|---|---|
| §1 diagnóstico (Causas A, B, C) | 1 (ADR) |
| §2 R1, R1b, R2, R4, R5, R7, R8 | 3 |
| §2 R3 | 2 (detector) + 3 (texto do prompt) |
| §2 R6 (perguntas ancoradas) | 3 |
| §2 R9 (neutralidade de segmento) | 3 (exemplos multi-segmento no `SYSTEM`) |
| §3 estrutura + seção nova | 3 |
| §4 mudanças em código | 2, 3 |
| §5 experimento A/B/C + métricas | 4, 5, 6 |
| §6 fase 2 | fora de escopo, registrada no ADR (Task 1) |
| §7 rollout | Task 1 (consequências do ADR); nada automatizado |
| §8 fora de escopo | Task 1 |
| §9 critérios de conclusão | distribuídos; PR na Task 6 |

**Consistência de tipos:** `detectarFormulasProibidas(texto: string): string[]` é definida na Task 2 e consumida na Task 5 com essa assinatura. `InputCopy` é o tipo já exportado por `copywriter-prompt.ts`, usado na Task 5 sem redefinição. As quatro funções de `metricas.ts` são definidas na Task 4 e consumidas na Task 5 com os mesmos nomes.

**Riscos conhecidos e onde estão tratados:**

| Risco | Onde |
|---|---|
| `❓` fora da whitelist quebra o match dos guards | Task 3, Step 4, nota 1 |
| Teste em `scripts/` não é executado pelo vitest | Task 4, Step 1 |
| `client.ts` não roda em Node | Task 5, cabeçalho do script |
| A cru vs B/C pós-guard enviesa a comparação | Task 5, `comoEmProducao` |
| Separador de milhar gera falso positivo de fidelidade | Task 4, `extrairMedidas` |
| Falta de `SUPABASE_SERVICE_ROLE_KEY` | Task 6, aviso no topo |
| Ler o resultado a favor da hipótese cara | Task 6, Step 2 |
