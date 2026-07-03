# ADR-0055 — Imposto por origem (nacional/importado) no preço e no markup

**Data:** 2026-07-03
**Status:** aceito (implementado na branch `worktree-imposto-origem`, aguardando validação)
**Refina:** [ADR-0020](0020-estrategia-de-preco-liquido-minimo.md), [ADR-0023](0023-preco-acima-do-abismo-de-tarifa-fixa.md) e [ADR-0050](0050-frete-no-gross-up-preco-proprio.md)

## Contexto

O cálculo de "Você recebe por venda" e o markup (`_shared/ml/tarifa.ts`,
`src/lib/markup.ts`) descontam **comissão do ML** e **frete absorvido pelo vendedor**
(ADR-0050), mas ignoram o **imposto sobre a venda**. O produto pode ser **nacional**
ou **importado**, com alíquotas de imposto diferentes — hoje inexistentes no domínio.

Sem isso, o líquido, o lucro, o markup e a decisão "Vale a pena" ficam superestimados,
e o preço sugerido (gross-up) não cobre o imposto.

A planilha ganhou a coluna **ORIGEM** (`NACIONAL`/`IMPORTADO`).

⚠️ Não confundir com `familias.tipo_origem` (enum `regex|ia|manual`), que é a origem da
**categorização ML** — conceito distinto. O novo conceito é `familias.origem`.

## Decisão

1. **ORIGEM é da família** (`familias.origem`, enum `public.origem_produto` =
   `nacional|importado`), lido da linha PAI da planilha — espelha `FORNECEDOR`.
   Coluna **opcional**: ausente/vazio/inválido → `nacional`. Famílias existentes → `nacional`.

2. **Duas alíquotas globais por usuário**, parametrizáveis em Configurações
   (`configuracoes.aliquota_nacional_pct` default 8, `aliquota_importado_pct` default 16).
   Sem override por família.

3. **Imposto = preço × alíquota**, descontado do líquido junto com comissão e frete:

   ```
   recebe = preço − comissão − frete − (preço × alíquota%)
   ```

   e somado ao gross-up do preço sugerido (refina ADR-0050):

   ```
   P = (piso + fixa + frete) / (1 − comissão% − alíquota%)
   ```

   Guard: se `comissão% + alíquota% ≥ 1`, não aplica gross-up (evita divisão por ~0).

4. A alíquota reduz o markup em **todas as telas** que o exibem — análise pré-publicação
   e faturamento realizado (pós-venda usa origem via variação → família).

## Consequências

- Preço sugerido sobe para absorver o imposto; markup/lucro exibidos caem para o valor real.
- O atributo ORIGIN do anúncio no ML **não** é preenchido por ora (fora do escopo).
- Vendas históricas de famílias sem origem definida assumem `nacional` (8%).
