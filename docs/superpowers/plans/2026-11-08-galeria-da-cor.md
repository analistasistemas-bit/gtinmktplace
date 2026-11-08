# Galeria da cor por IA — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Publicados, gerar até 7 imagens por cor de um anúncio já publicado (fatos → roteiro → cenas por IA → texto composto → aprovação → aplicar no ML), cobrando cada imagem entregue.

**Architecture:** Fatos e roteiro em edges síncronas. Cada imagem é um job QStash com claim por tentativa e lease; Higgsfield é consultado por novos jobs agendados com claim por rodada e prazo absoluto. Corte 1200×1540 e tipografia são compostos no navegador (canvas) na aprovação; a missão 7 e as lupas saem de recortes da foto real, sem gerador. Aplicar é uma saga persistida: preparação com retrato completo do anúncio, um job por item na fila serial da conta, fotos anteriores gravadas antes do PUT, retomada por GET e varredura de itens presos.

**Tech Stack:** React + TS (Vite), Supabase (Postgres, Storage, Deno edges), QStash, OpenRouter, Higgsfield API, API do Mercado Livre, vitest, Playwright (render real do canvas).

**Spec:** `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md` (R0–R11) · `docs/decisions/0201-galeria-da-cor-por-ia.md` (§1–§13) · `CONTEXT.md` ("Imagens do anúncio por IA").

**Histórico:** v1 revisada por Codex (`gpt-6.1-sol` high) e Grok 4.7 xhigh — ambos REVISAR; v2 incorpora os 8 + 8 achados.

## Global Constraints

- Bloco técnico literal ao fim de todo prompt de imagem: `photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard` (R5.4).
- Arquivo final: 1200×1540 JPEG, 60 KB–1 MB (piso só contra arquivo vazio/branco); corte ao centro, nunca esticar; capa com preenchimento branco; corte >15% bloqueia (R9.1).
- Layout estilo A: Inter, texto #1b1f24 em placa branca ≥92% opaca; fonte ≥5% da largura, títulos 7–8,5%; contraste ≥4,5:1 na cor composta; área segura 6% laterais e 12–88% da altura; ≤3 benefícios, ≤4 pares na ficha (R6.4–R6.5).
- Texto: headline ≤5 palavras, subheadline ≤10, benefício ≤6, etapa ≤7, legenda ≤5; NFC (R6.1–R6.2).
- Moda (ADR §11): decidida pela **edge** pela categoria lida ao vivo (`path_from_root`), nunca pelo modelo de IA; em Moda nenhuma imagem leva texto.
- Fato `CONFIRMADO` só da planilha ou de confirmação explícita do operador por campo. `atributos_ml`, `titulo_ml`, `descricao_ml` são `SUGERIDO` — a marca `atributos_editados_pelo_operador` é da família inteira e não prova a origem de cada atributo (ADR §12).
- Missão 7 e lupas: recortes da foto real da cor, compostos no navegador; não chamam provedor e não são cobrados (R3.3).
- Modelos: `google/gemini-nano-banana-2.1` (padrão), `xai/grok-imagine-image-2.0`, `alibaba/qwen-image-3/edit` (`prompt_extend: true`, ≤3 refs).
- Referência: foto da própria cor (`variacoes.imagem_path`; sem ela, 1ª foto da variação no ML); nunca capa multicolor.
- Cobrança: uma linha por `request_id` da imagem quando ela é **entregue à tela pela primeira vez** (`entregue_em`), com arquivo validado; teto 3 gerações por (cor, missão, versão do roteiro), contando só gerações entregues (R8.2–R8.3).
- Limite ML: 10 fotos por variação, 12 por item sem variações, lidos da categoria ao vivo.
- Aplicar/reverter: só admin; PUT só de fotos (mais o que o ensaio da Task 13 provar obrigatório); recusar `catalog_listing` e tag `variations_migration_pending`; fila serial da conta.
- Migrations via `supabase migration new` + `supabase db push`; `npm run db:check`. Funções SQL novas: `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`. Teste SQL com `set local lock_timeout = '5s'`.
- Edge chamada por QStash: `verify_jwt = false` + `verificarAssinatura`. `HF_CREDENTIALS` só em `supabase secrets`.
- Retenção (ADR §13): aprovadas/aplicadas ficam; não aprovadas apagadas do Storage após 30 dias; linha preservada.

## Review Focus

