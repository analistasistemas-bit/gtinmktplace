# ADR-0192 — Pós-venda do Mercado Livre: ações de escrita (revisão, reclamação, mensagem)

**Status:** Proposto
**Data:** 2026-10-28
**Decisores:** Diego
**Relacionados:** ADR-0037 (devoluções/claims), ADR-0060 (ação restrita a admin), ADR-0067 (mensagens pós-venda)
**Spec:** `docs/superpowers/specs/2026-10-28-posvenda-ml-design.md`

---

## Contexto

O PubliAI só lê devoluções, reclamações e mensagens do ML; quem age (revisar devolução,
reembolsar, responder, abrir disputa) precisa ir ao painel do ML. Agora há escrita com efeito
financeiro e prazo. O token da Avil já tem `orders-shipments:/read-write`.

Achado de 28/10: o estado de revisão vive em `returns/{id}/reviews` e no `detail`, não no claim
(devolução 5597930682 estava `closed` local enquanto o ML pedia revisão). Sem ler esses recursos
o card "Revisar" não é confiável.

## Decisão

1. **Colunas novas em `ml_devolucoes`:** `return_id`, `detalhe` (`{title, description, problem,
   due_date, action_responsible}`), `prazo`, `vez_de` (`vendedor|comprador|ml`),
   `revisao_pendente`, `revisao_status` (último `seller_status`), `afeta_reputacao`, `rastreio`,
   `pedidos_devolucao` (order_ids, para carrinho), `enriquecido_em` (null = falta enriquecer),
   `lido_em` (versão do snapshot).
2. **Tabela `ml_posvenda_acoes`** (auditoria + trava): uma linha por tentativa de escrita, com
   `operacao_id` (idempotência de clique), `recurso`, `payload_hash`, `antes` (snapshot relido
   antes do POST), `post_em` gravado **antes** do fetch, `http_status`, `resposta_ml`,
   `sync_pendente`. Índices: `unique (org_id, operacao_id)` e **parcial único**
   `(org_id, recurso) where estado in ('reservada','enviada','desconhecido')`.
3. **Máquina de estados:** `reservada -> enviada -> confirmada | recusada | desconhecido |
   inconclusiva`; `cancelada` quando nada chegou a sair. Estados em aberto
   (`reservada|enviada|desconhecido`) travam o recurso.
4. **Nunca reenviar POST sozinho.** Sem retry automático; nenhum POST se a última tentativa do
   mesmo recurso está em aberto. A trava só é liberada sem confirmação quando o próprio ML não
   aceita mais a ação (saiu de `available_actions` e, para revisão, nenhum pedido está
   `pending`) — aí não há risco de duplicar. Ação ainda liberada + resultado incerto = trava
   mantida e a UI mostra "Conferir no ML".
5. **Enriquecimento:** o sync lê, além do claim, `detail`, `v2/claims/{id}/returns` e
   `v1/returns/{id}/reviews` (≈3 GETs a mais por claim processado). Leitura que falha **não**
   apaga coluna já preenchida (upsert só das colunas lidas com sucesso).
6. **Detalhe ao vivo:** ao abrir uma reclamação a tela relê o ML; após qualquer ação, relê e só
   então mostra o novo estado (sem otimismo).
7. **Fotos sem storage:** upload direto do front para edge function que repassa ao ML. Revisão:
   JPG/PNG; mensagem: JPG/PNG/PDF; até 5 MB cada.
8. **Mensagens:** `ml_mensagens.lida_ml_em` = recibo de leitura no ML, **monotônico** (só sai de
   null; escrito por `update ... set lida_ml_em = coalesce(lida_ml_em, $1)`, nunca pelo upsert
   de `raw`). `lida` segue significando dispensada/tratada localmente. Preenchimento inicial a
   partir de `raw->'message_date'->>'read'`.
9. **Fora da v1:** comprovação de envio (`actions/evidences`) — 100% das vendas dos últimos 90
   dias são Mercado Envios.

## Permissão e identidade

- Qualquer membro autenticado da org executa as ações (`requireUserOrg(req, { access: 'write' })`),
  decisão do Diego, sabendo que reembolso mexe com dinheiro (não é o admin-only do ADR-0060).
- **Dono × executor:** escrita em `ml_devolucoes`/`ml_mensagens` usa `user_id` = dono da conexão
  (`marketplace_connections.criado_por`); quem clicou fica em `ml_posvenda_acoes.user_id`.
- **Player da conta:** ações e papel saem do player cujo `user_id` = `conexao.contaExternaId`
  (claims de `shipment` usam `sender`/`receiver`; não presumir `type='seller'`).
- 403 do ML numa ação -> "Reconecte a conta do Mercado Livre em Configurações → Conexões (falta
  permissão de escrita)".
- Toda ação exige clique + confirmação; token nunca no front.

## Segurança (RLS e grants)

`ml_posvenda_acoes`: RLS de `select` por `org_id = current_org_id()`; escrita só por service_role.
`revoke all ... from anon, authenticated; grant select ... to authenticated` — os default
privileges do projeto concedem TRUNCATE, que RLS não cobre (precedente
`20260924184220_central_promocoes.sql`). Teste: `supabase/tests/posvenda_acoes_grants.sql`.

## Custo

≈3 GETs a mais por claim processado no sync; uma linha por ação na auditoria. Sem storage novo.

## Alternativas descartadas

- Retry automático do POST: pode duplicar reembolso.
- Estado otimista na UI: divergiria do ML (ex.: "Revisada" local x "Último dia" no ML).
- Admin-only para reembolso: rejeitado pelo Diego.
- Guardar fotos em storage próprio: dado de comprador sem necessidade.
