# Spike 033 — Export do catálogo canônico (fechar o cano import→publicação)

**Status:** Spike / design — não implementado.
**Tipo:** Documento de investigação (Plan 033). Não substitui ADR; se aprovado para build, gera ADR próprio.
**Relaciona:** ADR-0021 (catálogo), ADR-0025 (modelo de dados multicanal, `anuncios_externos`), ADR-0056
(multi-tenancy), ADR-0065 (re-âncora de preço), ROADMAP E6 (orquestração multicanal), E6b (estoque único
cross-canal), E7 (multi-tenancy).

---

## 1. Problema / assimetria

O PubliAI hoje é **estritamente planilha-entra → anúncio-sai**. Existe fartura de builders que
**montam** o estado canônico de um anúncio para publicar (import → canal), mas nenhuma via de volta que
**exponha** esse estado canônico para o operador puxar de volta (canal/BD → arquivo/API).

Evidência no código:

- `supabase/functions/_shared/anuncios/montar-canonico.ts:52-124` — `montarAnuncioCanonico` monta o
  `AnuncioCanonico` (título, descrição, categoria, atributos, fotos, desconto, dimensões e o array de
  variações `{ sku, cor, estoque, preco, gtin, fotoId }` — linhas 119-122) a partir de `familias` +
  `variacoes`. É a peça central do fluxo de **saída para o canal** (CREATE/UPDATE ML). Não existe
  nenhum builder simétrico "canônico → planilha/CSV".
- `anuncios_externos` (ADR-0025) é a tabela pensada como catálogo agnóstico por canal — mas hoje é
  **write-only** pelo backend: `grep -rn anuncios_externos src/` retorna **zero** ocorrências no
  frontend. Os workers fazem dual-write (`familias`/`variacoes` como fonte de verdade + espelho em
  `anuncios_externos`), mas nada no produto lê esse espelho de volta para o operador — nem para exibir,
  nem para exportar.
- `ml_vendas` (`src/lib/faturamento.ts:69-78`) tem o histórico financeiro rico (pedidos, itens, líquido,
  frete, estorno) e já é lido e exportado hoje (Financeiro tem export Excel/PDF via
  `src/lib/export/index.ts:27-52` + `src/lib/export/excel.ts`). Ou seja: **o produto já sabe exportar**
  (relatório financeiro), só não exporta o **catálogo vivo** (preço, estoque, permalink, status por
  canal).
- ADR-0065 formalizou re-âncora de preço automática (`familias.preco_reancorado_lider`,
  `estrategia_motivo`) — o preço publicado pode divergir do que está na planilha original do operador,
  e hoje esse desvio só é visível dentro do produto (tela Revisão/Publicados), nunca em um arquivo que o
  operador possa levar para o ERP/planilha dele.

**Quem quer isso e por quê agora:** com **E7 (multi-tenancy)** cada organização passa a ter seu próprio
catálogo vivo isolado por `org_id`/RLS, e com **E6 (multicanal)** esse catálogo passa a ter estado por
canal (ML, Shopee, …). Nesse cenário o catálogo do PubliAI deixa de ser só "staging para publicar" e
vira **um ativo de primeira classe da organização** — preço efetivo, estoque, status por canal,
permalink — que a organização precisa reconciliar contra o próprio ERP/planilha de origem. Hoje isso só
é possível olhando a tela (Publicados) linha a linha; não há como levar o dado para fora do produto.

---

## 2. Inventário de campos — "linha de catálogo canônico"

Uma hipotética linha exportável, por família/produto, viria de 4 fontes:

