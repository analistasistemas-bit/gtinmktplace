# Galeria da cor por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Publicados, gerar até 7 imagens por cor de um anúncio já publicado (roteiro → cenas por IA → texto composto → aprovação → aplicar no ML), cobrando cada imagem gerada.

**Architecture:** Fatos e roteiro em edges síncronas; cada imagem é um job QStash (`galeria-worker`) que chama o provedor (OpenRouter síncrono; Higgsfield assíncrono com nova consulta agendada por QStash), grava a cena no Storage e vira faturável ao chegar a `gerada`. O corte 1200×1540 e a tipografia são compostos **no navegador** (canvas) na aprovação — as edges não têm biblioteca de imagem e têm teto de CPU. Aplicar usa upload multipart ao ML e PUT só de fotos, com foto anterior guardada para reverter.

**Tech Stack:** React + TS (Vite), Supabase (Postgres, Storage, Deno edges), QStash, OpenRouter, Higgsfield API, API do Mercado Livre, vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md` (regras R0–R11) · `docs/decisions/0201-galeria-da-cor-por-ia.md` (§1–§12) · `CONTEXT.md` ("Imagens do anúncio por IA").

## Global Constraints

- Bloco técnico literal ao fim de todo prompt de imagem: `photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard` (R5.4).
- Arquivo final: 1200×1540 JPG, 300 KB–1 MB; corte ao centro, nunca esticar; capa com preenchimento branco; corte >15% bloqueia (R9.1).
- Layout estilo A: Inter, texto #1b1f24 em placa branca ≥92% opaca; fonte ≥5% da largura, títulos 7–8,5%; contraste ≥4,5:1; área segura 6% laterais e 12–88% da altura; ≤3 benefícios, ≤4 pares na ficha (R6.4–R6.5).
- Texto: headline ≤5 palavras, subheadline ≤10, benefício ≤6, etapa ≤7, legenda ≤5; NFC (R6.1–R6.2).
- Moda (ADR §11): nenhuma imagem com texto; missões de Moda conforme R5.5.
- Fato `CONFIRMADO` só de planilha, atributo editado pelo operador ou confirmação explícita do operador (ADR §12, R1.2).
- Modelos liberados: `google/gemini-nano-banana-2.1` (padrão, OpenRouter), `xai/grok-imagine-image-2.0` e `alibaba/qwen-image-3/edit` (Higgsfield, `prompt_extend: true` obrigatório no Qwen; ≤3 referências).
- Teto: geração inicial + 2 por (cor, missão); chave única por geração; falha sem arquivo não cobra (R8.2–R8.3).
- Limite de fotos ML: 10 por variação (`max_pictures_per_item_var`), 12 por item sem variações (`max_pictures_per_item`); ler da categoria ao vivo.
- Aplicar e reverter só com admin da org (ADR §8); PUT só de fotos — nunca preço, estoque ou status (R9.3).
- Migrations só via `supabase migration new` + `supabase db push`; `npm run db:check` (ADR-0043). Edge chamada por QStash: `verify_jwt = false`.
- Segredo `HF_CREDENTIALS` (`KEY_ID:KEY_SECRET`) só em `supabase secrets`; nunca em código.
- Tabelas novas: RLS com `org_id = (select public.current_org_id())` para select; escrita só service_role.
- Retenção (ADR §13): arquivos de imagens aprovadas/aplicadas ficam para sempre; não aprovadas são apagadas do Storage após 30 dias, a linha no banco é preservada.
- Referência da geração: a foto **da própria cor** (`variacoes.imagem_path` no Storage; sem ela, a 1ª foto da variação no ML), nunca a capa multicolor.

## Review Focus

1. **Pedido repetido** (duplo clique, recarga, retry do QStash) — uma única linha faturável por `request_id`. Teste em Task 8 e Task 9.
2. **Anúncio mudou entre preparar e aplicar** (outro admin trocou fotos, cor nova, variação removida) — aplicar para e mostra a diferença, não sobrescreve. Teste em Task 13.
3. **Família UP em que um item falha no meio** — os itens já trocados voltam às fotos anteriores e o resultado fica registrado por item. Teste em Task 14.
4. **Fato sugerido nunca confirmado ou divergente** — não pode aparecer em texto de imagem nem no roteiro aprovado. Teste em Task 6.
5. **Cena do provedor em proporção inesperada** (ex.: 1:1 ou 16:9) — corte >15% bloqueia em vez de deformar. Teste em Task 11.

---

## Fatia 0 — Registro técnico

### Task 0: Adendo ao ADR-0201 (composição no navegador, geração assíncrona, cobrança compartilhada)

**Files:**
- Modify: `docs/decisions/0201-galeria-da-cor-por-ia.md` (seção "Adendo técnico")

- [ ] **Step 1:** Escrever o adendo com 3 decisões e seus porquês: (a) corte e texto compostos em canvas no navegador na aprovação, servidor valida dimensões/peso — edges sem biblioteca de imagem, teto de CPU, sem worker no Render; (b) um job QStash por imagem; Higgsfield consultado por nova mensagem com `delay: 15` até 6 min; (c) função de cobrança compartilhada `platform_registrar_imagem(...)` chamada por gatilho em cada tabela de origem.
- [ ] **Step 2:** Commit `docs(galeria-ia): adendo técnico ao ADR-0201`.

## Fatia 1 — Fundação

### Task 1: Tabelas da galeria e cobrança compartilhada

**Files:**
- Create: `supabase/migrations/<ts>_galeria_da_cor.sql` (via `supabase migration new galeria_da_cor`)
- Create: `scripts/sql/teste-galeria-cobranca.sql` (teste em transação desfeita, padrão "Teste SQL sem Docker")

**Interfaces:**
- Produces (tabelas, todas com `org_id uuid not null references public.organizations(id)`, RLS select por org, escrita só service_role):
  - `galeria_fatos(id uuid pk, org_id, familia_id uuid, campo text, valor text, origem text check in ('planilha','atributo_operador','confirmado_operador'), evidencia jsonb, confirmado_por uuid null, confirmado_em timestamptz null, descartado boolean default false, unique(org_id, familia_id, campo))`
  - `galeria_roteiros(id uuid pk, org_id, familia_id, versao int, conteudo jsonb, status text check in ('rascunho','aprovado'), criado_por uuid, aprovado_por uuid null, criado_em, aprovado_em null, unique(org_id, familia_id, versao))`
  - `galeria_imagens(id uuid pk, org_id, familia_id, roteiro_id uuid references galeria_roteiros, cor text, missao smallint check between 1 and 7, geracao smallint check between 1 and 3, request_id uuid not null, modelo text, provedor text check in ('openrouter','higgsfield'), provider_request_id text null, status text check in ('pendente','gerando','gerada','falhou','aprovada','descartada'), cena_path text null, final_path text null, custo_usd numeric(12,6) default 0, alertas jsonb default '[]', erro text null, aprovado_por uuid null, aprovado_em null, criado_em, atualizado_em, unique(org_id, request_id), unique(org_id, roteiro_id, cor, missao, geracao))`
  - `galeria_aplicacoes(id uuid pk, org_id, familia_id, cor text, item_id text, modo text check in ('substituir','adicionar'), fotos_antes jsonb, fotos_depois jsonb null, status text check in ('aplicando','aplicada','falhou','revertida'), erro text null, aplicado_por uuid, criado_em, atualizado_em)`
  - `platform_image_deliveries.origem text not null default 'kit_variacao'` (nova coluna).
  - Função `public.platform_registrar_imagem(p_org uuid, p_request uuid, p_custo_usd numeric, p_origem text)` — corpo de `platform_image_delivery_on_generated()` atual (lock da org, mês com `America/Fortaleza`, `platform_resolve_terms`, `units` 0/1, `reason`, `on conflict (org_id, request_id) do nothing`) + grava `origem`.
  - `platform_image_delivery_on_generated()` passa a chamar `platform_registrar_imagem(new.org_id, new.request_id, new.custo_usd, 'kit_variacao')`.
  - Gatilho novo `galeria_imagens_cobranca after insert or update of status on public.galeria_imagens for each row when (new.status = 'gerada')` → `platform_registrar_imagem(new.org_id, new.request_id, new.custo_usd, 'galeria')`.

- [ ] **Step 1: Teste SQL que falha** (`scripts/sql/teste-galeria-cobranca.sql`, `begin; … rollback;`): org de teste com módulo `imagem_ia` e termos com `image_unit_cents = 50`; inserir `galeria_imagens` `pendente` → 0 linhas em `platform_image_deliveries`; atualizar para `gerada` → 1 linha `units=1, total_cents=50, origem='galeria'`; atualizar de novo `gerada→gerada` → continua 1 linha; org sem módulo → `units=0, reason='modulo_desligado'`; linha de `kit_variacao_imagens` virando `gerada` → `origem='kit_variacao'` (não regrediu).
- [ ] **Step 2:** Rodar contra produção em transação desfeita (Management API) — Expected: falha (tabela inexistente).
- [ ] **Step 3:** Escrever a migration com as interfaces acima.
- [ ] **Step 4:** Rodar o conteúdo da migration seguido do teste dentro de um único `begin … rollback` pela Management API (nada fica gravado); Expected: todas as asserções `ok`.
- [ ] **Step 5:** Commit `feat(galeria-ia): tabelas da galeria e cobrança compartilhada`. (O `db push` real acontece no deploy final, Task 16.)

### Task 2: Regras puras (limites, bloco técnico, proibidos, Moda, missões)

**Files:**
- Create: `supabase/functions/_shared/galeria/regras.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/regras.test.ts`

**Interfaces:**
- Produces:
  - `export const BLOCO_TECNICO: string` (frase exata das Global Constraints)
  - `export const LIMITES = { headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5, beneficios: 3, fichaPares: 4 } as const`
  - `export type Missao = 1|2|3|4|5|6|7`
  - `export function missoesDisponiveis(moda: boolean): Array<{ missao: Missao; nome: string; comTexto: boolean }>` (Moda: nomes de R5.5, `comTexto: false` em todas; demais: R5.1, `comTexto: missao !== 1`)
  - `export function missoesSugeridas(nCores: number): Missao[]` (≤3 cores → 1..7; >3 → 1..4)
  - `export function ehModa(pathFromRoot: Array<{ id: string }>): boolean` (raiz `MLB1430`)
  - `export function contarPalavras(texto: string): number` (NFC, separa por espaço)
  - `export function termosProibidos(texto: string, categoria: 'cosmeticos'|'vestuario'|'aviamentos'|'geral'): string[]` (listas fechadas de R4.2–R4.4)

- [ ] **Step 1: Testes que falham:** `BLOCO_TECNICO` igual à string literal; `missoesSugeridas(3)` = `[1,2,3,4,5,6,7]`, `missoesSugeridas(4)` = `[1,2,3,4]`; `missoesDisponiveis(true).every(m => !m.comTexto)`; `missoesDisponiveis(false).find(m => m.missao === 1)!.comTexto === false`; `ehModa([{id:'MLB1430'},{id:'MLB31447'}]) === true`, `ehModa([{id:'MLB1574'}]) === false`; `contarPalavras('Largura certa: 20 mm') === 4`; `termosProibidos('Frete grátis e premium', 'geral')` contém `'frete grátis'` e `'premium'`; `termosProibidos('100% natural', 'cosmeticos')` contém `'100% natural'`.
- [ ] **Step 2:** `pnpm vitest run supabase/functions/_shared/galeria/__tests__/regras.test.ts` — Expected: FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `regras.ts` (sem `jsr:`/`npm:` — módulo puro para vitest).
- [ ] **Step 4:** Rodar de novo — Expected: PASS.
- [ ] **Step 5:** Antes do commit, conferir `MLB1430` com uma chamada real `GET /categories/MLB31447` (path_from_root da categoria de uma regata publicada); ajustar se a raiz for outra. Commit `feat(galeria-ia): regras puras da galeria`.

### Task 3: Provedores (registro de modelos + cliente Higgsfield)

**Files:**
- Create: `supabase/functions/_shared/galeria/provedores.ts`
- Create: `supabase/functions/_shared/ai/higgsfield.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/provedores.test.ts`, `supabase/functions/_shared/ai/__tests__/higgsfield.test.ts`

**Interfaces:**
- Produces:
  - `export interface ModeloGaleria { slug: string; provedor: 'openrouter'|'higgsfield'; endpoint?: string; campoReferencia?: 'image_urls'; maxReferencias: number; extra: Record<string, unknown>; custoUsd: number; rotulo: string }`
  - `export const MODELOS_GALERIA: ModeloGaleria[]` — nano (`custoUsd` 0.039, ref por data URL), grok (`extra: {resolution:'1k', quality:'medium', aspect_ratio:'3:4'}`, `custoUsd` 0.06), qwen (`extra: {resolution:'1k', aspect_ratio:'3:4', prompt_extend:true}`, `maxReferencias: 3`, `custoUsd` 0.04)
  - `export const MODELO_GALERIA_PADRAO = 'google/gemini-nano-banana-2.1'`
  - `export function modeloGaleria(slug: string | null): ModeloGaleria` (slug desconhecido → padrão)
  - `higgsfield.ts`: `export async function submeterHF(endpoint: string, entrada: Record<string, unknown>): Promise<string>` (devolve `request_id`); `export async function consultarHF(requestId: string): Promise<{ status: 'pendente'|'concluida'|'falhou'; url?: string; erro?: string }>`; credencial de `Deno.env.get('HF_CREDENTIALS')`, header `Authorization: Key <id>:<secret>`; status `completed`→`concluida`, `failed|nsfw|canceled`→`falhou`, demais→`pendente`.

- [ ] **Step 1: Testes que falham:** `modeloGaleria('x').slug === MODELO_GALERIA_PADRAO`; qwen tem `extra.prompt_extend === true`; `submeterHF` com fetch mockado envia `POST https://api.higgsfield.ai/<endpoint>`, header `Authorization` começa com `Key `, corpo = entrada; `consultarHF` mapeia `{status:'completed', images:[{url:'u'}]}` → `{status:'concluida', url:'u'}` e `{status:'nsfw'}` → `falhou`; resposta 401 → lança erro com status.
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Implementar (sem `jsr:` em `provedores.ts`; `higgsfield.ts` só `fetch` + `Deno.env`).
- [ ] **Step 4:** Rodar — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): registro de modelos e cliente Higgsfield`.

### Task 4: Modelo da galeria por organização

**Files:**
- Create: `supabase/migrations/<ts>_configuracoes_ai_model_galeria.sql`
- Modify: `src/lib/ai-modelos.ts` (novo `MODELOS_GALERIA_UI: OpcaoModeloIA[]`), `src/components/configuracoes/secao-ia.tsx` (novo `Select` de `src/components/ui/select.tsx`)
- Test: `src/lib/__tests__/ai-modelos-galeria.test.ts`

**Interfaces:**
- Produces: coluna `configuracoes.ai_model_galeria text null` com check `in ('google/gemini-nano-banana-2.1','xai/grok-imagine-image-2.0','alibaba/qwen-image-3/edit')`; `resolverModeloGaleria(admin, orgId): Promise<ModeloGaleria>` em `_shared/galeria/provedores.ts` (erro/nulo → padrão).
- [ ] **Step 1:** Teste: slugs de `MODELOS_GALERIA_UI` são exatamente os 3 slugs de `MODELOS_GALERIA` (importar ambos) e o primeiro é o padrão.
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Migration + lista + seletor (rótulos "Nano Banana 2.1 (padrão)", "Grok Imagine 2 (Higgsfield)", "Qwen Image 3 Edit (Higgsfield)"); só admin da plataforma edita (mesma regra do seletor atual de imagem).
- [ ] **Step 4:** Rodar + `pnpm lint` — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): modelo da galeria por organização`.