1. **Pedido repetido ou publish perdido** (duplo clique, recarga, QStash fora) — nenhuma linha fica `pendente` para sempre e nunca há 2 cobranças nem 2 submissões ao provedor. Testes na Task 8 e Task 9.
2. **Queda no meio do aplicar** (edge morre depois do PUT, compensação falha) — a saga retoma por GET e nunca deixa o anúncio sem saber o estado. Testes na Task 14.
3. **Família UP com vários tamanhos da mesma cor** — todos os itens daquela cor recebem a galeria; conjunto incompleto aborta. Teste na Task 14.
4. **Fato ou roteiro mudou depois da geração** — imagens desatualizadas não podem ser aprovadas nem aplicadas. Teste na Task 6 e Task 12.
5. **Cena em proporção inesperada ou arquivo final inválido** — corte >15% bloqueia; arquivo fora do contrato não vai ao ML. Testes na Task 11 e Task 12.

---

## Fatia 0 — Registro técnico e ensaio do ML

### Task 0: Adendo técnico ao ADR-0201

**Files:** Modify `docs/decisions/0201-galeria-da-cor-por-ia.md` (seção "Adendo técnico").
- [ ] **Step 1:** Registrar: (a) composição no navegador — edges têm 2 s de CPU e não há worker; limitação aceita: o arquivo final é produzido pelo navegador do operador da própria org; o servidor valida formato, dimensões e peso e guarda o hash; (b) job por imagem com claim por tentativa e lease; Higgsfield consultado por jobs agendados com claim por rodada e prazo absoluto; (c) cobrança na primeira entrega, por função compartilhada `platform_registrar_imagem`; (d) aplicar como saga persistida, job por item na fila serial da conta; (e) missão 7 e lupas sem gerador.
- [ ] **Step 2:** Commit `docs(galeria-ia): adendo técnico ao ADR-0201`.

### Task 1: Ensaio do contrato do PUT de fotos (bloqueador)

**Files:** Create `scripts/ensaio-galeria-put.ts` (fora da suíte; só GET e um PUT de fotos em itens de teste), `docs/superpowers/specs/2026-11-08-galeria-da-cor-ensaio-put.md` (resultado).
- [ ] **Step 1:** Diego escolhe 1 anúncio Legacy com ≥2 variações e 1 família UP com ≥2 tamanhos da mesma cor, de baixo risco. Nada roda sem a escolha dele.
- [ ] **Step 2:** Medir, registrando o GET antes/depois (preço, estoque, status, variações, `picture_ids`): (a) Legacy, PUT com `variations: [{id, picture_ids}]` **sem** `available_quantity` — o ML aceita? preserva estoque e preço? (b) idem com `available_quantity` do GET; (c) UP, PUT só `{pictures}`; (d) upload multipart (`POST /pictures`, campo `file`, `User-Agent: Mozilla/5.0`) e prazo até a foto ficar com URL real; (e) restaurar as fotos originais e conferir.
- [ ] **Step 3:** Gravar o resultado no doc de ensaio: corpo mínimo aceito por formato. Se (a) falhar e só (b) funcionar, a Task 14 usa a quantidade do GET imediatamente anterior e registra o risco de janela; Codex e Grok revisam essa escolha antes da Task 13.
- [ ] **Step 4:** Commit `docs(galeria-ia): ensaio do contrato do PUT de fotos`.

## Fatia 1 — Fundação

### Task 2: Tabelas, saga e cobrança compartilhada

**Files:** Create `supabase/migrations/<ts>_galeria_da_cor.sql`; `scripts/sql/teste-galeria-cobranca.sql`.

