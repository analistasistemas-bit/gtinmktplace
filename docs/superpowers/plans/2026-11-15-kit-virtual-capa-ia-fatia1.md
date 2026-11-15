# Kit Virtual — Fatia 1 (etapas, capa IA, texto IA, recebe avulso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Criar Kit Virtual ganha 2 etapas (Composição → Anúncio) com capa gerada por IA a partir das fotos unitárias dos componentes, título+descrição por IA com "Regerar" e o card "Você recebe vendendo avulso" por componente.

**Architecture:** Edge nova `gerar-capa-kit-virtual` copiada de `gerar-capa-kit-unidades` (mesma máquina de estados, cobrança e teto), com prompt/visão novos em `_shared/ai/foto-kit-virtual.ts` e persistência em `kit_variacao_imagens` (coluna `composicao`). Título IA na `preview-kit-virtual`. Recebe avulso 100% front, reaproveitando `calcularTarifaML` + `simularRecebe` + `DetalheRecebe`. Galeria = Fatia 2 (plano próprio, depois do gate de medição).

**Tech Stack:** React 19 + TS + TanStack Query + Radix/shadcn; Supabase Edge (Deno) + Postgres; OpenRouter (imagem `resolverModeloImagem`, texto `resolverModeloTexto`); vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-kit-virtual-capa-ia-galeria-design.md`

## Global Constraints
- Caminho **crítico** (cobrança + publicação ML): revisão independente obrigatória (Codex `gpt-6.1-sol` high ou subagente Opus high, contexto limpo) antes de `db push`/deploy. Nunca rebaixar modelo em Tasks 1, 3 e 4.
- Migration só por `supabase migration new` + `supabase db push`; `npm run db:check`. Antes do merge: `git fetch` e conferir que o timestamp é mais novo que a última migration da main.
- ADR-0206 escrito no Task 1, antes de qualquer código.
- Mudança em `_shared/` → redeployar toda edge que importa o arquivo alterado.
- Edge nova declarada em `supabase/config.toml` com `verify_jwt = true`.
- Mensagens ao operador em pt-BR; texto cru do ML só em log.
- Dropdown só com `src/components/ui/select.tsx`. Visual do `dialog-criar-kit.tsx` (skill `ui-ux-pro-max` no Task 8).
- Nunca número inventado: estados "indisponível"/"sem custo" explícitos (ADR-0107).
- Portão de pré-push: `pnpm preflight`.
- Testes: `pnpm test -- <arquivo>` roda a suíte toda; usar `pnpm vitest run <arquivo>` para um arquivo.

## Review Focus
1. Composição com Σqtd > 6 (ex.: 3+3+1): modo `uma_de_cada`, pedido e visão esperam 1 de cada → teste no Task 2.
2. `itemId` enviado que é de outra org ou não pertence ao `user_product_id` → 403/409 sem gastar IA → teste no Task 3.
3. Path de foto de outra org em `subir-foto-kit-virtual` → recusado → teste no Task 4.
4. Operador volta à etapa 1, muda a composição e avança: capa e texto antigos não podem sobreviver → teste no Task 8.
5. Componente sem custo / sem medidas / tarifa não oficial: card mostra estado, não número → teste no Task 7.

---

### Task 1: ADR-0206 + migration (coluna `composicao`, RPC de teto)

**Files:**
- Create: `docs/decisions/0206-kit-virtual-capa-ia-texto-recebe.md` (+ linha no `docs/decisions/README.md`; emenda curta no ADR-0154 D-4/D-5 apontando para o 0206)
- Create: `supabase/migrations/<ts>_kit_virtual_capa_ia.sql` (via `supabase migration new kit_virtual_capa_ia`)
- Create: `supabase/tests/kit_capa_virtual_reservar.sql`

**Interfaces:**
- Produces: colunas `kit_variacao_imagens.composicao text` e `pedido jsonb` (`[{user_product_id, quantidade}]` na ordem do kit; ambas nulas fora do kit virtual); `familia_base_id` nullable; RPC `public.kit_capa_virtual_reservar(p_org_id uuid, p_request_id uuid, p_tentativa smallint, p_composicao text, p_pedido jsonb, p_modelo text, p_criado_por uuid) returns text` (`'ok'|'teto'`).

- [ ] **Step 1:** ADR-0206: decisões da spec §7, §8.1, §8.3, §8.4.1, §8.5 (cobrança igual ao vinculado; teto 6/24 h por composição sem quantidades; título IA com fallback; recebe avulso). Status PROPOSTO até a 1ª medição real (2, 3 e 6 itens).
- [ ] **Step 2: Teste SQL que falha** (`supabase/tests/kit_capa_virtual_reservar.sql`, mesmo formato de `kit_capa_unidades_reservar.sql`): (a) 6 chamadas com request_ids distintos e mesma `composicao` → `ok`×6, 7ª → `teto`; (b) outra composição → `ok`; (c) insert direto com `composicao` + `cores` → viola check; (d) linha de unidades antiga (`n=2`, `familia_base_id` preenchido) continua válida; (e) linha `composicao` com `familia_base_id` nulo é aceita; (f) linha de cores sem `familia_base_id` é recusada.
- [ ] **Step 3:** Rodar `python3 scripts/teste-sql-desfeito.py supabase/tests/kit_capa_virtual_reservar.sql supabase/migrations/<ts>_kit_virtual_capa_ia.sql` com a migration vazia → FAIL.
- [ ] **Step 4: Migration** (re-executável, `if exists/if not exists`):
  - `alter column familia_base_id drop not null`; `add column if not exists composicao text`; `add column if not exists pedido jsonb`.
  - Troca `kit_variacao_imagens_cores_ou_unidades_check` por `kit_variacao_imagens_tipo_check`: exatamente um de — cores (`cores`,`rotulo`,`familia_base_id` not null; `n`,`composicao` null) | unidades (`n`,`familia_base_id` not null; `cores`,`rotulo`,`composicao` null) | composição (`composicao`,`pedido` not null; `cores`,`rotulo`,`n`,`familia_base_id` null).
  - Índice parcial `kit_variacao_imagens_teto_composicao_idx (org_id, composicao, criado_em) where composicao is not null`.
  - RPC espelho de `kit_capa_unidades_reservar`: lock `hashtextextended('kit_capa_virtual:'||org||':'||composicao,0)`, teto 6 em 24 h, insere `pendente` com `composicao` e `pedido`. `security invoker`, `search_path=''`, revoke public/anon/authenticated, grant service_role.
  - Trigger de cobrança NÃO muda (conferir que não lê `familia_base_id`).
- [ ] **Step 5:** Teste SQL → PASS; `npm run db:check` → OK.
- [ ] **Step 6:** Atualizar `src/lib/database.types.ts` (coluna + RPC). **Não** rodar `db push` (só no Task 9, após revisão).
- [ ] **Step 7:** Commit `feat(kit-virtual): ADR-0206 e migration da capa IA (composicao + teto)`.

### Task 2: Pedido e visão da composição (`_shared/ai/foto-kit-virtual.ts`)

**Files:**
- Create: `supabase/functions/_shared/ai/foto-kit-virtual.ts`
- Test: `supabase/functions/_shared/ai/__tests__/foto-kit-virtual.test.ts`

**Interfaces:**
- Consumes: `limpar`, `visaoJson` de `./foto-kit-fiel.ts`.
- Produces:
  - `type ItemComposicao = { rotulo: string; quantidade: number }` (rotulo = título do componente, ≤ 80 chars limpo)
  - `MAX_UNIDADES_CAPA = 6`
  - `modoCapa(itens: ItemComposicao[]): 'todas' | 'uma_de_cada'` (Σquantidade ≤ 6 → `todas`)
  - `quantidadesNaCapa(itens): number[]` (`todas` → quantidades; `uma_de_cada` → 1 para cada)
  - `chaveComposicao(userProductIds: string[]): string` (ordena, únicos, `join('|')`)
  - `montarPedidoComposicao(p: { itens: ItemComposicao[]; motivosAnteriores?: string[] }): { textos: string[] }` — instrução em inglês no estilo de `montarPedidoUnidades`: "reference image i = product i; show EXACTLY q_i units of product i…, same scale, no overlap, plain light background, no new text/logo, never alter printed text, no extra items"; DATA = `{ produtos: [{indice, quantidade}], corrigir? }`.
  - `verificarComposicao(p: { originais: string[]; gerada: string; quantidades: number[]; timeoutMs: number }): Promise<{ verificacao: unknown; custoUsd: number }>` — schema `{ contagem: integer[], itens_extras: boolean, texto_novo: boolean, fundo_neutro: boolean, produtos_fieis: boolean, observacao: string }`; imagens = originais na ordem + gerada por último.
  - `avaliarComposicao(v: unknown, quantidades: number[]): { aprovado: boolean; motivos: string[] }` — fail-closed: `contagem` com mesmo tamanho e cada `contagem[i] === quantidades[i]`; `itens_extras === false`; `texto_novo === false`; `fundo_neutro === true`; `produtos_fieis === true`. Motivo por produto: `produto ${i+1}: contei X, esperava Y`.

- [ ] **Step 1: Testes que falham:**
```ts
expect(modoCapa([{rotulo:'A',quantidade:2},{rotulo:'B',quantidade:1}])).toBe('todas');
expect(modoCapa([{rotulo:'A',quantidade:3},{rotulo:'B',quantidade:3},{rotulo:'C',quantidade:1}])).toBe('uma_de_cada');
expect(quantidadesNaCapa([{rotulo:'A',quantidade:4},{rotulo:'B',quantidade:3}])).toEqual([1,1]);
expect(chaveComposicao(['MLBU2','MLBU1','MLBU2'])).toBe('MLBU1|MLBU2');
expect(avaliarComposicao({contagem:[2,1],itens_extras:false,texto_novo:false,fundo_neutro:true,produtos_fieis:true,observacao:'ok'},[2,1]).aprovado).toBe(true);
expect(avaliarComposicao({contagem:[2],itens_extras:false,texto_novo:false,fundo_neutro:true,produtos_fieis:true,observacao:''},[2,1]).aprovado).toBe(false);
expect(avaliarComposicao({contagem:[1,1]},[2,1]).motivos).toContain('produto 1: contei 1, esperava 2');
expect(avaliarComposicao(null,[1,1]).aprovado).toBe(false);
// pedido: motivos anteriores entram limpos no DATA, nunca nas instruções
expect(montarPedidoComposicao({itens:[{rotulo:'A',quantidade:2},{rotulo:'B',quantidade:1}],motivosAnteriores:['x']}).textos[1]).toContain('"corrigir"');
```
- [ ] **Step 2:** `pnpm vitest run supabase/functions/_shared/ai/__tests__/foto-kit-virtual.test.ts` → FAIL.
- [ ] **Step 3:** Implementar as funções acima.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(kit-virtual): pedido e verificação por visão da capa da composição`.