## Fatia 2 — Fatos e roteiro

### Task 5: Ficha Verdade (fatos confirmados × sugeridos × divergência)

**Files:**
- Create: `supabase/functions/_shared/galeria/fatos.ts`, `supabase/functions/galeria-fatos/index.ts`
- Modify: `supabase/config.toml` (`[functions.galeria-fatos] verify_jwt = true`)
- Test: `supabase/functions/_shared/galeria/__tests__/fatos.test.ts`

**Interfaces:**
- Produces:
  - `export type EstadoFato = 'CONFIRMADO'|'SUGERIDO'|'DIVERGENTE'|'NAO_CONFERIDO'`
  - `export interface Fato { campo: string; valor: string; estado: EstadoFato; origem: string; evidencia: string; etiqueta?: string }`
  - `export function montarFicha(entrada: { planilha: Record<string, string|null>; atributosOperador: Array<{id: string; valor: string}>; atributosIA: Array<{id: string; valor: string}>; textosIA: { titulo: string; descricao: string }; confirmados: Array<{campo: string; valor: string; descartado: boolean}> }): Fato[]`
  - `export function aplicarEtiqueta(fichas: Fato[], leitura: Array<{campo: string; valor: string|null; legivel: boolean}>): Fato[]` (valor igual → mantém; diferente e legível → `DIVERGENTE` com `etiqueta`; ilegível → `NAO_CONFERIDO`)
  - Edge `galeria-fatos`: `POST {familia_id, acao: 'montar'}` → `{fatos: Fato[], recorte_etiqueta_url: string|null}`; `POST {familia_id, acao: 'confirmar'|'descartar', campo, valor}` → grava `galeria_fatos` (`confirmado_operador`, `confirmado_por`); `acao: 'manter_cadastro'|'corrigir_cadastro'` para DIVERGENTE (corrigir grava só na família, nunca no ML). Gate `exigirModulo(admin, orgId, 'imagem_ia')`.