**Interfaces (Produces):** todas com `org_id uuid not null references public.organizations(id)`, RLS select `org_id = (select public.current_org_id())`, escrita só service_role.
- `galeria_fatos(id, org_id, familia_id, campo, valor, origem check in ('planilha','confirmado_operador'), evidencia jsonb, confirmado_por, confirmado_em, descartado bool default false, unique(org_id, familia_id, campo))`
- `galeria_roteiros(id, org_id, familia_id, versao int, conteudo jsonb, fatos_hash text, moda bool, status check in ('rascunho','aprovado','desatualizado'), criado_por, aprovado_por, criado_em, aprovado_em, unique(org_id, familia_id, versao))`
- `galeria_pedidos(id uuid pk = request_id do cliente, org_id, familia_id, roteiro_id, itens jsonb, criado_por, criado_em)`
- `galeria_imagens(id, org_id, familia_id, pedido_id, roteiro_id, cor, missao 1..7, geracao 1..3, request_id uuid, modelo, provedor, provider_request_id, tentativa int default 0, lease_ate timestamptz, publicado_em timestamptz, prazo_ate timestamptz, status check in ('pendente','gerando','gerada','falhou','aprovada','descartada','desatualizada'), cena_path, final_path, final_sha256, custo_usd, alertas jsonb, erro, entregue_em, aprovado_por, aprovado_em, ml_picture_id, criado_em, atualizado_em, unique(org_id, request_id), unique(org_id, roteiro_id, cor, missao, geracao))`
- `galeria_aplicacoes(id, org_id, familia_id, cor, modo check in ('substituir','adicionar'), retrato jsonb, status check in ('preparada','em_andamento','aplicada','falhou','revertendo','revertida','reversao_incompleta'), aplicado_por, criado_em, atualizado_em)`
- `galeria_aplicacao_itens(id, org_id, aplicacao_id, item_id, fotos_antes jsonb, fotos_novas jsonb, fotos_depois jsonb, status check in ('pendente','subindo','aplicando','aplicado','falhou','revertendo','revertido','reversao_incompleta'), tentativa int, lease_ate, erro, atualizado_em, unique(aplicacao_id, item_id))`
- `platform_image_deliveries.origem text not null default 'kit_variacao'`.
- `public.platform_registrar_imagem(p_org uuid, p_request uuid, p_custo_usd numeric, p_origem text)` — corpo atual de `platform_image_delivery_on_generated()` + `origem`; `security definer`, `search_path = ''`, `revoke all … from public, anon, authenticated`. Função do kit passa a chamá-la com `'kit_variacao'`.
- Gatilho `galeria_imagens_cobranca after update of entregue_em on public.galeria_imagens for each row when (old.entregue_em is null and new.entregue_em is not null and new.cena_path is not null)` → `platform_registrar_imagem(new.org_id, new.request_id, new.custo_usd, 'galeria')`.
- RPC `public.galeria_reservar_pedido(p_pedido jsonb) returns setof galeria_imagens` (security definer, só service_role): insere pedido e imagens numa transação; repetição do mesmo `id` devolve as linhas existentes; teto conta só gerações com `entregue_em` não nulo.

- [ ] **Step 1: Teste SQL que falha** (`begin; set local lock_timeout='5s'; … rollback;`): `gerada` sem `entregue_em` → 0 cobranças; `entregue_em` preenchido → 1 linha `units=1, origem='galeria'`; preencher de novo → continua 1; `cena_path` nulo → 0; org sem módulo → `units=0, reason='modulo_desligado'`; kit (`kit_variacao_imagens` → `gerada`) → `origem='kit_variacao'`; `galeria_reservar_pedido` chamado 2× com o mesmo id → mesmas linhas; 3 gerações entregues → a 4ª é recusada; `has_function_privilege('authenticated', 'public.platform_registrar_imagem(uuid,uuid,numeric,text)', 'execute') = false`.
- [ ] **Step 2:** Rodar pela Management API em transação desfeita — Expected: FAIL.
- [ ] **Step 3:** Escrever a migration.
- [ ] **Step 4:** Rodar migration + teste no mesmo `begin … rollback` — Expected: todas `ok`.
- [ ] **Step 5:** Commit `feat(galeria-ia): tabelas, saga e cobrança compartilhada`.

### Task 3: Regras puras e categorias de Moda

**Files:** Create `supabase/functions/_shared/galeria/regras.ts`; Test `supabase/functions/_shared/galeria/__tests__/regras.test.ts`.

**Interfaces (Produces):**
- `BLOCO_TECNICO: string`; `LIMITES = { headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5, beneficios: 3, fichaPares: 4 } as const`
- `type Missao = 1|2|3|4|5|6|7`; `missoesDisponiveis(moda: boolean): Array<{ missao: Missao; nome: string; comTexto: boolean; usaGerador: boolean }>` (missão 7 `usaGerador: false`; Moda: nomes de R5.5, `comTexto: false`)
- `missoesSugeridas(nCores: number): Missao[]`
- `CATEGORIAS_MODA: ReadonlySet<string>` (ids de nós de vestuário; qualquer ancestral casando = Moda); `ehModa(pathFromRoot: Array<{ id: string }>): boolean`
- `contarPalavras(texto: string): number`; `termosProibidos(texto: string, categoria: 'cosmeticos'|'vestuario'|'aviamentos'|'geral'): string[]`
- [ ] **Step 1:** Montar `CATEGORIAS_MODA` com chamadas reais `GET /categories/{id}` partindo das categorias das regatas e vestidos publicados (ex.: MLB31447) e do nó de roupas sob "Calçados, Roupas e Bolsas"; registrar os ids no próprio arquivo com a data. Calçados e bolsas **não** entram.
- [ ] **Step 2: Testes que falham:** `BLOCO_TECNICO` literal; `missoesSugeridas(3)` = 1..7, `(4)` = 1..4; `missoesDisponiveis(true).every(m => !m.comTexto)`; missão 7 `usaGerador === false`; `ehModa` verdadeiro para o path real de uma regata e falso para o de uma renda e de um calçado; `contarPalavras('Largura certa: 20 mm') === 4`; proibidos de `'Frete grátis e premium'` e `'100% natural'` (cosméticos).
- [ ] **Step 3:** Rodar — FAIL. **Step 4:** Implementar (módulo puro). **Step 5:** PASS; commit `feat(galeria-ia): regras puras e categorias de Moda`.

