# Design — Excluir lotes + Tela "Publicados" (status ao vivo)

**Data:** 2026-06-07
**Status:** aprovado no brainstorming, pendente de plano de implementação
**Branch:** `feat/excluir-lote-e-publicados`

## Problema

Dois buracos de operação no PubliAI, descobertos após muitos testes:

1. **Não há como excluir lotes.** O Dashboard acumulou lixo de testes (15 lotes, 54 famílias) e não existe ação de deletar — nem na UI nem com cascade controlado para o Storage.
2. **Não há visão consolidada do que está publicado no ML.** Os anúncios publicados (19 famílias, 3 fornecedores) ficam espalhados por vários lotes; falta um inventário com status ao vivo e filtros (ex.: por fornecedor).

## Restrição central (o cruzamento das duas features)

O `ingest-lote` decide CREATE vs UPDATE buscando famílias anteriores com `ml_item_id is not null` e casando por `codigo_pai` (herda `ml_item_id`). **O vínculo com o anúncio do ML vive nesse registro publicado.** Apagá-lo faria uma nova planilha do mesmo produto virar CREATE → **anúncio duplicado no ML**.

Decisão (vira ADR-0019): **a exclusão de lote nunca remove famílias publicadas.** Os registros publicados são a fonte de verdade do casamento de UPDATE *e* o conteúdo da tela "Publicados". O ML nunca é tocado pela exclusão (decisão do Diego: "quando quiser mexer no ML, subo nova planilha").

---

## Feature 1 — Excluir lote (preservando publicados)

### Comportamento

- Apaga as famílias **não publicadas** (`ml_item_id is null`) do lote → as variações somem por cascade (FK `variacoes.familia_id ON DELETE CASCADE`).
- Remove do **Storage** (bucket `imagens`) as imagens dessas famílias/variações: `variacoes.imagem_path`, `familias.capa_storage_path`, `familias.capa2_storage_path`. O cascade do banco **não** limpa o Storage — é manual.
- Famílias **publicadas sobrevivem**:
  - Se sobrar ≥ 1 família publicada → o lote permanece no Dashboard (mostrando só as publicadas).
  - Se **nenhuma** família sobrar → o lote inteiro é apagado (some do Dashboard).
- O ML **nunca** é chamado.

### UX

- Botão de lixeira no `LoteCard` (Dashboard).
- Diálogo de confirmação que mostra o que será apagado, ex.:
  > "Excluir lote #7? Serão removidas 4 famílias não publicadas e 9 imagens. 2 famílias publicadas serão preservadas (continuam no menu Publicados e no vínculo de UPDATE). O Mercado Livre não é tocado."
- Contagens (famílias não publicadas, imagens, famílias preservadas) calculadas antes de confirmar.

### Implementação

Edge function `excluir-lote` (verify_jwt **true** — chamada do front com JWT do operador):
1. Valida que o lote pertence ao usuário (`lotes.user_id = auth.uid`).
2. Coleta as famílias não publicadas do lote e seus paths de Storage (variações + capas).
3. Remove os arquivos do Storage (`storage.from('imagens').remove([...paths])`) — resiliente: falha em remover um arquivo não aborta a exclusão dos registros (loga e segue; arquivo órfão é inofensivo).
4. Deleta as famílias não publicadas (cascade nas variações).
5. Conta famílias restantes do lote; se 0 → deleta o lote.
6. Retorna `{ familias_removidas, imagens_removidas, familias_preservadas, lote_removido }`.

Por que edge function e não delete direto no front: envolve Storage + múltiplas tabelas + a regra "preservar publicado" — melhor num lugar único e testável, com a regra de negócio centralizada. Usa admin client mas valida ownership explicitamente.

### Função pura (TDD)

`particionarExclusao(familias)` → `{ paraExcluir: Familia[], preservadas: Familia[], pathsStorage: string[] }` — separa publicadas de não publicadas e junta os paths de Storage. Testável sem banco.

---

## Feature 2 — Tela "Publicados" (status ao vivo)

### Navegação

Novo item "Publicados" no menu do `AppShell` → rota `/publicados` (HashRouter, dentro do `ProtectedRoute`/`AppShell`).

### Dados

