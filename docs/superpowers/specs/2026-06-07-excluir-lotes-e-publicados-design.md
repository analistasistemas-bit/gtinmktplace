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

- **Guarda de status (race com QStash):** a exclusão é **bloqueada** se `lote.status IN ('processando','publicando')` — há workers do QStash ativos (`process-familia`/`publish`/`update`) que tocariam famílias recém-deletadas. Mensagem: "Aguarde o processamento/publicação terminar antes de excluir." O botão lixeira fica **desabilitado** nesses status na UI. Lotes `importando` (sem famílias ainda) **podem** ser excluídos (limpa upload falho).
- Apaga as famílias **não publicadas** (`ml_item_id is null`) do lote → as variações somem por cascade (FK `variacoes.familia_id ON DELETE CASCADE`).
- **Storage (bucket `imagens`), limpeza manual** (o cascade do banco não limpa Storage). Regra segura para preservar arquivos das publicadas:
  - Coleta o conjunto de paths **referenciados pelas famílias publicadas sobreviventes** (`variacoes.imagem_path` + `capa_storage_path` + `capa2_storage_path`) → **preservar**.
  - Remove todos os demais arquivos do lote: `lotes.planilha_path` (a planilha .xlsx), os paths das variações/capas das famílias removidas, e os de `lotes.imagens_paths` **que não estejam no conjunto preservado**.
  - Se **nenhuma** família sobrar, remove o prefixo inteiro do lote no Storage (`{user_id}/{lote_id}/`) + `planilha_path`.
- **Contadores do lote:** o trigger `update_lote_counters` **não dispara em DELETE** (definido `after insert or update`). Então, se sobrar ≥ 1 família, a edge **reconta manualmente** e atualiza `total_familias`/`total_publicadas`/`total_erros` (senão o Dashboard/Progresso mostram contagem errada).
- **Status do lote após exclusão parcial:** se sobrar só publicadas, a edge recalcula o status do lote para `concluido` (não faz sentido manter `revisao` sem nada a revisar).
- Famílias **publicadas sobrevivem**:
  - Se sobrar ≥ 1 família publicada → o lote permanece no Dashboard (mostrando só as publicadas), com contadores e status recalculados.
  - Se **nenhuma** família sobrar → o lote inteiro é apagado (some do Dashboard).
- O ML **nunca** é chamado.

### UX

- Botão de lixeira no `LoteCard` (Dashboard).
- Diálogo de confirmação que mostra o que será apagado, ex.:
  > "Excluir lote #7? Serão removidas 4 famílias não publicadas e 9 imagens. 2 famílias publicadas serão preservadas (continuam no menu Publicados e no vínculo de UPDATE). O Mercado Livre não é tocado."
- Contagens (famílias não publicadas, imagens, famílias preservadas) calculadas antes de confirmar.

### Implementação

Edge function `excluir-lote` (verify_jwt **true** — chamada do front com JWT do operador):
1. Valida que o lote pertence ao usuário (`lotes.user_id = auth.uid`) **e** que `lote.status NOT IN ('processando','publicando')` (guarda de race).
2. Carrega as famílias do lote (publicadas e não publicadas) + suas variações/capas; `particionarExclusao` separa em `paraExcluir`/`preservadas` e calcula `pathsRemover` (todos os paths das removidas + `planilha_path` + `imagens_paths`) **menos** `pathsPreservar` (paths das publicadas sobreviventes).
3. Remove os arquivos do Storage (`storage.from('imagens').remove(pathsRemover)`) — resiliente: falha em remover um arquivo não aborta a exclusão dos registros (loga e segue; arquivo órfão é inofensivo).
4. Deleta as famílias não publicadas (cascade nas variações).
5. Se **0** famílias restantes → deleta o lote. Senão → **reconta** `total_familias`/`total_publicadas`/`total_erros` e seta `status='concluido'` (o trigger não cobre DELETE).
6. Retorna `{ familias_removidas, imagens_removidas, familias_preservadas, lote_removido }`.