### Task 4: Provedores e cliente Higgsfield

**Files:** Create `supabase/functions/_shared/galeria/provedores.ts`, `supabase/functions/_shared/ai/higgsfield.ts`; Tests em `__tests__/`.

**Interfaces (Produces):** `ModeloGaleria { slug; provedor: 'openrouter'|'higgsfield'; endpoint?; maxReferencias; extra; custoUsd; rotulo }`; `MODELOS_GALERIA`; `MODELO_GALERIA_PADRAO`; `modeloGaleria(slug|null)`; `resolverModeloGaleria(admin, orgId): Promise<ModeloGaleria>`; `submeterHF(endpoint, entrada): Promise<string>`; `consultarHF(requestId): Promise<{ status: 'pendente'|'concluida'|'falhou'; url?: string; erro?: string }>` (header `Authorization: Key <id>:<secret>` de `HF_CREDENTIALS`).
- [ ] **Step 1: Testes que falham:** slug desconhecido → padrão; qwen `extra.prompt_extend === true`; `submeterHF` faz `POST https://api.higgsfield.ai/<endpoint>` com o corpo; `consultarHF` mapeia `completed`→`concluida` (+url), `nsfw`→`falhou`; 401 lança erro com status.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): provedores e cliente Higgsfield`.

### Task 5: Modelo da galeria por organização

**Files:** Create `supabase/migrations/<ts>_configuracoes_ai_model_galeria.sql`; Modify `src/lib/ai-modelos.ts` (`MODELOS_GALERIA_UI`), `src/components/configuracoes/secao-ia.tsx` (Select de `src/components/ui/select.tsx`); Test `src/lib/__tests__/ai-modelos-galeria.test.ts`.
- [ ] **Step 1:** Teste: slugs de `MODELOS_GALERIA_UI` = slugs de `MODELOS_GALERIA`, primeiro = padrão. **Step 2:** FAIL. **Step 3:** coluna `configuracoes.ai_model_galeria` com check dos 3 slugs + seletor (só admin da plataforma). **Step 4:** PASS + `pnpm lint`. **Step 5:** Commit `feat(galeria-ia): modelo da galeria por organização`.

## Fatia 2 — Fatos e roteiro

### Task 6: Ficha Verdade

**Files:** Create `supabase/functions/_shared/galeria/fatos.ts`, `supabase/functions/galeria-fatos/index.ts`; Modify `supabase/config.toml`; Test `…/__tests__/fatos.test.ts`.

**Interfaces (Produces):**
- `type EstadoFato = 'CONFIRMADO'|'SUGERIDO'|'DIVERGENTE'|'NAO_CONFERIDO'`; `Fato { campo; valor; estado; origem; evidencia; etiqueta? }`
- `montarFicha({ planilha, atributosML, textosIA, confirmados }): Fato[]` — planilha → `CONFIRMADO`; atributos e textos IA → `SUGERIDO`; confirmado pelo operador → `CONFIRMADO`; conflito entre fontes → `DIVERGENTE`.
- `aplicarEtiqueta(fatos, leitura: Array<{ campo; valor: string|null; legivel: boolean; caixa?: [number,number,number,number] }>): Fato[]`
- `hashFatos(fatos: Fato[]): string` (só `CONFIRMADO`, ordenado; usado para invalidar roteiro)
- Edge: `acao: 'montar'|'confirmar'|'descartar'|'manter_cadastro'|'corrigir_cadastro'` (corrigir grava só na família; nunca toca no ML); gate `exigirModulo(admin, orgId, 'imagem_ia')`. Ao mudar fatos, roteiros `aprovado` com `fatos_hash` diferente → `desatualizado` e imagens não aplicadas → `desatualizada`.
- [ ] **Step 1: Testes que falham:** planilha `LARGURA` → `CONFIRMADO`; `atributosML` `MATERIAL` → `SUGERIDO` (mesmo com família marcada como editada); renda: atributo `100% POLIÉSTER` + etiqueta legível `100% Poliamida` → `DIVERGENTE`; regata: atributo `Poliamida` × descrição `96% poliéster` → `DIVERGENTE`; etiqueta ilegível → `NAO_CONFERIDO`; `hashFatos` muda quando um `CONFIRMADO` muda e não muda com `SUGERIDO`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): ficha verdade`.

