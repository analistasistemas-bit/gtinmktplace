# ADR-0176 — Vitrine: visitas e conversão da conta, com lista "Onde agir"

- **Status:** Aceito (2026-10-02) — implementado
- **Data:** 2026-10-02
- **Relacionados:** ADR-0172 (Vendas SKU — coleta de visitas e Ads, Fatias 2b/2c), ADR-0047 (menu por papel), ADR-0037 (faturamento), ADR-0173 (fan-out por org)

## Contexto

O ADR-0172 já coleta visitas por MLB × dia (`ml_item_visitas_dia`, carga inicial de 150 dias, retenção
de 13 meses), gasto de Ads por grupo e vendas com tarifa. Mas a conversão só aparece **dentro do
Dossiê de um SKU** ("Unidades por visita"). Não há visão da conta inteira nem comparação entre anúncios.

Referência de mercado: a página "Visitas & Conversão" de um concorrente (KPIs, mapa de calor, tabela por
dia da semana, evolução semanal, frases automáticas). Na escala da Avil (~240 pedidos/mês), mapa de calor
e tabela por dia da semana mostram ruído (~35 pedidos por dia da semana em 4 semanas) e não apontam
**qual anúncio** mexer.

Feature é só leitura sobre dados já coletados — **nenhuma coleta nova no ML**.

## Decisões

**D-1 — Pergunta da tela.** Pulso da conta no topo + lista **Onde agir** (anúncios que pedem ação) embaixo.
A lista é o diferencial; o pulso é contexto.

**D-2 — Nome e lugar.** **Vitrine** ("Quem vê seus anúncios e quem compra"), item próprio no menu
(`/vitrine`, nova `MenuKey`), entre Pulse e Faturamento. Evita parecer cópia e não colide com
Pulse/Radar/Sonar (que olham o mercado, não o nosso tráfego).

**D-3 — Métrica.** **Conversão = pedidos faturáveis ÷ visitas, em %**, por pedido (order), não pack;
cancelado não conta (`ehFaturavel`). "Unidades por visita" segue só no Dossiê. Motivo: comparar anúncios
pela pergunta "a visita virou compra?" — pedido de 10 unidades distorceria o ranking — e bater com o que o
vendedor vê no ML.

**D-4 — Dias sem dado.** Período termina em **D-3**: o coletor só marca `ok` 48 h após o **fim** do dia, então D-2 ainda é
`pendente` (medido em 02/10: 24–29/09 `ok`, 30/09 `pendente`). A tela diz isso. Soma só
pares MLB × dia `ok`; dia sem linha conta como não-`ok` (grade MLB × dia); vendas de **kit virtual**
contam no MLB do kit (`ml_vendas.kit_item_id`), não no componente; pedidos contam **nos mesmos pares**. **Cobertura** < 95% → aviso discreto; < 80% →
número vazio. Rejeitado: regra estrita do Dossiê (na conta inteira deixaria a tela quase sempre vazia) e
incluir hoje (queda falsa diária). Não há banner de "vendas não importadas": vendas entram por webhook +
reconciliação horária + backfill.

**D-5 — Pulso da conta.**
- KPIs: Visitas, Conversão, Venda por visita — cada um com Δ vs período anterior de mesmo tamanho.
- 1 gráfico semanal: visitas (barras) + conversão (linha), eixo duplo.
- "O que os números dizem": até 3 frases **determinísticas** (sem IA), só quando a diferença passa uma
  trava estatística (mínimo de pedidos por grupo, ~30); recorte por dia da semana só com ≥ 12 semanas.
- Períodos: 4 sem · 12 sem · 6 meses (coleta guarda 150 dias de carga inicial).
- **Fora:** mapa de calor, tabela por dia da semana, tarifa por visita.

**D-6 — Onde agir.** Universo: anúncios ativos. Um rótulo por anúncio (o de maior impacto):

| Rótulo | Critério (calibrado) | Ação sugerida |
|---|---|---|
| Invisível | ativo (o ML pausa anúncio sem estoque), 7 dias `ok` com 0 visitas **e esperado7 ≥ 3** (esperado7 = visitas dos outros dias medidos do período × 7 ÷ nº desses dias; P(0 por acaso) ≈ 5%) | moderação/indexação — sempre no topo |
| Vitrine sem venda | ≥ 100 visitas e conversão < 50% da média da conta | preço/foto/título (link Dossiê) |
| Converte e ninguém vê | ≥ 5 pedidos, conversão ≥ 1,5× média, visitas < **p75 das visitas dos ativos que venderam ≥ 1 pedido**; selo "sem Ads"/"em Ads" | Ads |
| Perdendo visitas | ≥ 100 visitas no período anterior e queda > 30% | concorrência/posição |

Ordem por **pedidos em jogo** (mesma escala para todos): sem venda = visitas × (conv. média − conv.
anúncio); perdendo = visitas perdidas × conv. do anúncio; converte e ninguém vê = ganho com +50% de
visitas. Top 10 + "ver todos". **Limites calibrados com dados reais da Avil**
(ver Nota abaixo); cobertura por item ≥ 80%.

