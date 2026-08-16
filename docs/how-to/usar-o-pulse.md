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
| Quando eu preciso agir? | Painel de alertas (e o sino de notificações) |
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
  última coleta passou de 2 dias, aparece um aviso em amarelo ao lado.
- **Seu preço** — o preço da **sua oferta nessa ficha**, lido do Mercado Livre na última coleta.
  É o preço que o comprador vê, já com promoção se houver — e não o que está cadastrado aqui
  dentro. Um `—` não é falha: passe o mouse e a célula diz o motivo (anúncio pausado ou sem
  estoque, sem vínculo de catálogo, ficha manual, ou ainda sem a primeira coleta).
- **Menor concorrente** — o **menor preço entre os concorrentes** naquela ficha. O seu próprio
  anúncio **não** entra nessa conta: você não é concorrente de si mesmo.
- **Sua posição** — quanto você está acima ou abaixo do menor concorrente, em %. É a leitura que
  decide reprecificar: `+7% mais caro`, `10% mais barato`, `Empatado`.
- **Ofertas** — quantos vendedores estão ativos na ficha agora (também sem contar você).
- **Referência do ML** — onde o seu preço está frente ao **preço de referência** que o próprio
  Mercado Livre calcula para o seu anúncio. Os quatro selos possíveis:

  | Selo | O que significa |
  |---|---|
  | **Abaixo da referência** | Seu preço está abaixo do preço de referência do ML. |
  | **Na referência** | Seu preço é igual ao preço de referência. |
  | **Acima da referência** | Seu preço está alto em relação à referência. |
  | **Acima de todos** | Seu preço está acima da referência **e** acima do maior preço dos concorrentes. |

  Quando a referência do ML vem de uma promoção, o selo mostra o estado dela:
  **Promoção sugerida**, **Promoção agendada** ou **Promoção ativa**.

  Dois selos não são posição de preço e sim explicação de por que não há nenhuma:
  **Sem vínculo de catálogo** (seu anúncio não está atrelado a essa ficha, então o ML não calcula
  referência — resolva o vínculo pelo fluxo de catálogo) e **Você não vende** (ficha manual,
  adicionada só para pesquisa).

- **⋮** (menu da linha) — pausar ou reativar o produto no radar.

Clique em qualquer cabeçalho para ordenar por aquela coluna, e em qualquer linha para abrir o
**detalhe**.

### Filtrar a lista

Três controles, que se acumulam:

- **Os quatro cartões do topo são filtros.** Clique em "Mais caro que o mercado" e a lista passa a
  mostrar só esses produtos; clique de novo no mesmo cartão para remover o recorte. "No radar"
  limpa tudo e devolve a lista inteira. O cartão aplicado fica destacado.
- **Buscar por nome ou EAN** — também aceita o código do produto.
- **Situação no radar** — Todos / Só ativos / Só pausados. Atenção: "pausado no radar" é o produto
  que **você** pausou pelo menu ⋮ da linha, para parar de acompanhá-lo. Não tem relação com o
  anúncio estar pausado no Mercado Livre.

Com qualquer filtro aplicado aparece a contagem ("12 de 222") e o botão **Limpar filtros**.
O ícone **i** de cada cartão abre a explicação do número sem aplicar o filtro.

> **Cuidado para não confundir duas referências diferentes.** "Menor concorrente" é o piso real da
> ficha. A "Referência do ML" é um preço que o Mercado Livre calcula a partir de concorrentes
> internos e externos — **não** é o menor preço da ficha. Por isso um produto pode aparecer como
> `Abaixo da referência` (o ML acha que você poderia cobrar mais) e ao mesmo tempo `+7% mais caro`
> que o menor rival. As duas informações são verdadeiras e olham para coisas distintas.

> **Traço `—` em Menor preço e Ofertas** quer dizer que a ficha ainda não teve a primeira coleta.
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

Clicando numa linha do radar, você vê três blocos.

### Ofertas atuais

A lista de quem está vendendo aquela ficha **agora**, ordenada da mais barata para a mais cara:

- **Preço** praticado.
- **Vendedor** — apelido no ML, o selo de reputação (`gold`, `platinum`…) e, quando já há histórico,
  duas informações de volume:
  - *"N vendas totais do vendedor"* — o total de transações da conta dele no ML inteiro, desde
    sempre.
  - *"≈N vendas do vendedor no período (estimado)"* — quanto essa conta vendeu desde que o Pulse
    começou a acompanhar.
- **Frete** — se a oferta tem frete grátis.
- **Loja** — se é loja oficial.
- **Tier** — tipo de anúncio (clássico, premium).

> **Leia com atenção:** esses números são do **vendedor inteiro**, não daquele anúncio específico. Um
> vendedor com 20.000 transações pode ter vendido dez unidades do produto que te interessa. Use como
> sinal de porte e atividade do concorrente, nunca como "vendas deste produto". A seção 11 explica
> por que essa é a informação disponível.

### Menor preço por dia de coleta

O histórico do menor preço da ficha, um ponto por dia em que **algo mudou**. Dia sem mudança não
gera linha — então a lista mostra movimento real, não repetição.

Esse bloco começa vazio ("Ainda sem histórico suficiente") e vai ganhando corpo com os dias. É o
valor que só o tempo constrói: depois de duas semanas você enxerga se o mercado está descendo,
subindo ou parado.

### Sua posição (só para produtos que você vende)

Quatro números lado a lado:

