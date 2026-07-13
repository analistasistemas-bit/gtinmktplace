# ADR-0073: "N CORES" no título conta como quantidade de UNITS_PER_PACK

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego

## Contexto

Lote #33 (lápis de cor, `02905078` — "LAPIS DE COR PEQ 3,5 HEXA/REDONDO TRACOS C/12 CORES"): CREATE
no ML falhou com `"Unidades por kit": Insira um valor diferente de "1" porque você preencheu "Kit"
no campo "Formato de venda"`.

Este é o caso inverso do ADR-0071 (mesmo lote #33, mesmo dia): lá, a regex de `preencherUnitsPerPack`
detectava a contagem real mas a IA genérica tinha preenchido `SALE_FORMAT="Unidade"`. Aqui, a IA
genérica de closed-set preencheu `SALE_FORMAT="Kit"` corretamente (o produto é uma caixa com 12
lápis, um por cor), mas `extrairUnitsPerPack` não reconhecia "CORES" como token de unidade — a
regex só aceitava `unidades/unid/und/un/pecas/pcs` — e `UNITS_PER_PACK` caiu no default `1`. ML
rejeita `SALE_FORMAT=Kit` + `UNITS_PER_PACK=1`.

## Decisão

`RE_UNIDADES` (em `extrairUnitsPerPack`, `supabase/functions/_shared/categoria/atributos.ts`) passa
a aceitar `cores` como token de unidade, ao lado de `unidades/unid/und/un/pecas/pcs`. Em kits de
lápis de cor/giz de cera/canetinha, cada cor é uma unidade física da caixa — "C/12 CORES" e "24
unidades" são o mesmo tipo de sinal para este atributo.

Com isso, `preencherUnitsPerPack` já reusa o mecanismo do ADR-0071 sem mudança adicional: ao
extrair `12` de "C/12 CORES", chama `forcarSaleFormatKit`, que mantém `SALE_FORMAT=Kit` (já correto
neste caso) e agora preenche `UNITS_PER_PACK=12` em vez de `1`.

## Risco aceito

"N cores" nem sempre significa "N unidades no kit" — um produto poderia usar a palavra para
descrever variações de cor disponíveis para escolha (1 unidade por SKU), não uma caixa fechada.
Aceitamos o mesmo risco que o ADR-0071 já aceita para `und/un/unidades` (regex sem escopo por
categoria): o padrão de título "\d+ CORES" em aviamentos/papelaria do nosso catálogo hoje descreve
kits fechados (lápis, giz, canetinha), não variações por SKU (que usam `variacoes.cor`, não o
título da família). Se um caso divergente aparecer, tratar como exceção pontual (like lote #27/#33),
não reverter a heurística geral.

## Como reverter

Remover `|cores` da regex `RE_UNIDADES`.
