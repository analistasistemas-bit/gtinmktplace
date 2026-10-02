# ADR-0176 — Vitrine: visitas e conversão da conta, com lista "Onde agir"

- **Status:** Aceito (2026-10-02) — design; implementação pendente
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

**D-4 — Dias sem dado.** Período termina em **D-2** (visitas fecham em 48 h) e a tela diz isso. Soma só
pares MLB × dia `ok`; pedidos contam **nos mesmos pares**. **Cobertura** < 95% → aviso discreto; < 80% →
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

| Rótulo | Critério inicial | Ação sugerida |
|---|---|---|
| Invisível | ativo, com estoque, 0 visitas há ≥ 7 dias | moderação/indexação — sempre no topo |
| Vitrine sem venda | ≥ 100 visitas e conversão < 50% da média da conta | preço/foto/título (link Dossiê) |
| Converte e ninguém vê | ≥ 5 pedidos, conversão ≥ 1,5× média, visitas < mediana; selo "sem Ads"/"em Ads" | Ads |
| Perdendo visitas | ≥ 100 visitas no período anterior e queda > 30% | concorrência/posição |

Ordem por **pedidos em jogo** (mesma escala para todos): sem venda = visitas × (conv. média − conv.
anúncio); perdendo = visitas perdidas × conv. do anúncio; converte e ninguém vê = ganho com +50% de
visitas. Top 10 + "ver todos". **Limites são iniciais**: medir contra dados reais da Avil e calibrar antes
do merge.

**D-7 — Onde roda.** 1 RPC SQL `vitrine_resumo(inicio, fim)` escopada por `current_org_id()`, só leitura:
KPIs (período e anterior), série semanal e uma linha por MLB (visitas, pedidos, cobertura, visitas do
período anterior, estoque, em Ads). Rótulos, pedidos em jogo e frases numa **função TS pura** no front.
Motivo: volume (dezenas de milhares de linhas MLB × dia) não cabe no navegador com `max_rows=1000`;
regras que vão ser calibradas ficam em TS (constante + teste, sem migration). Rejeitado: tudo no
navegador (paginação pesada a cada troca de período) e tudo no SQL (calibrar vira migration).

## Consequências

- Migration nova (RPC + `MenuKey` se houver CHECK/enum), testada contra Postgres real.
- Ads é por grupo (ADR-0172): o selo "em Ads" diz se o MLB pertence a algum grupo ativo, sem ratear gasto.
- Vínculo MLB→código é o atual (sem vigência histórica), herdado do ADR-0172.
- Fora de escopo: Shopee (E5), posição na busca, alertas/notificação dos rótulos.
