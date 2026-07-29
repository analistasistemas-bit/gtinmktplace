# Plan: E6b — Cadastro manual de produto + Entrada de mercadoria + Estoque único cross-canal

_Round 0 — initial draft by Claude_

> **Revisor: leia também estes três arquivos deste repositório — eles são o plano de verdade.**
> Este arquivo é só o resumo contestável.
>
> - Spec: `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`
> - Plano A (estoque, 11 tasks): `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md`
> - Plano B (cadastro + entrada, 9 tasks): `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md`
>
> Regras invioláveis do projeto: `CLAUDE.md` na raiz.

## Goal

Duas entregas num épico. **(A)** Toda venda paga no Mercado Livre baixa o estoque de forma atômica e idempotente, e todo movimento de estoque propaga o saldo absoluto para os marketplaces onde o produto está publicado. **(B)** Uma organização **sem ERP** consegue cadastrar produto direto na UI (família multi-variação, com fotos), dar entrada de mercadoria e publicar pelo fluxo de Revisão que já existe — sem nunca tocar numa planilha.

Contexto: PubliAI é um SaaS multi-tenant em produção, com dinheiro real passando (módulo financeiro, publicação em marketplace). Hoje o produto **só** entra por planilha, o que exige que o cliente já tenha um ERP para poder usar o sistema. E o estoque flui num sentido só (PubliAI → ML, na publicação): `sync-venda` grava `ml_vendas`/`ml_vendas_itens` e **não toca** em `variacoes`.

## Approach

1. **Ledger `estoque_movimentos`** (com `quantidade` = delta aplicado, `quantidade_pedida`, outbox `push_enfileirado_em` e intenção `push_canal_origem`), idempotência por unique parcial `(org_id, referencia_externa)`, três funções plpgsql `security definer` serializadas por `pg_advisory_xact_lock`, e um trigger `before update of estoque on variacoes` que BLOQUEIA escrita direta com `auth.uid()` não nulo.
2. **Baixa sempre que o pedido está pago** (`pedido.status === 'paid'`, NÃO na transição `novaPaga`, que é one-shot e impediria retomada), dentro de try/catch — a venda nunca falha por estoque. A idempotência vem do ledger.
3. **Método novo `atualizarEstoque`** no `ChannelConnector`, implementado no ML reusando `montarVariacoesUpdate` (que casa por `seller_custom_field`) e `atualizarItemPlanoML` para item plano.
4. **Worker `sincronizar-estoque`** atrás de fila serial QStash `estoque-{orgId}` (parallelism 1), com uma função pura `resolverAlvosPush` que traduz linhas de `anuncios_externos` + `anuncios_externos_itens` em uma lista de pushes por item externo — cobrindo split (ADR-0048) e user products (ADR-0088).
5. **Reconciliação diária** restrita a produtos com movimento nas últimas 24h e produtos publicados em ≥2 canais.
6. **Cadastro manual = um lote normal** com `lotes.origem = 'manual'`, caindo na mesma Revisão de sempre.
7. **Módulo opt-in por org** via `organizations.modulos_habilitados text[]`, com gate no menu **e** nas edges.

## Key decisions & tradeoffs (conteste estas)

