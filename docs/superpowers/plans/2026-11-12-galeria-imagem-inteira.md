# Galeria da cor: imagem inteira do gerador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o miolo da galeria (fatos → roteiro editável → cena sem texto → texto em canvas) por plano de IA + imagem inteira do gerador, em uma tela única, mantendo cobrança, trava, saga e aprovação humana.

**Architecture:** O plano da IA é gravado em `galeria_roteiros.conteudo` (formato 2), já aprovado pelo sistema e com o mesmo `fatos_hash` de `calcularVigencia`; assim `roteiro_id`, vigência, cobrança, aprovação e saga seguem sem migration. O worker monta o prompt a partir do plano e pede a imagem completa; uma leitura por visão compara o texto da imagem com o do plano. O navegador só recorta para 1200×1540 JPEG na aprovação.

**Tech Stack:** Supabase Edge Functions (Deno), OpenRouter (`openai/gpt-6-luna` planejador, `google/gemini-nano-banana-2.1` gerador, `MODELO_VISION` conferência), Higgsfield (opcional por org), QStash, React + Vite + vitest.

**Spec:** `docs/decisions/0203-galeria-imagem-inteira-do-gerador.md` (altera o ADR-0201, que continua valendo no resto). Material de medição (gitignored, só neste worktree): `.superpowers/sdd/2026-11-08-galeria-da-cor/pivo-agente/` com `prompts-agente.json`, `respostas-agente.md`, `spike3.py`, `plano-amig.json`.

**Revisão do plano:** Fable 5.2 (`claude -p`, só leitura) em 12/11/2026: APROVADO COM CORREÇÕES; os 16 achados estão incorporados abaixo.

## Global Constraints

- Worktree `galeria-imagem-inteira`, branch `worktree-imagens-anuncio-ia`. Bash simples, `/usr/bin/git`, um comando por chamada. Nunca commitar `deno.lock`.
- **Push ao fim de cada task** (`/usr/bin/git push origin worktree-imagens-anuncio-ia`): em 12/11 o worktree anterior foi removido por fora e tudo que não estava no remoto se perdeu.
- Uma única migration nova, a da Task 8b (categoria `imagem_ia` nas notificações). Fora dela, se uma task concluir que precisa de DDL, parar e avisar (ADR-0043: só `supabase migration new` + `supabase db push`).
- Nenhuma escrita no Mercado Livre fora da saga existente (`galeria-aplicar` / `galeria-aplicar-worker`). Este plano não toca `saga.ts`, `aplicar.ts`, `alvos.ts` nem as RPCs de trava e cobrança.
- Cobrança: continua na exibição (`galeria_confirmar_exibicao`), preço congelado no pedido. Nenhuma task altera valor, regra ou RPC de cobrança.
- Nunca inventar dado de produto: o planejador só recebe planilha + ficha do ML + foto; `descricao_ml` e `titulo_ml` não entram.
- Edges idempotentes; workers do QStash com `verify_jwt=false` (o `supabase/config.toml` já declara as `galeria-*`).
- Texto de tela em pt-BR, sem jargão ("posição", "plano", "missão", "roteiro" não aparecem; usar "imagem", "foto"). Dropdown = `Select` de `src/components/ui/select.tsx`.
- Testes: `pnpm exec vitest run <caminho>` (o `pnpm test -- <caminho>` roda a suíte inteira; vitest cobre `src/**/__tests__`, `tests/` e `supabase/functions/**/__tests__`). Portão antes do deploy: `pnpm preflight`.
- Todo commit deixa `pnpm exec tsc --noEmit` e os testes dos arquivos tocados verdes. Única exceção: Tasks 7 e 8 podem sair em um commit só. O pipeline antigo (lupa, roteiro, fatos em tela) continua compilando até a Task 9, que o apaga antes do deploy.
- Higgsfield (opcional por org) continua em 3:4 e sem regeração automática; só recebe o prompt novo e o alerta.
- Deploy de edge e teste real em produção só com OK do Diego (Task 10).
- Roteamento de modelo por task indicado no título. Revisão por task: Fable 5.2 no loop principal (decisão do Diego em 12/11). Pré-merge: Grok 4.7 high (`cursor-agent -p --mode ask --model grok-4.7-high --trust --output-format text … < /dev/null`). Revisor indisponível: avisar o Diego, não trocar.
- Commits terminam com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Nome de cor cru nos textos** ("Carmim Und 3528"): o operador espera que nenhum texto da imagem traga o nome ou o código interno da cor (o plano vale para todas as cores). Testes na Task 1 (`validarPlano` recusa `{{COR}}` e qualquer cor do anúncio em `textos`) e na Task 5 (ficha sem atributos de variação).
2. **Anúncio com dado pobre** (sem descrição do fornecedor, ficha com 1 linha): espera-se a imagem de ficha técnica desligada com motivo, nunca preenchida com invenção, e "Gerar todas" seguindo com as demais. Testes nas Tasks 1, 5 e 8.
3. **Visão fora do ar ou lenta**: espera-se a imagem mostrada com "não foi possível conferir o texto", sem regerar e sem travar em "gerando". Teste na Task 4.
4. **Anúncio que já tem roteiro antigo aprovado (formato 1)**, com imagens aprovadas ou aplicadas: abrir a tela não quebra, o primeiro pedido cria o plano novo e as imagens antigas ainda não aprovadas aparecem sem "Aprovar" (são cenas sem texto). Testes nas Tasks 5, 6 e 8.
5. **"Todas as cores" em anúncio de 39 cores**: espera-se confirmação com o total em R$ antes, pedidos de até 5 cores em sequência e parada na primeira recusa, com as cores já pedidas preservadas. Teste na Task 8 e medição de tempo na Task 10.

---

### Task 1 (sonnet): `plano.ts` — formato do plano, guardas e prompt da imagem

**Files:**
- Create: `supabase/functions/_shared/galeria/plano.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/plano.test.ts`

**Interfaces:**
- Consumes: `BLOCO_TECNICO`, `termosProibidos` de `./regras.ts`; `NUM`/`numero` de `./fatos.ts:110-115`.
- Produces:

```ts
export interface CorPaleta { nome: string; hex: string }            // hex /^#[0-9A-F]{6}$/i
export interface ImagemPlano { posicao: 1|2|3|4|5|6|7; funcao: string; textos: string[]; prompt: string; indisponivel?: string }
export interface Plano { formato: 2; dados_hash: string; paleta: { cor1: CorPaleta; cor2: CorPaleta }; conflitos: string[]; imagens: ImagemPlano[] }
// dados_hash = sha256 do JSON enviado ao planejador (Task 2 calcula, Task 5 compara)
export function ehPlano(conteudo: unknown): conteudo is Plano        // formato === 2 e 7 imagens
export function validarPlano(bruto: unknown, ctx: { moda: boolean; dadosTexto: string; cores: string[]; dadosHash: string }): { plano: Plano } | { erros: string[] }
export function montarPromptImagem(plano: Plano, posicao: number, cor: string): string
```