- [ ] **Step 1: Testes que falham:** planilha `{LARGURA_CM: '2'}` → fato `CONFIRMADO` origem `planilha`; material só em `descricao` IA → `SUGERIDO`; sugerido confirmado em `confirmados` → `CONFIRMADO` origem `confirmado_operador`; descartado → ausente; renda: `MATERIAL='100% POLIÉSTER'` (atributo IA) + etiqueta legível `'100% Poliamida'` → `DIVERGENTE` com `etiqueta: '100% Poliamida'`; regata: atributo `Poliamida` × descrição `96% poliéster` → `DIVERGENTE` mesmo sem etiqueta (conflito interno).
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Implementar `fatos.ts` (puro) e a edge; a leitura da etiqueta usa `visaoJson` com `MODELO_VISION` sobre a foto da cor e devolve também a caixa do recorte (x,y,w,h) que o front usa para mostrar o recorte.
- [ ] **Step 4:** Rodar + `pnpm check:functions` — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): ficha verdade com sugeridos e divergência`.

### Task 6: Roteiro (IA escreve, código valida)

**Files:**
- Create: `supabase/functions/_shared/galeria/roteiro.ts`, `supabase/functions/galeria-roteiro/index.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/_shared/galeria/__tests__/roteiro.test.ts`

**Interfaces:**
- Consumes: `Fato`, `LIMITES`, `missoesDisponiveis`, `termosProibidos`, `contarPalavras`.
- Produces:
  - `export interface MissaoRoteiro { missao: Missao; ativa: boolean; cena: string; headline?: string; subheadline?: string; beneficios?: string[]; specs?: Array<[string, string]>; etapas?: string[]; legendas?: string[]; fatosUsados: string[] }`
  - `export interface Roteiro { moda: boolean; categoria: 'cosmeticos'|'vestuario'|'aviamentos'|'geral'; contrato: string; missoes: MissaoRoteiro[] }`
  - `export function validarRoteiro(r: Roteiro, fatos: Fato[]): string[]` (lista de erros; vazio = válido)
  - Edge `galeria-roteiro`: `POST {familia_id, acao:'criar', missoes: Missao[]}` (IA de texto com `resolverModeloIA` da org, saída JSON do schema `Roteiro`, recusa se houver fato `DIVERGENTE`), `acao:'salvar', versao, conteudo` (edição; revalida), `acao:'aprovar', versao`.
- [ ] **Step 1: Testes que falham:** headline de 6 palavras → erro `headline > 5`; 4 benefícios → erro; spec com valor que não é de fato `CONFIRMADO` → erro `fato não confirmado: <campo>`; texto com "premium" → erro de proibido; roteiro `moda: true` com `headline` em qualquer missão → erro `moda sem texto`; missão 1 com `headline` → erro; roteiro com fato `DIVERGENTE` em `fatos` → erro `divergência pendente`; roteiro válido do caso renda (largura 20 mm, 50 m, marca Búfalo; sem composição) → `[]`.
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Implementar `validarRoteiro` (puro) e a edge; o prompt de sistema traz R1–R5 resumidas, lista de fatos `CONFIRMADO` e as missões pedidas; o código nunca aprova roteiro com erro.
- [ ] **Step 4:** Rodar — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): roteiro com validação em código`.

