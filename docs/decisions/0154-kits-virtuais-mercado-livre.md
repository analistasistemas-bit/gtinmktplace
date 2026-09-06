# ADR-0154: Kits Virtuais do Mercado Livre — anúncio de combinação fora do pipeline de produto

**Status:** Proposto
**Data:** 2026-09-06
**Decisores:** Diego
**Relacionado:** [Spike 036](../spikes/036-kits-virtuais-mercado-livre.md) (contrato de API verificado + medição de elegibilidade nas duas contas), [ADR-0151](0151-kit-vinculado-a-partir-de-produto-existente.md) (kit vinculado — precedente de admin-only, preview-como-revisão e guards de banco), [ADR-0088](0088-publicacao-user-products-multi-item.md) (user products / item plano), [ADR-0055](0055-imposto-por-origem-nacional-importado.md)/[ADR-0107](0107-origem-obrigatoria-na-planilha.md) (imposto por origem e trava LOUD), [ADR-0033](0033-retry-interno-foto-em-processamento.md) (propagação assíncrona de foto), [ADR-0060](0060-pausar-reativar-anuncio-ml.md) (ação de anúncio restrita a admin), [ADR-0024](0024-camada-de-abstracao-de-canais.md)/[ADR-0025](0025-modelo-de-dados-multicanal.md)/[ADR-0077](0077-registry-hibrido-menus-multicanal.md) (canais e UI multicanal), [ADR-0043](0043-fluxo-canonico-de-migrations.md) (migrations).

## Contexto

O Mercado Livre colocou em produção (out/2025) os **Kits Virtuais**: um anúncio novo que agrupa de
2 a 6 **produtos diferentes** já publicados pelo vendedor, referenciados por `user_product_id`. O
estoque é virtual — o ML calcula `min(estoque_componente / quantidade)` em tempo real e pausa o kit
quando chega a zero —, o preço pode acompanhar os componentes por desconto percentual, e uma venda
gera **uma order por componente**, ligadas por `pack_id`.

Isso é o terceiro sentido de "kit" no domínio, e os três não se misturam:

| Termo | O que é | Origem |
|---|---|---|
| **Kit** | N unidades do mesmo produto num SKU (`SALE_FORMAT=Kit`/`UNITS_PER_PACK=N`), detectado por regex | ADR-0063/0071/0073 |
| **Kit vinculado** | Família nova de N unidades do mesmo produto, estoque derivado da base por `floor(base/N)` | ADR-0151 |
| **Kit Virtual** | Produtos **distintos** agrupados pelo ML, estoque e pedidos calculados por ele | este ADR |

O contrato da API foi verificado contra a doc oficial em 2026-09-06 e a elegibilidade foi **medida
nas duas contas reais**, só com chamadas de leitura (§3 do spike 036):

- O que decide a elegibilidade é o item no ML ser **user product nativo — sem `variations[]`**. Não
  é o modelo do banco: `anuncios_externos.variacoes_externas` existir não diz nada.
- **Avil:** 147 anúncios publicados, 79 no modelo certo, 138 UPs elegíveis. Os 68 anúncios de fora
  derivam do multi-cor publicado por `variations[]`, recusados com `COMPONENT_NOT_MIGRATED_TO_UP`.
- **DSA:** 24 de 24 no modelo certo, 14 elegíveis — as 10 recusas são operacionais
  (`OUT_OF_STOCK_ERROR`, `IS_KIT_ARTISANAL`, `LOGISTIC_TYPE_MISMATCH`), não estruturais.
- Origem fiscal: a Avil publica 43 produtos nacionais e 99 importados, então **kit de origens
  misturadas é inevitável** lá; a DSA é 100% nacional.

A feature nasce, portanto, viável hoje e sem migração nenhuma de catálogo.

## Decisão

### 1. Objetivo: ticket médio, composição manual

O Kit Virtual existe para combinar produtos que **já vendem** e elevar o valor do pedido. A escolha
dos componentes é do operador. Sugestão automática por giro, por encalhe ou por leitura de
concorrência (Pulse/Sonar, ADR-0141) está **fora de escopo** — se entrar depois, entra como camada
de sugestão sobre este fluxo, não como redesenho dele.