- [ ] **Step 1: testes que falham** (`plano.test.ts`). Fixture `fx()`: um plano completo do Fio Amigurumi (regenerar com `spike3.py … so-plano` ou usar `plano-amig.json`), com paleta `#D91F58`/`#F2D631`. `CTX = { moda: false, dadosTexto: DADOS, cores: ['Carmim Und 3528', 'Branco Und 8001'], dadosHash: 'h' }`, onde `DADOS` contém "254", "125" e "100%".

```ts
it('aceita o plano do amigurumi', () => expect('plano' in validarPlano(fx(), CTX)).toBe(true))
it('grava o dados_hash do contexto no plano', …)
it('recusa posição faltando ou repetida', …)            // erros contém 'posicoes'
it('recusa texto na capa', …)                           // imagens[0].textos = ['X'] → 'capa_com_texto'
it('em Moda recusa qualquer texto', …)                  // moda:true → 'moda_com_texto'
it('recusa termo proibido', …)                          // 'GARANTIA TOTAL' → 'termo_proibido:4'
it('recusa número fora dos dados', …)                   // '300 METROS' → 'numero_fora_dos_dados:4'
it('número é comparado inteiro', …)                     // '5 METROS' com DADOS contendo só 254 → 'numero_fora_dos_dados:4'
it('aceita numeração de etapa', …)                      // '1. ESCOLHA A COR' passa mesmo sem "1" nos dados
it('recusa {{COR}} dentro de textos', …)                // 'cor_no_texto:7'
it('recusa nome de cor do anúncio em textos', …)        // 'COR CARMIM UND 3528' → 'cor_no_texto:7' (sem diferenciar caixa e acento)
it('recusa texto que não está entre aspas no prompt', …)// 'texto_fora_do_prompt:2'
it('recusa hex inválido', …)                            // 'paleta'
it('posição indisponível dispensa textos e prompt', …)  // { posicao:5, indisponivel:'poucos dados', textos:[], prompt:'' } passa
it('prompt da capa não leva o bloco de estilo', () => expect(montarPromptImagem(p, 1, 'Carmim')).not.toContain('ESTILO VISUAL'))
it('prompt com texto leva paleta, fidelidade e bloco técnico', () => {
  const s = montarPromptImagem(p, 4, 'Carmim Und 3528')
  expect(s).toContain('#D91F58'); expect(s).toContain('Carmim Und 3528'); expect(s).not.toContain('{{COR}}')
  expect(s.endsWith(BLOCO_TECNICO)).toBe(true)
})
```

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/galeria/__tests__/plano.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: implementar.** Regras de `validarPlano`: 7 imagens com posições 1..7 sem repetir; `textos` ≤ 8 itens, cada um ≤ 60 caracteres; posição 1 sem textos; `moda` sem textos em todas; `termosProibidos(texto, 'geral')` vazio; todo número de um texto (ignorando o prefixo `^\d\.\s`) tem de existir em `dadosTexto` como número inteiro, não como parte de outro; nenhum texto contém `{{COR}}` nem o nome de alguma cor de `ctx.cores`; cada texto aparece literalmente no `prompt` da posição; `indisponivel` (string não vazia) dispensa as demais regras da posição; `dados_hash` do plano devolvido = `ctx.dadosHash`. `montarPromptImagem` = `prompt` com `{{COR}}` trocado pela cor + `\n\n` + `FIDELIDADE` + (só se `textos.length > 0`: `\n\n` + `estilo(cor1, cor2)`) + `\n\n` + `BLOCO_TECNICO`. Texto fixo (cópia exata):

```ts
const FIDELIDADE = 'Utilize as fotografias reais do produto anexadas como referência obrigatória: formato, cor, textura e, principalmente, o RÓTULO devem ser idênticos aos das fotos (mesmo logotipo, mesmas palavras, mesmas cores), nítido e legível. Não invente nem altere nada do rótulo.'
const estilo = (c1: CorPaleta, c2: CorPaleta) => `ESTILO VISUAL OBRIGATÓRIO (arte publicitária de marketplace brasileiro, alto impacto, acabamento profissional):
- REGRA PRINCIPAL DE TEXTO: a imagem final deve conter EXATAMENTE os textos pedidos entre aspas acima e nenhum outro (fora o rótulo do próprio produto). É PROIBIDO criar cartões, etiquetas, selos, legendas, títulos, subtítulos ou frases para informações que não foram pedidas entre aspas, mesmo que sejam verdadeiras. Nunca escreva na imagem trechos destas instruções. Os elementos gráficos abaixo são um vocabulário: use somente os necessários para exibir os textos pedidos.
- Mostrar apenas UMA unidade do produto com rótulo, salvo se o pedido acima disser outra coisa.
- Paleta fixa: ${c1.nome} (${c1.hex}) como cor principal, ${c2.nome} (${c2.hex}) como cor de destaque, branco e cinza muito claro. Texto de apoio em cinza-escuro.
- Headline em CAIXA ALTA, fonte sans-serif geométrica extra-bold (peso Black, estilo Montserrat Black), muito grande, ocupando quase toda a largura do topo: texto branco dentro de uma faixa na cor principal de cantos arredondados com um detalhe curvo na cor de destaque (ou, em cena fotográfica, texto na cor principal direto sobre a área clara). Logo abaixo, um traço curvo fino na cor de destaque.
- Subheadline em sans-serif regular, cinza-escuro, grande e legível no celular.
- Blocos de informação: cartões brancos de cantos bem arredondados com sombra suave; à esquerda um quadrado na cor principal com ícone de linha branco; um filete vertical na cor de destaque; rótulo na cor principal bold e valor na cor de destaque bold, letras grandes.
- Etapas numeradas: número branco grande dentro de um quadrado na cor de destaque; faixa na cor principal com o título da etapa em branco caixa alta; fotografia ampla ao lado com cantos arredondados.
- Rótulos de detalhe: etiquetas na cor principal com texto branco em caixa alta, ligadas ao ponto por linha fina na cor de destaque; ampliações macro dentro de círculo com borda na cor de destaque.
- Rodapé com curva decorativa nas duas cores.
- Produto grande e dominante (cerca de metade da imagem), foco perfeito, fundo branco com leve degradê cinza e sombra suave de estúdio.
- Nenhum texto nem elemento importante a menos de 4% das bordas da imagem.
- Todo texto com ortografia e acentuação perfeitas em português do Brasil, exatamente como escrito entre aspas.`
```

- [ ] **Step 4:** mesmo comando → PASS. `pnpm exec tsc --noEmit` → sem erro.
- [ ] **Step 5:** commit `feat(galeria-ia): formato do plano, guardas e prompt da imagem inteira` e push.