### Task 7: Tela — Fatos e Roteiro (dialog da galeria, passos 1–2)

**Files:**
- Create: `src/components/galeria/dialog-galeria.tsx`, `src/components/galeria/passo-fatos.tsx`, `src/components/galeria/passo-roteiro.tsx`, `src/lib/galeria/api.ts`
- Modify: `src/pages/Publicados.tsx` (botão "Galeria IA", ícone `Images`, em `LinhaTabela` ao lado de "Criar kit com variação"; estado `galeriaDe: string|null`; dialog no fim da página)
- Test: `src/components/galeria/__tests__/dialog-galeria.test.tsx`

**Interfaces:**
- Consumes: edges `galeria-fatos`, `galeria-roteiro`.
- Produces: `DialogGaleria({ familiaId, open, onOpenChange, isAdmin })`; `src/lib/galeria/api.ts` com `montarFatos(familiaId)`, `decidirFato(...)`, `criarRoteiro(...)`, `salvarRoteiro(...)`, `aprovarRoteiro(...)`, `gerarImagens(...)`, `listarImagens(...)`, `aprovarImagem(...)`, `aplicarGaleria(...)`, `reverterGaleria(...)` (assinaturas espelham os corpos das edges das Tasks 5, 6, 8, 12, 14).
- [ ] **Step 1: Testes que falham:** botão "Galeria IA" ausente sem módulo `imagem_ia`; fato `DIVERGENTE` mostra recorte e o botão "Usar o da etiqueta" pré-selecionado; botão "Gerar roteiro" desabilitado com divergência pendente; contadores de palavras ficam vermelhos acima do limite; "Aprovar roteiro" desabilitado com erro de validação.
- [ ] **Step 2:** `pnpm vitest run src/components/galeria` — FAIL.
- [ ] **Step 3:** Implementar (Select de `src/components/ui/select.tsx`; padrão de espera em diálogos do ADR-0163).
- [ ] **Step 4:** Rodar + `pnpm lint` — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): fatos e roteiro na tela`.

## Fatia 3 — Geração

### Task 8: Pedido de geração (orçamento, teto, idempotência)

**Files:**
- Create: `supabase/functions/galeria-gerar/index.ts`, `supabase/functions/_shared/galeria/pedido.ts`
- Test: `supabase/functions/_shared/galeria/__tests__/pedido.test.ts`

**Interfaces:**
- Produces:
  - `export function planejarGeracoes(entrada: { cores: string[]; missoes: Missao[]; existentes: Array<{cor: string; missao: Missao; geracao: number}> }): { novas: Array<{cor: string; missao: Missao; geracao: number}>; bloqueadas: Array<{cor: string; missao: Missao; motivo: 'teto'}> }` (geração = maior existente + 1; >3 → bloqueada)
  - `export function idDerivado(requestId: string, cor: string, missao: Missao, geracao: number): string` (UUID v5 determinístico)
  - Edge `galeria-gerar`: `POST {familia_id, roteiro_versao, cores, missoes, request_id}` → gate módulo; roteiro `aprovado`; cor sem foto real → recusada sem custo; insere linhas `pendente` com `request_id` derivado (`uuidv5(request_id, cor|missao|geracao)`); publica 1 mensagem QStash por linha (`url: …/galeria-worker`, `retries: 3`); repetir o mesmo `request_id` devolve as mesmas linhas sem publicar de novo. Resposta inclui `custo_estimado_centavos` = novas × `image_unit_cents`.
- [ ] **Step 1: Testes que falham:** 2 cores × 3 missões sem existentes → 6 novas com `geracao: 1`; existente `(Rosa, 2, 3)` → `(Rosa, 2)` bloqueada `teto`; mesma entrada duas vezes com o mesmo `request_id` gera os mesmos ids derivados (função `idDerivado(requestId, cor, missao, geracao)` determinística).
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Implementar; a tela mostra o custo e pede confirmação antes de chamar (Task 10).
- [ ] **Step 4:** Rodar — PASS.
- [ ] **Step 5:** Commit `feat(galeria-ia): pedido de geração com teto e idempotência`.

### Task 9: Worker de geração (provedores, consulta, Storage, alertas)

**Files:**
- Create: `supabase/functions/galeria-worker/index.ts`, `supabase/functions/_shared/galeria/prompt.ts`, `supabase/functions/_shared/galeria/alertas.ts`
- Modify: `supabase/config.toml` (`[functions.galeria-worker] verify_jwt = false`)
- Test: `supabase/functions/_shared/galeria/__tests__/prompt.test.ts`, `.../alertas.test.ts`

**Interfaces:**
- Consumes: `MODELOS_GALERIA`, `submeterHF`, `consultarHF`, `gerarImagem` (`_shared/ai/imagem.ts`, com `extra: {aspect_ratio: '3:4'}`), `verificarAssinatura` (`_shared/queue.ts`). Referência = foto da própria cor: OpenRouter recebe data URL; Higgsfield recebe URL assinada de 2 h (`createSignedUrl(path, 7200)`), em `image_urls`.
- Produces:
  - `export function montarPromptCena(m: MissaoRoteiro, r: Roteiro, cor: string, layout: 'topo'|'esquerda'|'nenhum'|'paineis'): string` — termina com `BLOCO_TECNICO`; inclui `r.contrato`, proibidos e a instrução "não escrever texto" (texto da embalagem real permanece).
  - `export function interpretarAlertas(resposta: unknown): Array<{ tipo: 'cor'|'produto'|'texto_na_cena'|'rotulo_alterado'; nota: string }>`
  - Worker: corpo `{imagem_id, fase: 'gerar'|'consultar', tentativa?}`; claim `pendente→gerando` (ou consulta de `gerando` com `provider_request_id`); OpenRouter → bytes direto; Higgsfield → `submeterHF` grava `provider_request_id` e publica `{fase:'consultar'}` com `delay: 15`; consulta repete até 24 vezes (6 min) e então `falhou` (sem cobrança); com bytes → Storage `${orgId}/galeria-ia/${familiaId}/${cor-slug}/${missao}-${geracao}-${imagem_id}.${ext}` → alertas por visão (referência + cena) → `status='gerada'`, `custo_usd` (OpenRouter `usage.cost`; Higgsfield `custoUsd` do registro).
- [ ] **Step 1: Testes que falham:** `montarPromptCena(...).endsWith(BLOCO_TECNICO)`; prompt de missão de Moda não contém "headline"; layout `esquerda` contém "left 45%"; `interpretarAlertas({cor_diferente: true, texto_adicionado: true})` → tipos `cor` e `texto_na_cena`; resposta ilegível → `[]` (nunca bloqueia).
- [ ] **Step 2:** Rodar — FAIL.
- [ ] **Step 3:** Implementar; worker responde 5xx em erro transitório (QStash repete) e é idempotente por `status`.
- [ ] **Step 4:** Rodar + `pnpm check:functions` — PASS.
- [ ] **Step 5:** Teste manual de ponta a ponta com 1 imagem por modelo numa família de teste (≈US$ 0,15), conferir 1 linha em `platform_image_deliveries` por imagem. Commit `feat(galeria-ia): worker de geração`.

### Task 10: Tela — gerar e acompanhar

**Files:**
- Create: `src/components/galeria/passo-gerar.tsx`, `src/components/galeria/cartao-imagem.tsx`
- Test: `src/components/galeria/__tests__/passo-gerar.test.tsx`

**Interfaces:** Consumes `gerarImagens`, `listarImagens` (Task 7). Produces `CartaoImagem({ imagem, onGerarDeNovo, onAprovar })`.
- [ ] **Step 1: Testes que falham:** seleção de missões vem pré-marcada por `missoesSugeridas(nCores)`; diálogo de confirmação mostra "N imagens · R$ X"; cartão com alerta mostra o texto do alerta; "Gerar de novo" mostra o preço e some na 3ª geração; cor sem foto aparece desabilitada com motivo.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar (polling `listarImagens` a cada 5 s enquanto houver `pendente|gerando`). **Step 4:** PASS. **Step 5:** Commit `feat(galeria-ia): gerar e acompanhar na tela`.

## Fatia 4 — Composição e aprovação

### Task 11: Layouts e contraste (cálculo puro)

**Files:**
- Create: `src/lib/galeria/layouts.ts`, `src/lib/galeria/contraste.ts`, `src/lib/galeria/corte.ts`
- Test: `src/lib/galeria/__tests__/layouts.test.ts`, `contraste.test.ts`, `corte.test.ts`

**Interfaces:**
- Produces:
  - `export function razaoContraste(a: string, b: string): number`
  - `export function corDeAcento(corProduto: string): string` (cor do produto se `razaoContraste(cor, '#ffffff') >= 4.5`, senão `#1b1f24`)
  - `export function planejarCorte(w: number, h: number, capa: boolean): { tipo: 'corte'|'preenchimento'|'bloqueado'; sx: number; sy: number; sw: number; sh: number; perda: number }` (alvo 1200:1540)
  - `export interface Caixa { x: number; y: number; w: number; h: number; fontePx: number }`
  - `export function layoutMissao(m: Missao, textos: MissaoRoteiro): Caixa[]` (coordenadas no arquivo de 1200×1540)