### Task 3: Edge `gerar-capa-kit-virtual`

**Files:**
- Create: `supabase/functions/gerar-capa-kit-virtual/index.ts` (cópia de `gerar-capa-kit-unidades/index.ts`, adaptada)
- Create: `supabase/functions/gerar-capa-kit-virtual/origem.ts`
- Modify: `supabase/config.toml` (bloco `[functions.gerar-capa-kit-virtual] verify_jwt = true`)
- Test: `supabase/functions/gerar-capa-kit-virtual/__tests__/origem.test.ts`, `__tests__/handler.test.ts` (padrão de `gerar-capa-kit-unidades/__tests__/handler.test.ts`)

**Interfaces:**
- Consumes: Task 1 RPC; Task 2 funções; `baixarFotoMl`, `ehUrlFotoMl` de `../gerar-capa-kit-unidades/capa-ml.ts`; `moderadosDoBulk` de `../criar-kit-variacao/processar.ts`; `caminhoMultiget`, `comoEnvelopeAntigo`.
- Produces:
  - Request `{ request_id: uuid, componentes: [{ user_product_id: string, item_id: string, quantidade: 1..10, rotulo: string }] }` (2..6 itens, `user_product_id` únicos).
  - Response = mesmo contrato `RespostaFotoKit` do vinculado (`ok, aprovado, path, url, motivos, proxima, tentativa, previa_url, falha_tecnica, motivo, mensagem`).
  - `origem.ts`: `fotosDeOrigem(entradas: unknown, pedidos: {userProductId:string; itemId:string}[]): { ok: true; urls: string[] } | { ok: false; motivo: 'item_divergente' | 'item_inelegivel'; itemId: string }` — puro, sobre o multiget `id,status,sub_status,pictures,user_product_id`: item não lido/`user_product_id` diferente → `item_divergente`; moderado (`moderadosDoBulk`) ou sem foto 1 válida (`ehUrlFotoMl`) → `item_inelegivel`.

