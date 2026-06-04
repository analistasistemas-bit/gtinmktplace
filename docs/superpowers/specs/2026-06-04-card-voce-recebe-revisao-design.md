# Spec — Card "Você recebe por venda" na Revisão

**Data:** 2026-06-04
**Status:** Aprovado (brainstorming)
**Marco:** M4 (Integração ML) — melhoria pós-bug-bash da Publicação CREATE

---

## Problema

Antes de publicar, o operador não tem como saber **quanto vai receber** por venda no Mercado Livre. O ML cobra uma comissão pesada em itens baratos (ex.: R$12,50 → comissão ~R$7,7, ou ~60% do preço), e isso muda conforme o anúncio é **Clássico** ou **Premium**. Hoje o operador só descobre isso depois de publicar, abrindo o anúncio no ML. Ele precisa decidir, **na própria tela de Revisão**, se vale a pena vender — e qual tipo de anúncio escolher.

## Objetivo

Mostrar na Revisão, por família, um card **"Você recebe por venda"** com:
- O **preço de publicação**.
- A **comissão exata** (percentual + tarifa fixa) e o **líquido** ("você recebe"), comparando **Clássico vs Premium** lado a lado.
- Um **alerta genérico** sobre o frete grátis automático do ML acima de R$19 (custo variável, não calculado).

## Contexto técnico (descoberto na investigação)

### Como o ML cobra por venda
São dois custos distintos:

1. **Comissão de venda** — sempre cobrada. `percentual + tarifa fixa`:
   - Percentual varia por **categoria** e **tipo de anúncio** (Clássico < Premium).
   - Tarifa fixa só em itens baratos (< ~R$29); some acima disso.
   - Exemplo real (categoria linha MLB270273, R$12,50): Clássico R$7,68 (11,5% + R$6,24) · Premium R$8,30.
   - **Obtível com precisão** via `GET /sites/MLB/listing_prices?price=&category_id=&listing_type_id=` → campo `sale_fee_amount` (e `sale_fee_details` com `percentage_fee`, `fixed_fee`).
   - O que o resumo do ML decompõe como "Tarifa de venda" (o %) + "Custo de envio" (a tarifa fixa, nome enganoso) **é a comissão** — não é frete logístico.

