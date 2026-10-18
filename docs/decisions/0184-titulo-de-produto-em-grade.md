# ADR-0184 — Título de produto em grade (roupa)

**Status:** Aceito
**Data:** 2026-10-17
**Decisor:** Diego
**Relacionado:** [ADR-0099](0099-titulo-padrao-mercado-livre.md) (slots, 60 caracteres),
[ADR-0044](0044-cor-no-titulo-mono-cor.md) (cor única no título), [ADR-0072](0072-titulo-duplicacao-tipo-e-cor-fora-de-ordem.md),
[ADR-0116](0116-visibilidade-dos-descartes-do-titulo.md), [ADR-0183](0183-copy-de-produto-em-grade.md) (descrição de grade),
[ADR-0182](0182-grades-infantil-calca-e-guia-de-quadril.md) (gênero da família).

## Contexto

Diego definiu regras próprias para o título de roupa no Mercado Livre:
- **Estrutura fixa:** Peça + Gênero/Público + Marca + Característica decisiva + Material + Kit.
- **Ocupação:** usar o máximo dos 60 caracteres com palavras-chave úteis.
- **Corte acima de 60:** sai primeiro o adjetivo, depois a 2ª característica e depois o material.
  Peça, Gênero, Marca e 1 diferencial ficam sempre.
- **Proibidos:** promessas e adjetivos vazios.
- **Formato:** Title Case e nenhuma palavra repetida.
- **Fora do título:** tamanho e cor (exceto quando a cor é o diferencial).

O título padrão (ADR-0099) segue outra ordem e não tem gênero, porque `familias.genero` nunca
chegava ao título. Também não tem campo para característica decisiva. A regra T6 manda **não**
encher os 60. Os títulos reais mostram o efeito:
- "Jaqueta Corta Vento Premium" (27 caracteres): perdeu "Feminina" e manteve um adjetivo banido,
  porque o T3 só zera o slot inteiro.
- "Conjunto Infantil Proteção Solar Uv": sigla com caixa errada.

## Decisão

Vale **só para família grade**, o mesmo critério do ADR-0183 (`tamanhosDaGradeCopy !== null`).
Para os demais, a saída é idêntica à anterior.

1. **Três slots novos:** `publico`, `caracteristica` e `caracteristica2`.
   - Entram no schema de todas as famílias. Fora da grade, a IA devolve `""` e o código zera os
     três antes de qualquer guard.
2. **Ordem de leitura da grade:**
   `produto, publico, marca, caracteristica, caracteristica2, material, variacao, quantidade`.
   - `modelo`, `medida`, `compatibilidade`, `aplicacao` e `sinonimo` não são renderizados na grade.
3. **Corte da grade:** `caracteristica2`, depois `material`.
   - Incortáveis, quando presentes: `produto`, `publico`, `marca`, `caracteristica`, `quantidade`
     (kit) e `variacao` (quando discrimina).
   - **Marca:** só entra se estiver na fonte. Diego escolheu não usar a `marca_padrao` da
     organização no título.
   - Se só os incortáveis já passam de 60, o código lança `TituloInviavelError`, como hoje.
4. **Público vem do gênero cadastrado (`familias.genero`), que agora a IA recebe:**
   - **Lista fechada por gênero:**
     - masculino: Masculino ou Masculina;
     - feminino: Feminino ou Feminina;
     - unissex: Unissex;
     - meninos: Infantil, Menino ou Masculino;
     - meninas: Infantil, Menina ou Feminino;
     - sem_genero_infantil: Infantil.
   - "Plus Size" só entra se constar na fonte.
   - **Valor fora da lista:** cai no fallback do código.
     - Infantil e Unissex entram direto.
     - Masculino e feminino concordam com a peça: 1ª palavra do `produto` terminada em "a" leva a
       forma feminina; as demais, a masculina.
   - **Família sem gênero:** `publico` fica `""`, porque o código nunca inventa.
5. **Característica e material ancorados:** toda palavra (inclusive número e sigla, exceto átonas) precisa estar na fonte.
   Caso contrário, o slot sai.
6. **Ocupação:** na grade, o prompt inverte o T6 e pede para usar o espaço até perto de 60
   caracteres, só com dados da fonte. A regra de não inventar continua valendo.
7. **Proibidos por PALAVRA, em qualquer slot da grade:**
   - promoção, imperdível, barato, frete, grátis, original, garantido, milagroso, lindo,
     maravilhoso, perfeito, premium, melhor, frete, envio, garantia e pagamento;
   - pontuação decorativa (`! ? *`, emoji e traço) sai;
   - material e característica exigem cada palavra, inclusive número, na fonte;
   - toda palavra começa com maiúscula;
   - palavra repetida entre slots sai do slot posterior;
   - kit vira "Kit N" ou "Pacote N" e não é cortado;
   - "top" também, mas fora de `produto`, porque "Top" é peça de roupa.
8. **Cor única fica no título** (decisão do Diego, como proteção contra duplicado, ADR-0044).
   Com várias cores, a cor sai, como hoje.
9. **Title Case:** UV e FPU ficam em maiúsculas só na grade. O caminho não-grade fica idêntico.

## Consequências

- **Concordância:** a forma Masculino/Masculina pode errar em peças fora da regra do "a". A IA
  acerta na maioria dos casos, e o fallback só roda quando ela erra.
