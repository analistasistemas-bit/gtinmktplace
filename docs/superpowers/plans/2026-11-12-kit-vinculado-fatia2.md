# Kit vinculado — Fatia 2 (fotos 2–7 da base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O kit vinculado publica com as fotos 2 a 7 do anúncio da base (reusando `picture_id` do ML), com revisão do operador no preview.

**Architecture:** Edge de leitura nova `fotos-base-kit` propõe a galeria; `criar-kit-vinculado` recalcula no servidor e grava `proposta ∩ pedido` em `variacoes.galeria_ml_fotos` do kit; `publish-familia-ml` (não `montar-canonico`) lê essa coluna **só para kit vinculado e só quando não vazia** (payload byte-idêntico sem ela), revalida os ids antes do POST e rebaixa para "só a capa" se o ML recusar foto.

**Tech Stack:** Deno edge functions (Supabase), React + TS, vitest.

**Spec/ADR:** `docs/superpowers/specs/2026-11-12-kit-vinculado-evolucao-design.md` (Fatia 2); `docs/decisions/0204-kit-vinculado-galeria-da-base.md` (ler primeiro; é a autoridade).

## Global Constraints
- Foto 1 da base nunca entra; fotos 2–7 = índices 1..6 de `item.pictures`; `MAX_FOTOS_BASE_KIT = 6`; limite da categoria **do kit** (override incluso) menos 1 vaga da capa; limite `null` → sem galeria.
- Variação do kit mantém `imagem_path`/`ml_picture_id` nulos (ADR-0203 §14); capa do kit nunca repetida na galeria; dedup por `id`.
- Sem galeria na coluna → payload e fluxo **byte-idênticos** ao atual em TODA publicação (teste de regressão em `montarPayloadItem` ramos `variations` e plano, e em `montarAnuncioCanonico`).
- UPDATE (`atualizar-familia-up`, `ml/atualizar.ts`) nunca reenvia galeria; `ordenarFotosVariacao` mantém a assinatura de 4 posições para eles.
- Recusa de foto com galeria usada: zera a coluna, **não** chama `limparCacheFotosFamilia`, recria só com a capa. Sem galeria usada, caminho atual intacto.
- Cliente só remove foto; servidor recalcula a proposta (`proposta ∩ pedido`). Nunca confiar em ids do corpo.
- Edge de leitura: `requireUserOrg`, escopo `org_id`, módulo `kit_variacao` OU `estoque` (`moduloPermitido` de `preco-avulso-kit`), token da org.
- `_shared/` alterado → redeploy de TODAS as edges que importam os arquivos tocados; conferir versão. Deploy só depois do push da main, em passo separado. Projeto Supabase: `--project-ref txvncrgkoynoxwopfkbp` (worktree não é linkado).
- Roteamento: T3, T4, T5 tocam publicação em marketplace → **opus**, nunca rebaixar. Demais: sonnet. Revisão do plano: Fable 5.2; diffs: Grok 4.7 high.
- Git em worktree: `/usr/bin/git` com comandos simples e separados.

## Review Focus
- Base com 1 foto (sem 2–7) → galeria vazia, kit cria normal, UI diz "a base não tem fotos além da capa".
- Item da base moderado/pausado/`under_review` → galeria vazia com aviso, nunca erro.
- Operador troca a categoria no dialog → limite recalculado com a categoria do kit.
- `ml_picture_id` da capa do kit igual a algum id da proposta → não duplica.
- Retry do QStash depois de a galeria ter sido zerada → segue sem galeria, não a reinsere.
- Kit com `tamanho` (rota UP/`publicarFamiliaUP`) e kit sem `tamanho` (Legacy `criarAnuncio`): os dois levam a galeria.

---

