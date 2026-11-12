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
    *Emenda 08/11:* o texto parte da `descricao_ml` da base canônica, no padrão de seções da copy do anúncio novo. A
    IA reescreve só a abertura ("KIT N …") e a frase final; quantidade, guia de tamanhos (só os tamanhos com
    quantidade), cores (só as do kit) e o resto das seções são editados por código, e trecho da IA com número, cor ou
    seção fora da base é descartado. Base sem descrição no padrão: gera antes pelo prompt do anúncio novo. A etapa 2
    gera sozinha uma vez por pedido (cores, peças, tamanhos); texto editado só é trocado com confirmação. Medição no
    `gpt-6-luna`: 12 bases × 4 execuções, 48/48 nas checagens.
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
   deadlock); contra o encerramento ela é serializada pela própria linha de exclusão. Em `kit_exclusoes` são duas
   etapas: BEFORE INSERT trava o kit (publicação e ativação, na ordem kit → exclusão do encerramento) e AFTER INSERT
   confere o status (roda depois da espera pelo índice único e lê o commit esperado); a republicação que termina
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
9. **Deploy, nesta ordem.** (1) Migration `20261108170711_kit_variacao_encerrar` (sozinha não muda comportamento:
   nenhum kit está `encerrando`/`encerrado`, então nenhuma peça sai da regra de participante e as guardas não
   disparam). (2) Edges `gerenciar-kit-variacao`, `kit-transferencia`, `kit-reposicao`, `reconciliar-estoque`,
   `reconciliar-faturamento`, `sincronizar-estoque` e `sync-venda` (importam `encerrar.ts`, `saga.ts`, `reposicao.ts`
   ou `cancelamento.ts`); `reconciliar-estoque` chama `kit_codigos_triagem` e lê `encerrado_avisado_em`, por isso
   depois da migration. A tela vai ao ar no merge; até `gerenciar-kit-variacao` subir, o botão recebe `acao_invalida`.

**Riscos aceitos.** Se o módulo for desligado depois de um encerramento, a família do kit (itens fechados) volta a
aparecer em Publicados, como qualquer anúncio fechado no ML. Peça com bloqueio de moderação ou retirada que nunca é
limpo segue participante (entradas pela saga), como hoje com o kit vivo. Kit sem nenhum item no ML encerra sem aviso
no Telegram além da resposta na tela e do aviso de conclusão da varredura.

**Junção com o adendo de acompanhamento (08/11).** O encerramento usa a carência única `CARENCIA_ALERTA_MS` (3 min)
da saga como início das faixas de alerta (3 min, 15 min, 1 h, 6 h, diário). O aviso de fim genérico (`kit_fim:`)
não vale para `encerrar`: a conclusão do encerramento sai só por `avisarKitsEncerrados` (`kit_encerrado:<kit>`). Na
tela, a transferência `encerrar` aparece como "Encerramento", etapa "Fechando os anúncios do kit no Mercado Livre".

## Adendo (2026-11-08): acompanhar a transferência na tela e avisar ao terminar

Criar o kit só mostrava um toast; a saga leva de 10 a 15 min e ninguém era avisado ao fim.

- **Na tela.** Depois de criar, Montar mais ou Desmontar, o diálogo fecha e Publicados leva à linha da base (página
  atual, outra página do mesmo filtro ou busca pelo código; base fora da lista abre o Gerenciar kit), expande e destaca
  o bloco "Kits com variação" por 2,5 s. Com transferência ativa, o bloco mostra a etapa em linguagem simples, "passo X
  de 9", na ordem real de `PassoSaga`, com a contagem da quarentena (último `passo1_em` + 300 s; o front não lê
  `KIT_QUARENTENA_S`). Travada: borda vermelha parada, com o alerta. Sem transferência: link "Ver anúncio no ML"
  (`familias.ml_permalink` do kit). O Gerenciar kit usa o mesmo indicador. Polling de 5 s em `useKitsVariacao`
  enquanto há transferência ativa (não há padrão Realtime nesta tela). `alerta` de transferência ativa não aparece:
  guarda motivo de reagendamento (ex.: `quarentena`) por `coalesce`.
- **Aviso ao terminar.** Montagem, desmontagem e reposição concluídas avisam no app e no Telegram (categoria
  `estoque`, que já tem assinantes) com o nome do kit, as combinações e tamanhos, a quantidade, a URL do anúncio do kit
  e o aviso do seletor do ML. Mesmo padrão do aviso de kit zerado: `notificarCategoria` com chave
  `kit_fim:<transferência>` e `kit_transferencias.aviso_fim_enviado_em` gravado só depois do envio. O worker avisa logo
  depois da saga; falha só loga, nunca reabre nem trava a saga, e a varredura diária (`reconciliar-estoque`) repete o
  que ficou sem marca. A migration marca como avisado tudo o que já tinha terminado.
