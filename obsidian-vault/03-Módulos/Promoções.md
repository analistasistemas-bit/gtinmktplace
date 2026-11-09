---
tags: [modulo, promocoes]
atualizado: 2026-09-24
---

# Promoções

Central de Promoções do Mercado Livre, só leitura. Módulo pago `promocoes`, ligado por org
(ADR-0170) — MVP da iniciativa I1 do roadmap de melhorias. Ver [[Índice de ADRs]] (ADR-0170),
[[Marketplace]], [[Configurações]], [[Banco de Dados]].

## O que o MVP faz — e o que não faz

Lista as promoções da conta ML (Relâmpago, Tradicional, Smart, DEAL, cupom, co-participação) com
os anúncios candidatos/participantes de cada uma, mostrando a **margem líquida projetada** por
anúncio — mesma régua de custo+imposto+tarifa+frete usada em `calcular-tarifa-ml` (Revisão). O
MVP **não adere nem remove** anúncio de campanha — é leitura + diagnóstico de margem. Adesão pela
app fica para uma V2 (Promoções V2, roadmap de melhorias).

## Banco

- **`ml_promocoes`** — 1 linha por promoção da conta (`org_id` + `promocao_id`). `tipo`, `nome`,
  `status`, `inicio`, `fim`, `prazo_adesao`, `contagem jsonb`, `erro`, `sincronizado_em`,
  `itens_sincronizados_em`, `rodada_em_curso` (reserva de leitura de 30 min).
- **`ml_promocao_itens`** — 1 linha por anúncio dentro de uma promoção. Preços (`preco_original`,
  `preco_promo`, `preco_min/max`, `preco_sugerido`, `preco_avaliado`), percentuais bancados
  (`ml_pct`, `vendedor_pct`), `projecao jsonb` (margem por cor) e `pior_semaforo`
  (`verde|amarelo|vermelho|indisponivel`).
- **`ml_promocoes_sync`** — 1 linha por org com o estado da sincronização
  (`sincronizando|ok|sem_acesso|sem_promocoes|erro`).

RLS: leitura por `org_id = current_org_id()`; escrita só `service_role` (worker). Coluna
`configuracoes.alertas_promocoes_ativo` (default `false`) liga o alerta por org.

## Sincronização — `sincronizar-promocoes`

Edge nova, `verify_jwt=false` (valida assinatura QStash **ou** JWT do usuário). Dois modos:

- **QStash `{}`** (schedule `scd_5FKHhPTKCNtqp31W8nruJdVCLCRm`, `10 9 * * *` desde 03/11/2026 — emenda ADR-0170; antes `10 */6`) → fan-out por org
  com o módulo ativo. Etapa **`lista`**: trava de 5 min, lista as promoções, encerra as que
  sumiram, roda os alertas lendo o banco, reserva + enfileira 1 leitura por promoção
  `pending`/`started` não-cupom. Etapa **`promocao`**: uma oferta por anúncio, lotes de 20 itens,
  **teto de 100 itens por mensagem** (90 s de relógio só de reserva), continuação pelo último `ml_item_id`, posse da rodada conferida antes de cada lote e na
  conclusão, `deduplicationId`.
- **Usuário logado** → dispara a etapa de lista só da própria org, throttle de 2 min, `403` sem o
  módulo.

Só faz `GET` no Mercado Livre (única exceção: refresh de token OAuth).

## Rollout

Módulo `promocoes` por org, nasce **desligado**. Ligado em produção só na org **DSA** (decisão do
Fable com validação real) — Avil e Daludi Shop seguem desligados (ligar na Avil é decisão do
Diego em `/admin`). Alertas desligados em todas as orgs.

## Validação (2026-09-24)

Preflight 568 arquivos/5913 testes verdes; suíte de isolamento
(`scripts/verificar-isolamento-tenant.ts`, agora com as 3 tabelas) 77 PASS/0 FAIL contra produção;
E2E real na DSA — lista em ~5s, 5 promoções, 52 anúncios lidos; prova dos números: 7/7 anúncios
com líquido da Central = `calcular-tarifa-ml` (Revisão), diferença ≤ R$0,005 (convidado DEAL/SMART,
participando, Legacy multi-cor, frete 0 e pago); validação visual em 1440/1920/360px e estados sem
acesso/sem promoções/erro (dados injetados); 4 defeitos visuais achados e corrigidos.

