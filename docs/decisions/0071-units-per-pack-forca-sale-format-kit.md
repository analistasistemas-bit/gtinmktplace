# ADR-0071: UNITS_PER_PACK real força SALE_FORMAT=Kit

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego

## Contexto

Lote #33 (lápis de cor 24 unidades): CREATE no ML falhou com `"Unidades por kit": Insira 1 neste
campo porque você preencheu "Unidade" no campo "Formato de venda"`.

Causa: duas lógicas independentes preenchem atributos de kit sem se comunicar.

1. `preencherAtributosClosedSet` (IA genérica, `atributos-llm-core.ts`) preenche `SALE_FORMAT`
   ("Formato de venda") a partir do closed-set da categoria — sem sinal explícito de "kit" no
   texto, cai em "Unidade".
2. `preencherUnitsPerPack` (regex dedicado, ADR-0063/lote #27) extrai contagem do nome/descrição
   ("24UND", "100UND") e preenche `UNITS_PER_PACK` com o número — comportamento intencional e
   testado desde o lote #27, para não travar a Revisão pedindo contagem em produto avulso.

`resolverAtributosGenericos` roda os dois em sequência (closed-set primeiro, depois
`preencherUnitsPerPack`), mas nenhum dos dois olha o resultado do outro. Quando a contagem
extraída é > 1, o ML rejeita a combinação `SALE_FORMAT=Unidade` + `UNITS_PER_PACK>1`.

## Decisão

`preencherUnitsPerPack` passa a **sobrescrever `SALE_FORMAT` para "Kit"** (usando o `value_id` do
schema dinâmico da categoria) sempre que extrair uma contagem real (> 1) do nome/descrição —
mesmo que a IA já tenha preenchido "Unidade". Sem contagem clara (assume 1, produto avulso), não
mexe em `SALE_FORMAT`.

Implementado em `supabase/functions/_shared/categoria/atributos.ts` (`preencherUnitsPerPack` +
`forcarSaleFormatKit`). Se a categoria não expõe `SALE_FORMAT` no schema, não faz nada (mesmo
gate de `UNITS_PER_PACK`).

## Consequências

- Produtos com contagem real no título/descrição ("24UND", "100 unidades") passam a publicar como
  `SALE_FORMAT=Kit` no ML, consistente com `UNITS_PER_PACK`.
- Não interfere na trava de equivalência do catálogo (`catalogo.ts`/ADR-0021), que só *lê* a
  ficha do ML — continua tratando `UNITS_PER_PACK>1`/`SALE_FORMAT≠Unidade` como sinal de kit
  divergente do nosso produto avulso.

## Como reverter

Remover a chamada a `forcarSaleFormatKit` dentro de `preencherUnitsPerPack`.
