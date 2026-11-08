# Galeria da cor por IA — Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Publicados, gerar até 7 imagens por cor de um anúncio já publicado (fatos → roteiro → cenas por IA → texto composto → aprovação → aplicar no ML), cobrando cada imagem entregue.

**Architecture:** Fatos e roteiro em edges síncronas. Cada imagem é um job QStash com claim por tentativa e lease; Higgsfield é consultado por novos jobs agendados com claim por rodada e prazo absoluto. Corte 1200×1540 e tipografia são compostos no navegador (canvas) na aprovação; a missão 7 e as lupas saem de recortes da foto real, sem gerador. Aplicar é uma saga persistida: preparação com retrato completo do anúncio, um job por item na fila serial da conta, fotos anteriores gravadas antes do PUT, retomada por GET e varredura de itens presos.

**Tech Stack:** React + TS (Vite), Supabase (Postgres, Storage, Deno edges), QStash, OpenRouter, Higgsfield API, API do Mercado Livre, vitest, Playwright (render real do canvas).

**Spec:** `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md` (R0–R11) · `docs/decisions/0201-galeria-da-cor-por-ia.md` (§1–§13) · `CONTEXT.md` ("Imagens do anúncio por IA").

**Histórico:** v1 e v2 revisadas por Codex (`gpt-6.1-sol` high) e Grok 4.7 xhigh — REVISAR nas duas rodadas; v3 incorpora os pendentes da v2 (retomada por lease e varredura QStash, cobrança na exibição confirmada pelo navegador, recortes com linha própria, fila `publish-ml-${userId}`, retenção por histórico, catálogo ausente ≠ falso, referência no bucket, Inter hospedada, render manual com evidência).

## Global Constraints

