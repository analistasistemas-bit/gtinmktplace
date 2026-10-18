# Título de roupa em grade orientado a palavras-chave — design

**Data:** 2026-10-18 · **Decisor:** Codex (gpt-6.1-sol, high), por delegação explícita do Diego · **Escopo:** só o título de família em grade; descrição (ADR-0183) e não-grade inalterados.

Pedido do Diego: composição no título de roupa não agrega; o título deve ter as palavras que o comprador pesquisa. Um subagente pesquisou os títulos mais vendidos (anexo); o Codex definiu a especificação abaixo.

---

## Especificação (Codex)

**Adote: `[Kit N] + Peça + [Sinônimo] + Público + Característica + [Característica 2] + Tecido + [Uso/Estação] + [Cor única] + [Marca]`.**

**Especificação concluída.** Colchetes indicam conteúdo opcional. O limite é 60 caracteres; ocupar todo o espaço não é requisito.

A pesquisa (anexo abaixo) sustenta priorizar peça, modelo/corte e tecido, mas não comprova causalidade nem volume individual de busca. A orientação oficial também pede clareza, características coerentes e ausência de repetições e promoções. [Orientação do Mercado Livre](https://vendedores.mercadolivre.com.br/aprender/nota/como-criar-um-titulo-atrativo?guideKeyId=GE53).

**Regras 1–5 — conteúdo**

1. **Escopo e fórmula.** Aplicar exclusivamente ao sinal de grade já existente, derivado de `tamanhosDaGradeCopy(...) !== null`. Preservar os 13 slots, a montagem única e os diagnósticos existentes.

   ```ts
   ORDEM_LEITURA_GRADE = [
     'quantidade', 'produto', 'sinonimo', 'publico',
     'caracteristica', 'caracteristica2', 'material',
     'aplicacao', 'variacao', 'marca',
   ];
   ```

   `modelo`, `medida` e `compatibilidade` continuam vazios na grade. Não criar terceiro slot de característica.

2. **Responsabilidade de cada slot.**

   | Slot | Conteúdo na grade | Origem |
   |---|---|---|
   | `produto` | Nome da peça: Camisa, Short, Calça, Vestido, Moletom | IA, ancorada no nome/descrição |
   | `sinonimo` | Segundo nome da mesma peça, conforme regra 3 | IA propõe; código valida dicionário e fonte |
   | `publico` | Masculina, Feminino, Unissex, Infantil Menino etc. | Código, pelo gênero cadastrado |
   | `caracteristica` | Expressão decisiva de maior prioridade | IA ancorada |
   | `caracteristica2` | Segunda expressão, independente da primeira | IA ancorada |
   | `material` | Nome do tecido/material e qualificador técnico | IA ancorada; código remove percentuais |
   | `aplicacao` | Uso ou estação explicitamente declarado | IA ancorada |
   | `variacao` | Somente a cor única real | Código, pelas cores da família |
   | `marca` | Marca efetivamente mencionada na fonte | IA e validação existentes |
   | `quantidade` | `Kit N` | Código, pela contagem comprovada |

   Para escolher as duas características, priorizar: **modelo/corte → construção/comprimento da peça → segmento declarado, como Plus Size → estampa/tema**. Empate: ordem de ocorrência no `nome_pai`, depois na `descricao_pai`.

   Exemplos: `Slim Fit`, `Wide Leg`, `Cintura Alta`, `Manga Curta`, `Com Capuz`. Cada slot contém uma expressão; não concatenar vários atributos para escapar da ordem de corte.

3. **Sinônimo: sim, com dicionário fechado e respaldo literal na fonte.**

   | Par permitido | Condição |
   |---|---|
   | `Short ↔ Bermuda` | A fonte nomeia a mesma peça com os dois termos |
   | `Moletom ↔ Blusa De Frio` | A fonte declara ambos para a peça superior; não basta mencionar tecido moletom |
   | `Jaqueta ↔ Casaco` | A fonte declara ambos para a mesma peça |
   | `Legging → Calça Legging` | A expressão `Calça Legging` consta na fonte; usar em `produto`, com `sinonimo=""` |

   O dicionário **autoriza equivalência; não autoriza criar palavra ausente**. A IA devolve o candidato literal; o código rejeita qualquer candidato fora desses pares ou sem ancoragem. Slot vazio permanece vazio.

   Não permitir `Blusa ↔ T-shirt`, `Regata ↔ Camiseta`, `Camisa ↔ Camiseta` nem transformar componentes diferentes de um conjunto em sinônimos.

4. **Tecido/material: manter nomes; retirar composição percentual.**

   **Nenhum percentual entra no título de grade, inclusive `100% Algodão`. Não haverá exceção.**

   Exemplos:

   ```text
   100% Algodão                  → Algodão
   90% Algodão e 10% Elastano     → Algodão Com Elastano
   Algodão Egípcio com Elastano   → Algodão Egípcio Com Elastano
   Jeans                         → Jeans
   ```

   Priorizar o tecido declarado no nome. Preservar qualificador técnico comprovado, como `Egípcio`, e no máximo uma segunda fibra declarada. Não converter `Elastano` em `Lycra`, `Poliéster` em `Dry Fit` ou composição em benefício presumido.

   `Algodão Egípcio Com Elastano` pertence inteiro a `material`; não repartir entre característica e material. Percentuais e composição completa continuam disponíveis na descrição, cujo contrato permanece igual.

5. **Ancoragem e fonte pobre.**

   Preservar a comparação atual por tokens normalizados como condição necessária. Na grade, também validar `produto` e `aplicacao`; não deixar esses slots servirem de passagem para características inventadas.

   Para características e uso, exigir expressão comprovada na fonte, preservando relações e negações: `Sem Bolso` não comprova `Com Bolso`; “bolso interno e zíper frontal” não comprova `Bolso Com Zíper`. Para materiais combinados, cada nome e qualificador precisa estar declarado positivamente; não basta ocorrer em uma frase negativa.

   Permanecem proibidos promessas, adjetivos vazios, logística, códigos internos e tamanhos em qualquer slot. Preservar números técnicos legítimos, como `Manga 3/4`, e o segmento `Plus Size` quando declarado.

   **Fonte pobre não recebe preenchimento artificial.** Não acrescentar `Social`, `Slim`, `Lisa`, `Básica`, `Casual`, `Trabalho` ou `Manga Longa` por probabilidade da categoria. Termos apenas prováveis continuam em `termos_com_risco`.

   Para a camisa informada, com gênero cadastrado `masculino`:

   ```text
   Camisa Masculina Algodão Egípcio Com Elastano
   ```

   São **45 caracteres**. `Premium` sai; características ficam vazias. Sem gênero cadastrado, o resultado é `Camisa Algodão Egípcio Com Elastano`.

**Regras 6–10 — prioridade e proteção**

6. **Corte acima de 60 caracteres.**

   ```text
   sinonimo → aplicacao → marca → caracteristica2 → material → publico*
   ```

   `publico*` só pode sair nas condições da regra 7.

   Permanecem incortáveis: **produto, primeira característica quando presente, kit e cor discriminadora**, além do público protegido. Não exigir característica quando a fonte não oferece nenhuma.

   Remover slots inteiros e parar assim que couber. Nunca truncar palavras, abreviar atributos arbitrariamente ou restaurar conteúdo previamente rejeitado. Se o conjunto protegido exceder 60, lançar `TituloInviavelError`; não produzir título alternativo silencioso.

   A deduplicação precede o corte e usa prioridade própria:

   ```text
   produto/kit/cor → publico → material → caracteristica
   → caracteristica2 → marca → aplicacao → sinonimo
   ```

   Comparar expressões antes de remover palavras. Não deixar um sinônimo consumir característica ou tecido mais importante; não mutilar marca, cor ou expressões técnicas. Uma característica que apenas repete parte do material cede ao material inteiro.

7. **Público obrigatório, com exceção estreita de corte.**

   Quando houver gênero cadastrado:

   | Cadastro | Saída do código |
   |---|---|
   | `masculino` / `feminino` | Concordância atual com a peça, incluindo as exceções já implementadas |
   | `unissex` | `Unissex` |
   | `meninos` | `Infantil Menino` |
   | `meninas` | `Infantil Menina` |
   | `sem_genero_infantil` | `Infantil` |

   **Somente o público adulto feminino de `Vestido` e `Legging` — incluindo `Calça Legging` — é cortável**, e apenas no último estágio. Nos demais casos, público presente é protegido.

   Infantil e Unissex nunca são deduzidos da peça. Sem gênero cadastrado, `publico=""`; registrar essa ausência no diagnóstico, sem bloquear um título válido. `Plus Size` vai em característica, não em público.

8. **Cor única: manter; ADR-0044 não muda.**

   Recomendo manter a proteção contra colisão entre famílias. A baixa frequência de cor na pesquisa não resolve o incidente concreto documentado pelo projeto.

   Uma cor real: incluir e proteger. Várias cores ou cor indefinida: omitir. Posicionar depois de uso/estação e antes da marca. Considerar a cor já coberta apenas se estiver em `produto`, que é incortável; um slot cortável não pode suprimir o discriminador.

   Essa é uma exceção deliberada do projeto à recomendação geral do ML de deixar cor nas variações. [Orientação do Mercado Livre](https://vendedores.mercadolivre.com.br/aprender/nota/como-criar-um-titulo-atrativo?guideKeyId=GE53).

9. **Marca no fim e cortável.**

   Só entra se ancorada em `nome_pai`/`descricao_pai`. Não usar `marca_padrao`, nome da loja ou razão social presumida como marca.

   A marca sai depois de sinônimo e uso, antes da segunda característica. Preservar sua identidade completa: não encurtar marca removendo palavras isoladas.

10. **Kit sempre no começo.**

    Renderizar `Kit N`, com `N > 1`, quando a fonte comprovar a quantidade do pacote vendido. Não inferir contagem a partir de percentual, tamanho, número solto ou quantidade de variações.

    `Conjunto 2 Peças` não significa automaticamente `Kit 2 Conjuntos`: a contagem precisa corresponder à unidade comercial anunciada. Kit confirmado é incortável e aparece uma única vez.

**Mudanças por arquivo/função**

Todos os caminhos de código abaixo são relativos a `supabase/functions/_shared/ai/`.

| Arquivo/função | Mudança delimitada |
|---|---|
| `titulo-slots.ts` | Atualizar `ORDEM_LEITURA_GRADE` e `ORDEM_CORTE_GRADE`. Reutilizar os 13 campos. Preservar `ORDEM_LEITURA`, `ORDEM_CORTE` e `TODOS_SLOTS`. |
| `titulo-grade.ts` — `aplicarRegrasGrade`, `guardPublico`, `ancorado`, `deduplicar` | Habilitar `sinonimo` e `aplicacao`; implementar whitelist de sinônimos, remoção de percentuais/tamanhos, validação das expressões, público determinístico e deduplicação por prioridade. Corrigir a cobertura da cor para depender apenas de `produto`. |
| `titulo-guards.ts` — `aplicarGuardsTitulo`, `validarSlotsAncorados` | Preservar guards gerais e T7. Na grade, cobertura do tipo da peça deve depender de `produto`, impedindo que um sinônimo cortável suprima a identidade. Contagem de grade deve validar pacote versus componentes. Toda mudança comportamental deve estar condicionada a `fonte.grade`. |
| `titulo-pos.ts` — `diagnosticarTitulo` | Manter ordem do pipeline e montagem única. Calcular e passar `publicoCortavel` para a montagem. Manter reescritas/remoções em `descartes`; registrar público ausente sem tratá-lo como erro. |
| `titulo-montar.ts` — `ContextoCorte`, `slotsIncortaveis`, `montarTituloDetalhado` | Acrescentar `publicoCortavel?: boolean`. Na grade, retirar marca da proteção, aplicar a nova ordem de corte e proteger público salvo a exceção. Manter `TituloInviavelError`. Reduções antigas do fluxo não-grade ficam iguais. |
| `copywriter-prompt.ts` — bloco de título da grade | Substituir fórmula, atribuição dos slots e exemplos. Remover a instrução de chegar perto de 60 e a obrigação de zerar `aplicacao`/`sinonimo`. Preservar integralmente as regras e funções de descrição. |
| `copywriter-prompt.ts` / `copywriter.ts` — seleção do prompt em `chamarCopy` | Selecionar o novo bloco de título **somente para grade**. Manter exatamente o `SYSTEM` e o user prompt atuais para não-grade. Usar o mesmo detector de grade; não criar outro critério. |
| `copywriter.ts` — `SCHEMA_COPY`, `coagirSlots` | **Sem mudança estrutural.** Continuam 13 strings obrigatórias e `additionalProperties: false`. |
| ADR e documentação | Acrescentar a emenda abaixo ao ADR-0184; atualizar a referência em `obsidian-vault/07-IA/Prompts.md` e o registro da tarefa. |

Preservar o texto atual do prompt não-grade é necessário porque alterar o `SYSTEM` compartilhado também alteraria a entrada enviada ao modelo para essas famílias.

**Casos de teste de produto**

Todos passam por `diagnosticarTitulo`, com slots não mencionados iguais a `SLOTS_VAZIOS`, `grade=true`, `fornecedor=null`, `tipoProdutoBusca=""`, `cores=[]` e `descricaoPai=""`, salvo indicação.

| Caso | Fonte e cadastro | Slots fornecidos pela IA | Título esperado |
|---|---|---|---|
| Camisa pobre | Nome: `Camisa de Algodão Egípcio Premium com Elastano`. Descrição: `Composição: 90% Algodão e 10% Elastano`. Gênero: `masculino` | `produto="Camisa"`; `material="Algodão Egípcio Com Elastano"` | **Camisa Masculina Algodão Egípcio Com Elastano** — 45 |
| Short | Nome: `Short Linho Mauricinho Masculino Bermuda Esporte Fino`. Gênero: `masculino` | `produto="Short"`; `sinonimo="Bermuda"`; `caracteristica="Esporte Fino"`; `material="Linho"` | **Short Bermuda Masculino Esporte Fino Linho** — 42 |
| Calça jeans | Nome: `Calça Jeans Feminina Wide Leg Cintura Alta`. Gênero: `feminino` | `produto="Calça"`; `caracteristica="Wide Leg"`; `caracteristica2="Cintura Alta"`; `material="Jeans"` | **Calça Feminina Wide Leg Cintura Alta Jeans** — 42 |
| Vestido | Nome: `Vestido Feminino Midi Com Fenda Canelado`. Gênero: `feminino` | `produto="Vestido"`; `caracteristica="Midi"`; `caracteristica2="Com Fenda"`; `material="Canelado"` | **Vestido Feminino Midi Com Fenda Canelado** — 40 |
| Moletom | Nome: `Moletom Blusa De Frio Unissex Canguru Flanelado`. Gênero: `unissex` | `produto="Moletom"`; `sinonimo="Blusa De Frio"`; `caracteristica="Canguru"`; `caracteristica2="Flanelado"` | **Moletom Blusa De Frio Unissex Canguru Flanelado** — 47 |
| Kit infantil | Nome: `Kit 3 unidades de camiseta infantil menino manga curta`. Descrição: `Composição: 100% Algodão`. Gênero: `meninos` | `produto="Camiseta"`; `quantidade="3un"`; `caracteristica="Manga Curta"`; `material="100% Algodão"` | **Kit 3 Camiseta Infantil Menino Manga Curta Algodão** — 50 |

**Testes de proteção e corte**

| Entrada adicional | Resultado obrigatório |
|---|---|
| Camisa pobre com `caracteristica="Social"` e `caracteristica2="Slim Fit"` | Ambos descartados por falta de ancoragem; mesmo título de 45 caracteres |
| Fonte `Camiseta 100% Algodão`, gênero masculino; `produto="Camiseta"`, `material="100% Algodão"` | `Camiseta Masculina Algodão` |
| Fonte `Moletom Unissex`, sem `Blusa De Frio`; IA envia esse sinônimo | `Moletom Unissex` |
| Fonte `Short Sem Bolso`, gênero masculino; IA envia `caracteristica="Com Bolso"` | `Short Masculino` |
| Fonte `Camisa Masculina Manga Curta Algodão Azul Lunar`; cor `["Azul"]`; slots correspondentes | `Camisa Masculina Manga Curta Algodão Azul Lunar` |

Para conferir a **ordem efetiva de corte**, usar esta fonte e os slots correspondentes:

```text
Short Bermuda Masculino Cós Elástico Com Cordão Linho
Para Praia Azul Marinho Lunar
```

```ts
{
  produto: 'Short',
  sinonimo: 'Bermuda',
  caracteristica: 'Cós Elástico',
  caracteristica2: 'Com Cordão',
  material: 'Linho',
  aplicacao: 'Para Praia',
  marca: 'Lunar',
}
// genero: masculino; cores: ['Azul Marinho']
```

Resultado obrigatório:

```text
Short Masculino Cós Elástico Com Cordão Linho Azul Marinho
```

**58 caracteres.** O diagnóstico deve registrar cortes de `sinonimo`, `aplicacao` e `marca`, nessa ordem. Não cortar `caracteristica2`: nesse ponto o título já cabe.

Complementar com estas verificações:

1. **Público cortável:** fonte `Vestido Feminino Com Fechamento Por Botões De Madeira Azul Marinho`, gênero feminino, cor única correspondente e construção em `caracteristica`. Resultado: `Vestido Com Fechamento Por Botões De Madeira Azul Marinho` — 57 caracteres.
2. **Limite exato:** nos slots da camisa `Social` / `Slim Fit` / `Algodão Egípcio` / cor `Azul`, marca declarada `Lunarx` produz 60 caracteres e permanece; marca `Lunarxx` produz 61 e deve sair inteira.
3. **Falha explícita:** se produto, público protegido, primeira característica, kit e cor ainda ultrapassarem 60, esperar `TituloInviavelError`. Testar também que o consumidor não publica nem persiste um título truncado.
4. **Classificação comercial:** `Conjunto 2 Peças` não pode virar `Kit 2 Conjunto`; tamanho `M`, `GG` ou `2 Anos` não pode reaparecer em outro slot. `Manga 3/4` permanece quando ancorada.
5. **Regressão:** comparar não-grade com as mesmas entradas antes/depois, incluindo prompt enviado, título e descartes. Para descrição, conservar os testes e a saída do pós-processamento com a mesma entrada textual.

Executar os testes pertinentes em `__tests__/titulo-grade.test.ts`, `titulo-diagnostico.test.ts`, `copywriter-slots.test.ts`, `copywriter-schema.test.ts` e `copywriter-grade.test.ts`. As contagens acima foram conferidas; os testes da aplicação ainda não foram executados porque esta entrega é uma especificação.

**Texto para acrescentar ao ADR-0184**

> **Emenda — 2026-10-18: palavras-chave comprovadas no título de roupa em grade**
>
> **Decisão:** definida pelo consultor por delegação explícita de Diego.
>
> Esta emenda substitui a ordem, a ocupação e a prioridade de corte anteriores exclusivamente para famílias em grade. O contrato de descrição do ADR-0183 e o comportamento das famílias não-grade permanecem inalterados.
>
> **1. Estrutura e conteúdo.** A ordem passa a ser `quantidade, produto, sinonimo, publico, caracteristica, caracteristica2, material, aplicacao, variacao, marca`. Reutilizam-se os 13 slots existentes; `modelo`, `medida` e `compatibilidade` permanecem vazios na grade. As duas características priorizam modelo/corte, construção/comprimento, segmento declarado e estampa/tema, nessa ordem. Uso ou estação só entram quando explicitamente declarados.
>
> Toda característica precisa de respaldo em `nome_pai`/`descricao_pai`. A presença de tokens isolados não autoriza sintetizar relações nem inverter negações. Tamanhos, promessas e adjetivos vazios continuam proibidos. Público, cor e contagem são tratados pelo código com as respectivas fontes cadastrais.
>
> **2. Material e sinônimos.** O título usa nomes de tecido/material e qualificadores técnicos comprovados, sem percentuais, inclusive sem `100%`. Composição completa continua na descrição.
>
> Sinônimos exigem respaldo literal na fonte e aprovação pelo dicionário fechado: `Short↔Bermuda`, `Moletom↔Blusa De Frio` para peça superior e `Jaqueta↔Casaco`, sempre designando a mesma peça. `Calça Legging` pode ser produto composto quando essa expressão constar na fonte. O dicionário não autoriza acrescentar termos ausentes.
>
> **3. Corte e proteção.** Acima de 60 caracteres, remover slots inteiros nesta ordem: `sinonimo → aplicacao → marca → caracteristica2 → material → publico`. Público só é cortável para gênero adulto feminino em Vestido e Legging. Nos demais casos, público cadastrado é protegido. Produto, primeira característica quando presente, kit confirmado e cor discriminadora são incortáveis. Se o conjunto protegido não couber, lançar `TituloInviavelError`.
>
> A deduplicação deve preservar expressões técnicas e a identidade de marcas e cores; sinônimo não prevalece sobre característica ou material.
>
> **4. Público, marca, cor e kit.** Público vem do gênero cadastrado, com concordância determinística. Meninos e meninas usam `Infantil Menino` e `Infantil Menina`; sem gênero infantil usa `Infantil`. Sem gênero cadastrado, público permanece vazio, sem inferência. Marca ancorada fica no fim e passa a ser cortável; não se usa a marca padrão da organização.
>
> Cor única real permanece protegida conforme ADR-0044. Multicor e cor indefinida continuam sem cor no título. Kit confirmado abre o título como `Kit N`; sua contagem corresponde ao pacote vendido, não ao número de componentes de um conjunto.
>
> **5. Fonte pobre e alcance.** Não existe comprimento mínimo nem obrigação de preencher os 60 caracteres. Na fonte “Camisa de Algodão Egípcio Premium com Elastano”, com descrição “Composição: 90% Algodão e 10% Elastano” e gênero masculino cadastrado, o título esperado é **“Camisa Masculina Algodão Egípcio Com Elastano”**, com 45 caracteres. Não acrescentar Social, Slim, Básica ou qualquer atributo ausente.
>
> A mudança vale para geração e regeneração de títulos de grade após a entrega. Não determina atualização em massa de anúncios ou descrições já existentes.

---

## Anexo — pesquisa de títulos (subagente, 18/10/2026)

# Pesquisa: títulos de roupa em grade que mais vendem no Mercado Livre (18/10/2026)

Fontes: JoomPulse (snapshot ML Brasil 18/10/2026): top 60–100 títulos por vendas mensais estimadas em Camisetas MLB31447, Camisas MLB107292, Bermudas MLB188064, Calças MLB188065, Vestidos MLB108704, Moletons MLB108807, Leggings MLB278018, Blusas MLB3112, Casacos/Jaquetas MLB108803, Kits/Conjuntos MLB271219+MLB28163, recorte Infantil → 766 títulos top dedup; 400 títulos de baixa venda (1–3/mês) em Camisas/Camisetas/Calças/Vestidos; cubo de keywords (Trends do ML). /trends do ML e autosuggest deram 403. Vendas = estimativa JoomPulse; comparação top × baixa é descritiva (mix diferente).

## Achados
1. Peça primeiro em 99% dos top; com kit, "Kit N" abre o título (170/179). Ordem dominante: [Kit N] + Peça + Gênero + Modelo/Corte + Tecido + Uso/Estação. Gênero na 2ª–4ª palavra.
2. Comprimento médio 56 (mediana 57); 76% dos top ≥ 55 caracteres (baixa: média 54, 67% ≥ 55).
3. Composição percentual: ZERO misturas ("90% X 10% Y") em 1.166 títulos. "100% Algodão" (fibra única) em 18% dos top de Camisetas (inclusive o 1º: "Camiseta Masculina Lisa Básica 100% Algodão"); 5% Camisas, ~2% Calças, 0% Moletom/Legging/Blusa/Jaqueta.
4. Nome do tecido sozinho: ~60% dos top citam material (51% baixa). Por categoria nos top: Calças Jeans 64%, Lycra 30%, Elastano 24%, Sarja 15%; Moletons Moletom 97%, Flanelado 23%; Bermudas Linho 18%, Jeans 16%, Tactel 12%, Lycra 13%; Leggings Poliamida 12%, Suplex 12%; Camisetas Algodão 35%, Dry Fit 8%, Canelada 11%; Vestidos Canelado 13%; Camisas Linho 8%, Elastano 6%. "Algodão" aparece MAIS nos de baixa venda em Camisas (14% × 7%) e Calças (7% × 3%).
5. Modelo/corte é o que mais separa top × baixa (% top × % baixa): Camisas Slim 42×22, Social 64×36, Fit 25×13, Não Amassa 9×0, Polo 17×8, Gola Padre 8×4. Camisetas Básica 31×10, Lisa 20×5, Kit 40×11, Masculina 51×19, Slim 12×3, Polo 12×3. Calças Cintura Alta 29×11, Lycra 30×10, Slim 13×2, Social 12×2, Sarja 15×6, Wide Leg 19, Levanta Bumbum 10×4. Vestidos Casual 25×4, Elegante 28×6, Soltinho 18×5, Midi 28×18, Fenda 18×8, Canelado 12×3, Plus Size 20×13. Na baixa sobram estampa/tema, "Infantil" em categoria adulta, cor.
6. Gênero/público: Bermudas 95%, Calças 92%, Camisas 85%, Blusas 83%, Jaquetas 80%, Camisetas 78%, Moletons 67% (Unissex 27%); Vestidos 41%, Leggings 40% (peça já diz o público).
7. Sinônimo/2+ nomes de peça: 41% top × 24% baixa. Leggings 85% ("Calça Legging"), Moletons 75% ("Moletom… Blusa De Frio"), Jaquetas 69% ("Jaqueta… Casaco"), Bermudas 53% ("Short… Bermuda"), Blusas 35%, Camisetas 31%, Camisas 30%, Vestidos 2%; Calças exceção (26% × 38%).
8. Kit N: 23% top × 10% baixa (Camisetas 40%, Bermudas 44%, Blusas 30%, Kits 67%), sempre no começo.
9. Marca: 9% top × 6% baixa; metade no fim; só abre em marca forte.
10. Cor: 4% top × 12% baixa. Tamanho ~3% nos dois.
11. Keywords buscadas: "camisa social masculina manga curta", "camisa gola padre masculina", "calca masculina cargo", "calca cargo masculina slim", "calca wideleg", "calca plus size", "conjunto moletom masculino", "moletom feminino com ziper", "bermuda linho feminina", "short linho", "calca legging flare", "calca legging sem costura", "legging poliamida elastano", "kit roupa infantil", "regata masculina" — peça + modelo/tecido + gênero; nenhum percentual.
12. "Premium/Luxo" 14% top × 10% baixa (31% top Camisas) — sem evidência causal; proibição do projeto mantida.

## Exemplos top (vendas/mês estimadas)
- Camiseta Masculina Lisa Básica 100% Algodão — 11.952
- Kit 5 Camisetas Básicas Masculina Dry Fit Lisa Tradicional — 10.381
- Camisa Social Masculina Slim Fit Luxo Pronta Entrega — 14.925
- Camisa Manga Curta Gola Padre Masculina Social Trabalho — 11.278
- Calça Jeans Feminina Cargo Levanta Bumbum Cintura Alta — 26.786
- Calça Sarja Masculina Slim Elastano Bolso Faca Esporte Lycra — 9.615
- Calça Jeans Wide Leg Feminina Cintura Alta Pantalona — 9.317
- Short Duplo Feminino Bermuda 2 Em 1 Compressão Academia — 5.941
- Moletom Liso Algodão Unissex Blusa De Frio Canguru Flanelado — 11.673
- Vestido Longo Babado Fenda Manga 3/4 Evangélico Elegante — 3.333
- Calça Legging Feminina Cintura Alta Leg Grossa Fitness — 1.346
- Jaqueta Corta Vento Masculina Impermeável Capuz Zíper Bolso — 3.488
- Kit 10 Peças De Roupa Conjunto Infantil Menino Dia A Dia — 15.306

## Proposta do pesquisador (para avaliação)
[Kit N] + Peça + [Sinônimo da peça] + Público + Modelo/Corte (1–3) + Tecido (nome) + Uso/Estação + [Marca], até ~60 só com dado ancorado. Sinônimo por dicionário fixo no código (Short↔Bermuda, Moletom↔Blusa De Frio, Jaqueta↔Casaco, Legging→"Calça Legging", Blusa↔T-shirt, Regata↔Camiseta; nunca em Vestido). Tecido reduzido ao nome, nunca percentual (exceção "100% Algodão" em camiseta/regata básica com fibra única na fonte). Corte: sinônimo → uso → 3º modelo → marca → tecido → público (só peça feminina por natureza). Marca no fim e cortável. Cor única: dado não sustenta (4% × 12%), mas hoje é decisão do Diego como anti-duplicado (ADR-0044).

