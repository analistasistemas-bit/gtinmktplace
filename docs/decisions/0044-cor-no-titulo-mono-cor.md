# ADR-0044 — Cor no título de anúncios mono-cor (anti-duplicado do ML)

> Renumerado de ADR-0035 → ADR-0044 em 2026-06-27 (resolução de colisão de numeração; ver `README.md`).

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

## Adendo (2026-07-10): gap no UPDATE ao vivo + remediação retroativa do incidente do lote #31

O fix de hoje cedo (`ehCorIndefinida()`, ver TASKS.md "Cor `Outra` vazava...") cobriu **CREATE**
(`process-familia`) e **regeneração manual** (`regenerar-copy-familia`), mas não o fluxo de
**UPDATE de anúncio já publicado**: `update-familia-ml` calculava a lista de cores da descrição
filtrando só `cor != null`, sem excluir o sentinela `'Outra'`. Ou seja, se uma família com
variação `cor='Outra'` sofresse qualquer sincronização de descrição (cor nova adicionada, por
exemplo), `'Outra'` voltaria a vazar — o mesmo bug, caminho diferente, ainda ativo em produção
enquanto isto não for corrigido.

Fix: `update-familia-ml` agora filtra `ehCorIndefinida()` (mesmo guard do CREATE) ao montar a
lista de cores antes de chamar `sincronizarDescricao`. `atualizarSecaoCores` (`ml/criar-item.ts`)
passou a remover a seção "🎨 CORES DISPONÍVEIS" inteira quando a lista de cores reais fica vazia
(antes deixava o cabeçalho pendurado sem nenhum item).

**Achado adicional ao investigar o alcance:** não existia nenhum mecanismo para corrigir o
**título** de um anúncio já publicado — só a descrição (`garantirDescricaoML`) tem push pós-
publicação. Título só era editável (`updateFamiliaTitulo`) ANTES de publicar, sem sincronizar
com o ML depois. Adicionada `atualizarTituloML()` (`ml/atualizar-item.ts`), PUT parcial
`{title}`, espelhando `atualizarStatusML`.

**Remediação retroativa (revisita a linha 47 "não retroativo" desta ADR, só para este incidente
confirmado):** o levantamento no banco achou **15 famílias** com o vazamento — **9 com "OUTRA"
no título** (todas já publicadas no ML, uma delas às 18:20 do mesmo dia, **depois** do fix de
hoje cedo, porque publicar reusa texto já persistido em vez de recalcular) e mais **5-6 só na
descrição** (retroagindo a 12/06 — bem anterior ao "lote #31" que motivou o fix original).
Corrigidos título+descrição no banco e ressincronizados no ML via `atualizarTituloML`/
`garantirDescricaoML` para os já publicados; corrigido só no banco para a família ainda não
publicada. Este é um saneamento pontual do incidente — a política "não retroativo" da linha 47
continua valendo para melhorias futuras de cor-no-título; não é uma mudança de política geral.

Deploy: `update-familia-ml` (filtro + `atualizarSecaoCores`), `publish-familia-ml`/
`publicar-anuncio` (recompilam `_shared/ml/criar-item.ts` e `_shared/ml/atualizar-item.ts`, sem
mudança funcional para eles).
