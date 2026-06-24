# Menu Financeiro impecável — caixa, lucro, evolução, comparativo e notificação de liberação

**Data:** 2026-06-23
**Status:** Aprovado (design) — branch `worktree-financeiro-impecavel`
**ADR relacionado:** novo `0040` (a escrever) · evolui ADR-0031 (MP) e ADR-0038 (fonte única `ml_vendas`)

## Problema

O menu Faturamento ficou completo (vendas pedido-a-pedido + devoluções + perguntas num lugar só).
O menu **Financeiro** precisa do mesmo tratamento: ser o lugar onde o operador encontra **tudo
sobre o dinheiro gerado pelas vendas** — consolidado, confiável e acionável. Hoje ele é uma tela
enxuta (KPIs do realizado + link para o detalhe do líquido), faltando: visão de caixa (quando o
dinheiro cai), lucro/margem absolutos, breakdown de taxas, evolução temporal, comparação entre
períodos, período personalizado, exportação e uma notificação de liberação no Telegram.

## Princípios e limites (o que NÃO fazer)

- **Faturamento ≠ Financeiro.** Pedidos, devoluções e perguntas continuam no Faturamento. O
  Financeiro é só dinheiro consolidado. Nada de abas operacionais aqui.
- **Sem "A receber" estilo app do MP.** O ADR-0031 provou que somar `net_received_amount` por
  `money_release_date` **diverge** do app (retenção/reserva oculta). A faixa de Caixa é enquadrada
  como *"liberação dos recebimentos destas vendas"*, **não** como saldo a receber do MP.
- **Sem saldo disponível** (endpoint `/balance` do MP dá 403).
- **Sem provisão de imposto/DAS** — exigiria alíquota/regime que o sistema não tem; seria inventar
  dado. Fora de escopo.
- **Fonte única `ml_vendas`** (ADR-0038): todos os KPIs derivam da mesma tabela, então batem com
  Faturamento e Publicados. Nada de leitura ao vivo de MP/ML no caminho dos KPIs.

## Arquitetura geral

Abordagem escolhida (A): tudo nas telas existentes `Financeiro.tsx` e `DetalheFinanceiro.tsx`
(sem virar telas com abas) + 1 edge isolada para o Telegram. Mantém a identidade enxuta do menu.

Os KPIs novos são **derivados client-side** de `ml_vendas` (já carregada por `useResumoVendas`),
estendendo o agregador puro `src/lib/resumo-vendas.ts` (TDD). Única mudança de schema: 1 coluna
para idempotência da notificação.

---

## Entregas

### 1. Período personalizado (`Financeiro.tsx`)

A camada de dados já suporta intervalo livre: `metricas.ts` tem `Periodo = {tipo:'preset'} |
{tipo:'range', desde, ate}`, e `resolverJanela`/`periodoToParams`/`periodoFromParams` já tratam.
O `DetalheFinanceiro` já lê `range` da URL. Falta só a UI na tela principal.

- Trocar o seletor fixo (7/30/90) por: presets **+ "Personalizado"** com date-range picker.
- `Financeiro.tsx` passa a usar `Periodo` (preset|range) no lugar do `PeriodoDias` fixo.
- O link para o detalhe carrega o período escolhido (já via `periodoToParams`), inclusive o range.
- Date picker: componente shadcn (`Calendar` + `Popover`); se não houver, instalar via shadcn MCP.

### 2. Notificação Telegram de liberação (backend)

Nova edge **`notificar-liberacao`** (`verify_jwt=false` — chamada pelo QStash, ref. workers QStash):

- Diariamente, para cada usuário com `telegram_ativo`: busca `ml_vendas` com
  `money_release_date::date = hoje` **e** `liberacao_notificada_em IS NULL`; soma o líquido;
  envia *"💰 Hoje libera R$ X de N venda(s) no seu saldo Mercado Pago"*; marca as linhas.
- **Idempotência (regra inegociável):** nova coluna `ml_vendas.liberacao_notificada_em date`.
  Filtra o que ainda não foi notificado e marca após enviar. 1ª execução só pega o dia corrente
  (não spamma histórico). Reexecução no mesmo dia é no-op.
- Função pura `montarMensagemLiberacao(total, n, moeda)` em `_shared/notificacoes/telegram.ts`
  + teste (espelha `montarMensagemNovaVenda`). Reusa `enviarTelegram` e `lerConfigTelegram`.
- **Dependência operacional do Diego:** criar o **schedule diário no QStash** apontando para a
  edge (mesmo modelo pendente do Faturamento — ADR-0037). A edge fica pronta + comando/URL
  documentado; o agendamento é manual no painel/CLI do QStash.

### 3. Caixa: já liberado vs a liberar (`Financeiro.tsx`, faixa nova)

Derivado de `money_release_date` das vendas do período (per-linha é confiável; ver limites):

- **Já liberado** (verde): Σ líquido das vendas com `money_release_date ≤ agora`.
- **A liberar** (âmbar): Σ líquido com `money_release_date > agora` + *"próxima em DD/MM"*.
- Rótulo: *"liberação dos recebimentos destas vendas"* (não é o "A receber" do MP).

### 4. Breakdown de taxas — comissão vs frete (`Financeiro.tsx` / detalhe)