### Task 7: Roteiro

**Files:** Create `supabase/functions/_shared/galeria/roteiro.ts`, `supabase/functions/galeria-roteiro/index.ts`; Test `…/__tests__/roteiro.test.ts`.

**Interfaces (Produces):** `MissaoRoteiro { missao; ativa; cena; headline?; subheadline?; beneficios?; specs?: Array<[string,string]>; etapas?; legendas?; fatosUsados: string[] }`; `Roteiro { categoria; contrato; missoes }` (sem `moda` — vem da edge); `validarRoteiro(r: Roteiro, fatos: Fato[], moda: boolean): string[]`. Edge: `criar` (lê categoria ao vivo, define `moda` por `ehModa`, IA de texto com `resolverModeloIA`, recusa com `DIVERGENTE`), `salvar` (revalida), `aprovar` (grava `fatos_hash`).
- [ ] **Step 1: Testes que falham:** headline de 6 palavras → erro; 4 benefícios → erro; spec com valor fora dos `CONFIRMADO` → `fato não confirmado: <campo>`; "premium" → proibido; `moda=true` com headline em qualquer missão → `moda sem texto` (mesmo que o JSON do modelo traga `moda: false`); missão 1 com headline → erro; `DIVERGENTE` presente → `divergência pendente`; caso renda válido → `[]`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): roteiro validado em código`.

### Task 7b: Tela — fatos e roteiro

**Files:** Create `src/components/galeria/dialog-galeria.tsx`, `passo-fatos.tsx`, `passo-roteiro.tsx`, `src/lib/galeria/api.ts`; Modify `src/pages/Publicados.tsx` (botão "Galeria IA", ícone `Images`, em `LinhaTabela`; estado `galeriaDe`; dialog no fim); Test `src/components/galeria/__tests__/dialog-galeria.test.tsx`.

**Interfaces (Produces):** `DialogGaleria({ familiaId, open, onOpenChange, isAdmin })`; `api.ts` com uma função por ação das edges (`montarFatos`, `decidirFato`, `criarRoteiro`, `salvarRoteiro`, `aprovarRoteiro`, `pedirGeracao`, `listarImagens`, `aprovarImagem`, `prepararAplicacao`, `aplicarGaleria`, `reverterGaleria`).
- [ ] **Step 1: Testes que falham:** sem módulo `imagem_ia` não há botão; `DIVERGENTE` mostra recorte e "Usar o da etiqueta" pré-selecionado; `SUGERIDO` tem "Confirmar"/"Descartar"; contador de palavras vermelho acima do limite; "Aprovar roteiro" desabilitado com erro; roteiro `desatualizado` mostra aviso.
- [ ] **Step 2–4:** FAIL → implementar (Select do `ui/select.tsx`; espera em diálogo ADR-0163) → PASS. **Step 5:** Commit `feat(galeria-ia): fatos e roteiro na tela`.

## Fatia 3 — Geração

### Task 8: Pedido de geração

**Files:** Create `supabase/functions/galeria-gerar/index.ts`, `supabase/functions/_shared/galeria/pedido.ts`; Test `…/__tests__/pedido.test.ts`.

**Interfaces (Produces):** `idDerivado(requestId, cor, missao, geracao): string` (UUID v5); `planejarGeracoes({ cores, missoes, entregues }): { novas; bloqueadas }` (missão 7 nunca entra; teto conta só `entregues`). Edge `POST {request_id, familia_id, roteiro_versao, cores, missoes}`: roteiro `aprovado` e não `desatualizado`; cor sem foto real recusada sem custo; `galeria_reservar_pedido`; publica jobs das linhas sem `publicado_em` e grava `publicado_em`; repetição republica só `pendente` sem `publicado_em`. Varredura (pg_cron, a cada 5 min) republica `pendente` com `publicado_em` nulo há >2 min.
- [ ] **Step 1: Testes que falham:** 2 cores × 3 missões → 6 novas `geracao 1`; missão 7 não gera linha; `(Rosa,2)` com 3 entregues → bloqueada `teto`; `(Rosa,2)` com 2 entregues + 1 `pendente` → nova geração **não** é criada (a pendente é republicada); `idDerivado` determinístico.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): pedido de geração`.

