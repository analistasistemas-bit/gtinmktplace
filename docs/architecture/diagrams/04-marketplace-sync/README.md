# 04 · Fluxo de Sincronização com Marketplaces

**Tipo Archify:** `workflow` · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** a sincronização com o Mercado Livre tem 3 fontes independentes — webhook em tempo real, reconciliação horária e monitoramento periódico de moderação — todas convergindo para o mesmo estado no banco.
- **Público:** novo desenvolvedor, arquiteto.
- **Elementos:** Evento ML, ml-webhook, Dedup, Worker, Atualiza banco, Telegram, Reconciliação, Monitoramento.
- **Relações:** caminho principal (webhook→dedup→worker→banco→alerta) + 2 fontes paralelas (reconciliação, monitoramento) que também alimentam banco/alerta.
- **Direção de leitura:** esquerda→direita para o caminho principal; lane inferior = processos agendados, independentes do webhook.
- **Omitido:** o fluxo de publicação (sentido contrário) — ver [03](../03-publication-flow/); detalhes de cada tabela (`ml_vendas`, `ml_perguntas`, etc.) — ver [05](../05-simplified-data-model/).
- **Fontes principais:** `docs/explanation/arquitetura.md` ("Autenticação e fronteiras de confiança"); `docs/reference/modelo-de-dados.md` (`ml_webhook_eventos`, módulos de Faturamento/Monitoramento); `docs/diagrams/seq-faturamento.drawio` (versão anterior).

## O que mostra

Como o PubliAI fica sincronizado com o que acontece no Mercado Livre depois da publicação: eventos chegam por webhook (pedido, pergunta, devolução, moderação), passam por dedup e são processados por um worker que rebusca o dado autenticado (nunca confia no corpo do webhook). Duas rotinas agendadas cobrem o que o webhook sozinho não garante: reconciliação horária (corrige divergência) e monitoramento periódico de anúncios moderados.

## Como ler

Caminho principal: Evento ML → ml-webhook (ACK rápido + valida assinatura) → Dedup (evita reprocessar) → Worker (rebusca autenticado) → Atualiza banco → Telegram (se a categoria tiver assinante). A lane inferior mostra as 2 rotinas agendadas que alimentam o mesmo banco/alertas sem depender de webhook.

## Fontes

- `docs/explanation/arquitetura.md` (seção "Autenticação e fronteiras de confiança" — "nunca confia no corpo do webhook")
- `docs/reference/modelo-de-dados.md` (`ml_webhook_eventos`, `ml_vendas`, `ml_perguntas`, `ml_devolucoes`, `ml_moderacao`)
- `docs/decisions/` ADR-0037 (módulo Faturamento/webhooks), ADR-0035 (monitoramento de moderação), ADR-0069 (categorias de notificação Telegram)
- `docs/diagrams/seq-faturamento.drawio` — versão anterior (drawio), cobre só o caminho do webhook de faturamento

## Limitações

- Simplifica 4 tipos de evento (pedido, pergunta, devolução, moderação) em 1 nó "Evento ML" — cada um tem sua própria tabela e worker de detalhe.
- Não representa o throttle por vendedor (janela de 60s) nem o caso especial de `messages` (que apaga a linha de dedup em vez de só marcar processado).
- "Alerta Telegram" só dispara se a categoria do evento tiver ao menos 1 assinante configurado (`profiles.telegram_categorias`) — não representado como condição explícita no diagrama.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** um novo tipo de webhook for adicionado; a estratégia de reconciliação mudar; um 2º canal passar a emitir webhooks próprios.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate workflow <caminho>/diagram.workflow.json --json
  node bin/archify.mjs render workflow <caminho>/diagram.workflow.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