### 2. Entidade própria, fora do pipeline de produto — por construção, não por filtro

O kit vive em duas tabelas novas, `kits_virtuais` e `kits_virtuais_componentes`. Ele **não** é uma
`familia` e **não** é um `anuncio_externo`.

Não é família porque família arrasta o pipeline inteiro — lote, contadores, Revisão,
`process-familia`, alvos de push, UPDATE — que é exatamente a lista que este ADR precisa evitar, e
porque não há produto, variação, custo próprio nem planilha por trás de um kit.

Não é `anuncios_externos` por um motivo mais duro: `codigo_pai` é `not null` e **todo leitor dessa
tabela** (`status-publicados`, `fetchPublicados`, `remover-publicado`, o fan-out de push de estoque)
trata a linha como partição de um produto. O kit entraria no push de estoque por acidente — e o ML
nem aceita `quantity` em kit.

O risco que decide: "fora de todo pipeline de escrita" só é garantia se **nenhuma query existente
puder alcançar o kit**. Tabela nova é invariante estrutural; filtro em tabela compartilhada é
disciplina, e disciplina falha na próxima query que alguém escrever.

O kit aparece na tela **Publicados** (badge próprio, status, preço, estoque calculado, link) e em
nenhum outro lugar do fluxo de escrita.

### 3. Preço sempre por desconto automático

O kit é publicado com `automatic_price` — um desconto percentual **idêntico em todos os
componentes**, conforme o ML exige — e o campo `price` é omitido. O app **nunca** reprecifica um
kit.

O motivo é que cada componente já é mantido com markup, imposto por origem e tarifa corretos
(ADR-0055); com desconto automático o kit herda essa margem de graça e o ML refaz o preço sozinho
quando um componente muda. Preço manual exigiria uma esteira de reprecificação nova e criaria a
classe de bug "kit vendendo a preço velho".

### 4. Título por template, descrição por IA

O **título** nasce de um template editável (`Kit N itens: A + B`), sem IA: o ML **expande o título
sozinho** com os dados dos componentes — confirmado na doc, onde `family_name` enviado como *"Kit
Aventura: 1 Motosserra + 1 Canivete"* volta como *"Kit Aventura: 1 Motosserra Elétrica 2200w 16 Pol
+ 1 Canivete Retrátil"*. Gastar token para ter o resultado sobrescrito não se paga, e a intenção
comercial ("Kit Verão") vem do operador.

A **descrição** é gerada por IA, reusando a esteira de copy do app, **uma vez** no preview — não a
cada ajuste de desconto. Descrição é texto longo e vendedor, onde o modelo agrega de verdade.

### 5. Foto própria do kit é obrigatória

O kit não publica sem uma imagem enviada pelo operador. Kit virtual nunca é montado fisicamente, e
usar a capa de um componente num anúncio de combinação induz o comprador a erro.

**A foto sobe para o ML no momento do upload no diálogo**, não no clique de publicar: a propagação
de foto no ML é assíncrona (ADR-0033) e leva minutos até o `picture_id` ser aceito num `POST`. Subir
no clique faria todo primeiro CREATE falhar.

**Correção 2026-09-06 (primeiro kit real publicado, `MLB5194780911`):** o payload de CREATE do
Spike 036 estava incompleto em dois pontos, só visíveis contra a API de produção:

- `thumbnail` precisa de `secure_url` além do `id` — buscado sempre via `GET /pictures/{id}`
  (`variations[0].secure_url`), nunca reaproveitado do retorno do upload, porque o caminho normal
  (foto sobe minutos antes, acima) não tem esse retorno disponível no momento do publish.
- `listing_type_id` não pode ser um valor fixo (o rascunho usava `gold_pro` cego): tem que vir do
  listing type real dos componentes (`GET /items?ids=...&attributes=id,listing_type_id`), e
  componentes com listing type divergente entre si são recusados **antes** de chamar o ML.

Ver `_shared/ml/kit-virtual.ts` e `_shared/ml/fotos.ts`; contrato atualizado no Spike 036.

### 6. Margem exibida, nunca bloqueante — e nunca um zero silencioso

