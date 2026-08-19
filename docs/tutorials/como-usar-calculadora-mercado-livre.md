# Como usar a Calculadora Mercado Livre

> **Tipo:** How-to para o usuário final.
> **Objetivo:** avaliar se vale a pena comprar um produto e descobrir um preço de venda compatível
> com a margem desejada.
> **Tempo estimado:** de 3 a 5 minutos por simulação.

A Calculadora Mercado Livre reúne custo de compra, preço, comissão, frete, impostos e despesas
operacionais em uma única análise. Ao final, ela compara os anúncios **Clássico** e **Premium** e
indica uma ação: comprar, negociar o custo, ajustar o preço, evitar a oportunidade ou completar os
dados que faltam.

> **Importante:** a calculadora apoia a decisão, mas não compra estoque, não cria anúncio, não altera
> preço e não salva a simulação. Revise os dados antes de fechar uma compra.

## 1. Antes de começar

Separe estas informações:

1. custo de compra de uma unidade;
2. preço de venda que deseja testar;
3. margem mínima desejada;
4. alíquota de impostos e custos operacionais por unidade;
5. categoria do produto no Mercado Livre, dimensões da embalagem e peso real.

A **categoria é opcional**, mas é altamente recomendada. Sem ela, a calculadora exibe o aviso
**Categoria ainda não foi informada** e trabalha em modo de estimativa. Comissão, taxa fixa e frete
podem mudar de uma categoria para outra.

## 2. Acessar a calculadora

1. Entre no PubliAI.
2. No menu lateral, clique em **Viabilidade**.
3. Na parte superior da página, selecione a aba **Calculadora ML**.
4. Confirme que o título **Calculadora Mercado Livre** aparece na tela.

O formulário fica à esquerda e os resultados ficam à direita. Em telas pequenas, os resultados
aparecem abaixo do formulário.

## 3. Escolher entre um produto cadastrado e um produto avulso

Na seção **Contexto da simulação**, escolha uma das opções:

- **Produto cadastrado:** selecione um item da lista para preencher os dados disponíveis no
  PubliAI. Use esta opção para analisar um produto que já faz parte da sua operação.
- **Produto avulso:** mantenha essa opção para avaliar uma oportunidade nova, mesmo que o produto
  ainda não esteja cadastrado.

Selecionar um produto é apenas um atalho de preenchimento. Você pode alterar os valores carregados
sem modificar o cadastro original. Para voltar ao modo avulso, clique em **Limpar produto
cadastrado**.

## 4. Informar a categoria do Mercado Livre

1. Clique no campo **Categoria Mercado Livre**.
2. Digite o nome do produto, por exemplo `tecido`, ou um código de categoria, como `MLB418380`.
3. Aguarde as sugestões da API do Mercado Livre.
4. Compare o nome e o código das opções apresentadas.
5. Selecione a categoria que melhor descreve o produto vendido.

Depois da seleção, a calculadora consulta as taxas aplicáveis à categoria e ao preço informado.
Quando a consulta termina, confira o selo apresentado no resultado:

| Selo | O que significa | Como usar o resultado |
|---|---|---|
| **Oficial · API ML** | Comissão e frete vieram da API para os dados informados | É o cenário mais confiável para decidir |
| **Parcial · frete manual** | A comissão veio da API, mas o frete foi informado manualmente | Confirme o frete antes da decisão |
| **Estimativa · dados manuais** | A conta depende de valores manuais ou está sem categoria | Use para triagem e valide antes de comprar |

> **Se não souber a categoria:** você pode continuar sem selecionar uma opção, mas o alerta ficará
> visível para lembrar que o resultado é uma estimativa. Não interprete uma estimativa como tarifa
> garantida pelo Mercado Livre.

## 5. Preencher os dados de compra e venda

Preencha a seção **Compra e venda**:

1. Em **Custo de compra (R$)**, informe quanto a empresa paga por uma unidade do produto.
2. Em **Preço de venda (R$)**, informe o preço que deseja testar no anúncio.
3. Em **Margem-alvo (%)**, informe a margem mínima esperada sobre o faturamento.
4. Em **Impostos (%)**, informe a alíquota total aplicável à venda.

Use sempre valores por unidade. Se o anúncio vende um kit, considere o custo total de tudo que será
entregue naquele kit.

### Exemplo

Para acompanhar este guia, use:

| Campo | Valor de exemplo |
|---|---:|
| Custo de compra | R$ 50,00 |
| Preço de venda | R$ 100,00 |
| Margem-alvo | 20% |
| Impostos | 4% |

## 6. Informar os custos operacionais

Na seção **Custos operacionais**, preencha:

- **Custos fixos por unidade (R$):** rateio de despesas que incidem sobre cada venda, como
  embalagem ou preparação.
