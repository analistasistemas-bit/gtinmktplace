# Galeria da cor por IA — Implementation Plan (v5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Publicados, gerar até 7 imagens por cor de um anúncio já publicado (fatos → roteiro → cenas por IA → texto composto → aprovação → aplicar no ML), cobrando cada imagem entregue.

**Architecture:** Fatos e roteiro em edges síncronas. **O estado gravado na linha é a fila de trabalho:** `galeria-despachante`, agendado no QStash a cada 1 min, lê as linhas que precisam de ação (imagem a submeter ou consultar, item de aplicação a executar ou compensar) e publica um job por linha; os workers só executam uma fase com claim e lease e gravam o estado — nunca encadeiam mensagens. A publicação imediata no pedido é só otimização de latência. A cobrança acontece quando o navegador confirma a exibição de uma imagem já pronta, ao preço confirmado no pedido. Corte 1200×1540 e tipografia são compostos no navegador (canvas) na aprovação; missão 7, lupas e detalhe de Moda saem de recortes da foto real, sem gerador. Aplicar é uma saga persistida: preparação com retrato do anúncio e manifesto imutável do que aplicar, um job por item na fila `publish-ml-${familias.user_id}`, portão de aborto antes de cada PUT, compensação persistida, retomada pelo despachante.

**Tech Stack:** React + TS (Vite), Supabase (Postgres, Storage, Deno edges), QStash, OpenRouter, Higgsfield API, API do Mercado Livre, vitest; skill `playwright-cli` para a evidência manual de render.

**Spec:** `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md` (R0–R11) · `docs/decisions/0201-galeria-da-cor-por-ia.md` (§1–§13) · `CONTEXT.md` ("Imagens do anúncio por IA").

**Histórico:** v1 a v4 revisadas por Codex (`gpt-6.1-sol` high) e Grok 4.7 xhigh — REVISAR em todas; v5 incorpora a 4ª rodada (ver "Mudanças da v5" no fim).

## Global Constraints

- Bloco técnico literal ao fim de todo prompt de imagem: `photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard` (R5.4).
- Arquivo final: 1200×1540 JPEG ≤1 MB, não branco (variância de pixels amostrados no navegador); corte ao centro, nunca esticar; capa com preenchimento branco; corte >15% bloqueia (R9.1).
- Layout estilo A: Inter (hospedada em `public/fonts/`), texto #1b1f24 em placa branca ≥92% opaca; fonte ≥5% da largura, títulos 7–8,5%; contraste ≥4,5:1 na cor composta; área segura 6% laterais e 12–88% da altura; ≤3 benefícios, ≤4 pares na ficha (R6.4–R6.5).
- Texto: headline ≤5 palavras, subheadline ≤10, benefício ≤6, etapa ≤7, legenda ≤5; NFC (R6.1–R6.2).
- Moda: decidida pela **edge** pelo `path_from_root` lido ao vivo, nunca pelo modelo de IA; em Moda nenhuma imagem leva texto (ADR §11). Vistas "De costas"/"Lateral" só com referência daquela vista cadastrada; a edge recusa a missão sem ela (R3.2).
- Fato `CONFIRMADO` só da planilha ou de confirmação do operador por campo; `atributos_ml`, `titulo_ml`, `descricao_ml` são `SUGERIDO` (ADR §12). Medida que varia entre os SKUs que a galeria atende não vira texto (R1.5).
- Recortes (missão 7, lupas, Moda 5): linha `origem = 'recorte'`, aprovável e aplicável, sem provedor e sem cobrança.
- Modelos: `google/gemini-nano-banana-2.1` (padrão), `xai/grok-imagine-image-2.0`, `alibaba/qwen-image-3/edit` (`prompt_extend: true`, ≤3 refs).
- Referência: foto da própria cor, copiada para caminho **imutável** `${orgId}/galeria-ia/${familiaId}/referencias/${corSlug}-${vista}-${sha256}.jpg` (fonte: `variacoes.imagem_path`; sem ela, 1ª foto da variação no ML que **não** seja uma imagem aplicada por esta galeria). Nunca capa multicolor. Arquivos de `referencias/` nunca são apagados pela retenção.
- Identidade e cobrança: cada imagem tem `request_id = idDerivado(pedido_id, cor, missao, geracao)`; o `request_id` do cliente é o `id` de `galeria_pedidos`. Uma linha de cobrança por imagem `gerador` quando o navegador confirma a exibição; `confirmar_exibicao` só atinge linhas `status = 'gerada'` com `cena_path` e `custo_usd` preenchidos (OpenRouter `usage.cost`, senão `custoUsd` do registro) — fora disso não grava nada e a próxima confirmação válida cobra uma vez.
- Preço confirmado: o pedido grava `unit_cents` e `terms_id` vigentes quando o operador confirma o orçamento; a cobrança usa esse `unit_cents` (competência = mês da exibição, com a mesma regra de mês fechado da função atual). Sem condição comercial no pedido → `units = 0`.
- Teto e vagas: nova `geracao` = maior `geracao` não falha da (cor, missão, roteiro) + 1; teto 3 conta só entregues; com geração `pendente|submetendo|gerando` aberta na mesma (cor, missão), o pedido recusa com `em_andamento`. Falha técnica não gasta vaga.
- Toda edge da galeria: `requireUserOrg` + `familia.org_id = orgId`; toda ação por `imagem_id` também confere `imagem.familia_id = familia_id` e `imagem.org_id = orgId`; outra org → 403.
- Fila de escrita no ML: `publish-ml-${familias.user_id}` via `garantirFilaSerial(familias.user_id)` — o mesmo dono que `publicar-familias` usa. Token via `resolverConexaoEstrita` + `getValidAccessTokenConexao`.
- Limite ML: 10 fotos por variação, 12 por item sem variações, lidos da categoria ao vivo. Aplicar substitui na ordem das missões 1..7.
- Endereço do anúncio: Legacy = `anuncios_externos.item_externo_id` da **partição** que contém o SKU (ADR-0048); UP = `anuncios_externos_itens.item_externo_id` por `sku`, `org_id`, `retirado = false` (ADR-0088). `familias.ml_item_id` não é fonte. Forma do corpo segue o GET: `variations` vazio → corpo só `{ pictures }`.
- Toda escrita de fotos (ida **e** compensação) passa pelo mesmo planejador: corpo com **todas** as variações do item, `pictures` = união, sem `price` nem `status`; o ML apaga variação omitida.
- "Anúncio mudou" compara só o conjunto de variações e os `picture_ids` ordenados de cada uma — nunca estoque, preço ou vendas.
- Vigência: a aplicação guarda `roteiro_id` e `fatos_hash`; confirmar e cada PUT revalidam; se mudaram, a aplicação aborta (e compensa o que já foi). Prazo absoluto da saga 30 min → aborta e compensa.
- Aplicar/reverter: só admin; PUT só de fotos com o corpo mínimo provado na Task 1; recusar `catalog_listing` verdadeiro **ou ausente** e tag `variations_migration_pending`.
- Relógio: agendamento do QStash (1 min) chamando `galeria-despachante`, com teto de linhas por execução e cursor **persistido** em `galeria_cursores`; `pg_cron` não publica no QStash.
- Jobs: `deduplicationId = ${linha_id}:${fase}:${tentativa}`; publicação com `retries: 0` para chamadas pagas (OpenRouter/Higgsfield submit) — o despachante é a retomada; no máximo 1 nova submissão paga por imagem após queda, registrada em `tentativa`.
- Higgsfield: o despachante consulta linhas `gerando` a cada execução (1 min); prazo absoluto 12 min e uma consulta final antes de `falhou`.
- Storage do arquivo final: só por URL de upload assinada (`createSignedUploadUrl`) para `${orgId}/galeria-ia/${familiaId}/finais/${imagemId}.jpg`; `galeria-aprovar` lê só esse caminho.
- Migrations via `supabase migration new` + `supabase db push`; `npm run db:check`. Funções SQL novas: `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`. Teste SQL com `set local lock_timeout = '5s'`. Coluna/RPC nova usada pelo front → `src/lib/database.types.ts`.
- Edge chamada por QStash: `verify_jwt = false` + `verificarAssinatura`. `HF_CREDENTIALS` só em `supabase secrets`.
- Portão de entrega: `pnpm preflight` **e** `pnpm build`.
- Retenção (ADR §13): pelo histórico — nunca apaga arquivo com `aprovado_em` não nulo, citado em manifesto de aplicação, ou de `referencias/`; demais arquivos de imagens `gerador` com mais de 30 dias são apagados, a linha fica.