### Task 9: Worker de geração

**Files:** Create `supabase/functions/galeria-worker/index.ts`, `supabase/functions/_shared/galeria/prompt.ts`, `alertas.ts`, `worker-estado.ts`; Modify `supabase/config.toml` (`verify_jwt = false`); Tests.

**Interfaces (Produces):**
- `montarPromptCena(m: MissaoRoteiro, r: Roteiro, moda: boolean, cor: string, layout: 'topo'|'esquerda'|'nenhum'|'paineis'): string` — termina com `BLOCO_TECNICO`.
- `interpretarAlertas(resposta: unknown): Array<{ tipo: 'cor'|'produto'|'texto_na_cena'|'rotulo_alterado'; nota }>` (ilegível → `[]`).
- `proximaFase(linha, agora): { acao: 'submeter'|'consultar'|'baixar'|'falhar'|'ignorar'; tentativa: number }` — claim por `(id, tentativa)` com `lease_ate`; Higgsfield só submete se `provider_request_id` nulo; prazo absoluto `prazo_ate = criado_em + 6 min`; status terminal nunca regride.
- Worker `{imagem_id, tentativa}`: claim atômico `update … where id=$1 and tentativa=$2` (incrementa); OpenRouter → bytes (referência data URL); Higgsfield → submete (referência URL assinada 2 h) e publica `{tentativa+1}` com `delay: 15`, respondendo **200** (nunca 5xx depois de publicar); com bytes: valida (`dimensoesImagem`, proporção entre 0,7 e 0,8, ≥60 KB) → Storage `${orgId}/galeria-ia/${familiaId}/${cor-slug}/${missao}-${geracao}-${id}.${ext}` → alertas → `gerada` com `custo_usd`. Falha sem bytes → `falhou` (sem cobrança).
- [ ] **Step 1: Testes que falham:** prompt termina com `BLOCO_TECNICO`; Moda sem "headline"; `proximaFase` com `provider_request_id` preenchido nunca devolve `submeter`; claim com tentativa antiga → `ignorar`; após `prazo_ate` → `falhar`; linha `gerada` → `ignorar`; alertas `{cor_diferente:true, texto_adicionado:true}` → `cor` e `texto_na_cena`; imagem 1024×1024 → `falhou` por proporção.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** 1 imagem real por modelo numa família de teste (~US$ 0,15); conferir que nada é cobrado antes da entrega. Commit `feat(galeria-ia): worker de geração`.

### Task 10: Tela — gerar, entregar e acompanhar

**Files:** Create `src/components/galeria/passo-gerar.tsx`, `cartao-imagem.tsx`, `supabase/functions/galeria-imagens/index.ts` (lista e marca entrega); Tests.

**Interfaces (Produces):** edge `galeria-imagens` `POST {familia_id, roteiro_versao}` → lista; para cada `gerada` com `entregue_em` nulo e arquivo existente, grava `entregue_em = now()` (dispara a cobrança uma única vez) antes de devolver a URL assinada. `CartaoImagem({ imagem, onGerarDeNovo, onAprovar })`.
- [ ] **Step 1: Testes que falham:** missões pré-marcadas por `missoesSugeridas`; confirmação mostra "N imagens · R$ X" (missão 7 grátis); alerta aparece no cartão; "Gerar de novo" some na 3ª entregue; cor sem foto desabilitada com motivo; listar 2× marca `entregue_em` só uma vez.
- [ ] **Step 2–4:** FAIL → implementar (polling a cada 5 s com `pendente|gerando`) → PASS. **Step 5:** Commit `feat(galeria-ia): gerar e acompanhar`.

## Fatia 4 — Composição e aprovação

### Task 11: Layouts, corte e contraste (puro)

**Files:** Create `src/lib/galeria/layouts.ts`, `contraste.ts`, `corte.ts`; Tests.