- **Travada** continua com o alerta imediato da própria saga (um só, como os testes da saga exigem), agora com o
  código do kit e o link do Gerenciar kit (`APP_URL/#/publicados?kit=<id>`, que abre o diálogo). Esse alerta segue
  sem chave nem nova tentativa, como antes; a linha vermelha na tela e no Gerenciar fica até alguém resolver.

## Adendo (2026-11-08): alerta com carência e "resolvido"

Caso Zaven (kit 00000224): o Telegram recebeu "Transferência de kit bloqueada: … pausa do item criado não confirmada"
e a saga resolveu sozinha 20 s depois; o texto ficou em `kit_transferencias.alerta` da concluída.

- **Carência única.** Todo reagendamento com alerta escalonado (pausa do item criado ou busca do UP ainda indexando,
  pedidos sem baixa, preparo ou recusa do CREATE) só alerta se o problema persistir 3 min (`CARENCIA_ALERTA_MS`),
  contados da intenção do CREATE ou de `alerta_desde` (primeiro registro do problema; avançar de passo zera). A
  janela de 5 min da busca vazia virou esta carência. Até 15 min (`BLOQUEIO_MS`) o texto é de espera ("… em espera
  (tentando de novo)" ou "Aguardando o Mercado Livre confirmar a pausa…"); depois, "bloqueada". Cada texto sai uma
  vez (`alerta_enviado`, gravado só depois do envio: falha na fila ou no Telegram reenvia na tentativa seguinte e
  nunca vira "resolvido" falso). Travada, abortada, venda acima do saldo e repausa que falha seguem imediatos.
- **Resolvido.** Concluída com `alerta_enviado` ganha "O alerta anterior desta transferência foi resolvido." no aviso
  de fim; tipos sem aviso de fim (entrada, cancelamento, guardar peças) ganham um aviso curto. Mesma chave
  `kit_fim:<transferência>` e mesma marca `aviso_fim_enviado_em`, gravada só depois do envio.
- **Concluída sem alerta velho.** `kit_saga_finalizar` grava na concluída o alerta recebido (a saga manda null, ou o
  "política não autoriza reativar"); abortada segue com `coalesce`.

## Adendo 1 (08/11) — foto por IA fiel à peça, com verificação automática

**Por quê.** Falha real em 08/11 (Zaven, "Short Bermuda Linho Mauricinho", kit Bege Cru + Cinza Escuro): detalhes
fiéis, mas a peça saiu longa (bermuda no joelho; o original é short no meio da coxa) e o Cinza Escuro saiu mais
escuro. A descrição livre por visão não captou comprimento nem proporção. Regra do Diego: zero falha de fidelidade
(comprimento, modelagem, cor, textura, detalhes).

**Decisão.**

1. **Ficha estruturada antes de gerar**, por visão, com todas as fotos de cada cor (variações da cor, fora de item
   moderado, até 3 por cor): tipo e comprimento relativo ao corpo, proporção altura/largura, modelagem e caimento,
   cós, cordão, bolsos, etiquetas, barra, textura e cor por cor do kit. Fotos repetidas por conteúdo (o mesmo
   arquivo em um caminho por tamanho) contam uma vez. **Sem hex amostrado em código**: medido em 08/11 em 7 kits
   reais, a foto vestida e o cenário contaminam a média mesmo dentro da caixa da peça apontada pelo modelo e com
   filtro de pele (o preto saiu marrom), e o hex errado no pedido puxou a geração para o marrom (falso positivo no
   kit Preto Mesclado). A cor fica com as fotos, o nome do tom e o inspetor; voltar ao hex só com segmentação da
   peça. As capas da família ficam fora: não têm cor declarada.
2. **Geração ancorada**: fotos de cada cor + a ficha (como dado, separado das instruções); o pedido proíbe alongar,
   encurtar, trocar modelagem ou inventar detalhe. Enquadramento do kit: N peças lado a lado, mesma escala, numa
   linha, fundo claro neutro, quadrada.
3. **Verificação automática**: 2ª chamada de visão compara a gerada com as originais item a item da ficha e devolve
   JSON estruturado; o veredito é calculado em código (nunca um "aprovado" do modelo). Comprimento comparado direto
   com a original (mais longa, igual, mais curta) e proporção altura/largura da original e da gerada lidas na mesma
   resposta, com tolerância de 15% (a categoria absoluta lida numa foto estendida contra uma vestida deu ruído na
   medição de 08/11); cor por matiz e escurecimento contra as originais da cor (cinza que puxa para o marrom é
   divergência).
   Erro ou resposta ilegível na verificação reprova (fail-closed). Foto gerada horizontal ou pequena também reprova
   a tentativa.
4. **Até 3 tentativas por `request_id`** (1 + 2 automáticas), cada uma numa linha de `kit_variacao_imagens`
   (`tentativa` 1..3). A reprovada vira `recusada` com o custo real e os motivos (`verificacao`) e não é cobrada; a
   seguinte recebe os motivos no pedido. Uma linha viva por pedido (índice único parcial fora de `recusada`) e uma
   `gerada` no máximo: a cobrança continua uma por `(org, request_id)`. **Emenda a decisão 9**: só a imagem
   aprovada pela verificação é cobrada (a descartada pelo operador depois de aprovada continua cobrada).
5. **Prazo de 145 s: uma tentativa por chamada.** Cada chamada faz no máximo uma geração + verificação; a ficha é
   calculada na 1ª e guardada na linha. A tela repete o mesmo `request_id` enquanto a resposta trouxer
   `proxima: true`. A repetição de uma tentativa já decidida devolve o estado gravado, sem IA. 3 reprovações: a tela
   mostra "A IA não conseguiu uma foto fiel" com os motivos, sugere enviar foto própria e não oferece
   "Usar esta foto" (resposta reprovada nunca traz `path`).

**Ainda a medir:** taxa de aprovação na 1ª tentativa, falso positivo (aprovada não fiel na conferência humana) e
tolerância de proporção (15%) com produtos reais (`scripts/medir-foto-kit-fiel.ts`). A base tem só 9 roupas com
2+ cores fotografadas (2 lojas; a "Camisa" é uma camiseta gola careca), e em todas o dedupe deixou 1 foto distinta
por cor (o mesmo arquivo em cada tamanho): frente/costas separadas não ocorreram nesta base.

**Medição de 08/11 (12 kits, 6 de 2 cores e 6 de 3; Nano Banana 2.1 + gpt-4o; ~US$ 0,05–0,06 por tentativa).**
A verificação aprovou os 12 em até 3 tentativas (7 na 1ª). Na conferência humana das 12 aprovadas: 3 fiéis
(inclusive o caso Zaven), 7 em dúvida (etiqueta de gola inventada em 6; tom de Cáqui/Caramelo) e 2 não fiéis
(etiqueta inventada no cós; decote quadrado no lugar do arredondado). A verificação reduz a falha, não a elimina:
a aprovação humana ("Usar esta foto", depois de ampliar e comparar com as originais) continua sendo a trava.
Reteste de 6 desses kits já com a proibição de etiqueta inventada no pedido e no inspetor: 4 aprovados (1 na 1ª);
o inspetor passou a cobrar etiqueta "ausente" quando a ficha descreve etiqueta não visível (ponto a ajustar na
ficha). Ficha levou até 29 s, verificação até 36 s e geração de 9 a 82 s: fatias de ficha e verificação de 35 s; uma
geração acima de ~60 s na 1ª tentativa estoura o prazo e a chamada falha sem cobrança (o mesmo pedido repete).

**Modelo mais forte (08/11):** `openai/gpt-5.4-image-2` (catálogo: imagem na entrada e na saída) não gerou imagem
pelo OpenRouter em nenhuma qualidade (low, medium, high): `Complexity '…' is not supported for this image model`
(`provider_unavailable`), como em 07/11. `google/gemini-3-pro-image` ficou fora por decisão do Diego (~3× o custo).
Fica o Nano Banana 2.1; o script de medição aceita `--modelo` e `--qualidade` para repetir a comparação.

## Adendo (2026-11-08): preço avulso das peças na criação do kit

**Problema.** O operador digitava o preço do kit sem ver por quanto as peças vendem avulsas. Com a base em
promoção (ex.: Short Bermuda Zaven R$ 71,90 → R$ 41,90), o kit podia sair mais caro que comprar as peças
separadas, o que derruba a conversão e queima o anúncio.

**Decisão.**
- Edge nova, só leitura: `preco-avulso-kit` (`verify_jwt=true`, módulo `kit_variacao`, token da org). Por SKU da
  base: `normal` = `price` do `/items/bulk` (lotes de 20 ids únicos); `promocao` = `amount` do `/sale_price`
  quando abaixo do normal (o `regular_amount` não é usado como normal: pode ficar velho, ADR-0196); fim =
  `finish_date` da oferta vencedora (`metadata.promotion_id`/`campaign_id` do `/sale_price` casado com
  `/seller-promotions/items/{id}`), senão nulo. Timeout de 5 s por chamada. Nada é gravado; sem cache: a tela
  lê de novo a cada abertura.
- Leitura incerta (bulk, `/sale_price`, sem vínculo, sem conexão) nunca vira "sem promoção": a peça fica
  "preço avulso indisponível" e o aviso diz que não foi possível comparar. Não bloqueia.
- Tela: etapa 1 mostra a soma avulsa (normal · em promoção) por combinação × tamanho; etapa 2 a pior combinação
  (menor soma em promoção) e o desconto do kit sobre as duas somas; etapa 3 a comparação por combinação. Kit ≥
  soma em promoção (ou normal, sem promoção) em qualquer célula com quantidade → aviso amarelo e "Criar mesmo
  assim", invalidado quando preço ou combinações mudam. Gerenciar kit mostra a mesma referência para
  combinação ou tamanho novo (informativo).
- Nenhuma fórmula de tarifa nova: a comparação é só entre preços de venda; o lucro segue no simulador.

## Adendo (2026-11-11): fotos em lote, promoções futuras das peças e rótulos da conferência

**Fotos em lote (etapa 2).** "Gerar todas" gera a foto das combinações sem foto, sem candidata e sem geração em curso;
"Gerar de novo todas" refaz candidatas e "não fiel" (nunca toca foto enviada pelo operador nem foto de IA já aprovada) e
pede confirmação com a contagem, porque cada geração é cobrada (decisão 9). A fila tem no máximo 3 gerações
simultâneas; enquanto houver geração, "Voltar" e fechar ficam bloqueados (a candidata vive na etapa 2 e uma foto já
cobrada seria perdida). **A trava humana continua:** "Aprovar todas" não aprova direto, abre uma grade com cada foto
gerada em tamanho real ao lado das originais da peça e só "Confirmar K fotos" vira a foto das combinações. Foto da
grade sem prévia carregada não entra.

**Promoções futuras das peças (etapa 3).** `preco-avulso-kit` lê `/seller-promotions/items/{id}` de todo item (uma
leitura por item, em paralelo ao `/sale_price`, com repetição curta em 500/502/503) e devolve por SKU as promoções
`pending`/`started` com início depois de agora e `price` abaixo do normal em centavos (o critério é a data: Relâmpago
participante fica `pending` mesmo ativo, ADR-0174). Convite não aceito (`candidate`) fica de fora. A tela lista, por
peça do kit, valor, % abaixo do normal, tipo e janela (com hora quando começa e termina no mesmo dia). Só informativo.
Falha nessa leitura é por SKU e só aparece se a peça estiver no kit.

**Rótulos.** "Pior combinação" vira "Menor lucro" (simulador) e "Avulso mais barato" (comparação); quando todas as
linhas têm o mesmo valor (lucro; ou soma normal e em promoção, sem linha indisponível), a tela diz que é igual em todas
e não marca nenhuma.

## Adendo (2026-11-12): conferência da foto julga só a vista de frente

**Problema.** No Short Bermuda 00000140 da Zaven a conferência reprovou 9 de 9 gerações em 12/11 por "bolso traseiro
ausente" e "etiqueta interna não visível". A foto do kit é de frente (peças estendidas); a foto original é uma colagem
com frente e costas, e a ficha lista o bolso traseiro e a etiqueta interna. O motivo falso ainda voltava ao gerador
como "corrigir", que então inventava uma etiqueta na frente.

**Decisão.** O inspetor julga só o que uma vista de frente mostra: bolso traseiro e etiqueta interna (cós ou gola)
ficam fora do escopo de `bolsos` e `etiquetas`, e a ausência deles nunca é diferença. Detalhe inventado na frente
continua reprovando. O gerador é instruído a não mostrar na frente o que só existe nas costas ou por dentro. A ficha
não muda. A aprovação humana segue obrigatória.

**Medição (12/11, modelo real, só a conferência sobre as 13 prévias guardadas da Zaven; 5 rodadas, US$ 0,70 no
total).** Antes: 3 aprovadas e 10 reprovadas. Redação final: 11 aprovadas e 2 reprovadas. Uma tem etiqueta inventada
no cós (conferida a olho: reprovação correta). A outra é reprovada pelas ponteiras do cordão, parecidas com as da peça
(reprovação duvidosa, do item `cordao`, fora desta correção). Redações testadas e descartadas: sem a regra junto da
definição de `bolsos` o bolso traseiro continuava reprovando (9 de 13, repetido em duas rodadas); com "nunca reportar
como diferente" passavam 12 de 13, mas um bolso traseiro desenhado na frente ficaria isento (revisão Grok). Três das
reprovadas antigas foram abertas e estavam fiéis. Limites: um produto só; a geração com o pedido novo não foi medida
(cada foto custa ~US$ 0,05).

**Em aberto (proposta, não decidido).** Conferir por visão só o que o código decide com segurança (quantidade, cor e
proporção), deixando bolsos, etiquetas e cordão para a aprovação humana, e reduzir de 3 para 1 a regeração automática,
como a galeria fez (ADR-0203).
