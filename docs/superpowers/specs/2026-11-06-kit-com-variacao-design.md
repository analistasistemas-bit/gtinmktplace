# Kit com variação — desenho

**Data:** 2026-11-06
**Status:** aguardando aprovação do Diego
**Referência de mercado:** `MLBU5154491250` (Kit 4 Blusas, categoria MLB3112)

Marcação: **[Diego]** decidido por ele. **[agente]** decisão do agente, sujeita a correção.
**[medir]** depende de teste antes de construir.

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

- Vender kit ou unitário sem a peça existir.
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
venda duplicada **desde que nenhum push de saldo local restaure peça já vendida**. Por isso a garantia
depende da "Escrita de estoque por versão"; sozinha, a separação não basta.

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

**Quarentena obrigatória [Diego, opção B]:** peça nunca sai de anúncio ativo. Isso vale nos dois
sentidos, porque o kit também é anúncio que vende:

- **Montar:** pausa os individuais de origem que estiverem ativos → confirma no ML → confere pedidos
  → move as peças → aumenta o kit → reativa os individuais que a operação pausou.
- **Desmontar:** pausa os itens do kit → confirma no ML → confere pedidos → move as peças → volta os
  itens do kit que ainda têm saldo.

Peça guardada já está pausada: pula a pausa, mas não pula a conferência de pedidos.

"Confirma" segue o Contrato de segurança, item 4. Falha no meio deixa a peça sem oferta, nunca em dois
lugares, e gera alerta. Peça em trânsito não some do ledger.

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
| Vendeu 1 kit, saldo foi para 2, e há peças guardadas das duas cores | O sistema move 1 peça de cada cor para o kit |
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
9. **Cancelamento:** credita o SKU e a composição vendidos, mesmo após retirada ou republicação. O
   saldo segue visível e desmontável. Falha fica pendente com retry durável.
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

Tempo de quarentena e efeito das pausas no ranking do ML **[medir]**. Acontecem só em Montar mais,
Desmontar e ao sair de Sobra.

## Escrita de estoque por versão

Revisão 2 do Codex: pausar não basta. (a) Nenhuma espera prova que todo pedido anterior à pausa
apareceu. (b) Escrever quantidade absoluta em destino ativo pode devolver uma peça vendida no instante
da escrita. Regra que fecha os dois:

**Nos SKUs de kit e nos individuais usados em kit, toda mudança de quantidade no ML usa a API de
estoque de user product com versão, nunca `available_quantity` absoluto.**

1. `GET /user-products/{id}/stock` devolve quantidade e `x-version`.
2. Novo valor = **quantidade lida no ML** + delta da operação. Nunca o saldo local.
3. `PUT /user-products/{id}/stock/type/selling_address` com `x-version`.
4. 409 significa que houve mudança no meio: nada foi escrito. Relê, reavalia a operação e, se a peça
   não estiver mais lá, aborta.

O saldo do ML é a verdade da disponibilidade nessas operações: a origem só cede o que o ML ainda
mostra. O ledger local nunca aumenta oferta sozinho.

**Exceção:** o CREATE de um item novo de kit envia saldo inicial no payload, porque ainda não existe
versão. Só vale se as reduções que financiam esse saldo já estiverem confirmadas e com proteção
contra criação duplicada.

**Delta com identidade (revisão 3):** todo delta tem identidade durável por movimento, UP e local,
incluindo entrada, ajuste, estorno e reconciliação. Reentrega não cria outro efeito. Resultado remoto
incerto nunca autoriza reler e reaplicar com versão nova: exige identificar o efeito anterior, senão
fica bloqueado com alerta. O job atual de estoque não carrega identidade de movimento e confia no
push absoluto idempotente (`_shared/estoque/baixa.ts`), então precisa de contrato novo nesses SKUs.

**Divergência entre ledger e ML (revisão 3):** é classificada em compromisso remoto, efeito local
pendente, trânsito e diferença sem explicação. Efeito pendente identificado é aplicado uma única vez.
Diferença sem explicação bloqueia e tem procedimento de recuperação pelo operador. Nunca vira delta
calculado por `ledger − ML`.