`ml_vendas` tem `sale_fee_total` (comissão ML) e `frete_vendedor` (frete) separados. O KPI
"Taxas e frete (ML)" passa a mostrar a quebra: *comissão R$ X · frete R$ Y*. Precedente visual:
`card-voce-recebe.tsx` e a aba de vendas do Faturamento já exibem "Comissão ML".

### 5. Gráfico de evolução temporal (`Financeiro.tsx`, faixa nova)

- recharts (`^3.8.1`, já instalado, primeiro uso no app): líquido por dia; agrupa por **semana**
  quando a janela > 31 dias para não poluir.
- Função pura nova `agruparPorPeriodo(vendas, janela)` → TDD.

### 6. Exportação CSV (`DetalheFinanceiro.tsx`)

Botão no header exporta as linhas **visíveis** (respeita ordenação e filtro), todas as colunas
(Código, Produto, Data, Liberação, status, Bruto, Retido, Líquido, Markup). Blob client-side,
sem backend. Nome do arquivo com o período.

### 7. Comparativo com período anterior (`Financeiro.tsx`)

Nos 4 KPIs-chave (líquido, bruto, lucro, vendas): seta ↑/↓ + % vs. período anterior de **mesma
duração** (ex.: 30 dias vs. os 30 dias imediatamente anteriores). Implica 2ª chamada de
`useResumoVendas` para a janela anterior, derivada da atual.

### 8. Lucro líquido (R$) + Margem (%) no topo (`Financeiro.tsx`)

O agregador já calcula `lucro`. Promover a KPI próprio destacado, com **margem** ao lado
(margem = lucro ÷ líquido; distinta do markup = lucro ÷ custo). Mostrar ambos.

### 9. Cobertura de custo (nota no KPI de lucro)

Sinalizar que lucro/markup/margem são **parciais**: *"sobre N de M vendas com custo"*. Estende o
agregador para expor `vendasComCusto` e `totalVendas`. Evita conclusão errada quando boa parte
das vendas não tem custo cadastrado.

### 10. Tratar retido negativo (`DetalheFinanceiro.tsx`)

Quando líquido > bruto (reembolso/crédito → "retido" negativo, ex.: -R$ 3,65), parar de pintar
vermelho-alarme: tom neutro + rótulo *"crédito"*. A linha de **prejuízo real** (markup negativo)
continua em vermelho — são casos distintos.

### 11. Limpeza do caminho morto do MP (etapa FINAL, pós-validação)

Só depois do Diego validar tudo e confirmarmos que não vamos precisar da ponte ao vivo com o
Mercado Pago: deletar `src/lib/financeiro.ts`, `src/hooks/useResumoFinanceiro.ts` e a edge
`resumo-financeiro/` (substituídos por `ml_vendas`/`useResumoVendas` no ADR-0038). **Não** mexer
antes da validação.

---

## Mudanças de dados

- **Migration única:** `ml_vendas.liberacao_notificada_em date` (nullable). Aplicar **antes** de
  deployar a edge `notificar-liberacao`.
- Nenhuma outra coluna nova: `sale_fee_total`, `frete_vendedor`, `money_release_date`, `liquido`,
  `estorno` já existem.

## Lógica pura a estender (TDD, vitest)

Em `src/lib/resumo-vendas.ts` (`ResumoVendas` + `calcularResumo`):

- `liberado`, `aLiberar` (Σ líquido por status de liberação), `proximaLiberacao` (data).
- `comissao` (Σ `sale_fee_total`), `frete` (Σ `frete_vendedor`).
- `vendasComCusto`, `totalVendas` (cobertura).
- `margem` (lucro ÷ líquido).
- Nova `agruparPorPeriodo(vendas, janela)` → série temporal para o gráfico.

Em `_shared/notificacoes/telegram.ts`: `montarMensagemLiberacao` (+ teste).

## Ordem de implementação (sugerida; detalhar no plano)

1. Lógica pura estendida + testes (sem UI) — caixa, breakdown, margem, cobertura, série.
2. Período personalizado na `Financeiro.tsx`.
3. Faixas novas (resultado/lucro+margem+comparativo, caixa, evolução).
4. Detalhe: CSV + filtro liberado/a liberar + retido negativo.
5. Backend Telegram: migration → função pura → edge → (Diego cria o schedule QStash).
6. ADR-0040.
7. (Pós-validação) limpeza do caminho morto do MP.

## Validação

- Lógica pura coberta por vitest (suíte atual ~780+ testes deve continuar verde).
- Validação visual light+dark (browser-use) das telas.
- Smoke da edge `notificar-liberacao` com dados reais (conta AVILBV) antes de agendar.
- Números de caixa/breakdown conferidos contra o detalhe e contra a tela do ML/MP.

## Riscos e ressalvas

- **A faixa de Caixa não é o "A receber" do MP** — rótulo precisa deixar isso explícito para não
  recriar a divergência do ADR-0031.
- **Schedule QStash é manual** (dependência do Diego) — sem ele, a notificação não dispara.
- **Cobertura de custo parcial** distorce lucro/margem se muitas vendas não têm custo — por isso a
  nota de cobertura é parte do escopo, não opcional.
- Single-tenant (`MP_ACCESS_TOKEN`/conta AVILBV) permanece; multi-tenant fica para o épico SaaS.
