# Kit com variação — desenho

**Data:** 2026-11-06
**Status:** reescrito em 07/11 na opção B do Diego, com risco residual aceito; em revisão
**Referência de mercado:** `MLBU5154491250` (Kit 4 Blusas, categoria MLB3112)

Marcação: **[Diego]** decidido por ele. **[agente]** decisão do agente, sujeita a correção.
**[medir]** depende de teste antes de construir.

## Resultado do portão (07/11/2026)

**Reprovado.** `PUT /user-products/MLBU5717637056/stock/type/selling_address` com `x-version` correto
devolveu `400 "the site is blocked for modifications to the selling address"`, na conta DSA, em item
pausado. Nada foi gravado: versão 5 e saldo 5 antes e depois. Testes 1 a 3 não chegaram a rodar.

Pela documentação, a escrita em `selling_address` só existe na Argentina e no Chile. No Brasil, o
caminho com `x-version` é `seller_warehouse`, que exige conta multi-origem com tag
`warehouse_management`. Nenhuma das contas lidas tem essa tag. Em multi-origem, `available_quantity`
em `/items` deixa de valer, então o push atual do PubliAI quebraria na conta inteira.

Achado adicional: o estoque do
user product é compartilhado com a cópia de catálogo (dois itens no mesmo UP).

Kit Virtual foi descartado para roupa: a busca oficial de componentes devolveu `DISABLED_DOMAIN` em
todos os itens de roupa da Daludi Shop (regatas e jaquetas), junto com falta de estoque; itens de
outros domínios com estoque vieram `available`. Blusa não foi medida. `IS_NOT_ACTIVE_ERROR` mostra que
componente precisa estar ativo. Nenhum kit de teste foi criado.

**Decisão do Diego (07/11):** opção B, grade própria com página única e risco residual aceito.
Multi-origem fica fora, porque muda a conta inteira.

## Por que existe

Diego quer vender kits de cores diferentes do mesmo produto, como o anúncio de referência: uma
página no ML onde o comprador escolhe a combinação de cores e depois o tamanho. Tudo nasce da tela
Publicados, sem planilha, como o kit vinculado e o Kit Virtual.

Nenhum dos três sentidos de "kit" atuais cobre isso (ver ADR-0154):

| Termo | Limite |
|---|---|
| Kit | N unidades do mesmo produto num SKU |
| Kit vinculado (ADR-0151) | recusa base com várias cores (`base_multivariacao`); saldo vem de um SKU só |
| Kit Virtual (ADR-0154) | produtos distintos agrupados pelo ML, uma composição por anúncio |

Este é o quarto sentido: **kit com variação**.

## Objetivos

- Criar o kit em Publicados: escolher cores, peças por kit, quantidade por combinação e tamanho.
- Publicar uma página única no ML com seletor de combinação e tamanho.
- Nunca oferecer a mesma peça em dois anúncios ao mesmo tempo.
- Repor os kits sozinho, dentro de limites definidos pelo operador, com opção manual.
- Gerar a foto de cada combinação por IA nas empresas habilitadas, cobrando por imagem.

## Fora de escopo

- Kit com produtos de famílias diferentes.
- Kit com cor repetida, ex.: 2 pretas + 2 brancas **[agente]**.
- Sugestão automática de quais combinações vendem mais.
- Outros canais: só Mercado Livre.
- Produto no Full: bloqueado, porque o estoque lá é separado **[agente, recomendação do Codex]**.

## O que seria fracasso, mesmo funcionando

- Vender kit ou unitário sem a peça existir, fora do risco residual aceito.
- Publicar foto ou texto que o operador não viu.
- Foto gerada mostrar peça diferente da real e isso passar sem aprovação.
- Cobrar imagem de empresa sem o módulo ligado, ou gerar imagem sem registrar a cobrança.

## Fluxo do operador

### Criar

1. Publicados → **Criar kit** numa família com grade cor × tamanho.
2. Marca as cores e as peças por kit, de 2 a 6 **[Diego]**.
3. O sistema gera todas as combinações das cores marcadas **[Diego]**.
4. Digita quantos kits montar em cada combinação e tamanho **[Diego]**. As colunas são os tamanhos
   reais da base. Rascunho aprovado pelo Diego em 06/11.
