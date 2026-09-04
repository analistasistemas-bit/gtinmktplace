---
tags: [modulo, estoque]
atualizado: 2026-09-03
---

# Estoque

Rota `/estoque`. Estoque único cross-canal: o saldo do PubliAI é a fonte da verdade e é
empurrado para todos os canais publicados. Em produção desde 2026-07-29 (ADR-0094).
Ver [[Produtos]], [[Publicação Mercado Livre]], [[Banco de Dados]], [[Edge Functions]],
[[Índice de ADRs]].

**Módulo pago, ligado por org.** `organizations.modulos_habilitados` nasce **vazio** — nenhuma
org enxerga o menu até o super-admin ligar em `/admin` (action `set_modulos_org` da edge
`usuarios`). As edges do módulo repetem o gate e respondem **403**.

## Ledger `estoque_movimentos`

Imutável e idempotente (migration `20260729084329_e6b_estoque_movimentos.sql`), com idempotência
por `(org_id, referencia_externa)`. Nada escreve `variacoes.estoque` direto: o trigger
`variacoes_bloquear_escrita_direta_estoque` só libera o `UPDATE` para o `current_user` =
`estoque_rpc_executor`. Toda mutação passa por RPC `security definer`, executável só por
`service_role`.

| Motivo | RPC | Origem |
|---|---|---|
| `venda` | `baixar_estoque` | venda paga (`pedido.status === 'paid'`) no `sync-venda` |
| `estorno_venda` | `estornar_estoque` | cancelamento pré-despacho (D-7) |
| `entrada` | `registrar_entrada` | entrada de mercadoria / cadastro manual |
| `ajuste` | `ajustar_estoque` | ajuste ou zeragem pelo admin (ADR-0110) |
| `venda_sku_nao_encontrado` | — | trilha informativa: venda paga sem SKU resolvido (`quantidade = 0`) |

Devolução **não** é tocada pelo ledger.

## Push para os canais

O push é **absoluto** (nunca delta), enfileirado na fila serial `estoque-{orgId}` para todos os
canais publicados **exceto o de origem** do movimento. Worker `sincronizar-estoque`
(`verify_jwt=false`).

Rede de segurança: `reconciliar-estoque` (schedule QStash `30 12 * * *`) re-empurra todo produto
com movimento nas últimas 24h. Ela re-empurra com `canal_origem: null`, então **editar estoque
direto no Mercado Livre é revertido em até 24h** — ver a regra operacional abaixo.

> **`DELIVERED 200` no QStash não prova que o canal foi atualizado.** `sincronizar-estoque`
> devolve 200 mesmo em falha definitiva do push (loga `estoque_push_definitivo` e segue). Para
> conferir de verdade, ler o estoque vivo (tela Publicados / `lerStatus`).

Anúncio **moderado** (`sub_status = forbidden`) recusa o push com 400 ("republique o produto"):
o ajuste local é aplicado do mesmo jeito e o canal fica para trás até a republicação.

## Ajuste e zeragem (ADR-0110)

Edge `ajustar-estoque`, diálogo por produto e variação na tela `/estoque`.

1. **Só reduz ou zera.** `novo_saldo > saldo_atual` é rejeitado — aumentar continua sendo Entrada
   de mercadoria, que exige custo válido e alimenta `variacoes.custo` (insumo de markup e preço,
   ADR-0055). Ajuste livre para cima seria entrada sem custo e sem documento, e mascararia um
   webhook de venda perdido.
2. **É admin**, por paridade com pausar/reativar anúncio (ADR-0060): zerar uma cor tira o produto
   de venda.
3. **Estorno repõe por cima do zero.** Pedido cancelado depois da zeragem **repõe** o saldo e pode
   fazer a cor voltar a vender — cancelamento significa mercadoria que voltou fisicamente. Quem
   quer tirar de venda de vez usa **Pausar**.

Ajuste com `quantidade = 0` (conferência que não mudou nada) é trilha deliberada e não afeta somas.