---

### Task 2 (sonnet): planejador — `planejador.ts` + exemplos

**Files:**
- Create: `supabase/functions/_shared/galeria/planejador.ts`, `supabase/functions/_shared/galeria/plano-exemplos.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/planejador.test.ts`

**Interfaces:**
- Consumes: `validarPlano`, `Plano` (Task 1); `openrouterClient` de `../ai/client.ts`.
- Produces:

```ts
export interface DadosPlanejador {
  nome: string; descricao_fornecedor: string | null; marca: string | null
  ficha_do_anuncio: Record<string, string>        // atributos do item no ML: name → value_name (filtro na Task 5)
  total_de_cores: number; conteudo_da_embalagem: '1 unidade na cor escolhida'
}
export const TIMEOUT_PLANO_MS = [60_000, 30_000] as const   // 1ª e 2ª tentativa (medido 12/11: 34 s na 1ª): a edge galeria-gerar tem de caber em 150 s
export const hashDados: (dados: DadosPlanejador) => string   // sha256 hex de JSON.stringify(dados)
export function montarMensagens(dados: DadosPlanejador, refUrl: string, moda: boolean): unknown[]   // puro
export async function gerarPlanoIA(p: { modelo: string; dados: DadosPlanejador; refUrl: string; moda: boolean; cores: string[] }): Promise<{ plano: Plano } | { erro: 'plano_ia_falhou' | 'plano_invalido'; erros?: string[] }>
```

- [ ] **Step 1: `plano-exemplos.ts`.** `export const EXEMPLO_FITA: string` = `JSON.stringify` do conteúdo de `prompts-agente.json` (7 prompts, chaves "1".."7"); `export const EXEMPLO_CAMISETA: string` = trecho de `respostas-agente.md` de "Imagem 1 — Capa sem texto" até antes de "Comparação: o que é fixo". Copiar o texto sem alterar.
- [ ] **Step 2: testes que falham:**

```ts
it('mensagens levam os dois exemplos, os DADOS em JSON e a foto', …)   // user.content tem image_url === refUrl
it('mensagens nunca levam descricao_ml nem titulo_ml', …)               // JSON.stringify(msgs) não contém 'descricao_ml'
it('moda acrescenta a regra "nenhuma imagem leva texto"', …)
it('resposta válida vira plano com dados_hash = hashDados(dados)', …)
it('resposta inválida tenta uma segunda vez com os erros e, falhando de novo, devolve plano_invalido', …)  // 2 chamadas; timeouts 60 s e 30 s
it('timeout ou erro do provedor → plano_ia_falhou, sem segunda chamada', …)
```

- [ ] **Step 3: implementar.** `response_format: { type: 'json_object' }`, `maxRetries: 0`, `AbortSignal.timeout(TIMEOUT_PLANO_MS[tentativa])`. Segunda tentativa só para `erros` de validação (acrescenta mensagem de usuário "Corrija: …" com os erros). Mensagem de usuário: `'EXEMPLO A (fita de velcro), prompts 1 a 7:\n' + EXEMPLO_FITA + '\n\nEXEMPLO B (camiseta):\n' + EXEMPLO_CAMISETA + '\n\nAGORA PLANEJE ESTE PRODUTO.\nDADOS:\n' + JSON.stringify(dados, null, 1)` + a foto. Sistema (cópia exata; em Moda acrescentar a linha indicada no fim):

```
Você é diretor de arte e redator de anúncios de marketplace brasileiro. Recebe os DADOS de um produto e a foto real dele e planeja as 7 imagens do anúncio. O plano vale para todas as cores do anúncio.

FUNÇÕES (estrutura padrão; adapte a função 3 e a 6 ao tipo de produto, como nos exemplos):
1 capa sem texto, fundo branco puro, só o produto; 2 contexto de uso; 3 quebra da principal objeção de compra; 4 benefícios (até 3); 5 ficha técnica; 6 como usar / como escolher; 7 detalhes e acabamento.

REGRAS DE CONTEÚDO (invioláveis):
- Use SOMENTE fatos presentes nos DADOS ou visíveis na foto. Nunca invente medida, composição, certificação, quantidade, garantia, selo, desconto, avaliação.
- Se duas fontes dos DADOS se contradizem sobre um fato, NÃO use esse fato e liste-o em "conflitos".
- Sem superlativo nem promessa sem prova ("o melhor", "não desfia", "alta resistência", "durável").
- Benefício = característica verificável dita do jeito do comprador. Até 3 por imagem, até 6 palavras cada.
- Headline em CAIXA ALTA, até 5 palavras. Subheadline até 8 palavras. Português do Brasil com acentuação correta.
- Na ficha técnica, só linhas "Rótulo: valor" tiradas dos DADOS, sem título.
- Escreva {{COR}} onde a cor do produto aparecer no prompt. Nunca cite a cor, nem código de cor, dentro de "textos".
- Se os DADOS não sustentam uma posição (ex.: ficha técnica com menos de 2 linhas), devolva nela "indisponivel" com o motivo em uma frase, "textos": [] e "prompt": "".

DIREÇÃO DE ARTE: a paleta sai da embalagem/rótulo/marca vistos na foto (2 cores fortes da marca + branco). Não use azul-marinho e vermelho por padrão: só se forem as cores da marca.

PROMPT DE CADA IMAGEM: em português, no formato dos exemplos: tipo de imagem e formato vertical; "Produto: ..." com os fatos; a cena/composição fotográfica; os textos, cada um entre aspas, precedidos de "Inserir exatamente os textos:"; e uma linha final "Não inserir/Não inventar ...". Não descreva cores de layout nem tipografia no prompt (isso vem da direção de arte). Não coloque entre aspas nada que não deva aparecer escrito na imagem.

Responda APENAS JSON:
{"formato": 2, "conflitos": ["..."],
 "paleta": {"cor1": {"nome": "...", "hex": "#..."}, "cor2": {"nome": "...", "hex": "#..."}},
 "imagens": [{"posicao": 1, "funcao": "...", "textos": ["cada texto exato que aparece na imagem"], "prompt": "..."}, ... 7 itens]}
```
Linha extra em Moda: `MODA: nenhuma imagem leva texto ("textos": [] em todas). Só vistas que a foto sustenta; nunca invente costas ou lateral.`

- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/galeria/__tests__/planejador.test.ts` → PASS. `pnpm exec tsc --noEmit`.
- [ ] **Step 5:** commit `feat(galeria-ia): planejador de IA (paleta + 7 prompts)` e push.

---

### Task 3 (sonnet): conferência de texto — `conferir-texto.ts`

**Files:**
- Create: `supabase/functions/_shared/galeria/conferir-texto.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/conferir-texto.test.ts`

**Interfaces:**
- Consumes: `openrouterClient`, `MODELO_VISION`.
- Produces:

```ts
export type TipoAlertaTexto = 'texto_faltando' | 'texto_extra' | 'verificacao_indisponivel'
export interface AlertaTexto { tipo: TipoAlertaTexto; nota: string }       // mesmo formato {tipo, nota} gravado hoje em galeria_imagens.alertas
export const TIMEOUT_LEITURA_MS = 15_000                                    // geração 100 s + leitura 15 s < lease de 150 s
export function compararTextos(esperados: string[], lidos: string[]): AlertaTexto[]            // puro
export async function conferirTexto(p: { imagemUrl: string; esperados: string[] }): Promise<AlertaTexto[]>
export const divergente = (a: AlertaTexto[]) => a.some((x) => x.tipo !== 'verificacao_indisponivel')
```

- [ ] **Step 1: testes que falham:**

```ts
it('iguais, com quebra de linha e caixa diferentes → []', () =>
  expect(compararTextos(['254 METROS POR UNIDADE'], ['254 metros', 'POR UNIDADE'])).toEqual([]))
it('faltando', …)   // esperado 'FIO PARA CRIAR', lidos [] → [{tipo:'texto_faltando', nota:'FIO PARA CRIAR'}]
it('escrito errado vira faltando + extra', …)   // esperado 'FORÇA E QUALIDADE', lido 'FOUÇA E QUALIDADE'
it('acento trocado conta como errado', …)       // esperado 'ALGODÃO', lido 'ALGODAO' → faltando + extra
it('extra', …)      // lidos tem 'MATERIAL RESISTENTE' fora dos esperados → texto_extra com a nota do lido
it('capa: qualquer texto lido é extra', …)
it('resposta ilegível ou timeout → verificacao_indisponivel', …)
it('divergente ignora verificacao_indisponivel', …)
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar.** Visão: instrução em inglês pedindo JSON `{"textos": ["…"]}` com todo texto desenhado na arte **fora** da embalagem/rótulo do próprio produto, um item por bloco, transcrição literal com acentos; `response_format` json_schema estrito; `temperature: 0`; `maxRetries: 0`; timeout acima. Comparação: normalizar = minúsculas + espaços colapsados + pontuação removida, **mantendo** acentos; juntar `lidos` em uma string; esperado presente como substring → ok; ausente → `texto_faltando`; palavras lidas que não pertencem a nenhum esperado, agrupadas por item lido → `texto_extra` (um alerta por item lido).
- [ ] **Step 4:** rodar → PASS. `pnpm exec tsc --noEmit`.
- [ ] **Step 5:** commit `feat(galeria-ia): conferência do texto da imagem por visão` e push.

---

### Task 4 (opus): worker — imagem inteira, 2K, conferência e uma regeração

**Files:**
- Modify: `supabase/functions/_shared/galeria/worker-estado.ts`, `supabase/functions/_shared/galeria/prompt.ts` (só `corpoOpenRouter`), `supabase/functions/_shared/galeria/regras.ts` (só nomes e `usaGerador`), `supabase/functions/_shared/galeria/modelos.ts` (custo de tabela)
- Test: `supabase/functions/_shared/galeria/__tests__/worker.test.ts`, `cena.test.ts`, `regras.test.ts`, `pedido.test.ts`

**Interfaces:**
- Consumes: `ehPlano`, `montarPromptImagem`, `Plano` (Task 1); `conferirTexto`, `divergente` (Task 3).
- Produces: `corpoOpenRouter(modelo, prompt, referencias, imagem?: { aspecto: string; tamanho?: string })` (padrão `{ aspecto: '3:4' }`); `DepsWorker.conferir?: typeof conferirTexto` (injeção para teste).

- [ ] **Step 1: testes que falham** (em `worker.test.ts`; os casos do roteiro antigo deste arquivo são reescritos para o plano):

```ts
it('submeter monta o prompt do plano com a cor da linha e pede 4:5 em 2K', …)   // corpo.image_config = { aspect_ratio: '4:5', image_size: '2K' }
it('roteiro em formato antigo → falhou com erro plano_antigo, sem chamada paga', …)
it('posição indisponível no plano → falhou com erro posicao_indisponivel, sem chamada paga', …)
it('texto divergente na 1ª tentativa: não grava a cena, grava o custo na linha, solta o lease e devolve "liberada"', …)   // custo_usd = c1; status segue 'submetendo'; tentativa 1
it('texto divergente na 2ª tentativa: conclui, com p_custo = c1 + c2 e alertas = os da conferência feita', …)
it('conferência limpa: conclui e grava alertas = [] sem esperar a fase alertar', …)
it('visão indisponível na 1ª tentativa: conclui (não regera) e grava verificacao_indisponivel', …)
it('fase alertar (Higgsfield, ou gravação dos alertas que falhou) grava os alertas de conferirTexto', …)
it('fase alertar com visão fora do ar grava verificacao_indisponivel', …)        // nunca fica null
it('Higgsfield: prompt do plano, 3:4, sem conferência inline', …)
```
`regras.test.ts`: `missoesDisponiveis(false, ['frente'])` e `missoesDisponiveis(true, ['frente'])` têm as 7 com `usaGerador: true`, `vista: 'frente'` e os nomes novos. `pedido.test.ts`: `planejarGeracoes` devolve `recortes: []` e as 7 em `novas`. `cena.test.ts`: `cenaUtil(2, 1856, 2304)` é `true` (medido em 12/11: 4:5 em 2K sai 1856×2304 → corte lateral de 3,3%).

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/galeria/__tests__` → os novos FALHAM.
- [ ] **Step 3: implementar.**
  - `regras.ts`: nomes de `GERAL` = 'Capa', 'Em uso', 'Tira-dúvida', 'Benefícios', 'Ficha técnica', 'Como usar', 'Detalhes' (fonte única dos nomes na tela); `GERAL[6].usaGerador = true`; `MODA` todas `usaGerador: true` e `vista: 'frente'`. **Não** mexer em `MISSOES_LUPA_PENDENTE` nem em `lupa.ts` (saem na Task 9).
  - `modelos.ts`: `custoUsd` do Nano Banana = `0.06` (2K; é o custo usado quando a resposta vem sem `usage.cost`).
  - `worker-estado.ts`, `submeter`: `if (!ehPlano(roteiro.conteudo)) return falharSemPosse('plano_antigo')` antes do claim; depois do claim, posição com `indisponivel` → `falhar('posicao_indisponivel')`; `prompt = montarPromptImagem(plano, linha.missao, linha.cor)`; OpenRouter com `{ aspecto: '4:5', tamanho: '2K' }`; Higgsfield inalterado (3:4). Incluir `custo_usd` em `COLUNAS` e em `LinhaWorker`; `custoAcumulado = (linha.custo_usd ?? 0) + custo desta chamada`.
  - Só OpenRouter, antes de `concluir`: `const a = await (deps.conferir ?? conferirTexto)({ imagemUrl, esperados })`, com `imagemUrl` = a URL de dados que já vem na resposta do provedor (`extrairImagem`, `ai/imagem.ts:37`). Divergente com `tentativa < 2`: `comPosse({ custo_usd: custoAcumulado, posse: null, lease_ate: null })` e devolve `'liberada'` (a imagem não é gravada nem exibida). Senão: `concluir(..., custoAcumulado)` e, se devolveu `gerada` ou `desatualizada`, `update({ alertas: a }).eq('id', linha.id).is('alertas', null)`. A regra existente de `proximaFase` (`submetendo` sem `provider_request_id`, lease livre, `tentativa < 2` → `submeter`) faz a nova geração; não mudar `proximaFase`.
  - `alertar`: troca `verificarCena` por `conferirTexto({ imagemUrl: cenaUrl, esperados })`; sem URL ou plano ilegível → `[{ tipo: 'verificacao_indisponivel', nota: … }]`.
  - Remover do worker os imports de `layoutCena`, `montarPromptCena`, `verificarCena`, `Roteiro` (os arquivos ficam até a Task 9).
- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/galeria/__tests__` → PASS. `pnpm exec tsc --noEmit`. `deno check supabase/functions/galeria-worker/index.ts` → sem erro.
- [ ] **Step 5:** commit `feat(galeria-ia): worker gera a imagem inteira e confere o texto` e push.