- **Custos variáveis (R$):** despesas que mudam conforme a venda, como material adicional ou taxa
  operacional externa.
- **Rebate/desconto (R$):** crédito, bonificação ou desconto que reduz o custo efetivo da operação.

No exemplo, use R$ 5,00 de custos fixos, R$ 3,00 de custos variáveis e R$ 2,00 de rebate.

> Não registre o mesmo custo em dois campos. Se a embalagem já faz parte do custo de compra, por
> exemplo, não a repita em custos fixos.

## 7. Informar dimensões e peso

Na seção **Logística e taxas manuais**, informe as medidas da embalagem pronta para envio:

1. **Altura (cm)**;
2. **Largura (cm)**;
3. **Comprimento (cm)**;
4. **Peso real (kg)**.

Os quatro valores precisam ser maiores que zero para que as dimensões sejam usadas. A calculadora
compara o peso real com o peso cubado e utiliza o maior deles, seguindo a lógica de cobrança
logística.

No exemplo, use 10 cm × 20 cm × 30 cm e 1 kg. O rodapé do resultado mostrará o **peso utilizado** e
o **peso cubado**.

> Meça a embalagem final, não apenas o produto. Uma caixa maior pode aumentar o peso cubado e mudar
> o frete.

## 8. Usar o fallback manual somente quando necessário

O bloco **Fallback manual (estimativa)** existe para os casos em que a cotação oficial não está
disponível. Ele contém:

- **Comissão (%);**
- **Taxa fixa (R$);**
- **Frete (R$).**

Prefira sempre a categoria e a cotação oficial. Se precisar usar o fallback:

1. confirme os valores em uma fonte confiável;
2. informe comissão, taxa fixa e frete;
3. marque **Frete realmente zero** somente quando tiver certeza de que não haverá cobrança de
   frete para o vendedor.

Digitar `0` no frete não basta. A confirmação existe para impedir que um frete desconhecido seja
tratado como gratuito e produza uma margem artificialmente alta.

## 9. Aguardar a atualização do resultado

O resultado é atualizado conforme os campos são preenchidos. Durante a consulta, pode aparecer
**Consultando taxas oficiais…**. Aguarde a conclusão antes de interpretar os números.

Depois, confira o bloco **Status da cotação**. Ele deve explicar se as taxas são oficiais, parciais
ou estimadas. Se a tela mostrar **Dados insuficientes**, leia a justificativa e complete o preço, o
custo, as dimensões ou o frete indicado.

## 10. Interpretar a Central de decisão

A **Central de decisão** resume o cenário da modalidade selecionada:

| Veredito | Significado | Próxima ação sugerida |
|---|---|---|
| **Comprar** | O lucro é positivo e a margem atinge a meta | Validar os dados e considerar a compra |
| **Negociar custo** | A margem está abaixo da meta, mas um custo menor pode viabilizar a operação | Negociar até o custo máximo indicado |
| **Ajustar preço** | O custo atual pode funcionar com outro preço de venda | Testar e validar o preço projetado |
| **Evitar** | A estrutura atual não comporta a margem desejada | Rever produto, custos ou oportunidade |
| **Dados insuficientes** | Falta uma informação necessária para calcular | Completar os dados informados no aviso |

O veredito considera a modalidade escolhida para decisão. Em celular, use as abas **Clássico** e
**Premium** para alternar. Em telas maiores, os dois resultados aparecem lado a lado.

## 11. Comparar Clássico e Premium

Para cada modalidade, observe:

- **Lucro:** valor que sobra por unidade depois de todos os custos informados;
- **Margem:** lucro como percentual do preço de venda;
- **Composição do custo:** produto, comissão, frete, impostos, custos fixos, custos variáveis e
  rebate;
- **Total:** soma líquida dos custos considerados;
- **Custo máximo de compra:** maior custo do produto que ainda permite alcançar a margem-alvo;
- **Preço para margem-alvo:** preço projetado para buscar a margem desejada.

O Premium normalmente possui comissão maior. Ele só deve ser escolhido quando seus benefícios
comerciais compensarem a diferença de custo. Compare o lucro e a margem, não apenas a exposição do
anúncio.

No exemplo descrito neste guia, uma consulta oficial realizada em 19/08/2026 para a categoria
`MLB418380` produziu estes valores:

| Modalidade | Lucro | Margem | Comissão | Frete | Custo máximo | Preço projetado |
|---|---:|---:|---:|---:|---:|---:|
| Clássico | R$ 11,85 | 11,85% | R$ 12,00 | R$ 16,15 | R$ 41,85 | R$ 112,73 |
| Premium | R$ 6,85 | 6,85% | R$ 17,00 | R$ 16,15 | R$ 36,85 | R$ 122,29 |

Esses números são ilustrativos. As tarifas do Mercado Livre podem mudar conforme categoria, preço,
logística e regras vigentes. O valor válido para sua decisão é o que a tela consultar no momento da
simulação.