### Task 1: ADR-0204 e adendos (feito antes do código)
**Files:** `docs/decisions/0204-kit-vinculado-galeria-da-base.md` (já escrito), adendo curto em `docs/decisions/0200-*.md` e `0151-*.md` apontando para o 0204 e delimitando "o 0200 item 6 vale só para o kit com variação".
- [ ] Conferir numeração com `git fetch` (0204 livre); corrigir a frase final do ADR ("risco de duplicar"); status PROPOSTO → ACEITO após o Diego; escrever os dois adendos; commit.

### Task 2: Leitura — edge `fotos-base-kit` + lib da proposta
**Files:** Create `supabase/functions/fotos-base-kit/index.ts`, `supabase/functions/_shared/kit-variacao/galeria-base.ts` · Test `supabase/functions/_shared/kit-variacao/__tests__/galeria-base.test.ts`, `supabase/functions/fotos-base-kit/__tests__/`
**Interfaces:** Consumes: `galeriaDasPecas(token, pecas:{cor,itemId}[], limite, f?)`, `lerLimiteFotos(categoriaId, f?)`, `montarGaleriaKit`, `resolverConexao`, `getValidAccessTokenConexao`, `moduloPermitido`. Produces:
```ts
export const MAX_FOTOS_BASE_KIT = 6;
export async function propostaGaleriaBase(p: { token: string; itemIdBase: string | null; categoriaKitId: string | null }, f?: typeof fetch): Promise<{ fotos: {id:string;item:string;url:string}[]; avisos: string[]; indisponivel: boolean; limite: number | null }>
```
Edge: POST `{familia_base_id, categoria_ml_id?}`; gate **admin** (como `fotos-pecas-kit/index.ts:27`), `ehCategoriaMlValida(categoria_ml_id)` (como `criar-kit-vinculado/index.ts:138`), módulo `exigirModulo(admin, orgId, 'estoque')` (gate do kit vinculado, `index.ts:109`; não importar `moduloPermitido` de outra edge) → `{fotos, avisos, indisponivel, limite}`. `itemIdBase` = `familias.ml_item_id` ou, família UP, `anuncios_externos_itens.item_externo_id` (mesmo select de `fotos-pecas-kit`). Base não publicada → `{fotos:[], indisponivel:false, avisos:[]}`. Falha ML → 200 com `indisponivel:true`.
- [ ] Testes (RED): corta em 6; ignora a foto 1; respeita `limite-1`; `limite===null` → vazia; 403 não-admin; categoria inválida → 400; item não limpo → vazia + aviso; edge: 403 sem módulo `estoque`, 404 família de outra org, base sem `ml_item_id` → vazia.
- [ ] Implementar; `pnpm test` dos dois diretórios; commit.