## Review Focus

1. **Seis imagens de um mesmo pedido, confirmação prematura e virada de mês** — seis linhas de cobrança, uma por imagem, ao preço confirmado; confirmar antes da hora não grava nada e não perde a cobrança. Testes na Task 2 e Task 10.
2. **Queda no meio do aplicar** (depois do PUT, entre falhar e enfileirar a reversão, durante a compensação) — a saga retoma pelo GET, nenhum PUT novo depois do aborto, estado final explícito. Testes na Task 14.
3. **Anúncio Legacy de várias cores e família UP P/M/G** — o primeiro aplica no item da raiz; o segundo nos 3 itens da cor; conjunto incompleto aborta. Testes na Task 13 e Task 14.
4. **Fato, foto de referência ou roteiro mudou depois da geração** — imagens desatualizadas não são aprovadas nem aplicadas. Testes na Task 6, Task 7 e Task 12.
5. **Higgsfield lenta ou em timeout** — nenhuma cadeia dupla, nenhuma cobrança sem entrega, falha só depois da consulta final. Testes na Task 9.

---

## Fatia 0 — Registro técnico e ensaio do ML

### Task 0: Adendo técnico ao ADR-0201

**Files:** Modify `docs/decisions/0201-galeria-da-cor-por-ia.md` (seção "Adendo técnico").
- [ ] **Step 1:** Registrar: (a) composição no navegador (edges com 2 s de CPU, sem worker); risco aceito: o arquivo final é produzido pelo navegador do operador da própria org — o servidor valida formato, dimensões, peso e guarda o hash; (b) estado na linha como fila de trabalho e `galeria-despachante` (1 min) como único retomador; workers executam uma fase com claim e lease e não encadeiam mensagens; Higgsfield consultada pelo despachante, prazo 12 min; risco aceito: queda durante uma chamada paga permite no máximo 1 nova submissão (custo da Daludi; cliente cobrado uma vez); (c) cobrança na exibição confirmada pelo navegador, pela RPC atômica `galeria_confirmar_exibicao`, ao preço confirmado no pedido; (d) aplicar como saga persistida com manifesto imutável e portão de aborto, fila `publish-ml-${familias.user_id}`; (e) recortes sem gerador; (f) relógio por agendamento do QStash.
- [ ] **Step 2:** Commit `docs(galeria-ia): adendo técnico ao ADR-0201`.

### Task 1: Ensaio do contrato do ML (bloqueador)

**Files:** Create `scripts/ensaio-galeria-put.ts` (fora da suíte), `docs/superpowers/specs/2026-11-08-galeria-da-cor-ensaio-put.md`.
- [ ] **Step 1:** Diego escolhe 1 anúncio Legacy com ≥2 variações e 1 família UP com ≥2 tamanhos da mesma cor, de baixo risco. Nada roda sem a escolha dele.
- [ ] **Step 2:** Medir, com GET antes/depois (preço, estoque, status, variações, `picture_ids`, `catalog_listing`): (a) GET com `?attributes=…,catalog_listing` num item comum devolve `catalog_listing: false` explícito? (b) Legacy, PUT `variations: [{id, picture_ids}]` sem `available_quantity` — aceita? preserva estoque e preço? (c) idem com `available_quantity`; (d) UP, PUT só `{pictures}`; (e) upload multipart (`POST /pictures`, campo `file`, `User-Agent: Mozilla/5.0`) e tempo até a URL real; (f) restaurar as fotos originais e conferir.
- [ ] **Step 3:** Registrar o corpo mínimo por formato. Se só (c) funcionar: o push de estoque desses SKUs espera aplicação `em_andamento` (ver Task 14) — Codex e Grok revisam essa escolha antes da Task 13.
- [ ] **Step 4:** Commit `docs(galeria-ia): ensaio do contrato do ML`.

