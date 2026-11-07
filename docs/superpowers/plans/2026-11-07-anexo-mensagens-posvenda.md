# Anexo nas mensagens pós-venda — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** responder comprador com foto ou PDF pela tela de Mensagens e ver no histórico os anexos enviados e recebidos.

**Architecture:** upload e download passam por `posvenda-anexo`; o envio segue em `responder-mensagem`, agora protegido por uma máquina de estados própria (`mensagem-fluxo.ts`) sobre a tabela `ml_posvenda_acoes`. `posvenda-fluxo.ts` é acoplado a reclamação e não é reaproveitado: só passa a ignorar linhas de pack.

**Tech Stack:** Deno edge functions, Supabase Postgres, React, vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-anexo-mensagens-posvenda-design.md`

## Global Constraints

- Um arquivo por mensagem; `image/jpeg`, `image/png`, `application/pdf`; até 5 MB (`MAX_BYTES_ANEXO`).
- Texto obrigatório, até 350 caracteres.
- Nenhum POST automático repetido; só `enviarPost` faz POST ao ML.
- Token do ML nunca no front. Bytes de anexo nunca gravados.
- Nenhum teste escreve para comprador real.
- Migration só por `supabase migration new` + `supabase db push`, antes do deploy das edges.
- Repo é público: sem nome, pack ou id de comprador em docs e testes.
- Sem alterar `_shared/cors.ts`.

## Review Focus

1. Bundle antigo do PWA envia só `{pack_id, text}`: o envio de texto continua funcionando (edge gera `operacao_id`). Limite aceito: sem chave estável, esse cliente não ganha idempotência entre cliques, igual a hoje; a trava cobre só tentativas simultâneas. Não é regressão e some quando o bundle atualiza.
2. Foto do iPhone em HEIC ou arquivo com `type` vazio: recusa com mensagem clara, texto digitado preservado.
3. Recarregar a página durante envio incerto: ao reabrir, a tela mostra o estado pendente e não libera novo envio.
4. Anexo antigo que o ML não devolve mais (404): cartão "Arquivo indisponível", sem imagem quebrada.
5. Dois membros da org respondendo o mesmo pack ao mesmo tempo: um envia, o outro recebe `em_andamento`, sem segundo POST.

---

### Task 1: Banco e isolamento dos leitores de reclamação

**Files:**
- Create: `supabase/migrations/<timestamp>_posvenda_acoes_pack.sql` (via `supabase migration new posvenda_acoes_pack`)
- Create: `supabase/tests/posvenda_acoes_pack.sql`
- Modify: `supabase/functions/_shared/faturamento/posvenda-acao-io.ts:67-77`
- Modify: `src/lib/posvenda.ts` (`buscarTentativasAtivas`)
- Test: `src/lib/__tests__/posvenda-acao.test.ts`

**Interfaces:** Produces: coluna `ml_posvenda_acoes.pack_id text`, `claim_id` nullable, constraint `ml_posvenda_acoes_alvo_check`.

- [ ] **Step 1: Escrever `supabase/tests/posvenda_acoes_pack.sql`**, no formato de `posvenda_acoes_trava.sql`, com asserções: linha com só `pack_id` entra; sem alvo viola `ml_posvenda_acoes_alvo_check`; com os dois alvos viola; duas ativas em `mensagem:900000000001` violam `ml_posvenda_acoes_trava_uniq`; linha de claim antiga continua válida.
- [ ] **Step 2: Rodar `python3 scripts/teste-sql-desfeito.py supabase/tests/posvenda_acoes_pack.sql`.** Esperado: FALHA por coluna `pack_id` inexistente.
- [ ] **Step 3: Escrever a migration, idempotente:** `alter column claim_id drop not null`; `add column if not exists pack_id text`; check `num_nonnulls(claim_id, pack_id) = 1` criado dentro de `do $$ ... pg_constraint ... $$`, como em `20261028154949_posvenda_ml.sql`. Nada de mexer em índices, RLS ou grants.
- [ ] **Step 4: Rodar o teste SQL com a migration aplicada na transação desfeita** (`reference_teste_sql_sem_docker`) e `npm run db:check`. Esperado: `TESTE_OK`.
- [ ] **Step 5: Em `depsAcaoReal.abertas`, adicionar `.not('claim_id', 'is', null)`; em `buscarTentativasAtivas`, o mesmo filtro.** Teste em `posvenda-acao.test.ts`: `buscarTentativasAtivas` chama o filtro de `claim_id`.
- [ ] **Step 6: Rodar `pnpm test -- src/lib/__tests__/posvenda-acao.test.ts`.** Esperado: PASS.
- [ ] **Step 7: Commit.**

### Task 2: Upload e download de anexo por pack

**Files:**
- Modify: `supabase/functions/_shared/faturamento/posvenda.ts:385-408`
- Modify: `supabase/functions/posvenda-anexo/index.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/posvenda-anexo.test.ts`

**Interfaces:** Produces:
- `DestinoAnexo = 'revisao' | 'mensagem' | 'mensagem_pack'`
- `interface AnexoMensagem { filename: string; original_filename: string | null; type: string | null; size: number | null; potential_security_threat: boolean }`
- `anexoDaConversa(raws: unknown[], filename: string): AnexoMensagem | null`
- `motivoDownloadBloqueado(a: AnexoMensagem): string | null`
- Edge: multipart `{destino:'mensagem_pack', pack_id, file}` → `{ok, nome}`; JSON `{pack_id, filename}` → bytes com `Content-Type` do anexo.

- [ ] **Step 1: Testes.** `nomeDoAnexo({id:'x.png'}, 'mensagem_pack') === 'x.png'`; `nomeDoAnexo({filename:'y'}, 'mensagem') === 'y'`; `validarArquivoAnexo('image/heic', 10, 'mensagem_pack')` e `('', 10, 'mensagem_pack')` retornam `'Formato não aceito: use JPG, PNG ou PDF.'`; `anexoDaConversa` acha em `[{message_attachments:[{filename:'a'}]}]`, devolve null para outro nome, para `message_attachments: null` e para `raw` nulo; `motivoDownloadBloqueado` barra `potential_security_threat: true` e `type: 'image/svg+xml'`, libera os três tipos.
- [ ] **Step 2: Rodar `pnpm test -- supabase/functions/_shared/faturamento/__tests__/posvenda-anexo.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar as funções puras em `posvenda.ts`.** `mensagem_pack` lê `id`.
- [ ] **Step 4: Em `posvenda-anexo/index.ts`, ramificar pelo `Content-Type`.** JSON: exigir `pack_id` numérico; ler `raw` de `ml_mensagens` por `org_id` e `pack_id`; sem `anexoDaConversa` → 404 `'Anexo não encontrado.'`; bloqueado → 403; buscar `GET /messages/attachments/{encodeURIComponent(filename)}?tag=post_sale&site_id=MLB` e repassar `arrayBuffer` com o `type` gravado, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, CORS; ML 404 → 404 `codigo: 'anexo_indisponivel'`. Multipart `mensagem_pack`: exigir pack da org em `ml_mensagens`; `POST /messages/attachments?tag=post_sale&site_id=MLB`. O ramo de `claim_id` fica igual.
- [ ] **Step 5: Rodar o teste do Step 2.** Esperado: PASS.
- [ ] **Step 6: Commit.**