## Reposição reativa o anúncio pausado (ADR-0111)

O ML desfaz sozinho só a pausa que **ele mesmo** aplicou por falta de estoque; pausa do vendedor
fica de pé mesmo com o saldo já no canal. Desde 2026-08-11, um push de **reposição** com saldo > 0
lê o status ao vivo depois do push e devolve `pausado` → `ativo`.

- A intenção vem do **sinal da quantidade** no ledger: entrada e estorno reativam; venda e ajuste
  não. `ajustar-estoque` nunca reativa por construção (só reduz).
- **A reconciliação diária não reativa** — senão um anúncio pausado à mão voltaria ao ar sem
  ninguém ter reposto nada.
- **Só sai de `pausado`.** `moderado`, `encerrado`, `inativo` e `indisponivel` são intocados —
  forçar `active` num anúncio moderado é o tipo de escrita que já custou um anúncio cancelado
  (incidente 2026-08-06, ver [[Incidentes]]).
- Idempotente por leitura: anúncio já ativo não recebe PUT.

## Alerta de estoque zerado e de volta ao ar (ADR-0134)

Desde 25/08/2026 o `sincronizar-estoque` avisa, na categoria de notificação **`estoque`**
(Telegram + in-app), quando o saldo chega a zero e quando a reposição devolve o anúncio ao ar.

- **Gatilho por variação:** cada transição `>0 → 0` em `estoque_movimentos` gera aviso. Se **todas**
  as variações do produto estão em zero, a mensagem diz "anúncio pausado no Mercado Livre"; se
  restam outras, diz que o anúncio segue no ar sem aquela.
- **Depois do push, nunca antes:** com alvo retentável o aviso espera a retentativa — dizer que o
  anúncio foi pausado antes de o canal receber o zero seria mentira.
- **Dedup na linha do movimento** (`alertado_em`, marcado com `UPDATE … WHERE alertado_em IS NULL`):
  o push é idempotente e o QStash reentrega de propósito.
- **Produto sem anúncio publicado:** movimentos marcados, nada enviado — senão publicar um produto
  velho despejaria toda a história de zeradas de uma vez (o erro que o alerta de cancelamento
  cometeu no primeiro run, ver [[Incidentes]]).
- **Volta ao ar:** sai quando a reativação do ADR-0111 de fato acontece (leu `pausado` + PUT ok), o
  que é a própria dedup.
- Migration de estreia fechou os 1.479 movimentos históricos como já alertados.

## Cadastro manual e entrada de mercadoria

Bloco B do E6b (ADR-0094): produto entra **sem planilha**. Edges `cadastrar-produto` e
`entrada-estoque` (`verify_jwt=true`). "Sessão de cadastro = um lote": `lotes.origem = 'manual'`
(chip Planilha/Cadastro manual no LoteCard) — `lote_id` é `NOT NULL` e sustenta `process-familia`,
`finalizarLote` e a unique `(lote_id, codigo_pai)`.

**Entrada em várias cores de uma vez (2026-09-03).** O diálogo tem dois modos, escolhidos pela
porta de entrada e não pela contagem de SKUs: aberto pelo **card do produto** lista as cores dele
(RPC por produto) com uma quantidade por cor, como o Ajuste; aberto pelo **botão do topo** segue
buscando um SKU na org. Quantidade em branco é "não mexi nesta cor", nunca zero; custo e documento
valem para as cores preenchidas, e custo em branco **preserva** o custo atual de cada uma
(`registrar_entrada` faz `custo = coalesce(p_custo, custo)`). A edge ganhou o formato
`itens: [...]` com referência de idempotência por SKU, erro por item e um push por produto.
Motivo: o picker vinha de `skus_estoque_org`, truncada em ~1000 linhas pelo PostgREST — com 8.491
SKUs na org, um produto "do meio" da lista simplesmente não aparecia ("Nenhum SKU encontrado").
Essa limitação **continua valendo para o botão do topo**; nenhum caminho do card depende mais dela.

