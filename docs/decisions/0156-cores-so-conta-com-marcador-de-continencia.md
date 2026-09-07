# ADR-0156: "N CORES" só conta como UNITS_PER_PACK com marcador de continência ("C/" ou "COM")

**Status:** Aceito
**Data:** 2026-09-07
**Decisores:** Diego

## Contexto

O ADR-0073 passou a aceitar `cores` como token de unidade em `RE_UNIDADES`
(`extrairUnitsPerPack`, `supabase/functions/_shared/categoria/atributos.ts`) para resolver o lote
#33 (lápis de cor "C/12 CORES"), e registrou explicitamente o risco:

> "N cores" nem sempre significa "N unidades no kit" [...] Se um caso divergente aparecer, tratar
> como exceção pontual, não reverter a heurística geral.

O caso divergente apareceu no lote #39. O produto `02994968` —
`LANTEJOULAS HOLOGRAFICA TAM 8 CORES C/50MT`, rolo unitário de 50 metros — casou `8 CORES`, gerou
`UNITS_PER_PACK=8` e, pelo ADR-0071, `forcarSaleFormatKit` sobrescreveu `SALE_FORMAT` para "Kit".
O anúncio MLB5197880975 foi publicado com "Formato de venda: Kit / Unidades por kit: 8" para um
produto vendido de forma unitária. Aqui o `8` é o tamanho da lantejoula (mesmo número que virou o
`DIAMETER 8 mm`, correto) e `CORES` descreve as variações de cor disponíveis, não o conteúdo de
uma caixa fechada.

Republicar não corrigia: `nome_pai`/`descricao_pai` não mudam entre publicações, então a regex
determinística reproduz o mesmo resultado a cada reprocessamento.

Levantamento no banco de produção (455 famílias com `atributos_ml`, 86 com `SALE_FORMAT=Kit`)
mostrou o padrão que separa os dois casos, sem exceção:

| Kit real | Falso positivo |
|---|---|
| `LAPIS DE COR JUMBO HEXAGONAL C/12 CORES` | `LANTEJOULAS TAM 6 CORES C/50MTS` |
| `LAPIS DE COR PEQ 3,5 HEXA/REDONDO TRACOS C/12 CORES` | `LANTEJOULAS TAM 8 CORES C/50MT` |
| descrição `... TRAÇOS COM 12 CORES ...` | `LANTEJOULAS HOLOGRAFICA TAM 8 CORES C/50MT` |
| | `ANNE 65 CORES` (65 é o código da cor da linha) |

O kit fechado sempre traz o marcador de continência antes do número (`C/` ou `COM`). O falso
positivo nunca traz.

## Decisão

`cores` deixa de ser um token de unidade solto e passa a exigir `C/` ou `COM` imediatamente antes
do número. Os demais tokens (`unidades/unid/und/un/pecas/pcs`) seguem inalterados — o ADR-0071
continua valendo integralmente.

```ts
const RE_UNIDADES =
  /(?:(\d{1,4})\s*(?:unidades?|unid|und|un|pecas?|pcs)|(?:c\/|com)\s*(\d{1,4})\s*cores)\b/;
```

`extrairUnitsPerPack` lê `m[1] ?? m[2]`.

Isto refina a heurística do ADR-0073 em vez de revertê-la, exatamente como aquele ADR previu:
`C/12 CORES` e `COM 12 CORES` continuam gerando `UNITS_PER_PACK=12` e `SALE_FORMAT=Kit`.

## Consequências

- Os quatro falsos positivos conhecidos (3 lantejoulas + `ANNE 65 CORES`) passam a cair no default
  `UNITS_PER_PACK=1`, sem forçar Kit.
- Nenhum kit legítimo do catálogo atual perde a contagem — verificado contra as 86 famílias com
  `SALE_FORMAT=Kit` em produção.
- Famílias **já publicadas** com o valor errado não se corrigem sozinhas: `atributos_ml` está
  persistido em `familias`. É preciso reprocessar a família (o que recalcula os atributos, desde
  que `atributos_editados_pelo_operador = false`) e rodar o UPDATE pelo fluxo do app.
- Risco remanescente: um kit real cujo título use `cores` sem `C/`/`COM` (ex.: "LÁPIS 12 CORES")
  cai em `UNITS_PER_PACK=1`. Se a IA de closed-set tiver preenchido `SALE_FORMAT="Kit"`, o ML
  rejeita o CREATE com mensagem explícita e o operador corrige na Revisão — falha visível, não
  silenciosa. Preferimos isso a publicar um produto unitário anunciado como kit.

## Como reverter

Voltar `RE_UNIDADES` para a forma do ADR-0073 (`|cores` dentro do grupo de tokens) e
`parseInt(m[1], 10)` em `extrairUnitsPerPack`.