**Interfaces (Produces):** `razaoContraste(a, b): number`; `corDeAcento(cor): string`; `planejarCorte(w, h, capa): { tipo: 'corte'|'preenchimento'|'bloqueado'; sx; sy; sw; sh; perda }`; `Caixa { x; y; w; h; fontePx; linhasMax }`; `layoutMissao(m: Missao, textos: MissaoRoteiro): Caixa[]`; `recortesDetalhe(refW, refH): Array<{ sx; sy; sw; sh }>` (missão 7 e lupas).
- [ ] **Step 1: Testes que falham:** `razaoContraste('#ffffff','#1b1f24') > 16`; `corDeAcento('#139aa0') === '#1b1f24'`; `planejarCorte(864,1152,false)` → `corte`, perda ≈ 0,037; `(1024,1024,false)` → `bloqueado`; `(1024,1024,true)` → `preenchimento`; toda caixa das missões 2–7: `fontePx >= 60`, `x >= 72`, `x+w <= 1128`, `y >= 184.8`, `y+h <= 1355.2`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): layouts, corte e contraste`.

### Task 12: Composição no navegador e aprovação

**Files:** Create `src/lib/galeria/compor.ts`, `supabase/functions/galeria-aprovar/index.ts`; Modify `cartao-imagem.tsx`; Config: CORS do bucket `imagens` para a origem do app; Tests: `src/lib/galeria/__tests__/compor.test.ts`, `supabase/functions/galeria-aprovar/__tests__/validar.test.ts`, `tests/e2e/galeria-compor.spec.ts` (Playwright, skill `playwright-cli`).

**Interfaces (Produces):** `comporImagemFinal({ cenaUrl, refUrl, missao, textos, corProduto, moda }): Promise<Blob>` — `img.crossOrigin = 'anonymous'`; espera `document.fonts.load('600 60px Inter')`; JPEG com laço de qualidade (0,92 → 0,70) até ficar entre 60 KB e 1 MB; missão 7 usa só `refUrl`. `validarArquivoFinal(bytes): string[]`. Edge `galeria-aprovar` `POST {imagem_id}` após upload do cliente em `final_path` assinado: relê os bytes, valida, grava `final_sha256`, recusa imagem `desatualizada`, → `aprovada`.
- [ ] **Step 1: Testes que falham:** PNG → `formato`; JPEG 1200×1200 → `dimensoes`; JPEG 1200×1540 de 2 MB → `peso`; imagem `desatualizada` → recusa; Playwright renderiza `comporImagemFinal` no Chromium com uma cena real e confere: blob 1200×1540, `toBlob` sem erro de canvas sujo, e (missão 2) pixels escuros na faixa do título; com `moda: true`, nenhum pixel de texto na placa.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): composição e aprovação`.

## Fatia 5 — Aplicar no ML

### Task 13: Upload multipart, retrato e plano de fotos (puro)

**Files:** Modify `supabase/functions/_shared/ml/fotos.ts` (`subirFotoMLArquivo`); Modify `supabase/functions/_shared/ml/atualizar-item.ts` (`buscarItemML` passa a ler `catalog_listing`; nova `atualizarFotosItemML(token, itemId, corpo)`); Create `supabase/functions/_shared/galeria/aplicar.ts`; Tests.

