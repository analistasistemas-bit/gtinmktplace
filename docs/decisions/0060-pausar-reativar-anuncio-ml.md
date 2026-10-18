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

## Aditivo 2026-10-01 — anúncio de catálogo relacionado

Incidente: a Hairflay pausou 5 anúncios pelo PubliAI e 2 anúncios de catálogo (MLB7717167310,
MLB5312481169) continuaram ativos e vendendo. No ML o anúncio de catálogo é **outro item**, ligado
ao tradicional por `item_relations` (estoque compartilhado, `stock_relation: 1`), e o ML **não
propaga** pausa/reativação entre eles.

Decisão: `atualizarStatus` do conector ML lê `item_relations` e aplica o mesmo status a cada
relacionado cujo status parseado (`parseStatusML`, com `sub_status`) seja o oposto reversível
(ativo↔pausado). Relacionado encerrado, excluído ou moderado — inclusive `paused` com sub_status de
moderação — nunca é tocado (mesma regra do ADR-0111). A propagação roda **antes** do PUT do item:
se falhar (ou um relacionado não voltar legível no multiget), o item fica no status antigo e o
erro sobe, então o retry do operador ou do QStash repete tudo. Na ordem inversa, o
`sincronizar-estoque` leria o item já ativo e nunca voltaria ao catálogo. Vale para os dois chamadores: o botão Pausar/Reativar e a
reativação após reposição (`sincronizar-estoque`, ADR-0111).

## Emenda 2026-10-18 — User Products: pausar/reativar a família inteira

Incidente (Zaven, short UP com 32 SKUs): o botão mandava só `mlItemId` (o SKU principal). O ML
pausou 1 SKU, os outros seguiram vendendo e a linha continuou "Ativo" (`agregarStatusUP`: qualquer
filho ativo → ativo). A edge continua **item único** (ADR-0088 §2); quem expande é a tela:
`alvosStatus(item)` (`src/lib/publicados.ts`) devolve todos os SKUs não retirados de uma família UP
(`mlItemIdsUP`) ou o próprio MLB no Legacy. O botão chama a edge **um SKU por vez, em sequência**
(chamadas concorrentes poderiam renovar o token da conexão em paralelo) e, em falha parcial, avisa
"X de N SKUs". A pausa em massa (ADR-0174) manda os mesmos alvos para `operacoes-massa`, que já
aceita MLB de `anuncios_externos_itens`.

## Como reverter

Remover `atualizarStatus` do contrato e da implementação ML, apagar a edge function e o
`requireAdmin`, e remover o ícone/mutation da linha em `Publicados.tsx`.
