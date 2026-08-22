# ADR-0131 — Sugestão de categoria pela ficha de catálogo (pré-publicação)

**Status:** Aceito
**Data:** 2026-08-22
**Decisores:** Diego
**Relaciona:** estende [ADR-0057](0057-categoria-selecao-livre-e-sugestao-concorrente.md) (padrão de
sugestão não-vinculante — coluna persistida + card clicável — que este ADR reusa para uma 2ª fonte);
[ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (Fase 2 rejeitada — por que a categoria do
concorrente/catálogo nunca pode ser aplicada automaticamente); [ADR-0021](0021-vinculacao-automatica-ao-catalogo-ml.md)
(trava `fichaEquivalente`, opt-in de catálogo pós-publicação); [ADR-0036](0036-alerta-catalogo-no-match.md)
(alerta Telegram `ficha_divergente`, agora enriquecido). Design completo:
`docs/superpowers/specs/2026-08-22-sugestao-categoria-catalogo-design.md`.

## Contexto

A categoria de um anúncio é decidida em `process-familia` (`resolverCategoria`) sem olhar o catálogo
do Mercado Livre. O catálogo só entra em cena depois de publicado, no worker `vincular-catalogo`, que
grava `catalog_status='ficha_divergente'` quando a ficha do GTIN vive num domínio diferente da
categoria escolhida — nesse ponto o anúncio já nasceu na categoria errada, e trocar categoria de um
item **já ativo** é proibido no projeto (risco de re-moderação).

**Caso motivador (lote 21, 2026-08-22):** a família Eucerin Aquaphor 55ml (GTIN `4005800223136`) foi
publicada em "Bebês > Cremes, Pomadas e Óleos" (domínio `MLB-BABY_CREAMS_AND_OINTMENTS`), mas a
única ficha de catálogo do GTIN vive no domínio `MLB-BODY_SKIN_CARE_PRODUCTS` (7 vendedores
competindo). O preditor de categoria nem cogitou esse domínio. `ficha_divergente` só foi descoberto
pelo Diego depois de publicado, exigindo republicação manual (pausar → trocar categoria no banco →
republicar) — o app não tinha nenhum sinal disso antes de publicar.

## Decisão

Estender o padrão já em produção do ADR-0057 (sugestão do concorrente: coluna persistida + card
clicável não-vinculante) para uma segunda fonte de sugestão: a categoria cujo domínio bate com a
ficha de catálogo real do GTIN, quando ela diverge da categoria escolhida pelo resolver. **Nunca
aplicada automaticamente** — mesmo racional do ADR-0054 Fase 2 (aplicar categoria de terceiro sem
confirmação humana já produziu categoria absurda por colisão de GTIN/ficha; "tem ficha" não é
"categoria certa", trocar de categoria é decisão comercial do operador).

**Contratos de API validados com token real em 2026-08-22:**
- `GET /categories/{id}` → `settings.catalog_domain`, mesmo formato do `domain_id` devolvido por
  `/products/search` (comparável por igualdade de string direta). Probes: `MLB277750` →
  `MLB-BABY_CREAMS_AND_OINTMENTS`; `MLB1262` → `MLB-BODY_SKIN_CARE_PRODUCTS`.
- `GET /products/{fichaId}/items` (mesmo endpoint que o ADR-0057 já usa para o concorrente) →
  `results[].category_id`. Probe: `MLB19462147/items` → 7 resultados, todos `category_id: "MLB1262"`.

**Implementação (Tasks 1–6, commits `7c42eab3`..`6db62f84`):**
1. **3 colunas aditivas em `familias`** (migration `20260822201053_sugestao_categoria_catalogo.sql`):
   `catalogo_categoria_sugerida_id`/`_nome`/`_vendedores` — mesmo padrão de
   `concorrencia_categoria_id`.
2. **Funções puras em `_shared/ml/catalogo.ts`:** `montarEsperadoPrePublicacao` (monta o `esperado`
   pré-publicação a partir de `atributosMl` já calculado, com `domainId` deliberadamente `null` — a
   divergência de domínio É o sinal, preenchê-lo suprimiria toda sugestão), `deveSugerirCategoriaPorFicha`
   (gate puro: só sugere quando os domínios divergem E a ficha passa na trava anti-kit
   `fichaEquivalente` já existente) e `buscarCategoriaFicha` (busca a categoria real onde os itens da
   ficha competem, reusando `parseItensProduto` do ADR-0014 — mesmo endpoint do concorrente).
3. **`buscarDominioCategoria` em `_shared/ml/domain-discovery.ts`** — espelho de `buscarNomeCategoria`
   (guard anti-SSRF `ehCategoriaMlValida`, cache Redis 30d), resolve o domínio da categoria escolhida
   via `settings.catalog_domain`.
4. **`process-familia` (`sugestao-catalogo.ts` + fiação em `index.ts`):** `calcularSugestaoCatalogo`
   orquestra as chamadas acima e persiste as 3 colunas no mesmo UPDATE final que já grava
   `concorrencia_categoria_id`. Roda **só no fluxo CREATE** — o early-return do UPDATE parcial
   (`index.ts`, antes do bloco) segue intocado, de propósito: categoria de anúncio publicado não pode
   mudar, sugerir troca ali seria convite ao incidente reverso. Usa o GTIN da variação principal (1
   chamada só — cores irmãs vivem no mesmo domínio). Best-effort: qualquer falha (rede, ficha não
   encontrada, domínio ausente) não persiste nada, não lança, não afeta o resto do processamento.
5. **`vincular-catalogo`:** quando o alerta dispara com `ficha_divergente > 0` e a família tem
   `catalogo_categoria_sugerida_id` preenchido, `montarMensagemCatalogoNoMatch` ganha uma linha
   citando a categoria sugerida (`CatalogoNoMatchAlerta.categoriaSugerida`). Família de UPDATE tem as
   colunas nulas (sugestão não roda ali) → linha omitida, comportamento atual preservado.
6. **`card-categoria.tsx`:** componente `SugestaoCatalogo` renderiza direto da row (`familia.catalogoCategoriaSugerida*`,
   sem `atributos-familia`, sem rede, sem o lazy-load-on-focus que o card do concorrente usa) sempre
   que a coluna estiver preenchida e a sugestão diferir da categoria atual. Quando as duas sugestões
   (concorrente e catálogo) apontam a mesma categoria, só o card do catálogo aparece (sinal mais rico
   — dois cards idênticos seria ruído). Clique chama o mesmo `definirCategoriaLivre` já existente.

**O que fica igual:** `resolverCategoria` não muda (a sugestão é só informativa, calculada depois); a
trava `fichaEquivalente` e o opt-in pós-publicação do `vincular-catalogo` não mudam;
`definir-categoria-familia` não muda de contrato.

## Consequências

**Boas:**
- Fecha a classe de problema para qualquer produto com ficha de catálogo em domínio diferente da
  categoria escolhida — não só o Aquaphor — sem esperar o operador notar via Telegram.
- Reaproveita quase toda a infraestrutura do ADR-0057 (trava anti-kit, contrato de sugestão,
  componente de card, fluxo de aplicar) — pouco código genuinamente novo.
- Alerta pós-publicação fica mais acionável (já vem com a categoria alternativa).

**Tradeoffs aceitos:**
- +2 a 3 chamadas ao ML por família CREATE com GTIN válido (busca de ficha + domínio da categoria,
  cacheado 30d + itens da ficha quando diverge) — mesma característica das chamadas já aceitas pelo
  ADR-0057 (cacheável, barata, best-effort).
- Só a variação principal é consultada: família cuja ficha só existe no GTIN de outra cor fica sem
  sugestão (aceito — 1 chamada previsível em vez de N).
- A sugestão do catálogo pode coincidir com a do concorrente (mesmo endpoint `/products/{id}/items`)
  — o valor novo é o sinal de divergência + a trava anti-kit + a visibilidade sem foco, não a
  categoria em si.
- Categoria "com ficha" continua podendo ser semanticamente pior que a categoria escolhida
  originalmente (ex.: Aquaphor em "Cuidado do Corpo" vs. "Bebês") — por isso a decisão final é sempre
  do operador, **nunca automática**.
- **UPDATE parcial não calcula sugestão de propósito** — a etapa fica antes do fluxo CREATE-only;
  reingerir uma família via UPDATE não atualiza uma sugestão eventualmente desatualizada até a
  próxima vez que a família passar por CREATE.

## Como reverter

Aditivo: checkout dos arquivos tocados (`process-familia/index.ts`, `process-familia/sugestao-catalogo.ts`,
`_shared/ml/catalogo.ts`, `_shared/ml/domain-discovery.ts`, `card-categoria.tsx`, `src/lib/queries.ts`,
`src/lib/tipos-dominio.ts`, `vincular-catalogo/index.ts`, `_shared/notificacoes/telegram.ts`) + drop
das 3 colunas (nenhum dado derivado em outro lugar — dropar é seguro).