- [ ] **Step 1: Testes que falham:** `razaoContraste('#ffffff', '#1b1f24') > 16`; `corDeAcento('#139aa0') === '#1b1f24'`, `corDeAcento('#1f2a52') === '#1f2a52'`; `planejarCorte(864, 1152, false)` → `tipo 'corte'`, `perda` ≈ 0,037; `planejarCorte(1024, 1024, false)` → `bloqueado` (perda > 0,15); `planejarCorte(1024, 1024, true)` → `preenchimento`; para toda missão 2–7 do caso renda: toda caixa `fontePx >= 60`, `x >= 72`, `x + w <= 1128`, `y >= 184.8`, `y + h <= 1355.2`.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar (sem DOM). **Step 4:** PASS. **Step 5:** Commit `feat(galeria-ia): layouts, corte e contraste`.

### Task 12: Composição no navegador e aprovação

**Files:**
- Create: `src/lib/galeria/compor.ts`, `supabase/functions/galeria-aprovar/index.ts`
- Modify: `src/components/galeria/cartao-imagem.tsx` (botão "Aprovar" → compõe → envia)
- Test: `src/lib/galeria/__tests__/compor.test.ts` (canvas mockado: ordem das chamadas), `supabase/functions/galeria-aprovar/__tests__/validar.test.ts`