- **Partição de split** (`titulo-particao`) segue o título padrão, porque não recebe o sinal de grade.
- **Alcance:** vale para famílias processadas ou regeneradas depois do deploy. Este ADR não
  reescreve anúncios já publicados.

## Emenda (2026-10-18): concordância sempre do código e percentual órfão

Família real `00000069` (camisa, masculino) saiu "Camisa **Masculino** Algodão Egípcio **90% 10%**
Elastano". Duas falhas da regra original:

1. **Concordância.** A IA devolveu "Masculino", que está na lista do gênero, e o fallback só corria
   para valor fora da lista. Agora, em gênero adulto (masculino/feminino), o código sempre decide a
   forma pela 1ª palavra da peça; "Plus Size" da IA é preservado. Exceções da regra do "a" final:
   masculinas terminadas em "a"/"ã" (`pijama`, `sutiã`, `cardigã`) e femininas sem "a" (`legging`,
   `lingerie`, `polo`). Infantil e Unissex seguem como antes.
2. **Percentual órfão.** A deduplicação tirou "Algodão" do material "90% Algodão 10% Elastano"
   (já estava na característica) e deixou "90%" solto. Agora um percentual imediatamente antes da
   palavra removida sai junto: "Camisa Masculina Algodão Egípcio 10% Elastano".

## Emenda (2026-10-18): palavras-chave no título de roupa em grade

**Decisão:** definida pelo consultor por delegação explícita de Diego.

Esta emenda substitui a ordem, a ocupação e a prioridade de corte anteriores exclusivamente para famílias em grade. O contrato de descrição do ADR-0183 e o comportamento das famílias não-grade permanecem inalterados.

**1. Estrutura e conteúdo.** A ordem passa a ser `quantidade, produto, sinonimo, publico, caracteristica, caracteristica2, material, aplicacao, variacao, marca`. Reutilizam-se os 13 slots existentes; `modelo`, `medida` e `compatibilidade` permanecem vazios na grade. As duas características priorizam modelo/corte, construção/comprimento, segmento declarado e estampa/tema, nessa ordem. Uso ou estação só entram quando explicitamente declarados.

Toda característica precisa de respaldo em `nome_pai`/`descricao_pai`. A presença de tokens isolados não autoriza sintetizar relações nem inverter negações. Tamanhos, promessas e adjetivos vazios continuam proibidos. Público, cor e contagem são tratados pelo código com as respectivas fontes cadastrais.

**2. Material e sinônimos.** O título usa nomes de tecido/material e qualificadores técnicos comprovados, sem percentuais, inclusive sem `100%`. Composição completa continua na descrição.

Sinônimos exigem respaldo literal na fonte e aprovação pelo dicionário fechado: `Short↔Bermuda`, `Moletom↔Blusa De Frio` para peça superior e `Jaqueta↔Casaco`, sempre designando a mesma peça. `Calça Legging` pode ser produto composto quando essa expressão constar na fonte. O dicionário não autoriza acrescentar termos ausentes.

**3. Corte e proteção.** Acima de 60 caracteres, remover slots inteiros nesta ordem: `sinonimo → aplicacao → marca → caracteristica2 → material → publico`. Público só é cortável para gênero adulto feminino em Vestido e Legging. Nos demais casos, público cadastrado é protegido. Produto, primeira característica quando presente, kit confirmado e cor discriminadora são incortáveis. Se o conjunto protegido não couber, lançar `TituloInviavelError`.

A deduplicação deve preservar expressões técnicas e a identidade de marcas e cores; sinônimo não prevalece sobre característica ou material.

**4. Público, marca, cor e kit.** Público vem do gênero cadastrado, com concordância determinística. Meninos e meninas usam `Infantil Menino` e `Infantil Menina`; sem gênero infantil usa `Infantil`. Sem gênero cadastrado, público permanece vazio, sem inferência. Marca ancorada fica no fim e passa a ser cortável; não se usa a marca padrão da organização.

Cor única real permanece protegida conforme ADR-0044. Multicor e cor indefinida continuam sem cor no título. Kit confirmado abre o título como `Kit N`; sua contagem corresponde ao pacote vendido, não ao número de componentes de um conjunto.

**5. Fonte pobre e alcance.** Não existe comprimento mínimo nem obrigação de preencher os 60 caracteres. Na fonte “Camisa de Algodão Egípcio Premium com Elastano”, com descrição “Composição: 90% Algodão e 10% Elastano” e gênero masculino cadastrado, o título esperado é **“Camisa Masculina Algodão Egípcio Com Elastano”**, com 45 caracteres. Não acrescentar Social, Slim, Básica ou qualquer atributo ausente.

A mudança vale para geração e regeneração de títulos de grade após a entrega. Não determina atualização em massa de anúncios ou descrições já existentes.

**Decisões de implementação (Claude, registradas para revisão):** `produto` não passa pela
ancoragem de expressão na grade, porque zerá-lo derruba a família (`TituloInviavelError`); o
filtro de marketing que já existia continua valendo para ele. O bloco "TÍTULO EM GRADE" foi
reescrito dentro do prompt compartilhado (ele já é condicionado a "vendido em GRADE"), em vez de
um prompt de sistema separado só para grade. Característica que começa pela fibra principal do
tecido ("Algodão Egípcio" × "Algodão Com Elastano") é absorvida pelo tecido.

Pesquisa e especificação completas: `docs/superpowers/specs/2026-10-18-titulo-grade-palavras-chave-design.md`.
