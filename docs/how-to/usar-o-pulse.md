# How-to — Usar o Pulse (radar de concorrência)

> **Tipo:** How-to (Diátaxis). Guia do operador para o menu **Pulse**. Decisão de arquitetura em
> [../decisions/0119-pulse-inteligencia-de-mercado-dirigida.md](../decisions/0119-pulse-inteligencia-de-mercado-dirigida.md);
> termos em [../reference/glossario.md](../reference/glossario.md).
> **Em produção desde:** 2026-08-16.

> ## ⚠️ Cobertura: só produtos de catálogo
>
> O Pulse enxerga **apenas anúncios vinculados a uma ficha de catálogo** do Mercado Livre (as
> páginas `/p/MLBxxxxx`). Medido em 16/08/2026 nos anúncios publicados:
>
> | Organização | Anúncios publicados | No radar | Fora do radar |
> |---|---:|---:|---:|
> | DSA | 7 | 5 | 2 |
> | Avil | 133 | 15 | **118 (89%)** |
>
> Isso **não** é falta de configuração: são produtos que não existem no catálogo do ML — aviamentos
> e itens genéricos, cujos códigos de barras são internos da empresa (faixa GS1 iniciada em `2`),
> não GTINs globais. Testados 10 desses códigos, nenhum tem ficha no ML.
>
> Para esses anúncios **não existe caminho pela API**: a busca textual do ML foi descontinuada
> (403) e anúncio de terceiro é inacessível (403). Cobri-los depende da extensão de navegador
> prevista para a v2 — ver a seção 11.

O Pulse responde três perguntas que antes você respondia no olho:

| Pergunta | Onde ela é respondida |
|---|---|
| Meu preço ainda está competitivo? | Tela do radar + detalhe do produto |
| Quando eu preciso agir? | Aba **Alertas** (e o sino de notificações) |
| Até onde posso baixar sem prejuízo? | Simulador de margem, dentro do detalhe |

Ele **não** publica nem altera nada sozinho. Toda mudança de preço continua passando pela Revisão,
como sempre.

---

## 1. Antes de começar

Três coisas precisam estar no lugar. Se o menu **Pulse** não aparece na barra lateral, é uma delas:

1. **Módulo habilitado para a sua organização.** É uma trava de super-admin: menu **Organizações** →
   linha da org → botão **Módulos** → marcar `Pulse` → salvar. Hoje só a org **DSA** está com o
   módulo ligado; a Avil já é coletada (o histórico dela acumula desde 16/08), mas ainda não vê a
   tela.
2. **Permissão de menu do seu usuário.** Usuários não-admin precisam ter `Pulse` na lista de menus
   permitidos (menu **Usuários** → editar usuário → marcar Pulse). Admin enxerga todos os menus,
   independentemente disso.
3. **Conexão com o Mercado Livre ativa** na organização. É a mesma conexão que publica os anúncios —
   o Pulse usa ela só para **ler** o catálogo público.

---

## 2. Como o Pulse decide o que vigiar

O radar não varre o Mercado Livre inteiro. Ele acompanha **fichas de catálogo** (aquelas páginas
`/p/MLBxxxxx` onde vários vendedores disputam o mesmo produto), e elas entram de dois jeitos:

**Automático (o normal).** Todo anúncio seu que está publicado e vinculado a uma ficha de catálogo
entra no radar sozinho, na primeira coleta seguinte. Você não precisa cadastrar nada. Se você
despublicar o anúncio, o produto sai do radar (vira `arquivado`) — o histórico fica guardado.

**Manual (pesquisa de oportunidade).** Você adiciona uma ficha que ainda não vende, para estudar o
mercado antes de entrar. Ver a seção 4.

Na lista, a coluna **Origem** mostra qual é qual: `Auto` ou `Manual`.

### Com que frequência os dados atualizam