- Bloco técnico literal ao fim de todo prompt de imagem: `photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard` (R5.4).
- Arquivo final: 1200×1540 JPEG ≤1 MB, conferido no navegador como não branco (variância de pixels amostrados); corte ao centro, nunca esticar; capa com preenchimento branco; corte >15% bloqueia (R9.1, atualizada nesta v3).
- Fila de escrita no ML: **`publish-ml-${userId}`** via `garantirFilaSerial(userId)` (ADR-0034), `userId` = dono da conexão ML da org — a mesma de CREATE/UPDATE. Outro nome é proibido.
- Relógios (varredura de presos, limpeza de 30 dias): **agendamento do QStash** (`qstashClient().schedules.create`) chamando a edge `galeria-varredura`; `pg_cron` não publica no QStash (sem `pg_net`).
- Layout estilo A: Inter, texto #1b1f24 em placa branca ≥92% opaca; fonte ≥5% da largura, títulos 7–8,5%; contraste ≥4,5:1 na cor composta; área segura 6% laterais e 12–88% da altura; ≤3 benefícios, ≤4 pares na ficha (R6.4–R6.5).
- Texto: headline ≤5 palavras, subheadline ≤10, benefício ≤6, etapa ≤7, legenda ≤5; NFC (R6.1–R6.2).
- Moda (ADR §11): decidida pela **edge** pela categoria lida ao vivo (`path_from_root`), nunca pelo modelo de IA; em Moda nenhuma imagem leva texto.
- Fato `CONFIRMADO` só da planilha ou de confirmação explícita do operador por campo. `atributos_ml`, `titulo_ml`, `descricao_ml` são `SUGERIDO` — a marca `atributos_editados_pelo_operador` é da família inteira e não prova a origem de cada atributo (ADR §12).
- Missão 7, lupas e (em Moda) a missão 5: recortes da foto real da cor, compostos no navegador; viram linha `origem = 'recorte'` em `galeria_imagens` (aprovável e aplicável), não chamam provedor e não são cobrados (R3.3). Vistas de Moda (costas, lateral) só são oferecidas se houver foto de referência daquela vista (R3.2).
- Modelos: `google/gemini-nano-banana-2.1` (padrão), `xai/grok-imagine-image-2.0`, `alibaba/qwen-image-3/edit` (`prompt_extend: true`, ≤3 refs).
- Referência: foto da própria cor (`variacoes.imagem_path`; sem ela, a 1ª foto da variação no ML **copiada para o bucket** `imagens`, para o canvas não esbarrar em CORS); nunca capa multicolor. Guardar `referencia_path` e `referencia_sha256` por imagem.
- Retenção (ADR §13) decide pelo histórico, não pelo status: arquivo com `aprovado_em` não nulo ou usado em aplicação nunca é apagado.
- Cobrança: uma linha por `request_id` de imagem de **origem `gerador`** quando o navegador **confirma a exibição** (imagem carregada, decodificada e não branca → `entregue_em`); recorte nunca cobra; teto 3 gerações por (cor, missão, versão do roteiro), contando só as entregues (R8.2–R8.3).
- Toda edge que lê ou altera a galeria: `requireUserOrg` + `familia.org_id = orgId`; outra org → 403.
- Limite ML: 10 fotos por variação, 12 por item sem variações, lidos da categoria ao vivo.
- Aplicar/reverter: só admin; PUT só de fotos (mais o que o ensaio da Task 13 provar obrigatório); recusar `catalog_listing` e tag `variations_migration_pending`; fila serial da conta.
- Migrations via `supabase migration new` + `supabase db push`; `npm run db:check`. Funções SQL novas: `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`. Teste SQL com `set local lock_timeout = '5s'`.
- Edge chamada por QStash: `verify_jwt = false` + `verificarAssinatura`. `HF_CREDENTIALS` só em `supabase secrets`.
- Render real do canvas (CORS, `toBlob`, fonte Inter, legibilidade a 400 px): checado com a skill `playwright-cli` e registrado como evidência antes da liberação (Task 16); Playwright não está no CI hoje e não é adicionado por esta feature.
- Fonte Inter hospedada no próprio app (`public/fonts/inter-*.woff2` + `@font-face`); o app hoje carrega Geist.

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
- [ ] **Step 1:** Registrar: (a) composição no navegador — edges têm 2 s de CPU e não há worker; limitação aceita: o arquivo final é produzido pelo navegador do operador da própria org; o servidor valida formato, dimensões e peso e guarda o hash; (b) job por imagem com claim por tentativa e lease; Higgsfield consultado por jobs agendados com claim por rodada e prazo absoluto; (c) cobrança na primeira entrega, por função compartilhada `platform_registrar_imagem`; (d) aplicar como saga persistida, job por item na fila `publish-ml-${userId}`; (e) missão 7, lupas e detalhe de Moda sem gerador; (f) relógios por agendamento do QStash; (g) risco aceito: queda entre o provedor aceitar a submissão e o id ser gravado pode gerar 1 submissão extra à Higgsfield (custo da Daludi; o cliente é cobrado uma vez por `request_id`).
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
- `galeria_imagens(id, org_id, familia_id, pedido_id, roteiro_id, cor, missao 1..7, geracao 1..3, request_id uuid, origem check in ('gerador','recorte'), modelo, provedor, provider_request_id, fase int default 0, lease_ate timestamptz, publicado_em timestamptz, prazo_ate timestamptz, status check in ('pendente','submetendo','gerando','gerada','falhou','aprovada','descartada','desatualizada'), prompt text, referencia_path, referencia_sha256, cena_path, final_path, final_sha256, custo_usd, alertas jsonb, erro, entregue_em, aprovado_por, aprovado_em, ml_picture_id, criado_em, atualizado_em, unique(org_id, request_id), unique(org_id, roteiro_id, cor, missao, geracao))`
- `galeria_aplicacoes(id, org_id, familia_id, cor, modo check in ('substituir','adicionar'), retrato jsonb, status check in ('preparada','em_andamento','aplicada','falhou','revertendo','revertida','reversao_incompleta'), aplicado_por, criado_em, atualizado_em)`
- `galeria_aplicacao_itens(id, org_id, aplicacao_id, item_id, fotos_antes jsonb, fotos_novas jsonb, fotos_depois jsonb, status check in ('pendente','subindo','aplicando','aplicado','falhou','revertendo','revertido','reversao_incompleta'), fase int default 0, lease_ate, publicado_em, erro, atualizado_em, unique(aplicacao_id, item_id))`
- `platform_image_deliveries.origem text not null default 'kit_variacao'`.
- `public.platform_registrar_imagem(p_org uuid, p_request uuid, p_custo_usd numeric, p_origem text)` — corpo atual de `platform_image_delivery_on_generated()` + `origem`; `security definer`, `search_path = ''`, `revoke all … from public, anon, authenticated`. Função do kit passa a chamá-la com `'kit_variacao'`.
- Gatilho `galeria_imagens_cobranca after update of entregue_em on public.galeria_imagens for each row when (old.entregue_em is null and new.entregue_em is not null and new.cena_path is not null and new.origem = 'gerador')` → `platform_registrar_imagem(new.org_id, new.request_id, new.custo_usd, 'galeria')`.
- RPC `public.galeria_reservar_pedido(p_pedido jsonb) returns setof galeria_imagens` (security definer, só service_role): insere pedido e imagens numa transação; repetição do mesmo `id` devolve as linhas existentes; teto conta só gerações com `entregue_em` não nulo.

