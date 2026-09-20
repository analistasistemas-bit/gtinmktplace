---
tags: [modulo, produtos]
atualizado: 2026-09-20
---

# Produtos

O domínio central: **Lote → Família (= 1 anúncio) → Variação (= 1 SKU)**. Ver [[Glossário]],
[[Banco de Dados]], [[Estoque]].

Historicamente, o eixo estrutural de variação era unicamente a **Cor** (`variacoes.cor`). A partir de
setembro de 2026, com o suporte a vestuário e calçados ([[0166-tipo-de-produto-por-organizacao|ADR-0166]]),
o SKU passa a ser definido pelo par **Cor × Tamanho/Numeração** em organizações com tipos habilitados.

O saldo dessas variações é governado pelo módulo [[Estoque]] — `variacoes.estoque` só muda por RPC
do ledger (entrada, venda, estorno, ajuste), nunca por escrita direta.

## Modelos de Produto e Eixos Estruturais (ADR-0166 e ADR-0167)

1. **Tipos de Produto Habilitados:** configurados por organização em `organizations.tipos_produto_habilitados` (`roupa` e `calcado`).
2. **Duplo Eixo:** famílias com `tipo_produto` preenchido possuem gênero (`familias.genero`) e suas variações contêm tamanho (`variacoes.tamanho`: P, M, G ou numeração 37, 38...).
3. **Guia de Tamanhos do ML (ADR-0167):** integração com a API de Size Charts do Mercado Livre via tabela `ml_size_charts`, amarrando automaticamente a tabela oficial de medidas no ato da publicação.
4. **Edição e Matriz:** produtos de vestuário/calçado utilizam a `MatrizGrade` bidimensional em [[Estoque]].

## Telas

- **`/lotes`, `/novo-lote`** (`Lotes.tsx`) — lista e upload de novos lotes
- **`/progresso/:loteId`** (`Progresso.tsx`) — acompanha ingestão/processamento em tempo real
  (Realtime do Supabase) e permite atualização rápida de estoque para famílias `UPDATE` elegíveis
- **`/revisao`, `/revisao/:loteId`** (`RevisaoIndex.tsx`, `Revisao.tsx`) — revisão humana
  obrigatória antes de publicar
- **`/relatorio/:loteId`** (`Relatorio.tsx`) — relatório pós-processamento, incluindo variações e
  famílias que zeraram estoque na rodada

## Componentes principais (`src/components/`)

| Componente | Papel |
|---|---|
| `familia-expanded.tsx` | Card expandido de família na Revisão — edição de título/descrição/cor/preço |
| `familia-row.tsx` | Linha de família em lista, com controles de atacado (desconto removido, ADR-0162) |
| `variacao-card.tsx` | Card de uma variação (cor, foto, estoque, status) |
| `foto-capa-familia.tsx`, `botao-trocar-foto.tsx` | Gestão de foto de capa |
| `card-categoria.tsx` | Seletor/exibição de categoria |
| `painel-analise.tsx` | Painel de análise (viabilidade + concorrência) na Revisão |
| `card-voce-recebe.tsx` | "Você recebe por venda" — comissão e líquido |
| `semaforo-preco.tsx` | Semáforo 🟢🟡🔴 de viabilidade de preço |
| `atacado-editor.tsx` | Configuração de preço de atacado (PxQ) por família |
| `drop-zone-imagens-existente.tsx` | Upload de foto adicional pós-ingest |

## Regras de publicabilidade

`src/lib/publicavel.ts` — `familiaPublicavel()`, `criticasVariacao()`, `familiaExigeCor()`,
`familiaExigeFotoPorVariacao()`.
Checagens que liberam/bloqueiam a publicação (foto, cor, preço, categoria). Ver
[[Publicação Mercado Livre]].

**Produto simples** (CREATE, `tipoAviamento='outro'`, 1 variação incluída): a variação É o
produto, então não exige cor — e, quando a família tem capa, também não exige foto por
variação. A capa lidera a galeria de toda variação na publicação
(`capa ?? propria`, `_shared/ml/publicar.ts`) e é subida ao ML no pre-publish
(`_shared/anuncios/pre-subir-fotos.ts`), então o anúncio sai com imagem. Sem capa, ou com 2+
cores, a foto por variação volta a ser obrigatória.

## Hooks de dados

`useFamilia`, `useFamiliaMutations`, `useFamilias`, `useLotes`, `useLoteRealtime`,
`useFotosProduto`, `useAnaliseViabilidade`, `useTarifaML`.