- **Seu preço** — o preço da sua oferta nessa ficha, lido do ML na última coleta.
- **Menor concorrente** — a oferta mais barata da ficha, sem contar você.
- **Sua posição** — quanto você está acima ou abaixo desse menor concorrente.
- **Referência do ML** — o preço de referência que o Mercado Livre calcula para o seu anúncio.
  Repetindo o aviso da seção 3: **não** é o menor preço da ficha, e pode ficar acima dele.

E abaixo, o simulador.

---

## 6. O simulador de margem

Digite um preço no campo e o Pulse calcula o que **sobra** para você naquele preço:

> Líquido **R$ 12,40** *(23,1%)*

A conta desconta, do preço digitado: a **comissão** e o **frete** informados pelo próprio Mercado
Livre para o seu anúncio, o **imposto** conforme a origem do produto (nacional ou importado) e o
**custo** do produto cadastrado no PubliAI.

### Quando aparece "Margem indisponível: falta ..."

O Pulse **nunca chuta** um número financeiro. Se faltar qualquer peça da conta, ele diz exatamente
qual e não mostra margem nenhuma. As três causas:

| Mensagem | O que fazer |
|---|---|
| falta **custo do produto** | Cadastre o custo das variações (menu Estoque → entrada de produto). Sem custo real não existe margem real. |
| falta **alíquota de imposto** | Confirme as alíquotas em **Configurações** (nacional 8% / importado 16%). Enquanto não estiverem confirmadas, o sistema se recusa a assumir um valor. |
| falta **referência de preço do Mercado Livre** | O ML ainda não devolveu comissão e frete para esse anúncio. Costuma resolver sozinho na coleta seguinte. |

Isso é proposital: um número de margem errado é pior do que nenhum número — leva a baixar preço
abaixo do custo achando que está no lucro.

---

## 7. Alertas

Quando algo muda no seu mercado, aparece um cartão no topo da tela do Pulse com os alertas não
lidos. Três tipos:

| Alerta | O que significa | O que costuma valer a pena fazer |
|---|---|---|
| **Menor preço de X caiu de R$ A para R$ B** | Alguém abaixou o preço e agora é a oferta mais barata da ficha | Abrir o simulador e ver se cobrir ainda te deixa com margem — muitas vezes não vale |
| **Novo concorrente em X a R$ B** | Um vendedor que não estava na ficha entrou | Olhar reputação e preço dele no detalhe; loja oficial entrando muda o jogo |
| **Um concorrente saiu de X** | Um vendedor sumiu da ficha (encerrou ou ficou sem estoque) | Se ele era o mais barato, muitas vezes dá para **subir** o preço |

Cada alerta tem até três botões:

- **Ver produto** — abre o detalhe daquela ficha.
- **Reprecificar** — só aparece em queda de preço, e só para produto que você vende.
- **✓** — marca como lido e some da lista.

**Onde mais os alertas aparecem:** no sino de notificações do topo, na categoria **Pulse (mercado)**.
Hoje só administradores ativos estão inscritos nessa categoria; para incluir alguém, é o mesmo lugar
onde se configuram as demais notificações do usuário.

> **Na primeira coleta de um produto, o Pulse não gera alerta nenhum.** Ele precisa de uma leitura
> anterior para saber o que mudou — senão o dia 1 viraria uma enxurrada de "novo concorrente" para
> gente que já estava lá o tempo todo.

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

**Todo dia (2 minutos).** Abrir o Pulse, ler o cartão de alertas, marcar como lido o que não exige
ação. Agir só no que muda decisão — normalmente queda de preço em produto onde você tem margem
folgada.

**Uma vez por semana (10 minutos).** Ordenar a lista pela coluna **Sua posição** (do mais caro para
o mais barato) e olhar o topo: são os anúncios onde você está mais acima do menor concorrente.
Abrir cada um, simular o preço e decidir. O selo **Acima de todos** na coluna Referência do ML
merece a mesma atenção — é o próprio ML dizendo que você está caro.

**Antes de entrar num produto novo.** Adicionar a ficha manualmente, esperar de 3 a 7 dias e olhar
"Menor preço por dia de coleta" e o número de ofertas. Mercado com muitos vendedores e preço caindo
todo dia é mercado de margem apertada — melhor descobrir isso antes de comprar estoque.

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
| Coluna Menor concorrente com `—` | Produto ainda não teve a primeira coleta | **Atualizar agora**, ou esperar o ciclo |
| Coluna **Seu preço** com `—` | Sua oferta não está entre as ativas da ficha | Passe o mouse: o motivo aparece. Pausado/sem estoque é normal; sem vínculo tem conserto |
| **Seu preço** diferente do que você lembra ter cadastrado | A coluna mostra o preço **vigente no ML**, não o cadastrado aqui | O ML é a fonte. Se estiver errado lá, ajuste pela Revisão |
| Referência do ML sempre `—` | Produto que você não vende (manual), ou anúncio muito novo | Normal em ficha manual: a referência é sobre o **seu** anúncio |
| Referência do ML diz **Sem vínculo de catálogo** | Seu anúncio não está atrelado a essa ficha (ficha divergente) | Resolva o vínculo pelo fluxo de catálogo — sem ele o ML não calcula referência |
| "Abaixo da referência" num produto onde você está mais caro que o menor rival | Não é contradição: são duas referências diferentes | Ver o aviso da seção 3 |
| "Margem indisponível" | Falta custo, alíquota confirmada ou a referência do ML | Ver a tabela da seção 6 |
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