| Campo | Tabela / origem | Referência |
|---|---|---|
| `codigo_pai` (identidade lógica do produto) | `familias.variacao_principal_codigo` / âncora `(user_id, codigo_pai)` | ADR-0025 |
| `titulo`, `descricao`, `categoria_ml_id`, `atributos_ml` | `familias` | `montar-canonico.ts:11-27` (`FamiliaParaMontar`) |
| `capa_ml_picture_id` / `capa2`/`capa3` (fotos já publicadas) | `familias` | `montar-canonico.ts:19-23` |
| `exibir_com_desconto`, `desconto_pct` (efetivo) | `familias` + `configuracoes.desconto_pct` (fallback 15) | `montar-canonico.ts:60-67` |
| `preco_reancorado_lider`, `estrategia_motivo` (preço divergiu do sugerido original) | `familias` | ADR-0065 |
| `sku` (código), `cor`, `estoque`, `preco_publicacao`, `gtin` | `variacoes` | `montar-canonico.ts:29-42`, `119-122` |
| dimensões/peso (variação representativa) | `variacoes` (`altura_cm`, `largura_cm`, `comprimento_cm`, `peso_gramas`) | `montar-canonico.ts:100-106` |
| `item_externo_id`, `permalink`, `status`, `erro_mensagem`, `variacoes_externas` (mapa sku→variation_id/catalog_*) | `anuncios_externos` (espelho por canal, hoje write-only) | ADR-0025 |
| histórico de vendas (unidades vendidas, receita, última venda) — **opcional**, fora do MVP do export | `ml_vendas` + `ml_vendas_itens` | `src/lib/faturamento.ts:10-78` |

Hoje a tela Publicados (`src/lib/publicados.ts:29-33`) já materializa boa parte disso em memória (canal,
status, estoque) via merge com "status ao vivo" — é o candidato natural de reaproveitar como shape de
saída, em vez de inventar um novo.

---

## 3. De-conflito com E6b (estoque único cross-canal)

**Risco de duplicar trabalho:** ROADMAP (`docs/ROADMAP.md:272`) já tem **E6b — Estoque único
cross-canal** planejado dentro da Fase 2, e ADR-0025 já decidiu (seção "Questões em aberto") que
**estoque por canal fica em `variacoes` (estoque único)** até a Shopee entrar, quando means um campo
aditivo em `anuncios_externos`.

Isso é um domínio **diferente** deste spike, mas com superfície de dados sobreposta (`estoque`,
`anuncios_externos`). Fronteira explícita:

| | **Este spike (read-export)** | **E6b (estoque único)** |
|---|---|---|
| Direção do dado | **Sai** do PubliAI (canal/BD → operador) | **Circula entre canais** (ML vende → baixa em Shopee e vice-versa) |
| O que resolve | Operador não tem visibilidade externa do catálogo vivo | Vender em um canal sem sincronizar estoque no outro = overselling |
| Escrita? | **Read-only** — nenhuma escrita em `variacoes`/`anuncios_externos` | Escreve `variacoes.estoque` (ou coluna aditiva em `anuncios_externos`) a cada venda |
| Trigger | On-demand (botão) ou agendado, iniciado pelo operador | Reativo a eventos de venda (webhook ML/Shopee) |
| Depende do outro? | Não bloqueia E6b — pode nascer antes, lendo `estoque` como está hoje | Quando E6b rodar, o export só passa a refletir o estoque já reconciliado — **nenhuma mudança de schema exigida deste lado** |

**Regra de não-duplicação:** este spike **não implementa nem propõe** lógica de sincronização de
estoque. Ele só **lê** o estado que existir em `variacoes`/`anuncios_externos` no momento do export,
seja esse estado pré ou pós-E6b. Se o build deste spike for priorizado antes do E6b, o campo "estoque"
exportado é simplesmente o `variacoes.estoque` de hoje (por-produto, não por-canal) — consistente com o
que a UI já mostra. Nenhum retrabalho é esperado quando o E6b rodar depois: o export lê a mesma coluna,
só que o valor passa a ser mantido por um processo mais sofisticado.

---

## 4. Opções de design

### 4.1 Formato de saída
- **CSV re-download** (recomendado para v1) — espelha o formato de entrada (a planilha de import já é
  CSV/planilha, ADR de domínio); operador reimporta mentalmente contra a mesma estrutura que subiu.
  Reaproveita o padrão já existente de export (`src/lib/export/index.ts`, `excel.ts`) — trocar o
  gerador de PDF/Excel por um `gerarCsv` do mesmo shape de dados já é o caminho de menor esforço.
