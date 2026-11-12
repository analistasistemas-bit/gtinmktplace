# Kit vinculado — Fatia 3 (capa por IA com N unidades) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No preview do kit vinculado, um botão gera por IA a capa com N cópias idênticas do produto da base, com aprovação humana ("Usar esta foto").

**Architecture:** Edge nova `gerar-capa-kit-unidades` (o `gerar-foto-kit` não muda) reusa `gerarImagem`, `resolverModeloImagem`, `adequadaAoML`, visão e a máquina de estados de `request_id`; persiste em `kit_variacao_imagens` (migration relaxa `cores`/`rotulo`, ganha `n`) para herdar a cobrança por imagem aprovada; UI com candidata separada de `imagemPath` até aprovar.

**Tech Stack:** Deno edge (Supabase), Postgres, React + TS, vitest.

**Spec/ADR:** `docs/superpowers/specs/2026-11-12-kit-vinculado-evolucao-design.md` (Fatia 3); `docs/decisions/0205-kit-vinculado-capa-ia-n-unidades.md` (autoridade, ler primeiro). Modelo de referência: `supabase/functions/gerar-foto-kit/index.ts` e `__tests__/handler.test.ts`.

## Global Constraints
- `n` inteiro 2..6 (`TAMANHOS_KIT`); foto de origem lida no servidor da capa da base (`familias.capa_storage_path`, `org_id` do chamador); nunca path do cliente.
- Gate: admin (ou suporte `full`) + módulo `imagem_ia`; sem `kit_variacao`.
- Imagem 1:1; `adequadaAoML(dimensoesImagem(bytes))` obrigatório; verificação por visão fail-closed (`quantidade_produtos === n`, sem texto novo, fundo neutro).
- `request_id` idempotente: até 3 tentativas, uma por chamada, 145 s (`PRAZO_MS` 140 s), mesmo `request_id` com outro `familia_base_id`/`n` → 409 `pedido_diferente`.
- Aprovação humana: a candidata NUNCA vira `imagemPath` sem clicar "Usar esta foto". Upload manual continua.
- Cobrança: só o trigger existente (aprovada = `status='gerada'`); sem preço novo; custo de cada tentativa em `custo_usd`; sem prompt/ficha em log.
- Migration: `supabase migration new` + `supabase db push`; re-executável; RLS ligada, `revoke all` de anon/authenticated, sem policy; validar com `npm run db:check`; testes SQL no padrão `supabase/tests/`.
- Edge nova: deploy CLI com `--project-ref txvncrgkoynoxwopfkbp` (worktree não é linkado), conferir versão; `supabase/config.toml` com `[functions.gerar-capa-kit-unidades]` `verify_jwt = true`.
- Roteamento: T1 (migration/cobrança) e T2/T3 (edge com custo de IA e storage) = **opus**; T4/T5 sonnet; revisão do plano Fable 5.2, diffs Grok 4.7 high (1 por vez; a conexão do Grok cai com execuções simultâneas).
- Git em worktree: `/usr/bin/git`, comandos simples e separados. `.env.local` copiar do checkout principal; `pnpm install --frozen-lockfile`.

## Review Focus
- Mesmo `request_id` repetido após aprovada → devolve o estado, sem IA e sem nova cobrança.
- Base sem capa → 409 `sem_foto_origem`, sem reservar nem gastar.
- N=6 com a IA devolvendo 5 produtos → reprova, motivo "contei 5", próxima tentativa.
- Imagem horizontal/pequena → reprovada por `adequadaAoML`, sem cobrança.
- Dois tamanhos marcados (3 e 6) → duas gerações independentes, aprovações independentes.
- Trocar/remover a capa depois de aprovada → a candidata aprovada some; o upload manual vence.

---

### Task 1: Migration — `kit_variacao_imagens` aceita capa por unidades (opus)
**Files:** Create `supabase/migrations/<ts>_kit_variacao_imagens_unidades.sql` (via `supabase migration new`) · Test `supabase/tests/kit_vinculado_capa_unidades.sql`
**Interfaces:** Produces: `cores` e `rotulo` nullable; `n smallint` (check `n between 2 and 6` quando não nulo); check `(cores is not null) or (n is not null)`; índices, RLS e trigger `kit_variacao_imagens_cobranca` intactos; comentários nas colunas citando o ADR-0205.
- [ ] Teste SQL (RED, padrão `supabase/tests/kit_variacao_imagem_ia.sql`, transação desfeita): inserir linha com `cores=null, rotulo=null, n=6, status='gerada', storage_path, custo_usd>0` funciona e gera 1 linha em `platform_image_deliveries` (cobrança herdada); linha sem `cores` e sem `n` falha o check; `n=1` e `n=7` falham; linhas antigas (`cores` preenchido, `n` nulo) continuam válidas; `anon/authenticated` não leem.
- [ ] `supabase migration new kit_variacao_imagens_unidades`, escrever (re-executável: `drop constraint if exists`, `add column if not exists`), `supabase db push --project-ref txvncrgkoynoxwopfkbp` só no fechamento (T6), aqui validar com o teste SQL numa transação desfeita em prod (padrão "teste SQL sem Docker"), `npm run db:check`; commit.

