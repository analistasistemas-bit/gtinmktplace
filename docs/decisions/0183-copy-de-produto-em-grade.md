# ADR-0183 — Copy (título e descrição) de produto em grade

**Status:** Aceito
**Data:** 2026-10-17
**Decisor:** Diego
**Relacionado:** [ADR-0098](0098-copy-ancorada-na-fonte-e-persuasiva.md) (tudo nasce da fonte),
[ADR-0115](0115-eixo-de-variacao-nao-e-sempre-cor.md) (eixo de variação, guards de seção),
[ADR-0016](0016-publicacao-update-reposicao-estoque.md) (UPDATE não regenera copy),
[ADR-0166](0166-tipo-de-produto-por-organizacao.md) (grade), [ADR-0182](0182-grades-infantil-calca-e-guia-de-quadril.md).

## Contexto

Diego trouxe um guia de boas práticas de descrição ("Descrição que facilita a compra"), com 7 blocos:
1. título breve;
2. texto inicial de até 2 parágrafos;
3. até 6 benefícios;
4. até 8 especificações;
5. guia de tamanhos;
6. no mínimo 3 perguntas;
7. convite final para comprar.

A regra de ouro do guia é não repetir informação.

A copy era a mesma para qualquer família. Uma família em grade (toda variação incluída tem
`tamanho`, `classificarFamilia = 'grade'`) recebia o prompt de produto simples, e dois defeitos
apareciam:
- **Faltava o guia de tamanhos.** A IA nem recebia os tamanhos.
- **O rótulo da seção de variação estava errado.** No cadastro em grade, `nome == cor == "Estampa 1"`,
  então o eixo do ADR-0115 não se resolve e a seção saía "CORES DISPONÍVEIS: Estampa 1…"
  (família real `00000043`).

## Decisão

Vale **só para família em grade**. Simples e mista seguem como estão.

1. **Título:** sem mudança. Os slots com limite de 60 caracteres já atendem "título breve".
2. **Template de descrição em grade:**
   - intro de no máximo 2 parágrafos curtos;
   - ✅ com no máximo 6 bullets;
   - 📌 com no máximo 8 bullets e **sem nenhuma medida**;
   - ❓ com no mínimo 3 perguntas;
   - fechamento com convite para comprar, ancorado em ganho concreto.

   As seções 🎯 INDICAÇÕES DE USO e 📦 O QUE VOCÊ RECEBE **saem**, porque repetem os benefícios.
   O pós-processamento as remove mesmo quando a IA as escreve, porque instrução sozinha não
   garante ausência (ADR-0115).
3. **📏 GUIA DE TAMANHOS determinístico** (o código escreve, a IA não), entre 📌 e ❓:
   ```
   📏 GUIA DE TAMANHOS
   Tamanhos disponíveis: 2, 4, 6 e 8 anos.
   Confira nas fotos as medidas em centímetros de cada peça antes de escolher o tamanho.
   ```
   - **Nenhum número de medida na descrição.** Diego vai publicar fotos com os centímetros de
     cada peça, e a tabela de medidas do chart do ML é de corpo, não de peça.
   - O sufixo "anos" só entra quando todos os tamanhos são da grade infantil (2–16, disjunta das
     outras grades).
   - Os tamanhos aparecem em ordem canônica (P/M/G/GG, depois numérica).
4. **Pergunta fixa de tamanho** em ❓ ("Como escolher o tamanho? Confira nas fotos…"), também
   determinística. Ela conta para o mínimo de 3.
5. **Trava contra medida:**
   - Em grade, os guards de largura e metragem não injetam nada.
   - Bullets de 📌 e perguntas de ❓ com número + cm/mm/m são removidos **por linha inteira**,
     nunca por regex dentro da prosa. A remoção roda antes de `garantirPerguntas`, para não
     recriar a pergunta a partir de um bullet "Medidas".
6. **Seção 🎨 em grade:**
   - Lista as cores ou estampas distintas, sem as variações excluídas.
   - Se toda cor for "Estampa N", o rótulo é `ESTAMPAS DISPONÍVEIS`. Caso contrário é
     `CORES DISPONÍVEIS`. Os dois rótulos são casados por `RE_HEADER_VARIACAO` no UPDATE.
   - Os tamanhos **nunca** entram como itens de 🎨, porque o UPDATE substitui essa lista inteira
     pelas cores.
7. **UPDATE (ADR-0016):** `atualizarSecaoTamanhos` reescreve só a linha "Tamanhos disponíveis",
   de forma simétrica a `atualizarSecaoCores`. Ela é ligada em `atualizar-familia-up` (grade
   publica por UP). Descrição sem 📏 fica intacta.

## Consequências

- **Se uma família em grade vier sem fotos de medidas**, a frase "confira nas fotos" fica falsa.
  Diego assumiu esse risco.
- **Deploy.** O pacote inclui toda edge que importa `copywriter-prompt.ts` ou `criar-item.ts`,
  direta ou indiretamente.
- **Anúncios já publicados não mudam sozinhos.** Regenerar a copy grava o texto novo em
  `descricao_ml`, mas o UPDATE só reenvia a descrição quando as variações mudam (gate
  `houveMudanca`, ADR-0160). É comportamento pré-existente para toda família e fica fora deste ADR.