- **Read-API (endpoint JSON paginado)** — necessário se o objetivo for reconciliação automatizada
  contra o ERP do cliente (E7 pensa em integrações third-party). Mais esforço (contrato de API,
  versionamento, auth de API key em vez de sessão de usuário).
- Não são excludentes: CSV é a v1 pragmática; API é evolução natural quando houver 2º consumidor
  (integração ERP) além do próprio operador.

### 4.2 Auth / escopo por organização
- Multi-tenant (E7) já trouxe `requireUserOrg` (`supabase/functions/_shared/auth.ts:36-47`) — resolve
  `orgId` a partir do JWT + `profiles.org_id`, 403 se perfil inativo/sem org. Um endpoint de export
  reusa esse helper diretamente; RLS por `user_id`/`org_id` já é regra inegociável do projeto
  (CLAUDE.md) e `anuncios_externos` já nasceu com RLS por `user_id` (ADR-0025).
- Nenhum novo modelo de auth é necessário — é o mesmo padrão de qualquer edge function autenticada do
  projeto.

### 4.3 Paginação
- `src/lib/paginacao-supabase.ts` (`buscarTodasPaginas`) já existe e é usado por `custos.ts` e
  `faturamento.ts` para não truncar no teto de ~1000 linhas do PostgREST (`.range`). O export do
  catálogo é o 3º consumidor natural do mesmo helper — nenhuma paginação nova a desenhar.
- Do lado Edge Function (Deno), `supabase/functions/_shared/faturamento/io.ts:36` já documenta um
  equivalente server-side — reusar o mesmo padrão em vez de reinventar.

### 4.4 On-demand vs. agendado
- **On-demand (recomendado para v1)** — botão "Exportar catálogo" na tela Publicados, mesmo padrão do
  botão de export já existente em Financeiro. Zero infra nova (sem QStash, sem schedule).
- **Agendado** (ex.: export diário para um bucket/e-mail) é claramente E9-adjacente ("Operação SaaS") —
  não faz sentido antes de existir um 2º consumidor recorrente do dado. Não é v1.

---

## 5. Questões em aberto para o operador (Diego)

1. **Formato:** CSV é suficiente para v1, ou já nasce como endpoint JSON (pensando em integração ERP de
   algum cliente do E7)?
2. **Escopo vs. E6b:** confirma que o campo "estoque" exportado antes do E6b é o `variacoes.estoque`
   atual (por-produto), sem esperar o estoque único cross-canal para começar a exportar?
3. **Trigger:** só botão manual (Publicados) é suficiente, ou já existe um cliente que precisa de
   agendamento/API recorrente?
4. **Escopo de canal:** exporta por canal (uma linha por `anuncios_externos` = produto×canal) ou uma
   linha por produto com colunas repetidas por canal quando o E6 (multicanal) estiver ativo? Hoje só há
   1 canal (ML) em produção, então a decisão pode ser adiada até o 2º canal existir de fato.
5. **Escopo de vendas:** o export inclui histórico de vendas (`ml_vendas`) ou fica restrito ao estado
   atual do catálogo (preço/estoque/status/permalink)? Financeiro já cobre vendas — incluir aqui seria
   redundante a menos que o caso de uso peça uma "foto única" consolidada.

---

## 6. Estimativa de escopo

**Este documento é o spike — não é o plano de build.** Estimativa grosseira para o build, condicionado
às respostas da seção 5:

- **Esforço: L** (spike/design já feito; build = 1 edge function ou 1 função de client-side export +
  reaproveitar `buscarTodasPaginas` + reaproveitar padrão de export CSV/Excel + testes).
- **Não construir às cegas.** Antes de qualquer código: (a) resolver as questões abertas com o operador,
  (b) de-conflitar explicitamente com o momento do E6b (se E6b estiver em andamento quando este spike for
  priorizado, sincronizar para não escrever contra um schema de estoque que está mudando sob os pés), (c)
  decidir CSV-first vs. API-first antes de commitar a um contrato.
- Se aprovado para build: vira ADR próprio (schema/contrato de saída) antes da implementação, por regra
  do projeto (CLAUDE.md — "decisão nova e não-trivial → ADR antes da implementação").