**Interfaces:**
- Consumes: `planejarCorte`, `layoutMissao`, `corDeAcento`, `dimensoesImagem` (`_shared/ai/imagem.ts`).
- Produces: `export async function comporImagemFinal(cenaUrl: string, missao: Missao, textos: MissaoRoteiro, corProduto: string, moda: boolean): Promise<Blob>` (JPEG q=0.85, cai para 0.80 se >1 MB; espera `document.fonts.load('600 60px Inter')`); edge `galeria-aprovar`: `POST {imagem_id}` depois do upload do cliente em `final_path` assinado → valida 1200×1540, JPEG, 300 KB–1 MB → `status='aprovada'`, `aprovado_por`; `export function validarArquivoFinal(bytes: Uint8Array): string[]`.
- [ ] **Step 1: Testes que falham:** `validarArquivoFinal` de PNG → erro `formato`; JPEG 1200×1200 → erro `dimensoes`; JPEG 1200×1540 de 200 KB → erro `peso`; compor com `moda: true` não chama `fillText`; missão 1 não chama `fillText`.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat(galeria-ia): composição e aprovação`.

## Fatia 5 — Aplicar no ML

### Task 13: Upload multipart e plano de fotos (puro)

**Files:**
- Modify: `supabase/functions/_shared/ml/fotos.ts` (nova `subirFotoMLArquivo`)
- Create: `supabase/functions/_shared/galeria/aplicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/fotos-arquivo.test.ts`, `supabase/functions/_shared/galeria/__tests__/aplicar.test.ts`

**Interfaces:**
- Produces:
  - `export async function subirFotoMLArquivo(accessToken: string, bytes: Uint8Array, mime: string): Promise<{ id: string; pronta: boolean }>` (multipart campo `file`, `User-Agent: Mozilla/5.0`; `pronta = Array.isArray(resp.variations) && resp.variations.length > 0`)
  - `export function planejarFotosItem(entrada: { item: ItemMLAtual; variacoesDaCor: number[] | null; novas: string[]; modo: 'substituir'|'adicionar'; limiteVar: number; limiteItem: number; snapshot: string[] }): { ok: true; corpo: { pictures: Array<{id: string}>; variations?: Array<{ id: number; picture_ids: string[] }> } } | { ok: false; motivo: 'mudou'|'limite'|'variacao_ausente'; detalhe: string }`
- [ ] **Step 1: Testes que falham:** item com 2 variações (Rosa, Azul) e modo `substituir` na Rosa → `variations` contém as duas, Azul com `picture_ids` intactos, Rosa só com `novas`, `pictures` = união; nenhuma chave `price`, `available_quantity` ou `status` no corpo; modo `adicionar` com 4 atuais + 7 novas e `limiteVar: 10` → `ok:false, motivo:'limite'`; `snapshot` diferente das fotos atuais da cor → `motivo:'mudou'`; item sem variações (UP) → corpo só `pictures`; `subirFotoMLArquivo` com fetch mockado envia `FormData` com campo `file` e devolve `pronta:false` quando a resposta não tem `variations`.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat(galeria-ia): upload multipart e plano de fotos`.

