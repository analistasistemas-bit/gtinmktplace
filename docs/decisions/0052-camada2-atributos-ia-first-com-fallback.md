# ADR-0052 — Camada 2: atributos IA-first (inferência de texto-livre do próprio produto) + fallback manual

**Data:** 2026-07-01
**Status:** aceito e implementado — Camada 2A (inferência de texto-livre) e Camada 2B (fallback editor) concluídas e em produção (2026-07-01)
**Decisores:** Diego
**Relaciona:** estende [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E4 — atributos por IA), revisa [ADR-0049](0049-atributos-opcionais-e-numericos-por-ia.md) (que excluía texto-livre por inteiro) e continua [ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (robustez: nunca publicar sem validar)

## Contexto

Rumo a SaaS multiempresa, o objetivo é **publicar qualquer produto** com o mínimo de intervenção
humana. A ADR-0051 garantiu que nada publica errado (produto sem obrigatórios trava na revisão), mas
deixou uma lacuna de usabilidade: para produtos não-aviamento cujo obrigatório a IA não infere, o
operador não tem como resolver.

Diretriz do Diego (grilling 2026-07-01): **a IA deve resolver ao máximo; intervenção manual só em
último caso, quando a IA não conseguir de forma alguma.**

## Decisões

1. **A IA infere atributos de texto-livre obrigatórios A PARTIR do texto do produto.** Hoje a IA cobre
   closed-set e numéricos; texto-livre (`valueType='string'`) era 100% excluído (ADR-0049) por risco de
   invenção. Passa a ser incluído **só quando obrigatório** (`required`/`conditionalRequired`).
2. **Regra de ouro materializada como verificação:** um valor de texto-livre da IA só é aceito se
   constar (normalizado, sem acento/caixa) no **nome + descrição** da planilha. Assim "inferir do texto"
   deixa de ser promessa e vira invariante testável — a IA não pode inventar dado que não está na fonte.
   Se não constar, o atributo fica faltante (cai no fallback), nunca é chutado.
3. **Fallback = último caso, na própria Revisão.** Onde hoje o card de categoria mostra "Faltam: X"
   read-only, passa a ser **editável**, e o item fica **travado para publicar** enquanto houver
   obrigatório faltante. Sem tela nova, sem fila separada, sem notificação (podem vir depois).
4. **Fallback cobre só atributos** nesta fase. A categoria continua a que a IA (preditor) definiu;
   troca livre de categoria é fase posterior, só se surgir necessidade real.
5. **Edição manual sobrevive ao reprocessamento.** Nova flag `atributos_editados_pelo_operador` em
   `familias` + guarda em `process-familia` (espelha `titulo_editado_pelo_operador`): o reprocesso não
   sobrescreve atributos que o operador completou.

## Faseamento (2 planos independentes)

- **Plano A — Reforço da IA (backend puro).** Inferência de texto-livre obrigatório com a regra
  substring anti-invenção. Reduz travamentos sem tocar UI. `docs/superpowers/plans/2026-07-01-camada2a-ia-texto-livre.md`.
- **Plano B — Fallback manual (backend flag/edge + frontend editor).** Flag de atributos editados,
  edge function que expõe o schema da categoria, editor na Revisão, trava de publicação. Planejado
  após A ser validado (evita planejar UI sobre um backend que A pode mudar).

## Consequências

- Menos produtos travam sem violar "nunca inventar dado" — a regra vira código verificável.
- O ramo de aviamentos (determinístico) segue intocado; a inferência de texto-livre só age no caminho
  genérico e só em obrigatórios.
- Custo de IA: o prompt de atributos ganha mais alvos (texto-livre obrigatório) quando houver; zero
  chamada extra quando não houver alvo.
- Dívida multi-tenant registrada à parte: marca padrão `Avil` hard-coded (`atributos.ts`) → config por
  empresa quando houver multi-tenant real.

## Correção (2026-07-10) — atributo `string` com valores sugeridos era tratado como closed-set

Bug encontrado no Lote 31 (Pingentes MLB7017): o obrigatório `MATERIAL` (`value_type=string`, texto-livre
no ML, mas acompanhado de 4 valores *sugeridos*) ficava faltante mesmo quando o material constava no texto
(ex.: "FABRICADO EM 100% POLIÉSTER"). Causa: `tipoAlvo` em `_shared/ai/atributos-llm-core.ts` decidia o tipo
por `valores.length > 0` **antes** de olhar `valueType`, classificando o atributo como closed-set estrito. A
IA era então instruída a escolher só entre as sugestões e a regra de ouro (`validarTextoLivre`) nunca rodava.
Fix: `value_type=string` é sempre texto-livre — os `values` são sugestão, não lista fechada (essa é
`value_type=list`). Passa pela regra de ouro e aceita o valor extraído da descrição. Sem regressão para
`list`/`number`. As 2 famílias afetadas do Lote 31 foram corrigidas (02954818 resolvido; 02954524 segue no
fallback manual por não haver material na fonte).

### Adendo (2026-07-30) — cobertura máxima: multivalued + texto-livre opcional sem sugestão

Comparado ao "Sugerir características" nativo do ML, o pipeline preenchia bem menos atributos —
investigação achou que a informação estava na planilha, mas era descartada por 4 causas de código
(não falta de dado). Detalhe completo em
`docs/superpowers/specs/2026-07-30-atributos-ml-cobertura-maxima-design.md`.

1. **Decisão 1 (linha 20-22) revista.** Texto-livre deixa de ser restrito a atributos
   `required`/`conditionalRequired` — passa a tentar qualquer `valueType === 'string'` sem
   `values[]` sugeridos, com um denylist de atributos regulatórios/certificação (padrão de id
   `REGISTRATION|CERTIF|ANVISA|ANATEL|INMETRO|LICENSE`) fora do escopo. A regra de ouro (substring
   no nome+descrição) continua sendo o único portão de aceitação — não afrouxa, só amplia quais
   atributos chegam a ser tentados.
2. **Atributos `multivalued` deixam de ser banidos do alvo da IA.** Antes excluídos por completo
   (`TAGS_EXCLUIR`); passam a preencher **um único valor** (o melhor extraído do texto) — array
   multi-valor completo (a ML aceita repetir o id com vários `values`) fica fora de escopo, exigiria
   mudar o shape de `AtributoML` e o builder de publicação. `multivalued` continua banido do gate de
   obrigatórios (`TAGS_NAO_FALTANTE`) — divergência proposital entre os dois sets, comentada no
   código pra não ser revertida por engano.
3. **Guard de atributos `number_unit` fica mais estrito.** Antes só checava se o número aparecia em
   qualquer lugar do texto; passa a exigir sinal de unidade compatível (`unidadeBateContexto`, em
   `atributos-llm-core.ts`): aceita se QUALQUER ocorrência do número no texto tiver, perto, a mesma
   unidade da resposta (direto ou via sinônimo); só rejeita quando nenhuma ocorrência bate E existe
   pelo menos uma ocorrência com unidade reconhecida diferente (sinal confiável de confusão real,
   como "224 metros" virando `UNIT_WEIGHT: 224 g`). Comparação por ocorrência (não por conjunto
   global de unidades do texto) — evita que o mesmo número reaproveitado por outro atributo em outro
   trecho ("5 metros de fita e 5 ml de cola") derrube uma resposta correta. Usa uma tabela pequena e
   curada de sinônimo → unidade do schema (metro/m, quilo/kg, etc.), já que o texto da planilha usa a
   palavra por extenso e o schema da ML só expõe a forma abreviada. Limitação conhecida (documentada
   como `ponytail:` no código): a detecção exige unidade colada ao número (regex de adjacência), não
   entende frase com unidade não-adjacente ("224 de comprimento") — nesse caso, se o mesmo número
   aparecer noutro trecho com unidade adjacente conflitante, sub-preenche uma resposta correta. Nunca
   inventa, só perde cobertura; fica como teto aceito, não bloqueador desta entrega.
4. **Bug de tokenizer corrigido.** `validarTextoLivre` tokenizava por `split(/\s+/)`, então
   pontuação colada ("ALGODÃO.") quebrava o match contra a resposta limpa da IA ("algodão") mesmo a
   palavra estando literalmente no texto — provavelmente já causava perda silenciosa antes deste
   adendo, não só nos casos novos que ele destrava.

### Adendo (2026-07-10) — mesmo bug no fallback manual (`faltantes-editaveis.ts`)

02954524 (fallback manual, citado acima) expôs a mesma classificação errada num segundo lugar: `tipoDe`
em `_shared/categoria/faltantes-editaveis.ts` (editor "Complete para publicar") duplica `tipoAlvo` mas não
tinha recebido o fix — `MATERIAL` continuava aparecendo como `Select` fechado (Alpaca/Ouro/Prata/Vidro),
sem opção de digitar "100% Poliéster". Mesma correção aplicada: `value_type=string` → sempre `texto`,
checado antes de `valores.length`.
