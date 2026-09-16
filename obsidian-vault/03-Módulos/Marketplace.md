---
tags: [modulo, marketplace]
atualizado: 2026-09-15
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
  divergente (kit) via Telegram; retentar manual na Publicados (`retentar-catalogo`, ADR-0021).
  Desde 11/09/2026, `sem_produto` e `pendente` **deixaram de ser estados terminais**: o retentar
  volta a alcançá-los (o ML pode passar a ter a ficha depois), com retorno explícito ao operador e
  guarda contra sync concorrente
- **Anúncios órfãos** — `varrer-anuncios-orfaos` confronta os anúncios vivos da conta no ML com
  tudo que o app conhece (**7 fontes** de id, incluindo os `catalog_listing_id` e o
  `ml_item_id_anterior` da migração de preço por variação) e devolve o que o app **não** conhece,
  já classificado em `perdido_do_app` / `catalogo_sem_vinculo` / `externo`. Só leitura, sob demanda
  (botão na Publicados), nunca em cron; fail-closed (erro em qualquer consulta derruba a chamada,
  para não inventar órfão) e marca `truncado` acima de 1000 anúncios. **Anúncio de catálogo não é
  órfão** — no primeiro uso, 10 dos 13 "fantasmas" eram catálogo saudável. Nasceu do incidente de
  10/09/2026 (adendo do ADR-0088): anúncio criado pelo app perdeu o vínculo no banco e seguiu ativo
  e vendendo, invisível para o sistema
- **Publicação incompleta** — família publicada só em parte aparece em vermelho na Publicados, com
  filtro próprio; antes passava por publicada. Complementa o filtro **"sem vínculo de catálogo"**.
  O texto do chip não promete ação que o não-admin não tem
- **Moderação** — `monitorar-moderados` varre anúncios pausados/moderados e alerta Telegram
- **Remoção** — `remover-publicado` (limpa registro local, ML intocado) e `excluir-lote`
  (preserva publicados)
- **Pausar/reativar** — toggle na linha (só admin, `atualizar-status-publicado`); pausar exige
  confirmação, reativar é direto. Sem persistência local de status — invalida o cache de
  status ao vivo após a ação (ADR-0060)
- **Split de produto** — produtos com >100 cores aparecem como N anúncios; ver
  [[Publicação Mercado Livre]]
- **Calculadora ML em Viabilidade** — compara Clássico e Premium com lucro, margem, custo total,
  peso cúbico, sensibilidades e preço-alvo. Categoria é opcional, mas a tela avisa quando o
  resultado não usa tarifa oficial; a busca usa uma Edge Function read-only. Sem persistência ou
  escrita no tenant (ADR-0126).

## Componentes

`dashboard-publicados.tsx`, `filtros-ativos.tsx`, `card-categoria.tsx`, `status-badge.tsx`,
`status-pill.tsx`, `badge-cor-origem.tsx`.

## Hooks

`usePublicados`, `useStatusPublicados`, `useRemoverPublicado`, `usePausarReativarPublicado`,
`useExcluirLote`, `usePaginacao`.