- [ ] **Step 1: Teste SQL que falha** (`begin; set local lock_timeout='5s'; … rollback;`): `gerada` sem `entregue_em` → 0 cobranças; `entregue_em` preenchido → 1 linha `units=1, origem='galeria'`; linha `origem='recorte'` com `entregue_em` → 0 cobranças; preencher de novo → continua 1; `cena_path` nulo → 0; org sem módulo → `units=0, reason='modulo_desligado'`; kit (`kit_variacao_imagens` → `gerada`) → `origem='kit_variacao'`; `galeria_reservar_pedido` chamado 2× com o mesmo id → mesmas linhas; 3 gerações entregues → a 4ª é recusada; `has_function_privilege('authenticated', 'public.platform_registrar_imagem(uuid,uuid,numeric,text)', 'execute') = false`.
- [ ] **Step 2:** Rodar pela Management API em transação desfeita — Expected: FAIL.
- [ ] **Step 3:** Escrever a migration.
- [ ] **Step 4:** Rodar migration + teste no mesmo `begin … rollback` — Expected: todas `ok`.
- [ ] **Step 5:** Commit `feat(galeria-ia): tabelas, saga e cobrança compartilhada`.

### Task 3: Regras puras e categorias de Moda

**Files:** Create `supabase/functions/_shared/galeria/regras.ts`; Test `supabase/functions/_shared/galeria/__tests__/regras.test.ts`.

**Interfaces (Produces):**
- `BLOCO_TECNICO: string`; `LIMITES = { headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5, beneficios: 3, fichaPares: 4 } as const`
- `type Missao = 1|2|3|4|5|6|7`; `type Vista = 'frente'|'costas'|'lateral'`; `missoesDisponiveis(moda: boolean, vistas: Vista[]): Array<{ missao: Missao; nome: string; comTexto: boolean; usaGerador: boolean }>` (missão 7 `usaGerador: false`; em Moda, missão 5 também `usaGerador: false`, nomes de R5.5, `comTexto: false`, e "De costas"/"Lateral" só aparecem se `vistas` tiver a vista)
- `missoesSugeridas(nCores: number): Missao[]`
- `CATEGORIAS_MODA: ReadonlySet<string>` (ids de nós de vestuário; qualquer ancestral casando = Moda); `ehModa(pathFromRoot: Array<{ id: string }>): boolean`
- `contarPalavras(texto: string): number`; `termosProibidos(texto: string, categoria: 'cosmeticos'|'vestuario'|'aviamentos'|'geral'): string[]`
- [ ] **Step 1:** Montar `CATEGORIAS_MODA` com chamadas reais `GET /categories/{id}` partindo das categorias das regatas e vestidos publicados (ex.: MLB31447) e do nó de roupas sob "Calçados, Roupas e Bolsas"; registrar os ids no próprio arquivo com a data. Calçados e bolsas **não** entram.
- [ ] **Step 2: Testes que falham:** `BLOCO_TECNICO` literal; `missoesSugeridas(3)` = 1..7, `(4)` = 1..4; `missoesDisponiveis(true, ['frente']).every(m => !m.comTexto)`; missão 7 `usaGerador === false`; em Moda a missão 5 `usaGerador === false`; `missoesDisponiveis(true, ['frente'])` não contém "De costas" e `(true, ['frente','costas'])` contém; `ehModa` verdadeiro para o path real de uma regata e falso para o de uma renda e de um calçado; `contarPalavras('Largura certa: 20 mm') === 4`; proibidos de `'Frete grátis e premium'` e `'100% natural'` (cosméticos).
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
- `hashFatos(fatos: Fato[], referencias: Record<string, string>): string` (só `CONFIRMADO`, ordenado, + `referencia_sha256` de cada cor; usado para invalidar roteiro e imagens)
- `prepararReferencia(admin, orgId, familiaId, cor): Promise<{ path: string; sha256: string }>` — usa `variacoes.imagem_path`; sem ela, baixa a 1ª foto da variação no ML e grava em `${orgId}/galeria-ia/${familiaId}/referencias/${cor-slug}.jpg`
- Edge: `acao: 'montar'|'confirmar'|'descartar'|'manter_cadastro'|'corrigir_cadastro'` (corrigir grava só na família; nunca toca no ML); gate `exigirModulo(admin, orgId, 'imagem_ia')`. Ao mudar fatos, roteiros `aprovado` com `fatos_hash` diferente → `desatualizado` e imagens não aplicadas → `desatualizada`.
- [ ] **Step 1: Testes que falham:** planilha `LARGURA` → `CONFIRMADO`; `atributosML` `MATERIAL` → `SUGERIDO` (mesmo com família marcada como editada); renda: atributo `100% POLIÉSTER` + etiqueta legível `100% Poliamida` → `DIVERGENTE`; regata: atributo `Poliamida` × descrição `96% poliéster` → `DIVERGENTE`; etiqueta ilegível → `NAO_CONFERIDO`; `hashFatos` muda quando um `CONFIRMADO` muda ou quando a referência de uma cor muda, e não muda com `SUGERIDO`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): ficha verdade`.

### Task 7: Roteiro

**Files:** Create `supabase/functions/_shared/galeria/roteiro.ts`, `supabase/functions/galeria-roteiro/index.ts`; Test `…/__tests__/roteiro.test.ts`.

**Interfaces (Produces):** `MissaoRoteiro { missao; ativa; cena; headline?; subheadline?; beneficios?; specs?: Array<[string,string]>; etapas?; legendas?; fatosUsados: string[] }`; `Roteiro { categoria; contrato; missoes }` (sem `moda` — vem da edge); `validarRoteiro(r: Roteiro, fatos: Fato[], moda: boolean): string[]`. Edge: `criar` (lê categoria ao vivo, define `moda` por `ehModa`, IA de texto com `resolverModeloIA`, recusa com `DIVERGENTE`), `salvar` (revalida), `aprovar` (grava `fatos_hash`; imagens não aplicadas de versões anteriores → `desatualizada`).
- [ ] **Step 1: Testes que falham:** headline de 6 palavras → erro; 4 benefícios → erro; spec com valor fora dos `CONFIRMADO` → `fato não confirmado: <campo>`; "premium" → proibido; `moda=true` com headline em qualquer missão → `moda sem texto` (mesmo que o JSON do modelo traga `moda: false`); missão 1 com headline → erro; `DIVERGENTE` presente → `divergência pendente`; caso renda válido → `[]`; aprovar a versão 2 marca as imagens não aplicadas da versão 1 como `desatualizada` e mantém as aplicadas.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): roteiro validado em código`.

