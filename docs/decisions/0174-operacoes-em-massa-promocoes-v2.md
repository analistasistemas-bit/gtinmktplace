# ADR-0174 — Operações em massa, começando por aderir/sair de promoção (I5 + Promoções V2)

**Status:** Aceito — em produção desde 2026-09-28
**Data:** 2026-09-26
**Relacionado:** [ADR-0170](0170-central-de-promocoes-ml.md) (Central de Promoções, só leitura),
[ADR-0060](0060-pausar-reativar-anuncio-ml.md) (pausar/reativar restrito a admin),
[ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) / [ADR-0055](0055-imposto-por-origem-nacional-importado.md) (piso, líquido, imposto)
**Origem:** grilling 2026-09-26 sobre os itens 1 e 2 do próximo ciclo em `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md`

## Contexto

O roadmap tinha duas entregas separadas: **I5 Operações em massa** (motor seleção → preview → execução →
resultado por item → reversão) e **Promoções V2** (aderir/sair de campanha pelo app, com confirmação humana,
começando por DEAL/SMART). A V2 feita anúncio a anúncio seria reescrita quando o I5 chegasse, e a 10.10 da Avil
tem 504 convidados — ninguém adere a 504 anúncios um por um. O discovery com a Avil sobre quais operações
coletivas se repetem (preço, pausa, estoque) ainda não aconteceu.

A escrita em `/seller-promotions` **nunca foi testada** (spike I1 foi só GET) e as conexões mostram o scope
`offers:/read-only`. As permissões vêm da aplicação no DevCenter do ML, não do `authUrl`, e o token guarda o
scope do momento da autorização.

## Decisão

1. **Motor único, promoção primeiro.** O I5 nasce com uma só família de operação: **aderir** e **sair** de
   promoção (`DEAL` e `SMART`). Aderir um anúncio é uma operação em massa de tamanho 1 — não existe caminho
   unitário separado. Pausar, preço e estoque entram só depois do discovery com a Avil.
2. **Reverter = nova operação inversa.** Sem desfazer silencioso. "Reverter" cria outra operação (aderir ↔ sair)
   só sobre os itens aplicados, com preview e confirmação. Item que o ML não aceita mais aparece como não
   revertível.