### Task 3: Máquina de estados do envio

**Files:**
- Create: `supabase/functions/_shared/faturamento/mensagem-fluxo.ts`
- Modify: `supabase/functions/_shared/ml/mensagem.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagem-fluxo.test.ts`
- Create: `supabase/functions/_shared/ml/__tests__/mensagem.test.ts` (não há teste direto de `montarReqMsgML`)

**Interfaces:** Produces:
```ts
montarReqMsgML(packId, sellerId, buyerId, texto, anexo?: string | null): { url: string; body: string }
enviarMsgML(token, packId, sellerId, buyerId, texto, anexo?: string | null): Promise<Response>

interface PayloadMensagem { texto: string; anexo: string | null }
interface MsgConversa { id: string; deVendedor: boolean; texto: string; anexos: string[]; moderacao: string | null }
type EstadoEnvio = 'reservada'|'enviada'|'confirmada'|'recusada'|'desconhecido'|'inconclusiva'|'cancelada'
interface TentativaMensagem { id: string; org_id: string; user_id: string; operacao_id: string; pack_id: string; recurso: string;
  acao: 'responder_mensagem'; payload: PayloadMensagem; payload_hash: string; antes: { ids: string[] } | null; estado: EstadoEnvio;
  post_em: string | null; http_status: number | null; resposta_ml: unknown; erro: string | null; criado_em: string }
interface DepsMensagem {
  agora(): string;
  porOperacao(op: string): Promise<TentativaMensagem | null>;
  inserir(t: Pick<TentativaMensagem,'org_id'|'user_id'|'operacao_id'|'pack_id'|'recurso'|'acao'|'payload'|'payload_hash'>): Promise<TentativaMensagem | 'conflito_operacao' | 'conflito_recurso'>;
  ativaDoRecurso(recurso: string): Promise<TentativaMensagem | null>;
  atualizar(id: string, onde: { estado: EstadoEnvio; postEmNulo?: boolean }, set: Partial<TentativaMensagem>): Promise<TentativaMensagem | null>;
  lerConversa(): Promise<MsgConversa[]>;   // lança se não leu
  postML(p: PayloadMensagem): Promise<{ status: number | null; body: unknown }>;
  erroRecusa(status: number, body: unknown): string;
}
interface ResultadoEnvio { http: number; ok: boolean; estado: EstadoEnvio | null; operacao_id?: string; pendenteConfirmacao: boolean;
  erro?: string; codigo?: string; pendente?: { operacao_id: string; estado: EstadoEnvio } | null }
efeitoMensagem(antes: string[], msgs: MsgConversa[], p: PayloadMensagem, idPost: string | null): 'confirmado' | 'nao' | 'inconclusivo'
enviarMensagem(deps, e: { orgId: string; userId: string; packId: string; operacaoId: string; payload: PayloadMensagem }): Promise<ResultadoEnvio>
verificarEnvio(deps, packId: string, operacaoId: string): Promise<ResultadoEnvio>
liberarEnvio(deps, packId: string, operacaoId: string): Promise<ResultadoEnvio>
```
`recurso = mensagem:{packId}`. `payload_hash` = SHA-256 de `JSON.stringify({ packId, payload })`.