- [ ] **Step 1: Testes que falham (`origem.test.ts`):** item com `user_product_id` diferente → `item_divergente`; item `under_review` → `item_inelegivel`; foto fora do CDN → `item_inelegivel`; 2 itens ok → `urls` na ordem dos pedidos.
- [ ] **Step 2: Testes que falham (`handler.test.ts`):** sem módulo `imagem_ia` → 403; não admin → 403; 1 componente ou 7 → 400; `item_id` fora de `anuncios_externos_itens` da org (`retirado=false`) → 403 sem chamar RPC nem IA; RPC `'teto'` → 429 `teto_diario`; mesmo `request_id` com composição diferente → 409 `pedido_diferente`; aprovado → path `${orgId}/kit-virtual-ia/${requestId}.${ext}` e chamada à RPC com `p_composicao = chaveComposicao(ids)`; `item_inelegivel` → 409 com `mensagem` citando o `rotulo` do componente.
- [ ] **Step 3:** Rodar os dois arquivos → FAIL.
- [ ] **Step 4:** Implementar. Diferenças em relação à cópia: (a) entrada e checagem de posse do item por `anuncios_externos_itens` (`org_id`, `item_externo_id in item_ids`, `retirado=false`); (b) origem = `fotosDeOrigem` + `baixarFotoMl` de cada URL, leitura antes da reserva (falha de leitura não conta no teto, como no vinculado); (c) reserva `kit_capa_virtual_reservar`; (d) `gerarImagem(modelo, montarPedidoComposicao(...).textos, originais, …)`; (e) visão `verificarComposicao` + `avaliarComposicao(…, quantidadesNaCapa(itens))`; (f) idempotência: mesmo `request_id` com `composicao` ou `pedido` diferentes → 409 `pedido_diferente`; (g) prefixo `kit-virtual-ia`. Prazos, logs por lista de permissão, cobrança e `MAX_TENTATIVAS` iguais.
- [ ] **Step 5:** Rodar → PASS; `pnpm lint:functions && pnpm check:functions` → OK.
- [ ] **Step 6:** Commit `feat(kit-virtual): edge gerar-capa-kit-virtual`.