### Task 7b: Tela — fatos e roteiro

**Files:** Create `src/components/galeria/dialog-galeria.tsx`, `passo-fatos.tsx`, `passo-roteiro.tsx`, `src/lib/galeria/api.ts`; Modify `src/pages/Publicados.tsx` (botão "Galeria IA", ícone `Images`, em `LinhaTabela`; estado `galeriaDe`; dialog no fim); Test `src/components/galeria/__tests__/dialog-galeria.test.tsx`.

**Interfaces (Produces):** `DialogGaleria({ familiaId, open, onOpenChange, isAdmin })`; `api.ts` com uma função por ação das edges (`montarFatos`, `decidirFato`, `criarRoteiro`, `salvarRoteiro`, `aprovarRoteiro`, `pedirGeracao`, `listarImagens`, `aprovarImagem`, `prepararAplicacao`, `aplicarGaleria`, `reverterGaleria`).
- [ ] **Step 1: Testes que falham:** sem módulo `imagem_ia` não há botão; `DIVERGENTE` mostra recorte e "Usar o da etiqueta" pré-selecionado; `SUGERIDO` tem "Confirmar"/"Descartar"; contador de palavras vermelho acima do limite; "Aprovar roteiro" desabilitado com erro; roteiro `desatualizado` mostra aviso.
- [ ] **Step 2–4:** FAIL → implementar (Select do `ui/select.tsx`; espera em diálogo ADR-0163) → PASS. **Step 5:** Commit `feat(galeria-ia): fatos e roteiro na tela`.

## Fatia 3 — Geração

### Task 8: Pedido de geração

**Files:** Create `supabase/functions/galeria-gerar/index.ts`, `supabase/functions/_shared/galeria/pedido.ts`; Test `…/__tests__/pedido.test.ts`.