Sequência de `enviarMensagem`: operação conhecida → compara pack e hash, sem POST → reserva → `lerConversa` (falha: `cancelada`, 502) → grava `antes.ids` e `post_em` por update condicional → POST → classifica como `classificar` de `posvenda-fluxo.ts` → 2xx com `message_moderation.status = clean` confirma sem reler; demais casos passam por `efeitoMensagem`.

`efeitoMensagem`: candidatas são mensagens do vendedor fora de `antes`, com o mesmo texto aparado e os mesmos anexos; com `idPost`, só a de mesmo id. Sem candidata ou mais de uma: `inconclusivo`. `clean`: `confirmado`. `rejected`: `nao`. Outro: `inconclusivo`.

`verificarEnvio`: `reservada` sem `post_em` e criada há mais de 2 min vira `cancelada`; `reservada` com `post_em` há mais de 2 min (edge caiu entre o POST e a classificação) vira `desconhecido` por update condicional, sem POST; estados ativos com `post_em` passam por `efeitoMensagem`; erro de leitura mantém o estado.

`liberarEnvio`: só de `enviada` ou `desconhecido`, grava `inconclusiva` com `erro: 'Liberado pelo operador após conferir no Mercado Livre.'`.

- [ ] **Step 1: Testes em memória, com banco falso que imita os dois índices únicos.** `envia_e_confirma_com_clean_sem_reler`; `operacao_repetida_nao_posta_de_novo` (`postML` chamado 1 vez); `operacao_com_outro_conteudo_409`; `segundo_operador_recebe_em_andamento_com_pendente` (`http 409`, `codigo 'em_andamento'`, 1 POST); `leitura_falha_cancela_sem_post`; `timeout_vira_desconhecido_e_nao_repete`; `4xx_vira_recusada_e_libera_nova_operacao`; `verificar_confirma_por_mensagem_nova_com_mesmo_anexo`; `verificar_nao_confirma_com_anexo_diferente`; `verificar_nao_confirma_mensagem_do_snapshot`; `duas_candidatas_iguais_inconclusivo`; `rejected_vira_recusada`; `pendente_de_moderacao_mantem_trava`; `reserva_velha_vira_cancelada`; `reserva_com_post_em_velha_vira_desconhecido_e_pode_liberar`; `reserva_com_post_em_recente_nao_muda`; `liberar_grava_inconclusiva_e_permite_nova_operacao`; `liberar_recusa_confirmada`; `operacao_de_outro_pack_409`.
- [ ] **Step 2: Testes de `montarReqMsgML` em `mensagem.test.ts`:** URL com `?tag=post_sale`; `from` e `to` como string; com anexo, o corpo tem `attachments: ['a.png']`; sem anexo, o corpo não tem a chave `attachments`.
- [ ] **Step 3: Rodar `pnpm test -- supabase/functions/_shared/faturamento/__tests__/mensagem-fluxo.test.ts`.** Esperado: FALHA.
- [ ] **Step 4: Implementar `mensagem-fluxo.ts` e o parâmetro `anexo`.** Sem Deno e sem npm, como `posvenda-fluxo.ts`.
- [ ] **Step 5: Rodar os testes.** Esperado: PASS.
- [ ] **Step 6: Commit.**