## Adicionar variação a produto publicado (ADR-0129)

Menu `⋮` do card → **Adicionar variação** (admin-only, mesmo gate do Ajuste/ADR-0110). Diferente
do cadastro manual acima (que cria família **nova**), esta ação estende uma família **já
publicada**: clona a família mais recente + variações vivas do banco para um **lote dedicado** de
UPDATE, insere N cores novas digitadas no formulário (foto obrigatória, CODIGO único por org,
campos físicos **e** custo/preço mínimo pré-preenchidos de uma irmã existente, editável desde
2026-08-21), registra o estoque inicial pelo ledger e
encadeia `publicar-familias` diretamente — **não** `enfileirarFamilias`/Revisão, porque o dado é
100% digitado pelo admin, não saída de IA (`process-familia` pra UPDATE só resolve cor e para em
`pronto`, o que deixaria o lote preso esperando clique manual).

Reaproveita **100%** o pipeline de UPDATE existente (ADR-0016/0104) — nenhuma integração nova com
o Mercado Livre, cor nova nasce em opt-out publicável (foto + estoque > 0), e o worker decide
sozinho entre payload Legacy e User Products. Bloqueia (409) se já existe lote não-terminal para a
família — dois UPDATEs da mesma família em voo é o race condition que o ADR-0104 já trata como
risco de composição. Edge `adicionar-variacoes-familia`.

**Só a cor nova vai ao ML (2026-09-03).** As cores já publicadas entram no PUT apenas para o ML
não apagá-las (o PUT de `variations` deleta as omitidas), com o estoque que já está lá — sem COLOR,
sem preço, sem foto; a cor nova adota o preço vivo do anúncio. O worker deriva isso do lote
(`origem='manual'`, `_shared/update/fluxo-add-variacao.ts`), o mesmo predicado do sino D-11 —
derivar do lote e não de um flag no job é o que faz a regra sobreviver ao "Reenviar" da Revisão.
Motivo: o ML **normaliza o nome da cor** pelo dicionário de COLOR ("Rosa Claro" → "Rosa-claro",
"Amarelo Canário" → "Amarelo Canario") e a comparação estrita do `montarVariacoesUpdate` lia a
normalização como renomeio ([ADR-0062](../../docs/decisions/0062-update-cor-existente-e-fotos-comuns.md)); em variação com
venda o ML derruba o PUT INTEIRO com `You cannot change attribute combinations if the variation
has bids` — estoque incluído. Update por planilha continua com o comportamento antigo.

**O push de estoque da cor nova cobre só ela (2026-09-03).** A entrada de estoque que nasce com a
cor recém-adicionada enfileira `sincronizar-estoque` com `skus: [SKU novo]`; as demais cores nem
entram no payload e mantêm no anúncio o `available_quantity` que já está lá. Antes, um movimento
em UM SKU empurrava o saldo do app para TODOS os SKUs ancorados no anúncio: no `MLB7157545794` isso
zerou Vermelho, Champagne e Marfim, cujo estoque tinha sido lançado direto no ML — e **variação com
estoque 0 some da vitrine**, então parecia que as cores tinham sido removidas. Fora desse fluxo o
push segue cobrindo o produto inteiro: o app é dono do estoque (ADR-0094) e o que for lançado só no
ML continua sendo sobrescrito.

**Card em erro tem botão "Revisar" (2026-09-03).** Quando a última atualização do produto falhou,
o card mostra "Erro na última atualização" e, ao lado, um link para `/revisao/:loteId` do lote
daquele UPDATE — antes o operador via o erro sem nenhum caminho até a tela que corrige e reenvia.
Rótulo só a partir de `md` (mesma medida de 375px que motivou o menu `⋮`).