### Task 4: `subir-foto-kit-virtual` aceita só foto da org

**Files:**
- Modify: `supabase/functions/subir-foto-kit-virtual/processar.ts`, `index.ts`
- Test: `supabase/functions/subir-foto-kit-virtual/__tests__/processar.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: `fotoDaOrg(path, orgId, usuariosDaOrg)` de `../criar-kit-variacao/processar.ts`.
- Produces: `validarSubirFotoKitVirtual(input, orgId: string, usuariosDaOrg: Set<string>)` devolve `'path_invalido'` para path de outra org.

- [ ] **Step 1: Teste que falha:** `outraOrg/kit-virtual-ia/x.png` → `{ok:false, motivo:'path_invalido'}` sem chamar `urlAssinadaFoto`; `${orgId}/kit-virtual-ia/x.png` e `${userId}/kit-virtual-<chave>/foto.jpg` (upload manual atual) → passam.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar (index carrega `usuariosDaOrg` como `criar-kit-variacao` faz). **Step 4:** PASS.
- [ ] **Step 5:** Commit `fix(kit-virtual): subir-foto-kit-virtual recusa foto de outra org`.

### Task 5: Título IA no `preview-kit-virtual` + `listingTypeId` no candidato

**Files:**
- Create: `supabase/functions/_shared/ai/titulo-kit-virtual.ts`
- Modify: `supabase/functions/preview-kit-virtual/processar.ts`, `index.ts`; `supabase/functions/buscar-componentes-kit-virtual/leitura-ml.ts`, `processar.ts`, `index.ts`; `src/lib/kit-virtual.ts`
- Test: `supabase/functions/preview-kit-virtual/__tests__/processar.test.ts`, `supabase/functions/_shared/ai/__tests__/titulo-kit-virtual.test.ts`, teste existente de `buscar-componentes-kit-virtual`

**Interfaces:**
- Produces:
  - `tituloKitValido(t: string): boolean` — trim não vazio, começa com `Kit ` (case-insensitive), ≤ `LIMITE_TITULO_KIT` (60).
  - `gerarTituloKitViaIA(modelo: string, componentes: {titulo:string; quantidade:number}[]): Promise<string | null>` — 1 chamada `json_schema {titulo}`; nomes dos componentes no bloco DATA; erro → `null`.
  - `PreviewKitDeps.gerarTituloKit?: (componentes) => Promise<string | null>`; com `gerarDescricao=true`, `montarPreviewKit` chama título e descrição em paralelo e devolve `titulo = válido ? IA : template` + `tituloGeradoPorIA: boolean`. Resposta HTTP ganha `titulo_gerado_por_ia`.
  - `ComponenteCandidatoKitVirtual.listingTypeId: string | null` (multiget passa a pedir `listing_type_id`; edge devolve `listing_type_id`).
- [ ] **Step 1: Testes que falham:** `tituloKitValido('Kit Shampoo + Máscara Tanox')===true`; `('Shampoo e Máscara')===false`; 61 chars → false. `montarPreviewKit` com `gerarDescricao:true` e IA devolvendo título inválido → `titulo` = template e `tituloGeradoPorIA:false`; válido → título da IA, `true`; `gerarDescricao:false` → não chama `gerarTituloKit`. Busca: candidato com `listingTypeId:'gold_special'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(kit-virtual): título por IA no preview e listing type no candidato`.

### Task 6: Cliente e hook da capa (`useCapaKitVirtual`)

**Files:**
- Create: `src/lib/capa-kit-virtual-edge.ts`, `src/components/kit-virtual/gerar-capa-kit-virtual.tsx`
- Test: `src/components/kit-virtual/__tests__/gerar-capa-kit-virtual.test.tsx`

**Interfaces:**
- Consumes: `invocar`, `RespostaFotoKit` de `@/lib/kit-variacao-edge`; `EstadoCapa` de `@/components/kit/gerar-capa-unidades`; `PreviaCapaUnidades`; `useModulosHabilitados`.
- Produces:
  - `gerarCapaKitVirtualEdge(p: { requestId: string; componentes: { userProductId: string; itemId: string; quantidade: number; rotulo: string }[] })`.
  - `useCapaKitVirtual(componentes, open): { estado: EstadoCapa; gerar(): void; descartar(): void }` — mesma lógica de `useCapasUnidades` para um único pedido; **a assinatura da composição** (`userProductId:qtd` ordenados) muda → zera estado e `request_id` e ignora geração em voo.
  - `<GerarCapaKitVirtual estado onGerar onUsar(path: string) onDescartar habilitado />` — botão "Gerar capa do kit" (ícone `Sparkles`), legenda do modo ("Mostra todas as N unidades" / "Mais de 6 unidades: uma de cada produto"), prévia, "Usar esta foto", "Gerar de novo", mensagens de erro/teto (`MSG_TETO`). Oculto sem módulo `imagem_ia` ou com componente sem `itemId`.
- [ ] **Step 1: Testes que falham:** sem módulo → botão ausente; candidata → "Usar esta foto" chama `onUsar(path)`; reprovada → motivos visíveis; mudar `componentes` (qtd) após candidata → estado volta a `idle`; 429 → mensagem de teto.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(kit-virtual): botão e hook da capa por IA`.

