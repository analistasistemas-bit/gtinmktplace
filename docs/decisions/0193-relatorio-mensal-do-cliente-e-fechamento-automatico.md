# ADR-0193 — Relatório mensal do cliente, fechamento automático e Central premium

**Status:** Aceito — desenho fechado em grilling (2026-11-02) com consultoria do Codex `gpt-6.1-sol` high ([análise](../superpowers/specs/2026-11-02-central-premium-analise-codex.md)). Implementação em fatias pelo [plano](../superpowers/plans/2026-11-02-central-premium-relatorio.md).
**Data:** 2026-11-02
**Decisores:** Diego
**Estende:** [ADR-0155](0155-central-organizacoes-cobranca-auditavel.md) (demonstrativo congelado), [ADR-0158](0158-central-carteira-agregada-e-pendencias.md) (carteira), [ADR-0165](0165-faixas-regressivas-por-organizacao.md) (faixas), [ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md)/[ADR-0190](0190-notificacao-gerencial-de-venda-e-comandos-telegram.md) (Telegram)
**Relaciona:** [0150](0150-margem-um-rotulo-e-um-simulador-no-pulse.md) (rótulos), [0109](0109-custo-congelado-por-venda.md) (custo congelado), [0172](0172-vendas-sku-analise-por-variacao.md) (lucro por item, ABC), [0179](0179-painel-de-ads.md) (Ads, atribuição em 15 dias), [0180](0180-cupom-do-vendedor-na-venda.md) (cupom)
**Glossário:** `CONTEXT.md` — Relatório mensal do cliente, Lucro após Ads da loja, Visitas/Conversão dos anúncios acompanhados, Principais produtos do mês, Dados de recebimento Daludi, Vencimento da remuneração, Fechamento automático, Aviso de fechamento mensal.

## Contexto

A Central (Administração da plataforma) mostra volume (bruto, pedidos, ticket, markup) com cards de mesmo peso, um gráfico só de faturamento e um card "Operação" vazio; não explica resultado econômico nem gasto de Ads. A Daludi não tem como prestar contas ao gestor de cada loja: o demonstrativo é conferência interna, não um documento comercial, e não traz dados de pagamento. O fechamento do mês é manual, org por org.

## Decisão

**D-1. Relatório mensal do cliente = PDF de um mês com demonstrativo fechado.** Sem demonstrativo fechado, o botão fica desabilitado com o motivo. A página de cobrança lê o snapshot congelado (`platform_billing_statements.snapshot`); as páginas de desempenho são recalculadas das vendas a cada geração (não são documento fiscal; devolução tardia já vira crédito no mês seguinte e não reescreve a cobrança).

**D-2. Resultado sempre visível, em cascata.** Faturamento da loja → − comissão/frete/imposto → Líquido → − custo dos produtos → Lucro → − gasto de Ads da conta → **Lucro após Ads da loja** (destaque), com **Margem s/ venda após Ads** e **Markup após Ads**. Independe de `configuracoes.mostrar_lucro_dashboard`. A remuneração Daludi fica fora da cascata.

**D-3. Lucro por item calculável.** Mesma regra de `resultadoPorItem` (ADR-0190): item só tem lucro com custo, alíquota confirmada e frete conhecido; senão fica fora com o motivo (`sem_custo`, `aliquota_nao_confirmada`, `frete_nao_lido`). **Cobertura do lucro** = faturamento dos itens com lucro calculável ÷ faturamento. Cobertura < 100 % **ou qualquer item faturável sem lucro calculável** (mesmo de faturamento zero) → lucro, margem s/ venda e markup **parciais** (numerador e base só dos itens calculáveis, rotulados); nenhum item calculável → indisponível (nunca zero, nunca lucro = líquido). A cascata mostra a linha "itens sem lucro calculável" com o faturamento excluído. Cobertura por pedido "com algum custo" (`calcularResumo`) não é usada.

**D-3a. Lucro após Ads só com cobertura total.** O gasto de Ads é da loja inteira; descontá-lo de um lucro parcial geraria um saldo sem significado. Com cobertura < 100 % ou gasto de Ads indisponível, lucro/margem/markup **após Ads** ficam indisponíveis com o motivo, e o destaque passa ao lucro (parcial) antes de Ads. Sem rateio de Ads.

**D-3b. Devoluções no período do estorno** ([ADR-0106](0106-devolucao-conta-no-periodo-do-estorno.md)), com os critérios de `_shared/notificacoes/gerencial/devolucoes.ts`: estorno de venda de mês anterior ocorrido em M conta em M; reembolso parcial conta pelo valor; sem dupla contagem.

**D-4. Faturamento da loja já sem cupom do vendedor** (igual Resultados/dashboard). A página de cobrança usa **só valores do snapshot** (bruto, devoluções abatidas, base, faixa, componentes, créditos, total) e uma linha de reconciliação explícita: "diferença para o faturamento da loja das páginas anteriores = R$ X (cupons do vendedor e ajustes posteriores ao fechamento)". Novos fechamentos passam a guardar no snapshot o total de cupons do vendedor do mês. A regra da cobrança (que não deduz cupom) não muda.