## Fatia 1 — Fundação

### Task 2: Tabelas, saga e cobrança compartilhada

**Files:** Create `supabase/migrations/<ts>_galeria_da_cor.sql`, `scripts/sql/teste-galeria-cobranca.sql`.

**Interfaces (Produces):** todas com `org_id uuid not null references public.organizations(id)`, RLS select `org_id = (select public.current_org_id())`, escrita só service_role.
- `galeria_fatos(id, org_id, familia_id, campo, valor, origem check in ('planilha','confirmado_operador'), evidencia jsonb, confirmado_por, confirmado_em, descartado bool default false, unique(org_id, familia_id, campo))`
- `galeria_referencias(id, org_id, familia_id, cor, vista check in ('frente','costas','lateral'), path, sha256, origem check in ('storage','ml','upload_operador'), criado_em, unique(org_id, familia_id, cor, vista, sha256))`
- `galeria_roteiros(id, org_id, familia_id, versao int, conteudo jsonb, fatos_hash text, moda bool, status check in ('rascunho','aprovado','desatualizado'), criado_por, aprovado_por, criado_em, aprovado_em, unique(org_id, familia_id, versao))`
- `galeria_pedidos(id uuid pk, org_id, familia_id, roteiro_id, itens jsonb, unit_cents bigint, terms_id uuid null, criado_por, criado_em)` — preço confirmado pelo operador.
- `galeria_cursores(chave text pk, cursor_em timestamptz, cursor_id uuid, atualizado_em)` — cursor persistido do despachante.
- `galeria_imagens(id, org_id, familia_id, pedido_id, roteiro_id, cor, missao 1..7, geracao smallint, request_id uuid, origem check in ('gerador','recorte'), referencia_id uuid references galeria_referencias, modelo, provedor, provider_request_id, fase int default 0, tentativa int default 0, lease_ate, publicado_em, prazo_ate, status check in ('pendente','submetendo','gerando','gerada','falhou','aprovada','descartada','desatualizada'), prompt, cena_path, final_path, final_sha256, custo_usd numeric(12,6), alertas jsonb, erro, entregue_em, aprovado_por, aprovado_em, ml_picture_id, criado_em, atualizado_em, unique(org_id, request_id))` + índice único parcial `(org_id, roteiro_id, cor, missao, geracao) where status <> 'falhou'`
- `galeria_aplicacoes(id, org_id, familia_id, cor, modo check in ('substituir','adicionar'), retrato jsonb, manifesto jsonb, roteiro_id, fatos_hash text, prazo_ate timestamptz, abortar_em timestamptz, status check in ('preparada','em_andamento','aplicada','abortando','falhou','revertendo','revertida','reversao_incompleta'), aplicado_por, criado_em, atualizado_em)` — `manifesto` = `[{imagem_id, missao, final_sha256}]` ordenado, imutável após `preparada`.
- `galeria_aplicacao_itens(id, org_id, aplicacao_id, item_id, fotos_antes jsonb, fotos_novas jsonb, fotos_depois jsonb, status check in ('pendente','subindo','aplicando','aplicado','falhou','compensando','compensado','reversao_incompleta','pulado'), fase int default 0, lease_ate, publicado_em, erro, atualizado_em, unique(aplicacao_id, item_id))`
- `platform_image_deliveries.origem text not null default 'kit_variacao'`; `public.platform_registrar_imagem(p_org uuid, p_request uuid, p_custo_usd numeric, p_origem text, p_unit_cents bigint default null)` = corpo de `platform_image_delivery_on_generated()` + `origem`; com `p_unit_cents` não nulo usa esse preço (mantém o lock da org, a competência e a regra de mês fechado); security definer, `search_path=''`, revoke. A função do kit passa a chamá-la com `p_unit_cents = null` (comportamento atual).
- Cobrança da galeria **sem gatilho**: RPC `public.galeria_confirmar_exibicao(p_org uuid, p_familia uuid, p_ids uuid[]) returns int` (service_role) — num único statement atualiza `entregue_em = now()` só onde `org_id = p_org and familia_id = p_familia and id = any(p_ids) and origem = 'gerador' and status = 'gerada' and cena_path is not null and custo_usd is not null and entregue_em is null`, e para cada linha atualizada chama `platform_registrar_imagem(…, 'galeria', pedido.unit_cents)`; devolve quantas cobrou.
- RPC `public.galeria_reservar_pedido(p_pedido jsonb) returns setof galeria_imagens` (service_role): insere pedido (com `unit_cents`/`terms_id`) e imagens numa transação com `request_id = idDerivado(...)` (`uuid_generate_v5`); repetição do mesmo `id` devolve as linhas existentes; vaga = maior `geracao` não falha + 1; recusa `em_andamento` com geração aberta e `teto` com 3 entregues.
- [ ] **Step 1: Teste SQL que falha** (`begin; set local lock_timeout='5s'; … rollback;`): pedido com 6 imagens → 6 `request_id` distintos; `galeria_confirmar_exibicao` das 6 `gerada` → devolve 6 e **6** linhas `units=1, origem='galeria'`; de novo → devolve 0, continuam 6; repetir `galeria_reservar_pedido` com o mesmo id → mesmas linhas; confirmar imagem `gerando` → devolve 0 e **não** grava `entregue_em`; depois ela vira `gerada` e a confirmação cobra 1; `custo_usd` nulo → devolve 0 e não grava `entregue_em`; `recorte` → 0; id de outra família → 0; pedido com `unit_cents = 50` e termos do mês da exibição com 80 → linha com `unit_cents = 50`; mês fechado → competência seguinte com o preço do pedido; 3 `falhou` + 1 entregue → a entregue tem `geracao = 1`; uma `desatualizada` sem entrega → próxima nasce `geracao = 2`; geração `gerando` aberta → `em_andamento`; 3 entregues → `teto`; org sem módulo → `units=0, reason='modulo_desligado'`; kit → `origem='kit_variacao'` e preço da competência; `has_function_privilege('authenticated', 'public.platform_registrar_imagem(uuid,uuid,numeric,text,bigint)', 'execute') = false`.
- [ ] **Step 2:** Rodar pela Management API em transação desfeita — FAIL.
- [ ] **Step 3:** Escrever a migration.
- [ ] **Step 4:** Migration + teste no mesmo `begin … rollback` — todas `ok`.
- [ ] **Step 5:** Commit `feat(galeria-ia): tabelas, saga e cobrança compartilhada`.

