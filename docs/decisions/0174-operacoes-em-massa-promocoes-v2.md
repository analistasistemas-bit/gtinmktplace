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

## Consequências

- O motor nasce com os requisitos reais de uma operação (promoção); o segundo tipo testa se ele é genérico de
  fato — não antes.
- A Black Friday passa a ser o primeiro uso previsto; a 10.10 continua manual.
- Se o spike mostrar que a escrita exige re-autorização, toda org que quiser aderir pelo app precisa reconectar
  a conta ML — vira passo de onboarding do módulo.

## Alternativas descartadas

- **V2 unitária antes, I5 depois:** retrabalho e inútil para 504 convidados.
- **I5 com preço/pausa primeiro:** sem discovery é aposta, e empurra promoções para depois da Black Friday.
- **Undo automático com janela:** escreve no ML sem nova confirmação (fere a regra de revisão humana).
- **Bloquear 🔴:** tira do app a queima de estoque intencional; confirmação explícita cobre o risco.
- **v1 mínimo para a 10.10:** estreia de escrita em massa numa campanha grande com prazo de 16 dias.