### Task 7: Card "Você recebe vendendo avulso"

**Files:**
- Create: `src/lib/kit-virtual-recebe.ts`, `src/components/kit-virtual/recebe-avulso-kit-virtual.tsx`
- Test: `src/lib/__tests__/kit-virtual-recebe.test.ts`, `src/components/kit-virtual/__tests__/recebe-avulso-kit-virtual.test.tsx`

**Interfaces:**
- Consumes: `calcularTarifaML(preco, categoriaMlId, dim, aliquotaPct)`, `DimensoesFrete`; `simularRecebe` (`@/lib/kit-recebe`); `useAliquotas`; `aliquotaDoKit(origem, aliquotas)`; `DetalheRecebe`; `ComponenteSelecionadoKitVirtual` (com `listingTypeId` do Task 5).
- Produces:
  - `useMedidasComponentes(codigos: string[]): Record<string, DimensoesFrete>` — select em `variacoes` (`codigo, altura_cm, largura_cm, comprimento_cm, peso_gramas`) da org, query key própria.
  - `somaRecebeAvulso(linhas: { recebe: number | null; quantidade: number }[]): number | null` — `null` se alguma linha `null`; senão Σ recebe × qtd, `round2`.
  - `<RecebeAvulsoKitVirtual componentes liquidoKit: number | null />` — tabela por componente (Produto, Preço, Recebe, Lucro, Margem %) com `DetalheRecebe` expansível; tipo = `listingTypeId === 'gold_pro' ? 'gold_pro' : 'gold_special'`; rodapé "Separado (× qtd): R$ X · No kit: R$ Y" + aviso "frete do kit é estimativa (0)".