O preview mostra preço do kit, rateio, custo, imposto, líquido e margem, e **não impede** publicar,
inclusive no vermelho: promoção agressiva deliberada é decisão comercial do operador.

A contrapartida é que o número precisa estar certo. O cálculo devolve uma união discriminada —
`{ok: true, …}` ou `{ok: false, faltando: [...]}` — e quando falta custo, alíquota confirmada da org
ou comissão, a tela diz **"margem indisponível: falta custo em X"** e libera o botão. O que este ADR
proíbe é o caminho do meio: exibir `0%` ou `—` como se fosse um resultado. É o mesmo princípio da
trava do ADR-0107 — um valor financeiro ausente nunca vira um valor plausível calado.

### 7. Imposto por componente, sobre o rateio

A alíquota de cada componente (8% nacional / 16% importado, ADR-0055) incide sobre a **parcela dele
no preço do kit**, não sobre o kit inteiro. Usar a origem do componente principal para tudo erraria
a margem em até 8 pontos do preço num kit misto — e, se o principal for o nacional, sempre para o
lado otimista.

O rateio é **proporcional linear**, confirmado nos números do exemplo oficial (preço 114 ÷ soma 250
= 0,456, aplicado a cada `component_price`). Isso permite prever o rateio no preview, antes de o kit
existir, e reconciliar depois com o `/sale_price` real.

### 8. Refazer = encerrar e recriar, num fluxo só

A composição é imutável no ML (`PUT` no nó `bundle` devolve 400). Trocar um componente é encerrar o
kit e criar outro, então o app oferece isso como **uma** ação: "Refazer kit" encerra no ML e reabre
o diálogo pré-preenchido com os componentes antigos.

Reusa a primitiva de status de item (`buscarItemML` + `atualizarStatusML`, no padrão GET-primeiro),
**não** a edge `remover-publicado` — aquela é inteiramente `familias`-shaped (lote, storage, guard de
kit vinculado, saga de user products) e não se aplica a um kit.

### 9. Kit vinculado pode ser componente, com aviso

Um kit vinculado (ADR-0151) é elegível como componente — confirmado na medição. A baixa de estoque
funciona: a venda gera a order do kit vinculado, e `resolverOrigemEstoque` debita a base.

O preview avisa que existe uma cadeia de três níveis (base → kit vinculado → kit virtual) e que o
estoque do topo depende do último push. Bloquear seria inventar uma restrição que o ML não impõe; o
oversell intra-canal já é risco aceito na Decisão 6 do ADR-0151.

### 10. Vendas: badge por linha, faturamento intocado

`ml_vendas` ganha `kit_item_id`, preenchido a partir de `bundle.parent_item` do pedido. A tela mostra
um badge "Kit" na linha, e **as orders não são agrupadas**.

A contabilidade já fecha sozinha — os preços rateados dos componentes somam o preço do kit — e
código de faturamento é onde o projeto proíbe mudança barata. A leitura humana é o único problema, e
um badge resolve.

**A baixa de estoque não precisa de código novo:** `mapearPedidoParaVenda` casa a venda por
`order_items[].item.id` contra os itens da org, e o ML emite uma order por componente com o item_id
do componente. O id do kit nunca aparece em `order_items` — só em `bundle.parent_item` — então o kit
não precisa ser conhecido pelo resolvedor de SKU.

### 11. Entrega única

Criar, publicar, ver em Publicados, margem, refazer e badge saem na mesma branch. Sem "Refazer", um
kit errado fica preso no ar; sem badge, não há como medir se kit vende — que é a hipótese comercial
inteira.

### 12. Componentes vêm do buscador do ML, enriquecidos pelo banco

A lista de candidatos vem de `POST /users/$SELLER_ID/kits/components/search`, não de uma query
local. Só o ML sabe dizer `COMPONENT_NOT_MIGRATED_TO_UP`, `OUT_OF_STOCK_ERROR` ou
`LOGISTIC_TYPE_MISMATCH`, e o banco sequer guarda `user_product_id` de família legada. Cada
resultado é então cruzado com o catálogo local para anexar `codigo`, `custo` e `origem`.

