# ADR-0195 — `publicado` exige escrita real, confirmação no canal e divisão por estoque

- **Status:** aceito
- **Data:** 2026-11-05
- **Decisores:** Diego
- **Refina:** ADR-0048 (split e teto), ADR-0088/0104 (User Products), ADR-0089 (atualização rápida)
- **Spec:** `docs/superpowers/specs/2026-11-05-confirmacao-ml-e-divisao-por-estoque-design.md`

## Contexto

A conferência do lote #68 da Avil (05/11/2026) leu no Mercado Livre as 1.354 variações de 127 famílias
marcadas `publicado`. Uma família, a Fita N.2 (`00446050`), não recebia estoque desde 03/08: três atualizações
terminaram `publicado` com HTTP 200 sem nenhuma escrita. A causa foi uma raiz em `anuncios_externos` com 77 filhos
reservados e nenhum item real, sobre um anúncio Legacy vivo. A falha só apareceu porque houve conferência manual.

Na mesma leitura, 61 cores da Linha 1500MT (`02835002`) estavam em 1.164 no ML pelo teto do ADR-0048: a família soma
226.110 e dois anúncios comportam 199.998.

## Decisão

1. **Sem item, sem sucesso.** Família com filhos UP e nenhum item real é erro antes de qualquer escrita, em somente
   estoque e em "Atualizar tudo". Em somente estoque, filho de SKU desejado que não está ativo com item, ou zero alvos,
   é erro. Cor sem linha filha segue ignorada enquanto houver alvo (ADR-0104 §4).
2. **Confirmação no canal.** `publicado` significa que o worker terminou. A conferência pós-escrita compara o ML com
   o valor enviado e mostra o resultado na tela. Ela só lê: nunca reenvia estoque sozinha.
3. **Divisão por estoque.** Anúncio acima de 99.999 é dividido: o sistema detecta e monta o plano, e o operador aprova
   com um clique. Exceção à ancoragem do ADR-0048, só nesse caso: a cor movida fica zerada na origem e passa a viver no
   destino. O teto segue como proteção até a aprovação.

## Alternativas rejeitadas

- **Mesma cor em dois anúncios com saldo dividido:** o push manda o saldo integral a cada anúncio do SKU.
- **Substituir o anúncio inteiro:** pausa o anúncio e perde histórico; mover 23 cores sem venda resolve a Linha.
- **Migrar para User Products:** bloqueado para família dividida (`migrar-preco-por-variacao/processar.ts`).
- **Varredura periódica de todas as famílias:** custo de chamadas sem caso que a conferência pós-escrita não cubra.

## Consequências

- `publicado` deixa de esconder falha de escrita; o operador vê confirmação ou erro.
- Criação UP interrompida antes de gravar qualquer ID exige correção manual.
- Divisão aprovada cria anúncio novo sem histórico para as cores movidas.
