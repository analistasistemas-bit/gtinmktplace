# ADR-0178 — Reajuste de preço em massa (3º tipo do motor de operações)

**Status:** Aceito (2026-10-04) — em produção desde 2026-10-04
**Produção:** em produção desde 2026-10-04 (migrations `20261004200804_reajuste_preco_schema` e `20261004202356_reajuste_preco_rpcs` via `db push`; edges `ingest-lote` v76, `publicar-familias` v49, `publish-familia-ml` v141, `update-familia-ml` v125, `publicar-split-ml` v107, `migrar-preco-por-variacao` v14, `sincronizar-promocoes` v17, `operacoes-massa` v10 → v11 com o fix da promoção `candidate` sem `id`, pulada em vez de tornar a checagem inconclusiva). Validado em campo na DSA: MLB5140706557 (Legacy sem variações) R$ 39,99 → +1% → R$ 40,39 conferido no ML e no banco, Reverter restaurou ML e banco; os outros 6 ativos ficaram fora do lote (par de catálogo); preview ~6–10 s para 7 itens. Não validado em campo: Legacy com variações e User Products (sem elegíveis na DSA).
**Data:** 2026-10-04
**Relacionado:** [ADR-0174](0174-operacoes-em-massa-promocoes-v2.md) (motor + emenda 2026-10-04),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) (piso/semáforo), [ADR-0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem),
[ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (preço confirmado/split), [ADR-0160](0160-preco-por-variacao-sob-user-products.md) (UP),
[ADR-0016](0016-publicacao-update-reposicao-estoque.md) (UPDATE)
**Design:** `docs/superpowers/specs/2026-10-04-reajuste-preco-em-massa-design.md`
**Decisores:** GPT-6 Astra como representante do Diego (delegação explícita em 2026-10-04).

## Contexto

Preço hoje só vai ao ML pelo UPDATE completo (Revisão → Publicar). Reajuste feito no Seller Center diverge do
banco (`variacoes.preco_publicacao`) e é desfeito no próximo UPDATE; o re-ingest recalcula o preço das cores não
fixadas. A Avil repete reajustes coletivos (repasse de custo). O motor de operações em massa (ADR-0174) já tem
laço, claim, preview, trava e Reverter.

## Decisão

1. **Novo handler `reajustar`** no motor existente, sem caminho paralelo. Base = preço vivo de cada MLB;
   entrada ±% ou ±R$, alvo absoluto em centavos, editável por item; a mesma operação reverte com `origem_id`.
2. **Escrita só-preço no ML:** Legacy `PUT {variations:[{id, price}]}` com todas as variações do MLB (doc
   oficial; sem quantidade/fotos → sem corrida com estoque); item plano `PUT {price}`; UP `PUT {price}` por MLB.
   Confirmação por GET (Legacy: todas as variações); preço divergente = erro "preço não aplicado pelo ML", sem
   atribuir causa. Executar e Reverter: admin/suporte full, até 500 MLBs únicos, validado no servidor.
3. **Durável no banco:** confirmado no ML → `preco_publicacao` = novo, `preco_editado_pelo_operador = true`,
   `preco_publicado_ml` = confirmado (via RPC por MLB, escopada por org). **Isto muda a garantia do ADR-0020/0055
   de recalcular por custo no re-ingest** para as cores reajustadas — o preview avisa; o próximo repasse é outro
   reajuste.
4. **Trava financeira** com tarifa exata no preço novo e imposto pela origem; 🔴 e ⚪ só com confirmação separada;
   🟡 marcado com aviso. **Origem ausente → ⚪ (nunca default nacional)** — mais restrito que o texto original do ADR-0055.
5. **Fora do MVP:** promoção (pending/started), Kit Virtual, catálogo/par de catálogo, migração PxV, família
   publicando, moderado/encerrado, **atacado PxQ** (faixas absolutas).
6. **Reverter** restaura ML e banco (`preco_publicacao` e a marca `editado` anteriores; `preco_publicado_ml` = preço
   confirmado na reversão) só se ambos seguem como a operação deixou (comparação atômica).
7. **Integridade (garantias):** preview calculado no servidor e gravado como `rascunho` (as confirmações valem para
   ele); snapshot financeiro por cor revalidado na execução (qualquer mudança → refazer preview); **serialização
   atômica** em Postgres — o reajuste reivindica o item travando as famílias do MLB (`for update`) e um advisory lock
   por MLB, e a publicação/UPDATE (`familia_reservar_publicacao`), a adesão a promoção (claim com o mesmo advisory
   lock) e a entrada em migração PxV (`familia_reservar_migracao_pxv`, que grava `solicitada` na mesma transação)
   recusam MLB/família com reajuste ativo; recuperação por etapa (`escrita_pedida` → `ml_confirmado`) **antes** de
   qualquer trava de novo envio e sem reaplicar o percentual (conferência só por GET; reenvio só pelo fluxo normal);
   resultado desconhecido do ML vira `conferindo` (não expira, mantém a reserva, retomada com claim exclusivo); persistência das
   variações e conclusão do item na mesma transação; conflito com edição concorrente vira erro explícito;
   valores em centavos half-up, iguais no preview, na trava e no PUT; preço igual ao vivo = sem alteração.

## Consequências

- Primeiro caminho de escrita de preço fora do UPDATE; o banco continua fonte de verdade (o próximo UPDATE
  republica o preço reajustado, não o antigo).
- Cores reajustadas ficam fixadas: repasse de custo automático por re-ingest deixa de valer para elas.
- Atacado, promoção e catálogo ficam para uma versão seguinte, depois de medir o efeito real no ML.

## Alternativas descartadas

- Escrever só no ML (revertido no próximo UPDATE).
- Gravar no banco sem fixar (re-ingest desfaz).
- Reaplicar atacado após o novo preço (falha deixaria base nova com faixas velhas).
- Spike de escrita direta no ML para medir promoção/catálogo (fora do fluxo do app).

## Implementação

**Migrations** (aplicar com `supabase db push`):
- `20261004200804_reajuste_preco_schema.sql` — `operacoes_massa.acao` aceita `reajustar`; `status` ganha `rascunho` (e `expira_em`); itens ganham `rascunho`/`conferindo` e as colunas `preco_anterior`, `etapa` (`escrita_pedida|ml_confirmado`), `confirmado_sem_dado`, `incluido`, `avaliacao`, `estado_anterior`, `variacoes_ml`, `variacao_ids`, `codigo_pai`; índice único de reserva inclui `conferindo`; índice `operacoes_massa_itens_reajuste_ativo (org_id, codigo_pai)`.
- `20261004202356_reajuste_preco_rpcs.sql` — `reajuste_codigo_pai`, `reajuste_ativo_produto`, `reajuste_trava_produto`, `reajuste_reivindicar`, `reajuste_variacoes_do_mlb`, `reajuste_confirmar`, `reajuste_persistir`, `familia_reservar_publicacao`, `familia_reservar_migracao_pxv`; `operacoes_massa_reivindicar` substituída (`aderir` ganha lock do MLB e a barreira). Todas `service_role` only. Identidade de serialização = `(org_id, codigo_pai)`; ordem de locks produto → MLB.

**Edge `operacoes-massa`** (`_shared/operacoes/reajuste/*`: `alvo`, `avaliacao`, `decidir`, `deps`, `elegibilidade`, `etapa`, `executar`, `ml`, `pedido`, `preview`, `tipos`): `{etapa:'preview'}` (qualquer membro; Reverter só admin/suporte full) grava o `rascunho` (expira em 30 min; `executaveis = 0` não grava nada); `{etapa:'confirmar'}` (admin/suporte full) chama `reajuste_confirmar` e publica `executar`; `executar`/`conferir` rodam o mesmo laço. Teto de 500 MLBs únicos (`MAX_MLBS`).

**Barreiras**: `publicar-familias` reserva via `familia_reservar_publicacao` e devolve `recusadas` (409 se nada foi enfileirado); `update-familia-ml`, `publish-familia-ml` e `publicar-split-ml` chamam `_shared/publicacao/guard-reajuste.ts` (400 definitivo com reajuste ativo; erro da RPC é fail-closed e retentável); `migrar-preco-por-variacao` entra em PxV pela RPC `familia_reservar_migracao_pxv`; `ingest-lote` herda `preco_editado_pelo_operador` da cor casada no UPDATE (D15).

**Front**: Publicados — "Reajustar preço" na barra de seleção + dialog + preview (`components/operacoes/`); Operações — título "Reajustar preço de N anúncios" e Reverter pelo preview; Revisão — selo "Preço fixado pelo operador — mantido nos próximos lotes" e "Voltar ao automático".

**Deploy (ordem):** `supabase db push` → `publicar-familias`, `update-familia-ml`, `publish-familia-ml`, `publicar-split-ml`, `migrar-preco-por-variacao`, `ingest-lote` → `operacoes-massa` → merge do front. Conferir a versão ativa de cada função após o deploy.
