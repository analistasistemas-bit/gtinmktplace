Você é revisor independente e cético de um PLANO de implementação (ainda sem código). Responda em português do Brasil, no máximo 600 palavras. Repo atual (somente leitura): PubliAI. Leia:
- docs/superpowers/plans/2026-11-08-galeria-da-cor.md (o plano v10 — alvo da revisão; v1 a v9 receberam REVISAR; a v10 incorpora a 9ª rodada, listada na seção "Mudanças da v10")
- docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md (regras)
- docs/decisions/0201-galeria-da-cor-por-ia.md (decisões do dono, §1–§13 — não reabra sem risco concreto)
Confira no código os pontos que o plano assume (ex.: supabase/functions/_shared/queue.ts, _shared/ml/atualizar-item.ts, _shared/ml/fotos.ts, _shared/ml/descobrir-familia-up.ts, supabase/migrations/20261108094500_platform_imagem_ia_metering.sql, src/pages/Publicados.tsx, vitest.config.ts).

A feature cobra o cliente por imagem e troca fotos de anúncios ativos no Mercado Livre: erro custa dinheiro e vendas.

Esta é a 10ª rodada. A decisão "teto por versão do roteiro" (R8.2) é do dono; não a reabra. O dono exige zero erro: só aprove se não houver BLOQUEADOR. Foque em defeitos que causem cobrança errada, dano a anúncio ativo, trabalho preso sem retomada ou premissa falsa sobre o código. Detalhes que a revisão de diff de cada task pega (cada task terá revisão sua) devem ser marcados como MENOR.

Entregue:
(a) VERDICT: APROVADO ou REVISAR.
(b) Confira a seção "Mudanças da v10": algum item mal resolvido? Depois, defeitos NOVOS do plano, cada um classificado BLOQUEADOR ou MENOR, mais graves primeiro (no máx. 8): task/step, o que está errado ou faltando (premissa falsa sobre o código, cenário que quebra, ordem de tasks errada, teste que não prova o que diz, risco de cobrança ou de dano ao anúncio, limite de CPU/tempo das edges), e a correção concreta.
(c) Algo na arquitetura (composição no navegador; QStash com consulta agendada para Higgsfield; função de cobrança compartilhada) que você mudaria e por quê.
Não escreva código.