### Task 4: Ligar o fluxo em `responder-mensagem`

**Files:**
- Create: `supabase/functions/_shared/faturamento/mensagem-fluxo-io.ts`
- Modify: `supabase/functions/responder-mensagem/index.ts`
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts` (remover `responderMensagemPedido`, que fica sem chamador)
- Test: `mensagens-io.test.ts` (imports e casos de `responderMensagemPedido`: migrar a cobertura de erro para `mensagemErroEnvioML`)
- Test: `supabase/functions/responder-mensagem/__tests__/cancelado.test.ts` (simular `enviarMensagem`, preservando pedido cancelado e reclamação aberta)

**Interfaces:** Consumes: Task 3. Produces:
- `depsMensagemReal(admin, ctx: { orgId; packId; sellerId; buyerId; token }): DepsMensagem`
- Body da edge: `{ pack_id, text?, operacao_id?, anexo?, verificar?: boolean, liberar?: boolean }`. Resposta: `{ ok, estado, operacao_id, pendenteConfirmacao }` ou erro com `codigo` e `pendente`.

- [ ] **Step 1: Implementar `depsMensagemReal`.** `lerConversa` faz GET próprio e lança em erro, com `mark_as_read=false`; não usar `buscarMensagensPack`, que devolve `[]` em erro. `postML` usa `enviarMsgML`, e erro de rede ou timeout devolve `{status: null, body: null}`. `erroRecusa` usa `mensagemErroEnvioML`. 23505 mapeado como em `posvenda-acao-io.ts`.
- [ ] **Step 2: Editar a edge.** `operacao_id` ausente → `crypto.randomUUID()`; presente e inválido → 400. `anexo`, se vier, é string `/^[\w.-]{1,200}$/`. `verificar` e `liberar` exigem `operacao_id` e não exigem `text`. Validações de pedido cancelado e comprador seguem antes do fluxo. Depois de `confirmada`, roda o re-sync atual em `try/catch`: falha só registra log e responde sucesso. Mantém o mapeamento atual para `pedido_cancelado` e `reclamacao_aberta`, comparando `ResultadoEnvio.erro`, e a auditoria de suporte.
- [ ] **Step 3: Migrar `mensagens-io.test.ts` e `cancelado.test.ts`.** Os casos de pedido cancelado e reclamação aberta seguem cobertos.
- [ ] **Step 4: Rodar `pnpm test -- supabase/functions` e `pnpm preflight:static`.** Esperado: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Dados no frontend

**Files:**
- Modify: `src/lib/mensagens.ts`
- Modify: `src/lib/posvenda.ts` (`enviarAnexoPosvenda`)
- Test: `src/lib/__tests__/mensagens-conversas.test.ts`
- Test: `src/lib/__tests__/mensagens-resumo.test.ts` (fixture de `Mensagem` ganha `anexos: []`)

**Interfaces:** Produces:
- `buscarEnvioPendente(pack_id: string): Promise<{ operacao_id: string; estado: string } | null>`
- `interface AnexoMensagem { filename: string; original_filename: string | null; type: string | null; size: number | null; potential_security_threat: boolean }`
- `Mensagem.anexos: AnexoMensagem[]`; `Conversa.envioPendente: { operacao_id: string; estado: string } | null`
- `responderMensagem(pack_id, text, opcoes?: { operacao_id: string; anexo: string | null }): Promise<{ ok: true; estado: string; operacao_id: string; pendenteConfirmacao: boolean }>`
- `verificarEnvio(pack_id, operacao_id)`, `liberarEnvio(pack_id, operacao_id)`
- `enviarAnexoMensagem(pack_id: string, file: File): Promise<string>`
- `baixarAnexoMensagem(pack_id: string, filename: string): Promise<Blob>` (fetch autenticado, erro com `codigo`)

- [ ] **Step 1: Testes.** O select de `buscarConversas` inclui `anexos:raw->message_attachments`; `anexos: null` vira `[]`; `envioPendente` preenchido a partir de `ml_posvenda_acoes` com `pack_id` em estado ativo; falha nessa leitura deixa `envioPendente` null e a lista segue.
- [ ] **Step 2: Rodar `pnpm test -- src/lib/__tests__/mensagens-conversas.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar.** `preencherEnvioPendente` no padrão de `preencherReclamacao`. `baixarAnexoMensagem` usa o token da sessão como `postEdge`, sem mudar `postEdge`.
- [ ] **Step 4: Rodar o teste.** Esperado: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Tela