### Task 3: Gravação — `criar-kit-vinculado` salva a galeria (opus)
**Files:** Modify `supabase/functions/criar-kit-vinculado/{index,processar}.ts` · Test `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
**Também (senão a galeria morre no `index.ts` com os testes verdes):** `parseKit` (`criar-kit-vinculado/index.ts:67-89`) monta o kit campo a campo e hoje descartaria `galeria`; a resposta (`:179`) lista campos à mão e precisa incluir `avisos`; o mapeador `criarKitVinculado` em `src/lib/kit.ts` envia `galeria` por kit; teste do parse e do mapeador. Não ler o ML quando nenhum kit pede galeria. O `itemIdBase` vem de UMA função em `galeria-base.ts` usada pela edge (T2) e por esta task (`familias.ml_item_id`; a rota UP também o grava, `publicar-familia-up.ts:393`).
**Interfaces:** Consumes: `propostaGaleriaBase` (T2), injetada por nova porta em `CriarKitDeps` (`processar.ts:67`) para teste. `ResultadoCriarKits` (`:49`) ganha `avisos?: string[]`. Produces: o pedido ganha `kits[i].galeria?: string[]` (ids que o operador manteve); o servidor recalcula a proposta com a categoria efetiva do kit e grava `variacoes.galeria_ml_fotos = proposta ∩ pedido` (formato `[{id,item}]`) na variação do kit, na mesma ordem da proposta. `montarVariacaoKit` passa a definir `galeria_ml_fotos` explicitamente (`[]` quando não há galeria), nunca herdando da base.
- [ ] Testes (RED): sem `galeria` no pedido → `[]` e payload do resto inalterado; ids fora da proposta ignorados; `[]` pedido → `[]`; base sem `ml_item_id` → `[]` sem erro; kit não herda `galeria_ml_fotos` da base; falha de leitura do ML → `[]` e a criação segue (aviso).
- [ ] Implementar; commit.

### Task 4: Publicação comum do kit vinculado leva a galeria (opus, risco alto)
**Regra de ouro (revisão Fable):** NÃO tocar `montar-canonico.ts`. `galeria_ml_fotos` é a mesma coluna do kit com variação (`criar-kit-variacao/processar.ts:376`); preencher a galeria no canônico vazaria para `kit-transferencia` (galeria crua antes do `comGaleria`), para a publicação comum de kit com variação (`publicar-familia-up.ts:198`) e para `publicar-anuncio`. A galeria só é preenchida em `publish-familia-ml`, e **só para kit vinculado** (família com `kit_base_codigo_pai` e `kit_multiplicador`).
**Files:** Modify `supabase/functions/_shared/canais/contrato.ts` (`AnuncioCanonico.galeriaFotoIds?: string[]`), `supabase/functions/publish-familia-ml/processar.ts` (ao lado do `gtinPackFallback`, ~:190), `_shared/ml/publicar.ts` (`montarPayloadItem(..., formato?, galeriaExtra?: string[])`), `_shared/canais/mercado-livre.ts` e `_shared/user-products/publicar-familia-up.ts` (repassam `anuncio.galeriaFotoIds`) · Test `_shared/ml/__tests__/publicar.test.ts`, `publish-familia-ml/__tests__/processar.test.ts`, testes de canais/UP.
**Interfaces:** Consumes: `fotosDaColuna(coluna)` (`galeria-coluna.ts`), `revalidarGaleria(token, fotos:{id,item}[], f?)` (`galeria-leitura.ts:89`), `ctx.getToken()`. Produces: em `publish-familia-ml`, se kit vinculado e a coluna da variação não está vazia: `fotos = fotosDaColuna(coluna)`, `ok = revalidarGaleria(token, fotos)`, `anuncio.galeriaFotoIds = ok.fotos.map(f => f.id)` (os ids aprovados; ignora se vazio); se a revalidação reduziu → notificar com `chave` `kit_galeria:<codigo>:reduzida` (categoria `'estoque'`, como `kit-transferencia/index.ts:156,175`). `montarPayloadItem`: `pictures = [lider, capa2, capa3, ...fotosCor, ...galeriaExtra]` sem repetir (`Set`); no ramo `variations`, `picture_ids` = `ordenarFotosVariacao(...)` + `galeriaExtra` ao fim sem repetir; `ordenarFotosVariacao` NÃO muda de assinatura. O conector (`mercado-livre.ts`, inclusive os retries `'plano'` :177 e GTIN de pack) e `publicarFamiliaUP` (`:198`) passam `galeriaExtra`.
- [ ] Testes (RED) **regressão primeiro**: sem `galeriaExtra`, `JSON.stringify(payload)` idêntico ao snapshot atual (ramos `variations` e plano, com e sem tamanho). Novos: galeria em `pictures` e `picture_ids`; capa/capa2 não repetem; **kit com variação** com a coluna cheia → payload do `kit-transferencia` e da publicação comum SEM mudança; **família comum** com coluna cheia → sem galeria; retries do conector ('plano', GTIN pack) levam a galeria; `revalidarGaleria` devolve subconjunto → só ele; revalidação reduziu → notificação com a chave certa; kit vinculado sem galeria → idêntico ao atual.
- [ ] Implementar; rodar toda a suíte de `_shared/ml`, `_shared/canais`, `_shared/user-products`, `publish-familia-ml`, `kit-transferencia`, `criar-kit-variacao`, `publicar-anuncio`; commit.

### Task 5: Recusa de foto rebaixa para só a capa (opus, risco alto)
**Files:** Modify `supabase/functions/publish-familia-ml/processar.ts`, helper novo em `publish-familia-ml/` · Test `publish-familia-ml/__tests__/processar.test.ts`. **Não tocar `_shared/canais/mercado-livre.ts`** (só muda na T4): o conector não tem `admin`, então um retry interno nunca zeraria a coluna.
**Fatos (revisão Fable):** `codigo==='FOTO'` só nasce de `retentavel` nativo (`item.pictures.unavailable`), que `erroDeFoto` exclui. A recusa definitiva chega como `DESCONHECIDO`/400 (`processar.ts:306`); `erroDeFoto` lê `corpo.cause`, mas o erro Legacy traz `raw.mlCauses` (`criar-item.ts:25`): chamar `erroDeFoto(e.status, { cause: raw.mlCauses })`. Na rota UP o erro não vem em `r.mensagem` (`:234`): `criarPlano` lança (`portas-supabase.ts:84`, relançado em `publicar-grupo.ts:182`) e cai no `catch` `:451-469`.
**Interfaces:** Entrada normalizada do erro, porque ele chega em dois formatos (`ErroCanal` no Legacy com `raw.mlCauses`, `mapeamento.ts:48`; exceção crua na UP com `err.mlCauses`, `criar-item.ts:25`): `type ErroFoto = { status: number | undefined; mlCauses: unknown; retentavel: boolean }`. Produces: helper único `rebaixarGaleriaSeRecusada(p: { admin; orgId; familiaId; codigo: string; galeriaUsada: boolean; tentativas: number; erro: ErroFoto }): Promise<boolean>` (true = galeria zerada, vale tentar de novo sem ela); `galeriaUsada` vem de `let galeriaUsada = false` declarado **antes do `try` (`processar.ts:153`)` e setado onde `anuncio.galeriaFotoIds` é preenchido (T4), pois `anuncio` é `const` dentro do `try` (`:184`) e não existe no `catch` (`:451`). Só age se `galeriaUsada` e (`erroDeFoto(status, {cause: mlCauses})` ou `unavailable` com `tentativas` esgotadas); reusar `prepararGaleria`/`tratarRecusaDeFoto` (`galeria-criar.ts:19,52`) para zerar/avisar com portas e para nunca lançar; zerar com `update({ galeria_ml_fotos: [] })` (nunca a string `'[]'`, como `kit-transferencia/index.ts:171`); faz `UPDATE variacoes SET galeria_ml_fotos='[]' WHERE org_id AND familia_id`, notifica `kit_galeria:<codigo>:recusada`, **nunca** chama `limparCacheFotosFamilia`.
Reenvio: **Legacy** → no worker, `processar.ts:286` troca `const res` por `let res`; se `!res.ok` e o helper devolver `true`, limpa `anuncio.galeriaFotoIds` e chama `conn.criarAnuncio` de novo (4xx = nada criado); falha do 2º POST segue o caminho atual (`:303-315`), já sem galeria. **UP** → `retry` (HTTP 500, o QStash reentrega) só se `tentativas < 10` (`queue.ts:107`); se não, `status:'erro'` com a mensagem do operador, sem `limparCacheFotosFamilia`, para a família nunca ficar presa em `publicando`.
- [ ] Testes (RED): Legacy recusa foto com galeria → segundo POST sem galeria, coluna zerada, `limparCacheFotosFamilia` NÃO chamado, kit criado; UP via exceção com `mlCauses` → zera e `retry`; UP na última tentativa → `status:'erro'` sem limpar cache; `unavailable` com galeria esgotado → zera; erro de foto SEM galeria → comportamento atual (cache limpo, erro); erro não-foto com galeria → intacto; retry posterior não reinsere a galeria.
- [ ] Implementar; suíte de `publish-familia-ml` e `canais`; commit.