**D-5. Visitas e conversão dos anúncios acompanhados** (critérios do [ADR-0176](0176-vitrine-visitas-conversao.md)): só pares MLB×dia com `estado='ok'` em `ml_item_visitas_dia`; pedidos = orders distintas desses mesmos MLB×dia (kits pelo `kit_item_id`); anúncios cobertos com zero visitas contam. Rotulado com a quantidade de anúncios cobertos e a cobertura de dias. Nunca "visitas da loja".

**D-6. Ads da conta** (`ml_ads_conta_dia` + `ml_ads_sync`): investimento, receita atribuída, ROAS, ACOS, TACOS, impressões, cliques, CTR, CPC. Só com **cobertura diária completa** do mês (desde `conta_cobertura_desde` e coleta ok); senão Ads e tudo que dele deriva ficam indisponíveis com o motivo (ausência de linha ≠ zero). O custo é definitivo; a atribuição sai com selo "em fechamento" enquanto `atribuicaoFinal(dia, coletado_em)` for falso para algum dia — prazo previsto (dia + 15) e consolidação efetiva são estados distintos.

**D-7. Principais produtos do mês:** ABC por **família** (código do pai via `variacoes` → `familias`, padrão de `lerCatalogoEstoque`, filtrando `org_id` nas duas tabelas, família mais recente por `criado_em desc, id desc`), ordenada por faturamento, classe A/B/C calculada sobre o universo com código antes do corte em 5; "sem código" e "família desconhecida" ficam fora do ranking e aparecem separados no rodapé. Colunas: unidades, faturamento, % do mês, lucro, margem s/ venda, markup (antes de Ads, com marca de parcial), participação somada.

**D-8. Evolução de até 12 meses** terminando na competência (ou desde o primeiro mês com venda), omitida com 1 mês: barras de faturamento e lucro após Ads (ou lucro, quando D-3a o tornar indisponível); margem em painel próprio. O cache `platform_org_month_metrics` ganha `cache_version` e os componentes de lucro; leitura, gravação e validação passam a aceitar janela parametrizada terminando na competência (hoje fixas em 6 meses no mês atual). Linha com versão antiga = miss. Misses são calculados em trabalho limitado; mês que exceder o teto de volume vira ponto indisponível com motivo, nunca zero.

**D-9. Dados de recebimento Daludi** únicos (favorecido, documento, banco/agência/conta, chave Pix) numa tabela de plataforma só de `service_role`; tabela com RLS habilitada e privilégios revogados de `PUBLIC`/`anon`/`authenticated` (inclusive `TRUNCATE`); **vencimento** = `due_day` das condições comerciais (padrão 05, validado em `validateTerms`/`platform_save_terms`, congelado com os termos no snapshot; demonstrativo antigo sem o campo usa 05). O PDF traz Pix estático com o **valor exato** (`total_cents` do snapshot; sem gateway, consistente com ADR-0155). Total ≤ 0 → página de situação, sem instrução de pagamento.

**D-10. Fechamento automático no dia 01 às 06h BRT** de cada org com condições comerciais e sem pendência, pelo mesmo `platform_billing_close` (revisão, pendências e sequência de meses inalteradas), com fan-out por org ([ADR-0173](0173-fanout-por-org-workers-agendados-cpu.md)). Cada org registra resultado (fechada, já fechada, pendência, mês anterior aberto, conflito, erro) em auditoria; conflito de revisão tenta de novo uma vez. Org com pendência ou mês anterior aberto fica aberta. Fechar não envia nada ao cliente.

**D-11. Aviso de fechamento mensal** = nova categoria de **plataforma** `fechamento_mensal`, com bot e configuração **da plataforma** (nunca o bot de uma org cliente), assinável e entregue só a perfis com `is_super_admin` e `is_active` revalidados no envio; uma mensagem por competência (chave de deduplicação), com resultado por org e link da Central.

**D-12. Central premium em todas as abas.** Resultados é a versão interativa do relatório (mesmo contrato de dados); Pulse, Extensão, Cobrança, Auditoria e Configurações recebem redesenho visual/UX com o mesmo conteúdo (Cobrança ganha o botão do relatório, o estado do fechamento e a ponte do cupom); carteira corrige a variação calculada sobre a página e mostra o estado do fechamento.

**D-13. Fora da v1:** seção "o que a Daludi fez", textos livres ou gerados por IA no PDF, envio automático, armazenamento dos PDFs gerados.

## Alternativas rejeitadas

- **PDF de qualquer mês com a prévia:** o valor a depositar mudaria depois de enviado.
- **Abater 100 % em mediação aberta / respeitar o "esconder lucro":** ver grilling; prestação de contas exige o resultado e só abate o que o ML devolveu.
- **Lucro com cobertura por pedido:** superestima o lucro quando só parte do carrinho tem custo.
- **Recalcular 12 meses de vendas por requisição:** estoura `LIMITE_VENDAS_POR_EXECUCAO` (Avil ≈ 1 800 pedidos/mês).
- **Fechamento manual com lembrete:** depende de memória; o automático usa as mesmas travas.

## Consequências

- `platform_org_month_metrics` muda de forma (migration + backfill pelo job `materializar-metricas`).
- Nova ação `monthly_report` na edge `platform-admin`; paridade com `src/lib/vendas-sku.ts` coberta por teste.
- Nova edge agendada (QStash) de fechamento, `verify_jwt=false`, idempotente por (org, mês).
- Repo público: dados de recebimento nunca no código; só na tabela.