### Task 14: Aplicar e reverter (edge, só admin)

**Files:**
- Create: `supabase/functions/galeria-aplicar/index.ts`
- Modify: `supabase/functions/_shared/ml/atualizar-item.ts` (nova `atualizarFotosItemML(accessToken, itemId, corpo)` — PUT só com o corpo de `planejarFotosItem`)
- Test: `supabase/functions/galeria-aplicar/__tests__/orquestrar.test.ts` (orquestração pura com ML mockado)

**Interfaces:**
- Consumes: `planejarFotosItem`, `subirFotoMLArquivo`, `buscarItemML`, `descobrirFamiliaUP`, `getValidAccessTokenConexao`, `resolverConexaoEstrita`.
- Produces: edge `POST {familia_id, cor, modo, acao:'aplicar'|'reverter', aplicacao_id?}`; `requireUserOrg` + `isAdmin || support.scope==='full'` senão 403; categoria de Moda/limite lidos ao vivo (`GET /categories/{id}`); para cada item alvo (UP: todos os itens daquela cor, por `descobrirFamiliaUP`; legacy: o item): grava `galeria_aplicacoes` `aplicando` com `fotos_antes`, sobe as aprovadas na ordem das missões, PUT, GET de conferência (variação da cor com os ids esperados e na ordem; demais intactas); falha em qualquer item → reverte os já trocados com `fotos_antes` e marca `falhou`; `reverter` só sobrescreve se as fotos atuais forem as `fotos_depois` gravadas, senão devolve `motivo:'mudou'`.
  - `export async function orquestrarAplicacao(deps: DepsAplicar, alvo: AlvoAplicar): Promise<ResultadoAplicar>` (puro com dependências injetadas, para teste)
