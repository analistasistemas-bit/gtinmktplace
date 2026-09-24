# ADR-0169 — Monitor de frete: alerta quando o frete de um anúncio sobe

**Status:** Aceito
**Data:** 2026-09-24
**Relacionado:** [ADR-0037](0037-modulo-faturamento-webhooks-ml.md) (vendas por webhook),
[ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md) (categorias),
[ADR-0085](0085-notificacao-in-app.md) (sino in-app), [ADR-0086](0086-configuracao-org-scoped.md)
(configuração por org), [ADR-0121](0121-cancelamento-tratado-tambem-pela-reconciliacao.md) (avalanche
de alerta sobre histórico), [ADR-0134](0134-alerta-de-estoque-zerado-e-volta-ao-ar.md) (padrão de alerta)
**Spec:** `docs/superpowers/specs/2026-09-24-monitor-de-frete-design.md`

## Contexto

O vendedor paga o frete das vendas com frete grátis (`ml_vendas.frete_vendedor`). O ML às vezes troca
as dimensões cadastradas por uma estimativa própria e o custo de um anúncio sobe sem aviso — o projeto já
pagou frete a maior por isso. Nada no app compara o frete entre vendas; a alta passa despercebida.
Iniciativa I6 do roadmap de melhorias (2026-09-21), escolhida pelo Diego em 2026-09-24.

## Decisão

1. **Detecção no `sync-venda`, no fim do handler** — única chamada. Backfill, reconciliação e
   `sync-devolucao` não chamam o monitor, então dado histórico nunca gera aviso em massa.
2. **Comparação só entre pedidos de 1 item e 1 unidade, fora de pack**, contra a venda anterior mais
   recente (por `coalesce(date_closed, date_created)`, desempate por `order_id`) do mesmo `ml_item_id` +
   `variation_id` na org. O frete é por pedido e, em pack, é o do envio repetido em cada pedido (ADR-0042);
   com mais itens não há atribuição honesta. A seleção é a função SQL `frete_venda_anterior`.
3. **Gatilho fixo:** atual − anterior ≥ R$ 2 **e** atual > anterior × 1,10. Frete 0 ou nulo em qualquer
   lado não compara (nulo = busca falhou; 0 = sem custo ao vendedor). Só vendas com até 3 dias.
4. **Liga/desliga por org:** `configuracoes.monitor_frete_ativo boolean not null default false`, editável
   por admin em Configurações > Notificações. Nasce desligado.
5. **Destinatários = assinantes de `financeiro`**, via `notificarCategoria` (Telegram + sino). Sem
   categoria nova, portanto sem mexer nos CHECKs de `notificacoes`/`profiles`.
6. **Dedup por `reservarNotificacao(orgId, 'frete_subiu', order_id)`** em `ml_notificacoes_enviadas`, o
   mesmo do aviso de venda paga. Sem coluna de marca nova.
7. **Best-effort e no fim:** roda depois de alerta de venda, baixa e cancelamento, com prazo total de 8 s;
   qualquer falha é logada e engolida — o registro da venda nunca cai nem atrasa por ele.

## Alternativas descartadas

- **Varredura agendada (cron horário):** pegaria vendas que só chegam pela reconciliação, mas exige função
  e cron novos, marca de "última rodada" e corte de data para não avisar o histórico. O ganho (webhook
  perdido) é pequeno: a próxima venda do mesmo anúncio mostra a mesma alta.
- **Categoria própria `frete`:** permitiria assinar só esse aviso, ao custo de migration nos dois CHECKs e
  nas duas listas espelhadas. Diego preferiu reusar `financeiro`.
- **Limite configurável:** campo a mais sem demanda; o limite fixo pode virar coluna se o volume real pedir.
- **Coluna de marca em `ml_vendas` (padrão ADR-0134):** redundante com `ml_notificacoes_enviadas`, que já
  resolve o dedup por chave.

## Consequências

- A tabela `configuracoes` tem grant de SELECT por coluna (`20260822131053`); a migration precisa
  conceder `select (monitor_frete_ativo)` a `authenticated`, senão o front não lê o switch.
- Deploy: `supabase db push` antes do deploy do `sync-venda`, e só então o merge (o front lê a coluna).
- Falso positivo possível quando o ML muda a regra de frete da conta (reputação, faixa de preço) — o aviso
  diz "possível causa" e o operador confere; se o volume incomodar, subir o limite.
- Pedidos com mais de 1 item ficam fora — alta que só aparece em carrinho não é detectada.