## 12. Usar o custo máximo de compra

O **custo máximo de compra** responde: “quanto posso pagar pelo produto e ainda atingir minha
margem-alvo no preço atual?”.

No exemplo Clássico, o custo informado foi R$ 50,00, mas o custo máximo é R$ 41,85. Portanto:

1. não compre imediatamente pelo custo atual;
2. use R$ 41,85 como teto de negociação;
3. refaça a simulação se o fornecedor oferecer outro valor;
4. confirme se os demais custos continuam corretos.

Um custo máximo negativo ou muito abaixo do valor do fornecedor indica que a operação precisa de
uma mudança mais ampla, como aumento de preço ou redução de despesas.

## 13. Usar e validar o preço projetado

O **Preço para margem-alvo** é uma projeção matemática. Ele ainda precisa ser submetido novamente à
API porque comissão e taxa fixa podem mudar quando o preço passa para outra faixa.

1. Localize **Preço para margem-alvo** na modalidade desejada.
2. Confira se esse preço faz sentido comercialmente.
3. Clique em **Validar preço projetado na API**.
4. Aguarde a nova consulta.
5. Procure a confirmação **Preço projetado validado na API**.
6. Confira novamente o selo de procedência e os valores exibidos.

Se a validação indicar frete manual, trate o resultado como parcial. Se ocorrer um erro, revise a
categoria, o preço e as dimensões e tente novamente.

## 14. Analisar a sensibilidade

A seção **Sensibilidade** mostra quanto o lucro muda em três situações adversas:

- custo de compra 10% maior;
- preço de venda 5% menor;
- frete R$ 5,00 maior.

Escolha a modalidade que deseja analisar e leia a variação de cada cenário. Um número negativo
indica quanto o lucro por unidade diminuiria.

No exemplo Clássico:

| Cenário | Variação do lucro |
|---|---:|
| Custo de compra +10% | −R$ 5,00 |
| Preço de venda −5% | −R$ 4,20 |
| Frete +R$ 5,00 | −R$ 5,00 |

Use essa seção para medir a folga da oportunidade. Se uma pequena mudança elimina o lucro, a compra
tem risco maior e merece negociação adicional.

## 15. Checklist antes de tomar a decisão

Antes de comprar estoque ou definir o preço:

- [ ] A categoria corresponde exatamente ao produto.
- [ ] O selo mostra **Oficial · API ML**, ou os dados manuais foram confirmados.
- [ ] Custo, impostos e despesas estão informados por unidade.
- [ ] As dimensões são da embalagem pronta e o peso está em quilogramas.
- [ ] O frete zero foi marcado somente quando realmente não existe cobrança.
- [ ] A modalidade escolhida atinge a margem mínima da empresa.
- [ ] O preço projetado foi validado na API.
- [ ] Os cenários de sensibilidade ainda deixam uma margem aceitável.

## 16. Problemas comuns

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| Alerta de categoria continua visível | Nenhuma categoria foi selecionada | Pesquise pelo nome ou código MLB e selecione uma sugestão |
| Resultado mostra **Estimativa** | Categoria ausente ou taxas manuais em uso | Selecione a categoria e aguarde a consulta oficial |
| Resultado mostra **Parcial** | Comissão oficial disponível, mas frete veio do campo manual | Confirme o frete e as dimensões |
| Aparece **Frete não calculado** | Dimensões incompletas e nenhum frete manual confirmado | Preencha as quatro medidas ou informe um frete confiável |
| Aparece **Dados insuficientes** | Preço igual a zero ou cotação incompleta | Leia os fatores da Central de decisão e complete os campos |
| Categoria não aparece na busca | Termo muito genérico, código incorreto ou falha de consulta | Tente um nome mais específico ou o código completo `MLB...` |
| Margem parece alta demais | Algum custo não foi informado ou o frete foi considerado zero | Revise a composição de custos e a confirmação do frete |
| Lucro fica negativo | O preço não cobre todos os custos | Negocie o custo, teste outro preço ou evite a oportunidade |
| Preço projetado não pode ser calculado | A soma de taxas e margem torna a meta inviável | Reduza custos ou escolha uma margem-alvo possível |
| Produto cadastrado carregou valores antigos | O cadastro pode estar desatualizado | Corrija os campos da simulação; isso não altera o produto original |

## 17. Boas práticas

1. Faça uma simulação por produto e por tipo de embalagem.
2. Recalcule quando preço, categoria, peso, comissão ou frete mudar.
3. Use a margem-alvo definida pela empresa, não uma estimativa pessoal.
4. Guarde externamente os dados importantes da decisão, pois a simulação não é salva.
5. Trate o resultado como apoio financeiro; disponibilidade de estoque, demanda e concorrência
   também devem fazer parte da decisão de compra.