### Task 2: Pedido e verificação de N unidades (puro, opus)
**Files:** Create `supabase/functions/_shared/ai/foto-kit-unidades.ts` · Modify `supabase/functions/_shared/ai/foto-kit-fiel.ts` (só `export` de `visaoJson`) · Test `supabase/functions/_shared/ai/__tests__/foto-kit-unidades.test.ts`
**Interfaces:** Consumes: `visaoJson(...)`, `limpar`, `reprovacao`. Produces:
```ts
export function montarPedidoUnidades(p: { n: number; motivosAnteriores?: string[] }): { textos: string[] }
export interface VerificacaoUnidades { quantidade_produtos: number; texto_novo: boolean; fundo_neutro: boolean; mesmo_produto: boolean; observacao?: string }
export function avaliarUnidades(v: VerificacaoUnidades, n: number): { aprovado: boolean; motivos: string[] }
export async function verificarUnidades(p: { /* args como lerVerificacao */ original: DataUrl; gerada: DataUrl; n: number; timeoutMs: number }): Promise<VerificacaoUnidades>
```
`avaliarUnidades` é fail-closed: aprovado só com `quantidade_produtos === n`, `!texto_novo`, `fundo_neutro`, `mesmo_produto`; motivos em pt-BR ("contei 5 produtos, esperava 6").
- [ ] Testes (RED): cada regra reprova com o motivo certo; todas ok aprova; resposta malformada/nula da visão → reprova (fail-closed); `montarPedidoUnidades` cita n por extenso e em número, proíbe texto/logo/itens extras, injeta `motivosAnteriores`. Implementar; commit.

### Task 3: Edge `gerar-capa-kit-unidades` (opus)
**Files:** Create `supabase/functions/gerar-capa-kit-unidades/index.ts`, `__tests__/handler.test.ts` · Modify `supabase/config.toml`
**Interfaces:** Consumes: `montarPedidoUnidades`, `verificarUnidades`, `avaliarUnidades` (T2); `gerarImagem`, `resolverModeloImagem`, `adequadaAoML`, `dimensoesImagem`, `custoImagemUsd` (`_shared/ai/imagem.ts`); máquina de estados e helpers (`comPrazo`, `transicionar`, `paraDataUrl`, `logErro`, `assinar`, constantes de prazo) de `gerar-foto-kit/index.ts`: se pequenos e puros, extrair para `_shared/kit-variacao/` sem mudar o comportamento do `gerar-foto-kit` (teste dele intacto); senão copiar com comentário. Produces: POST `{ request_id: uuid, familia_base_id: string, n: 2..6 }` → mesmo formato `RespostaFotoKit` (`path`, `url`, `tentativa`, `aprovado`, `proxima`, `verificacao`, `motivos`, `previa_url`; `originais:[{cor:'Base', urls:[...]}]`) e os mesmos códigos de erro de `gerar-foto-kit` (403 `modulo_desligado`/não admin, 409 `em_andamento`, `pedido_diferente` (inclui `n`), `sem_foto_origem`, 502 `imagem_inadequada`/`falha_storage`, 503 `prazo`/`estado_incerto`). Grava `kit_variacao_imagens` com `cores=null, rotulo=null, n`.
- [ ] Testes (RED) copiando o padrão de `gerar-foto-kit/__tests__/handler.test.ts` (`vi.hoisted`, PNG vertical 896×1200): 403 sem `imagem_ia`/não admin; `n` 1 e 7 → 400; base de outra org → 404; sem capa → 409 `sem_foto_origem` sem reservar; aprovada → grava, devolve `path` em `${orgId}/kit-variacao-ia/`, `custo_usd`; repetição do `request_id` → estado sem IA; contagem errada → reprovada, `proxima` true, motivo; 3 reprovações → `proxima` false; `pedido_diferente` com `n` diferente; imagem horizontal → reprovada sem cobrança; falha da IA libera a reserva; log sem segredo.
- [ ] Implementar; `deno lint` e `deno check --no-config` nos arquivos tocados (NUNCA deixar o `deno` reescrever o `package.json`); suíte `gerar-foto-kit` e `_shared/kit-variacao` intactas; commit.