5. Só vira anúncio o que tiver quantidade maior que 0 **[agente]**. Por isso não há teto de combinações.
6. Define o preço e, se quiser, liga **Vender só em kit** com a meta.
7. **Simulador** de lucro, margem, markup e impostos, atualizado ao mudar o preço **[Diego]**.
8. Prévia: título, descrição, foto por combinação, preço. Publica depois de conferir.

### Gerenciar

Botão **Gerenciar kit** na linha do kit em Publicados **[agente, aceito sem objeção]**:

- Mostra saldo por combinação e tamanho.
- **Montar mais:** só aumenta o saldo do anúncio existente, nunca cria anúncio novo **[Diego]**.
  Combinação ou tamanho nunca publicado vira item novo na mesma família, com foto própria.
- **Desmontar:** as peças voltam ao unitário **[Diego]**. Com reposição automática ligada, desmontar
  a desliga até o operador religar, com aviso na tela, para o sistema não remontar **[Diego]**.
  Com Vender só em kit ligado, as peças voltam como **guardadas, sem oferta**. A tela diz isso e
  pergunta se quer desligar a opção, o que reativa os individuais **[agente]**.
- Ligar e desligar Vender só em kit, a reposição automática e alterar a meta.

## Estoque

### Modelo: estoque separado [Diego]

A peça fica oferecida em um anúncio só. O kit tem **saldo próprio real**, diferente do kit vinculado,
que deriva o saldo da base. O ML não vende além do saldo de cada anúncio, então a separação evita a
venda duplicada **desde que nenhum push de saldo local restaure peça já vendida**. Por isso a proteção
depende da "Escrita de estoque com anúncio pausado"; sozinha, a separação não basta.

Isso substitui as regras anteriores de reserva de 1 unidade e saldo pelo mínimo das cores, que
foram descartadas.

Consequências:

- Venda de kit baixa só o saldo do SKU do kit.
- Cancelamento antes do despacho volta sozinho ao saldo do kit, que continua montado, pela regra
  atual do ADR-0121. Cancelamento pós-despacho e devolução não repõem sozinhos: seguem o aviso
  existente, e o operador confere as peças e ajusta **[agente]**.
- Base com Kit Virtual ou kit vinculado ativo não pode gerar kit com variação, porque aquelas peças
  têm outra oferta fora do controle da transferência **[agente]**.
- As travas do ADR-0151 D-9 (escrita bloqueada no SKU de kit) não podem alcançar este kit. O
  predicado `kit_multiplicador is not null` também aciona `resolverOrigemEstoque` e o saldo derivado.
  O kit com variação precisa de identificação própria, fora desse predicado.

### Montar e desmontar

São transferências de estoque entre SKUs, registradas no ledger com motivo próprio. As N cores
mexem juntas, numa transação: nunca baixa parcial.

**Quarentena obrigatória [Diego, opção B]:** peça nunca sai de anúncio ativo. Toda operação (montar,
desmontar, repor, cancelamento em kit, sair de Sobra) usa a **mesma sequência**, sobre origem e destino
juntos, descrita em "Escrita de estoque com anúncio pausado". Peça guardada já está pausada: pula a
pausa, mas não pula o resto.

Falha no meio deixa a peça sem oferta, nunca em dois lugares, e gera alerta. Peça em trânsito não some
do ledger.

### Reposição [Diego, opção B]

| Situação do produto | Como repõe o kit |
|---|---|
| **Vender só em kit** ligado | Automático até a meta, usando as peças guardadas |
| Individual ativo | Só **Montar mais**, manual, com quarentena. Telegram avisa quando uma combinação acaba |

Motivo: com individual ativo, repor sozinho exigiria pausar anúncio que vende a cada reposição. Por
isso não existe piso: a automação nunca tira peça de individual ativo.

**Meta:** quantos kits manter em cada combinação e tamanho publicado. Configurada por kit.

