# ADR-0155: Central integrada com consumo e fechamento auditáveis

**Status:** Aceito no desenho da central, 2026-09-06. Implementação acompanhada pelo [plano](../superpowers/plans/2026-09-06-central-organizacoes.md).

A central administrativa permanece no PubliAI, com indicadores acessíveis ao super-admin sem criar uma sessão de suporte; a entrada na operação continua dependendo da aprovação do cliente. A cobrança usa condições comerciais versionadas por organização e um registro durável de consumo do Sonar, porque cache global de mercado e logs técnicos não representam entregas faturáveis por cliente.

Uma busca concluída por termo ou EAN corresponde a uma unidade comercial, incluindo complementos; reaberturas, falhas e consultas da equipe Daludi não são cobradas, mas são auditáveis. Os demonstrativos mensais congelam fontes, preços e ajustes, evitando que renegociações ou fatos tardios reescrevam cobranças anteriores. Manter esse histórico exige armazenamento próprio; a alternativa de recalcular tudo pelo contrato e cache atuais foi rejeitada por não permitir explicar valores já cobrados.

Os preços da apresentação são referências negociáveis, inclusive infraestrutura na modalidade 2. Esta decisão substitui, para a central, a direção comercial por faixas de anúncios da proposta ADR-0028; integração com gateway não pertence à primeira versão.

## Emenda 2026-11-02 — devolução abatida automaticamente

A apuração de devoluções do plano (conciliação manual por venda) virou fila de trabalho sem valor: em outubro/2026 eram 17 pendências, e em todas o ML já informava o valor devolvido. Mediação aberta sem reembolso ainda não tinha valor nenhum a abater. O valor devolvido de produto passa a ser automático (`platform_auto_refund_cents`, migration `20261102221455`): conciliação manual, se existir, tem prioridade; senão `ml_vendas.estorno`; senão a soma de `raw.payments[].transaction_amount_refunded`. O valor é limitado ao bruto. `refunded`/`cancelled` continuam abatendo 100 %. Venda `paid` com devolução/mediação e sem reembolso abate 0. Se o ML reembolsar depois, o ajuste tardio credita sozinho no mês seguinte. Abater 100 % na abertura da mediação foi rejeitado porque o ajuste só credita e nunca re-cobra: se a mediação fosse ganha pelo vendedor, a receita estaria perdida. Só `partially_refunded` sem nenhum valor conhecido continua como pendência `refund_reconciliation_required`. A conciliação manual segue disponível como correção.