2. **Frete logístico** — só sai do bolso do vendedor quando a compra atinge **R$19** (programa "Frete grátis acima de R$19", automático para itens no Mercado Envios `me2`). Abaixo disso, o comprador paga.
   - **NÃO é obtível com precisão** via API: os endpoints de custo de frete do vendedor retornam 403 (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`); o endpoint que funciona (`/users/{id}/shipping_options?zip_code=&dimensions=`) devolve o **frete cheio** (ex.: R$47,70), **sem** os subsídios do ML que reduzem o valor real (~R$7–14). Além disso depende de dimensões reais (que a planilha não traz — vêm como placeholder 0,1 cm), CEP do comprador e reputação.
   - **Decisão:** não calcular o frete. Apenas alertar.

### Restrição de arquitetura
O frontend **não tem** o token OAuth do ML (fica no Vault, lado servidor). Toda chamada a `/listing_prices` precisa ser **server-side** (edge function).

## Escopo

**Inclui:**
- Edge function que calcula a comissão (Clássico e Premium) para um preço + categoria.
- Card visual na Revisão comparando os dois tipos e mostrando o líquido.
- Alerta genérico de frete acima de R$19.

**Não inclui (YAGNI):**
- Cálculo do frete logístico (não obtível com confiabilidade).
- Persistência da comissão no banco (cálculo on-demand; o preço é editável e mudaria o valor).
- Escolha de Clássico/Premium por família (segue só no modal de publicação, como já é).

## Arquitetura

### Backend — edge function `calcular-tarifa-ml`

- **Entrada:** `{ preco: number, categoria_ml_id: string }` (POST, autenticado com JWT do usuário, padrão das demais edges de leitura).
- **Processo:**
  1. `getValidAccessToken(user_id)` (reusa o helper existente, ADR-0012).
  2. Duas chamadas a `GET /sites/MLB/listing_prices?price={preco}&category_id={categoria}&listing_type_id={gold_special|gold_pro}`.
  3. Para cada tipo, extrai `sale_fee_amount`, `sale_fee_details.percentage_fee`, `sale_fee_details.fixed_fee`.
- **Saída:**
  ```json
  {
    "classico": { "comissao": 7.68, "percentual": 11.5, "fixa": 6.24, "recebe": 4.82 },
    "premium":  { "comissao": 8.30, "percentual": 16.5, "fixa": 6.24, "recebe": 4.20 }
  }
  ```
  onde `recebe = round(preco - comissao, 2)`.
- **Cache (Redis, reusa `_shared/redis/client.ts`):** chave `tarifa:{categoria}:{preco_2casas}`, TTL ~6h. Comissões mudam raramente; evita repetir chamadas ao reabrir famílias.
- **Resiliência:** se uma chamada a `/listing_prices` falhar (rede, 4xx, sem token), a edge retorna `{ erro: true }` (HTTP 200) — o card mostra "indisponível", a Revisão não quebra. Mesma filosofia da busca de concorrência (ADR-0014).
- **Função pura testável:** `montarTarifa(preco, listingPriceClassico, listingPricePremium)` em `_shared/ml/tarifa.ts` — recebe os dois JSON do ML e devolve a saída acima. TDD cobre: cálculo de `recebe`, arredondamento, e o caso de `fixed_fee` ausente (itens > R$29).

### Frontend

- **Client lib** `src/lib/tarifa.ts`: `calcularTarifaML(preco, categoriaMlId)` → chama a edge com o JWT da sessão; retorna o objeto tipado ou `null` em erro.
- **Hook** `useTarifaML(preco, categoriaMlId, enabled)` (TanStack Query): `queryKey: ['tarifa', categoriaMlId, preco]`, `enabled` quando a família está expandida e tem categoria. O cache do React Query evita rechamadas; ao editar o preço, a key muda e recalcula automaticamente.
- **Componente** `CardVoceRecebe` (novo, `src/components/card-voce-recebe.tsx`): recebe `preco` e `categoriaMlId`, usa o hook, renderiza:
  - Linha "Preço de publicação: R$X".
  - Tabela Clássico × Premium: Comissão (−R$ e %) e Recebe (R$), destacando o de **maior líquido**.
  - Estado de carregamento ("calculando…") e de erro ("tarifa indisponível").
  - Nota fixa: *"Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região)."*
  - Sem categoria (`categoriaMlId` nulo): não renderiza o card (ou mostra "defina a categoria").

### Integração no Painel de Análise

`PainelAnalise` (`src/components/painel-analise.tsx`): a seção final passa de **largura total** para um **grid de 2 colunas**:
- Esquerda: **Potencial de venda** (atual).
- Direita: **Você recebe** (novo `CardVoceRecebe`).
- Se a família não tiver `analiseMercado` (sem Potencial), o card "Você recebe" ocupa a largura toda.
- O `preco` passado é o **preço de publicação** da família (hoje uniforme por produto). Como o card lê o preço atual do estado, reflete edições.

## Fluxo de dados

```
Revisão (família expandida)
  → PainelAnalise → CardVoceRecebe(preco, categoriaMlId)
    → useTarifaML  → calcularTarifaML → edge calcular-tarifa-ml
        → getValidAccessToken (Vault)
        → 2× GET /listing_prices (Clássico, Premium)  [cache Redis]
        → montarTarifa() → { classico, premium }
    ← render: comissão + recebe (Clássico vs Premium) + alerta de frete
```

## Tratamento de erros

| Caso | Comportamento |
|---|---|
| `/listing_prices` falha (rede/4xx) | edge retorna `{erro:true}`; card mostra "tarifa indisponível" |
| Sem token ML / refresh falha | idem acima (não quebra a Revisão) |
| Categoria indefinida | card não renderiza (operador precisa definir categoria antes) |
| Preço 0 / nulo | card não chama a edge (sem preço não há o que calcular) |

## Testes

- **Backend (TDD, vitest):** `montarTarifa` — cálculo de `recebe`, arredondamento 2 casas, `fixed_fee` ausente (item > R$29), percentuais distintos Clássico/Premium.
- **Frontend:** teste do `CardVoceRecebe` cobrindo render do líquido, destaque do maior, estado de erro/loading. (UI cosmética detalhada não precisa de teste — regra do projeto.)
- A orquestração da edge (fetch + token + Redis) não é testável em unidade (restrição do vitest, igual às demais edges) — validada no bug bash.

## Bug bash (validação manual)

- Expandir uma família com categoria definida → card mostra comissão Clássico/Premium coerente com o que o ML cobra.
- Editar o preço → card recalcula.
- Comparar o "recebe" exibido com o "Você recebe" do anúncio real publicado (deve bater ~centavos; diferença é desconto de reputação que a API não reflete).

## Fora de escopo / decisões registradas

- **Frete logístico não é calculado** — limitação da API do ML (403 nos endpoints de custo do vendedor; o endpoint disponível dá frete cheio sem subsídios). Tratado como alerta genérico.
- **Sem coluna nova no banco** — cálculo on-demand, pois o preço é editável na Revisão.
- A pequena divergência entre o líquido calculado e o exibido pelo app do ML (centavos) vem de descontos de reputação/promoção que o `/listing_prices` não reflete; aceitável para a finalidade de decisão.