**Interfaces (Produces):** `idDerivado(requestId, cor, missao, geracao): string` (UUID v5); `planejarGeracoes({ cores, missoes, moda, entregues }): { novas; recortes; bloqueadas }` (missões com `usaGerador: false` vão para `recortes`; teto conta só `entregues`). Edge `POST {request_id, familia_id, roteiro_versao, cores, missoes}`: gate `requireUserOrg` + org da família; roteiro `aprovado`; cor sem referência recusada sem custo; `galeria_reservar_pedido` cria as linhas `gerador` (`pendente`) e `recorte` (já `gerada`, `cena_path = referencia_path`, sem job); publica jobs das linhas `gerador` sem `publicado_em` e grava `publicado_em`; repetição republica só `pendente` sem `publicado_em`.
- Edge `galeria-varredura` (`verify_jwt = false`, `verificarAssinatura`; agendada no QStash a cada 5 min por `scripts/qstash-agendar-galeria.ts`): republica `pendente` sem `publicado_em` há >2 min; republica `submetendo|gerando` com `lease_ate` vencido; republica itens de aplicação `pendente|subindo|aplicando|revertendo` com `lease_ate` vencido ou sem `publicado_em`; 1×/dia faz a retenção (Task 16).
- [ ] **Step 1: Testes que falham:** 2 cores × 3 missões → 6 novas `geracao 1`; missão 7 vai para `recortes` (não para `novas`); em Moda a missão 5 também; `(Rosa,2)` com 3 entregues → bloqueada `teto`; `(Rosa,2)` com 2 entregues + 1 `pendente` → nova geração **não** é criada (a pendente é republicada); `idDerivado` determinístico.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): pedido de geração`.

### Task 9: Worker de geração

**Files:** Create `supabase/functions/galeria-worker/index.ts`, `supabase/functions/_shared/galeria/prompt.ts`, `alertas.ts`, `worker-estado.ts`; Modify `supabase/config.toml` (`verify_jwt = false`); Tests.

**Interfaces (Produces):**
- `montarPromptCena(m: MissaoRoteiro, r: Roteiro, moda: boolean, cor: string, layout: 'topo'|'esquerda'|'nenhum'|'paineis'): string` — termina com `BLOCO_TECNICO`.
- `interpretarAlertas(resposta: unknown): Array<{ tipo: 'cor'|'produto'|'texto_na_cena'|'rotulo_alterado'; nota }>` (ilegível → `[]`).
- `proximaFase(linha, msg: { fase: number }, agora): { acao: 'submeter'|'consultar'|'baixar'|'falhar'|'ignorar' }` — a mensagem carrega a `fase` em que foi publicada; claim = `update … set lease_ate = now() + 90 s where id = $1 and fase = $2 and (lease_ate is null or lease_ate < now())`, **sem** incrementar antes do trabalho (retry do mesmo QStash reconquista depois do lease); a fase só avança quando o estado da etapa está gravado e a próxima mensagem publicada; Higgsfield só submete com `provider_request_id` nulo, gravando `submetendo` antes de chamar; prazo absoluto `prazo_ate = criado_em + 6 min`; terminal nunca regride.
- `cenaUtil(missao: Missao, w: number, h: number): boolean` — capa aceita qualquer proporção (vira preenchimento); demais exigem perda de corte ≤15% para 1200:1540 (mesma conta de `planejarCorte` da Task 11, módulo puro `_shared/galeria/corte.ts` importado também pelo front).
- Worker `{imagem_id, fase}`: OpenRouter → bytes (referência data URL); Higgsfield → submete (referência URL assinada 2 h), grava `provider_request_id` + `gerando` + `fase+1`, publica `{fase+1}` com `delay: 15` e responde **200** (nunca 5xx depois de publicar); com bytes: `cenaUtil` e ≥40 KB, senão `falhou` (sem cobrança) → Storage `${orgId}/galeria-ia/${familiaId}/${cor-slug}/${missao}-${geracao}-${id}.${ext}` → alertas → grava `prompt` → `gerada` com `custo_usd`.
- [ ] **Step 1: Testes que falham:** prompt termina com `BLOCO_TECNICO`; Moda sem "headline"; `proximaFase` com `provider_request_id` preenchido nunca devolve `submeter`; mensagem com `fase` antiga → `ignorar`; retry da mesma `fase` com lease vencido → reconquista; após `prazo_ate` → `falhar`; linha `gerada` → `ignorar`; alertas `{cor_diferente:true, texto_adicionado:true}` → `cor` e `texto_na_cena`; `cenaUtil(2, 1024, 1024) === false` e `cenaUtil(1, 1024, 1024) === true`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** 1 imagem real por modelo numa família de teste (~US$ 0,15); conferir que nada é cobrado antes da entrega. Commit `feat(galeria-ia): worker de geração`.

### Task 10: Tela — gerar, entregar e acompanhar

**Files:** Create `src/components/galeria/passo-gerar.tsx`, `cartao-imagem.tsx`, `supabase/functions/galeria-imagens/index.ts` (lista e marca entrega); Tests.

**Interfaces (Produces):** edge `galeria-imagens` (gate `requireUserOrg` + org da família): `acao:'listar'` → linhas + URLs assinadas, **sem** cobrar; `acao:'confirmar_exibicao', imagem_ids` → grava `entregue_em = now()` só onde está nulo (dispara a cobrança uma vez); `acao:'reportar_invalida', imagem_id` → `falhou` sem cobrança. Front: `src/lib/galeria/exibicao.ts` com `imagemValida(img: HTMLImageElement): boolean` (decodificou, `naturalWidth > 0`, variância de 64 pixels amostrados > limiar) chamada no `onLoad` do cartão antes de confirmar. `CartaoImagem({ imagem, onGerarDeNovo, onAprovar })`.
- [ ] **Step 1: Testes que falham:** missões pré-marcadas por `missoesSugeridas`; confirmação mostra "N imagens · R$ X" (recortes grátis); alerta aparece no cartão; "Gerar de novo" some na 3ª entregue; cor sem foto desabilitada com motivo; `listar` não grava `entregue_em`; `confirmar_exibicao` 2× grava uma vez; imagem toda branca → `reportar_invalida` e nenhuma confirmação; `familia_id` de outra org → 403 e zero linhas em `platform_image_deliveries`.
- [ ] **Step 2–4:** FAIL → implementar (polling a cada 5 s com `pendente|gerando`) → PASS. **Step 5:** Commit `feat(galeria-ia): gerar e acompanhar`.

## Fatia 4 — Composição e aprovação

### Task 11: Layouts, corte e contraste (puro)

**Files:** Create `src/lib/galeria/layouts.ts`, `contraste.ts`, `supabase/functions/_shared/galeria/corte.ts` (módulo puro, importado pelo front por caminho relativo — se o Vite/tsconfig do app não permitir, duplicar em `src/lib/galeria/corte.ts` com teste de paridade); Tests.

**Interfaces (Produces):** `razaoContraste(a, b): number`; `corDeAcento(cor): string`; `planejarCorte(w, h, capa): { tipo: 'corte'|'preenchimento'|'bloqueado'; sx; sy; sw; sh; perda }`; `Caixa { x; y; w; h; fontePx; linhasMax }`; `layoutMissao(m: Missao, textos: MissaoRoteiro): Caixa[]`; `recortesDetalhe(refW, refH): Array<{ sx; sy; sw; sh }>` (missão 7 e lupas).
- [ ] **Step 1: Testes que falham:** `razaoContraste('#ffffff','#1b1f24') > 16`; `corDeAcento('#139aa0') === '#1b1f24'`; `planejarCorte(864,1152,false)` → `corte`, perda ≈ 0,037; `(1024,1024,false)` → `bloqueado`; `(1024,1024,true)` → `preenchimento`; toda caixa das missões 2–7: `fontePx >= 60`, `x >= 72`, `x+w <= 1128`, `y >= 184.8`, `y+h <= 1355.2`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): layouts, corte e contraste`.