- [ ] **Step 1: Testes que falham:** `somaRecebeAvulso([{recebe:50,quantidade:2},{recebe:30.5,quantidade:1}])===130.5`; com um `null` → `null`. Componente: sem custo → "custo não cadastrado" e sem lucro; tarifa não oficial (mock) → "indisponível"; sem medidas → frete "indisponível"; rodapé mostra os dois totais quando prontos.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(kit-virtual): card de recebe avulso por componente`.

### Task 8: Dialog em 2 etapas (visual premium)

**Files:**
- Modify: `src/components/kit-virtual/DialogCriarKitVirtual.tsx`, `src/components/kit-virtual/preview-kit-virtual.tsx`
- Test: `src/components/kit-virtual/__tests__/DialogCriarKitVirtual.test.tsx`

**Interfaces:**
- Consumes: Tasks 5, 6, 7; `EtapasKit` (`@/components/kit/etapas-kit`); `CampoFoto`.
- [ ] **Step 0:** Carregar a skill `ui-ux-pro-max` e usar `dialog-criar-kit.tsx` como referência de hierarquia, espaçamento e cards.
- [ ] **Step 1: Testes que falham:**
  - Pílulas `1. Composição` / `2. Anúncio`; etapa 1 não tem mais "Foto do kit".
  - Entrar na etapa 2 chama `previewKitVirtual` com `gerarDescricao:true` uma vez; voltar e avançar sem mudar a composição **não** chama de novo; mudar qtd e avançar → chama de novo e zera capa aprovada (`fotoStoragePath` null).
  - "Regerar" chama `gerarDescricao:true`; com título editado à mão pede confirmação antes de sobrescrever.
  - Ajuste de desconto não sobrescreve título/descrição.
  - "Usar esta foto" → `fotoStoragePath = path` → `subirFotoKitVirtualEdge(path)` chamado; "Publicar kit" exige foto.
  - Refazer (`refazerDe`) continua abrindo com foto/título/descrição herdados e **não** dispara geração automática.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar: etapa 2 em seções (Capa: `GerarCapaKitVirtual` + `CampoFoto` "ou envie uma foto"; Texto: título com contador 60 + "Regerar" + descrição; Preço: desconto/margem atual; `RecebeAvulsoKitVirtual`). Assinatura de composição guardada em ref para decidir geração automática e reset.
- [ ] **Step 4:** PASS + `pnpm build`.
- [ ] **Step 5:** Commit `feat(kit-virtual): criar kit virtual em 2 etapas com capa IA, texto IA e recebe avulso`.

### Task 9: Revisão crítica, deploy e validação

- [ ] **Step 1:** `pnpm preflight` → verde.
- [ ] **Step 2:** Revisão independente (Codex `gpt-6.1-sol` high, `-s read-only … < /dev/null`, ou subagente Opus high) só com o diff + spec + ADR-0206. Corrigir achados; re-revisar só o que mudou.
- [ ] **Step 3:** `git fetch`; migration mais nova que a main; `supabase db push`; rodar o teste SQL de novo contra produção (transação desfeita).
- [ ] **Step 4:** Deploy: `gerar-capa-kit-virtual`, `subir-foto-kit-virtual`, `preview-kit-virtual`, `buscar-componentes-kit-virtual` (+ toda edge que importe `_shared/ai/titulo-kit-virtual.ts`/`foto-kit-virtual.ts` — só as novas). Conferir versão e `verify_jwt` via `supabase functions list`.
- [ ] **Step 5:** Docs: `docs/TASKS.md`, `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md` (skill `docs-update-checklist`).
- [ ] **Step 6:** Validação visual (Playwright, sessão própria, print real) das duas etapas; CI verde; merge fast-forward na main; pull no checkout principal; remover worktree/branch.
- [ ] **Step 7:** Pedir ao Diego a 1ª rodada real (2, 3 e 6 itens) e registrar no ADR-0206.

### Fatia 2 (fora deste plano)
Gate de medição da galeria em Kit Virtual (`pictures` no POST ou PUT pós-CREATE) num kit já publicado, **só com OK do Diego**; depois plano próprio.