- [ ] **Step 1: Testes que falham:** UP com 3 itens, PUT do 2º falha → 1º revertido com `fotos_antes`, 3º intocado, resultado `falhou` com detalhe por item; GET de conferência mostrando ordem diferente → `falhou` e reversão; foto que volta `pronta:false` → nenhum PUT; não admin → 403; `reverter` com fotos atuais ≠ `fotos_depois` → `mudou` sem PUT.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar. **Step 4:** PASS + `pnpm check:functions`. **Step 5:** Commit `feat(galeria-ia): aplicar e reverter no ML`.

### Task 15: Tela — aplicar e reverter

**Files:**
- Create: `src/components/galeria/passo-aplicar.tsx`
- Test: `src/components/galeria/__tests__/passo-aplicar.test.tsx`

**Interfaces:** Consumes `aplicarGaleria`, `reverterGaleria`.
- [ ] **Step 1: Testes que falham:** não admin vê botões desabilitados com `title` explicando (padrão ADR-0060); confirmação lista os MLB afetados e o modo (Substituir pré-selecionado); `motivo:'limite'` mostra "Adicionar passa do limite de 10 fotos desta cor — usar Substituir?"; `motivo:'mudou'` mostra a diferença; resultado `aplicada` oferece "Reverter".
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat(galeria-ia): aplicar e reverter na tela`.

## Fatia 6 — Retenção, entrega e validação

### Task 16: Retenção, deploy e documentação

**Files:**
- Create: `supabase/migrations/<ts>_galeria_retencao_cron.sql` (pg_cron diário: apaga do Storage arquivos de `galeria_imagens` com `status in ('gerada','descartada','falhou')` e `criado_em < now() - interval '30 days'`; zera `cena_path`, mantém a linha; ADR §13)
- Modify: `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md` (skill `docs-update-checklist`)
- [ ] **Step 1:** `pnpm preflight` — Expected: tudo verde.
- [ ] **Step 2:** `supabase secrets set HF_CREDENTIALS=…` (Diego executa com `!`), `supabase db push`, `npm run db:check`, `supabase functions deploy galeria-fatos galeria-roteiro galeria-gerar galeria-worker galeria-aprovar galeria-aplicar` + `gerar-foto-kit` (gatilho de cobrança alterado não muda a edge, mas `_shared/ml/fotos.ts` e `atualizar-item.ts` mudaram → redeployar todas as funções que importam esses arquivos; listar com grep e conferir versão pós-deploy).
- [ ] **Step 3:** Validação real (com Diego): 1 família de teste escolhida por ele, 1 cor, missões 1–4, gerar → aprovar → aplicar → conferir no ML → reverter → conferir. Registrar custo e a linha de cobrança.
- [ ] **Step 4:** Commit `docs(galeria-ia): entrega da galeria da cor`.

---

## Revisão e execução

- Cada task: revisão do diff pelo Codex (`gpt-6.1-sol`, high) **e** pelo Grok 4.7 xhigh (decisão do Diego para esta feature).
- Pré-merge da branch: Grok 4.7 xhigh no diff completo + CI verde.