**D-7 — Onde roda.** 1 RPC SQL `vitrine_resumo(inicio, fim)` escopada por `current_org_id()`, só leitura:
KPIs (período e anterior), série semanal e uma linha por MLB (visitas, pedidos, cobertura, visitas do
período anterior, estoque, em Ads). Rótulos, pedidos em jogo e frases numa **função TS pura** no front.
Motivo: volume (dezenas de milhares de linhas MLB × dia) não cabe no navegador com `max_rows=1000`;
regras que vão ser calibradas ficam em TS (constante + teste, sem migration). Rejeitado: tudo no
navegador (paginação pesada a cada troca de período) e tudo no SQL (calibrar vira migration).

## Consequências

- Migration nova (RPC + backfill de `profiles.allowed_menus`), testada contra Postgres real. A RPC recusa
  período inválido ou > 182 dias.
- `MenuKey` nova também no espelho da edge `usuarios` (senão `sanitizeMenus` descarta a permissão) →
  redeploy de `usuarios`.
- Ads é por grupo (ADR-0172): o selo "em Ads" diz se o MLB pertence a algum grupo ativo, sem ratear gasto.
- Vínculo MLB→código é o atual (sem vigência histórica), herdado do ADR-0172.
- Fora de escopo: Shopee (E5), posição na busca, alertas/notificação dos rótulos.

## Nota — Implementação e calibração (2026-10-02)

- RPC `public.vitrine_resumo(p_inicio date, p_fim date) returns jsonb` (plpgsql, stable, security definer, `search_path ''`, escopo `current_org_id()`, grant só `authenticated`; recusa período nulo, invertido ou > 182 dias). Migration `20261002214830_vitrine.sql`, aplicada em produção por `supabase db push` em 2026-10-02; teste SQL `supabase/tests/vitrine.sql`. Edge `usuarios` redeployada (versão 43) por causa do `MenuKey` `vitrine`; backfill deu `vitrine` a quem tinha `faturamento`.
- Regras em TS puro (`src/lib/vitrine.ts`, `tests/lib/vitrine.test.ts`): período termina em hoje BRT − 3; presets 4 sem/12 sem/6 meses; cobertura < 95% avisa, < 80% esconde.
- Calibração (Avil, 4 semanas): com os limites iniciais, Invisível marcava 135 de 497 ativos (cauda longa que nunca teve visita) e Converte 0–1. Depois (esperado7 ≥ 3 e p75 dos vendedores): Invisível 11, Vitrine sem venda 22, Converte 5, Perdendo 9 (47 no total). Em 12 semanas: 14/42/18/2.
- Performance em produção (EXPLAIN ANALYZE, Avil, 575 MLBs): 284 ms (28 dias), 968 ms (182 dias).

## Nota — Identificação e dicas (2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-vitrine-melhorias-design.md`; plano `docs/superpowers/plans/2026-10-03-vitrine-melhorias.md`.

- Migration `20261003232750_vitrine_identificacao.sql` (aplicada em produção por `db push` em 2026-10-03): `ml_trafego_item` ganha `titulo`, `permalink` e `variacao` (nulas). `gravar_trafego_item` v2 (mesma assinatura, só `service_role`) aceita os 3 campos com `coalesce` — nulo nunca apaga.
- `vitrine_resumo` v3: título = primeiro não-nulo entre `ml_trafego_item.titulo` → cadastro (Legacy, UP, kit, catálogo, família) → vendas (antes, fonte com título nulo bloqueava as seguintes — caso MLB4876171545). Campos novos por item: `variacao` (`ml_trafego_item` → cor da venda mais recente) e `permalink` (`ml_trafego_item` → `anuncios_externos`/`_itens`; catálogo UP não usa `aei.permalink`; o front monta `https://produto.mercadolivre.com.br/MLB-<n>`).
- Coletor `coletar-trafego-ml` v6 (deploy 2026-10-03; `coletar-ads-ml` também v6 por compartilhar `_shared/trafego/fiacao.ts`): o multiget de status migrou para `/items/bulk?ids=…&attributes=status_code,body.id,body.status,body.title,body.permalink,body.attributes` (o ML exige sair de `/items?ids=` até 25/10/2026). O parser aceita envelopes `code` e `status_code`; `variacao` = `value_name` de COLOR · SIZE do item (Legacy com `variations` fica nula). Spike real (Avil, 20 MLBs): 200, ~0,37 s, ~58 KB, título/link 20/20.
- Coleta manual de validação só da Avil: título 575/575, variação 502/575; fingerprints md5 por org das tabelas de tráfego idênticos nas outras orgs. Os 36 anúncios "Fita de Cetim … Progresso N°03" passaram a ter 36 títulos e 35 cores distintas.
- Front: títulos com `formatarNomeProduto`; etiqueta de variação; ícone ↗ para o ML; ⓘ "O que é / Como ler" em Visitas, Conversão, Venda por visita, gráfico e Onde agir (legenda dos 4 rótulos: Significa / O que fazer / Por que entrou).
