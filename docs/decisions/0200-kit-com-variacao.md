# ADR-0200 — Kit com variação: página única, estoque separado e escrita só com anúncio pausado

- **Status:** aceito, em implementação
- **Data:** 2026-11-07
- **Decisores:** Diego
- **Refina:** ADR-0151 (kit vinculado), ADR-0154 (Kit Virtual), ADR-0111 (reativação por reposição), ADR-0074 (modelo de IA por organização)
- **Spec:** `docs/superpowers/specs/2026-11-06-kit-com-variacao-design.md`
- **Plano:** `docs/superpowers/plans/2026-11-07-kit-com-variacao.md`

## Contexto

Diego quer vender kits de cores diferentes do mesmo produto: uma página no Mercado Livre em que o comprador escolhe
a combinação de cores e depois o tamanho. O kit nasce na tela Publicados, sem planilha.

### O quarto sentido de "kit"

| Termo | Limite |
|---|---|
| Kit | N unidades do mesmo produto num SKU |
| Kit vinculado (ADR-0151) | recusa base com várias cores (`base_multivariacao`); saldo derivado de um SKU só |
| Kit Virtual (ADR-0154) | produtos distintos agrupados pelo ML, uma composição por anúncio |
| **Kit com variação** (este ADR) | cores combinadas × tamanho numa família User Products, saldo próprio por combinação e tamanho |

Nenhum dos três primeiros cobre o caso. O kit com variação é o quarto sentido e não reaproveita o predicado
`kit_multiplicador`, que aciona `resolverOrigemEstoque` e o saldo derivado: precisa de identificação própria.

### Portão reprovado em 07/11

`PUT /user-products/{id}/stock/type/selling_address` com `x-version` correto devolveu
`400 "the site is blocked for modifications to the selling address"`, na conta DSA, em item pausado. Nada foi gravado
(versão e saldo iguais antes e depois). Pela documentação, essa escrita só existe na Argentina e no Chile. No Brasil
o caminho com `x-version` é `seller_warehouse`, que exige conta multi-origem com a tag `warehouse_management`; nenhuma
conta lida tem a tag. Em multi-origem, `available_quantity` em `/items` deixa de valer e o push atual quebraria na
conta inteira. O estoque do user product também é compartilhado com a cópia de catálogo (dois itens no mesmo UP).

## Decisão

Opção B do Diego (07/11): grade própria com página única e risco residual aceito.

1. **Estoque separado.** A peça fica oferecida em um anúncio só. O kit tem saldo próprio real. Venda de kit baixa só o
   SKU do kit. Montar e desmontar são transferências entre SKUs, no ledger, com todas as cores numa transação: nunca
   baixa parcial. Total em peças por SKU individual (individual + saldo do kit × composição + trânsito) só muda por
   venda, entrada, ajuste ou estorno.
2. **Escrita só com anúncio pausado.** Nos SKUs participantes (de kit e individuais usados em kit), todo `PUT`
   absoluto de quantidade exige todos os itens do UP pausados (inclusive a cópia de catálogo) e a conciliação
   abaixo, inclusive reduções. A pausa só vale com `paused_by_seller` em `sub_status`: `out_of_stock` religa sozinho
   quando o saldo sobe.
3. **Sequência única** para montar, desmontar, repor, cancelamento em kit e sair de Sobra, sobre origem e destino:
   ler e pausar e confirmar; esperar a quarentena T; importar pedidos e reservar os não pagos
   (`GET /orders/search/pending`, pagamento `pending`) e os pagos sem baixa conciliada; ler `/stock`; calcular o valor
   final uma única vez e gravar na saga; escrever, reler e confirmar; reativar só o que a operação pausou.
   T inicial de 5 minutos, configurável.
4. **Quarentena obrigatória.** Peça nunca sai de anúncio ativo; a automação só usa peça guardada.
5. **Reserva por `/orders/search/pending`.** Pedido não pago não aparece em `/orders/search` nem no saldo. Pedido pago
   segue reservado até a quantidade lida cair em relação à leitura do passo 1; `last_updated` não solta reserva.
   Na dúvida, bloqueia transferência e aumento.
6. **Resultado incerto nunca reenvia.** Só a recusa definitiva do ML (4xx recebido) permite repetir. Em timeout ou
   erro de rede, leitura igual ao valor gravado na saga conclui; qualquer outro número, inclusive o anterior, trava a
   operação com alerta. A transferência é uma saga durável, idempotente, com intenção gravada antes do `PUT`.
