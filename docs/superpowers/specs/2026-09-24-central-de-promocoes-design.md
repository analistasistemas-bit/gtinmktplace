# Central de Promoções do ML — design

**Data:** 2026-09-24 · **ADR:** [0170](../../decisions/0170-central-de-promocoes-ml.md) · **Origem:** roadmap de melhorias, iniciativa I1 (MVP)

## Problema

O ML convida os anúncios da conta para promoções com preço já descontado. O operador decide no Seller
Center olhando só preço — ninguém mostra o líquido. Resultado possível: aderir no prejuízo, ou o ML
inscrever sozinho (`SMART`) e ninguém perceber. Spike de 2026-09-21: a API `/seller-promotions` responde
200 nas contas Avil e DSA (12 promoções, 504 convidados na 10.10).

**Trabalho único da tela:** responder "vale entrar nesta campanha, e com quais anúncios?".

## Decisões do Diego (2026-09-24, grilling)

1. Anúncio convidado **fora do PubliAI** aparece (⚪, "Sem custo no PubliAI"), sem semáforo.
2. Anúncio mostra a **pior cor**; abrir o anúncio mostra o líquido de cada cor.
3. Campanha com faixa: semáforo no **preço sugerido** + coluna **"Até quanto descer"**.
4. **Sync a cada 6 h** gravado no banco + botão **"Atualizar agora"**; tela mostra "atualizado há X".
5. Alertas: **participando no prejuízo** e **prazo de adesão ≤ 48 h** com convidados 🟢.
6. **Módulo por org**, nasce desligado (Avil → DSA). Alertas com switch próprio, desligado.
7. Layout **campanhas → detalhe** (cards de campanha, clique abre a tabela de anúncios).
8. Tabela completa: preço → promo, ML banca, líquido + markup, até quanto descer, "Abrir no ML".
9. Vocabulário: **Líquido + Markup** (o do resto do app). Nada de "margem %"/"lucro".
10. **Cupom** = card informativo, sem cálculo.
11. Menu **"Promoções"** de 1º nível, logo após Publicados.

Termos definidos em `docs/reference/glossario.md` § Promoções.

## Dados

### `ml_promocoes` (uma linha por promoção da conta)

| Coluna | Origem |
|---|---|
| `org_id`, `promocao_id` (PK composta) | org da conexão; `id` da promoção (`PRICE_DISCOUNT` não tem id → não é listado como campanha, só aparece por item — fora do MVP) |
| `tipo`, `nome`, `status` (`pending`/`started`/`finished`) | `GET /seller-promotions/users/{uid}?app_version=v2` |
| `inicio`, `fim`, `prazo_adesao` | `start_date`, `finish_date`, `deadline_date` |
| `beneficios jsonb` | bloco de benefício/co-participação da promoção (cupom: valor e mínimo) |
| `bruto jsonb` | resposta crua (auditoria; a API muda sem aviso) |
| `sincronizado_em` | fim do sync que gravou a linha |

### `ml_promocao_itens` (uma linha por anúncio por promoção)

| Coluna | Origem |
|---|---|
| `org_id`, `promocao_id`, `ml_item_id` (PK composta) | `GET /seller-promotions/promotions/{id}/items?promotion_type=..&app_version=v2` (paginação por `searchAfter`) |
| `status` (`candidate`/`started`/...) | item |
| `preco_original`, `preco_promo`, `preco_min`, `preco_max`, `preco_sugerido` | `original_price`, `price`, `min/max/suggested_discounted_price` |
| `ml_pct`, `vendedor_pct` | `meli_percentage`, `seller_percentage` |
| `estoque_min`, `estoque_max` | `LIGHTNING` |
| `titulo`, `thumbnail`, `permalink`, `listing_type_id` | `GET /items?ids=` (multiget, 20 por chamada) |
| `projecao jsonb` | array por cor: `{ variation_id, cor, sku, custo, piso, origem, comissao, frete, aliquota_pct, liquido, ate_quanto }`; `custo`/`liquido` nulos = sem custo no PubliAI |
| `pior_semaforo` | calculado no sync (`vermelho` > `amarelo` > `verde`; `indisponivel` se nenhuma cor tem custo) — índice para filtro/contagem e para o alerta |
| `sincronizado_em` | idem |

### `ml_promocoes_sync` (uma linha por org)

`org_id` (PK), `estado` (`ok`/`sem_acesso`/`sem_promocoes`/`erro`), `iniciado_em`, `ultimo_ok_em`,
`ultimo_erro_em`, `erro text`. Alimenta "atualizado há X", o throttle do botão e os estados da tela.
Sem linha = nunca sincronizado.

RLS (as três tabelas): `select` com `org_id = current_org_id()`; `insert/update/delete` só service role. Encerradas ficam na
tabela; a UI mostra as de `fim >= now() - 30 dias`. Sync substitui os itens de cada promoção lida
(apaga os que não vieram mais) — o ML é a fonte.

