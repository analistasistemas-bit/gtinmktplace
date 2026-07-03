---
tags: [logs, changelog]
atualizado: 2026-07-03
---

# Changelog

Linha do tempo real, não redigida. Fonte: `docs/project-history.md` (curado até 2026-06-15) +
`docs/project-status.md` (snapshot mais recente) + histórico de commits na `main`. Ver
[[Sprint Atual]], [[Problemas Resolvidos]].

## 2026-07-03

- **Markup consistente entre telas (imposto — ADR-0055):** o Detalhe de vendas (Publicados) calculava
  markup/lucro por produto **sem descontar imposto**, então mostrava +65% enquanto o KPI mostrava +27%
  para o mesmo período. `montarDetalheVendas` (`detalhe-vendas.ts`) passou a receber `aliquotaResolver`
  e descontar o imposto do líquido — `(Σ líquido − Σ imposto − Σ custo)/Σ custo`, idêntico a
  `calcularResumo`/`pedidos-faturamento`. `DetalheVendas.tsx` passa o resolver (`useAliquotas`). Validado
  com dados reais: Dashboard, Publicados, Detalhe de vendas, Faturamento e Financeiro agora mostram o
  MESMO markup (+27%). Frontend-only (markup é derivado, sem escrita no banco).
- **Fix comissão por quantidade (pedidos qtd>1):** `sale_fee` do ML é tarifa **por unidade**, mas
  `mapearPedidoParaVenda` somava sem `× quantity` → `sale_fee_total`/`liquido` inflados em pedidos
  com mais de 1 unidade (o líquido do PubliAI aparecia maior que o "Total" real do ML — ex.: fita
  3 un mostrava R$ 17,35 vs R$ 13,23 no ML). Corrigido em `_shared/faturamento/venda.ts` e
  `_shared/ml/pedidos.ts` (rateio do Financeiro). Redeploy: `backfill-faturamento`,
  `reconciliar-faturamento`, `ml-webhook`, `sync-venda`, `resumo-financeiro`. Re-backfill de
  produção: 34 vendas recalculadas (comissão subestimada somava R$ 178,21). Afeta Faturamento,
  Publicados (detalhe de vendas), Financeiro e todos os KPIs de líquido/markup/lucro.
- Imposto por origem (nacional/importado) no preço e markup (ADR-0055): planilha ganha coluna
  `ORIGEM` (opcional, lida da linha PAI → `familias.origem`, enum `origem_produto`); alíquotas
  parametrizáveis em Configurações (nacional 8% / importado 16%, por usuário). Imposto =
  `preço × alíquota` descontado do líquido em "Você recebe", "Vale a pena" e markup em todas as
  telas (análise de publicação, viabilidade item-a-item, faturamento pós-venda); gross-up do
  preço sugerido passa a `÷(1 − comissão% − alíquota%)`. Migration + edge functions
  (`process-familia`, `analisar-viabilidade`, `ingest-lote`) deployadas. Planilha "Geral
  Publicado" aplicada: 217 custos corrigidos, 57 famílias marcadas importado.
- Imposto visível no Faturamento (ADR-0055): campo **Imposto** no cabeçalho do detalhe do pedido
  (ao lado de Comissão ML / Frete vendedor; compartilhado com o Detalhe do líquido no Financeiro)
  e no sub do KPI "Lucro líquido no período". `imposto` exposto em `ResumoVendas`. Não entra em
  "Taxas e frete (ML)"/"Líquido você recebe" (retenção do ML, não tributo do vendedor).
- Link para o anúncio no ML em Publicados → Detalhe de vendas: botão discreto ↗ ML por produto
  (seção "Seus anúncios (PubliAI)"), padrão do Publicados. URL construída do `ml_item_id`
  (`produto.mercadolivre.com.br/MLB-<id>`) — cobre 100%, inclusive vendas cujo item foi
  republicado e não está mais em `familias`.
- Fix: ordenação das tabelas "Ao vivo" não persistia. O `sort` vivia em `useState` local, que
  era zerado a cada remount — trocar de aba no Faturamento (Radix `TabsContent` desmonta a aba
  inativa) ou sair/voltar de um detalhe. Novo hook `useSessionState` (persiste em
  `sessionStorage`) substitui os 3 `useState<Sort>` (aba-vendas, Detalhe do líquido, Detalhe de
  vendas — chave por seção). Auto-refresh de 45s segue ativo; a ordenação escolhida agora
  sobrevive a remount e refetch. Validado no app real (browser-use).

## 2026-07-02

- Fix categoria/título — tipo de produto genérico via IA (lote #50, ADR-0054): categoria "Outros"
  nunca mais é resposta final automática; busca de categoria no ML roda com nome bruto + query
  limpa (`tipo_produto_busca`, extraída pelo copywriter); IA de desempate pode abster-se
  deliberadamente; título ganha o tipo de produto quando ausente do nome. Deployado em
  `process-familia`, `regenerar-copy-familia`, `publicar-split-ml`.

## 2026-06-29

- Split de produto em N anúncios para produtos com >100 cores (ADR-0048)
- Cor nova com foto+estoque entra marcada por padrão no UPDATE (opt-out)

## 2026-06-28

- Multiusuário com permissão de menu (ADR-0047) — operação compartilhada, fase pré-`E7`
- Divergência de `verify_jwt` confirmada em produção via logs (ver [[Bugs Conhecidos]])

## 2026-06-25 a 2026-06-27

- Líquido econômico correto (ADR-0042) — corrige markup falso de cross-docking/pack
- Colisão de numeração de ADRs resolvida (0035→0044, 0037→0045)
- Correções de segurança: migração SheetJS (CVE), `notificar-liberacao` autenticada,
  `telegram_config_status()` revogada de anon

## 2026-06-22 a 2026-06-23

- Módulo Financeiro impecável (ADR-0040) — implementado, pendente validação/deploy
- Monitoramento de anúncios moderados (ADR-0035)
- Cor no título de anúncios mono-cor, anti-duplicado (ADR-0044)
- Módulo Faturamento — webhooks ML (ADR-0037)

## 2026-06-14

- `E1`/`E1b` — camada de abstração de canais (CREATE + UPDATE + status)
- `E2` — modelo multicanal `anuncios_externos`
- `E3` — categoria genérica por preditor/LLM
- `E4` — atributos obrigatórios por IA closed-set

## Correções recentes (commits na `main`, sem data de doc)

GTIN de comprimento inválido tratado como ausente; Fabricante preenchido na categoria genérica;
cor/metragem separada corrigida; comprador real nas vendas (Faturamento). Ver
[[Problemas Resolvidos]] para o detalhe completo.

## Histórico anterior (M0–M4, 2026-05-26 a 2026-06-15)

Ver `docs/project-history.md` para a linha do tempo curada dos marcos M0 a M4 e a reauditoria
E1–E4. Ver também [[Releases]] para os marcos por milestone.