7. **Vender só em kit** (restrito a admin, ADR-0060). Cada SKU individual usado fica em `normal`, `guardado` ou
   `sobra`. Guardado fica pausado e a reposição monta kits até a meta conforme vendem; Sobra reativa o individual e
   avisa no Telegram quando uma cor não forma combinação. Com individual ativo, só Montar mais manual: não existe
   piso, a automação nunca tira peça de individual ativo.
8. **Foto por módulo `imagem_ia`**, com `ai_model_imagem`. Modelo padrão `google/gemini-nano-banana-2.1`. Empresa sem
   o módulo envia a foto; sem foto em toda combinação publicada, publicar fica bloqueado. Foto gerada só publica
   depois de aprovada. Nunca usar foto de item moderado.
9. **Cobrança por imagem** gerada com sucesso (inclusive a descartada; falha não cobra), igual ao Sonar: preço por
   unidade na condição comercial da empresa, evento medido e custo real registrado. Modelos de imagem entram em
   `PRECOS` (`_shared/ai/tokens.ts`).
10. **Simulador** antes de publicar, com as mesmas peças do simulador de Promoções (`DetalheRecebe`,
    `calcularTarifaML`), tarifa e frete do kit e não da peça, pior combinação em destaque. Sem alíquota confirmada
    (ADR-0055) ou sem cotação, avisa e não presume número.
11. **Texto por IA em etapa própria** (`gerar-texto-kit`): título e descrição dizem que é kit e quantas peças. Não usa
    `process-familia`. Reprocessar não pode reescrever o kit.
12. **Escopo:** só user product, só `selling_address`, sem Full, sem Kit Virtual ou kit vinculado na base, peças por
    kit de 2 a 6, cores distintas. Tudo atrás do módulo `kit_variacao`: organização sem o módulo não muda de
    comportamento.

## Alternativas descartadas

- **Escrita condicional por `x-version` em `selling_address`:** reprovada em 07/11, `400` de site bloqueado no Brasil
  (ver Contexto).
- **Multi-origem (`seller_warehouse`):** exige a tag `warehouse_management`, ausente nas contas lidas, e quebra o push
  de `available_quantity` na conta inteira.
- **Kit Virtual para roupa:** a busca oficial de componentes devolveu `DISABLED_DOMAIN` em todos os itens de roupa da
  Daludi Shop (regatas e jaquetas), além de falta de estoque; itens de outros domínios com estoque vieram
  `available`. Blusa não foi medida. Componente também precisa estar ativo (`IS_NOT_ACTIVE_ERROR`).
- **Reserva de 1 unidade e saldo pelo mínimo das cores:** substituídas pelo estoque separado.
- **Reposição automática com individual ativo:** exigiria pausar a cada reposição um anúncio que vende.

## Risco residual aceito pelo Diego

Pedido que paga depois de T e não apareceu na conciliação (passo 5), ou baixa que o ML atrasa além do que a
conciliação detecta. A peça pode ficar comprometida duas vezes. O sistema detecta pela baixa, alerta no Telegram e o
operador resolve o pedido. Toda ocorrência é registrada para rever T com dado real. T reduz o risco; não o prova
inexistente.

## Resultados medidos em 07/11

- `PUT /items` com `available_quantity` 5 → 4 → 0 → 5 manteve os dois itens do UP pausados (DSA). Em zero,
  `sub_status` ficou `out_of_stock` + `paused_by_seller`; ao subir, voltou a só `paused_by_seller`. Uma escrita no item
  atualiza o UP e a cópia de catálogo.
- Item só com `out_of_stock` aceitou `PUT status=paused`; `status=active` removeu a pausa do vendedor. Guardar item
  exige `paused_by_seller` presente antes de qualquer escrita.
- Compra real com Pix sem pagar (Daludi): pedido não pago ausente de `/orders/search`, presente em
  `/orders/search/pending` como `payment_required` com pagamento `pending`, em menos de 1 minuto. O estoque não mudou
  (o ML não reserva peça para pedido não pago). O código Pix vale 15 minutos.
- Nas 9 amostras comparáveis (DSA e Daludi, só leitura), o estoque mudou de 0 a 6 s depois do pagamento, não na
  criação do pedido; o pagamento mais lento levou 128 s.
- `POST /items/validate` (37 chamadas, Daludi, nada criado): `COLOR` em texto só com `value_name` passa em Blusas,
  Jaquetas e Regatas, com ou sem `MAIN_COLOR`, até 255 caracteres. `SIZE` sem guia reprova (`2610`) e guia de outro
  vendedor também (`2617`): a base precisa de guia própria.