## Operações em massa — aderir/sair (ADR-0174, 2026-09-28)

- No detalhe de campanha DEAL/SMART: caixa por anúncio + "Selecionar todos"; barra "Aderir N / Sair N" no rodapé.
- Preview: só 🟢 vem marcado; DEAL usa o preço sugerido, editável dentro da faixa; 🔴/⚪ exigem "Aderir mesmo assim".
- Execução via QStash: relê a campanha no ML antes de escrever (item que mudou não é escrito; par de catálogo oculto é bloqueado); saída fica "Saída pedida" até o ML confirmar (conferência 5→60 min, até 24 h, depois erro).
- Aba **Operações**: resultado por anúncio; **Reverter** = nova operação inversa com preview; já revertida mostra "Revertida em {data}".
- Só admin executa (suporte só com acesso total). Conta ML precisa reconectar para ganhar `offers:/read-write`.

### Relâmpago (emenda 2026-11-02 — em produção desde 2026-11-03)

- Relâmpago (LIGHTNING) vira o 3º tipo: mesma seleção/preview/Reverter de DEAL/SMART.
- Preço editável (padrão = sugerido do ML), dentro da faixa do ML e **nunca abaixo de R$ 19,00** (comprador perde o frete grátis) — vale mesmo com "Aderir mesmo assim".
- Estoque reservado = mínimo exigido pelo ML (preview mostra "Reserva N un."); estoque disponível menor → bloqueado.
- Após aderir o item fica `pending` com a janela que o ML define (mensagem "Agendada: dd/mm hh:mm–hh:mm"); saída confirma quando volta a convidado (≤ 5 min no spike).
- Central: convidado Relâmpago usa faixa e sugerido da visão por item do ML (o `price` do convite não serve); sync com teto de 40 itens/mensagem.

### SMART_LIGHTNING e Preço competitivo (emenda 2026-11-03)

- Ofertas de preço fixo do ML: sem edição, com piso de R$ 19 e revalidação do preço antes de escrever. SMART_LIGHTNING reserva o estoque mínimo e agenda 12 h; Preço competitivo (PRICE_MATCHING) **entra no ar na hora**.
- Depois de aderir, o ML leva ~2 min para refletir: nova adesão ao mesmo anúncio fica barrada por 30 min.
- Tipo de campanha que o app não sabe ativar: aviso uma vez por org (Telegram/sino, categoria Integração) e mensagem na tela indicando o Seller Center.

### Piso de R$ 19 em toda campanha (emenda 2026-11-07)

- Se o sugerido do ML fica abaixo de R$ 19 mas a faixa alcança R$ 19, o anúncio fica, com R$ 19,00 como preço (desconto menor). Só DEAL e Relâmpago: oferta de preço fixo não tem faixa.
- Convidado que não alcança R$ 19 não aparece em Sugestões nem em Convidados e não entra na contagem, em qualquer tipo. Abaixo disso o frete é do comprador e pode custar mais que o produto.
- Quem já participa continua visível para poder sair. Aderir, alterar preço e Reverter abaixo de R$ 19 são recusados, mesmo com "Aderir mesmo assim".

### Alterar preço de quem já participa (emenda 2026-11-03, só DEAL)

- "Alterar preço N" na aba **Em promoção** (com busca título/MLB/SKU) e na aba **Participando** da campanha; mesmo painel da adesão (Desconto % / Preço R$ → Aplicar a todos, recebe·lucro·margem do servidor).
- ML: `PUT /seller-promotions/items/{id}` com o novo `deal_price` — não sai da promoção (spike Zaven 03/11). Relâmpago: sair e reaplicar; SMART: preço do ML.
- Reverter volta ao preço que o ML tinha antes (gravado no momento da escrita); se o preço mudou depois, o item fica "Mudou".

- 1ª alteração em massa real (03/11, Zaven): 13 jaquetas a R$ 43,90 em 38 s; quem já estava no preço vira "Já estava" sem PUT.