3. **Preço na DEAL:** default = `suggested_discounted_price`, editável por item no preview (atalho "usar Até
   quanto descer"). Item com sugerido 🟡/🔴 vem desmarcado.
4. **Trava financeira:** 🔴 (líquido < custo) e ⚪ (sem líquido) podem entrar, mas vêm desmarcados e exigem
   confirmação separada no preview; a confirmação fica gravada no item da operação.
5. **Revalidação na execução:** antes de cada escrita, GET fresco do item. Não é mais convidado, preço fora da
   faixa ou semáforo pior que o confirmado → item termina "mudou desde o preview", sem escrita. Já participando
   → sucesso idempotente (cobre retry do QStash).
6. **Permissão:** só admin da org executa (mesma regra do ADR-0060). Membro comum vê e monta o preview. Suporte
   Daludi só com acesso total aprovado.
7. **Tela:** inicia no detalhe da campanha da Central (seleção → painel de preview → Executar); acompanha numa
   aba "Operações" dentro de Promoções (progresso, resultado por item, Reverter). Tela global de operações só
   quando existir o segundo tipo.
8. **Execução:** padrão do `sincronizar-promocoes` — QStash com continuação e orçamento de tempo por chamada.
9. **Conflito com UPDATE:** a Revisão avisa quando a família tem anúncio participando de promoção ("mudar o
   preço pode tirar da promoção"); não bloqueia.
   *Emenda 2026-11-07:* o UPDATE passa a recusar, com motivo, o produto cujo preço novo fica igual ou abaixo de oferta
   vigente ou agendada (em produção desde 2026-11-07). A Revisão deixa de só avisar. Ver
   [ADR-0196](0196-alterar-preco-em-publicados-com-oferta-e-atacado.md), emenda "Trava da oferta no UPDATE".
10. **Prazo:** a 10.10 (adesão até 12/10) segue pelo Seller Center usando a Central para decidir. O motor mira as
    campanhas seguintes, sem atalho no spike nem na revisão.

## Pré-requisito: spike de escrita (antes do build)

1. Diego confere no DevCenter se "Promoções/ofertas" está em leitura + escrita; se mudar, reconecta a DSA.
2. Na **DSA** (org de teste), 1 anúncio convidado em DEAL e em SMART, MLB aprovado pelo Diego antes:
   `POST /seller-promotions/items/{id}` → GET confere → `DELETE ...?promotion_type=` → GET confere.
   A Avil não é tocada. Esta é uma escrita fora do fluxo do app, autorizada explicitamente para o spike.
3. Perguntas que o spike responde: payload aceito por tipo; erro com scope read-only; depois de sair da SMART, o
   ML inscreve de novo sozinho?; depois de sair, o anúncio volta a ser convidado?; mudar o preço base de item
   participando em DEAL: recusa ou remove?; rate limit de escrita.
   *(Respondido em 2026-11-06 pelo [ADR-0196](0196-alterar-preco-em-publicados-com-oferta-e-atacado.md): base acima da
   oferta não é recusado nem remove a oferta; base abaixo remove a oferta em até ~90 s.)*

### Resultado parcial do spike (2026-09-27, DSA, `MLB7553152348`)

- **Scope:** o token só passou a `offers:/read-write` depois de **reconectar** a conta. Mudar o DevCenter não
  basta e o refresh não atualiza o scope → reconexão vira passo de onboarding do módulo.
- **Aderir DEAL funciona:** `POST /seller-promotions/items/{id}?app_version=v2` com
  `{promotion_id, promotion_type:'DEAL', deal_price}` → **201** `{price, original_price, currency_id}`.
- **A visão por item atrasa:** `GET /seller-promotions/items/{id}` seguiu mostrando a DEAL como `candidate`
  (price 0) logo depois do 201 e só passou a `pending` minutos depois; a visão da campanha
  (`/promotions/{pid}/items?promotion_type=DEAL&item_id=`) mostrou `pending` na hora. Revalidação e conferência
  do motor leem a **visão da campanha**.
- **Sair de DEAL futura NÃO funcionou:** `DELETE ...?promotion_type=DEAL&promotion_id=` → **200 com corpo vazio**,
  e o item seguiu `pending` — tanto 3 s depois do POST quanto repetido ~40 min depois, com a inscrição já
  visível nas duas visões (descarta atraso de propagação). Com `deal_id` no lugar → 400 "Promotion id is
  required". **200 do DELETE não prova remoção.** Decisões 2 (Reverter) e 5 (idempotência) dependem de achar
  o caminho de saída.
- **Atualização 2026-09-27 13:42 — a saída é ASSÍNCRONA e lenta:** o item voltou a `candidate` na visão da
  campanha e `/items` segue com `price 19.99`, `deal_ids: []` (o preço promocional nunca foi ao ar). Ainda
  estava `pending` ~30 min depois do primeiro DELETE; saiu em algum momento antes das 13:42 do dia seguinte.
  Não dá para saber qual dos dois DELETEs valeu (ambos 200). Consequência para o motor: o 200 do DELETE é
  **"saída solicitada"**, não "saiu"; o item da operação só vira concluído quando uma leitura posterior da
  visão da campanha confirmar — conferência agendada, não na hora. Reenviar DELETE enquanto `pending` é inócuo
  (200 idempotente), então o retry não precisa de trava.
- **Par User Product / catálogo:** o item testado (`catalog_listing: false`) e `MLB7553277320`
  (`catalog_listing: true`, "COMPETINDO") são o mesmo `user_product_id`, ligados por `item_relations`
  (estoque compartilhado). O Seller Center mostra promoções **só no item de catálogo** e marca o outro como
  "não elegível" — mas a API aceitou a inscrição nele, e ela **não aparece nem pode ser removida pelo Seller
  Center**. O motor precisa decidir em qual item do par inscrever (provavelmente o de catálogo) e nunca
  inscrever o que o Seller Center não mostra.
- Atenção a datas: a 10.10 vai de **28/09 a 13/10** (`start_date`); o `prazo_adesao` gravado pelo sync é o
  fim, não o início.
- A visão da campanha devolve **500 intermitente** (2 em ~25 leituras) → retry na leitura.
- **SMART (2026-09-27, `MLB5140706557`, avulso — o anúncio de catálogo do par não era convidado):**
  - Convite traz `offer_id: "CANDIDATE-..."` na visão da campanha (a visão por item chama o mesmo valor de
    `ref_id`). `POST {promotion_id, promotion_type:'SMART', offer_id: <CANDIDATE>}` → **201** e devolve um
    **`offer_id` NOVO** (`OFFER-...`); a visão da campanha passa a `started` em segundos.
  - **Sair exige o `offer_id` devolvido pelo POST.** DELETE com o `CANDIDATE-...` → 200 no-op (o item segue
    `started`); com o `OFFER-...` → 200 e o item **some da visão da campanha em ~30 s** (`results: null`).
    O motor grava o `offer_id` da resposta do POST no item da operação, para auditoria; a saída usa
    o `offer_id` que a leitura fresca da visão da campanha devolve no participante (`OFFER-...`),
    não essa coluna.
  - `/items/{id}` não mostrou o preço promocional durante os ~2 min de participação (`price` e `deal_ids`
    inalterados) → conferência de preço não serve de prova de adesão; só a visão da campanha.

## Implementação

Em produção desde 2026-09-28: migration `20260928013318_operacoes_massa` aplicada, edge `operacoes-massa`
v1 ativa (e `sincronizar-promocoes` v9 redeployada pela extração em `_shared/promocoes/deps.ts`), front
na main `d5c79ac3`. Validado de ponta a ponta na DSA: operação real com 3 itens (Feito / Mudou desde o
preview / Bloqueado pelo par de catálogo), Reverter com saída SMART confirmada pela conferência em ~5 min.

- **Schema** (`supabase/migrations/20260928013318_operacoes_massa.sql`): `operacoes_massa` (1 linha
  por operação: `acao`, `promocao_id`/`promocao_tipo`, `origem_id` para o Reverter, `status`
  `executando|concluida`) e `operacoes_massa_itens` (1 linha por anúncio: `status`
  `pendente|enviando|aplicado|ja_estava|mudou|bloqueado|erro|saida_solicitada`, `semaforo`,
  `confirmado_risco`, `offer_id` do SMART, `conferencias`/`proxima_conferencia`/`saida_pedida_em`
  para a conferência de saída). Índice único de anti-duplicidade cobre `pendente`, `enviando` e
  `saida_solicitada` — o mesmo anúncio não fica em duas operações da mesma promoção ao mesmo tempo.
  RPC `operacoes_massa_reivindicar` (claim atômico por item antes de escrever no ML).
- **Edge `operacoes-massa`**: `POST` do usuário cria a operação (valida contra a Central, grava
  `preco`/`semaforo`/`confirmado_risco` por item, publica a 1ª mensagem QStash); QStash chama de
  volta com `{etapa:'executar'|'conferir', operacao_id}`. Código em `_shared/operacoes/`
  (`validar.ts`, `decidir.ts`, `executar.ts`, `ml.ts`, `deps.ts`, `falhas.ts`, `tipos.ts`).
- **Decisões tomadas durante a implementação (prevalecem sobre o texto acima onde divergirem):**
  - **Dedup do QStash** pelo `upstash-message-id` da mensagem de entrada (`{etapa}_{operacao_id}_{id
    de entrega}`), não por um contador — a fórmula por contador repetia id em continuação/403 e
    deixava a operação sem mensagem na fila.
  - **Trava financeira com tarifa exata:** quando o preço pedido difere do `preco_avaliado` gravado
    na Central, o semáforo da criação é recalculado com a tarifa exata daquele preço, reprojetando
    via `projetarItem` do sync (a mesma extração usada pelo `sincronizar-promocoes`) em vez do
    `tarifaEm` isolado (que não tem categoria/dimensão do item). Com preço = avaliado, usa a
    projeção já gravada.
  - **Trava de risco só no aderir:** sair grava `semaforo = null` — sair nunca cria prejuízo, então
    o Reverter (aderir → sair) não pode travar em vermelho.
  - **Claim antes de escrever:** status `enviando` via `operacoes_massa_reivindicar` antes de
    qualquer POST/DELETE no ML; item `enviando` parado > 2 min (worker morreu no meio) volta ao
    laço e é redecidido pela leitura fresca da campanha.
  - **Saída não confirmada em 24 h vira `erro`** ("O ML ainda não confirmou a saída. Confira no
    Seller Center."), não `saida_solicitada` — senão o índice anti-duplicidade travaria o anúncio
    para sempre, sem nenhum caminho para tentar de novo.
  - **Conferência da saída:** intervalo crescente 5, 10, 20, 40 min, depois 60 min, até 24 h desde
    o DELETE aceito (`saida_pedida_em`). DEAL confirmada volta a `candidate` em `ml_promocao_itens`;
    SMART confirmada **apaga** a linha (o item some da campanha).
- **Telas:** seleção → painel de preview → Executar dentro do detalhe da campanha
  (`PromocaoDetalhe.tsx`, componentes `barra-selecao.tsx`/`preview-operacao.tsx`); acompanhamento
  numa aba **Operações** dentro de Promoções (`Promocoes.tsx`, `lista-operacoes.tsx`), com Reverter.
  Revisão avisa quando a família tem anúncio participando de promoção, sem bloquear (`Revisao.tsx`).
  Permissão de Executar/Reverter: `isAdmin || suporte.scope === 'full'` (`usePodeExecutarOperacao`).

## Emenda 2026-10-04 — 2º tipo: pausar/reativar em massa

**Status da emenda:** em produção desde 2026-10-04 (migration `20261004165122_operacoes_massa_status`, edge `operacoes-massa` v9). Validação em campo na DSA: lote de 3 anúncios pausado e revertido (Reverter) pelo app, relacionados de catálogo acompanharam, seleção mista mostrou "Pausar 1 · Reativar 1".

Discovery com o Diego (2026-10-04): a Avil repete em lote reajuste de preço, pausar/reativar e estoque.
Ordem decidida: **pausar/reativar primeiro**, depois preço, depois estoque — cada um com spec própria.
Design: `docs/superpowers/specs/2026-10-04-pausar-reativar-em-massa-design.md`.

1. **Motor generalizado, não duplicado:** um laço de execução, um handler por `acao`. O handler de
   promoção fica intacto (a suíte atual é a prova de não-regressão). `acao` ganha `pausar|reativar`;
   `promocao_id`/`promocao_tipo` viram nullable com check de coerência por ação, e um índice
   anti-duplicidade próprio `(org_id, ml_item_id)` cobre as operações sem promoção (NULL não colide no índice atual).
2. **Escrita reaproveita o ADR-0060:** `conn.atualizarStatus` (propaga ao catálogo relacionado),
   com GET fresco antes e as mesmas travas da pausa individual (moderado/encerrado e migração PxV,
   ADR-0161 → `bloqueado`). Kits ficam fora (status em kit não testado).
3. **ADR-0111 mantido:** pausa em lote não resiste à reativação por reposição de estoque; o preview avisa.
4. **Seleção na tela Publicados** (filtros existentes, "todos do filtro"); acompanhamento numa **tela global
   de Operações** (`/operacoes`, sem gate de módulo) — cumpre a decisão 7 agora que existe o 2º tipo. A aba
   Operações em Promoções continua como a mesma lista filtrada.
5. Permissão, Reverter (operação inversa só sobre `aplicado`, com preview) e teto por mensagem
   (`maxItens: 100`) seguem as regras acima.

## Emenda 2026-10-05 — aba "Em promoção" e par normal/catálogo em uma linha

**Status da emenda:** em produção desde 2026-10-05 (main `f99e1e42`; migration `20261005113104_promocao_itens_anuncio_normal`; `sincronizar-promocoes` v19, `operacoes-massa` v13).

Achado em produção (Hairfly, DEAL `P-MLB18061082`): o produto `00000009` aparecia 2× na campanha —
`MLB5322348511` (normal) e `MLB7736509406` (catálogo), mesmo `user_product_id` (`MLBU5371930296`), ligados
por `item_relations` sem `variation_id`. O ML convida os dois, mas só aceita a promoção pelo de catálogo
(spike acima; `decidir.ts` bloqueia o normal).

1. **Uma linha por par, com a cara do normal.** O sync (`sincronizarPromocao`) resolve o par na gravação:
   quando o de catálogo e o normal relacionado estão na mesma campanha, grava **só a linha do catálogo**
   (chave e operações continuam no id que o ML aceita) com título/foto/link do normal e
   `ml_promocao_itens.anuncio_normal_id` = MLB do normal. A linha do normal não é gravada.
   Contagem do card, validação e motor seguem iguais, porque continuam vendo uma linha só, a do catálogo.
2. **Exceções que mantêm as duas linhas:** normal já participando (inscrição antiga via API, invisível no
   Seller Center — precisa continuar visível para sair); relação com `variation_id` (Legacy com variações:
   o catálogo cobre uma variação só); relacionado que o multiget não devolveu (na dúvida, não esconde).
3. **Tela:** o MLB exibido é `anuncio_normal_id ?? ml_item_id`, com a indicação "promoção via catálogo
   MLB…" quando difere.
4. **Aba "Em promoção"** em Promoções (`?aba=participando`): todos os anúncios `started`/`pending` das
   campanhas ativas/futuras, agrupados por campanha. DEAL/SMART têm seleção e "Sair" por campanha, que abre
   o mesmo preview/motor (uma operação por campanha); demais tipos ficam só leitura com link para o
   Seller Center. Cupons e campanhas encerradas ficam fora.
5. **Quem lê pelo MLB do normal acha a linha do catálogo:** dossiê do SKU e aviso da Revisão consultam
   `ml_item_id` **ou** `anuncio_normal_id`; o preview da operação mostra o MLB do normal e envia o do catálogo.

**Revisão do plano (Codex gpt-6.1-sol, REVISE → corrigido):** simetria garantida por predicado 1↔1 avaliado
dos dois lados (relação unilateral ou múltipla não junta nada); normal escondido é apagado explicitamente
(`removerItens`), porque uma tentativa anterior da mesma rodada pode tê-lo gravado com o mesmo `sincronizado_em`.

**Limites aceitos (o sync seguinte, a cada 6 h — 1×/dia desde a emenda ADR-0170 de 2026-11-03 —, corrige):** o normal que passa a participar entre duas
mensagens da mesma rodada some até a próxima leitura; depois de sair com o normal participando, as duas linhas
ficam até o próximo sync. Os dois casos exigem inscrição pelo normal, que o motor bloqueia.
**Follow-ups fora do escopo (já existiam):** o espelho do motor só atualiza `status` (preço/contagem ficam do
sync anterior); o Reverter pode montar o preview com cache velho da Central logo após a operação.

## Emenda 2026-10-07 — Operações vira aba de Publicados (sai do menu)

A tela global `/operacoes` (emenda 2026-10-04, item 4) confundia: um item de menu vazio que só faz sentido
depois de selecionar anúncios em outra tela. Cada origem passa a ter a sua aba, no padrão que Promoções já usava:

- **Publicados › Operações** (`/publicados?aba=operacoes`): pausar, reativar e reajuste de preço
  (`useOperacoes('publicados')` filtra `acao in (pausar, reativar, reajustar)` no servidor).
- **Promoções › Operações**: aderir/sair, sem mudança.
- O item "Operações" sai do menu lateral; `/operacoes` redireciona para `/publicados?aba=operacoes` (links e
  favoritos antigos). Permissão inalterada (menu `publicados`). `Operacoes.tsx` removido. Só front.

## Emenda 2026-11-02 — 3º tipo de promoção: Relâmpago (LIGHTNING)

Diego não conseguia aderir à Relâmpago pelo app (só DEAL/SMART). Spike de escrita autorizado (Avil,
`MLB5244990621`, `LGH-MLB1000`): `POST {promotion_id, promotion_type:'LIGHTNING', deal_price, stock}` → 201 com
`offer_id`; o item fica `pending` com janela atribuída pelo ML (12 h no spike) e as duas visões refletem na hora;
`DELETE ?promotion_type=LIGHTNING&promotion_id&offer_id` → 200 vazio e volta a `candidate` em ≤ 5 min (padrão
SMART). Desenho completo: `docs/superpowers/specs/2026-11-02-relampago-aderir-design.md`.

1. **Preço do pedido, faixa fechada:** min = maior entre visão da campanha e visão por item; max e sugerido só
   existem na visão por item. Faixa ausente → recusa/erro, nunca POST.
2. **Piso R$ 19,00** (regra do Diego: abaixo disso o comprador perde o frete grátis) — vale mesmo com risco
   confirmado. Só Relâmpago.
3. **Estoque = `stock.min`** da leitura fresca; ausente ou divergente → erro; disponível menor → bloqueado.
4. **Conferência da saída** só confirma com `candidate` na visão da campanha (leitura ausente reagenda); o espelho
   volta a `candidate` (como DEAL).
5. **Janela** (`start_date`–`finish_date`) vai na mensagem do item aplicado; sem coluna nova.
6. **Central:** convidado Relâmpago descarta o `price` do convite (não é o sugerido nem o atual) e usa faixa e
   sugerido da visão por item; falha da leitura degrada só a linha (sem faixa → indisponível).
7. Constraint `operacoes_massa_promocao_tipo_check` passa a aceitar `'LIGHTNING'`.

## Emenda 2026-11-03 — busca e mesmo preço/desconto para um produto e suas variações

Pedido do Diego: no detalhe da campanha, achar um produto e aplicar **o mesmo desconto (%) ou o mesmo preço (R$)** a
todas as variações dele (cada cor costuma ser um MLB próprio), vendo o lucro líquido antes de aderir. Plano:
`docs/superpowers/plans/2026-11-03-promo-busca-simular-desconto.md` (revisado pelo Codex: 5 achados absorvidos).

1. **Busca** no front: todas as palavras no título, MLB (inclusive o normal do par de catálogo) ou SKU; "Selecionar
   todos" marca só o resultado.
2. **Simulação** só DEAL/Relâmpago, aba Convidados: desconto sobre `preco_original` (centavos arredondados) ou preço
   fixo. O líquido vem **sempre do servidor** — `operacoes-massa` `etapa: 'simular'` (qualquer membro, só leitura,
   ≤ 50 anúncios por chamada) reprojeta cada anúncio no preço pedido pelo mesmo caminho da trava
   (`criarProjecaoExata`, de onde `criarSemaforoExato` passa a derivar). Calcular no front com a tarifa gravada
   erraria em silêncio quando comissão fixa/frete mudam de faixa.
3. Item sem faixa do ML, fora da Central ou não convidado → "não simulado" com motivo; fora da faixa / < R$ 19
   (Relâmpago) → aviso na linha (o preview bloqueia como antes).
4. **Aderir** com simulação ativa: o preview usa o preço simulado antes de calcular semáforo/marcação; selecionado
   não simulado vem desmarcado. O backend revalida na criação, como sempre.
5. Resposta de simulação que chega depois de limpar/trocar aba/campanha é descartada (geração por chamada).
6. **Espelho financeiro após aderir** (incidente Zaven 03/11: jaquetas aplicadas a R$ 49,90 apareciam a R$ 63,72 e a
   campanha com "0 participando" até o sync seguinte): DEAL/Relâmpago gravam `preco_promo` e, com a projeção exata no
   preço aplicado, `preco_avaliado`/`projecao`/`pior_semaforo`; ao fim da execução/conferência a contagem da campanha
   é recalculada (`contar` do sync). SMART não espelha preço (o preço é do ML). Com rodada do sync reservada nada disso
   escreve (o sync grava o estado real); o retry `ja_estava` não espelha preço (a leitura do ML não traz o da oferta).

## Emenda 2026-11-03 (2) — 4º tipo: alterar o preço de quem já participa (DEAL)

Pedido do Diego: mudar o desconto de anúncios que já estão na campanha, em massa e com busca, sem sair. Spike
autorizado (Zaven `MLB5441057075`, `P-MLB17909028`): `PUT /seller-promotions/items/{id}?app_version=v2`
`{promotion_id, promotion_type:'DEAL', deal_price}` → 200, continua `started`, preço novo nas duas visões em ≤15 s.
Plano: `docs/superpowers/plans/2026-11-03-promo-alterar-preco.md` (Codex: 3×P1 + 2×P2 absorvidos).

1. Ação `alterar_preco` (migration `20261103151129`: checks de ação + barreiras `operacoes_massa_reivindicar` /
   `reajuste_reivindicar` com o reajuste). **Só DEAL** — Relâmpago exige sair e reaplicar; SMART = preço do ML.
2. Validação: item participando, preço em centavos > 0 e < `preco_original`; participante não tem faixa (o ML
   valida); trava financeira igual à adesão.
3. Executor: `etapa='escrita_pedida'` + `preco_anterior` lido no ML **antes** do PUT (retry não sobrescreve); PUT
   incerto é conferido relendo o ML; retry com etapa e preço igual = `aplicado` (escrita recuperada). Espelho grava o
   preço e o líquido exato (ou líquido indisponível, nunca o velho).
4. Reverter = outra `alterar_preco` de volta ao `preco_anterior`, validada no servidor contra os itens `aplicado` da
   origem; preço vivo diferente do que a origem deixou → `mudou` (não sobrescreve alteração posterior).
5. Telas: "Alterar preço N" na aba Em promoção (com busca) e na aba Participando da campanha (com a simulação
   Desconto %/Preço R$); o painel calcula recebe·lucro·margem no servidor ao abrir e ao aplicar.

## Emenda 2026-11-03 — SMART_LIGHTNING e PRICE_MATCHING + aviso de tipo novo

Diego quer ativar pelo app toda campanha que o ML trouxer. Campanha nova de tipo conhecido já funciona sozinha; o que
exige código é **tipo** novo, porque cada tipo tem contrato próprio. Spike autorizado e desfeito em 03/11 (Avil
`MLB5048402257`, DSA `MLB5114275523`): `POST {promotion_id, promotion_type, offer_id: CANDIDATE-…}` → 201 nos dois
(SMART_LIGHTNING também com `stock`); SMART_LIGHTNING agenda janela de 12 h, PRICE_MATCHING entra `started` **na
hora**. As visões seguem `candidate` por ~2 min após o POST. `DELETE ?promotion_type&promotion_id&offer_id=OFFER-…`
→ 200 vazio e volta a `candidate` em ≤ 5 min, mesmo já `started`. Plano:
`docs/superpowers/plans/2026-11-03-promo-smart-lightning-price-matching.md`.

1. **Oferta de preço fixo:** o preço é o do ML, sem edição. O preview envia o preço exibido; criação e execução o
   comparam com a Central e com a leitura fresca (mudou → não escreve).
2. **Piso R$ 19** também nestes dois tipos, independente de risco confirmado.
3. **Estoque** (SMART_LIGHTNING) = `stock.min`; ausente → erro; disponível menor → bloqueado.
4. **Idempotência:** por causa do atraso de ~2 min, `candidate` não prova nada logo após escrever. `etapa` gravada
   antes do POST/DELETE, com aquisição atômica (`status='enviando' AND etapa IS NULL`); retomada nunca repete a
   escrita e escrita incerta não derruba a mensagem do QStash. Sem evidência anterior, sair com `candidate` vira
   `mudou`. Nova adesão ao mesmo anúncio fica barrada por 30 min (`JANELA_PROPAGACAO_MS`). Teto conhecido: passados
   30 min, `candidate` vale como verdade. Trava sem expiração descartada: o ML devolve o mesmo `CANDIDATE` após a
   saída, então não há evidência de saída feita no Seller Center e o anúncio ficaria bloqueado para sempre.
5. **Aviso de tipo novo:** categoria `integracao` por org com `opcoes.chave`, fora de `alertas_promocoes_ativo`
   (desligado em todas as orgs) e sem reserva prévia (reserva sem entrega calaria o aviso para sempre).
6. Constraint `operacoes_massa_promocao_tipo_check` aceita os dois tipos.

## Emenda 2026-11-07 — piso de R$ 19 em todos os tipos de campanha

A aba Sugestões oferecia a 11.11 (DEAL) a R$ 16,53 para produto de R$ 19,00: o piso valia só para Relâmpago e
ofertas fixas. A razão do piso (abaixo de R$ 19 o frete é do comprador e pode custar mais que o produto) vale para
qualquer campanha. Medido em 07/11 na org `a72ea303`: 373 de 905 convidados DEAL abaixo de R$ 19, 358 deles com
preço original até R$ 19. Substitui o "Só Relâmpago" da emenda de 2026-11-02.

1. **Desconto menor antes de esconder (pedido do Diego, 07/11):** sugerido abaixo de R$ 19 com faixa do ML que alcança
   R$ 19 fica, avaliado em R$ 19 (ou no mínimo da faixa, se maior): `precoAvaliado` já projeta líquido e semáforo nesse
   preço, e o painel abre nele. Vale para DEAL e Relâmpago; oferta de preço fixo não tem faixa.
2. **Some da tela:** convidado que ainda fica abaixo de R$ 19 sai de Sugestões, da aba Convidados e da contagem da
   campanha, em qualquer tipo. Sem preço avaliado fica (falta de dado não esconde).
3. **Participante fica visível**, mesmo abaixo de R$ 19, para poder sair.
4. **Trava no servidor:** aderir (DEAL, SMART) abaixo de R$ 19 é recusado na criação e na execução, mesmo com risco
   confirmado. `alterar_preco` é recusado só na criação: a execução pode estar retomando um PUT já enviado, e
   bloquear ali esconderia uma escrita incerta. Sair segue livre.
5. **Reverter passa pela mesma trava:** voltar a preço abaixo de R$ 19 é recusado; o operador escolhe preço ≥ R$ 19
   ou sai da campanha.

## Emenda 2026-11-08 — teto crível da Relâmpago

Corrige a decisão 6 da emenda de 2026-11-02. Na LGH-MLB1000 a adesão do Creme Melancia (52,66 e 51,95) e do
Defrizante (37,74 e 37,90) voltou `400 ERROR_CREDIBILITY_DISCOUNTED_PRICE`. Os dois têm `PRICE_DISCOUNT` próprio
ativo (52,90 e 33,90); o `max_discounted_price` da visão por item (90% do base) e o sugerido ignoram esse desconto.
Lido em 4 convidados: o `price` do convite é 97% do preço próprio do anúncio (base, ou o `PRICE_DISCOUNT` quando
existe; DEAL ativo não conta) — 51,31 e 32,88 nos dois recusados.

1. **Teto = menor entre `max_discounted_price` e o `price` do convite**, no sync (Central, Simular) e na execução.
   Sem desconto próprio o convite fica acima do máximo e nada muda.
2. **Sugerido limitado ao teto.** O `price` continua fora da tela como preço (não é o sugerido nem o atual).
6. **"Até quanto" para no piso:** o sync calcula na faixa real e limita o resultado a R$ 19, para o botão não sugerir
   preço recusado. SMART sem preço da oferta não adere: sem ele o piso não é conferido.
7. **Fora do escopo:** anúncios que já participam abaixo de R$ 19 não saem sozinhos, e o reajuste em massa
   (ADR-0178) não passa por esta validação.
8. **Implantação:** `preco_avaliado`, projeção e `ml_promocoes.contagem` são gravados, então só mudam quando o sync
   roda. Depois do deploy, disparar `sincronizar-promocoes` em vez de esperar o cron diário.

## Consequências

- O motor nasce com os requisitos reais de uma operação (promoção); o segundo tipo testa se ele é genérico de
  fato — não antes.
- A Black Friday passa a ser o primeiro uso previsto; a 10.10 continua manual.
- Se o spike mostrar que a escrita exige re-autorização, toda org que quiser aderir pelo app precisa reconectar
  a conta ML — vira passo de onboarding do módulo.

## Emenda 2026-11-08 (2) — Relâmpago: convite de outro horário em anúncio que já participa

A Relâmpago aceita mais de uma oferta por anúncio, uma por horário. Lido em 08/11 na LGH-MLB1000: o MLB5322348511
volta, na visão da campanha (com e sem `item_id=`) e na visão por item, como `OFFER-…` `pending` (12/11 00:00–11:59)
**e** `CANDIDATE-…` aberto; o MLB5322353319 tem dois `pending` (10/11 e 12/11) e nenhum convite. O sync ficava com a
oferta participando e o convite sumia da aba Convidados; a execução, lendo o participando, respondia "Já estava".

1. **A linha segue participando** (`started`/`pending`, preço da oferta em `preco_promo`). Trava de oferta no UPDATE e
   no reajuste, contagem, alertas de prejuízo, Resumo, aviso da Revisão, Sugestões e Reverter continuam vendo a
   participação. Revisão do plano (Gemini, Codex sem cota): a primeira versão, que virava a linha em `candidate`,
   tirava o anúncio de todos esses consumidores.
2. **Sync (só LIGHTNING):** participando + convite → `convite_aberto = true`, e `preco_min/max/sugerido` e
   `estoque_min` passam a ser os do convite (com o teto crível da emenda anterior) e entram no "Até quanto descer".
3. **Tela:** a linha aparece nas duas abas. Em Convidados, "Já participa em outro horário" e a seleção conta como
   aderir; em Participando, "Convite aberto para outro horário" e a seleção conta como sair. O mesmo clique nunca
   oferece os dois. O semáforo da linha é o do preço participando; o painel de aderir recalcula no preço escolhido.
4. **Validação:** aderir aceita linha participando com `convite_aberto` (só LIGHTNING).
5. **Execução (aderir LIGHTNING):** a leitura fresca traz o convite junto da oferta participando (`convite`). Com
   convite, a decisão segue o caminho de convidado (faixa, teto, piso, estoque); sem convite, "Já estava". A visão
   por item prefere a entrada `candidate`; depois do POST, a janela é a da oferta criada (`ref_id`). Sair não muda.
6. **Idempotência:** antes do POST o item grava o `CANDIDATE-…` que vai usar. Numa retomada, só posta de novo pelo
   mesmo convite; convite diferente (outro horário aberto depois) encerra como "Já estava" — nunca adere a um horário
   que o operador não viu.
7. **Espelho:** aderir ou sair limpa `convite_aberto`; o próximo sync refaz a marca se o ML abrir outro horário.
8. **Fora do escopo** (já existiam): falha de rede no POST da Relâmpago vira erro sem retomada; sair de um de dois
   horários participando não é confirmado pela conferência.
9. Migration aditiva: `ml_promocao_itens.convite_aberto boolean not null default false`.

## Emenda 2026-11-12 — adesão sem prova do ML espelha `pending` ("aguardando o ML")

Black Friday 2026 (P-MLB17911004, Avil): 10 adesões DEAL feitas com a campanha já `started` receberam 200 no POST, mas
o ML seguiu devolvendo `candidate` por mais de 90 min. O espelho caía no status da campanha (`started`) e a Central
mostrava os 10 como "participando" sem o ML ter ativado (76 participando no app × 67 no ML). Na "11.11 da Black" as
adesões pós-início apareceram `started` no sync do dia seguinte: é atraso do ML, não descarte.

1. **Espelho depois de aderir:** o status lido no ML; ainda `candidate` ou releitura falha → o do tipo (ofertas fixas,
   como antes); **DEAL → `pending`**, nunca `started` sem prova; SMART e Relâmpago seguem o status da promoção (no
   SMART o ML vira `started` em segundos — revisão Grok). O item da operação segue `aplicado` (o ML aceitou).
2. **Rótulo (só DEAL):** item `pending` em campanha `started` = "Aguardando o ML ativar" (detalhe) / "aguardando o
   ML" (Em promoção); em campanha futura segue "começa depois". Vale também para os `pending` reais do ML em campanha
   ativa. Relâmpago/SMART_LIGHTNING `pending` em campanha ativa é o horário agendado: segue "começa depois".
3. O sync seguinte grava o estado real do ML (pode voltar a convidado enquanto o ML não ativa).

## Alternativas descartadas

- **V2 unitária antes, I5 depois:** retrabalho e inútil para 504 convidados.
- **I5 com preço/pausa primeiro:** sem discovery é aposta, e empurra promoções para depois da Black Friday.
- **Undo automático com janela:** escreve no ML sem nova confirmação (fere a regra de revisão humana).
- **Bloquear 🔴:** tira do app a queima de estoque intencional; confirmação explícita cobre o risco.
- **v1 mínimo para a 10.10:** estreia de escrita em massa numa campanha grande com prazo de 16 dias.