**Migration exigida (o ADR não previa nenhuma):** o guard de `validar_variacao_no_tenant` exigia
estoque zero no INSERT em lote manual — sem restringi-lo a `familias.operacao='CREATE'`, clonar o
estoque vivo das irmãs teria **zerado o saldo no ML**. Migration `20260820143736`.

## Exclusão de produto (ADR-0113)

Menu `⋮` na linha do produto → **Excluir produto**. Edge `excluir-produto` (`verify_jwt=true`),
admin-only como o ajuste, body `{ codigo_pai }`. O menu só é renderizado a partir de `md`: medido
em 375px, um terceiro botão na coluna de ações derrubava o texto do nome do produto de 81px para
49px ("Crem…").

**Só alcança produto não publicado em canal nenhum.** Apagar família com `ml_item_id` cortaria o
vínculo de UPDATE do `ingest-lote` e a próxima planilha do mesmo código viraria **anúncio
duplicado** no ML — a restrição do [[Exclusão de lote|ADR-0019]]. Publicado sai por
`remover-publicado` (tela Publicados → Remover), que pausa no ML antes.

A trava olha **todas** as famílias do `codigo_pai`, não a linha que a tela mostra: a lista exibe só
a mais recente, e uma irmã publicada é invisível ali. Pela mesma razão o delete leva todas — deixar
irmã viva faria o produto reaparecer logo após a exclusão.

Saldo em estoque **não** bloqueia (produto de teste nasce com entrada); o freio é digitar o código
no diálogo. O histórico de movimentos vai junto, pela varredura do ADR-0097 — como só alcança
produto nunca publicado, esse histórico é de entrada/ajuste manual, não de venda. O ML nunca é
tocado por esta porta.

## Tela

