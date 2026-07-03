# ADR-0056 — Operações do ML usam o escopo e a credencial da operação, não do chamador

**Data:** 2026-07-03
**Status:** Aceito — implementado na branch `worktree-fix-publicados-enriquecimento-operacao` (helper `_shared/ml/operacao.ts` + edge functions `status-publicados`, `metricas-vendas`, `publicar-familias`, `remover-publicado`, `reprocessar-familia`, `regenerar-copy-familia`, `definir-categoria-familia`, `responder-pergunta`, `calcular-tarifa-ml`, `ingest-lote`). Pendente deploy CLI e validação.
**Contexto relacionado:** ADR-0047 (operação compartilhada + RBAC de menu), ADR-0024 (abstração de canais), ADR-0027 (multi-tenancy), ADR-0048 (split de anúncios), ADR-0034 (fila serial por conta ML).

## Contexto

O ADR-0047 tornou a operação **compartilhada e single-tenant**: qualquer membro autenticado
(`is_membro_operacao()`) enxerga as mesmas tabelas de domínio (`familias`, `anuncios_externos`,
`ml_vendas`, …). `user_id` nessas tabelas passou a ser só `criado_por` (auditoria).

Mas as edge functions que tocam o ML continuaram escopadas ao **chamador** — tanto as de
**enriquecimento ao vivo** da tela Publicados quanto as de **ação** (publicar, remover, reprocessar,
responder pergunta, calcular tarifa, ingerir lote):

- filtravam recursos por `.eq('user_id', user.id)`;
- liam o token ML com `getValidAccessToken(user.id)` — a credencial do usuário logado;
- gravavam `familias`/`variacoes` com `user_id = user.id` (o chamador).

A conexão ML é armazenada por `user_id` em `ml_credentials`, e hoje existe **uma única** conexão
na operação: a conta **AVILBV**, ligada ao usuário admin dono de todas as famílias. Os demais
membros (Michael, Samuel) não são o `criado_por` das famílias nem têm credencial ML própria.

**Sintoma (bug 2026-07-03):** para os dois membros que não são donos, `status-publicados`
devolvia `{ itens: [] }` (`ids` vazio) → o front caía no fallback `status: 'indisponivel'` para
todos os anúncios, com estoque/preço/vendas em `—`, card "Ativos 0/61" e "Encalhados 0". Só o
admin (dono + credencial ML) via os dados corretos. Não é concorrência — é fronteira de dados:
**lista compartilhada × enriquecimento + token per-user**. O mesmo descompasso impedia esses
membros de publicar/remover/reprocessar famílias e responder perguntas, e um lote ingerido por um
membro não-dono não casaria com anúncios já publicados (viraria CREATE → **anúncio duplicado**).

## Decisão

Toda operação do ML passa a usar a **fronteira e a credencial da operação**, não do usuário
chamador. Três dimensões, aplicadas de forma consistente:

1. **Escopo de busca = operação inteira.** Remover `.eq('user_id', user.id)` dos selects/updates
   de `familias`/`variacoes`/`anuncios_externos`/`lotes`. Nos endpoints com `adminClient`
   (`service_role` ignora RLS), a fronteira da operação é hoje "todas as linhas" (single-tenant);
   nos com `userClient` (`regenerar-copy`, `definir-categoria`), a RLS `is_membro_operacao()` já
   restringe à operação. O gate `requireUser(req)` continua (só membro autenticado chama).
2. **Token ML = credencial da operação.** Novo helper `_shared/ml/operacao.ts`
   `userIdCredencialOperacaoML(admin)` resolve o `user_id` da conexão ML da operação (a mais antiga
   por `criado_em`, determinístico caso mais de um membro conecte). Endpoints que chamam o ML direto
   (`status-publicados`, `metricas-vendas`, `responder-pergunta`, `calcular-tarifa-ml`, e a
   reconciliação do `ingest-lote`) usam esse id no `getToken`, não `user.id`.
3. **`familias.user_id`/`variacoes.user_id` = dono da conta ML da operação.** No `ingest-lote`, as
   entidades de publicação são gravadas com `ownerUserId` (a credencial da operação), não com o
   chamador. Esse é o `user_id` que **todos os workers de publicação** já usam para resolver o token
   (`publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `process-familia`,
   `atributos-familia`, `vincular-catalogo`). Assim os workers ficam **intocados** e qualquer membro
   pode subir lote sem quebrar a publicação. A fila serial (ADR-0034) passa a ser keyed por
   `familias.user_id` (a conta ML), não pelo chamador — preservando "uma escrita por conta ML".
   Quem operou continua auditável em `lotes.user_id`.
4. **Ponto único de troca para o E7 (multi-org).** Quando existir `org_id`, os filtros viram
   `.eq('org_id', …)` e o helper resolve a credencial ML do org do chamador — mesma fronteira já
   usada por `is_membro_operacao()`.

## Consequências

- Os três membros passam a ver estoque/preço/status/vendas idênticos na tela Publicados, e a
  publicar/atualizar/remover/reprocessar/responder perguntas pela conta ML da operação.
- A conexão ML da operação vira dependência **única e compartilhada**: se ninguém conectou o ML,
  telas de leitura mostram `semCredencialML` e o `ingest-lote` grava as famílias com o chamador
  (fallback), como antes.
- **Redefinição semântica** (ajuste ao ADR-0047): nas tabelas `familias`/`variacoes`, `user_id`
  passa a ser "dono da conta ML onde publica" em vez de "criado_por". A auditoria de operador vive
  em `lotes.user_id`. Numa operação single-tenant isso é transparente (sempre a mesma conta).
- **Não altera nenhum worker de publicação** — o invariante `familias.user_id = conta ML` é
  justamente o que eles já assumiam; a mudança só garante que o invariante valha para famílias
  criadas por qualquer membro.
- Reversível: reintroduzir os filtros por `user.id` e a gravação com o chamador volta ao anterior.