**Pausa preservada (revisão 3):** a escrita funciona mantendo a pausa exigida pela política, inclusive
ao passar por saldo zero. Se a escrita exigir ativar ou causar reativação, a operação é proibida
nessa configuração. Pausar depois não fecha a janela.

Isso vale também para push de entrada e reconciliação nesses SKUs.

**Caminhos de escrita absoluta a migrar (lista de aceitação):**

| Caminho | Arquivo |
|---|---|
| Push de estoque em item plano, incluindo UP | `_shared/canais/mercado-livre.ts` |
| UPDATE de item plano | `_shared/canais/mercado-livre.ts` |
| UPDATE e reposição de filhos UP | `_shared/user-products/atualizar-composicao.ts`, `atualizar-familia-up.ts` |
| Reconciliação diária | `reconciliar-estoque/index.ts` |
| Convergência UP | `reconciliar-convergencia-up/processar.ts` |

Trocar só o conector de push deixaria o UPDATE de composição fora da garantia. Sem fallback para
`/items` nesses SKUs.

**Um local só:** o `PUT` em `selling_address` altera um balde, e outro local com quantidade continua
vendendo. Só entra no kit SKU cujo `GET` mostra exclusivamente `selling_address`. Isso é revalidado
em toda operação, e outro local bloqueia com alerta. "Sem Full" não garante isso sozinho.

**Estado Guardado não usa `status = pausado` no vínculo local [medir]:** `_shared/estoque/alvos.ts`
tira item pausado do push, e isso não pode esconder um SKU da reconciliação.

**Só user product:** a API não existe para item Legacy (medido: `/stock` devolve 404 em item sem
`user_product_id`). Base Legacy não pode gerar kit com variação.

**Medido em 06/11, só leitura:** em 4 das 5 contas conectadas, um user product devolveu `x-version` e
um único local `selling_address`. O item da 5ª não é user product.

**Portão: nada é construído sem provar [medir]:**

Escrita, em anúncio indicado pelo Diego e sem Full:

1. `PUT` com versão atual grava, e a versão sobe.
2. `PUT` com versão velha devolve 409 e não grava.
3. Dois `PUT` concorrentes com a mesma versão: só um vence.
4. O endpoint é aceito em conta de um local só, inclusive no primeiro kit criado. A doc restringe
   `selling_address` por site e logística e lista o erro "seller with a single warehouse cannot update
   selling address stock".

Pausa:

5. Redução e aumento em item com pausa do vendedor, passando por zero, mantêm a pausa.
6. Reposição em item `out_of_stock`: o ML religa sozinho quando a quantidade sobe (ADR-0111). **Reprova
   se qualquer item que a política quer pausado ficar `active`.** Pausa do vendedor com saldo zero
   também é medida. Vale para todos os itens relacionados.

Compra, a mais importante. Exige compra real controlada, com autorização do Diego:

7. Compra **entre o GET e o PUT**: o `PUT` com a versão anterior é recusado.
8. Pagamento pendente: ler `locations[].quantity` de `/user-products/{id}/stock`, **o mesmo campo que o
   `PUT` usa**, nunca `available_quantity`. Ler com o pagamento pendente e de novo depois da aprovação.
   O campo precisa excluir a peça comprometida nas duas leituras, e a venda precisa mudar `x-version`.
9. Depois de uma redução, a oferta não vende além do novo saldo em nenhum item relacionado. A doc
   descreve propagação assíncrona para condições de venda do UP.

Timestamp é evidência auxiliar, não prova.

Falha:

10. Resposta perdida depois de aplicar, com venda intercalada e reentrega: exatamente um acréscimo, ou
    bloqueado sem reaplicar.
11. Entrada ainda não enviada, pedido pendente e transferência parcial convergem sem sobrescrever o
    saldo do ML.

**Regra de aprovação:** o saldo versionado precisa excluir todo compromisso que ainda possa consumir
estoque, e compra e `PUT` condicional precisam disputar atomicamente a mesma disponibilidade. Se 1 a 9
falharem, o desenho volta para revisão, porque não há prova contra venda concorrente.

Se o portão passar, a quarentena pode deixar de ser necessária. Isso exige nova decisão do Diego e não
muda a opção B sozinho.

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