Os inelegíveis **aparecem na tela com o motivo**. Na Avil isso significa mostrar os 68 anúncios
multi-cor recusados — esconder produziria a pergunta "cadê meu produto?" sem resposta.

### 13. Componente de kit publicado não pode ser removido nem republicado

Guard em duas camadas, espelhando a Decisão 14 do ADR-0151: trigger `before delete` em `familias` e
guard de app em `remover-publicado`, nos **dois** ramos (remover e preservar família).

O motivo é específico: republicar um componente cria um `user_product_id` novo, e o kit fica preso
ao UP morto — o resultado é um kit em `out_of_stock` permanente sem nenhuma mensagem de erro.

### 14. Status do kit em Publicados vem de três chamadas; Pausar/Reativar ficam fora da v1

Status e sub_status vêm do `GET /items` que a tela já faz, mas **preço e estoque de kit não vêm
dali**: preço só pelo `/sale_price` e estoque pelo `/user-products/{id}/stock`. São duas chamadas
extras por kit, aceitáveis porque kits são poucos (dezenas por org, não milhares).

Pausar e Reativar não são oferecidos na v1: a doc não lista `status` entre os campos editáveis de um
kit, e o comportamento não foi testado.

### 15. A tarifa do kit é estimativa até a primeira venda real

Três incógnitas não se resolvem sem um pedido de verdade: se a parcela **fixa** da comissão é
cobrada por order (o ML emite uma por componente) ou por kit; se cada order é tarifada pela
categoria do próprio componente ou pela do kit; e como o frete grátis é avaliado. A v1 exibe a
margem rotulada como **estimativa**, e a fórmula é reconciliada contra o `sale_fee` real da primeira
venda.

### Herdadas por precedente, não rediscutidas

- **Admin-only** (ADR-0151, ADR-0060): criar, refazer e encerrar kit são ações de administrador.
- **A revisão humana é o preview do próprio diálogo** (ADR-0151, Decisão 4): não existe card na tela
  Revisão para kit. Marcar componentes, conferir margem, título, descrição e foto, e confirmar **é**
  a revisão exigida pela regra inegociável do projeto.

## Consequências

**A favor:**

- Acoplamento zero com estoque, UPDATE e `process-familia` — garantido por estrutura, não por
  filtro.
- Baixa de estoque e apuração financeira funcionam sem código novo, por causa do formato de order do
  próprio ML.
- Preço do kit se mantém correto sozinho enquanto os componentes forem mantidos corretos.

**Contra, e aceito:**

- Duas chamadas extras ao ML por kit em `status-publicados`.
- A margem do preview é a do dia da criação; o preço do kit deriva junto com os componentes (uma
  reprecificação move o kit). Em Publicados vale a do `/sale_price` ao vivo.
- A Avil só enxerga 79 dos 147 anúncios como componente até o bloco multi-cor migrar para User
  Products.
- Foto obrigatória (Decisão 5) põe um trabalho de produção de imagem em cada kit — decisão
  consciente do operador, em troca de anúncio honesto.
- Margem não bloqueante (Decisão 6) permite publicar no prejuízo por engano de digitação. Mitigado
  só pela exibição correta e pelo rótulo de estimativa.

## Risco aberto que precede a implementação

A doc do ML diz que **parceiro não certificado precisa cadastrar o usuário num formulário** antes de
conseguir criar kits. A busca de componentes responde `200` nas duas contas, mas isso não prova que
o `POST /items/kits` esteja liberado. **Se o CREATE devolver 403 de certificação, a feature para até
o cadastro ser aprovado** — nenhuma linha de UI deve ser escrita antes dessa resposta.

Outras incógnitas a fechar no mesmo teste: se um kit `closed` ainda conta para a regra de "kit
duplicado" (se contar, Refazer precisa pausar e reabrir, não encerrar e recriar); se `quantity` na
order do componente é em unidades ou em kits; e se o título expandido pelo ML pode estourar 60
caracteres.

## Como reverter

Reverter a migration (duas tabelas, a coluna `ml_vendas.kit_item_id`, o trigger) e remover as Edge
Functions novas. Nenhuma família, anúncio ou venda existente é alterada por esta feature — o kit
vive em estrutura própria e os componentes são lidos, nunca escritos.
