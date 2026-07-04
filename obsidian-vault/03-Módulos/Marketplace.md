---
tags: [modulo, marketplace]
atualizado: 2026-07-04
---

# Marketplace

Gestão do que está publicado no canal ativo (Mercado Livre). Ver [[Publicação Mercado Livre]],
[[Integrações]], [[APIs]].

## Telas

- **`/publicados`** (`Publicados.tsx`) — inventário + status ao vivo via ML (filtros/ordenação/
  paginação persistidos na URL)
- **`/publicados/vendas`** (`DetalheVendas.tsx`) — detalhe de vendas por item publicado

## Capacidades

- **Status ao vivo** — `status-publicados` (edge function) lê status via
  [[Integrações|conector multicanal]], resiliente a "sem credencial"
- **Categoria real do ML** — coluna Tipo mostra a categoria real do anúncio, não só a inferida
  internamente
- **Catálogo** — vínculo opt-in por GTIN (`vincular-catalogo`); alerta de no-match/ficha
  divergente (kit) via Telegram
- **Moderação** — `monitorar-moderados` varre anúncios pausados/moderados e alerta Telegram
- **Remoção** — `remover-publicado` (limpa registro local, ML intocado) e `excluir-lote`
  (preserva publicados)
- **Pausar/reativar** — toggle na linha (só admin, `atualizar-status-publicado`); pausar exige
  confirmação, reativar é direto. Sem persistência local de status — invalida o cache de
  status ao vivo após a ação (ADR-0060)
- **Split de produto** — produtos com >100 cores aparecem como N anúncios; ver
  [[Publicação Mercado Livre]]

## Componentes

`dashboard-publicados.tsx`, `filtros-ativos.tsx`, `card-categoria.tsx`, `status-badge.tsx`,
`status-pill.tsx`, `badge-cor-origem.tsx`.

## Hooks

`usePublicados`, `useStatusPublicados`, `useRemoverPublicado`, `usePausarReativarPublicado`,
`useExcluirLote`, `usePaginacao`.