| Coleta | Quando roda | O que atualiza |
|---|---|---|
| Completa | Todo dia, 06:00 (horário de Brasília) | Sincroniza o radar com seus anúncios publicados, coleta ofertas, vendedores e a referência de preço do ML |
| Rápida | A cada 6 horas | Só as ofertas (preço, frete, quem está no catálogo) dos produtos automáticos |
| Sob demanda | Quando você clica em **Atualizar agora** | Coleta completa, limitada a 50 produtos da sua organização |

Cada execução tem um teto de produtos, então numa organização com muitos anúncios o radar completa a
volta em alguns ciclos — quem ficou de fora é sempre o primeiro da vez seguinte. Isso é normal e não
perde dado.

---

## 3. A tela do radar, coluna por coluna

Abra **Pulse** na barra lateral. A lista mostra uma linha por ficha de catálogo monitorada.

- **Produto** — nome da ficha no Mercado Livre. Abaixo, em cinza, o EAN do produto. Quando a
  última coleta passou de 2 dias, aparece um aviso em amarelo ao lado. Anúncio que não está à
  venda ganha uma etiqueta aqui — **Sem estoque**, **Pausado no ML** ou **Fora do ar**.
- **Seu preço** — o preço da **sua oferta nessa ficha**, lido do Mercado Livre na última coleta.
  É o preço que o comprador vê, já com promoção se houver — e não o que está cadastrado aqui
  dentro. Um `—` não é falha: passe o mouse e a célula diz o motivo (anúncio pausado ou sem
  estoque, sem vínculo de catálogo, ficha manual, ou ainda sem a primeira coleta).
- **Menor relevante** — o menor preço entre os concorrentes **qualificados** daquela ficha. Não é o
  menor preço que aparece na página do ML: vendedor com menos de 10 transações, sem visitas nos
  últimos 30 dias ou com reputação laranja/vermelha fica fora da régua (ADR-0130). Perseguir preço
  de quem não se sustenta destrói margem. O seu próprio anúncio nunca entra na conta.
  Quando existem ofertas ativas **abaixo** dessa referência, a célula avisa — elas existem e o
  comprador as vê, mesmo não entrando na comparação.
- **7 dias (observado)** — minigráfico do menor preço **observado** na ficha, dia a dia, nos
  últimos 7 dias. É o menor de **todas** as ofertas ativas, inclusive as que a régua de relevância
  deixou de fora — não o menor relevante da coluna ao lado; o próprio cabeçalho da coluna avisa
  isso. Produto com menos de dois dias de movimento ainda não tem gráfico. Só aparece em telas
  largas.
- **Sua posição** — quanto você está acima ou abaixo do menor relevante, em %. É a leitura que
  decide reprecificar: `+7% mais caro`, `10% mais barato`, `Empatado` (diferença abaixo de 0,5%).
  Amarelo a partir de +0,5%; vermelho só a partir de +15%.
- **Sobra hoje** — quanto sobra por unidade no seu preço atual, já descontados comissão do Mercado
  Livre, frete, imposto por origem e custo do produto. Vermelho é prejuízo. Um `—` aqui **nunca** é
  zero: passe o mouse e a célula diz qual insumo falta (custo, alíquota, comissão ou frete). O Pulse
  não estima imposto nem custo.
- **Ofertas** — quantos vendedores estão ativos na ficha agora, **todos**, inclusive os que a régua
  de relevância deixou de fora. É por isso que este número costuma ser maior que o da coluna
  **Disputa do catálogo**, ao lado.
- **Disputa do catálogo** — três fatos sobre a página de catálogo: quantos anúncios **relevantes**
  disputam, entre que preços, e — no tooltip — em que posição o seu preço **ficaria** se você
  entrasse lá. "Ficaria", e não "está": o seu anúncio não é anúncio de catálogo, então ele não faz
  parte da lista que gerou a faixa (ADR-0147). O Pulse **não** diz quem leva a venda: o ganhador do
  buy-box não é obtenível pela API do ML, e o mais barato não é o ganhador.
