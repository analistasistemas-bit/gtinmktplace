# ADR-0054 — Substantivo do tipo de produto via IA (categoria + título)

**Status:** Aceito
**Data:** 2026-07-02
**Decisores:** Diego
**Relaciona:** estende [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E3 — resolução de
categoria em camadas), [ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (fix do lote #49,
mesma classe de bug), [ADR-0052](0052-camada2-atributos-ia-first-com-fallback.md) (regra de ouro anti-invenção
de texto-livre)

## Contexto

O lote #50 trouxe 5 famílias com erro de categoria e uma com erro de título:

| Produto | Categoria atribuída | Origem |
|---|---|---|
| BAINHA INSTANTÂNEA 4MT UND | MLB1371 "Outros" | preditor |
| REMENDO MAGICO 1MT UND | MLB190440 "Outros" | preditor |
| EUROROMA 4/6 CORES 600G 610MT | MLB413317 "Corantes" (errada) | preditor |
| EUROROMA 4/8 CORES 600G 457MT | null | manual |
| EUROROMA 4/4 CORES 600G 915MT | MLB413317 "Corantes" (errada) | preditor |

O título gerado para os 3 EUROROMA também omitiu "BARBANTE" (ex.: `EUROROMA 4/6 600G 610MT | 85% ALGODÃO |
ALTA RESISTÊNCIA`), mesmo a palavra aparecendo repetidamente na `descricao_pai` da planilha ("BARBANTE 4/6...
O BARBANTE EUROROMA 4/6...").

### Investigação (root-cause, chamadas reais à API do Mercado Livre — não hipotética)

A resolução de categoria (ADR-0026) tem 4 camadas: override determinístico por regex → preditor nativo do ML
(`domain_discovery`, busca textual) → desempate por IA (só quando o preditor devolve ≥2 domínios distintos) →
manual. Nenhum dos 5 nomes bate no dicionário regex (`detectar.ts`), então todos caem no preditor.

- **EUROROMA → "Corantes":** o nome bruto da planilha ("EUROROMA 4/6 CORES 600G 610MT") é ruído de SKU pra
  busca textual do ML — a palavra "CORES" colide com "Corantes" (tingimento). Reformulando a query pra
  `"linha euroroma croche"` o preditor acerta de primeira: `MLB270273 Fios e Cadarços de Armarinho` — a mesma
  categoria do override de "linha". A causa raiz é o nome bruto não dizer o que o produto é fisicamente; a
  descrição sabe ("BARBANTE"), mas essa informação nunca chegava na busca de categoria nem no título.
- **BAINHA/REMENDO → "Outros":** testadas múltiplas reformulações de busca reais contra a API — nenhuma acha
  categoria específica melhor. O Mercado Livre genuinamente não tem categoria própria pra esses nichos (o
  candidato específico mais próximo pra "remendo mágico" é "Remendos" de **kit de bicicleta**, falso-amigo
  textual, fisicamente outro produto). "Outros" tecnicamente aceita listagem via API, mas é bucket genérico
  que o operador já reportou como problemático na prática.
- Uma revisão adversarial (2 críticos independentes) do desenho inicial encontrou um bug: se o candidato
  genérico for simplesmente removido da lista ANTES da IA de desempate decidir, e sobrar só o falso-amigo
  específico, a IA (hoje forçada a escolher um `category_id`) aceitaria o falso-amigo — pior que aceitar
  "Outros". Corrigido dando à IA permissão explícita de responder "nenhum serve" (`null`), distinta de falha
  técnica.

## Decisão

1. **`gerarCopy` (copywriter) ganha um 3º campo de saída no mesmo schema JSON estrito já existente:
   `tipo_produto_busca`** — um substantivo curto do tipo de produto (ex.: "barbante de crochê", "tesoura de
   costura"), validado deterministicamente: só aceito se pelo menos uma palavra significativa (≥3 letras)
   constar literalmente em nome ou descrição. Zero palavras significativas na frase → rejeita (nunca aceita
   por padrão). Mesmo espírito anti-invenção do ADR-0052, adaptado: aqui é uma frase de busca (pode combinar
   o substantivo grounded com contexto de uso genérico já permitido no prompt), não um valor literal extraído
   — por isso não usa o padrão de sequência contígua de `validarTextoLivre`.
2. **Esse campo alimenta uma 2ª chamada ao `domain_discovery`**, em paralelo com a busca pelo nome bruto
   (comportamento atual, inalterado). Candidatos das duas buscas são unidos (dedup por `category_id`, ordem
   bruta-primeiro — preserva os casos que hoje já classificam corretamente, lotes 42-49).
3. **Candidatos com nome de categoria genérico** ("outros", "diversos", "geral" etc., normalizado) **são
   separados dos específicos antes de qualquer decisão** e nunca podem ser a resposta final automática.
4. **A IA de desempate passa a rodar sempre que sobrar ≥1 candidato específico** (hoje só roda quando
   ambíguo) e ganha permissão explícita de abster-se (`category_id: null`). Abstenção deliberada, ou zero
   candidatos específicos → `origem: 'manual'`. Falha técnica (exceção/timeout) do LLM cai no comportamento
   resiliente de hoje (topo específico) — as duas falhas nunca compartilham o mesmo branch de código.
5. **O mesmo `tipo_produto_busca` vira guard determinístico de título** (`garantirTipoProdutoTitulo`, mesmo
   padrão de `garantirMetragemTitulo`/`garantirCorTitulo` já existentes): se o tipo de produto não aparece no
   título gerado, é prefixado (à frente da marca), cortando o segmento "diferencial" opcional se preciso pra
   caber em 60 caracteres. Conectado nos 3 pontos que chamam `gerarCopy` e montam título:
   `process-familia`, `regenerar-copy-familia` (endpoint manual do operador) e `titulo-particao.ts` (split de
   produto em N anúncios, ADR-0048).

## Fase 2 — adiada (YAGNI)

Considerado usar o `category_id` das ofertas de concorrentes (já buscado hoje pra preço via `/products/{id}/items`
— ADR-0014 — e já parseado em `_shared/concorrencia/parse.ts`, mas hoje descartado) como candidato adicional de
categoria. Testado empiricamente: pra EUROROMA, 17/17 e 11/11 concorrentes convergem unanimemente na categoria
correta (`MLB270273`) — sinal forte. Mas pra BAINHA, 3/3 concorrentes convergem unanimemente numa categoria
**absurda** ("Brinquedos de Pegadinhas") — provável colisão de GTIN/catálogo reaproveitado, não verdade. A
Fase 1 (dual query) já resolve os 2 casos onde o sinal de concorrente ajudaria (EUROROMA); nos outros não
fecha nada que a Fase 1 não feche sozinha, e "concordância unânime" não é garantia de correção (mesmo
problema que motivou a Decisão 4 acima — nunca aceitar cego). Fica registrado como melhoria futura, não
implementada agora.

## Consequências

**Boas:**
- Fecha a classe do bug do lote #50 pra qualquer produto futuro no ML (não é patch por palavra-chave —
  ADR-0051 já tinha feito esse patch pra "barbante" e o lote #50 reabriu a mesma classe com nomes novos).
- Título nunca mais omite o tipo de produto quando ele só existe na descrição — ganho de SEO/busca dentro do
  próprio ML, independente do bug de categoria.
- "Outros" nunca mais é aceito como resposta automática — fecha a reclamação específica do operador.

**Tradeoffs aceitos:**
- É solução **ML-only**: `domain_discovery` é API exclusiva do Mercado Livre. Não generaliza pro roadmap
  multicanal (E5 — Shopee); cada canal futuro vai precisar de resolvedor próprio.
- Mais 1 chamada de rede (`domain_discovery` com a query limpa) só no ramo sem override — custo/latência
  marginal, cacheado 30d como a busca bruta.
- A IA de desempate passa a rodar sempre que houver candidato específico (antes só em ambiguidade) — mais
  chamadas de IA, mas cada uma é barata (JSON schema estrito, sem geração longa).
- Quando o Mercado Livre genuinamente não tem categoria específica pra um nicho (bainha instantânea, remendo
  mágico), o item continua caindo em revisão manual — não é regressão, é o comportamento correto (nenhuma IA
  deveria inventar uma categoria que não existe na árvore do ML).

## Como reverter

Cada peça é isolada e resiliente: `tipo_produto_busca` vazio (validação falhou ou LLM não achou nada
grounded) faz o pipeline se comportar exatamente como hoje (1 busca, sem prefixo de título). Pra desligar por
completo, reverter o wiring em `process-familia/index.ts`, `regenerar-copy-familia/index.ts` e
`titulo-particao.ts` (não passar `tipoProdutoBusca`) e reverter `resolver.ts` pro comportamento anterior
(gate de ambiguidade `domains.size >= 2` em vez de "sempre que houver específico").