### Task 3: Regras puras e categorias de Moda

**Files:** Create `supabase/functions/_shared/galeria/regras.ts`; Test `…/__tests__/regras.test.ts`.

**Interfaces (Produces):** `BLOCO_TECNICO`; `LIMITES`; `type Missao`; `type Vista = 'frente'|'costas'|'lateral'`; `missoesDisponiveis(moda: boolean, vistas: Vista[]): Array<{ missao; nome; comTexto; usaGerador; vista: Vista }>` (missão 7 e, em Moda, a 5 com `usaGerador: false`; "De costas"/"Lateral" só se a vista existir); `missoesSugeridas(nCores)`; `CATEGORIAS_MODA: ReadonlySet<string>` + `ehModa(pathFromRoot)`; `contarPalavras`; `termosProibidos(texto, categoria)`.
- [ ] **Step 1:** Montar `CATEGORIAS_MODA` com `GET /categories/{id}` reais (roupas sob "Calçados, Roupas e Bolsas"; sem calçados e bolsas), ids e data no arquivo.
- [ ] **Step 2: Testes que falham:** `BLOCO_TECNICO` literal; `missoesSugeridas(3)` = 1..7, `(4)` = 1..4; Moda sem texto; missão 7 e Moda 5 `usaGerador === false`; `(true, ['frente'])` sem "De costas", `(true, ['frente','costas'])` com; `ehModa` verdadeiro para o path de uma regata e falso para renda e calçado; `contarPalavras('Largura certa: 20 mm') === 4`; proibidos de `'Frete grátis e premium'` e `'100% natural'`.
- [ ] **Step 3–4:** FAIL → implementar (módulo puro) → PASS. **Step 5:** Commit `feat(galeria-ia): regras puras e categorias de Moda`.

### Task 4: Provedores e cliente Higgsfield

**Files:** Create `supabase/functions/_shared/galeria/provedores.ts`, `supabase/functions/_shared/ai/higgsfield.ts`; Tests.

**Interfaces (Produces):** `ModeloGaleria { slug; provedor; endpoint?; maxReferencias; extra; custoUsd; rotulo }`; `MODELOS_GALERIA`; `MODELO_GALERIA_PADRAO`; `modeloGaleria(slug|null)`; `resolverModeloGaleria(admin, orgId)`; `submeterHF(endpoint, entrada): Promise<string>`; `consultarHF(requestId): Promise<{ status: 'pendente'|'concluida'|'falhou'; url?; erro? }>`.
- [ ] **Step 1: Testes que falham:** slug desconhecido → padrão; qwen `prompt_extend === true`; `submeterHF` → `POST https://api.higgsfield.ai/<endpoint>` com header `Key …`; `consultarHF` mapeia `completed`/`nsfw`; 401 lança com status.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): provedores e cliente Higgsfield`.

### Task 5: Modelo da galeria por organização

**Files:** Create `supabase/migrations/<ts>_configuracoes_ai_model_galeria.sql`; Modify `src/lib/ai-modelos.ts`, `src/components/configuracoes/secao-ia.tsx` (Select de `src/components/ui/select.tsx`), `src/lib/database.types.ts`; Test `src/lib/__tests__/ai-modelos-galeria.test.ts`.
- [ ] **Step 1:** Teste: slugs de `MODELOS_GALERIA_UI` = slugs de `MODELOS_GALERIA`; primeiro = padrão. **Step 2:** FAIL. **Step 3:** coluna `configuracoes.ai_model_galeria` (check dos 3 slugs) + tipo + seletor (só admin da plataforma). **Step 4:** PASS + `pnpm lint` + `pnpm build`. **Step 5:** Commit `feat(galeria-ia): modelo da galeria por organização`.

## Fatia 2 — Fatos, referências e roteiro

### Task 6: Ficha Verdade e referências

**Files:** Create `supabase/functions/_shared/galeria/fatos.ts`, `supabase/functions/_shared/galeria/referencias.ts`, `supabase/functions/galeria-fatos/index.ts`; Modify `supabase/config.toml`; Tests.

**Interfaces (Produces):**
- `type EstadoFato = 'CONFIRMADO'|'SUGERIDO'|'DIVERGENTE'|'NAO_CONFERIDO'|'VARIA_POR_TAMANHO'`; `Fato { campo; valor; estado; origem; evidencia; etiqueta? }`
- `montarFicha({ planilha, medidasPorSku: Record<string, Record<string, string>>, atributosML, textosIA, confirmados }): Fato[]` — medida diferente entre os SKUs atendidos → `VARIA_POR_TAMANHO` (não vira texto).
- `aplicarEtiqueta(fatos, leitura): Fato[]`; `hashFatos(fatos, refs: Record<string, string>): string` (CONFIRMADO + sha256 das referências por cor/vista).
- `prepararReferencia(admin, orgId, familiaId, cor, fotosAplicadas: Set<string>): Promise<{ id; path; sha256 }>` — fonte `variacoes.imagem_path`; sem ela, 1ª foto da variação no ML cujo `picture_id` não esteja em `fotosAplicadas` (ids de `galeria_imagens.ml_picture_id`); grava em caminho imutável com o sha.
- Edge: `montar` (recalcula referências; sha diferente do último roteiro aprovado → roteiro `desatualizado` e imagens não aplicadas `desatualizada`), `confirmar`, `descartar`, `manter_cadastro`, `corrigir_cadastro` (só família, nunca ML), `enviar_vista` (upload do operador para costas/lateral, `origem='upload_operador'`).
- [ ] **Step 1: Testes que falham:** planilha → `CONFIRMADO`; atributo IA → `SUGERIDO` (mesmo com a família marcada como editada); renda: atributo `100% POLIÉSTER` + etiqueta `100% Poliamida` → `DIVERGENTE`; regata: `Poliamida` × `96% poliéster` → `DIVERGENTE`; etiqueta ilegível → `NAO_CONFERIDO`; P=60 cm, M=62 cm, G=64 cm de comprimento → `VARIA_POR_TAMANHO`; `hashFatos` muda com `CONFIRMADO` ou com o sha de uma referência e não muda com `SUGERIDO`; `prepararReferencia` pula a 1ª foto do ML quando ela está em `fotosAplicadas`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): ficha verdade e referências`.