### Task 12: Composição no navegador e aprovação

**Files:** Create `src/lib/galeria/compor.ts`, `public/fonts/inter-600.woff2`, `public/fonts/inter-800.woff2` (+ `@font-face` em `src/index.css`), `supabase/functions/galeria-aprovar/index.ts`; Modify `cartao-imagem.tsx`; Config: CORS do bucket `imagens` para a origem do app; Tests: `src/lib/galeria/__tests__/compor.test.ts`, `supabase/functions/galeria-aprovar/__tests__/validar.test.ts`.

**Interfaces (Produces):** `comporImagemFinal({ cenaUrl, refUrl, missao, textos, corProduto, moda }): Promise<Blob>` — cena e referência sempre do bucket (Task 6), `img.crossOrigin = 'anonymous'`; espera `document.fonts.load('600 60px Inter')`; JPEG com laço de qualidade (0,92 → 0,70) até ≤1 MB; recortes (missão 7, Moda 5) usam só `refUrl`. `validarArquivoFinal(bytes): string[]` (JPEG, 1200×1540, ≤1 MB). Edge `galeria-aprovar` (gate da org) `POST {imagem_id}` após upload do cliente em `final_path` assinado: relê os bytes, valida, grava `final_sha256`, recusa `desatualizada`, → `aprovada`.
- [ ] **Step 1: Testes que falham:** PNG → `formato`; JPEG 1200×1200 → `dimensoes`; JPEG 1200×1540 de 2 MB → `peso`; imagem `desatualizada` → recusa; `compor` com canvas mockado: `moda: true` e missão 1 não chamam `fillText`; missão 7 não carrega `cenaUrl`.
- [ ] **Step 1b (manual, evidência):** com a skill `playwright-cli`, abrir a tela da galeria em dev com uma cena real e salvar: blob 1200×1540 exportado sem erro de canvas sujo, print do arquivo final e print reduzido a 400 px de largura, para cada missão 2–7 (estilo A) e para Moda. Anexar os prints em `docs/superpowers/specs/evidencias/galeria-render/`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): composição e aprovação`.

## Fatia 5 — Aplicar no ML

### Task 13: Upload multipart, retrato e plano de fotos (puro)

**Files:** Modify `supabase/functions/_shared/ml/fotos.ts` (`subirFotoMLArquivo`); Modify `supabase/functions/_shared/ml/atualizar-item.ts` (`buscarItemML` acrescenta `catalog_listing,tags` à lista `?attributes=` da linha 66 e expõe `catalogListing: boolean | null` — campo ausente vira `null`, nunca `false`; nova `atualizarFotosItemML(token, itemId, corpo)`); Create `supabase/functions/_shared/galeria/aplicar.ts`, `supabase/functions/_shared/galeria/vinculos.ts` (`vinculosDaCor(admin, orgId, familiaId, cor)`: SKUs = `variacoes.codigo` da cor; lê `anuncios_externos_itens(sku, item_externo_id, user_product_id, retirado)` desses SKUs); Tests.

**Interfaces (Produces):**
- `subirFotoMLArquivo(token, bytes, mime): Promise<{ id: string; pronta: boolean }>` (multipart `file`, `User-Agent: Mozilla/5.0`)
- `type Retrato = { itens: Array<{ itemId: string; variacoes: Array<{ id: number|null; cor: string; pictureIds: string[] }>; pictures: string[] }> }`
- `alvosDaCor(vinculos: Array<{ sku: string; item_externo_id: string; user_product_id: string|null; retirado: boolean }>, skusDaCor: string[]): string[]` (itens não retirados dos SKUs da cor; vazio ou SKU sem vínculo → erro `conjunto_incompleto`)
- `planejarFotosItem({ atual, retrato, cor, novas, capaAprovada, modo, limiteVar, limiteItem, corpoMinimo }): { ok: true; corpo } | { ok: false; motivo: 'mudou'|'limite'|'variacao_ausente'|'catalogo'|'catalogo_desconhecido'|'migracao_pendente'; detalhe }` — `mudou` compara o item **inteiro** (todas as variações e a ordem) com o retrato; item sem variações (UP) → corpo só `{ pictures }`; sem capa aprovada, a 1ª foto atual da cor é mantida na frente (R9.3.2); `catalogListing === null` → `catalogo_desconhecido`; `corpoMinimo` vem do ensaio da Task 1.
- [ ] **Step 1: Testes que falham:** Legacy Rosa+Azul, substituir Rosa → Azul intacta, Rosa só com novas, `pictures` = união; corpo sem `price` e `status`; adicionar 4+7 com limite 10 → `limite`; Azul mudou desde o retrato → `mudou`; `catalog_listing: true` → `catalogo`; campo ausente → `catalogo_desconhecido`; tag `variations_migration_pending` → `migracao_pendente`; item UP sem variações → corpo só com `pictures` (sem chave `variations`); substituir sem capa aprovada → 1ª foto atual continua na posição 1; `alvosDaCor` com 3 SKUs da cor (P, M, G) → 3 itens; um SKU sem vínculo → `conjunto_incompleto`; `subirFotoMLArquivo` envia `FormData` com `file` e devolve `pronta:false` sem `variations`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): retrato e plano de fotos`.

