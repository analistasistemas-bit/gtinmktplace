# Kit vinculado — Fatia 2 (fotos 2–7 da base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O kit vinculado publica com as fotos 2 a 7 do anúncio da base (reusando `picture_id` do ML), com revisão do operador no preview.

**Architecture:** Edge de leitura nova `fotos-base-kit` propõe a galeria; `criar-kit-vinculado` recalcula no servidor e grava `proposta ∩ pedido` em `variacoes.galeria_ml_fotos` do kit; a publicação comum lê essa coluna **só quando não vazia** (payload byte-idêntico sem ela), revalida os ids antes do POST e rebaixa para "só a capa" se o ML recusar foto.

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
export async function propostaGaleriaBase(p: { token: string; itemIdBase: string | null; categoriaKitId: string | null; capaKitPictureId?: string | null }, f?: typeof fetch): Promise<{ fotos: {id:string;item:string;url:string}[]; avisos: string[]; indisponivel: boolean; limite: number | null }>
```
Edge: POST `{familia_base_id, categoria_ml_id?}` → `{fotos, avisos, indisponivel, limite}`. `itemIdBase` = `familias.ml_item_id` ou, família UP, `anuncios_externos_itens.item_externo_id` (mesmo select de `fotos-pecas-kit`). Base não publicada → `{fotos:[], indisponivel:false, avisos:[]}`. Falha ML → 200 com `indisponivel:true`.
- [ ] Testes (RED): corta em 6; ignora a foto 1; respeita `limite-1`; `limite===null` → vazia; id igual ao da capa do kit excluído; item não limpo → vazia + aviso; edge: 403 sem módulo, 404 família de outra org, base sem `ml_item_id` → vazia.
- [ ] Implementar; `pnpm test` dos dois diretórios; commit.

### Task 3: Gravação — `criar-kit-vinculado` salva a galeria (opus)
**Files:** Modify `supabase/functions/criar-kit-vinculado/{index,processar}.ts` · Test `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`
**Interfaces:** Consumes: `propostaGaleriaBase` (T2). Produces: o pedido ganha `kits[i].galeria?: string[]` (ids que o operador manteve); o servidor recalcula a proposta com a categoria efetiva do kit e grava `variacoes.galeria_ml_fotos = proposta ∩ pedido` (formato `[{id,item}]`) na variação do kit, na mesma ordem da proposta. `montarVariacaoKit` passa a definir `galeria_ml_fotos` explicitamente (`[]` quando não há galeria), nunca herdando da base.
- [ ] Testes (RED): sem `galeria` no pedido → `[]` e payload do resto inalterado; ids fora da proposta ignorados; `[]` pedido → `[]`; base sem `ml_item_id` → `[]` sem erro; kit não herda `galeria_ml_fotos` da base; falha de leitura do ML → `[]` e a criação segue (aviso).
- [ ] Implementar; commit.

### Task 4: Publicação comum lê a coluna (opus, risco alto)
**Files:** Modify `supabase/functions/_shared/anuncios/montar-canonico.ts`, `_shared/canais/contrato.ts` (campo `galeriaFotoIds?: string[]` em `AnuncioCanonico`), `_shared/ml/publicar.ts` (`montarPayloadItem` recebe `galeriaExtra?: string[]` como último parâmetro opcional), `_shared/canais/mercado-livre.ts`, `_shared/user-products/publicar-familia-up.ts` · Test `_shared/ml/__tests__/publicar.test.ts`, testes dos canais/UP.
**Interfaces:** Produces: `montarPayloadItem(..., formato?, galeriaExtra?: string[])`. `pictures` = `[lider, capa2, capa3, ...fotosCor, ...galeriaExtra]` sem repetir (Set); no ramo `variations`, `picture_ids` da variação = `ordenarFotosVariacao(...)` + `galeriaExtra` ao fim sem repetir; `ordenarFotosVariacao` NÃO muda de assinatura. `montarAnuncioCanonico` preenche `galeriaFotoIds` de `variacoes[0].galeria_ml_fotos` só se não vazia. Antes do POST (nos dois chamadores), `revalidarGaleria(token, fotos)` e usa só os ids que voltam.
- [ ] Testes (RED) **de regressão primeiro**: sem `galeriaExtra`, `JSON.stringify(payload)` idêntico ao snapshot atual (ramos `variations` e plano, com e sem tamanho); novos: galeria entra em `pictures` e em `picture_ids`; id da capa/capa2 não repete; `revalidarGaleria` devolve subconjunto → só ele; coluna `[]` → sem mudança.
- [ ] Implementar; rodar toda a suíte de `_shared/ml`, `_shared/canais`, `_shared/user-products`, `publish-familia-ml`, `publicar-familias`; commit.

### Task 5: Recusa de foto rebaixa para só a capa (opus, risco alto)
**Files:** Modify `supabase/functions/publish-familia-ml/processar.ts` (região de `e.codigo === 'FOTO'`, ~:306-312, e o caminho UP) · Test `publish-familia-ml/__tests__/processar.test.ts`
**Interfaces:** Consumes: `erroDeFoto(status, corpo)`, `tratarRecusaDeFoto` (padrão de `kit-transferencia`). Regra: se o erro é de foto **e** a galeria foi usada nesta tentativa → `UPDATE variacoes SET galeria_ml_fotos='[]' WHERE org_id AND familia_id`, avisar o operador (categoria de notificação `kit_galeria:<codigo>:reduzida`), **pular** `limparCacheFotosFamilia`, e reagendar a publicação (a próxima tentativa nasce sem galeria). Sem galeria usada: caminho atual intacto (limpa cache, `status:'erro'`).
- [ ] Testes (RED): erro de foto com galeria → coluna zerada, `limparCacheFotosFamilia` NÃO chamado, reagenda; erro de foto sem galeria → comportamento atual (cache limpo, erro); segunda tentativa depois de zerar não reinsere; erro não-foto com galeria → intacto.
- [ ] Implementar; commit.

### Task 6: UI — prévia da galeria no preview do kit
**Files:** Create `src/hooks/useGaleriaBaseKit.ts`, `src/components/kit/galeria-base-kit.tsx` · Modify `src/components/kit/{dialog-criar-kit,preview-kit}.tsx`, `src/lib/kit.ts` (`KitFormValues.galeria?: string[]`) · Test `src/components/kit/__tests__/galeria-base-kit.test.tsx`, `dialog-criar-kit.test.tsx`
**Interfaces:** Consumes: `GaleriaPecas({proposta, escolha, onChange, carregando, erro, desabilitado})`, `src/lib/kit-galeria.ts` (`EscolhaGaleria`, `idsDaGaleria`, `alternarFoto`), edge `fotos-base-kit` via `supabase.functions.invoke`. Produces: `useGaleriaBaseKit(familiaBaseId, categoriaMlId, ativo)`; escolha por tamanho `n` (`EscolhaGaleria`), enviada como `kits[i].galeria = idsDaGaleria(...)`. Texto próprio (não "fotos das peças"): "Fotos 2 a 7 do anúncio principal". "Criar e publicar" fica desabilitado enquanto a leitura roda; falha de leitura → mensagem cinza e segue só com a capa; base sem fotos extras → "a base não tem fotos além da capa". Categoria trocada → refaz a leitura. Reusar o visual do kit com variação (skill ui-ux-pro-max se mexer em layout).
- [ ] Testes (RED): lista as fotos numeradas; remover foto tira o id do pedido; "Só a foto do kit" envia `[]`; falha → segue; botão bloqueado durante a leitura; trocar categoria refaz.
- [ ] Implementar; `pnpm test src/components/kit src/components/kit-variacao`; commit.

### Task 7: Docs, deploy e validação real
- [ ] Docs conforme `docs-update-checklist` (TASKS, project-status, edge-functions.md com `fotos-base-kit` e a mudança de `_shared`, Sprint Atual, Índice de ADRs).
- [ ] `pnpm preflight` verde → push da branch → CI verde → (com OK do Diego) merge fast-forward → deploy: `fotos-base-kit`, `criar-kit-vinculado`, `publish-familia-ml`, `publicar-familias` e TODA edge que importe `montar-canonico.ts`, `ml/publicar.ts`, `canais/mercado-livre.ts` ou `user-products/publicar-familia-up.ts` (listar por grep em `supabase/functions/**/*.ts` e conferir versão de cada).
- [ ] **1º CREATE real validado pelo Diego** (kit de teste, base publicada com ≥3 fotos); só depois marcar "no ar" na memória/docs.

## Self-Review
Spec Fatia 2: leitura 2–7 (T2), gravação servidor-autoritativa (T3), publicação byte-idêntica sem galeria + revalidação (T4), rebaixamento (T5), prévia/remoção (T6), ADR/deploy/validação real (T1, T7). Tipos: `propostaGaleriaBase` (T2) → T3; `galeria_ml_fotos` (T3) → `galeriaFotoIds`/`galeriaExtra` (T4) → T5; `KitFormValues.galeria` (T6) → pedido de T3.