### Task 7: Roteiro

**Files:** Create `supabase/functions/_shared/galeria/roteiro.ts`, `supabase/functions/galeria-roteiro/index.ts`; Test.

**Interfaces (Produces):** `MissaoRoteiro { missao; ativa; cena; headline?; subheadline?; beneficios?; specs?; etapas?; legendas?; fatosUsados }`; `Roteiro { categoria; contrato; missoes }`; `validarRoteiro(r, fatos, moda): string[]`. Edge `criar` (categoria e `moda` ao vivo; recusa com `DIVERGENTE`), `salvar` (revalida), `aprovar` (grava `fatos_hash`; imagens não aplicadas de versões anteriores → `desatualizada`).
- [ ] **Step 1: Testes que falham:** headline de 6 palavras; 4 benefícios; spec fora dos `CONFIRMADO`; spec com fato `VARIA_POR_TAMANHO`; "premium"; Moda com headline (mesmo com JSON dizendo `moda: false`); missão 1 com headline; `DIVERGENTE` pendente; caso renda válido → `[]`; aprovar versão 2 desatualiza as não aplicadas da versão 1 e mantém as aplicadas.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): roteiro validado em código`.

### Task 7b: Tela — fatos, referências e roteiro

**Files:** Create `src/components/galeria/dialog-galeria.tsx`, `passo-fatos.tsx`, `passo-roteiro.tsx`, `src/lib/galeria/api.ts`; Modify `src/pages/Publicados.tsx` (botão "Galeria IA", ícone `Images`, em `LinhaTabela`; estado `galeriaDe`); Test.

**Interfaces (Produces):** `DialogGaleria({ familiaId, open, onOpenChange, isAdmin })`; `api.ts` com uma função por ação das edges.
- [ ] **Step 1: Testes que falham:** sem módulo `imagem_ia`, sem botão; `DIVERGENTE` mostra recorte e "Usar o da etiqueta" pré-selecionado; `SUGERIDO` com Confirmar/Descartar; `VARIA_POR_TAMANHO` explicado; Moda oferece "Enviar foto de costas"; contador de palavras vermelho acima do limite; aprovar desabilitado com erro; roteiro `desatualizado` com aviso.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): fatos e roteiro na tela`.

## Fatia 3 — Geração

### Task 8: Pedido de geração e despachante

**Files:** Create `supabase/functions/galeria-gerar/index.ts`, `supabase/functions/_shared/galeria/pedido.ts`, `supabase/functions/galeria-despachante/index.ts`, `supabase/functions/_shared/galeria/despacho.ts`, `scripts/qstash-agendar-galeria.ts`; Modify `supabase/config.toml`; Tests.

