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

1. **Ledger `estoque_movimentos`** com idempotência por unique parcial `(org_id, referencia_externa)`, mais três funções plpgsql `security definer` (`baixar_estoque`, `estornar_estoque`, `registrar_entrada`) e um trigger `after update of estoque on variacoes` que registra ajuste manual quando `auth.uid()` não é nulo.
2. **Baixa no gancho `novaPaga`** que já existe no `sync-venda` (o mesmo que dispara Telegram e mensagem ao comprador), dentro de try/catch — a venda nunca falha por estoque.
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
| D-6 | Baixa por venda liga para **todas** as orgs, sem flag | Gatear criaria um `if` no gancho `novaPaga` e duas realidades para manter. Para org de planilha a baixa evita oversell entre importações e a próxima importação sobrescreve; para org do módulo é a verdade permanente, porque ela nunca importa |
| D-7 | **Cancelamento** antes do despacho repõe o estoque; **devolução** não repõe, só notifica | Repor sempre anuncia estoque que talvez tenha voltado quebrado ou nem tenha voltado |
| D-8 | Venda maior que o saldo baixa até zero (`greatest(0, …)`), o ledger grava a quantidade **real** vendida e o operador é notificado | Saldo negativo obrigaria publicabilidade, push e ML a aguentarem negativo — e o ML não aceita quantidade negativa |
| D-9 | Entrada **sobrescreve** `variacoes.custo` (último custo), só quando informado e > 0; zero/negativo **rejeita** | Custo médio ponderado é cálculo num caminho financeiro (ADR-0055) sem demanda. Default silencioso é proibido: já houve incidente de campo financeiro assumindo valor errado por 2 semanas |
| D-10 | Push por **valor absoluto**, fila serial por org. Entrada/ajuste propagam para **todos** os canais (inclusive ML); baixa por venda propaga para todos **menos** o de origem | Delta não é idempotente — um retry duplica a correção |
| D-11 | Estoque zero: **nenhuma ação**. O ML pausa o anúncio sozinho | Pausar explicitamente duplica o que o ML já faz e cria a pergunta "quem reativa?" |
| D-13 | Gate do módulo **no menu e na edge** | `profiles.allowed_menus` (ADR-0047) é navegação, não fronteira de segurança — sem o gate na edge, qualquer token autenticado chamaria o endpoint |
| D-15 | Toda escrita de estoque passa por edge com `service_role`; as RPCs são revogadas de `authenticated` | Se o browser chamasse a RPC direto, `auth.uid()` seria não-nulo e o trigger registraria um **segundo** movimento para a mesma entrada |

## Risks / open questions

1. **Idempotência sob retry do QStash.** O retry re-executa o handler inteiro do `sync-venda`. A baixa é protegida pela unique da referência, mas o enfileiramento do job de sincronização e a notificação de "venda sem saldo" podem duplicar. O `reservarNotificacao` existente cobre só o alerta de venda paga.
2. **Concorrência dentro de `baixar_estoque`.** O INSERT do movimento e o UPDATE do estoque são dois statements na mesma função. Duas vendas simultâneas do mesmo SKU: o `greatest(0, estoque - qtd)` é atômico por linha, mas `estoque_anterior` vem de um SELECT anterior ao UPDATE — pode ficar defasado sob concorrência, e é justamente ele que decide a notificação de "vendeu sem saldo".
3. **`resolverAlvosPush` e o split.** A ancoragem diz que cada cor vive em exatamente 1 partição. Se por bug uma linha de `anuncios_externos` tiver o mesmo SKU de outra partição, o push iria para os dois anúncios. Vale um guard?
4. **`fetchProdutosComSaldo`** (Plano B, Task 7) faz `select` de `variacoes` com join em `familias` sem restringir à família mais recente por `codigo_pai`. Para org do módulo é inofensivo (um produto = uma família); para org de planilha com N lotes, duplicaria variação na tela.
5. **D-1.1 e o ciclo do lote.** `talvezFinalizarLote` recalcula do estado vivo (sem `publicando` → se há `pronto`, vira `revisao`; senão `concluido`). Anexar família nova a um lote em `revisao` e voltar o status para `processando` se auto-corrige, ou existe estado travado?
6. **Trigger de ajuste manual.** Depende de `auth.uid() is null` para não duplicar em escrita de worker. Isso vale em toda escrita `service_role` do Supabase, ou existe caminho em que `auth.uid()` sobrevive?

## Out of scope

- **Emissão de NF-e** — descartada nesta sessão com racional registrado na seção 11 da spec (commodity, passivo fiscal, manutenção perpétua da reforma tributária, custo de oportunidade do E5 Shopee).
- Importação do XML de compra do fornecedor (fase 2).
- Multi-depósito / estoque por localização.
- Reserva de estoque / estoque de segurança.
- Custo médio ponderado.
- Reposição automática em devolução.
- Segundo canal real (Shopee) — a infra cross-canal é provada com conector fake até o E5.