Redesenhada em 2026-08-02 (PR #56): listagem e cadastro viraram **cards**, sem nenhuma `<table>`
no caminho — `<table>` dentro de `<TableCell>` forçava scroll horizontal estrutural (inclusive em
`/publicados`, que compartilha `MovimentosEstoque`).

- Saldo por produto, entrada, canais publicados e ledger paginado com filtros (tipo, período, SKU).
- Busca acha também GTIN e fornecedor; filtro "não publicado" deriva de `familias.ml_item_id`
  (fonte canônica), não de `anuncios_externos` (espelho que pode ficar furado sem erro).
- **Foto:** produto de planilha nasce sem capa própria (na AVIL, 1 de 147 famílias tem
  `capa_storage_path`), então a tela cai para a foto do anúncio no ML
  (`https://http2.mlstatic.com/D_{ml_picture_id}-V.jpg`), preferindo capa da família → variação
  principal → primeira variação com foto. Sem nenhuma foto, placeholder — é o caso dos 7 produtos
  em aberto ([[Bugs Conhecidos]]).
- **Preço (desde 2026-08-16):** a coluna mostra o preço VIVO do anúncio, lido de
  `status-publicados` (multiget `/items?attributes=...,price`, cobre 100% dos anúncios da org).
  `variacoes.preco` é o preço local da planilha/markup e nenhum job o reconcilia com o canal —
  mostrava R$ 28,99 num SKU anunciado a R$ 39,90. Quando os dois divergem, o local aparece como
  nota (`local R$ 28,99`) porque é ele que alimenta markup e o próximo push (ADR-0055); a tela
  **não** o sobrescreve. O casamento SKU → anúncio é `variacoes_estoque_produto.ml_item_id`
  (User Products → partição do split → família), senão todas as cores de um produto UP mostrariam
  o preço do mesmo anúncio. `pulse_produtos.meu_preco` não serve de base: só existe onde há ficha
  de catálogo (3 de 7 na DSA, 15 de 133 na Avil — Errata 2 do ADR-0119). Limitação: `/items` devolve o
  preço BASE, sem promoção ativa do vendedor.

## Kit Vinculado — packs de N unidades (ADR-0151)

Extensão do módulo Estoque implementada em 2026-09-03. Permite criar anúncios de kits (packs com 2, 3, 4, 5 ou mais unidades) derivados de um produto existente sem estoque duplicado.

- **Estoque 100% derivado:** O kit não possui saldo próprio em `variacoes.estoque`. Seu saldo disponível é calculado deterministicamente como `floor(estoque_base / multiplicador)`.
- **Colunas em `familias`:** `kit_base_codigo_pai` aponta para o produto base e `kit_multiplicador` armazena o número de unidades por pack.
- **Lote técnico dedicado:** O kit nasce direto em status `'pronto'` num lote técnico com `status='publicando'`, publicando automaticamente no ML após a confirmação do produto base, sem passar pela Revisão manual.
- **Venda e Push:** Baixa de estoque na venda de kit resolve a baixa diretamente na família base multiplicada por N. O push enfileira a atualização da base e de todos os kits derivados.
- **Trava de integridade:** Bloqueio de inserção direta de estoque no SKU do kit; bloqueio de remoção ou inserção de nova cor na base enquanto houver kit vinculado ativo; trava de catálogo fechada e simétrica.
- **Deploy:** 19 Edge Functions deployadas cobrindo o blast radius de `_shared/estoque/*`.

## Entrada de mercadoria em múltiplas cores (2026-09-03)

O `DialogEntrada` foi aprimorado para suportar dois modos de operação:
1. **Pelo card do produto:** Abre com a lista completa de variações daquele produto pai (usando `fetchVariacoesProduto`), permitindo digitar quantidades para múltiplas cores simultaneamente na mesma nota/documento fiscal, contornando o limite de truncamento de 1000 linhas do PostgREST.
2. **Pelo topo da página:** Mantém o picker de SKU individual para buscas pontuais, agora com paginação paralela.
3. **Idempotência por SKU:** Cada entrada gera referência única `entrada:<ref>:<codigo>`.

## Adicionar variação a família publicada (ADR-0129)

Ação disponível no menu do card para administradores:
- Permite adicionar uma nova cor/variação a um produto já publicado no Mercado Livre.
- Cria um lote dedicado de `UPDATE`, copia atributos da família viva e adiciona a nova variação com foto e estoque inicial no ledger.
- Executa a atualização diretamente pelo pipeline de publicação sem passar pela tela de Revisão humana (dados são 100% auditados pelo operador).

## Feedback visual e monitoramento

- **Badge "atualizando no ML…":** Ao dar entrada de mercadoria, o card exibe badge temporária monitorando o status vivo no canal até a confirmação da sincronização de estoque, tornando-se "✓ no ML" e sumindo após alguns segundos.
- **Botão "Revisar" em cards com erro:** Quando um produto apresenta erro de publicação ou catálogo, o card fornece atalho direto para resolver a pendência na tela de Revisão.

## Regra operacional inegociável

**Nunca editar estoque direto no Mercado Livre.** O push é absoluto e a reconciliação diária
restaura o número local em até 24h. Confirmado em produção em 2026-08-11: três anúncios Helanca
Light com o SKU Vermelho zerado no ML voltaram a vender com o saldo antigo (2000/1990/2000).
Para tirar de venda, use **Ajustar/Zerar** (que se propaga a todos os canais) ou **Pausar**.

## Armadilha para a próxima RPC de estoque

Uma RPC nova precisa **pertencer ao role `estoque_rpc_executor`** (senão falha com `42501` na
primeira escrita real), e os `revoke`/`grant` precisam vir **antes** do `alter … owner to`. Fora
dessa ordem, os comandos viram **no-op com WARNING, não erro** — o `supabase db push` não envolve
a migration em transação. Foi assim que `ajustar_estoque` ficou publicada com `EXECUTE` para
`PUBLIC`/`anon`/`authenticated` até a migration `20260811203500` corrigir. Como toda RPC daqui é
`security definer` e recebe `p_org` por parâmetro, esse no-op equivale a expor escrita de estoque
de qualquer organização a qualquer usuário autenticado.