### Task 14: Saga de aplicar e reverter

**Files:** Create `supabase/functions/galeria-aplicar/index.ts` (preparar e disparar), `supabase/functions/galeria-aplicar-worker/index.ts` (um item por job), `supabase/functions/_shared/galeria/saga.ts`; Modify `supabase/config.toml`; Test `…/__tests__/saga.test.ts`.

**Interfaces (Produces):**
- Edge `galeria-aplicar`: `requireUserOrg` + admin (senão 403). `acao:'preparar'` → GET ao vivo de todos os alvos (`alvosDaCor` + `buscarItemML`), grava `galeria_aplicacoes` `preparada` com `retrato`; `acao:'confirmar', aplicacao_id` → `em_andamento`, `garantirFilaSerial(userId)` e `qstashClient().queue({ queueName: 'publish-ml-' + userId }).enqueueJSON(...)` um job por item (`userId` = dono da conexão ML resolvida por `resolverConexaoEstrita`), gravando `publicado_em`; `acao:'reverter', aplicacao_id` → jobs de reversão na mesma fila. Se o ensaio da Task 1 exigir `available_quantity` no PUT, o job relê o item imediatamente antes do PUT e o Codex/Grok decidem antes desta task se é preciso serializar também o push de estoque.
- `passoSaga(item, ctx): { acao: 'subir'|'put'|'conferir'|'compensar'|'concluir'|'ignorar'; ... }` — puro; ordem: grava `fotos_antes` (commit) → sobe fotos que ainda não têm `ml_picture_id` (reaproveita) → GET imediato + `planejarFotosItem` → PUT → GET de conferência → `aplicado`; erro após o PUT → GET decide se o PUT pegou; falha → compensa com `fotos_antes` só se as fotos atuais forem as esperadas, senão `reversao_incompleta`.
- Retomada pela `galeria-varredura` (Task 8): item `pendente|subindo|aplicando|revertendo` com `lease_ate` vencido ou sem `publicado_em` → republica na fila `publish-ml-${userId}`; o job decide pelo GET ao vivo.
- [ ] **Step 1: Testes que falham:** job publicado na fila `publish-ml-<userId>` (nunca `publish-ml-<orgId>`); item `subindo` com lease vencido é retomado e reaproveita `ml_picture_id` já gravados; UP com P, M, G da mesma cor → 3 jobs; PUT do M falha → P compensado, G não tocado, aplicação `falhou` com detalhe por item; queda depois do PUT (resposta perdida) + GET mostra fotos novas → `aplicado` sem novo PUT; compensação com fotos atuais diferentes das esperadas → `reversao_incompleta`, sem PUT; conferência com ordem errada → compensa; foto `pronta:false` → nenhum PUT; não admin → 403; reverter com fotos atuais ≠ `fotos_depois` → `mudou`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): saga de aplicar e reverter`.

### Task 15: Tela — aplicar e reverter

**Files:** Create `src/components/galeria/passo-aplicar.tsx`; Test `…/__tests__/passo-aplicar.test.tsx`.
- [ ] **Step 1: Testes que falham:** não admin vê botões desabilitados com `title` (ADR-0060); confirmação lista os MLB do retrato e o modo (Substituir pré-selecionado); `limite` oferece Substituir; `mudou` mostra a diferença e pede nova preparação; `reversao_incompleta` mostra aviso vermelho com os MLB; `aplicada` oferece "Reverter".
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): aplicar e reverter na tela`.