### Task 6: UI — prévia da galeria no preview do kit
**Files:** Create `src/hooks/useGaleriaBaseKit.ts`, `src/components/kit/galeria-base-kit.tsx` · Modify `src/components/kit/{dialog-criar-kit,preview-kit}.tsx`, `src/lib/kit.ts` (`KitFormValues.galeria?: string[]`) · Test `src/components/kit/__tests__/galeria-base-kit.test.tsx`, `dialog-criar-kit.test.tsx`
**Interfaces:** Consumes: `GaleriaPecas({proposta, escolha, onChange, carregando, erro, desabilitado})`, `src/lib/kit-galeria.ts` (`EscolhaGaleria`, `idsDaGaleria`, `alternarFoto`), edge `fotos-base-kit` via `supabase.functions.invoke`. Produces: `useGaleriaBaseKit(familiaBaseId, categoriaMlId, ativo)`; escolha por tamanho `n` (`EscolhaGaleria`), enviada como `kits[i].galeria = idsDaGaleria(...)`. `GaleriaPecas` tem texto fixo ("Fotos das peças", rótulo `f.cor`: `galeria-pecas.tsx:27,35,44,59,87`) e `FotoGaleria.cor` é obrigatório (`kit-galeria.ts:4`): adicionar prop opcional `rotulos` com os textos atuais como padrão (kit com variação intacto) e passar `cor:'Base'`. Texto do vinculado: "Fotos 2 a 7 do anúncio principal". "Criar e publicar" fica desabilitado enquanto a leitura roda; falha de leitura → mensagem cinza e segue só com a capa; base sem fotos extras → "a base não tem fotos além da capa". Categoria trocada → refaz a leitura. Reusar o visual do kit com variação (skill ui-ux-pro-max se mexer em layout).
- [ ] Testes (RED): lista as fotos numeradas; remover foto tira o id do pedido; "Só a foto do kit" envia `[]`; falha → segue; botão bloqueado durante a leitura; trocar categoria refaz.
- [ ] Implementar; `pnpm test src/components/kit src/components/kit-variacao`; commit.