A reposição automática dispara após venda do kit, entrada, cancelamento e ajuste. Sem peça suficiente,
o kit vende até zerar, sai do ar e volta sozinho quando houver peça. Pode ser desligada, e o Telegram
passa a avisar quando uma combinação acabar.

Se várias combinações disputam peças, a distribuição é decisão do construtor, desde que seja
determinística e registrada.

**A tela de criar kit precisa explicar isso [Diego].** Vender só em kit, meta e reposição ficam
acompanhados de texto e exemplo na própria tela, para não confundir. Exemplo a exibir, usando os
valores digitados pelo operador (Preto + Branco M, meta 3):

| Situação | O que acontece |
|---|---|
| Vendeu 1 kit, saldo foi para 2, e há peças guardadas das duas cores | O sistema move 1 peça de cada cor para o kit. Esse kit sai do ar por alguns minutos durante a reposição |
| Acabou o Preto M guardado e sobrou Branco M | Não move; o kit vende até acabar, e o Branco M volta ao individual |
| Chegou mercadoria | O sistema repõe os kits até a meta |
| Kit zerou e falta peça | O kit sai do ar e volta sozinho quando entrar peça |

### Vender só em kit [Diego]

Opção em Criar kit e Gerenciar kit, para produto que só compensa vender em kit. Restrita a admin,
porque pausa anúncio (ADR-0060).

As peças ficam **guardadas** no estoque individual, sem oferta, e a reposição monta kits até a meta
conforme vendem. Não move tudo de uma vez: a mesma peça serve em várias combinações, e dividir antes
prenderia peça em combinação parada **[Diego]**.

Cada SKU individual usado no kit fica em um destes estados:

| Estado | Anúncio individual | Reposição do kit pode usar |
|---|---|---|
| **Normal** (opção desligada) | ativo | não; só Montar mais, com quarentena |
| **Guardado** | pausado pelo kit | sim |
| **Sobra** | reativado | não, até voltar a guardado |

Transições:

1. **Ligar a opção:** Normal → Guardado. Só os SKUs usados no kit. A pausa é confirmada no ML antes de
   a reposição usar as peças.
2. **Virar sobra:** Guardado → Sobra quando as peças do SKU não conseguem formar nenhuma combinação
   publicada, porque falta outra cor do mesmo tamanho. O sistema **reativa o individual e avisa no
   Telegram** **[Diego]**.
3. **Sair da sobra:** Sobra → Guardado quando entrar a peça que faltava. Ordem obrigatória: pausa o
   individual → confirma no ML → só então monta kit. A peça vendida nesse meio fica fora da conta,
   porque a montagem relê o saldo depois da pausa confirmada.
4. **Desligar a opção:** Guardado e Sobra → Normal. Reativa os individuais que a opção pausou.

**Entrada de estoque [Diego]:** toda entrada (nota, ajuste, cancelamento) consulta o estado do SKU
antes de agir:

- **Guardado:** o anúncio individual **não reativa**, e a reposição monta até a meta. Exceção nova à
  regra de reativação do ADR-0111. O bloqueio vale para qualquer caminho de reativação.
- **Sobra:** aplica a transição 3 se agora formar combinação; senão continua vendendo no individual.
- **Normal:** regra atual, sem reposição automática do kit.

Falha ao consultar o estado nunca reativa nem monta: fica como está e alerta.

Pausado não recebe venda nova, mas uma venda anterior à pausa pode ainda não ter chegado. O SKU
guardado também precisa da conferência de pedidos antes de ser usado (Contrato de segurança, item 2).

Promoções: conferir o que acontece com individual pausado que está em campanha **[medir]**.

## Invariantes de estoque

Valem para toda operação. Um furo em qualquer um reprova o desenho.

1. Cada peça está em um lugar só: individual, kit ou em trânsito.
2. O total é contado **em peças, por SKU individual**: individual + peças dentro de kits (saldo do kit
   × composição) + trânsito. Esse total só muda por venda, entrada, ajuste ou estorno, nunca por
   montar, desmontar ou repor. O kit nunca entra como 1 unidade na conta.
