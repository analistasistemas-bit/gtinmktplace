# Plano — Ações de Publicados: produto dividido, família canônica e gating

Data: 2026-10-18 · Branch: `worktree-fix-acoes-publicados-split` · Origem: revisão dos botões de Ações
após o incidente de pausar UP (main `ec5bf54f`, emenda ADR-0060).

## Contexto verificado

- Linha de Publicados usa a família **mais antiga** do `codigo_pai` como representante (de propósito:
  publicação original — `src/lib/publicados.ts` `dedupePublicados`). Linhas de partição >0 (split,
  ADR-0048) herdam o `familiaId` da partição 0 (`src/lib/queries.ts` ~1176).
- Regra canônica já usada em edge: `migrar-preco-por-variacao/index.ts` → família **mais nova com
  `ml_item_id`**, `order('criado_em', desc)`. Reusar exatamente essa regra.
- Split Legacy: `familias.ml_item_id` = partição 0; partições >0 só em `anuncios_externos.item_externo_id`.

## Revisão do Codex (2026-10-18, REVISE) → escopo em duas fases

**Fase A (esta branch):** T1; T2 só a parte de partições (pausar todas antes de cortar o vínculo; o guard
de Kit Virtual recebe os MLBs das partições); T4 com candidata `status='publicado'` mais nova por
`publicado_em desc nulls last` (mesma ordem do `ingest-lote`) e `catalogRetentavel` alinhado na tela; T5
(erro na consulta de itens UP aborta antes da elegibilidade); T6 com testes de suporte `read/full`.

**Fase B (adiada — precisa de desenho/ADR):**
- T2 "várias famílias do pai": as gravações de `remover-publicado` não são atômicas; trocar a família
  preservada pela canônica cria risco de 2 famílias `pronto/CREATE` numa falha no meio, e o snapshot de
  UPDATE em Revisão já carrega `ml_item_id` (`ingest-lote/index.ts:292`). Exige transação (RPC +
  migration) ou alvo persistido, com teste de falha intermediária.
- T3 base canônica do kit: o preview (`dialog-criar-kit.tsx`) carrega a família da linha e manda
  foto/preço/dimensões no payload; resolver só na edge deixaria preview ≠ kit criado. E a Revisão cria
  kit de base sem `ml_item_id` (`familia-expanded.tsx:205`).

## Tarefas (plano original)

### T1 — Remover destrutivo pega todas as partições (BUG, destrutivo) — `remover-publicado/processar.ts`
- A query de `anuncios_externos` (`select('id, mudando_composicao')`) passa a trazer `item_externo_id`.
- `coletarIdsMLRemover` recebe também os `item_externo_id` das raízes → `sold_quantity` checado em
  TODOS os MLBs do `codigo_pai` (ADR-0168 D-1) e encerramento de todas as partições.
- Falha hoje: partição 1 com venda + partição 0 sem venda → apaga; partição 1 fica viva no ML sem registro.
- Teste: split com 2 partições → GET nas duas; venda na partição 1 → `tem_movimentacao`, zero mutação.

### T2 — Republicar: todas as partições + todas as famílias do pai — mesmo arquivo
- Ramo Legacy (`!filhosUPPausadosPelaSaga`): pausar `{alvo.ml_item_id} ∪ item_externo_id das raízes}`
  com a mesma regra GET→(active? PUT paused) / 404-410 segue / erro aborta antes de mutação local.
- Vínculo local: hoje zera só `alvo.id`. Passa a:
  - escolher a **canônica** (mais nova com `ml_item_id`, criado_em desc) como a família preservada
    (vai para `pronto`/`CREATE`, lote → `revisao`, retorno `preservada` com o id/lote DELA);
  - nas demais famílias publicadas do mesmo `codigo_pai`: zerar só `ml_item_id`, `ml_permalink`,
    `publicado_em` (+ `variacoes.ml_variation_id/preco_publicado_ml/ml_picture_id`), sem mudar status —
    corta o vínculo de UPDATE (ingest casa por `codigo_pai` + `ml_item_id not null`) sem criar 2ª
    família `pronto` (evita CREATE duplicado).
  - Pergunta aberta ao revisor: status das famílias antigas (manter `publicado` sem `ml_item_id` vs outro).
- Front: navegar para a Revisão do lote devolvido (já usa `loteId` do retorno — conferir).
- Testes: split → PUT paused nas 2 partições; 2 lotes → canônica vira `pronto`, antiga perde `ml_item_id`.

### T3 — Criar kit usa a base canônica — `criar-kit-vinculado/processar.ts`
- Após carregar `base` por `familiaBaseId` (posse/org), re-resolver a mais nova com `ml_item_id` do
  mesmo `codigo_pai` (criado_em desc); custo/peso/fotos saem dela. Gates (multivariação, kit de kit,
  custo>0) rodam sobre a canônica.
- Teste: 2 famílias, custo 5 (antiga) e 7 (nova) → kit nasce com 7×N.

### T4 — Retentar catálogo — `retentar-catalogo/index.ts` + front
- Edge: trocar `familiaId` pela canônica do `codigo_pai` antes de checar retentável e enfileirar.
- Front: linha de partição >0 (extras de split em `fetchPublicados`) ganha `particaoSplit: true`; o ↻
  some nela (`item.catalogRetentavel && !item.particaoSplit`) até existir opt-in por partição.
- Testes: edge com 2 lotes enfileira a nova; tela não mostra ↻ em partição.

### T5 — Migrar: recusa explícita para UP — `migrar-preco-por-variacao`
- Se o `codigo_pai` tem itens em `anuncios_externos_itens` (não retirados) → 400 "Produto já publicado
  com um anúncio por variação (User Products)." antes da chamada de elegibilidade ao ML.
- Teste no `processar` existente.

### T6 — Gating de admin no front — `Publicados.tsx`
- Botões admin-only (Pausar/Reativar, Criar kit, Migrar, Retentar, Republicar) usam
  `usePodeExecutarOperacao()` (já existe: admin fora de suporte; suporte `full` em sessão) em vez de
  `profile.is_admin`. Remover: desabilitar quando `!canWrite()` (suporte `read` dá 403 hoje).
- Fora do escopo (decisão de produto, perguntar ao Diego): exigir admin na edge de Remover/Republicar.

## Deploy
Edges: `remover-publicado` (verify_jwt=false), `criar-kit-vinculado`, `retentar-catalogo`
(verify_jwt=false), `migrar-preco-por-variacao`. Sem migration. Conferir versão pós-deploy.

## Verificação
`pnpm test`, testes deno das edges tocadas, `pnpm preflight:static`, CI verde, revisão do diff pelo Codex.
