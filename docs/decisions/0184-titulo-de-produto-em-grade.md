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