---

### Task 5 (opus): `galeria-gerar` — garante o plano e reserva o pedido

**Files:**
- Create: `supabase/functions/_shared/galeria/plano-vigente.ts`
- Modify: `supabase/functions/galeria-gerar/index.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/plano-vigente.test.ts`, `supabase/functions/galeria-gerar/__tests__/galeria-gerar.test.ts`

**Interfaces:**
- Consumes: `gerarPlanoIA`, `hashDados`, `DadosPlanejador` (Task 2); `ehPlano` (Task 1); `calcularVigencia` (`referencias.ts`); `ehModa` (`regras.ts`); `resolverModeloTexto` (`../ai/modelos.ts`); RPC `galeria_aprovar_roteiro(p_org, p_roteiro, p_familia, p_fatos_hash, p_conteudo_lido, p_conteudo, p_usuario)`.
- Produces:

```ts
export async function garantirPlano(admin: SupabaseClient, p: {
  orgId: string; userId: string; a: AnuncioGaleria; fatosHash: string; refUrl: string; confirmarTroca: boolean
  lerFichaML: () => Promise<Array<{ id: string; name: string; value_name: string | null }> | null>  // GET /items/{id}?attributes=attributes
  lerCategoria: (id: string) => Promise<Array<{ id: string }> | null>  // path_from_root; null = ilegível
  planejar?: typeof gerarPlanoIA
}): Promise<{ roteiroId: string; plano: Plano; moda: boolean }
  | { erro: 'plano_ia_falhou' | 'plano_invalido' | 'categoria_indisponivel' | 'ml_indisponivel' }
  | { erro: 'plano_desatualizado'; imagens: number }>
```
Corpo novo do POST: `{ pedido_id, ml_item_id, cores, missoes, unit_cents_exibido, confirmar_troca? }` (sai `roteiro_versao`).

- [ ] **Step 1: testes que falham.** `plano-vigente.test.ts` (com `fake-admin.ts`):

```ts
it('reaproveita o aprovado quando é formato 2, da família vigente, com o mesmo fatos_hash e o mesmo dados_hash (não chama a IA)', …)
it('roteiro aprovado em formato antigo → cria plano novo, sem pedir confirmação', …)           // Review Focus 4
it('fatos_hash diferente, sem imagens exibidas → cria plano novo (rascunho versao = max+1 + galeria_aprovar_roteiro)', …)
it('ficha do ML mudou (dados_hash diferente) → trata como plano desatualizado', …)
it('plano formato 2 desatualizado com imagens exibidas e não aplicadas, sem confirmarTroca → { erro: "plano_desatualizado", imagens: N }, sem chamar a IA', …)
it('o mesmo caso com confirmarTroca: true → cria o plano novo', …)
it('outra aba criou o plano durante a chamada da IA: relê o aprovado antes do insert e usa o dela, sem inserir', …)
it('insert do rascunho com 23505 → relê o aprovado e usa', …)
it('IA falhou → devolve o erro e não grava nada', …)
it('categoria ilegível → categoria_indisponivel, sem chamar a IA', …)
it('ficha do ML fora do ar → ml_indisponivel, sem chamar a IA', …)
it('ficha enviada ao planejador não leva atributos de embalagem nem de variação', …)   // fora: nomes com "embalagem"/"vendor"; ids COLOR, SIZE, GTIN, SELLER_SKU; todo valor igual a uma cor do anúncio; value_name nulo
```
`galeria-gerar.test.ts`: remover os casos de `roteiro_versao`, ciência, lupa e recorte; acrescentar:

```ts
it('sem plano: cria o plano e reserva todas como origem gerador', …)
it('plano falhou → 502 { error: "plano_ia_falhou" } e nenhum pedido reservado', …)
it('posição indisponível pedida → 422 { error: "posicao_indisponivel", missoes: [5] }', …)   // Review Focus 2
it('plano desatualizado sem confirmar_troca → 409 { error: "plano_desatualizado", imagens: N } e nenhum pedido reservado', …)
it('cor sem foto de referência → 409 { error: "sem_referencia", cores: [...] }', …)
it('repetição do mesmo pedido_id devolve as linhas existentes sem chamar a IA', …)
```

- [ ] **Step 2:** rodar os dois arquivos → FAIL.
- [ ] **Step 3: implementar.** Ordem na edge: gate do módulo → anúncio → repetição do pedido → cores válidas → elegibilidade no ML (inalterada) → preço do mês (inalterado) → `calcularVigencia` → referência `frente` de cada cor → `garantirPlano` (foto = referência da 1ª cor pedida, URL assinada de 10 min) → posições indisponíveis → `planejarGeracoes` → `galeria_reservar_pedido` com todo item `origem: 'gerador'` e `referencia_id` da vista `frente` → `publicarJobs`. Saem da edge: `roteiro_versao`, ciência, o bloco de lupa (linhas 91-92 e 136-152) e `recortes`.
  Em `garantirPlano`: reaproveita só com formato 2 + família vigente + `fatos_hash` + `dados_hash` iguais. Se existe plano formato 2 que não serve e há imagens dele `gerada`/`aprovada` com `entregue_em` preenchido e fora de aplicação `aplicada`, sem `confirmarTroca` → `plano_desatualizado` com a quantidade (roteiro em formato antigo não pede confirmação). Depois da IA e **antes** do insert, reler o aprovado: se já serve, usar e não inserir. `insert` do rascunho em `galeria_roteiros` com `versao = max(versao do anúncio) + 1`, `conteudo`, `fatos_hash`, `moda`, `status: 'rascunho'`; erro `23505` → reler o aprovado e usar se servir. Depois `galeria_aprovar_roteiro`; retorno diferente de `'ok'` → apagar o rascunho e devolver `plano_ia_falhou`.
