# ADR-0040 — Menu Financeiro impecável: caixa, lucro/margem, evolução, comparativo e notificação de liberação

**Data:** 2026-06-23
**Status:** Aceito — implementado na branch `worktree-financeiro-impecavel` (pendente validação local + deploy)
**Contexto relacionado:** ADR-0031 (financeiro Mercado Pago), ADR-0038 (fonte única `ml_vendas`), ADR-0037 (módulo Faturamento / webhooks ML), spec `2026-06-23-financeiro-impecavel-design.md`.

## Contexto

O menu Faturamento virou o lugar único da operação de vendas (pedido a pedido + devoluções +
perguntas). O menu **Financeiro** ainda era uma tela enxuta — KPIs do realizado + link para o
detalhe do líquido — e faltava ser o lugar único do **dinheiro** das vendas. Pedido do operador
(Diego): deixá-lo "impecável", com visão de caixa, período personalizado e uma notificação no
Telegram quando o dinheiro do Mercado Pago é liberado.

Análise de especialista financeiro + leitura do código mostrou lacunas: sem visão de caixa
(quando o dinheiro cai), sem lucro/margem absolutos (só markup), taxas num bloco único (sem
comissão vs frete), sem evolução temporal, sem comparação entre períodos, sem período
personalizado, sem exportação. E uma dívida: o caminho ao vivo do Mercado Pago
(`lib/financeiro.ts`, `useResumoFinanceiro`, edge `resumo-financeiro`) virou **código morto**
depois do ADR-0038 (a tela passou a ler `ml_vendas` via `useResumoVendas`).

## Decisão

1. **KPIs derivados de `ml_vendas`** (fonte única, ADR-0038). O agregador puro `resumo-vendas.ts`
   ganhou, testado por vitest:
   - **Caixa:** `liberado` / `aLiberar` (Σ líquido por `money_release_date` ≤/> agora) +
     `proximaLiberacao`.
   - **Taxas separadas:** `comissao` (`sale_fee_total`) e `frete` (`frete_vendedor`).
   - **Resultado:** `lucro` (já existia) promovido a KPI + `margem` (lucro ÷ líquido) + cobertura
     (`vendasComCusto`/`totalVendas`).
   - **Série temporal:** `agruparPorPeriodo` (bruto/líquido por dia ou semana) para o gráfico.

2. **UI nas telas existentes** (sem virar abas): `Financeiro.tsx` ganha período personalizado
   (intervalo de datas — a camada `metricas.ts` já suportava `range`), faixa de caixa, lucro+margem,
   breakdown de taxas, comparativo com o período anterior (seta ↑/↓ vs. janela de mesma duração) e
   o gráfico de evolução (recharts, 1º uso no app, cores via tokens `oklch` p/ light+dark).
   `DetalheFinanceiro.tsx` ganha export CSV (respeita ordenação/filtro), filtro liberado/a liberar,
   rodapé filtro-aware ("Total" do conjunto visível) e tratamento do **retido negativo** como
   "crédito" (reembolso/estorno a favor — deixa de pintar vermelho-alarme).

3. **Notificação Telegram de liberação** (nova edge `notificar-liberacao`, pública/QStash): roda
   diariamente, soma o líquido das vendas cujo `money_release_date` cai **hoje em BRT** (timezone
   tratado explicitamente — a coluna é `timestamptz`) e ainda não notificadas, e avisa o operador.
   Reusa a infra de Telegram (`enviarTelegram`/`lerConfigTelegram`/`montarMensagemLiberacao`).

4. **Caixa NÃO é o "A receber" do Mercado Pago** (mantém ADR-0031). A Decisão 3 do ADR-0031 segue
   valendo para o **agregado**: somar `net_received_amount` por `money_release_date` diverge do app
   do MP (retenção/reserva oculta). O que exibimos é a **liberação dos recebimentos das vendas
   listadas** (por-linha, confiável), com rótulo explícito. Nunca rotulado como saldo a receber.

## Consequências

- **Positivas:** o Financeiro passa a consolidar caixa, lucro/margem, taxas detalhadas, evolução,
  comparação e exportação — tudo da mesma fonte que Faturamento/Publicados (números batem). A
  notificação de liberação dá ao operador o aviso que faltava (o dinheiro do MP libera ~1 mês
  depois da venda). Reaproveita padrões já existentes (agregador puro, edge + Telegram).
- **Idempotência:** a notificação marca `ml_vendas.liberacao_notificada_em` (coluna nova) para não
  reenviar; falha de marcação é logada (visibilidade contra reenvio silencioso).
- **Dívidas / pendências:**
  - **Schedule QStash é manual** (dependência do Diego) — sem ele a notificação não dispara.
    Igual ao pendente do ADR-0037.
  - **Single-tenant** (`MP_ACCESS_TOKEN`/conta AVILBV) permanece; multi-tenant fica para o épico SaaS.
  - **Cobertura de custo parcial** distorce lucro/margem se muitas vendas não têm custo cadastrado;
    por isso a nota de cobertura é parte do escopo, não opcional.
  - **Código morto do MP ao vivo** (`lib/financeiro.ts`, `useResumoFinanceiro`, edge
    `resumo-financeiro`) **não foi removido ainda** — decisão do Diego: deletar só após validar
    todo o módulo e confirmar que não vamos precisar da ponte ao vivo com o Mercado Pago.

## Sequência de deploy (ordem importa — pendente do Diego)

1. Aplicar a migration `20260623160000_ml_vendas_liberacao_notificada.sql` (cria a coluna)
   **antes** de deployar a edge — senão o UPDATE de marcação falha.
2. Deploy da edge: `supabase functions deploy notificar-liberacao --no-verify-jwt` (pública, igual
   à `ml-webhook`; este projeto não tem `config.toml`).
3. Smoke test (`curl -X POST .../functions/v1/notificar-liberacao`) na conta real — deve retornar
   `{ notificados, usuarios }` sem erro.
4. Criar o **schedule diário no QStash** (ex.: cron `0 12 * * *` UTC ≈ 09h BRT) apontando para a
   edge.
5. Deploy do frontend (Render) com o módulo Financeiro.

## Alternativas consideradas

- **Financeiro com abas (Resumo/Caixa/Evolução):** rejeitada — over-engineering para 9 KPIs + 1
  gráfico; quebra a identidade enxuta do menu.
- **Reproduzir "A receber"/calendário agregado:** rejeitada de novo (ADR-0031 — não reproduzível).
- **Notificação lendo o MP ao vivo:** rejeitada — `ml_vendas` já tem `money_release_date`; ler da
  tabela é mais rápido, resiliente e single-source.