**Interfaces (Produces):**
- `idDerivado(pedidoId, cor, missao, geracao): string` (UUID v5; teste de paridade com a RPC em valor fixo).
- `planejarGeracoes({ cores, missoes, moda, vistasPorCor, linhas }): { novas; recortes; bloqueadas: Array<{ cor; missao; motivo: 'teto'|'sem_vista'|'em_andamento' }> }` — mesma regra de vaga da RPC.
- Edge `galeria-gerar` `POST {pedido_id, familia_id, roteiro_versao, cores, missoes, unit_cents_exibido}`: gate da org; roteiro `aprovado`; resolve `platform_resolve_terms` do mês e recusa `preco_mudou` se `image_unit_cents` ≠ `unit_cents_exibido` (a tela mostra o novo preço e pede nova confirmação); missões de vista sem referência → recusa; `galeria_reservar_pedido` (grava `unit_cents`, `terms_id`); recortes nascem `gerada` sem `cena_path`; publica imediatamente um job por imagem `gerador` (otimização; correção não depende disso).
- `selecionarTrabalho(linhas, agora, limites): Array<{ tipo: 'imagem'|'aplicacao_item'; id; fase; tentativa }>` (puro) — imagem `pendente` sem lease; `submetendo|gerando` com lease vencido ou nulo; `gerando` Higgsfield para consultar; item de aplicação `pendente|subindo|aplicando|compensando` com lease vencido ou nulo; aplicação `abortando` com itens `aplicado` ainda não compensando; aplicação com `prazo_ate` vencido → abortar.
- Edge `galeria-despachante` (QStash, agendado a cada 1 min, `verify_jwt = false`): lê no máximo 50 imagens e 20 itens a partir de `galeria_cursores`, publica `{tipo, id, fase, tentativa}` com `deduplicationId = ${id}:${fase}:${tentativa}` e grava o cursor novo (volta ao início ao chegar ao fim); 1×/dia faz a retenção (Task 16) em lotes de 100 com cursor próprio.
- [ ] **Step 1: Testes que falham:** 2 cores × 3 missões → 6 novas; missão 7 e Moda 5 em `recortes`; 3 entregues → `teto`; geração aberta → `em_andamento`; "De costas" sem referência → `sem_vista`; `idDerivado` igual ao da RPC; preço do mês ≠ exibido → `preco_mudou`; `selecionarTrabalho` pega `gerando` com lease nulo (queda entre gravar estado e publicar); 120 linhas → 2 execuções consecutivas com o mesmo body processam ids diferentes (cursor persistido); aplicação com prazo vencido → abortar.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): pedido de geração e despachante`.

### Task 9: Worker de geração

**Files:** Create `supabase/functions/galeria-worker/index.ts`, `supabase/functions/_shared/galeria/prompt.ts`, `alertas.ts`, `worker-estado.ts`, `supabase/functions/_shared/galeria/corte.ts`; Modify `supabase/config.toml`; Tests.

**Interfaces (Produces):**
- `montarPromptCena(m, r, moda, cor, layout): string` (termina com `BLOCO_TECNICO`).
- `interpretarAlertas(resposta): Array<{ tipo: 'cor'|'produto'|'texto_na_cena'|'rotulo_alterado'; nota }>`.
- `planejarCorte(w, h, capa)` e `cenaUtil(missao, w, h)` em `corte.ts` (puro; importado também pelo front).
- `proximaFase(linha, msg: { fase; tentativa }, agora): 'submeter'|'consultar'|'baixar'|'consulta_final'|'falhar'|'ignorar'|'ocupado'` — claim `update … set lease_ate = now() + 60 s where id = $1 and fase = $2 and tentativa = $3 and (lease_ate is null or lease_ate < now())`; lease ativo → `ocupado` (200); ao terminar grava o estado, avança `fase`, zera `lease_ate` — **não publica nada**; o despachante encontra a próxima ação.
- Submissão paga (OpenRouter e Higgsfield submit): grava `submetendo` e `tentativa = tentativa + 1` antes de chamar; se a linha já está `submetendo` com lease vencido e sem `provider_request_id` (queda durante a chamada), permite **uma** nova submissão (`tentativa ≤ 2`), senão `falhou` sem cobrança.
- Worker: OpenRouter → bytes; Higgsfield → grava `provider_request_id` + `gerando`; consulta (vinda do despachante) → `concluida` baixa, `pendente` só libera o lease; passado `prazo_ate` (criado_em + 12 min) → `consulta_final` → `falhar`; com bytes: `cenaUtil` e ≥40 KB, senão `falhou` (sem cobrança) → Storage `${orgId}/galeria-ia/${familiaId}/${corSlug}/${missao}-${geracao}-${id}.${ext}` → alertas → grava `prompt`, `custo_usd` (sempre preenchido) → `gerada`.
- [ ] **Step 1: Testes que falham:** prompt termina com `BLOCO_TECNICO`; Moda sem "headline"; `provider_request_id` preenchido nunca `submeter`; fase ou tentativa antiga → `ignorar`; lease ativo → `ocupado`; `submetendo` com lease vencido e sem id → nova submissão só se `tentativa < 2`, na 2ª queda → `falhar`; depois de 12 min → `consulta_final`, `concluida` nela → `baixar`; terminal → `ignorar`; `cenaUtil(2,1024,1024) === false`, `cenaUtil(1,1024,1024) === true`; alertas mapeados; resposta ilegível → `[]`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** 1 imagem real por modelo numa família de teste (~US$ 0,15); conferir que nada é cobrado antes da exibição. Commit `feat(galeria-ia): worker de geração`.

### Task 10: Tela — gerar, exibir e cobrar

**Files:** Create `src/components/galeria/passo-gerar.tsx`, `cartao-imagem.tsx`, `src/lib/galeria/exibicao.ts`, `supabase/functions/galeria-imagens/index.ts`; Tests.

**Interfaces (Produces):** edge `galeria-imagens` (gate da org): `listar {familia_id, roteiro_versao}` (sem cobrar); `confirmar_exibicao {familia_id, imagem_ids}` → `galeria_confirmar_exibicao(orgId, familia_id, imagem_ids)`; `reportar_invalida {familia_id, imagem_id}` (só linha `gerada` desta família → `falhou`, sem cobrança). `imagemValida(img: HTMLImageElement): boolean` (decodificou, `naturalWidth > 0`, variância de 64 pixels > limiar). `CartaoImagem({ imagem, onGerarDeNovo, onAprovar })`. A tela de confirmação mostra "N imagens · R$ X" com o preço vigente e envia `unit_cents_exibido`.
- [ ] **Step 1: Testes que falham:** missões pré-marcadas por `missoesSugeridas`; confirmação "N imagens · R$ X" (recortes grátis); `preco_mudou` mostra o preço novo e pede nova confirmação; alerta no cartão; "Gerar de novo" some na 3ª entregue; `listar` não grava `entregue_em`; confirmar 2× cobra uma vez; imagem branca → `reportar_invalida`; `imagem_ids` de outra família ou org → nenhuma cobrança.
- [ ] **Step 2–4:** FAIL → implementar (polling 5 s) → PASS. **Step 5:** Commit `feat(galeria-ia): gerar, exibir e cobrar`.

## Fatia 4 — Composição e aprovação

### Task 11: Layouts e contraste (puro)

**Files:** Create `src/lib/galeria/layouts.ts`, `contraste.ts`; Tests (inclui paridade com `corte.ts`).

**Interfaces (Produces):** `razaoContraste`; `corDeAcento`; `Caixa { x; y; w; h; fontePx; linhasMax }`; `layoutMissao(m, textos): Caixa[]`; `recortesDetalhe(refW, refH)`.
- [ ] **Step 1: Testes que falham:** contraste branco × #1b1f24 > 16; `corDeAcento('#139aa0') === '#1b1f24'`; `planejarCorte(864,1152,false)` → corte ≈ 0,037; `(1024,1024,false)` → `bloqueado`; `(1024,1024,true)` → `preenchimento`; toda caixa das missões 2–7: `fontePx >= 60`, `x >= 72`, `x+w <= 1128`, `y >= 184.8`, `y+h <= 1355.2`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): layouts e contraste`.

### Task 12: Composição no navegador e aprovação