- **Reprecificar** (atalho na linha, a partir de telas médias) — abre o simulador com o preço atual
  pronto para ajustar, sem passar pelo detalhe. Some junto com a coluna **Sobra hoje** no mesmo
  ponto de quebra: o atalho nunca aparece sem o número que justifica usá-lo.
- **⋮** (menu da linha) — pausar ou reativar o produto no radar. Essa coluna fica fixa à direita:
  quando a tabela rola na horizontal (telas estreitas), ela continua visível em vez de sair da tela
  ou cobrir as colunas vizinhas.

> A coluna **Referência do ML** foi removida em 2026-08-29 (ADR-0147, D-24): ela comparava o seu
> preço contra um universo não comparável — a nossa pomada de 50 ml contra apresentações de 49 g —
> e induzia decisão errada. A coleta continua, só a exibição saiu.

Clique em qualquer cabeçalho para ordenar por aquela coluna, e em qualquer linha para abrir o
**detalhe**.

### Filtrar a lista

Três controles, que se acumulam:

- **Os quatro cartões do topo são filtros.** Clique em "Mais caro que o mercado" e a lista passa a
  mostrar só esses produtos; clique de novo no mesmo cartão para remover o recorte. "No radar"
  limpa tudo e devolve a lista inteira. O cartão aplicado fica destacado.
- **Buscar por nome ou EAN** — também aceita o código do produto.
- **Situação do anúncio** — Todos / Só anúncios ativos / Só anúncios pausados. É a situação real no
  Mercado Livre, lida na coleta. "Pausado" inclui tudo que não está à venda: estoque zerado,
  pausa manual, moderação. Produto cuja situação ainda não foi lida não entra em nenhum dos dois
  recortes — só em "Todos".

  Não confunda com o **pausar no radar** do menu ⋮ da linha: aquilo só faz o Pulse parar de
  acompanhar o produto, e a linha continua na lista, esmaecida.

Com qualquer filtro aplicado aparece a contagem ("12 de 222") e o botão **Limpar filtros**.
O ícone **i** de cada cartão abre a explicação do número sem aplicar o filtro.

> **Traço `—` em Menor relevante e Ofertas** quer dizer que a ficha ainda não teve a primeira coleta.
> Espere o próximo ciclo ou clique em **Atualizar agora**.

---

## 4. Adicionar um produto manualmente

Use quando quiser estudar um mercado **antes** de publicar nele.

1. Clique em **Adicionar produto**.
2. Cole **uma** destas duas coisas:
   - o link da página de catálogo: `https://www.mercadolivre.com.br/p/MLB123456`
   - ou o **GTIN/EAN** do produto: `7891113108010`
3. Clique em **Adicionar**. O produto aparece no radar com origem `Manual`.
4. Clique em **Atualizar agora** se não quiser esperar a coleta da madrugada.

**O que não funciona (e por quê):** o link de um anúncio avulso de outro vendedor — aquele formato
`produto.mercadolivre.com.br/MLB-123456789`. O Mercado Livre bloqueia o acesso de terceiros a
anúncios individuais pela API (erro 403, sempre). Só páginas de **catálogo** são consultáveis. Se
você colar um link desses, o sistema recusa com essa explicação em vez de aceitar e ficar vazio.

**Dica:** na dúvida, use o GTIN. É mais confiável que o link, porque o Pulse resolve a ficha oficial
do produto direto no catálogo do ML.

---

## 5. O detalhe do produto

Clicando numa linha do radar, você vê três blocos, nesta ordem: a decisão (seu preço x mercado, com
o simulador logo abaixo), o histórico de preço e só depois a lista de concorrentes — a decisão vem
primeiro, a evidência é o que você rola para conferir.

### Sua posição e o simulador (só para produtos que você vende)

Três números lado a lado:

- **Seu preço** — o preço da sua oferta nessa ficha, lido do ML na última coleta.
- **Menor concorrente relevante** — a oferta relevante mais barata da ficha, sem contar você. Quando
  existe uma oferta observada mais barata (fora da régua de relevância), aparece embaixo: "Menor
  oferta observada: R$ X".
- **Sua posição** — quanto você está acima ou abaixo do menor relevante.