### Task 4: UI — botão, candidata e aprovação
**Files:** Create `src/lib/capa-unidades-edge.ts`, `src/components/kit/gerar-capa-unidades.tsx`, `src/components/kit/previa-capa-unidades.tsx` · Modify `src/components/kit/{preview-kit,dialog-criar-kit}.tsx` · Test `src/components/kit/__tests__/gerar-capa-unidades.test.tsx`, `dialog-criar-kit.test.tsx`, `src/lib/__tests__/capa-unidades-edge.test.ts`
**Interfaces:** Produces: `gerarCapaUnidadesEdge({ requestId, familiaBaseId, n }): Promise<RespostaFotoKit>`; `GerarCapaUnidades({ n, familiaBaseId, temCapa, onAprovar(path: string) })`. Mostra o botão "Gerar capa com N unidades" só com `temCapa`, módulo `imagem_ia` ativo e admin (usar os hooks já usados por `foto-combinacao.tsx`); loop de até 3 tentativas como `foto-combinacao.tsx` (`for i<3` enquanto `proxima`); botão travado durante a geração; prévia ampliada própria com a imagem, a conferência (contagem, texto, fundo) e **"Usar esta foto"** (só se `aprovado`) / **"Gerar de novo"**; ao aprovar → `onChange({ imagemPath: path, fotoFile: null })` no preview; escolher arquivo manual depois descarta a candidata. Uma instância por tamanho (`request_id` próprio por `n`, guardado no estado do dialog). Candidata nunca grava `imagemPath` sozinha. Visual coerente com o preview (tokens, tema escuro/claro; skill ui-ux-pro-max se mexer em layout); textos e `aria-label` com N.
- [ ] Testes (RED): botão some sem capa/sem módulo; gera → mostra candidata sem alterar `imagemPath`; "Usar esta foto" aplica o `path` e limpa `fotoFile`; reprovada → só "Gerar de novo" e motivos; 3 reprovações → mensagem e botão volta; durante a geração o botão fica travado; dois tamanhos independentes; `imagemPath` manual vence a candidata; erro 403/503 → mensagem sem travar o dialog.
- [ ] Implementar; `pnpm test src/components/kit src/components/kit-variacao src/lib`; `pnpm exec tsc -p tsconfig.app.json --noEmit`; commit.

### Task 5: Segurança — `imagemPath` do cliente no `criar-kit-vinculado` (opus)
**Files:** Modify `supabase/functions/criar-kit-vinculado/processar.ts` (e `index.ts` se preciso) · Test `criar-kit-vinculado/__tests__/processar.test.ts`
- [ ] Ler `fotoDaOrg` em `criar-kit-variacao/processar.ts:~234` e a convenção de `storageOwnerForUpload`/`buildStoragePath` (o 1º segmento do path é `org_id` ou `user_id`?). **Se a convenção for uniforme**, aplicar a mesma checagem a `imagemPath` (recusa 400 se o path não pertence à org; aceita os dois formatos legítimos: upload do operador e `${orgId}/kit-variacao-ia/...`). **Se não for uniforme, NÃO alterar**: reportar o achado ao controlador com o que encontrou. Testes: path da própria org passa; path de outra org → recusado; upload manual legítimo continua passando; capa herdada da base passa.

### Task 6: Docs, migration, deploy e medição real
- [ ] Docs (`docs-update-checklist`): ADR-0205 (+ ADR-0204 → ACEITO), TASKS, project-status, `edge-functions.md`, `modelo-de-dados.md` (colunas), Sprint Atual, Índice de ADRs, memória do projeto.
- [ ] `pnpm preflight` → push → CI → (OK do Diego) merge fast-forward → `supabase db push --project-ref txvncrgkoynoxwopfkbp` (migration) → `supabase functions deploy gerar-capa-kit-unidades criar-kit-vinculado --project-ref txvncrgkoynoxwopfkbp` (+ edges que importem `_shared` alterados, calcular o fecho) → conferir versões e `npm run db:check`.
- [ ] **Medição real com o Diego**: gerar N=2, 3 e 6 num produto sem rótulo e num com rótulo; registrar acerto de contagem, texto inventado e custo por tentativa no ADR-0205. Só depois marcar "no ar".

## Self-Review
Spec Fatia 3: edge nova sem gate `kit_variacao` (T3), reuso do gerador/estado (T3), verificação de contagem/texto (T2), persistência e cobrança por migration (T1), botão + aprovação humana + upload manual (T4), ADR/deploy/medição (T6). Tipos: `VerificacaoUnidades`/`avaliarUnidades` (T2) → T3; `RespostaFotoKit` reaproveitado (T3) → `gerarCapaUnidadesEdge` (T4); `kit_variacao_imagens.n` (T1) → T3. T5 é o achado de segurança do recon, condicional à convenção do storage.