### Sugestões (ADR-0194, 2026-11-04)

- Aba **Sugestões**: produtos com menos de 5 vendas em 30 dias e convite de campanha, sem participar. **Quase vendendo** recebe visitas e vende abaixo da média da conta; **Invisível** tem poucas visitas. Por produto, com plano B por anúncio.
- Regra pura em `src/lib/sugestoes-promocao.ts`, sobre a RPC `sugestoes_promocao_sinais` e os convites. Sem chamada ao ML.
- Verde e amarelo (selo "Abaixo do piso"), lucro maior que zero. Campanha recomendada = maior desconto; até 2 pontos é empate e ganha o lucro.
- Dispensar vale 30 dias para a org. Adesão vinda de sugestão fica marcada em `operacoes_massa.sugestao` para medir depois.
- Card mostra preço atual e "Vendeu 0 · esperado ~3, pela média da conta". Painel Aderir mostra preço atual e o "Você recebe por venda" no tipo real do anúncio (Clássico ou Premium), a partir da projeção do servidor.
- Produto com 2+ campanhas DEAL abre a escolha com caixas de marcação; cada uma é confirmada no painel, em sequência, e vira uma operação própria. SMART e Relâmpago seguem uma por vez. Período cruzado no mesmo anúncio mostra aviso: o ML aplica o menor preço.
- Comissão e frete mudam por faixa de preço do ML: a conta do Aderir pode diferir da de Publicados no mesmo anúncio porque os preços são outros.

### Aba Em promoção e Operações (2026-11-03, só front)

- Em promoção: 20 anúncios por página em cada campanha (20/50/100), ordem por descrição; "Selecionar todos" e as ações valem para todas as páginas.
- Operação concluída com itens em erro (ex.: ML 500 transitório): **Tentar novamente N com erro** abre o mesmo preview com a mesma ação, só esses itens e no preço da operação; cria operação nova (sem origem — validação completa no servidor). Quem já entrou por outro caminho aparece bloqueado. Não vale para Reverter nem pausar/reativar/reajustar.
- ML 400 `OFFER_SIBLING_CREATION_IN_PROCESS` (AVIL, Black Friday 09/11): aderir o pai legado multivariação faz o ML propagar a oferta às cópias de catálogo; a adesão das cópias logo em seguida volta esse 400. Desde 09/11 o app relê: entrou → "Já estava"; ainda convidado → "Bloqueado" (atualize a Central em alguns minutos).
- ML 500 na adesão é transitório (Regata, 2 de 17): readerir resolveu. Não há retry automático de 5xx no aderir.
- Publicados: selo "Em promoção · X de Y variações · N sem estoque" — SKU UP zerado é pausado pelo ML e não entra em campanha (fica convidado).

### Busca + mesmo preço/desconto por produto (emenda 2026-11-03)

- Campo de busca no detalhe da campanha (título, MLB ou SKU, sem acento/caixa); "Selecionar todos" marca só o resultado — atalho para "o produto e todas as variações".
- DEAL/Relâmpago, aba Convidados: "Desconto %" (sobre o preço original) ou "Preço R$" + **Simular N** (até 50). Líquido/markup/semáforo vêm do servidor (`operacoes-massa` `etapa: 'simular'`, mesmo cálculo da trava, tarifa e frete do preço exato); linha ganha selo "simulado" e aviso se sair da faixa do ML.
- Aderir abre o preview já com o preço simulado; selecionado não simulado vem desmarcado.

### Pausar/reativar em massa (emenda 2026-10-04 — em produção desde 2026-10-04)

- 2º tipo do mesmo motor, mas **fora de Promoções**: seleção, barra e preview em Publicados; acompanhamento na aba **Publicados › Operações** (`?aba=operacoes`; a tela global `/operacoes` saiu do menu em 2026-10-07 e redireciona para lá). Esta aba Operações é a mesma lista filtrada por promoção.
- Lê o status fresco no ML antes de escrever; já no alvo = "já estava"; moderado/encerrado/migração PxV = bloqueado; Kit Virtual fora. Reverter só sobre o que a original aplicou.
- Ver `docs/reference/edge-functions.md` (operacoes-massa) e ADR-0174 (emenda 2026-10-04).