Quando há ofertas ativas abaixo da sua referência, um aviso aparece logo abaixo dos três números —
o mesmo dado e a mesma régua da seção 3.

Abaixo, o simulador: digite um preço e o Pulse calcula o que **sobra**:

- **Sobra para você** — o que resta no preço simulado, com a decomposição visível ao lado (comissão,
  frete, imposto, custo) — não escondida num tooltip. Aparece "estimativa" quando a comissão que
  temos foi lida em outro preço — ela muda por faixa. Ver a seção 6 para a regra completa.

### Menor oferta observada no período

O histórico do menor preço **observado** da ficha (todas as ofertas ativas, últimos 14 pontos), um
ponto por dia em que **algo mudou**. Dia sem mudança não gera linha — então a lista mostra movimento
real, não repetição. Com menos de dois dias de movimento, este bloco não aparece.

### Concorrentes

A lista de quem está vendendo aquela ficha **agora**, com um contador no título ("N relevantes de M
observadas") e dois filtros — **Relevantes** (padrão) e **Todas**. Começa ordenada da mais barata
para a mais cara, e **todo cabeçalho é clicável para reordenar**:

- **Preço** praticado — o menor vem destacado.
- **Vendedor** — apelido no ML, "Loja oficial" quando é o caso, e um selo de qualificação
  (**Relevante**, **Em observação** ou **Fora da referência**) com o motivo ao lado quando não é
  relevante — poucas transações, sem visitas nos últimos 30 dias ou reputação baixa (ADR-0130). O
  nível de reputação vem num "Ver detalhes da conta" expansível, com transações, avaliações
  positivas e, quando o ML expõe, reclamações/atrasos/cancelamentos.
- **Estado** — a UF de onde aquele vendedor envia. Serve para ler o preço com o frete junto: um
  rival em SP chega mais rápido e mais barato no Sudeste do que um do Nordeste, e um concorrente
  R$ 2 mais barato do outro lado do país pode não ser mais barato para o comprador. Aparece "—"
  quando o Mercado Livre não expõe o endereço daquele vendedor.
- **Porte do vendedor** — média mensal dos últimos 12 meses da **loja inteira** daquele vendedor
  (ADR-0146). O campo que o ML expõe é uma janela móvel de 365 dias, então dividi-lo por 12 dá
  média mensal de verdade; a versão anterior mostrava o *delta* entre duas leituras e chamava isso
  de venda, o que estava errado. Abaixo do número aparece a tendência: *vende mais que há 1 ano*,
  *mesmo ritmo*, *vende menos*.
- **Visitas 30d** — visitas naquele anúncio do concorrente nos últimos 30 dias, e a fatia que ele
  representa entre os relevantes. É a única medida **por anúncio** que a API oficial dá. Tráfego não
  é venda: não leia como fatia de mercado. `—` significa "ainda não medido", nunca zero.
- **Anúncio** — tipo (Clássico, Premium), frete grátis e o selo **FULL** (Mercado Envios Full)
  quando houver — FULL muda o prazo de entrega, o que decide a compra quando o preço empata.
- **Oferta** — botão **Abrir**, que leva direto ao anúncio daquele concorrente no Mercado Livre
  (nova aba). Sem o link, a célula diz "Indisponível".

> **Leia com atenção:** Porte do vendedor é do **vendedor inteiro**, não daquele anúncio específico.
> Um vendedor com 20.000 transações pode ter vendido dez unidades do produto que te interessa. Use
> como sinal de porte e atividade do concorrente, nunca como "vendas deste produto". Visitas 30d,
> ao contrário, já é por anúncio. A seção 11 explica por que essa é a informação disponível.

**Buscar anúncios no Mercado Livre**, no topo do detalhe ao lado do EAN, abre uma busca do
Mercado Livre pelo GTIN (ou pelo título, se não houver GTIN) numa nova aba — não é a página oficial
de catálogo. Para abrir o anúncio de um concorrente específico, use o botão **Abrir** da linha dele.

---

## 6. O simulador de margem

Digite um preço no campo e o Pulse calcula o que **sobra** para você naquele preço:

> Líquido **R$ 12,40** *(23,1%)*

A conta desconta, do preço digitado: a **comissão** e o **frete** do Mercado Livre para o seu
anúncio, o **imposto** conforme a origem do produto (nacional ou importado) e o **custo** do
produto cadastrado no PubliAI. Passe o mouse em "(comissão R$ …)" ao lado do rótulo para ver as
quatro parcelas.

> **Por que às vezes aparece "estimativa"**
>
> A comissão do Mercado Livre muda conforme a faixa de preço e a categoria — na mesma categoria
> pode ser 14% até cerca de R$ 100 e 11% acima disso, e produtos baratos ainda levam uma parcela
> fixa. O Pulse lê a taxa exata **no preço em que o anúncio estava na hora da coleta** e guarda
> esse preço junto. Quando o preço que você está vendo é outro — porque você simulou, porque está
> reprecificando, ou porque o anúncio não tinha oferta viva na ficha naquela coleta — o resultado
> sai marcado como estimativa. Quanto mais longe daquele preço, mais o número pode escorregar.
>
> O rótulo aparece **sempre** na janela de Reprecificar: ali você está digitando um preço novo por
> definição, então a taxa guardada quase nunca é a daquele preço.

### Quando aparece "Margem indisponível: falta ..."

O Pulse **nunca chuta** um número financeiro. Se faltar qualquer peça da conta, ele diz exatamente
qual e não mostra margem nenhuma. As causas:

| Mensagem | O que fazer |
|---|---|
| falta **custo do produto** | Cadastre o custo das variações (menu Estoque → entrada de produto). Sem custo real não existe margem real. |
| falta **alíquota de imposto** | Confirme as alíquotas em **Configurações** (nacional 8% / importado 16%). Enquanto não estiverem confirmadas, o sistema se recusa a assumir um valor. |
| falta **comissão do Mercado Livre** | A coleta ainda não leu a taxa desse anúncio. Costuma resolver sozinho na coleta seguinte. |
| falta **custo de frete do Mercado Livre** | A coleta ainda não leu o custo de envio para esse anúncio. Desde a Errata 11 (ADR-0119), o frete vem do endpoint `shipping_options/free` na coleta completa (passo 5b), no preço efetivo do anúncio — não depende mais do endpoint esparso de sugestões do price-to-win. Quando o comprador paga o frete, o valor gravado é **R$ 0,00** (válido). Aguarde a próxima coleta completa ou use "Atualizar agora". |

Isso é proposital: um número de margem errado é pior do que nenhum número — leva a baixar preço
abaixo do custo achando que está no lucro.

---

## 7. Alertas

Quando algo muda no seu mercado, o Pulse grava um alerta. Eles ficam na aba **Alertas**, ao lado de
Radar e Sonar — não mais num cartão no topo do Radar.

Cada alerta nasce com uma **severidade** (ADR-0133), decidida contra o **seu preço** no instante do
evento:

- **Ação** — muda decisão de preço: o menor preço da ficha caiu abaixo do seu, um concorrente novo
  entrou abaixo do seu, ou o concorrente que te segurava embaixo saiu e agora ninguém mais está
  abaixo de você (oportunidade de subir preço). Sem oferta sua na ficha, o alerta nunca é Ação —
  não há preço seu para comparar.
- **Informativo** — o resto: movimento de mercado que não muda a sua posição de preço.

A aba abre em **Ação**, porque é o que exige você. Os outros dois filtros (**Informativo** e
**Todos**) ficam a um clique. O número ao lado do nome **Alertas**, na barra de abas, conta só
alertas de Ação não lidos — não o total. Se ele estiver em branco ou zero, não é bug: quer dizer que
não há nada pendente que mude decisão de preço agora, mesmo que existam vários alertas informativos
esperando.

**A linha é o produto, não o evento** (ADR-0133 Errata 4). Vários movimentos do mesmo produto viram
uma linha só — o texto exibido é do movimento mais recente, com a idade ao lado ("há 3h"). Quando há
mais de um, um contador "· N movimentos" abre a lista dos demais, cada um com o próprio texto e
idade. Alerta sem produto (ficha removida do radar) fica sozinho na própria linha.

| Alerta | O que significa | O que costuma valer a pena fazer |
|---|---|---|
| **Menor preço de X caiu de R$ A para R$ B (-N%)** | Alguém abaixou o preço e agora é a oferta mais barata da ficha | Abrir o simulador e ver se cobrir ainda te deixa com margem — muitas vezes não vale |
| **Novo concorrente em X a R$ B** | Um vendedor que não estava na ficha entrou | Olhar reputação e preço dele no detalhe; loja oficial entrando muda o jogo |
| **Um concorrente saiu de X** | Um vendedor sumiu da ficha (encerrou ou ficou sem estoque) | Se ele era o mais barato, muitas vezes dá para **subir** o preço |

Cada linha (produto) tem até três botões:

- **Ver produto** — abre o detalhe daquela ficha.
- **Reprecificar** — aparece quando o grupo tem uma queda de preço em produto que você vende. Segue
  a queda **mais recente do grupo**, mesmo que o texto da linha esteja mostrando um movimento mais
  novo (um concorrente que entrou depois, por exemplo) — a queda não fica escondida atrás de outro
  evento.
- **✓** — marca **todos os movimentos daquele produto já carregados na tela** como lidos, não só o
  mais recente, e a linha some.

O botão **Marcar N como lidos**, no cabeçalho da aba, marca os N não lidos do filtro **ativo** —
inclusive os que ainda não apareceram na tela, se a lista tiver mais de uma página. O único
recorte é no outro extremo: alerta que o coletor gravar **depois** de a lista ter carregado fica
de fora e continua pendente. Sem confirmação, porque marcar como lido não apaga o alerta, só some
da lista de pendentes. Trocar de filtro antes de clicar muda o que é marcado.

**Sem alertas de Ação agora?** A tela mostra os dois próximos passos: ver os alertas informativos
(com a contagem), ou ir direto para o Radar já filtrado nos produtos mais caros que o mercado — o
lugar mais provável de achar uma oportunidade de reprecificar mesmo sem alerta novo.

**Onde mais os alertas aparecem:** no sino de notificações do topo, na categoria **Pulse (mercado)**.
Hoje só administradores ativos estão inscritos nessa categoria; para incluir alguém, é o mesmo lugar
onde se configuram as demais notificações do usuário.

> **Na primeira coleta de um produto, o Pulse não gera alerta nenhum.** Ele precisa de uma leitura
> anterior para saber o que mudou — senão o dia 1 viraria uma enxurrada de "novo concorrente" para
> gente que já estava lá o tempo todo.

---

## 7.1 O Sonar (prospectar um nicho antes de cadastrar)

O Radar vigia o que você **já vende**. O Sonar varre um nicho **antes** do cadastro: digite um termo
("tecido oxford 10 metros") ou passe o leitor de código de barras num EAN.

O resultado abre com o **cabeçalho do nicho** — o termo buscado, o tamanho da amostra e quando ela
foi coletada. O resultado fica em cache por 7 dias: reabrir o mesmo termo é grátis e instantâneo;
um termo novo dispara uma coleta paga, e por isso não existe botão de "atualizar" aqui. Quando a
busca foi por GTIN/EAN, aparece também o botão **Adicionar ao Radar** — só faz sentido vigiar uma
ficha, e ficha exige GTIN; buscas por termo livre não têm esse botão.

Abaixo dele, na ordem:

1. **Veredito** — demanda e barreira de entrada em linguagem de comerciante, com o número que
   sustenta cada um e um "Saiba mais" que abre a pontuação inteira.
2. **Vendas do nicho** — vendas acumuladas, mercado endereçável e raio-x da amostra. Todos os
   números são **acumulados da vida dos anúncios**, nunca ritmo mensal. Clique no "i" de cada card.
3. **Quem vende neste nicho** — porte e tendência dos concorrentes, pela loja inteira deles.
4. **Dá lucro?** — a DRE. Informe custo, origem e as quatro medidas do pacote, e ela cota **cada um
   dos cinco preços** no Mercado Livre, separadamente. Sem os quatro campos do pacote ela recusa
   calcular e diz por quê: cotar com um pacote padrão daria um número oficial sobre uma caixa que
   não existe.
5. **A tabela dos 20 anúncios** — o botão **Simular** de cada linha troca a âncora da DRE para
   aquele anúncio e rola até ela. Não há um segundo simulador: a conta de margem do Pulse é uma só.

Dois vocabulários de percentual, e eles não são intercambiáveis: **Margem s/ venda** é lucro ÷
preço, **Markup** é lucro ÷ custo.

Os blocos 3 e 4 nascem **recolhidos** (cabeçalho padronizado, clicável, seta indica o estado); o
bloco 4 (a DRE) abre sozinho quando você clica em **Simular** numa linha da tabela. O bloco 2
(Vendas do nicho) fica sempre aberto.

---

## 8. Reprecificar (o caminho completo)

O botão **Reprecificar** existe em dois lugares: no alerta de queda de preço e dentro do detalhe do
produto (depois de simular um preço).

O que acontece quando você confirma:

1. O Pulse mostra a **margem naquele preço** — a mesma regra do simulador: se faltar insumo, ele diz
   o que falta em vez de inventar.
2. Ao clicar em **Gravar e ir para Revisão**, o novo preço é gravado em **todas as variações** do
   anúncio.
3. Você é levado para a tela de **Revisão**.
4. **Na Revisão você confere e publica**, exatamente como faz hoje com qualquer alteração.

Ou seja: o Pulse encurta o caminho até a decisão, mas **não publica nada no Mercado Livre**. A
revisão humana continua obrigatória.

### Quando aparece "Não achei uma família única publicável"

Significa que o código do produto está em mais de uma família (ou em nenhuma) com status pronto/erro
— o sistema se recusa a escolher no seu lugar. Você é levado à Revisão para ajustar o preço na
família certa, na mão. Acontece tipicamente com produto reprocessado em vários lotes.

---

## 9. Pausar, reativar e limpar o radar

No menu **⋮** de cada linha:

- **Pausar no radar** — o produto para de ser coletado, mas o histórico fica guardado. Use em ficha
  que virou ruído (produto sazonal fora de época, item que você não disputa mais).
- **Reativar no radar** — volta a coletar. O histórico antigo continua lá.

Produto **arquivado** (o que some da lista) acontece sozinho quando você despublica o anúncio de
origem. Se voltar a publicar, ele reaparece na próxima coleta completa.

---

## 10. Rotina sugerida

O Pulse foi feito para consumo rápido, não para ficar aberto o dia todo.

**Todo dia (2 minutos).** Abrir a aba **Alertas** — ela já abre no filtro Ação, e o número na aba
conta só esses. Agir no que muda decisão (normalmente queda de preço em produto onde você tem
margem folgada), marcar como lido o resto. Passar pelo filtro Informativo é opcional.

**Uma vez por semana (10 minutos).** Ordenar a lista pela coluna **Sua posição** (do mais caro para
o mais barato) e olhar o topo: são os anúncios onde você está mais acima do menor relevante.
Abrir cada um, simular o preço e decidir. A coluna **Sobra hoje** diz se há margem para reagir antes
de abrir o detalhe.

**Antes de entrar num produto novo.** Adicionar a ficha manualmente, esperar de 3 a 7 dias e olhar
"Menor oferta observada no período" e o número de ofertas. Mercado com muitos vendedores e preço
caindo todo dia é mercado de margem apertada — melhor descobrir isso antes de comprar estoque.

---

## 11. O que o Pulse não faz (e por quê)

Honestidade aqui evita decisão errada:

- **Não mostra quantas unidades um anúncio de concorrente vendeu.** O Mercado Livre bloqueia o acesso
  de terceiros a anúncios individuais pela API — testado, é erro 403 em todos os caminhos. O que dá
  para saber é o volume da **conta** do vendedor, e é isso que a tela mostra, sempre rotulado como
  estimativa. Ferramentas que mostram vendas por anúncio obtêm isso raspando o site pelo navegador,
  não pela API; isso está previsto para uma versão futura, com uma extensão de navegador.
- **Não vigia produtos fora de catálogo — e hoje isso é a maior parte dos anúncios.** Ver o aviso no
  topo deste guia: 89% dos anúncios da Avil e 2 dos 7 da DSA estão nessa situação. O motivo é a
  plataforma: catálogo no ML existe para produto identificável por marca e modelo; aviamentos e
  itens genéricos não têm ficha, e os códigos de barras deles são internos da empresa, não GTINs
  globais. Sem ficha, o ML não expõe nenhuma forma oficial de descobrir quem são os concorrentes.
  **É esse buraco que a extensão de navegador da v2 fecha** — lendo a página na sua sessão logada,
  ela enxerga qualquer anúncio, com ou sem catálogo.
- **Não faz busca livre por palavra-chave.** O endpoint de busca do ML foi descontinuado para
  aplicações (403, verificado em 16/08/2026). Você entra pelo GTIN ou pelo link da ficha. O que
  sobra de visão de mercado sem catálogo é por **categoria**, não por produto: o ranking de mais
  vendidos e os termos mais buscados — ainda não usados pelo Pulse.
- **Não altera preço no Mercado Livre.** Grava o preço e te leva à Revisão. Sempre.
- **Não tem dado retroativo.** O histórico começa no dia em que o produto entra no radar. Isso vale
  para produtos novos também — daí a recomendação de adicionar a ficha alguns dias antes de precisar
  da decisão.

---

## 12. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Menu Pulse não aparece | Módulo desligado para a org, ou menu não liberado para o usuário | Ver seção 1 |
| Radar vazio | Nenhum anúncio publicado com ficha de catálogo ainda | Publique ou adicione um produto manualmente |
| Coluna **Menor relevante** com `Sem concorrente relevante` | Produto ainda não teve a primeira coleta, ou nenhum concorrente passa na régua de relevância (ADR-0130) | **Atualizar agora**, ou esperar o ciclo |
| Coluna **Seu preço** com `—` | Sua oferta não está entre as ativas da ficha | Passe o mouse: o motivo aparece. Pausado/sem estoque é normal; sem vínculo tem conserto |
| **Seu preço** diferente do que você lembra ter cadastrado | A coluna mostra o preço **vigente no ML**, não o cadastrado aqui | O ML é a fonte. Se estiver errado lá, ajuste pela Revisão |
| Coluna **Sobra hoje** com `—` | Falta custo, alíquota, comissão ou frete | Passe o mouse: a célula diz qual. Custo e origem vêm da planilha; a alíquota, da configuração da org |
| "Margem indisponível" | Falta custo, alíquota confirmada, comissão ou frete | Ver a tabela da seção 6 |
| Adicionar produto recusado | Link de anúncio avulso em vez de ficha de catálogo | Use o link `/p/MLB…` ou o GTIN |
| Nenhum alerta há dias | Mercado parado, ou produtos ainda na primeira coleta | Normal — alerta só aparece quando algo muda de verdade |
| Alerta some depois de marcar lido | Comportamento esperado | O painel mostra só não lidos |

---

## Para quem opera o sistema

Detalhes técnicos (agendamentos, tetos por execução, tabelas, idempotência) estão em
[../reference/edge-functions.md](../reference/edge-functions.md) e
[../reference/modelo-de-dados.md](../reference/modelo-de-dados.md). O raciocínio por trás das
escolhas — inclusive a errata sobre vendas de terceiros — está no
[ADR-0119](../decisions/0119-pulse-inteligencia-de-mercado-dirigida.md).