**Files:** Create `src/lib/galeria/compor.ts`, `public/fonts/inter-600.woff2`, `public/fonts/inter-800.woff2` (+ `@font-face` em `src/index.css`), `supabase/functions/galeria-aprovar/index.ts`; Modify `cartao-imagem.tsx`; Config: CORS do bucket `imagens` para a origem do app; Tests.

**Interfaces (Produces):** `comporImagemFinal({ cenaUrl, refUrl, missao, textos, corProduto, moda }): Promise<Blob>` (`crossOrigin = 'anonymous'`; `document.fonts.load('600 60px Inter')`; laço de qualidade 0,92 → 0,70 até ≤1 MB; recortes usam só `refUrl`). Edge `galeria-aprovar`: `preparar_upload {familia_id, imagem_id}` → `createSignedUploadUrl` para `${orgId}/galeria-ia/${familiaId}/finais/${imagemId}.jpg`; `aprovar {familia_id, imagem_id}` → lê só esse caminho, `validarArquivoFinal(bytes): string[]` (JPEG, 1200×1540, ≤1 MB), recusa `desatualizada` ou referência com sha diferente da atual, grava `final_sha256`, `aprovado_em`, `aprovado_por` → `aprovada`.
- [ ] **Step 1: Testes que falham:** PNG → `formato`; 1200×1200 → `dimensoes`; 2 MB → `peso`; `desatualizada` → recusa; referência trocada → recusa; `aprovar` grava `aprovado_em`; canvas mockado: Moda e missão 1 sem `fillText`; missão 7 não carrega `cenaUrl`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5 (evidência manual, depois do Step 4):** skill `playwright-cli` em dev com uma cena real: blob 1200×1540 sem erro de canvas sujo; prints do arquivo final e reduzido a 400 px, missões 2–7 e Moda, em `docs/superpowers/specs/evidencias/galeria-render/`.
- [ ] **Step 6:** Commit `feat(galeria-ia): composição e aprovação`.

## Fatia 5 — Aplicar no ML

### Task 13: Alvos, upload multipart e plano de fotos (puro)

**Files:** Modify `supabase/functions/_shared/ml/fotos.ts` (`subirFotoMLArquivo`), `supabase/functions/_shared/ml/atualizar-item.ts` (`catalog_listing` na lista `?attributes=` da linha 66; `catalogListing: boolean | null`; nova `atualizarFotosItemML`); Create `supabase/functions/_shared/galeria/aplicar.ts`, `supabase/functions/_shared/galeria/alvos.ts`; Tests.

**Interfaces (Produces):**
- `subirFotoMLArquivo(token, bytes, mime): Promise<{ id; pronta: boolean }>`
- `alvosDaCor(admin, orgId, familiaId, cor): Promise<{ itens: string[] } | { erro: 'conjunto_incompleto'|'sem_anuncio'; detalhe }>` — SKUs = `variacoes.codigo` da cor (não excluídas). Para cada SKU: UP → `anuncios_externos_itens.item_externo_id` (`org_id`, `sku`, `retirado = false`); Legacy → `anuncios_externos.item_externo_id` da partição que contém o SKU (`org_id`, `codigo_pai`, `variacoes_externas`). Devolve os itens distintos; SKU sem endereço → `conjunto_incompleto`. `familias.ml_item_id` não é usado.
- `planejarFotosItem({ atual, retrato, cor, fotosDaCor, capaAprovada, modo, limiteVar, limiteItem, corpoMinimo }): { ok: true; corpo } | { ok: false; motivo: 'mudou'|'limite'|'variacao_ausente'|'catalogo'|'catalogo_desconhecido'|'migracao_pendente'; detalhe }` — serve à ida (`fotosDaCor` = manifesto na ordem 1..7, com a 1ª foto atual na frente se não houver capa aprovada) **e** à compensação (`fotosDaCor` = `fotos_antes` da cor); o corpo sempre leva **todas** as variações do `atual` (as outras cores com os `picture_ids` atuais) e `pictures` = união; `variations` vazio no GET → corpo só `{ pictures }`; nunca `price` nem `status`; `available_quantity` só se `corpoMinimo` exigir, lido de `atual`. `mudou` compara só o conjunto de ids de variação e os `picture_ids` ordenados com o retrato.
- [ ] **Step 1: Testes que falham:** UP P/M/G → 3 itens; Legacy com 2 partições e SKUs da cor nas duas → 2 itens; SKU sem endereço → `conjunto_incompleto`; vínculo de outra org ignorado; Rosa+Azul, substituir Rosa → Azul com os ids atuais; **compensar** Rosa com `fotos_antes` → Azul com os ids atuais e presente no corpo; manifesto embaralhado → ordem 1..7; corpo sem `price`/`status`; adicionar 4+7 com limite 10 → `limite`; estoque mudou e fotos iguais → **não** é `mudou`; foto da Azul mudou → `mudou`; `catalog_listing` verdadeiro → `catalogo`, ausente → `catalogo_desconhecido`; `variations_migration_pending` → `migracao_pendente`; `variations: []` → corpo só `{ pictures }`; sem capa aprovada a 1ª foto atual fica na posição 1; `subirFotoMLArquivo` envia `FormData` com `file`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): alvos e plano de fotos`.

### Task 14: Saga de aplicar e reverter

**Files:** Create `supabase/functions/galeria-aplicar/index.ts`, `supabase/functions/galeria-aplicar-worker/index.ts`, `supabase/functions/_shared/galeria/saga.ts`; Modify `supabase/config.toml`; Test `…/__tests__/saga.test.ts`.

**Interfaces (Produces):**
- Edge `galeria-aplicar` (admin, senão 403): `preparar {familia_id, cor, modo}` → `alvosDaCor` + GET de cada item; grava `galeria_aplicacoes` `preparada` com `retrato`, `manifesto` (aprovadas da cor no roteiro vigente, com `final_sha256`), `roteiro_id`, `fatos_hash` e itens `pendente`; `confirmar {familia_id, aplicacao_id}` → revalida roteiro vigente e `fatos_hash` (mudou → `desatualizada`, pede nova preparação), grava `em_andamento` e `prazo_ate = now() + 30 min`, `garantirFilaSerial(familias.user_id)` e publica imediatamente um job por item em `publish-ml-${familias.user_id}` (otimização; o despachante retoma); `reverter {familia_id, aplicacao_id}` → grava `revertendo` e itens `aplicado` → `compensando` **na mesma transação**; o despachante executa.
- Worker `galeria-aplicar-worker`: só executa jobs vindos da fila `publish-ml-${familias.user_id}`; o despachante publica nessa mesma fila (nunca em outra).
- `passoSaga(item, aplicacao, ctx): 'subir'|'put'|'conferir'|'concluir'|'pular'|'compensar'|'marcar_incompleta'|'abortar'|'ignorar'|'ocupado'` — puro. Portão (relido do banco antes de cada PUT): `abortar_em` não nulo, `prazo_ate` vencido, roteiro ou `fatos_hash` diferentes dos vigentes → item sem PUT `pular`, com PUT `compensar`, e a aplicação vira `abortando`. Ordem: grava `fotos_antes` → sobe fotos do manifesto sem `ml_picture_id`, conferindo `sha256(bytes) = final_sha256` → relê portão → GET + `planejarFotosItem` → PUT → GET de conferência (cor com os ids esperados na ordem; demais cores intactas) → `aplicado` com `fotos_depois`. Erro após o PUT: GET decide se pegou. Falha: `abortar_em`, aplicação `abortando`, item `falhou` e itens `aplicado` → `compensando`, tudo **na mesma transação**. Compensar = `planejarFotosItem` com `fotos_antes`, só se as fotos atuais da cor = `fotos_depois`; senão `reversao_incompleta`.
- Se a Task 1 exigiu `available_quantity`: o push de estoque (`estoque-${orgId}`) pula SKUs com aplicação `em_andamento|abortando|revertendo` e reenfileira em 60 s; o prazo de 30 min garante que o SKU volta ao push.
- [ ] **Step 1: Testes que falham:** job na fila `publish-ml-<familias.user_id>`; UP P/M/G → 3 itens; PUT do M falha → G `pulado` sem PUT, P compensado com a Azul preservada no corpo; queda entre marcar falha e enfileirar → despachante encontra `compensando` e executa; queda depois do PUT com GET mostrando as fotos novas → `aplicado` sem novo PUT; roteiro aprovado de novo entre `confirmar` e o PUT do 2º item → 2º `pulado`, 1º compensado; `prazo_ate` vencido → aborta e compensa; compensação com fotos atuais ≠ `fotos_depois` → `reversao_incompleta`; sha ≠ manifesto → falha sem PUT; foto `pronta:false` → nenhum PUT; imagem aprovada depois do `preparar` não entra; `reverter` com queda antes de qualquer job → despachante executa as compensações; não admin → 403.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ `pnpm check:functions`). **Step 5:** Commit `feat(galeria-ia): saga de aplicar e reverter`.

### Task 15: Tela — aplicar e reverter

**Files:** Create `src/components/galeria/passo-aplicar.tsx`; Test.
- [ ] **Step 1: Testes que falham:** não admin com botões desabilitados e `title` (ADR-0060); confirmação lista os MLB e as imagens do manifesto na ordem; Substituir pré-selecionado; `limite` oferece Substituir; `mudou` e `desatualizada` pedem nova preparação; `reversao_incompleta` e `pulado` em vermelho com os MLB; `aplicada` oferece "Reverter".
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat(galeria-ia): aplicar e reverter na tela`.