3. Nada aumenta oferta no ML antes de a redução correspondente estar confirmada.
4. Falha deixa a peça sem oferta, nunca em duas ofertas, e gera alerta.
5. Toda operação é idempotente e pode ser repetida sem mover peça duas vezes.
6. Automático nunca desfaz decisão do operador: pausa manual, modo manual e desmontar.

## Contrato de segurança

Regras exigidas pela revisão adversarial do Codex (rodada 1, veredito REVISAR). Os números seguem
os furos daquela revisão, e cada regra é obrigatória para o plano.

1. **Origem vendável [Diego, opção B]:** peça nunca sai de anúncio ativo. Toda transferência usa
   quarentena, e a automação só usa peça guardada.
2. **Compromissos antes de consumir:** depois da pausa confirmada, importar e baixar os pedidos
   anteriores à pausa, com referência idempotente. Com a conta incerta, bloquear montagem e qualquer
   push que aumente quantidade.
3. **Exclusão única por SKU:** escrita de quantidade, criação de oferta e mudança de identidade desses
   SKUs passam pela mesma exclusão, com versão validada logo antes da escrita. Snapshot anterior à
   transferência não publica. Vale para `publish-ml-*` e `estoque-*`.
4. **Confirmação durável:** registro por transferência e alvo, com quantidade e identidade lidas depois
   da escrita. HTTP 200 e job entregue não contam. Resultado ambíguo mantém o destino bloqueado e
   gera alerta durável.
5. **Reconciliação:** primeiro reconcilia pedidos, depois oferta. Aumentar quantidade no canal exige
   disponibilidade comprovada. Transferência pendente é reconciliada sem limite de 24 horas.
6. **Intenção do operador:** pausa manual, modo manual e desmontar ficam gravados com versão da
   política. Jobs antigos são invalidados. Movimento positivo sozinho não autoriza reativar.
7. **Todo caminho de reativação consulta a política:** individual, massa, UP, composição, convergência,
   retry e Reverter. Reativar Guardado à mão executa antes a transição segura.
8. **Saldo pertence ao SKU estável:** UPDATE, adicionar variação e planilha não substituem saldo nem
   política por snapshot. A troca de família canônica preserva tudo atomicamente.
9. **Cancelamento:** crédito automático só nos casos que o ADR-0121 permite, ou seja, cancelamento
   comprovadamente anterior ao despacho. Quando o crédito é devido, vale para o SKU e a composição
   vendidos, mesmo após retirada ou republicação, e o saldo segue visível e desmontável. Falha fica
   pendente com retry durável. Pós-despacho e devolução não creditam: seguem o aviso existente.
10. **Inventário:** montagem, trânsito e desmontagem preservam quantidade por componente, custo e nota
    de origem. O inventário fiscal reconhece essas transferências.
11. **Transferência é uma saga durável:** identidade única, composição congelada, etapas persistidas e
    movimentos protegidos por constraint. Resultado remoto incerto não compensa antes de resolver.
12. **Reserva numa transação:** todos os componentes e a capacidade até a meta, com locks em ordem
    estável. Insuficiência aborta tudo. Proibido aplicar parcialmente com `greatest(0, …)`.
13. **Guardado ↔ Sobra:** decide sobre fotografia consistente das combinações afetadas. Reserva os
    parceiros antes de voltar a Guardado. Decisão velha é rejeitada por versão. Não vira Sobra com
    transferência pendente. Cor em Sobra conta como disponível na avaliação conjunta.
14. **Política agregada por SKU:** cada kit registra sua reivindicação, e os bloqueios são separados por
    motivo: operador, kit, moderação, retirada. Desligar um kit remove só a dele. A automação só
    desfaz pausa que ela fez. Moderação nunca é desfeita.
15. **Composição durável:** exclusão física e limpeza ficam bloqueadas com kit, trânsito ou estorno
    pendente. Republicar preserva política e composição e invalida trabalhos antigos. Incompatibilidade
    com outros kits e Full vale nos dois sentidos, durante todo o ciclo. A pausa abrange anúncios
    relacionados de catálogo.

