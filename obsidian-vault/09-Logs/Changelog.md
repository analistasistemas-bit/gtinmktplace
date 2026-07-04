---
tags: [logs, changelog]
atualizado: 2026-07-04
---

# Changelog

Linha do tempo real, não redigida. Fonte: `docs/project-history.md` (curado até 2026-06-15) +
`docs/project-status.md` (snapshot mais recente) + histórico de commits na `main`. Ver
[[Sprint Atual]], [[Problemas Resolvidos]].

## 2026-07-04

- **Feat: categoria de seleção livre + "Outros" como fallback visível (ADR-0057/0058).** Famílias
  fora dos 4 tipos de aviamento conhecidos (linha/fita/botão/cola) ficavam travadas pra sempre em
  "Categoria indefinida" — pendência aberta desde o ADR-0022 (11/06), nunca fechada; caso real:
  "BAINHA INSTANTÂNEA 4MT UND" (lote 51). `CardCategoria` troca o seletor fixo de 4 opções por
  busca livre no `domain_discovery` do ML (`buscarCategoriaPreditor`, já existia); `definir-categoria-familia`
  generaliza o contrato pra `{categoria_ml_id, categoria_nome}` (quebra intencional do contrato
  antigo — app de deploy único, sem consumidor externo); `resolverAtributosGenericos` extraído do
  `process-familia` pra reuso sem duplicar lógica entre o fluxo automático e o manual. Categoria do
  concorrente (já calculada, antes descartada) vira sugestão clicável **não-vinculante** — nunca
  aplicada sem clique explícito (travado por teste de regressão específico, ADR-0054: validado ao
  vivo que a categoria do concorrente pra bainha é "Brinquedos de Pegadinhas", colisão de catálogo).
  ADR-0058 (mesmo dia, a pedido do Diego): quando o preditor só acha candidatos genéricos
  ("Outros"), a família deixa de travar — aplica o genérico como fallback visível (`tipo_origem='generico'`,
  selo de aviso na Revisão), busca continua disponível pra trocar; revisão humana antes de publicar
  segue obrigatória (regra inalterada). `process-familia` não mudou (branch já era baseado em
  categoria/tipo, não em origem). Migrations aditivas (`concorrencia_categoria_id`, enum
  `tipo_origem` + `'generico'`); 1165 testes verdes; validado no app real (browser-use):
  reprocessamento ao vivo confirmou busca funcionando com candidatos reais do ML e a sugestão do
  concorrente aparecendo corretamente como não-aplicável sozinha.

- **Feat: pausar/reativar anúncio publicado no Mercado Livre (ADR-0060).** Novo 3º ícone na linha
  da tela Publicados (`Pause`/`Play`), restrito a **admin** — primeira ação de escrita do projeto
  gated por `profiles.is_admin`, não só por membro autenticado da operação. `ChannelConnector`
  ganha `atualizarStatus` (contrato multicanal, ADR-0024), implementado no conector ML via
  `PUT /items/{id}` com `{status}`; nova edge function `atualizar-status-publicado`
  (`requireAdmin` + token da operação, mesmo padrão do `status-publicados`/ADR-0056).
  Confirmação (`AlertDialog`) só ao pausar; reativar é direto. Sem persistência local de status —
  a ação invalida o cache de status ao vivo (`QK.statusPublicados`), forçando reconsulta real no
  ML. Validado end-to-end no browser contra o Mercado Livre real: pausou e reativou um anúncio de
  baixo risco (zero vendas no período), terminou como "Ativo". Deploy da função nova via CLI
  (v1, ACTIVE) durante a implementação; redeploy completo das demais funções afetadas (mesmos
  `_shared` importados, comportamento inalterado) feito no fechamento da branch.

## 2026-07-03

- **Fix: linha expandida "para detalhar" recolhia ao trocar de tela/aba ou no refetch.** Mesma
  causa do fix de ordenação (`62eeeba`): o `aberto` vivia em `useState` local por linha, zerado a
  cada remount (troca de aba no Faturamento desmonta o `TabsContent`; sair/voltar de um detalhe;
  refetch de 45s remonta as linhas; ordenar/filtrar/paginar reordena e remonta). Trocado por
  `useSessionState` (o hook do fix de sort) com chave estável por linha em: **aba-vendas**
  (`expand:faturamento-vendas:${chave}`), **DetalheFinanceiro** (`expand:detalhe-financeiro:${chave}`),
  **Publicados** (`expand:publicados:${familiaId}`). **Revisão** tinha o estado num `Set` no nível da
  página (zerava ao sair/voltar): virou `useSessionState<string[]>('expand:revisao', [])` (array
  porque sessionStorage é JSON e `Set` não serializa). A expansão escolhida sobrevive a remount e
  refetch; limpa ao fechar a aba do browser. Teste `Publicados.test.tsx` passou a limpar
  `sessionStorage` no `beforeEach` (expansão persistente vazava entre casos). Frontend-only.
- **Feat: coluna "Taxas" no Detalhe de vendas (Publicados › `/publicados/vendas`)** com balão no
  hover (Tooltip shadcn) abrindo o breakdown **comissão + frete + imposto**. Taxas por produto =
  `valor − líquido + imposto`; comissão real (`Σ sale_fee × qtd`), frete como resíduo do retido
  (mesma filosofia do `resumo-vendas.ts`), imposto por origem (ADR-0055). Mantém o invariante
  `valor − taxas − custo = lucro` já exibido. Motivo: item barato/pesado (ex.: COLA 1KG) mostrava
  markup ~7% e não ficava óbvio que ~52% do faturamento ia em taxas+frete. `detalhe-vendas.ts` +
  `DetalheVendas.tsx` + teste do invariante. Não é decisão nova (ADR não necessário).
- **Fix: catálogo truncado em 1000 linhas quebrava casamento por GTIN (Fora do PubliAI sem
  código/EAN):** `carregarCatalogo` (`_shared/faturamento/io.ts`) lia `variacoes` **sem paginação** —
  contas com >1000 variações (esta conta tem 1505) tinham o corte padrão do PostgREST (~1000 linhas
  sem `ORDER BY`), então produtos fora dessa fatia arbitrária nunca entravam no mapa `infoPorGtin`.
  Vendas de catálogo desses produtos ficavam permanentemente em "Fora do PubliAI" sem código/EAN,
  mesmo cadastrados há semanas — não era timing nem deploy desatualizado, era truncamento silencioso
  (mesma classe de bug que `buscarTodasPaginas` já resolve no frontend, `custos.ts`). Confirmado no
  banco: 0 de 43 itens "Fora" tinham código em toda a história (desde 2026-06-06), apesar do GTIN
  bater com `variacoes` cadastradas em junho. Corrigido com `paginarTudo` (paginação por `.range()`,
  igual ao `buscarTodasPaginas` do frontend) em `carregarCatalogo`, tanto para `familias` quanto
  `variacoes`. Redeploy: `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`, `ml-webhook`
  (todas importam `_shared/faturamento/io.ts`).
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
- **Campo de busca no Detalhe de vendas** (Publicados › `/publicados/vendas`): filtro por
  título/código/EAN nas duas seções (mesmo padrão do `Input` de Publicados). Subtotal do rodapé
  recalculado a partir das linhas filtradas quando há busca ativa (evita mostrar o total da seção
  inteira ao lado de 1-2 linhas exibidas); mensagem própria para "sem resultado" vs "sem vendas no
  período". `DetalheVendas.tsx`. Frontend-only.

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