### Task 7: Docs, deploy e validação real
- [ ] Docs conforme `docs-update-checklist` (TASKS, project-status, edge-functions.md com `fotos-base-kit` e a mudança de `_shared`, Sprint Atual, Índice de ADRs).
- [ ] `pnpm preflight` verde → push da branch → CI verde → (com OK do Diego) merge fast-forward → deploy: `fotos-base-kit`, `criar-kit-vinculado`, `publish-familia-ml` e o **fecho transitivo** dos importadores de `ml/publicar.ts`, `canais/contrato.ts`, `canais/mercado-livre.ts` (entra via `canais/registry.ts`) e `user-products/publicar-familia-up.ts`. Importadores diretos já mapeados: `publish-familia-ml`, `publicar-anuncio`, `kit-transferencia`, `update-familia-ml`, `publicar-split-ml`, `criar-kit-variacao`, `sincronizar-estoque`, `status-publicados`, `atualizar-status-publicado`, `monitorar-moderados`, `process-familia`, `metricas-vendas`, `reconciliar-convergencia-up`; calcular o fecho (inclui quem importa `_shared/operacoes/deps.ts`, e `remover-publicado` e `operacoes-massa`) com script e conferir a versão de cada.
- [ ] **1º CREATE real validado pelo Diego** (kit de teste, base publicada com ≥3 fotos); só depois marcar "no ar" na memória/docs.

## Self-Review
Spec Fatia 2: leitura 2–7 (T2), gravação servidor-autoritativa (T3), publicação byte-idêntica sem galeria + revalidação (T4), rebaixamento (T5), prévia/remoção (T6), ADR/deploy/validação real (T1, T7). Tipos: `propostaGaleriaBase` (T2) → T3; `galeria_ml_fotos` (T3) → `galeriaFotoIds`/`galeriaExtra` (T4) → T5; `KitFormValues.galeria` (T6) → pedido de T3.