Tempo de quarentena e efeito das pausas no ranking do ML **[medir]**. Acontecem em Montar mais,
Desmontar, sair de Sobra, reposição automática do kit, cancelamento e entrada em peça usada em kit.

## Escrita de estoque com anúncio pausado

O Brasil não tem escrita condicional sem multi-origem, então a proteção é não escrever em anúncio que
possa vender.

**Regra:** nos user products participantes (SKUs de kit e individuais usados em kit), **todo `PUT`
absoluto de quantidade exige todos os itens do UP pausados e a conciliação abaixo**, inclusive a cópia de
catálogo, inclusive reduções e push fora de transferência. Uma redução calculada vira aumento se houver
venda entre a leitura e a escrita, então não há exceção para reduzir.

Na prática, venda não gera escrita: o ML já baixou. O que gera é entrada, ajuste e cancelamento. Só pausa
o UP que recebe a escrita: entrada em peça individual ativa pausa esse individual por T, em lote
**[agente]**; escrita no kit não pausa individual.

**Cada reposição automática tira do ar por T os itens do kit que recebem saldo**, porque item ativo não
recebe escrita. Reposição é agrupada em lotes, para isso acontecer poucas vezes **[agente]**.

Sequência única (origem e destino):

1. Lê a quantidade, pausa todos os itens do UP que receberá a escrita e confirma por leitura. A pausa
   só vale se `sub_status` for pausa do vendedor: `out_of_stock` religa sozinho quando o saldo sobe.
2. Espera o tempo de quarentena **T**.
3. Importa pedidos do item e reserva os **não pagos**, lidos em `GET /orders/search/pending`, filtrando
   pedido do item com pagamento `pending` (pedido abandonado fica `payment_required` para sempre, com
   pagamento `cancelled` ou `rejected`, e não reserva). Reserva também os
   **pagos sem baixa conciliada**. Pedido pago segue reservado até a **quantidade lida** cair em relação
   à leitura feita no passo 1. `last_updated` não solta reserva: não está medido que ele anda só quando
   a quantidade muda. Na dúvida sobre a conta, bloqueia transferência e aumento.
4. Lê a quantidade em `/user-products/{id}/stock`, que é a verdade da disponibilidade.
5. Calcula o valor final **uma única vez** e grava na saga, junto com o valor anterior.
6. Escreve, relê e confirma quantidade e status. **Resultado incerto nunca reenvia.** Só a recusa
   definitiva do ML (resposta 4xx recebida) permite repetir. Em timeout ou erro de rede, a leitura igual
   ao valor da saga conclui. Qualquer outro número, inclusive o valor anterior, trava a operação com
   alerta: gravar e vender a mesma quantidade devolve o saldo anterior, e isso não se distingue de
   "não gravou". A peça fica sem oferta até o operador resolver.
7. Reativa só o que a operação pausou.

**Medido em 07/11 (só leitura, DSA e Daludi, amostra pequena):** nas 9 amostras comparáveis, o estoque
mudou de 0 a 6 segundos depois do pagamento, não na criação do pedido. O pagamento mais lento levou
128 s. Os outros pedidos têm mudança posterior de estoque e não servem de amostra.

**Consequência:** pedido não pago não aparece no saldo, mas aparece em `/orders/search/pending`, então o
passo 3 enxerga o Pix de até 15 minutos sem depender de T. T cobre o intervalo até o pedido aparecer ali. Valor inicial de **T = 5 minutos**, configurável **[agente]**. T reduz o risco; não o
prova inexistente.

**Risco residual aceito pelo Diego:** pedido que paga depois de T e não apareceu no passo 3, ou baixa
que o ML atrasa além do que o passo 3 detecta. Nesse caso a peça pode estar comprometida duas vezes. O sistema detecta pela baixa, alerta no Telegram e o
operador resolve o pedido. Registrar toda ocorrência, para rever T com dado real.

**Alcance [Diego]:** quarentena, bloqueio de reativação e demais regras desta seção valem só para SKUs
participantes de kit com variação. Os demais produtos seguem o fluxo atual, incluindo a reativação por
reposição do ADR-0111. O comportamento do ML em si, de manter a pausa ao receber saldo, vale para todo
anúncio; isso é do ML, não muda nada no PubliAI.

