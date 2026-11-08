# ADR-0198 — Identidade do produto no título e produto sem eixo de cor

**Status:** Aceito
**Data:** 2026-11-07
**Decisores:** Diego
**Relacionado:** ADR-0004 (atribuição de cor), ADR-0044 (cor no título, emenda de 27/10), ADR-0098, ADR-0099 (slots), ADR-0115 (eixo de variação), ADR-0116 (descartes), ADR-0184 (grade)

## Contexto

Lote de cosméticos de 07/11/2026, 10 famílias de uma variação:

| Nome na planilha | Cor gravada | Título gerado |
|---|---|---|
| Tanox Pop Cabelos Exuberantes 1kg - Creme para pentear e hidratar 2 em 1 | Em 2 | Creme para Pentear Tanox Pop Cabelos Exuberantes 1kg em 2 |
| Creme 2 em 1 para pentear e hidratar BRILHO UVA 1kg | Outra | Creme 2 em 1 para Pentear e Hidratar 1kg |
| Creme 2 em 1 para pentear e hidratar NUTRIÇÃO MORANGO 1kg | Outra | Creme 2 em 1 para Pentear e Hidratar 1kg Vermelho |
| Máscara Hidrata Muito Mais Hair Fly | Outra | Máscara Capilar Hair Fly |
| Reparador de Pontas Umidibrilho Óleo de Argan 30ml | Outra | Reparador de Pontas Hair Fly 30ml Óleo de Argan |

Causas:

1. **`Em 2`:** `extrairCorECodigo` leu "2 em 1" como código 2 e cor "Em". Por ter origem `descricao`, a cor não passa pelo descarte de categoria sem `COLOR`.
2. **`Vermelho`:** o Vision leu a embalagem. `semRespaldo` manteve a cor porque a descrição traz "CORANTE VERMELHO 33" nos ingredientes.
3. **Nome comercial perdido:** `titulo_descartes` não registra esses nomes, nem no corte de 60 caracteres. O prompt só exemplifica `modelo` com numeração de aviamento, e o spike de 04/08 adiou linhas comerciais até entrar catálogo com elas. Esse catálogo entrou.
4. **`Outra`:** 113 famílias têm essa cor, e `publicar.ts` a envia como `COLOR`. A Revisão a exibe como se fosse cor.

Uma proposta externa sugeriu oito perfis por segmento e campos novos. Codex e Gemini avaliaram: o desenho de slots resolve os defeitos, e perfis não atacam nenhum deles. `max_title_length` medido deu 60 em 4 categorias.

## Decisão

1. **O desenho fica:** a IA extrai, o sistema monta. Sem perfis, sem slot novo, sem coluna nova.
2. **`modelo` carrega o nome comercial**, literal da fonte (submarca, versão, fragrância declarada). "2 em 1" fica em `produto`. O prompt ganha exemplos de cosmético.
3. **No corte, a identidade fica por último.** Ao estourar 60, `produto` primeiro cede a 2ª função ("para Pentear e Hidratar" → "para Pentear"), e `marca` sai antes de `modelo`: numeração e nome comercial distinguem o produto, a marca não. `modelo` segue cortável, para nenhum aviamento passar a dar erro por isso.
4. **Conector não é cor:** `{número} {conector}` não forma o padrão de código + cor.
5. **Só o nome respalda cor.** A descrição fica fora de `removerCorDosSlots`, porque ingrediente não é cor do produto. O pipeline do título também limpa `variacao` quando não há cor real e o slot traz uma cor que o nome não declara: assim "Regenerar copy" fica coberto. Calibre e tamanho seguem no slot (CRITICAL-2). `removerCorDaDescricao` mantém a fonte atual.
6. **Produto simples sem cor grava `cor = null` no CREATE:** categoria sem `COLOR`, `tipo_aviamento = 'outro'`, uma variação. Fita, linha e cola mantêm `Outra`, porque lá a cor é exigida e `null` travaria a Revisão. Várias variações e UPDATE também mantêm: a Revisão exige cor em variação nova de UPDATE.
7. **O envio ao ML não muda.** Quem nasce sem cor já publica `Único`. Trocar `Outra` por `Único` no payload foi rejeitado: a reposição tentaria renomear de volta, e User Products publica um SKU por vez, então a regra atingiria multicor. As 108 famílias publicadas com `Outra` ficam fora desta decisão.
8. **Revisão:** em produto simples, `Outra` aparece como campo vazio com placeholder "Sem cor", e o resumo diz "Produto único" em vez de "1 cores". O campo continua editável porque a categoria pode aceitar cor.
9. **Conferência determinística** na Revisão, sem bloquear:
   - palavras do nome da planilha fora do título, em produto simples;
   - título igual ao de outra família CREATE do lote.

## Medição no modelo real

`openai/gpt-4.1-mini`, os 10 produtos do lote, 4 chamadas cada, sem gravar nada:

| Prompt | Falhas | Observação |
|---|---|---|
| Antigo | 2 de 40 | o modelo já travava despejando espaços no JSON |
| Regras sem exemplo | 3 de 40 | Tanox e Umidibrilho perdem o nome |
| Final (regras + exemplos no formato de `EXEMPLOS`) | 0 de 40 | nome comercial em 4 de 4 no Brilho Uva, Nutrição Morango, Hidrata Muito Mais e Tanox; Umidibrilho em 1 de 4 |

Exemplos com `variacao=""` e seta travaram em 3 de 6 chamadas. Mudança neste bloco exige repetir a medição. Os exemplos usam produtos inventados, para a medição não premiar decoreba.

O modelo nem sempre devolve a forma exata dos títulos aprovados: "Creme 2 em 1 para Pentear e Hidratar Brilho Uva 1kg" é frequente, e "2 em 1" às vezes sai do Tanox. A marca entra quando está na fonte, como Hair Fly no Reparador. O nome comercial é o que a decisão garante; a forma exata fica para a Revisão.

## Consequências

- Prompt sozinho não garante: por isso a conferência (item 9) não depende da IA.
- Não é retroativo: o que está publicado não muda. Família pronta com `Em 2` ou `Outra` precisa de saneamento da cor e de "Regenerar copy".
- Os títulos aprovados em 07/11 viram testes de aceitação do pipeline.
- Deploy: `process-familia`, `regenerar-copy-familia` e toda função que importa `_shared/ai/titulo-pos.ts`.

## Fora de escopo

Perfis por segmento, limite por categoria, histórico de título gerado × publicado e otimização por cliques: nenhum resolve defeito medido. Reavaliar com dado.