**Files:**
- Create: `src/components/faturamento/anexo-mensagem.tsx`
- Modify: `src/components/faturamento/aba-mensagens.tsx`
- Test: `src/components/faturamento/__tests__/aba-mensagens-anexo.test.tsx`
- Test: `src/components/faturamento/__tests__/aba-mensagens.test.tsx` e `aba-mensagens-aberta-fixa.test.tsx` (fixtures com `anexos` e `envioPendente`; asserções de `responderMensagem` e respostas simuladas no novo contrato)

**Interfaces:** Consumes: Task 5. Produces: `<AnexoMensagem packId anexo />`.

- [ ] **Step 1: Testes.** `pendente_confirmacao_nao_mostra_sucesso_e_mantem_texto`; `resposta_409_em_andamento_aplica_pendente_na_hora`; `abrir_conversa_consulta_envio_pendente`; `clipe_escolhe_arquivo_e_mostra_chip`; `remover_chip_limpa_arquivo`; `arquivo_acima_de_5mb_mostra_erro_e_mantem_texto`; `heic_mostra_erro_e_mantem_texto`; `sem_texto_nao_envia`; `envia_upload_e_depois_mensagem_na_ordem`; `falha_de_upload_mantem_texto_e_arquivo`; `falha_de_envio_reaproveita_operacao_e_id_sem_novo_upload`; `recusa_definitiva_gera_nova_operacao`; `envio_pendente_bloqueia_campo_e_mostra_conferir`; `liberar_pede_confirmacao`; `balao_sem_texto_com_anexo_nao_fica_vazio`; `anexo_com_ameaca_nao_baixa`; `anexo_404_mostra_arquivo_indisponivel`; `miniatura_so_carrega_com_conversa_aberta`.
- [ ] **Step 2: Rodar `pnpm test -- src/components/faturamento/__tests__/aba-mensagens-anexo.test.tsx`.** Esperado: FALHA.
- [ ] **Step 3: Criar `AnexoMensagem`.** Busca o blob ao montar, cria `URL.createObjectURL` e revoga ao desmontar. Imagem: miniatura clicável que abre em nova aba. PDF: cartão com nome e tamanho. Ameaça ou tipo fora da lista: só o nome, sem download. Usar tokens `wa-*` existentes.
- [ ] **Step 4: Editar `CardConversa`.** `input type="file"` oculto com `accept="image/jpeg,image/png,application/pdf"`, botão `Paperclip` entre a sugestão e o texto, chip acima do campo, `tentativaRef` guardando `{ operacao_id, anexo, chave }`. Estado local `pendenteLocal` tem prioridade sobre `c.envioPendente` (cache de 60 s): é preenchido por `pendenteConfirmacao: true`, por `ErroEdge.pendente` do 409 e por `buscarEnvioPendente` ao abrir o card. Toast de sucesso, limpeza do texto e `onAberto(false)` só com `estado === 'confirmada'`. Com pendência, trocar o campo por faixa com "Conferir no Mercado Livre" (`verificarEnvio`) e "Já conferi, liberar envio" (confirmação por `AlertDialog`, depois `liberarEnvio`). Renderizar `l.m.anexos` no balão.
- [ ] **Step 5: Rodar os testes e `pnpm test -- src/components/faturamento`.** Esperado: PASS, incluindo os testes atuais de `aba-mensagens`.
- [ ] **Step 6: Commit.**

### Task 7: Docs, revisão e entrega

**Files:**
- Modify: `docs/decisions/0067-mensagens-pos-venda-ml.md`, `docs/decisions/0192-posvenda-ml-acoes.md`
- Modify: `docs/reference/edge-functions.md`, `docs/TASKS.md`, `obsidian-vault/03-Módulos/Faturamento.md`

- [ ] **Step 1: Emendas de 07/11 nos ADRs:** contrato medido, trava por pack, liberação manual, download por POST. Seguir a skill `docs-update-checklist`.
- [ ] **Step 2: Rodar `pnpm preflight`.** Esperado: PASS.
- [ ] **Step 3: Revisão do diff pelo Codex gpt-6.1-sol high.** Corrigir achados.
- [ ] **Step 4: Validar a tela em runtime real, em sessão isolada, com print:** miniatura de anexo já existente, chip, cartão de PDF, tema escuro.
- [ ] **Step 5: Com pedido de merge do Diego:** `supabase db push`; `supabase functions deploy posvenda-anexo responder-mensagem posvenda-acao reconciliar-faturamento`; conferir versões; push e merge fast-forward. `posvenda-acao` e `reconciliar-faturamento` entram porque `posvenda-acao-io.ts` mudou.
- [ ] **Step 6: Diego faz o primeiro envio real pelo app.**