**Kit ativo:** nenhuma escrita de quantidade com o item ativo. Cancelamento dentro do ADR-0121 credita o
saldo local do kit na hora e agenda a sequência acima, **mesmo com reposição automática desligada**.

**Pausa preservada:** a escrita precisa manter a pausa, inclusive ao passar por zero. Se reativar, a
operação fica proibida nessa configuração.

**Um local só:** só entra no kit SKU cujo `GET` mostra exclusivamente `selling_address`, revalidado em
toda operação. Outro local bloqueia com alerta.

**Estado Guardado não usa `status = pausado` no vínculo local [medir]:** `_shared/estoque/alvos.ts`
tira item pausado do push, e isso não pode esconder um SKU da reconciliação.

**Só user product:** base Legacy não gera kit, porque `/stock` devolve 404 em item sem
`user_product_id`.

**Divergência entre ledger e ML:** é classificada em compromisso remoto, efeito local pendente,
trânsito e diferença sem explicação. Efeito pendente identificado é aplicado uma única vez. Diferença
sem explicação bloqueia e tem procedimento de recuperação pelo operador. Nunca vira ajuste automático
por `ledger − ML`.

**Exceção:** o CREATE de item novo de kit envia saldo inicial no payload. Só vale se as reduções que
financiam esse saldo já estiverem confirmadas e com proteção contra criação duplicada.

**Caminhos de escrita que passam a consultar a regra (lista de aceitação):**

| Caminho | Arquivo |
|---|---|
| Push de estoque em item plano, incluindo UP | `_shared/canais/mercado-livre.ts` |
| UPDATE de item plano | `_shared/canais/mercado-livre.ts` |
| UPDATE e reposição de filhos UP | `_shared/user-products/atualizar-composicao.ts`, `atualizar-familia-up.ts` |
| Reconciliação diária | `reconciliar-estoque/index.ts` |
| Convergência UP | `reconciliar-convergencia-up/processar.ts` |
| Push e reativação por reposição | `sincronizar-estoque/processar.ts` |

SKU Guardado nunca recebe `reativar`.

**Testes antes de construir [medir], com o que mostrar ao Diego antes de cada escrita:**

1. **Passou em 07/11 (DSA, `MLB5471674559`).** `PUT /items` com `available_quantity` em 5 → 4 → 0 → 5
   manteve os dois itens do UP pausados. Em zero, `sub_status` ficou `out_of_stock` + `paused_by_seller`;
   ao subir, voltou a só `paused_by_seller`. Uma escrita no item atualiza o UP e a cópia de catálogo, e
   `x-version` subiu a cada escrita (5 → 8). A pausa vale enquanto `paused_by_seller` estiver presente.
2. **Passou em 07/11 (DSA, `MLB5001755829`, sem mexer em saldo).** Item só com `out_of_stock` aceitou
   `PUT status=paused` e ficou com `out_of_stock` + `paused_by_seller`. `PUT status=active` removeu a pausa
   do vendedor e devolveu só `out_of_stock`. Com o teste 1, isso mostra que item zerado pode ser protegido
   antes de receber saldo. Regra: guardar item exige `paused_by_seller` presente antes de qualquer escrita.
3. **Passou em 07/11 (compra real com Pix sem pagar, Daludi, pedido `2000019395998300`).** Pedido não pago
   **não** aparece em `/orders/search`, nem filtrando por `order.status`, mas aparece em
   `/orders/search/pending` como `payment_required` com pagamento `pending`, menos de 1 minuto depois de
   criado. O estoque seguiu em 6: o ML não reserva peça para pedido não pago. O código Pix vale 15 minutos.