- Publicação real, 4 itens, Daludi: a primeira tentativa foi para `under_review` / `waiting_for_patch` (fotos de item
  `forbidden`, título com "Teste"; inconclusiva). A repetição, com fotos fora de itens moderados e título normal,
  ficou ativa, e a página `/up` mostrou as 2 combinações e os tamanhos, com foto e rótulo próprios, tamanho separado e
  Guia de tamanhos. O seletor levou minutos para juntar os itens. Itens excluídos, sem venda. Daí a regra de nunca
  usar foto de item moderado.
- Imagem por IA (Jaqueta Daludi): `gemini-2.5-flash-image`, cerca de US$ 0,039 por imagem, cor e fundo corretos mas
  modelagem não fiel. `gemini-nano-banana-2.1` (US$ 0,041, 896×1200) e `gemini-3-pro-image` (US$ 0,143, 848×1264)
  mantiveram barra, punhos e gola; `gpt-5.4-image-2` falhou no provedor. Amostra de 1 por modelo. O ML oferece
  "Gerar fotos com IA" e pede que o vendedor confira que o produto não foi alterado; não foi achada proibição, com
  leitura limitada por 403.

## Consequências

- Cancelamento antes do despacho volta ao saldo do kit pela regra do ADR-0121; pós-despacho e devolução seguem o
  aviso existente.
- Cada reposição automática tira do ar, por T, os itens do kit que recebem saldo; a reposição é agrupada em lotes.
- SKU Guardado não reativa por entrada de estoque (emenda ao ADR-0111) e o estado não usa `status = pausado` no
  vínculo local, para não sair da reconciliação.
- Texto por IA no kit difere da Decisão 3 do ADR-0151 (emenda).
- A imagem deixa de ser dormente no ADR-0074 quando a Fase 4 for entregue (emenda).
- Ainda a medir: tempo de quarentena e efeito das pausas no ranking do ML; individual pausado em campanha de
  promoção.

## Emenda 2026-11-08 — Encerrar kit

**Contexto.** "Desmontar" devolve as peças e deixa os itens do kit pausados com 0; não havia como fechar o kit de vez,
e a lixeira é bloqueada de propósito para kit com variação (Task 7). Caso real: Zaven, kit 00000223 (SKU 00000224,
MLB7959912198), desmontado em 08/11. "Encerrar kit" fecha os itens do kit no ML (`status=closed`, irreversível), tira o
kit de Publicados e devolve as peças da base ao estado Normal, sem apagar variação, composição, ledger nem histórico.

**Decisão.**

1. **Ação no Gerenciar kit**, só admin (ADR-0060) e módulo `kit_variacao` ligado, com confirmação explícita "Encerra
   os anúncios do kit no Mercado Livre. Não dá para desfazer." Habilitada só com saldo 0 em todos os SKUs do kit e
   nenhuma transferência do kit aberta (ativa ou travada). Com saldo, a tela diz "Desmonte antes" e oferece desmontar
   tudo (o Desmontar de sempre, com todo o saldo).
2. **RPC `kit_variacao_encerrar(p_org, p_kit, p_versao)`**, uma transação, com a ordem de locks org (`for share`, módulo
   revalidado: contrato de `set_modulos_org_seguro`), kit (`for update`, CAS de `versao`), exclusões de todos os SKUs
   do kit e só então o saldo (a republicação pega exclusão e depois variação; a ordem inversa fecharia um ciclo);
   recusa `saldo` (variação canônica de cada SKU do kit lida `for share`, desempate `criado_em desc, id desc`), `transferencia_aberta` (do kit, ou que
   liste um SKU do kit) e `up_ocupado` (exclusão de outro dono). Repetição com o kit já `encerrando` devolve a
   transferência existente; já `encerrado`, ok sem efeito. Grava `status='encerrando'`, `reposicao_auto=false` e
   `versao+1` (invalida jobs e telas antigas) e cria a transferência `encerrar` por `kit_criar_transferencia`, sem
   redefini-la: alvos calculados no SQL a partir de `anuncios_externos_itens` (um por SKU do kit com
   `user_product_id`: item + cópia de catálogo), nunca vindos da edge. SKU do kit sem UP fica fora dos alvos, mas a
   exclusão dele é adquirida com o mesmo dono na mesma transação. Kit sem nenhum alvo (nada chegou ao ML) encerra ali
   mesmo, na mesma transação (passo 4), depois de adquirir a exclusão de todos os SKUs com um dono só da transação
   (publicação em curso recusa com `up_ocupado`) e soltá-la no fim. Kit `publicado` sem nenhum vínculo recusa
   (`sem_vinculo`): o vínculo sumiu (republicação) e os itens antigos não seriam fechados.