## Fatia 6 — Retenção, entrega e validação

### Task 16: Retenção, deploy, documentação e validação real

**Files:** Modify `supabase/functions/galeria-varredura/index.ts` (parte diária: apaga do Storage arquivos de `galeria_imagens` com `aprovado_em is null`, sem uso em `galeria_aplicacao_itens` e `criado_em < now() - interval '30 days'`; zera `cena_path`/`final_path`; mantém a linha) + teste `…/__tests__/retencao.test.ts` (aprovada que virou `desatualizada` nunca é apagada); Create `scripts/qstash-agendar-galeria.ts` (cria o agendamento de 5 min, idempotente); Modify `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md` (skill `docs-update-checklist`).
- [ ] **Step 1:** `pnpm preflight` — tudo verde.
- [ ] **Step 2:** Diego roda `! supabase secrets set HF_CREDENTIALS=…`; `supabase db push`; `npm run db:check`; deploy de `galeria-fatos galeria-roteiro galeria-gerar galeria-worker galeria-imagens galeria-aprovar galeria-aplicar galeria-aplicar-worker galeria-varredura`; rodar `scripts/qstash-agendar-galeria.ts` + todas as funções que importam `_shared/ml/fotos.ts` e `_shared/ml/atualizar-item.ts` (listar com grep); conferir versões.
- [ ] **Step 3:** Validação real com Diego (bloqueia a liberação): 1 anúncio Legacy e 1 família UP da Task 1; gerar → aprovar → aplicar → conferir no ML (preço, estoque, demais cores) → reverter → conferir; conferir 1 cobrança por imagem entregue e nenhuma pela missão 7.
- [ ] **Step 4:** Commit `docs(galeria-ia): entrega da galeria da cor`.

---

## Revisão e execução

- Cada task: diff revisado pelo Codex (`gpt-6.1-sol`, high) **e** pelo Grok 4.7 xhigh (decisão do Diego para esta feature).
- Pré-merge: Grok 4.7 xhigh no diff completo + CI verde. Merge só depois da validação real da Task 16.