### Reajuste de preço em massa (ADR-0178 — em produção desde 2026-10-04)

- 3º tipo do motor, também fora de Promoções: botão "Reajustar preço" em Publicados → preview (rascunho de 30 min, trava financeira, 🔴/⚪ só com confirmação) → confirmar (admin). Acompanhamento e Reverter em `/operacoes`.
- Só o preço vai ao ML; o banco guarda o novo valor com a marca "Preço fixado pelo operador" (Revisão: "Voltar ao automático" remove). Promoção ativa (pending/started), Kit Virtual, catálogo, PxV e atacado PxQ ficam de fora; produto com reajuste ativo recusa publicar/UPDATE/migrar PxV.
- Ver `docs/reference/edge-functions.md` (operacoes-massa) e ADR-0178.

#### Alterar preço com oferta e atacado (ADR-0196, Fatia 1 — em produção desde 2026-11-07)

- Reajustar ganha "Definir preço R$" e a tela de alterar preço em Publicados, com ofertas vigentes e editor de atacado. Promoção deixa de excluir o anúncio; a trava impede base igual ou abaixo de oferta vigente ou agendada.
- Execução por passos com posse por token; faixas de atacado gravam antes de descer o base e depois de subir. O % do atacado vale para a família inteira (config efetiva = a única não nula entre as linhas do produto).
- `[]` com faixa viva não limpa; config sem faixa viva não cria. Faixa sobre o preço do item no UPDATE e CREATE de UP.
- Lacuna: o UPDATE de publicação baixa o base antes das faixas. Fatia 2 (DEAL baixa a oferta) suspensa: o ML recusa subir oferta (`PRICE_GT_CURRENT`). Fatias 3 e 4 não feitas.
- Ver [[0196-alterar-preco-em-publicados-com-oferta-e-atacado|ADR-0196]].

#### Trava da oferta no UPDATE (ADR-0196, emenda 2026-11-07 — em produção desde 2026-11-07)

- Decisão do Diego: o UPDATE recusa, com motivo, o produto que levaria o base a igual ou abaixo de oferta vigente ou agendada. Só esse produto; os demais do lote seguem; "somente estoque" continua disponível. Emenda o item 9 do ADR-0174, que só avisava.
- A checagem roda em `publicar-familias`, antes da reserva, só onde o preço novo fica abaixo do vivo. No reconciliador, o SKU reprovado vai em `semPrecoPara`, a composição converge e o operador é avisado.
- Limite aceito: oferta nova, ou preço editado inline, entre o clique e o worker normal não é detectado. Trava nos workers foi descartada.
- Ver [[0196-alterar-preco-em-publicados-com-oferta-e-atacado|ADR-0196]].

## Correções de 2026-10-04

- **Relâmpago duplicada** (`7cc6332d`): o ML lista o mesmo anúncio 2× (oferta genérica com estoque +
  oferta por horário); o upsert recusava o lote inteiro ("cannot affect row a second time") e o card
  mostrava "Não foi possível ler os anúncios". Agora fica 1 oferta por anúncio: a em que já participa;
  entre iguais, a de menor preço; o estoque vem da irmã. Avil `LGH-MLB1000`: 240 linhas → 227 anúncios.
- **Leitura caindo por CPU** (`0e9ea515`): a 11.11 da Black (Avil, 475 anúncios) caía com
  `546 CPU Time exceeded` sempre após 220 anúncios e travava o botão em "Atualizando…" por 30 min;
  o retry recomeçava do zero. Teto de 100 itens por mensagem (ADR-0173 §4) → 475/475 sem erro.

## Pendências conhecidas

- ~~Ligar módulo na Avil~~ — ligado em 2026-10-04 (5 orgs); alertas seguem desligados em todas.
- Heartbeat da reserva de 30 min se a cadeia real de sincronização passar de ~20 min.
- `CanalTabs` mostra dados do ML em qualquer aba de canal — revisar no E5.
- Toast de sucesso aparece mesmo quando a lista volta com estado erro.
- "Nenhum preço da faixa atinge o mínimo" ocupa 3 linhas na tabela.