| # | Decisão | Alternativa rejeitada e por quê |
|---|---|---|
| D-1 | Cadastro manual cria um **lote** de verdade (`origem='manual'`), em vez de família com `lote_id` nulo | `lote_id` é `NOT NULL` e sustenta `process-familia:52` (gate hard), `finalizarLote` nos dois workers que publicam anúncio real, todo o roteamento de `/revisao/:loteId`, e a unique `(lote_id, codigo_pai)` — que **fica furada com NULL**, porque Postgres trata NULL como distinto |
| D-1.1 | "Sessão" = o lote manual **aberto** da org (`status in importando/processando/revisao`); sem lote aberto, cria um novo | Um lote por produto polui a tela de Lotes; um lote permanente nunca fecha e a Revisão vira lista infinita |
| D-6 | Baixa por venda liga para **todas** as orgs, sem flag | Gatear criaria um `if` no gancho da venda e duas realidades para manter. Para org de planilha a baixa evita oversell entre importações e a próxima importação sobrescreve; para org do módulo é a verdade permanente, porque ela nunca importa |
| D-7/D-19 | **Cancelamento** antes do despacho repõe **só o que foi de fato baixado** (a checagem vive dentro da RPC, com advisory lock e tombstone para a corrida paid×cancelled); **devolução não é tocada** | Repor sempre anuncia estoque que talvez tenha voltado quebrado ou nem tenha voltado. E `FOR UPDATE` não trava linha ausente, então só o lock comum serializa as duas execuções |
| D-8 | Venda maior que o saldo baixa até zero. O ledger grava em `quantidade` o **delta aplicado** e em `quantidade_pedida` o pedido; o operador é notificado | Saldo negativo obrigaria publicabilidade, push e ML a aguentarem negativo. E gravar o pedido em `quantidade` faria o estorno **criar estoque**: saldo 2, venda 5, estorno devolveria 5 |
| D-9 | Entrada **sobrescreve** `variacoes.custo` (último custo), só quando informado e > 0; zero/negativo **rejeita** | Custo médio ponderado é cálculo num caminho financeiro (ADR-0055) sem demanda. Default silencioso é proibido: já houve incidente de campo financeiro assumindo valor errado por 2 semanas |
| D-10/D-18 | Push por **valor absoluto**, fila serial por org. A intenção (`push_canal_origem`) é gravada no movimento: entrada/estorno → todos os canais; venda → todos menos o de origem. O despacho lê o outbox e agrupa por `(produto, intenção)` | Delta não é idempotente. E um despachante que recebesse o canal do chamador drenaria movimentos de políticas opostas com o rótulo errado — uma venda no ML marcaria uma entrada como entregue sem atualizar o ML |
| D-11 | Estoque zero: **nenhuma ação**. O ML pausa o anúncio sozinho | Pausar explicitamente duplica o que o ML já faz e cria a pergunta "quem reativa?" |
| D-13 | Gate do módulo **no menu e na edge** | `profiles.allowed_menus` (ADR-0047) é navegação, não fronteira de segurança — sem o gate na edge, qualquer token autenticado chamaria o endpoint |
| D-15/D-20 | Toda escrita de estoque passa por edge com `service_role`; as RPCs são revogadas de `authenticated` **e concedidas ao `service_role`**, e um trigger `before update` bloqueia a escrita direta | Sem o grant, as RPCs ficariam inexecutáveis pelas próprias edges. E `revoke update (estoque)` seria inócuo: privilégios de tabela e coluna são cumulativos em Postgres, não existe deny de coluna |

## Risks / open questions

Os seis riscos originais foram todos investigados e resolvidos ao longo de três rodadas de revisão
adversarial (ver `PLAN-REVIEW-LOG-E6B.md`). O que resta em aberto:

1. **`paginarTudo` precisa ser extraída e exportada** (`_shared/faturamento/io.ts:41-52` a define
   sem exportar) e passar a tratar o `error` do PostgREST, que hoje ignora.
2. **Entrega de notificação é at-most-once** — `reservarNotificacao` reserva antes de enviar, então
   uma falha de envio não é re-tentada. É o padrão já vigente no repo para os alertas existentes;
   herdado, não introduzido aqui.
3. **Guards de duplicidade (produto e SKU) não são atômicos** — check-then-insert sem unique
   possível por org. Risco residual aceito e documentado.
4. **Split + user products simultâneos** é coberto por construção mas não é fluxo validado: o
   worker UP só publica a partição 0 e `publicar-split-ml` ainda não integra a saga UP.

## Out of scope

- **Emissão de NF-e** — descartada nesta sessão com racional registrado na seção 11 da spec (commodity, passivo fiscal, manutenção perpétua da reforma tributária, custo de oportunidade do E5 Shopee).
- Importação do XML de compra do fornecedor (fase 2).
- Multi-depósito / estoque por localização.
- Reserva de estoque / estoque de segurança.
- Custo médio ponderado.
- Reposição automática em devolução.
- Segundo canal real (Shopee) — a infra cross-canal é provada com conector fake até o E5.