- [ ] **Step 4:** conferir na documentação o limite de tempo de requisição das Edge Functions (premissa do plano: 150 s; planejador ≤ 90 s) e anotar no ledger; se for menor, parar e avisar.
- [ ] **Step 5:** rodar → PASS. `pnpm exec tsc --noEmit`. `deno check supabase/functions/galeria-gerar/index.ts`.
- [ ] **Step 6:** commit `feat(galeria-ia): galeria-gerar cria o plano e pede a imagem inteira` e push.

---

### Task 6 (sonnet): `galeria-imagens` (listar) e `galeria-aprovar` no formato novo

**Files:**
- Modify: `supabase/functions/galeria-imagens/index.ts`, `supabase/functions/galeria-aprovar/index.ts`
- Test: os `__tests__` das duas edges

**Interfaces:**
- Produces (resposta do `listar`):

```ts
{ titulo: string | null; cores: string[]; moda: boolean | null; unit_cents: number
  posicoes: Array<{ posicao: number; nome: string; indisponivel?: string }>   // nomes de missoesDisponiveis(moda, ['frente']); sem plano: os 7 de não-Moda
  plano_id: string | null                                                      // roteiro aprovado em formato 2
  imagens: Array<{ id; cor; missao; geracao; status; alertas; erro; exibida; url; unit_cents; roteiro_id; pode_gerar_de_novo }> }
```

- [ ] **Step 1: testes que falham:** `listar` de anúncio sem plano devolve `plano_id: null`, 7 posições e `cores` de `coresDoAnuncio`; com roteiro aprovado em formato antigo devolve `plano_id: null`, não lança e mantém as imagens dele na lista (Review Focus 4); com plano devolve `indisponivel` da posição marcada; a resposta não tem mais `roteiro.textos`, `lupa` nem `ref_url`. `galeria-aprovar`: aprovar a posição 7 de não-Moda não exige `lupa_hash`; imagem de roteiro que não é formato 2 → 409 `nao_aprovavel`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: implementar.** `listar` passa a chamar `carregarAnuncio` (cores e `vigente.nome_pai` como título). Em `galeria-aprovar` remover o bloco de lupa (linhas 94 e 114-119) e seus imports, e recusar roteiro fora do formato 2; o resto fica.
- [ ] **Step 4:** rodar → PASS; `pnpm exec tsc --noEmit`; `deno check` das duas.
- [ ] **Step 5:** commit `feat(galeria-ia): listar e aprovar no formato da tela única` e push.

---

### Task 7 (sonnet): front — `api.ts` e arquivo final por recorte

**Files:**
- Create: `src/lib/galeria/final.ts`
- Modify: `src/lib/galeria/api.ts`
- Test: `src/lib/galeria/__tests__/final.test.ts`

**Interfaces:**
- Consumes: `planejarCorte`, `LARGURA_FINAL`, `ALTURA_FINAL`, `PESO_MAXIMO_FINAL` de `supabase/functions/_shared/galeria/corte.ts`.
- Produces: `montarArquivoFinal(url: string, capa: boolean): Promise<Blob>` (JPEG 1200×1540 ≤ 1 MB; capa fora de proporção é encaixada inteira sobre fundo branco, como `compor.ts:123` faz hoje; fora da capa lança `Error('corte')` se `planejarCorte` recusar; lança `Error('peso')` se não couber em 1 MB com qualidade ≥ 0,6); `gerarImagens(mlItemId, { pedidoId, cores, missoes, unitCentsExibido, confirmarTroca? })`; `RespostaListar` no formato da Task 6; `aprovarFinal(mlItemId, imagemId)` sem `lupaHash`. Mensagens novas em `MENSAGENS`: `plano_ia_falhou` e `plano_invalido` "Não foi possível preparar as imagens agora. Tente de novo.", `posicao_indisponivel` "Faltam dados do produto para esta imagem.", `plano_desatualizado` "Os dados do anúncio mudaram.", `sem_referencia` "Falta a foto real desta cor no cadastro.", `desatualizada` "Os dados do anúncio mudaram. Gere as imagens de novo."

- [ ] **Step 1: teste que falha** (`final.test.ts`, com canvas simulado como em `compor.test.ts`): imagem 1856×2304 → blob `image/jpeg`, `drawImage` com destino 1200×1540 e corte lateral centrado; imagem 2400×1000 com `capa: false` → rejeita com `'corte'`; a mesma com `capa: true` → blob com fundo branco.
- [ ] **Step 2:** `pnpm test -- src/lib/galeria/__tests__/final.test.ts` → FAIL.
- [ ] **Step 3: implementar** reaproveitando de `compor.ts` o carregamento da imagem e o laço de qualidade do JPEG (copiar para `final.ts`; `compor.ts` sai na Task 9). Em `api.ts`, manter por enquanto os tipos e funções antigos que `passo-conferir.tsx` e `passo-escolher.tsx` importam (saem na Task 9).
- [ ] **Step 4:** rodar → PASS. Se `pnpm exec tsc --noEmit` acusar os usos antigos em `passo-gerar.tsx`, juntar o commit desta task com o da Task 8.
- [ ] **Step 5:** commit `feat(galeria-ia): arquivo final por recorte e API da tela única` e push.

---

### Task 8 (sonnet): front — tela única

**Files:**
- Modify: `src/pages/GaleriaIA.tsx` (reescrita), `src/components/galeria/passo-gerar.tsx` → renomear para `painel-imagens.tsx`, `src/components/galeria/cartao-imagem.tsx`, `src/components/galeria/passo-aplicar.tsx` (só o que depender de `ficha`/`roteiro`), `src/pages/dev/GaleriaHarness.tsx`, `src/lib/modulos.ts:62` (descrição do módulo)
- Test: `src/pages/__tests__/GaleriaIA.test.tsx`, `src/components/galeria/__tests__/painel-imagens.test.tsx` (ex-`passo-gerar.test.tsx`)

**Interfaces:**
- Consumes: Task 7 (`listarImagens`, `gerarImagens`, `montarArquivoFinal`, `prepararUploadFinal`, `enviarFinal`, `aprovarFinal`, `confirmarExibicao`, `reportarInvalida`), `PassoAplicar` existente.