Por que edge function (admin client) e não delete direto no front via RLS: envolve **Storage com service role**, múltiplas tabelas, recontagem manual e a regra "preservar publicado" — melhor num lugar único e testável, com a regra de negócio centralizada. Valida ownership + status explicitamente antes de qualquer escrita. (Há policies de DELETE por `user_id`, mas a operação composta — Storage + recontagem + preservação — justifica o admin client.)

**Nota sobre "Sem migration nova":** mantém-se verdadeira — a recontagem dos contadores é feita na própria edge (opção (b) da revisão), evitando uma migration que adicionasse `OR DELETE` ao trigger.

### Função pura (TDD)

`particionarExclusao({ familias, planilhaPath, imagensPaths })` → `{ paraExcluir, preservadas, pathsRemover, pathsPreservar, loteVazio }`:
- separa publicadas (`ml_item_id != null`) de não publicadas;
- `pathsPreservar` = paths referenciados pelas publicadas (variações + capas);
- `pathsRemover` = (paths das removidas + `planilhaPath` + `imagensPaths`) **menos** `pathsPreservar` (dedup);
- `loteVazio` = não há publicadas (→ lote inteiro removível + prefixo do Storage).
Testável sem banco (a edge só fornece os dados).

---

## Feature 2 — Tela "Publicados" (status ao vivo)

### Navegação

Novo item "Publicados" no menu do `AppShell` → rota `/publicados` (HashRouter, dentro do `ProtectedRoute`/`AppShell`).

### Dados

- **Nosso banco:** todas as famílias com `ml_item_id` (qualquer lote, do usuário), via um **tipo e query dedicados** (`PublicadoItem` + `fetchPublicados`/`publicadoFromRow`) — **não** estendo o tipo `Familia` (que não tem `fornecedor`/`publicadoEm` hoje): título, fornecedor, tipo_aviamento, preço de publicação (menor preço das variações), `ml_item_id`, `ml_permalink`, `publicado_em`, `codigo_pai`. (`publicado_em` pode ser null se o worker crashou entre setar `ml_item_id` e `publicado_em` → UI mostra "—".)
- **ML ao vivo:** edge function `status-publicados` (verify_jwt **true**):
  - Lê os `ml_item_id` publicados do usuário.
  - Batch `GET /items?ids=id1,id2,…&attributes=id,status,sub_status,available_quantity,price` (até 20 ids por chamada; pagina em blocos de 20).
  - **Sem cache Redis** (YAGNI: 19 itens = 1 chamada; cache adicionaria chave/invalidação/TTL por economia desprezível). O front usa `staleTime` do TanStack Query (~5 min) pra não refazer a chamada a cada navegação; botão "Atualizar" força refetch. Reavaliar cache só se o volume passar de ~100 itens.
  - **Sem credencial ML conectada** (`getValidAccessToken` falha): a edge devolve `{ semCredencialML: true }`; o front mostra a tabela **só com dados do banco** + banner "Conecte sua conta ML nas Configurações para ver o status ao vivo."
  - Resiliente: item 404 (anúncio excluído no ML) → status `indisponível`; falha geral do ML → linhas "status indisponível" sem quebrar a tela.
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

Apaga só o registro daquela família publicada no nosso banco (não toca o ML), para registros de teste já mortos no ML. Reaproveita a lógica de Storage da Feature 1 (remove imagens da família).

- **Aviso explícito (cross-lote):** o casamento de UPDATE é **global por `user_id` + `codigo_pai`** (não por lote — `ingest-lote` linhas 89-93). O diálogo deixa claro: "Você perde o vínculo de UPDATE para **todas as futuras planilhas** com o código {codigo_pai}, não só deste lote. O anúncio no ML continua ativo." Mostra o `codigo_pai` no diálogo.
- **Guarda contra remoção perigosa:** bloqueia a remoção se **alguma família com o mesmo `codigo_pai`** estiver em status `publicando` em qualquer lote (um worker de UPDATE em andamento depende desse `ml_item_id`).
- Reusa a mesma edge `excluir-lote`? **Não** — é uma operação diferente (remove 1 família publicada explicitamente, com as guardas próprias). Vai numa edge dedicada `remover-publicado` (ou um modo da `excluir-lote`); decisão fina fica para o plano. Recalcula contadores do lote de origem (mesma regra do trigger ausente).

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
- `remover-publicado/index.ts` (nova — remove 1 família publicada, com guarda de `publicando` por `codigo_pai`). Pode compartilhar helpers de Storage/recontagem com `excluir-lote`.
- `status-publicados/index.ts` (nova) + `_shared/ml/status.ts` (`parseStatusML`, puro, TDD). **Sem Redis.**

