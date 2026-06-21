# Publicados: coluna "Tipo" mostra a categoria real do ML

**Data:** 2026-06-21
**Status:** Aprovado (Diego, 2026-06-21)
**Escopo:** Frontend apenas — tela de Publicados.

## Problema

Na tela de Publicados, produtos como "Alfinete de Segurança" aparecem com tipo
**"Outro"**. O usuário interpretou como falha da IA em classificar o produto.

## Diagnóstico (evidência do banco)

A IA **já classifica corretamente**. Os 14 alfinetes têm gravado em `familias`:

| campo | valor |
|---|---|
| `tipo_aviamento` | `outro` |
| `tipo_origem` | `preditor` |
| `categoria_ml_id` | `MLB270269` |
| `categoria_nome` | **`Alfinetes de Segurança`** |

Há dois conceitos sobrepostos:

- **`tipo_aviamento`** — enum interno fixo (`linha|botao|fita|cola|outro`). Só vira um
  dos quatro aviamentos via regex de palavra-chave (`_shared/categoria/detectar.ts`);
  qualquer outra coisa cai em `outro`. **É isto que a tela de Publicados exibe.**
- **`categoria_nome`** — categoria-folha real do ML, resolvida pelo preditor/IA
  (ADR-0026 / E3) e gravada em `familias.categoria_nome`. Taxonomia "infinita", sem enum:
  cada categoria nova "já existe" pelo nome. A tela de **Revisão** já a usa
  (`card-categoria.tsx:61` → `categoriaNome ?? nomeCategoriaAmigavel(tipoAviamento)`).

**Conclusão:** o que o usuário pediu ("a IA identificar o tipo e criar quando não existir")
já acontece no dado. É puramente um problema de exibição na tela de Publicados, que mostra
o campo grosso (`tipo_aviamento`) em vez do refinado (`categoria_nome`).

## Solução

A tela de Publicados passa a usar `categoria_nome` como dimensão de "Tipo" (coluna, filtro,
ordenação), com fallback para o rótulo grosso e depois "—".

### 1. Dado (`queries.ts`)
- `fetchPublicados`: incluir `categoria_nome` no `.select(...)`.
- `publicadoFromRow`: retornar `categoria: r.categoria_nome ?? null`.

### 2. Tipo (`publicados.ts`)
- `PublicadoItem`: novo campo `categoria: string | null`.
- Novo helper `rotuloTipo(item): string` = `item.categoria ?? nomeTipo(item.tipo) ?? '—'`
  (a lógica de exibição/filtro/ordenação converge para esta função única).
  - Nota: `nomeTipo` hoje vive em `Publicados.tsx`. Mover a derivação do rótulo para
    `publicados.ts` para que filtro/ordenação (que vivem aqui) e a coluna usem a mesma fonte.

### 3. Coluna "Tipo" (`Publicados.tsx`)
- `LinhaTabela`: exibir `rotuloTipo(item)` no lugar de `nomeTipo(item.tipo)`.
- Cabeçalho permanece "Tipo" (decisão do Diego).

### 4. Filtro "Tipo" (`publicados.ts`, `publicados-url.ts`, `filtros-ativos.tsx`, `Publicados.tsx`)
- `FiltroPublicados.tipo` deixa de ser `TipoAviamento` e passa a `string | null`
  (compara contra o rótulo exibido `rotuloTipo(item)`), espelhando o filtro de Fornecedor.
- Dropdown: lista de rótulos distintos presentes nos dados (mirror de `fornecedores`,
  `Publicados.tsx:353`), em vez dos 5 valores fixos do enum.
- URL (`publicados-url.ts`): o param `tipo` deixa de validar contra o enum `TIPOS`
  e passa a aceitar texto livre (como `fornecedor`).
- Chip (`filtros-ativos.tsx`): o label do chip `tipo` passa a mostrar o valor cru
  (rótulo da categoria) em vez de mapear via `TIPO_LABEL`.

### 5. Ordenação "Tipo" (`publicados.ts`)
- `chaveOrdenacao` caso `'tipo'`: ordenar por `rotuloTipo(i)` (texto exibido), não por
  `i.tipo`, para bater com a coluna.

## Fora de escopo (intencional)

- Não tocar em `tipo_aviamento` / enum Postgres, `detectar.ts`, `process-familia`, nem em
  qualquer lógica de import/classificação — já funcionam.
- Não mexer na tela de Revisão (já correta) nem em outras telas.

## Efeito

- Retroativo: todo já-publicado com `categoria_nome` resolvido passa a mostrar o tipo real,
  sem republicar. Os 14 alfinetes viram "Alfinetes de Segurança" imediatamente.
- "Outro" só sobra para itens sem categoria resolvida (preditor não classificou e operador
  não escolheu) — caso raro e legítimo.

## Testes

- `publicados.test` (ou equivalente): `rotuloTipo` (categoria presente → categoria; ausente →
  rótulo grosso; ambos ausentes → "—"); `filtrarPublicados` por categoria; `ordenarPublicados`
  pela coluna `tipo` usando o rótulo.
- `publicados-url`: `tipo` aceita texto livre no round-trip serialize/parse.

## Ajuste de dado pedido

Verificar no banco o estado dos alfinetes. `categoria_nome` já está correto
("Alfinetes de Segurança") — não há `tipo_aviamento` melhor disponível no enum atual, e a
correção visível vem da mudança de frontend. Se algum item de alfinete estiver com
`categoria_nome` nulo apesar de `categoria_ml_id` presente, fazer backfill do nome.