Layout (uma página, sem passos):
1. Cabeçalho: voltar para Publicados, título do anúncio, `Select` de cor (cores do anúncio + "Todas as cores"), preço por imagem.
2. Barra: botão "Gerar todas (N imagens · R$ X,XX)". Com uma cor: as posições disponíveis ainda sem imagem daquela cor. Com "Todas as cores": idem para cada cor.
3. Grade de 7 cartões (com "Todas as cores": uma faixa por cor, cada uma com seus 7). Estados do cartão: vazio ("Gerar · R$ 0,50"), indisponível (motivo, sem botão), gerando ("Gerando…", inclui a espera da conferência), pronta (imagem + "Aprovar" + "Gerar outra" + alerta), aprovada (selo + "Gerar outra"), falhou (motivo + "Tentar de novo").
4. Alertas no cartão: `texto_extra` "Texto a mais na imagem: …"; `texto_faltando` "Faltou ou saiu errado o texto: …"; `verificacao_indisponivel` "Não foi possível conferir o texto. Confira antes de aprovar.".
5. Seção "Colocar no anúncio" (só com cor única escolhida e ao menos uma aprovada): o `PassoAplicar` atual (Adicionar ou Substituir, prévia, confirmar, desfazer).
6. Toda geração abre o diálogo de confirmação existente com quantidade e total em R$.

- [ ] **Step 1: testes que falham** (`painel-imagens.test.tsx`, mantendo os casos de exibição/cobrança, aprovar e "Gerar outra" que já existem, adaptados):

```ts
it('mostra 7 cartões com os nomes das posições mesmo sem plano', …)
it('"Gerar" de um cartão pede só aquela posição e cor, após confirmar o valor', …)   // gerarImagens({ cores:[cor], missoes:[4] })
it('"Gerar todas" pede as posições disponíveis sem imagem da cor', …)
it('"Todas as cores": pedidos de até 5 cores, em sequência; recusa no 2º pedido para e mostra o motivo, o 1º segue gerando', …)  // Review Focus 5
it('diálogo mostra "273 imagens · R$ 136,50" para 39 cores × 7 a R$ 0,50', …)
it('422 posicao_indisponivel: relista e reabre o diálogo com a quantidade e o total novos', …)   // Review Focus 2
it('409 plano_desatualizado: diálogo "12 imagens prontas deixam de valer. Gerar mesmo assim?"; confirmar reenvia com confirmarTroca', …)
it('enquanto um pedido está em voo, todos os botões Gerar ficam desabilitados', …)
it('cartão indisponível mostra o motivo e não tem botão', …)
it('alerta texto_extra aparece no cartão e não bloqueia Aprovar', …)
it('imagem de roteiro antigo (roteiro_id ≠ plano_id) aparece sem Aprovar', …)   // Review Focus 4
it('Aprovar usa montarArquivoFinal(url, posição === 1) e não compõe texto', …)
it('imagem com alertas null segue como "Gerando…" e mantém o polling', …)
```
`GaleriaIA.test.tsx`: guarda do módulo (inalterada), abre direto na tela única (não chama `galeria-fatos` nem `galeria-roteiro`), seção "Colocar no anúncio" só com aprovada.

- [ ] **Step 2:** rodar os dois arquivos → FAIL.
- [ ] **Step 3: implementar.** Manter de `passo-gerar.tsx` o polling de 5 s, o cache de URL assinada, `exibida`/`confirmar` (cobrança na exibição) e `invalida`; trocar `comporImagemFinal` por `montarArquivoFinal`; remover lupa, ficha, roteiro e ciência (os arquivos antigos que ficarem sem uso continuam no repositório até a Task 9). `GaleriaIA.tsx` deixa de chamar `montarFicha` e `lerRoteiro`. `src/lib/modulos.ts:62`: descrição "Fotos de anúncio criadas por IA, cobradas por imagem".
- [ ] **Step 4:** rodar → PASS. `pnpm exec tsc --noEmit` → sem erro.
- [ ] **Step 5: verificação visual.** `GaleriaHarness.tsx` com dados fixos cobrindo todos os estados do cartão; copiar `.env.local` do checkout principal; `pnpm dev --port 5180 --strictPort`; skill `playwright-cli` em sessão isolada: print em 1440 px e 390 px da rota do harness. Sem estouro horizontal, botões com no mínimo 40 px de altura. Mandar os prints ao Diego e **esperar o OK da tela** antes da Task 10.
- [ ] **Step 6:** commit `feat(galeria-ia): tela única (gerar foto a foto ou todas, aprovar, colocar no anúncio)` e push.

---

### Task 8b (opus): aviso de imagens prontas, só para quem pediu (pedido do Diego em 12/11)

**Files:**
- Create: `supabase/migrations/<timestamp>_galeria_aviso_imagens_prontas.sql` (via `supabase migration new`), `supabase/functions/_shared/galeria/aviso-pronto.ts`
- Modify: `supabase/functions/_shared/galeria/despacho.ts` (chamada no fim do tick), `src/components/notificacoes-bell.tsx`, `src/lib/notificacoes-categorias.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/aviso-pronto.test.ts`, teste do sino, `supabase/tests/` (SQL do CHECK)

**Interfaces:**
- Produces: `avisarPedidosProntos(admin, deps: { agora: Date; appUrl: string; enviar: typeof enviarTelegram }): Promise<number>` (nº de avisos novos).

Regras (ADR-0203 item 11):
- Migration: só acrescenta `'imagem_ia'` ao CHECK `notificacoes_categoria_check` (recriar com a lista vigente + o valor novo). Não entra em `profiles.telegram_categorias` (não é assinável).
- Rodada = pedidos de um mesmo `criado_por` no mesmo anúncio criados nas últimas 3 h. Pronta = nenhuma imagem desses pedidos em `pendente|submetendo|gerando` e nenhuma `gerada` com `alertas` nulo.
- Chave da notificação: `galeria_pronta:<id do pedido mais recente da rodada>`; insert com `onConflict (user_id, chave)` ignorando duplicata; Telegram só quando a linha foi criada agora, para `profiles.telegram_chat_id` do `criado_por`, com o bot da org e `telegram_ativo`.
- Texto: `Suas imagens ficaram prontas: <título>. <N> para conferir[, <M> não saíram]. Abra para aprovar: <APP_URL>/#/publicados/<ml_item_id>/galeria`.
- Sino: categoria `imagem_ia` abre a rota interna da galeria (não link externo).
- Falha do aviso nunca derruba o tick (catch + log). O aviso não chama cobrança.