3. **Worker.** `kit-transferencia` despacha `tipo='encerrar'` para um módulo próprio (`_shared/kit-variacao/encerrar.ts`)
   antes do pipeline de quantidade, com o mesmo claim por `execucao_token` e as mesmas RPCs validadas por token,
   prazo e exclusão. Cada invocação, para cada alvo ainda não confirmado: grava o início da obrigação
   (`intencao_escrita_em`, uma vez, ANTES de qualquer leitura: leitura que falha sempre também conta o prazo); lê o
   UP (`lerOferta`: todos os itens do UP, inclusive cópias de catálogo); nenhum item aberto = confirmado
   (`escrita_em`, que neste tipo significa "fechamento confirmado por leitura"; `confirmada_em` não é usado porque
   avançaria a marca d'água do SKU); senão `PUT /items/{id} status=closed` em cada item aberto. Erro de leitura ou de
   PUT num alvo/item não interrompe os demais (lição da Task 10); erro de leitura nunca vira confirmação. Resultado
   incerto nunca reenvia às cegas: a próxima invocação relê, `closed` confirma, aberto recebe novo PUT (fechar é
   idempotente; o GET antes evita o 400 de item já fechado). 4xx conta em `recusas` e entra no mesmo backoff. Sem
   `travada`: o kit não pode ficar preso em `encerrando` sem caminho de saída. Backoff pelo tempo desde a primeira
   intenção (5 s, 30 s, 60 s, 5 min) e alerta (app + Telegram, chave por faixa) só depois de 15 min de carência,
   repetido a cada faixa (15 min, 1 h, 6 h, depois diário), com o motivo estável (itens pendentes, se a leitura
   está falhando e a faixa), que a tela mostra no andamento.
4. **Conclusão numa transação** (`kit_encerrar_finalizar`, validada pelo token e com todos os alvos confirmados; e a
   mesma `kit_encerrar_aplicar` no caminho sem alvos do passo 2): `status='encerrado'`, `encerrado_em`;
   `kit_reposicao_desligar` (remove as reivindicações do kit; peça sem outra reivindicação volta a Normal com
   `versao+1`, `so_em_kit=false`); apaga `kit_pausas_automaticas` dos itens do kit (fechados); marca os filhos do kit
   em `anuncios_externos_itens` como `retirado=true, status='pausado'` (padrão de retirar; o check de status não tem
   "encerrado"); no caminho da saga, solta as exclusões e
   fecha a transferência (`kit_saga_finalizar`); no caminho sem alvos não há transferência nem exclusão a soltar. Não
   apaga variações, composição, `estoque_movimentos` nem vendas. Família e raiz do kit não mudam (`familia_status` e
   `anuncios_externos.status` não têm "encerrado"): o padrão destrutivo do Remover não serve. Publicados esconde a
   família do kit pelo `kits_variacao.status`. Reposição depois do commit: o `reporDepois` do worker (caminho da
   saga) ou a edge (caminho sem alvos) enfileira a rodada do kit, que desfaz só as pausas da automação das peças fora
   de Guardado, pelo caminho com exclusão e CAS (regra da Task 14). Rede durável: a rodada diária já dispara pelos
   SKUs com `kit_pausas_automaticas` pendente.
5. **Participante depois do encerramento.** Regra única em SQL (`kit_participante`):
   - SKU de kit (`kit_variacao_skus`) participa sempre, inclusive de kit encerrado: preserva a identidade estável da
     venda (Task 8), a recusa de excluir a última cópia (venda tardia baixa e estorna pelo caminho normal) e a
     proteção do crédito de cancelamento.
   - Peça da base (`kit_variacao_componentes`) participa enquanto (a) um kit **não encerrado** a usa, ou (b) a
     política persistida ainda a restringe (`estado <> 'normal'` ou qualquer `bloqueio_*`), ou (c) há pausa da
     automação a desfazer (`kit_pausas_automaticas`). Assim a pausa do operador e a moderação continuam valendo
     depois do encerramento (o push comum reativaria sem olhar os bloqueios), e a reativação da reposição segue pelo
     caminho com exclusão e CAS; a peça só vira SKU comum quando nada mais a prende.
   Usam a regra: `kit_skus_participantes` (guardas de edge das Tasks 5 e 6, Remover, publicação, cancelamento), os
   triggers da Task 7 (`kit_variacao_saldo_copia`, `kit_variacao_conferir_update`, `kit_variacao_preservar_*`) e a
   triagem diária (`reconciliar-estoque`), que além disso pula SKU de kit encerrado (itens fechados, não "sem user
   product"). `limpar_movimentos_orfaos` não muda (preserva todo movimento de SKU em composição). A transferência
   `encerrar` segura só os SKUs do kit: `kit_sku_em_transferencia`/`kit_reposicao_pendente` não expandem os
   componentes dela.
6. **Kit encerrando ou encerrado não muda mais.** Triggers de rede. Os de `kit_transferencias` e `kit_exclusoes`
   travam os kits envolvidos (`for share`, em ordem de id) antes de ler o status: quem esperou o `for update` de
   `kit_variacao_encerrar` lê o status já commitado, e nenhuma publicação nova passa no meio. Exceção: a exclusão da
   republicação não trava o kit (ela segura `familias` FOR UPDATE e `kit_variacao_adicionar` faz kit → família:
   deadlock); contra o encerramento ela é serializada pela própria linha de exclusão, e a guarda de `kit_exclusoes`
   é AFTER INSERT (roda depois da espera pelo índice único e lê o status já commitado); a republicação que termina
   antes deixa o kit sem vínculo, que o encerramento recusa.
   - `kits_variacao`: recusa sair de `encerrando`/`encerrado` (só `encerrando → encerrado`) e ligar
     `so_em_kit`/`reposicao_auto` (cobre ligar, adicionar com SKU novo, montar via gerenciar);
   - `kit_transferencias` (`security definer`: o executor não lê `kits_variacao`): recusa transferência que não seja a
     `encerrar` quando o kit, explícito em `kit_id` ou inferido pelos SKUs de `itens` (`entrada`, `sair_sobra`,
     `cancelamento` com `kit_id` nulo ou snapshot antigo), está `encerrando`/`encerrado`; e `encerrar` só com o kit
     em `encerrando`;
   - `kit_exclusoes`: recusa dono que não seja `transferencia` em SKU de kit `encerrando`/`encerrado`. Cobre
     publicação e ativação (`kit_adquirir_exclusao`) e a republicação (`preparar_republicacao` insere a exclusão
     antes de apagar vínculos e virar CREATE: a recusa desfaz tudo).
   A tela esconde as ações; a recusa por trigger só aparece numa corrida, como erro.
7. **Avisos duráveis.** `kits_variacao.encerrado_avisado_em` marca o aviso de conclusão. `avisarKitsEncerrados`
   (org com o módulo) envia, com chave idempotente: a conclusão de cada kit `encerrado` ainda sem marca
   (`kit_encerrado:<kit>`), marcando depois do envio; e, para cada SKU de kit encerrado com saldo diferente de 0, o
   aviso de saldo preso (`kit_encerrado_saldo:<codigo>:<último movimento>`: crédito que chegou durante
   `encerrando` ou estorno depois de `encerrado`), pedindo ajuste manual. Nada remonta sozinho. Roda depois do
   commit da conclusão (worker), depois de todo crédito de cancelamento em SKU de kit e na reconciliação diária,
   então não depende de `aplicados` nem do claim da transferência. Cancelamento em SKU de kit encerrando/encerrado
   não tenta criar transferência.
8. **Tela.** `encerrando` mostra o andamento na seção de transferências do Gerenciar (a mesma leitura que repete a
   cada 10 s, com o motivo do passo 3) e o kit segue relido enquanto `encerrando`; `encerrado` some de Publicados e
   aparece "Encerrado" no bloco "Kits com variação" da base, sem ações. Org sem o módulo não lê nada novo.
9. **Deploy, nesta ordem.** (1) Migration `20261108154241_kit_variacao_encerrar` (sozinha não muda comportamento:
   nenhum kit está `encerrando`/`encerrado`, então nenhuma peça sai da regra de participante e as guardas não
   disparam). (2) Edges `gerenciar-kit-variacao`, `kit-transferencia`, `kit-reposicao`, `reconciliar-estoque`,
   `reconciliar-faturamento`, `sincronizar-estoque` e `sync-venda` (importam `encerrar.ts`, `saga.ts`, `reposicao.ts`
   ou `cancelamento.ts`); `reconciliar-estoque` chama `kit_codigos_triagem` e lê `encerrado_avisado_em`, por isso
   depois da migration. A tela vai ao ar no merge; até `gerenciar-kit-variacao` subir, o botão recebe `acao_invalida`.

**Riscos aceitos.** Se o módulo for desligado depois de um encerramento, a família do kit (itens fechados) volta a
aparecer em Publicados, como qualquer anúncio fechado no ML. Peça com bloqueio de moderação ou retirada que nunca é
limpo segue participante (entradas pela saga), como hoje com o kit vivo. Kit sem nenhum item no ML encerra sem aviso
no Telegram além da resposta na tela e do aviso de conclusão da varredura.