4. Pagamento perto de T e baixa durante a escrita ou a retentativa: a conciliação do passo 3 segura.
5. Cancelamento de kit com reposição automática desligada credita e agenda.
6. COLOR combinada, agrupamento e seletor, conforme "Testes antes de construir". **Parcial em 07/11:** 37
   chamadas de `POST /items/validate` na Daludi, sem criar nada: `COLOR` em texto só com `value_name` passa
   sem `error` em Blusas, Jaquetas e Regatas, com ou sem `MAIN_COLOR`, até 255 caracteres. `SIZE` sem guia
   reprova (`2610`), e guia de outro vendedor também (`2617`), então a base precisa de guia própria. Falta
   a publicação real, que prova seletor e agrupamento.
   **Publicação real, 07/11, inconclusiva (Daludi, 4 itens):** o ML aceitou com 201 e deu o mesmo `family_id`
   aos 4, mas em minutos todos foram para `under_review` / `waiting_for_patch`, e a página `/up` não abriu.
   Seletor não foi visto. Causa não identificada: as fotos vieram de `MLB5265172927`, item `forbidden`, e o
   título tinha "Teste"; a cor combinada não pode ser descartada. Itens excluídos em seguida, sem venda.
   **Repetição, 07/11, passou (Daludi, 4 itens, família `Kit 3 Jaquetas Corta Vento Feminina`):** com fotos
   fora de itens moderados e título normal, os 4 ficaram ativos, sem revisão, enquanto estiveram no ar. A
   página `/up` mostrou as 2 combinações e M e G, com foto e rótulo próprios por combinação, tamanho separado
   e Guia de tamanhos. O seletor levou minutos para juntar os itens: primeiro 1 combinação, depois as
   demais marcadas como "Sem estoque" por um tempo, depois normais. Itens excluídos, sem venda.
   **Regra nova:** nunca usar foto de item moderado no kit. Isso entra na validação da criação.
7. **Imagem por IA, medido em 07/11 (3 gerações, Jaqueta Daludi, `gemini-2.5-flash-image`):** custo cerca de
   US$ 0,039 por imagem. Cor e fundo corretos, mas **modelagem não fiel**: gola alta e sem elástico na
   barra, com o original cropped e barra elástica. Saída de 832×1248, abaixo do ideal. Entrada era foto com
   modelo, o que pode piorar. O ML oferece "Gerar fotos com IA" e pede que o vendedor confira que o produto
   não foi alterado; não foi achada proibição, com leitura limitada por 403.
   **Comparação de modelos, mesmas fotos e mesmo pedido:** `gemini-nano-banana-2.1` (US$ 0,041 por imagem,
   896×1200) e `gemini-3-pro-image` (US$ 0,143, 848×1264) mantêm barra e punhos elásticos e gola, bem
   superiores ao `gemini-2.5-flash-image`. `gpt-5.4-image-2` falhou no provedor. Amostra de 1 por modelo.
   Modelo recomendado para seguir: `gemini-nano-banana-2.1`, a confirmar com Diego.

## Publicação no ML

- Uma família User Products. Cada combinação × tamanho é um item, igual às grades atuais.
- `COLOR` = texto da combinação, ex.: `Preto, Branco, Marrom e Azul Marinho`, sem `value_id` **[medir]**.
- MLB3112 não tem `SALE_FORMAT` nem `UNITS_PER_PACK`. Em categoria que tiver, preencher com a
  quantidade de peças (ADR-0071).
- Categoria e atributos vêm da base, sem IA **[agente]**.
- Custo e peso = soma das peças **[Diego aceitou]**. Dimensões seguem a regra do ADR-0151: altura × N,
  editável **[agente]**.
- GTIN: nenhum por padrão, como no ADR-0151 **[agente]**.
- Preço único para todas as combinações e tamanhos **[Diego]**. Sugestão inicial: soma dos preços
  unitários **[agente]**.
- A troca de tamanho pode levar a outra combinação quando faltar item: mesmo "pulo" que Diego aceitou
  em 20/09 para os unitários.

## Simulador antes de publicar [Diego]

O operador precisa saber se o kit dá lucro antes de confirmar. Mesma leitura do simulador de
Promoções: "Você recebe por venda", com comissão, imposto, lucro, margem e markup.

Reaproveitar `DetalheRecebe`, `calcularTarifaML` (edge `calcular-tarifa-ml`) e os resumos de lucro de
Promoções, sem criar outra fórmula **[agente]**.

