# ADR-0035 — Cor no título de anúncios mono-cor (anti-duplicado do ML)

**Status:** Aceito
**Data:** 2026-06-22
**Relacionado:** [ADR-0003](0003-variacoes-agrupadas-por-pai.md) (agrupamento por PAI), [ADR-0004](0004-atribuicao-de-cor.md) (atribuição de cor), `_shared/ai/titulo.ts`, `process-familia`, `regenerar-copy-familia`

## Contexto

Quando duas famílias diferem **apenas na cor** mas vêm com `codigo_pai` distinto na planilha
(ex.: "ALFINETE N.0 PRATA" e "ALFINETE N.0 DOURADO"), o sistema cria **dois anúncios separados**
(uma família = um anúncio). O copywriter de IA é instruído a tratar o anúncio como agrupado
multi-cor e **remove a cor do título**. Resultado: os dois anúncios ficam com `titulo_ml`
**100% idêntico** → o Mercado Livre trata como duplicado e baixa o segundo
(`under_review` + `sub_status=forbidden`, "Era igual a outro anúncio"). Item nesse estado **não é
editável por API** (`item.title.not_modifiable` / `item.status.not_modifiable`); só recriando.

Incidente (2026-06-22): 3 alfinetes Prata (N.0/N.02/N.04) foram baixados — justamente os de
título idêntico ao par Dourado. O N.03 Prata, cujo título já continha "PRATA", permaneceu ativo.
Isso prova que **título diferenciado basta** para evitar a duplicação. Ver `reference_ml_duplicado_titulo_cor`.

Já existe o precedente de `garantirMetragemTitulo()`: uma rede de segurança **determinística**
que crava a metragem (10MT vs 100MT) no título mesmo quando a IA a descarta sob o teto de 60 chars.
A cor única tinha o mesmo problema e não tinha a mesma proteção.

## Decisão

Adicionar `garantirCorTitulo(titulo, cor, nCores)` em `_shared/ai/titulo.ts`, espelhando
`garantirMetragemTitulo`, encadeado logo após ela nos dois pontos que persistem o título
(`process-familia` na geração inicial e `regenerar-copy-familia` na regeneração manual).

Regras:
- **Só atua em anúncio de cor ÚNICA** (`nCores === 1` e cor real, ignorando o placeholder
  "(sem cor identificada)"). Multi-cor (variação de cor real) **não** leva cor no título.
- **Idempotente:** se a cor já está no título (palavra inteira, ignorando acento e caixa), não duplica.
- Crava a cor no fim do **1º segmento**, em CAPS. Para caber em 60 chars, derruba o "diferencial"
  genérico primeiro; em último caso apara o texto-base **preservando a cor** (dado diferenciador).

`nCores`/cor são derivados das variações da família (cores únicas não-nulas).

## Consequências

- Famílias-irmãs que diferem só na cor passam a ter títulos distintos → o ML não as baixa mais
  como duplicado. Prevenção determinística, à prova da IA descartar a cor sob o limite de 60.
- Anúncios **multi-cor** seguem sem cor no título (comportamento correto inalterado).
- **Não retroativo:** anúncios já publicados não são alterados (decisão do operador). A correção
  vale para novas gerações e regenerações de copy.
- **Edge — UPDATE que adiciona 2ª cor a uma família antes mono-cor:** o título não é regenerado no
  fluxo de UPDATE, então pode manter a cor antiga cravada. Aceito; o operador regenera a copy se quiser.
- Deploy: `process-familia` e `regenerar-copy-familia` (ambas importam `_shared/ai/titulo.ts`).