- **Nosso banco:** todas as famílias com `ml_item_id` (qualquer lote, do usuário): título, fornecedor, tipo_aviamento, preço de publicação (menor preço das variações incluídas), `ml_permalink`, `publicado_em`.
- **ML ao vivo:** edge function `status-publicados` (verify_jwt **true**):
  - Lê os `ml_item_id` publicados do usuário.
  - Batch `GET /items?ids=id1,id2,…&attributes=id,status,sub_status,available_quantity,price` (até 20 ids por chamada; pagina em blocos de 20).
  - **Cache no Redis** por item, TTL ~15 min (`pub:item:{id}` → status/estoque/preço). Botão "Atualizar" no front bypassa o cache (força refetch).
  - Resiliente: item 404 (anúncio excluído no ML) → status `indisponível`; falha geral do ML → linhas marcadas "status indisponível" sem quebrar a tela.
  - `getValidAccessToken` reaproveitado (refresh seguro com lock, ADR-0012).

### Tabela

| Coluna | Fonte |
|---|---|
| Título | banco |
| Fornecedor | banco |
| Tipo (linha/fita/botão) | banco |
| Preço publicado | banco |
| Estoque atual · Preço atual | ML ao vivo |
| Status (ativo / pausado / inativo / moderado + motivo do sub_status) | ML ao vivo (badge colorido) |
| Publicado em | banco |
| Ações | "Abrir no ML" (permalink) + "Remover do sistema" |

### Filtros

- Fornecedor (dropdown com os distintos), status (ativo/pausado/inativo/moderado/indisponível), tipo (linha/fita/botão), e busca por título. Filtragem client-side (volume pequeno — dezenas de itens).

### "Remover do sistema" (escape hatch)

Apaga só o registro daquela família publicada no nosso banco (não toca o ML), com aviso: "você perde o vínculo de UPDATE; o anúncio no ML continua". Para registros de teste já mortos no ML. Reaproveita a lógica de Storage da Feature 1 (remove imagens da família).

### Mapeamento de status do ML → badge

| ML `status` / `sub_status` | Badge | Cor |
|---|---|---|
| `active` | Ativo | verde |
| `paused` | Pausado | cinza |
| `closed` | Encerrado | cinza-escuro |
| `under_review` / `waiting_for_patch` (sub_status) | Em moderação (+ motivo) | âmbar |
| `inactive` | Inativo | vermelho |
| 404 / erro | Indisponível no ML | vermelho tracejado |

### Função pura (TDD)

- `parseStatusML(itemML)` → `{ status: StatusPublicado, motivo: string | null, estoque, preco }` — normaliza a resposta do `/items` no nosso modelo de badge.
- `filtrarPublicados(itens, { fornecedor, status, tipo, busca })` → lista filtrada (client-side, testável).

---

## Componentes e arquivos (estimativa)

**Backend (edge functions):**
- `excluir-lote/index.ts` (nova) + `_shared/lote/exclusao.ts` (`particionarExclusao`, puro, TDD).
- `status-publicados/index.ts` (nova) + `_shared/ml/status.ts` (`parseStatusML`, puro, TDD) + cache Redis.

**Frontend:**
- `LoteCard`: botão lixeira + diálogo de confirmação (`AlertDialog` shadcn) + hook `useExcluirLote`.
- `pages/Publicados.tsx` (nova) + rota no `App.tsx` + item no menu do `AppShell`.
- `lib/publicados.ts`: `filtrarPublicados` (puro) + adapters + `lib/queries` (fetch dos publicados).
- `hooks/usePublicados.ts` + `hooks/useStatusPublicados.ts` (TanStack Query, refetch manual).

**Sem migration nova** (usa colunas existentes). **Sem mudança de schema.**

## Tratamento de erros

- Exclusão: falha de Storage não bloqueia a exclusão dos registros (órfão inofensivo); falha de banco → erro claro na UI, nada apagado pela metade (deletes numa ordem segura).
- Status ao vivo: ML 404/erro → linha "indisponível", tela não quebra; cache Redis evita martelar a API; botão "Atualizar" para forçar.

## Testes

- `particionarExclusao`: publicadas preservadas, paths coletados, lote vazio vs com publicados.
- `parseStatusML`: cada status/sub_status → badge certo; 404/erro → indisponível.
- `filtrarPublicados`: cada filtro isolado + combinados + busca.
- Edge functions: idempotência/ownership validadas manualmente no bug bash (padrão do projeto).

## Fora de escopo (YAGNI)

- Métricas de desempenho (visitas/vendas) na tela Publicados — decidido começar enxuto (1 chamada batch).
- Encerrar/editar anúncio no ML a partir da tela — o ML só é mexido subindo nova planilha.
- Exclusão em massa de lotes — um a um por enquanto.

## ADR

- **ADR-0019** — Exclusão de lote preserva famílias publicadas (vínculo de UPDATE + inventário Publicados); ML nunca é tocado pela exclusão.