- **Tarifa e frete:** cotação oficial com preço, categoria, dimensões e peso **do kit**, nunca da
  blusa unitária. Comissão e frete mudam por faixa de preço, então recotar ao mudar o preço.
- **Custo:** soma dos custos vigentes das peças de cada combinação e tamanho. Usar o custo mais
  recente, não o da família mais antiga (ADR-0185).
- **Imposto:** alíquota por origem (ADR-0055). Sem alíquota confirmada, o simulador avisa e não
  presume valor.
- **Preço único, custo variável:** peças de custos diferentes dão lucro diferente. Mostrar a pior
  combinação em destaque e o lucro de cada uma ao expandir **[agente]**.
- **Prejuízo:** resultado em vermelho e confirmação explícita para seguir. Não bloqueia **[agente]**.
- **Cotação indisponível:** dizer que não foi possível calcular, nunca mostrar lucro estimado como
  exato. Publicar exige confirmação explícita **[agente]**.
- A cobrança das imagens é custo único da criação e aparece à parte, fora do lucro por venda **[agente]**.

## Texto por IA [Diego]

Título e descrição precisam dizer que é kit, com a quantidade escolhida. É uma etapa própria, que
roda na criação e aparece na prévia editável. **Não** usar `process-familia`, que recusa kit e
reescreveria o texto como produto comum. Isso difere do ADR-0151 D-3 e o ADR novo registra.

Reprocessar não pode reescrever o kit: manter a trava de `reprocessar-familia` e `process-familia`.

## Foto [Diego]

Cada combinação publicada precisa de imagem própria, porque `COLOR` define a foto no ML.

- **Empresa com IA de imagem ligada:** o padrão é gerar a partir das fotos das cores escolhidas,
  com o modelo de Configurações (`ai_model_imagem`). O operador pode gerar outra ou enviar a dele.
- **Empresa sem IA de imagem:** envio obrigatório. Sem foto em toda combinação publicada, publicar
  fica bloqueado.
- Foto gerada só publica depois de aprovada na prévia.

A habilitação é um módulo novo por empresa, ligado em Daludi · Administração da plataforma
(`org-settings`, `modulos_habilitados`).

A tela de Configurações diz que o campo não é usado por nenhuma feature: atualizar o texto.

## Cobrança de imagem [Diego]

- Cobrar por imagem gerada na fatura, igual ao Sonar: preço por unidade na condição comercial de cada
  empresa, com evento medido e auditável.
- Conta toda imagem gerada com sucesso, inclusive a descartada. Falha de geração não cobra **[agente]**.
- Registrar também o custo real para a Daludi. `_shared/ai/tokens.ts` conta custo zero para modelo
  fora de `PRECOS`: incluir os modelos de imagem.
- A carteira e o demonstrativo mostram quantidade e valor.

## Testes antes de construir [medir]

1. `POST /items/validate` em MLB3112 com `COLOR` combinada, `MAIN_COLOR` e `SIZE`.
2. Publicar 2 combinações × 2 tamanhos e confirmar seletor, agrupamento e reativação. Cria anúncio
   real: exige autorização do Diego.
3. Política do ML sobre imagem gerada por IA.
4. Qualidade: 2 ou 3 imagens com fotos reais de um produto do Diego.
5. Custo real por imagem no OpenRouter.

Falha em 1 ou 2 reabre o desenho de publicação. Falha em 3 ou 4 reabre a foto: empresas passam a
enviar imagem.

## Deixado para o construtor

- Modelo de dados do kit, das combinações e da composição por SKU.
- Mecanismo de recuperação de transferência interrompida.
- Geração de código dos SKUs, usando `proximo_codigo_produto()`.
- Prompt de imagem e tratamento de fundo.
- Layout final, seguindo o padrão do sistema e `src/components/ui/select.tsx`.

## Documentos a escrever

ADR novo antes da implementação (`git fetch` antes de escolher o número), incluindo o quarto sentido
de "kit" no glossário. Emendas: ADR-0151 (IA no texto) e ADR-0074 (imagem deixa de ser dormente).