**Interfaces (Produces):**
- `subirFotoMLArquivo(token, bytes, mime): Promise<{ id: string; pronta: boolean }>` (multipart `file`, `User-Agent: Mozilla/5.0`)
- `type Retrato = { itens: Array<{ itemId: string; variacoes: Array<{ id: number|null; cor: string; pictureIds: string[] }>; pictures: string[] }> }`
- `alvosDaCor(vinculos: Array<{ sku: string; item_externo_id: string; user_product_id: string|null; retirado: boolean }>, skusDaCor: string[]): string[]` (itens não retirados dos SKUs da cor; vazio ou SKU sem vínculo → erro `conjunto_incompleto`)
- `planejarFotosItem({ atual, retrato, cor, novas, modo, limiteVar, limiteItem, corpoMinimo }): { ok: true; corpo } | { ok: false; motivo: 'mudou'|'limite'|'variacao_ausente'|'catalogo'|'migracao_pendente'; detalhe }` — `mudou` compara o item **inteiro** (todas as variações e a ordem) com o retrato; `corpoMinimo` vem do ensaio da Task 1.
- [ ] **Step 1: Testes que falham:** Legacy Rosa+Azul, substituir Rosa → Azul intacta, Rosa só com novas, `pictures` = união; corpo sem `price` e `status`; adicionar 4+7 com limite 10 → `limite`; Azul mudou desde o retrato → `mudou`; `catalog_listing: true` → `catalogo`; tag `variations_migration_pending` → `migracao_pendente`; `alvosDaCor` com 3 SKUs da cor (P, M, G) → 3 itens; um SKU sem vínculo → `conjunto_incompleto`; `subirFotoMLArquivo` envia `FormData` com `file` e devolve `pronta:false` sem `variations`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): retrato e plano de fotos`.

### Task 14: Saga de aplicar e reverter

**Files:** Create `supabase/functions/galeria-aplicar/index.ts` (preparar e disparar), `supabase/functions/galeria-aplicar-worker/index.ts` (um item por job), `supabase/functions/_shared/galeria/saga.ts`; Modify `supabase/config.toml`; Test `…/__tests__/saga.test.ts`.

**Interfaces (Produces):**
- Edge `galeria-aplicar`: `requireUserOrg` + admin (senão 403). `acao:'preparar'` → GET ao vivo de todos os alvos (`alvosDaCor` + `buscarItemML`), grava `galeria_aplicacoes` `preparada` com `retrato`; `acao:'confirmar', aplicacao_id` → `em_andamento` e publica um job por item na fila serial da conta (`garantirFilaSerialCanal`); `acao:'reverter', aplicacao_id` → jobs de reversão.
- `passoSaga(item, ctx): { acao: 'subir'|'put'|'conferir'|'compensar'|'concluir'|'ignorar'; ... }` — puro; ordem: grava `fotos_antes` (commit) → sobe fotos que ainda não têm `ml_picture_id` (reaproveita) → GET imediato + `planejarFotosItem` → PUT → GET de conferência → `aplicado`; erro após o PUT → GET decide se o PUT pegou; falha → compensa com `fotos_antes` só se as fotos atuais forem as esperadas, senão `reversao_incompleta`.
- Varredura (pg_cron, 5 min): item `aplicando|revertendo` com `lease_ate` vencido → republica o job.
- [ ] **Step 1: Testes que falham:** UP com P, M, G da mesma cor → 3 jobs; PUT do M falha → P compensado, G não tocado, aplicação `falhou` com detalhe por item; queda depois do PUT (resposta perdida) + GET mostra fotos novas → `aplicado` sem novo PUT; compensação com fotos atuais diferentes das esperadas → `reversao_incompleta`, sem PUT; conferência com ordem errada → compensa; foto `pronta:false` → nenhum PUT; não admin → 403; reverter com fotos atuais ≠ `fotos_depois` → `mudou`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): saga de aplicar e reverter`.

### Task 15: Tela — aplicar e reverter

**Files:** Create `src/components/galeria/passo-aplicar.tsx`; Test `…/__tests__/passo-aplicar.test.tsx`.
- [ ] **Step 1: Testes que falham:** não admin vê botões desabilitados com `title` (ADR-0060); confirmação lista os MLB do retrato e o modo (Substituir pré-selecionado); `limite` oferece Substituir; `mudou` mostra a diferença e pede nova preparação; `reversao_incompleta` mostra aviso vermelho com os MLB; `aplicada` oferece "Reverter".
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): aplicar e reverter na tela`.

## Fatia 6 — Retenção, entrega e validação

### Task 16: Retenção, deploy, documentação e validação real

**Files:** Create `supabase/migrations/<ts>_galeria_retencao_cron.sql` (pg_cron diário: apaga do Storage arquivos de `galeria_imagens` com status `gerada|descartada|falhou|desatualizada` e `criado_em < now() - interval '30 days'`; zera `cena_path`/`final_path`; mantém a linha); Modify `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md` (skill `docs-update-checklist`).
- [ ] **Step 1:** `pnpm preflight` — tudo verde.
- [ ] **Step 2:** Diego roda `! supabase secrets set HF_CREDENTIALS=…`; `supabase db push`; `npm run db:check`; deploy de `galeria-fatos galeria-roteiro galeria-gerar galeria-worker galeria-imagens galeria-aprovar galeria-aplicar galeria-aplicar-worker` + todas as funções que importam `_shared/ml/fotos.ts` e `_shared/ml/atualizar-item.ts` (listar com grep); conferir versões.
- [ ] **Step 3:** Validação real com Diego (bloqueia a liberação): 1 anúncio Legacy e 1 família UP da Task 1; gerar → aprovar → aplicar → conferir no ML (preço, estoque, demais cores) → reverter → conferir; conferir 1 cobrança por imagem entregue e nenhuma pela missão 7.
- [ ] **Step 4:** Commit `docs(galeria-ia): entrega da galeria da cor`.

---

## Revisão e execução

- Cada task: diff revisado pelo Codex (`gpt-6.1-sol`, high) **e** pelo Grok 4.7 xhigh (decisão do Diego para esta feature).
- Pré-merge: Grok 4.7 xhigh no diff completo + CI verde. Merge só depois da validação real da Task 16.