## Cálculo (backend, no sync)

Por item convidado/participando, **no preço avaliado** (`preco_sugerido` se há faixa, senão `preco_promo`):

1. **Vínculo com o cadastro:** `montarMapasCusto` (`_shared/platform-admin/sales-costs.ts`) estendido com o
   **piso** (`variacoes.preco`) — mesma ordem do financeiro: `ml_variation_id` → `ml_item_id` → GTIN →
   código. Legacy: as cores vêm de `variations[]` do item (multiget). User Products: o item é a cor.
2. **Comissão:** `buscarListingPrice` no preço avaliado, `listing_type_id` real do item; cache Redis por
   `(categoria, listing_type, preço)`.
3. **Frete:** `buscarFreteVendedor` no preço avaliado (o frete grátis depende do preço); cache Redis.
4. **Imposto:** alíquota por origem da org (ADR-0055); org sem alíquota confirmada → falha LOUD do sync
   dessa org (ADR-0086), nunca 8/16 em silêncio.
5. **Líquido:** `liquidoClassico(preco, comissao, frete, aliquota)`. **ML banca não entra** até a regra ser
   conferida contra venda real (ADR-0170 §7) — a tela diz "não incluído".
6. **Até quanto descer** (só com faixa): gross-up de `_shared/preco/sugerir.ts` a partir do piso,
   recortado a `[preco_min, preco_max]`; `null` + motivo quando nenhum preço da faixa atinge o piso.

A tela aplica `calcularSemaforo(liquido, piso, custo)` e `calcularMarkup(liquido, custo)` sobre `projecao`.

## Worker `sincronizar-promocoes`

- **QStash** (assinatura válida, cron `0 */6 * * *`): todas as conexões ML de orgs com o módulo `promocoes`.
- **Usuário logado** (`requireUserOrg`): só a própria org; 403 se o módulo não estiver habilitado.
  Throttle: recusa se a org sincronizou há < 2 min (o botão fica desabilitado com a hora do último sync).
- Por org: lista promoções → para cada promoção `pending`/`started` (cupom só grava a linha), pagina os
  itens → multiget → cálculo → upsert. Concorrência limitada; falha de uma promoção não derruba as outras
  (registra `erro` na linha da promoção e segue).
- 403 / scope sem `offers` / lista vazia → grava `ml_promocoes_sync.estado` (`sem_acesso`,
  `sem_promocoes`, `erro`) para a tela explicar — nunca erro genérico.
- Fim do sync → avalia alertas (abaixo).

## Alertas

Gate: `configuracoes.alertas_promocoes_ativo` (default `false`, admin edita em Configurações >
Notificações, grant `select` da coluna para `authenticated`). Destinatários: assinantes de `financeiro`
via `notificarCategoria` (Telegram + sino).

- **Participando no prejuízo:** itens `started` com `pior_semaforo = 'vermelho'`, dedup
  `reservarNotificacao(org, 'promo_prejuizo', promocao_id:ml_item_id)`.
- **Prazo acabando:** promoção `pending` com `prazo_adesao` em ≤ 48 h e ≥ 1 convidado `verde`, dedup
  `reservarNotificacao(org, 'promo_prazo', promocao_id)`.

Uma mensagem agregada por org por sync (até 10 anúncios listados + "e mais N"), só com o que reservou
agora — o primeiro sync não despeja o histórico (lição ADR-0121).

## Design da tela

**Modo:** sistema — herda tokens de `src/index.css`, componentes de `src/components/ui` e o idioma de
Publicados/Faturamento. Nada inventado: nenhuma cor, fonte ou componente novo.

**Hierarquia:** o número que o operador veio buscar é a **contagem por semáforo** no card e o **líquido**
na tabela; o resto é contexto.

### Rota e navegação

`/#/promocoes` e `/#/promocoes/:promocaoId`. Menu "Promoções" (ícone lucide `BadgePercent`) após
Publicados, escondido sem o módulo (`menusDeModulosDesabilitados`). `CanalTabs` no topo, como nas telas
multicanal (com 1 canal, só ML).

### Tela 1 — campanhas

```
PageHeader  Promoções                         Atualizado há 2 h  [Atualizar agora]
Tabs        Ativas (11) · Futuras (1) · Encerradas
Grid de cards (1 col mobile, 2 md, 3 xl), ordenado por prazo mais próximo:

┌ 10.10 ─────────────────────── DEAL · Futura ┐
│ Adesão até 12/10, 18h  (StatusPill warning se ≤ 48 h)
│ 504 anúncios convidados
│ [✓ 310 Vale a pena] [! 120 Abaixo do mín.] [✕ 40 Prejuízo] [? 34 Sem custo]
└──────────────────────────────────────────────┘
┌ Smart ───────────────────────── SMART · Ativa ┐
│ ML banca até 60% · 12 participando
│ ⚠ 2 participando no prejuízo   (StatusPill danger — o que mais importa)
└──────────────────────────────────────────────┘
┌ Cupom VOLTA10 ─────────────── Cupom · Ativo ┐
│ 10% · compra mínima R$ 50 · até 30/10
│ Cupom vale no carrinho; sem cálculo de líquido.
└──────────────────────────────────────────────┘
```