**Frontend:**
- `LoteCard`: botão lixeira (desabilitado em `processando`/`publicando`) + diálogo de confirmação (`AlertDialog` shadcn) + hook `useExcluirLote`.
- `pages/Publicados.tsx` (nova) + rota no `App.tsx` + **novo item em `src/components/sidebar.tsx` (`NAV_ITEMS`)** com ícone (`Package`/`ShoppingBag` do lucide-react).
- `lib/publicados.ts`: tipo **`PublicadoItem`** + `publicadoFromRow` (adapter dedicado, não estende `Familia`) + `filtrarPublicados` (puro, TDD).
- `lib/queries.ts`: `fetchPublicados` (famílias com `ml_item_id`).
- `hooks/usePublicados.ts` + `hooks/useStatusPublicados.ts` (TanStack Query, `staleTime ~5min`, refetch manual) + `hooks/useRemoverPublicado.ts`.

**Sem migration nova** (usa colunas existentes; recontagem de contadores feita na edge, não via trigger). **Sem mudança de schema.**

## Tratamento de erros

- Exclusão: falha de Storage não bloqueia a exclusão dos registros (órfão inofensivo); falha de banco → erro claro na UI, nada apagado pela metade (deletes numa ordem segura).
- Status ao vivo: ML 404/erro → linha "indisponível", tela não quebra; `staleTime` evita martelar a API; botão "Atualizar" força.

## Casos de borda tratados (revisão do spec)

1. **Trigger não cobre DELETE** → edge reconta `total_familias/total_publicadas/total_erros`.
2. **Race com QStash** → bloqueia exclusão em `processando`/`publicando` (+ botão desabilitado).
3. **Storage órfão** → limpa `planilha_path` + `imagens_paths` (menos os referenciados por publicadas sobreviventes); prefixo inteiro só quando 0 publicadas.
4. **`fornecedor`/`publicadoEm` ausentes no front** → tipo `PublicadoItem` dedicado.
5. **Sem credencial ML na tela Publicados** → tabela só com banco + banner pra conectar.
6. **"Remover do sistema" com UPDATE ativo** → bloqueia se `codigo_pai` em `publicando` em qualquer lote.
7. **Escopo cross-lote do vínculo** → aviso explícito no diálogo (perde UPDATE de TODAS as futuras planilhas do `codigo_pai`).
8. **Lote `importando` (vazio)** → exclusão permitida (limpa upload falho).
9. **Status do lote após exclusão parcial** → recalcula para `concluido` se só sobram publicadas.
10. **`publicado_em` null** (worker crashou no meio) → UI mostra "—".

## Testes

- `particionarExclusao`: publicadas preservadas; `pathsRemover` exclui os referenciados por publicadas; `pathsPreservar` correto; `loteVazio` (0 publicadas) vs com publicadas.
- `parseStatusML`: cada status/sub_status → badge certo; 404/erro → indisponível.
- `filtrarPublicados`: cada filtro isolado + combinados + busca.
- Edge functions: guarda de status, recontagem de contadores, ownership e a guarda de `publicando` por `codigo_pai` validadas no bug bash com token real (padrão do projeto).

## Fora de escopo (YAGNI)

- Métricas de desempenho (visitas/vendas) na tela Publicados — decidido começar enxuto (1 chamada batch).
- Encerrar/editar anúncio no ML a partir da tela — o ML só é mexido subindo nova planilha.
- Exclusão em massa de lotes — um a um por enquanto.
- Cache Redis do status ao vivo — desnecessário no volume atual (19 itens = 1 chamada); reavaliar acima de ~100 itens.

## ADR

- **ADR-0019** — Exclusão de lote preserva famílias publicadas (vínculo de UPDATE + inventário Publicados); ML nunca é tocado pela exclusão.