## Fatia 6 — Retenção, entrega e validação

### Task 16: Retenção, deploy, documentação e validação real

**Files:** Modify `supabase/functions/galeria-despachante/index.ts` (retenção diária em lotes de 100, pelo critério das Global Constraints) + teste `…/__tests__/retencao.test.ts` (aprovada que virou `desatualizada` nunca é apagada; arquivo de `referencias/` nunca é apagado; recorte não tem arquivo próprio); Modify `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md` (skill `docs-update-checklist`).
- [ ] **Step 1:** `pnpm preflight` e `pnpm build` — verdes.
- [ ] **Step 2:** Diego roda `! supabase secrets set HF_CREDENTIALS=…`; `supabase db push`; `npm run db:check`; deploy de `galeria-fatos galeria-roteiro galeria-gerar galeria-worker galeria-imagens galeria-aprovar galeria-aplicar galeria-aplicar-worker galeria-despachante` + todas as funções que importam `_shared/ml/fotos.ts` e `_shared/ml/atualizar-item.ts` (listar por grep); conferir versões; rodar `scripts/qstash-agendar-galeria.ts`.
- [ ] **Step 3:** Validação real com Diego (bloqueia a liberação): o anúncio Legacy e a família UP da Task 1; gerar → aprovar → aplicar → conferir no ML (preço, estoque, demais cores, ordem) → reverter → conferir; 1 cobrança por imagem exibida e nenhuma pelos recortes.
- [ ] **Step 4:** Commit `docs(galeria-ia): entrega da galeria da cor`.

---

## Revisão e execução

- Cada task: diff revisado pelo Codex (`gpt-6.1-sol`, high) **e** pelo Grok 4.7 xhigh (decisão do Diego para esta feature).
- Pré-merge: Grok 4.7 xhigh no diff completo + CI verde. Merge só depois da validação real da Task 16.

## Mudanças da v5

Estado na linha como fila e `galeria-despachante` (1 min) como único retomador, sem cadeia de mensagens; cursor persistido; cobrança por RPC atômica que só atinge imagem pronta (confirmação prematura não grava nada); preço confirmado guardado no pedido e cobrado; vaga = maior geração não falha + 1, `em_andamento` com geração aberta; endereço do anúncio por partição (Legacy) e por SKU (UP), sem `familias.ml_item_id`; mesmo planejador na ida e na compensação, sempre com todas as variações; "mudou" só por variações e fotos; vigência (roteiro e `fatos_hash`) revalidada ao confirmar e antes de cada PUT; prazo de 30 min na saga; reversão grava intenção na mesma transação; dedup com tentativa e no máximo 1 nova submissão paga.
