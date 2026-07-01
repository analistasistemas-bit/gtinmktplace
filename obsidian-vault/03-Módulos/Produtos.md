---
tags: [modulo, produtos]
atualizado: 2026-07-01
---

# Produtos

O domínio central: **Lote → Família (= 1 anúncio) → Variação (= 1 SKU/cor)**. Ver [[Glossário]],
[[Banco de Dados]].

## Telas

- **`/lotes`, `/novo-lote`** (`Lotes.tsx`) — lista e upload de novos lotes
- **`/progresso/:loteId`** (`Progresso.tsx`) — acompanha ingestão/processamento em tempo real
  (Realtime do Supabase)
- **`/revisao`, `/revisao/:loteId`** (`RevisaoIndex.tsx`, `Revisao.tsx`) — revisão humana
  obrigatória antes de publicar
- **`/relatorio/:loteId`** (`Relatorio.tsx`) — relatório pós-processamento de um lote

## Componentes principais (`src/components/`)

| Componente | Papel |
|---|---|
| `familia-expanded.tsx` | Card expandido de família na Revisão — edição de título/descrição/cor/preço |
| `familia-row.tsx` | Linha de família em lista, com controles de atacado/desconto |
| `variacao-card.tsx` | Card de uma variação (cor, foto, estoque, status) |
| `foto-capa-familia.tsx`, `botao-trocar-foto.tsx` | Gestão de foto de capa |
| `card-categoria.tsx` | Seletor/exibição de categoria |
| `painel-analise.tsx` | Painel de análise (viabilidade + concorrência) na Revisão |
| `card-voce-recebe.tsx` | "Você recebe por venda" — comissão e líquido |
| `semaforo-preco.tsx` | Semáforo 🟢🟡🔴 de viabilidade de preço |
| `atacado-editor.tsx` | Configuração de preço de atacado (PxQ) por família |
| `drop-zone-imagens-existente.tsx` | Upload de foto adicional pós-ingest |

## Regras de publicabilidade

`src/lib/publicavel.ts` — `familiaPublicavel()`, `criticasVariacao()`, `familiaExigeCor()`.
Checagens que liberam/bloqueiam a publicação (foto, cor, preço, categoria). Ver
[[Publicação Mercado Livre]].

## Hooks de dados

`useFamilia`, `useFamiliaMutations`, `useFamilias`, `useLotes`, `useLoteRealtime`,
`useFotosProduto`, `useAnaliseViabilidade`, `useTarifaML`.