Contagens em `StatusPill` com os mesmos tons/ícones do `SemaforoPreco` (success/warning/danger/neutral),
`tabular-nums`. Card inteiro é o alvo do clique (≥ 44 px), com `:focus-visible` do sistema.

### Tela 2 — detalhe da campanha

```
Breadcrumbs  Promoções › 10.10
PageHeader   10.10 · DEAL · Futura       Adesão até 12/10, 18h        [Abrir no Seller Center ↗]
Filtros      [Todos 504] [Vale a pena 310] [Abaixo do mín. 120] [Prejuízo 40] [Sem custo 34]
             [Convidados | Participando]
DataTable
  Semáforo | Anúncio (thumb + título + MLB) | Preço → Promo (−17%) | ML banca | Líquido · Markup | Até quanto descer | ↗
```

- Colunas numéricas alinhadas à direita, `tabular-nums`; ordenação por Líquido, Preço promo e Markup
  (`sortValue`); default: pior semáforo primeiro.
- "ML banca 30%" com tooltip "Parte do desconto paga pelo Mercado Livre — não incluída no líquido"
  (enquanto ADR-0170 §7 não for confirmado).
- "Até quanto descer": valor em R$, ou "Qualquer preço da faixa", ou "Nenhum preço da faixa atinge o mínimo".
- Relâmpago: badge "Estoque mín. N" junto ao título.
- **Clique na linha → `Sheet`** (painel lateral) com as cores: cor, custo, mín. líquido, líquido,
  markup, semáforo. A `DataTable` compartilhada não ganha linha expansível.
- "↗" abre o `permalink` do anúncio; o botão do cabeçalho abre a área de promoções do Seller Center.
- Linhas ⚪ ficam com o texto em tom `muted`, sem semáforo, com "Sem custo no PubliAI".
- Mobile: a tabela vira a mesma `DataTable` com scroll horizontal no container (padrão de Publicados).

### Estados

| Estado | O que aparece |
|---|---|
| Carregando | `Skeleton` de 3 cards / 8 linhas |
| Nunca sincronizado | `EmptyState`: "Ainda não buscamos as promoções desta conta." + [Buscar promoções agora] |
| Sem promoções (`sem_promocoes`) | `EmptyState`: "O Mercado Livre não convidou seus anúncios para nenhuma promoção agora. Campanhas novas aparecem aqui sozinhas a cada 6 h." |
| Sem acesso (`sem_acesso`) | `EmptyState` warning: "O Mercado Livre não liberou promoções para esta conta. Isso depende da reputação da conta e da permissão de ofertas da conexão." + [Reconectar em Canais] |
| Erro no último sync (`erro`) | Dados antigos continuam; faixa `warning` no topo: "A última atualização falhou às 14h. Mostrando dados de 08h." + [Tentar de novo] |
| Promoção com erro parcial | Card com `StatusPill` neutral "Não foi possível ler os anúncios" |
| Sincronizando (botão) | Botão com o padrão de espera do ADR-0163; ao terminar, toast "Promoções atualizadas" |
| Aba vazia (ex.: nenhuma futura) | Texto curto na aba: "Nenhuma campanha futura." |

### Cópia

Sentence case, verbos diretos, termos do glossário. "Convidados"/"Participando" (nunca "candidatos").
"Atualizar agora" → toast "Promoções atualizadas". Nada de "margem", "lucro", emoji na UI.

## Critérios de aceite

1. Para uma campanha real da Avil, o líquido de cada cor bate com a conta da Revisão no mesmo preço
   (± arredondamento) — conferido por SQL + tela + chamada ao ML.
2. A contagem de convidados por campanha bate com o Seller Center (inclui os ⚪).
3. Campanha futura aparece com o prazo antes de começar.
4. Org sem o módulo: menu some e o worker responde 403.
5. Conta sem promoções / sem acesso mostra o estado explicado, não erro.
6. Primeiro sync com alertas ligados manda no máximo 1 mensagem por org.
7. Nenhuma escrita no ML (só GET) — verificável no código do worker.

## Fora do MVP

Aderir/remover pelo app; criar cupom; `PRICE_DISCOUNT` individual; histórico de performance por
campanha; Shopee; simulador de preço livre.

## Pendências técnicas (resolvidas no plano, antes do código que depende delas)

- **Regra do "ML banca" no líquido:** conferir contra venda real de item em `SMART` (`ml_vendas`).
- **Volume:** medir chamadas e tempo do sync da 10.10 (504) com cache; ajustar concorrência/intervalo.
- **Deep link do Seller Center** para a área de promoções: confirmar a URL atual.
