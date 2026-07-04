# ADR-0060: Pausar/reativar anúncio publicado (contrato multicanal + permissão admin)

**Status:** Aceito
**Data:** 2026-07-04
**Decisores:** Diego

## Contexto

O menu Publicados hoje só tem duas ações por linha: link externo para o ML e "Remover"
(apaga o vínculo local de UPDATE, mas nunca toca o anúncio no ML). Não existe nenhuma
ação de escrita de status.

O `ChannelConnector` (ADR-0024, `_shared/canais/contrato.ts`) já abstrai leitura de status
em lote (`lerStatus`) e escrita de outros campos (`atualizarAnuncio`, `aplicarAtacado`), mas
não tem escrita de status — lacuna relevante agora que o Shopee (E5) é o próximo canal do
roadmap e qualquer ação nova deveria nascer na abstração multicanal, não amarrada só ao ML.

O status do anúncio (`ativo`/`pausado`/`encerrado`/`moderado`/`inativo`/`indisponivel`) nunca
é persistido localmente — é sempre lido ao vivo do ML (`status-publicados` → `useStatusPublicados`,
staleTime 5 min).

Todas as ações de escrita existentes (`remover-publicado` etc.) usam só `requireUser` (qualquer
membro autenticado da operação, ADR-0056) — pausar/reativar é a primeira ação restrita a admin.

## Decisão

- Novo método `atualizarStatus(ctx, itemExternoId, status: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>>`
  no `ChannelConnector`, implementado em `mercado-livre.ts` via `PUT /items/{id}` com `{ status }`
  — mesmo endpoint e mesmo padrão de erro (`ResultadoCanal`/`ErroCanal`) que `atualizarAnuncio`/
  `atualizar-item.ts` já usam.
- Nova edge function recebendo `{ mlItemId, status }`, autenticada por um novo helper
  `requireAdmin(req)` (ao lado de `requireUser` em `_shared/auth.ts`, checando `profiles.is_admin`)
  — primeira ação de escrita do projeto restrita a admin, não só a membro. Token/credencial seguem
  o padrão de operação já usado por `status-publicados`/`remover-publicado`
  (`userIdCredencialOperacaoML` + `getValidAccessToken`), não o token do chamador.
- Granularidade por anúncio (`mlItemId`), igual ao resto da tela Publicados.
- UI: terceiro ícone na linha (`Pause`/`Play` do `lucide-react`), alternando conforme o status ao
  vivo. Desabilitado com tooltip quando: (a) quem está logado não é admin, ou (b) o status atual
  não é `ativo`/`pausado` (ex. moderado, encerrado — nada a alternar). Confirmação (`AlertDialog`)
  só ao pausar; reativar é direto (sem confirmação).
- Sem persistência local do novo status: `onSuccess` da mutation invalida `QK.statusPublicados`
  (força reconsulta real no ML), mesmo padrão de `useRemoverPublicado`. Sem optimistic update.

## Como reverter

Remover `atualizarStatus` do contrato e da implementação ML, apagar a edge function e o
`requireAdmin`, e remover o ícone/mutation da linha em `Publicados.tsx`.