- [ ] Testes: rodada com imagem aberta não avisa; com `gerada` sem alertas não avisa; pronta avisa uma vez (2º tick não repete); dois pedidos da mesma rodada → um aviso; outro usuário no mesmo anúncio → aviso próprio; sem chat_id → só app; `telegram_ativo` falso → só app; erro no Telegram não lança; contagem "não saíram" = `falhou`.
- [ ] Implementar; `pnpm exec vitest run supabase/functions/_shared/galeria/__tests__`; `pnpm exec tsc --noEmit`; `npm run db:check` fica para a Task 10 (a migration só sobe com OK do Diego).
- [ ] Commit `feat(galeria-ia): aviso de imagens prontas no app e no Telegram para quem pediu` e push.

---

### Task 9 (sonnet): remover o pipeline antigo

**Files (apagar, com seus testes):**
- Edges: `supabase/functions/galeria-fatos/`, `supabase/functions/galeria-roteiro/` e seus blocos em `supabase/config.toml`.
- `_shared/galeria`: `roteiro.ts`, `layouts.ts`, `layout-area.ts`, `alertas.ts`, `detalhes.ts`, `lupa.ts`; em `prompt.ts` sai `montarPromptCena`; em `regras.ts` saem `LIMITES`, `CAMPOS_DA_MISSAO`, `CAPACIDADE`, `MISSOES_LUPA_PENDENTE`, `lupaPendente`, `missoesSugeridas`; em `referencias.ts` sai o parâmetro `conferir` de `calcularVigencia`; em `etiqueta.ts` saem só os exports que ficarem sem importador.
- Front: `passo-conferir.tsx`, `passo-escolher.tsx`, `esboco-missao.tsx`, `rodape.tsx` (se sem uso), `src/lib/galeria/{compor.ts,contraste.ts,mensagens-roteiro.ts,rascunho.ts,rotulos.ts}`, `src/hooks/useRascunhoRoteiro.ts`; em `api.ts` saem as funções e tipos de fatos, roteiro e lupa e as mensagens órfãs.
- **Manter:** `fatos.ts` (`montarFicha`, `hashFatos`) e, em `etiqueta.ts`, `lerLeituraEtiqueta` e `aplicarEtiqueta`: `lerFicha` (`referencias.ts:13, 153`) usa os dois, e tirá-los mudaria o `fatos_hash` de anúncios com leitura gravada. Tabelas e RPCs ficam (nenhuma migration).

- [ ] **Step 1:** apagar; `pnpm exec tsc --noEmit`, `deno lint supabase/functions`, `pnpm test` → tudo verde. Cada erro de import aponta um resto a remover; não recriar o que foi apagado.
- [ ] **Step 2:** `grep -rn "galeria-fatos\|galeria-roteiro\|comporImagemFinal\|montarPromptCena\|lupa" src supabase/functions --include=*.ts --include=*.tsx` → nenhuma ocorrência em código vivo.
- [ ] **Step 3:** teste de regressão do hash: `hashFatos` de uma ficha de fixture dá o mesmo valor antes e depois da limpeza (rodar o teste existente de `referencias`/`fatos` sem alterar os valores esperados).
- [ ] **Step 4:** docs: `CONTEXT.md` (glossário "Imagens do anúncio por IA": sai roteiro, fatos confirmados, lupa; entra plano e conferência de texto), nota de status no topo do ADR-0201 apontando o ADR-0203, `docs/project-status.md`, `docs/decisions/README.md`; skill `docs-update-checklist`.
- [ ] **Step 5:** commit `refactor(galeria-ia): remove roteiro, fatos em tela, lupa e composição em canvas` e push.

---

### Task 10 (opus, com OK do Diego): deploy das edges e teste real

**Files:** nenhum arquivo de código. Registro em `.superpowers/sdd/2026-11-08-galeria-da-cor/progress.md`.

- [ ] **Step 1:** `pnpm preflight` → verde. Push. CI verde (`frontend`, `backend-lint`).
- [ ] **Step 2 (OK do Diego):** `supabase functions deploy galeria-gerar galeria-worker galeria-imagens galeria-aprovar galeria-aplicar --project-ref txvncrgkoynoxwopfkbp` (`galeria-aplicar` importa `referencias.ts`, que mudou). Conferir `verify_jwt` de cada uma contra `supabase/config.toml` e a versão ativa.
- [ ] **Step 3: teste real, só geração** (dev local apontando para produção, org AVIL, MLB7168683146, cor Branco): "Gerar todas" → 7 imagens; conferir no banco (`galeria_imagens`: `status`, `tentativa`, `alertas`, `custo_usd`) e a cobrança (`platform_image_deliveries`: uma linha por imagem exibida, nenhuma para imagem regerada). Critérios: as 7 chegam em até 5 min; dimensão da imagem do gerador = 1856×2304; texto das imagens = textos do plano ou alerta visível; arquivo final aprovado = JPEG 1200×1540; nenhuma linha presa em `gerando` ou com `alertas` nulo depois de 10 min.
- [ ] **Step 4: segundo produto, muitas cores** (MLB7125891436, Fio Amigurumi, 39 cores, cor Carmim): repetir o Step 3 e medir o tempo da primeira chamada de `galeria-gerar` (cria o plano e calcula a vigência das 39 cores): tem de responder em menos de 120 s. Conferir que o plano omite agulha e espessura (dados em conflito) e que nenhum texto traz nome de cor.
- [ ] **Step 5:** medir em 14 imagens: quantas regeraram e o custo médio por imagem exibida em US$ (`custo_usd` já soma a descartada). Entregar ao Diego os dois números ao lado do preço atual (R$ 0,50) para ele decidir o preço. **Nada é aplicado em anúncio do ML neste step.**
- [ ] **Step 6 (OK do Diego):** aplicar 1 cor em 1 anúncio pela tela (Adicionar), conferir no ML e desfazer; depois decidir com ele se mantém.

---

### Task 11 (loop principal): revisão geral e entrega

- [ ] **Step 1:** revisão geral da feature pelo Fable 5.2 (`claude -p --model claude-fable-5-2 --allowedTools Read,Grep,Glob --disallowedTools Edit,Write,Bash,NotebookEdit < prompt.md`): correta, testada, validada.
- [ ] **Step 2:** pré-merge do Grok 4.7 high, rodada única; corrigir achados; `pnpm preflight`; CI verde.
- [ ] **Step 3 (pedido de merge do Diego):** `git fetch`; conferir timestamp das 10 migrations da galeria contra a main (migration paralela mais nova → recriar antes); merge fast-forward; `supabase db push --linked --dry-run` (esperado: nada a subir); redeploy de **todas** as edges que importam `_shared/` alterado, incluindo `update-familia-ml`, `publicar-split-ml`, `remover-publicado` (trava de escrita) e as `galeria-*`; conferir versões; `supabase functions delete galeria-fatos` e `galeria-roteiro` (OK do Diego); `git pull --ff-only` no checkout principal; apagar branch e worktree.
- [ ] **Step 4:** atualizar o Graphify (skill `graphify-update-maintenance`) e a memória `project_galeria_da_cor.md`.
