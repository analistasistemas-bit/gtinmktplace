# ADR-0023: Gross-up precifica acima do abismo de tarifa fixa do ML (R$ 12,50)

**Status:** Aceito
**Data:** 2026-06-11
**Decisores:** Diego
**Refina:** ADR-0020 (mantém a semântica de PRECO = líquido mínimo; corrige o gross-up)

## Contexto

O gross-up do ADR-0020 (`P = (piso + fixa) / (1 − percentual)`) tratava a tarifa fixa
do ML como **constante** e a lia no preço-piso. Bug bash da fita N.5 (família `03098710`,
piso R$ 4,00) expôs a falha: o sistema publicou a R$ **6,85**, mas o líquido real era só
R$ **2,61** — bem abaixo do piso de R$ 4,00.

Sondagem da API (`GET /sites/MLB/listing_prices`, categoria fita `MLB255054`, Clássico)
revelou a mecânica real da "tarifa fixa" do ML — e que o limiar **não é ~R$ 29** (como o
ADR-0020 supunha), **é R$ 12,50**:

| Preço | Comissão | % | Tarifa fixa | Fixa / preço | Líquido |
|---|---|---|---|---|---|
| R$ 4,00 | 2,47 | 12% | 1,99 | 49,8% | R$ 1,53 |
| R$ 6,85 | 4,24 | 12% | 3,42 | 49,9% | R$ 2,61 |
| R$ 10,53 | 6,52 | 12% | 5,26 | 50,0% | R$ 4,01 |
| R$ 12,50 | 7,74 | 12% | 6,24 | 49,9% | R$ 4,76 |
| **R$ 12,51** | 1,50 | 12% | **0** | 0% | **R$ 11,01** |
| R$ 29,00 | 3,48 | 12% | 0 | 0% | R$ 25,52 |

Conclusões:

1. **Abaixo de R$ 12,50** o ML cobra `percentual + 50% do preço` como tarifa fixa
   (comissão efetiva ~62%). A tarifa "persegue" o preço, então a fórmula linear
   (que ancora a fixa num preço fixo) nunca alcança o piso.
2. **Acima de R$ 12,50** a tarifa fixa **zera** — só o percentual (~12%).
3. Há um **abismo**: em R$ 12,50 → R$ 12,51 o líquido salta de R$ 4,76 para R$ 11,01.
   Líquidos entre ~R$ 4,76 e ~R$ 11,00 são **inalcançáveis** por qualquer preço.
4. Vender abaixo de R$ 12,50 é economicamente ruim: por ~R$ 2 a mais de preço o líquido
   quase triplica (R$ 10,53 → R$ 4 líquido vs R$ 12,55 → R$ 11 líquido).

## Decisão

No ramo **sem concorrente** do gross-up (`_shared/preco/sugerir.ts`):

- A comissão é lida **acima do abismo** (`PRECO_REF_COMISSAO = 20`), obtendo o percentual
  "limpo" sem a tarifa fixa de 50%.
- O preço final é `max(R$ 12,55, arredonda5_cima((piso + fixa) / (1 − percentual)))`.
  `PRECO_MIN_ACIMA_ABISMO = 12,55` é o menor múltiplo de R$ 0,05 já fora da faixa cara
  (em R$ 12,50 a tarifa fixa **ainda** é cobrada; só zera em R$ 12,51).
- Fallback sem comissão: `max(R$ 12,55, arredonda5_cima(piso))` — também sai da faixa cara.

Garante líquido ≥ piso **e** comissão de ~12% (nunca os ~62%). Para a fita N.5 (piso R$ 4):
preço **R$ 12,55**, líquido **~R$ 11,04**, semáforo 🟢.

Constantes:

- `ABISMO_TARIFA_FIXA = 12,50` — **hardcoded** (decisão: é o "custo fixo" padrão do ML
  para itens baratos, igual em todas as categorias; mais simples que sondar a curva por
  categoria). Ajustar aqui se o ML mudar a política.

**Com concorrente:** nada muda (segue o mercado `menor × 0,95`); se o mercado ficar na
faixa cara, o semáforo sinaliza. O gross-up acima do abismo é só para o ramo `proprio`.

## Escopo

- **Só daqui pra frente** (CREATE / reprocessamento). Anúncios já publicados na faixa cara
  (ex.: fitas a R$ 6,85) **não** são reprecificados automaticamente — o operador decide
  caso a caso (UPDATE preserva preço por ADR-0016).

## Consequências

- Itens baratos sem concorrente sobem de preço (ex.: R$ 6,85 → R$ 12,55). É alta de preço
  visível ao comprador; aceitável porque sem concorrente é margem, e a alternativa (vender
  barato pagando 62% ao ML) é pior.
- A "imprecisão da faixa de tarifa fixa" que o ADR-0020 delegava ao semáforo deixa de
  existir no ramo sem concorrente: o gross-up agora cumpre o piso de fato.
