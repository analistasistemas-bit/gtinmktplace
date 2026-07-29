# ADR-0094: Estoque único, cadastro manual e entrada de mercadoria

**Status:** Aceito
**Data:** 2026-07-29
**Decisores:** Diego

## Contexto

Hoje o estoque só flui em uma direção: PubliAI → Mercado Livre, no momento da publicação
(CREATE/UPDATE). O `sync-venda` grava `ml_vendas`/`ml_vendas_itens` mas **não toca**
`variacoes` — uma venda no ML não baixa o saldo local. Isso é inofensivo enquanto o produto
vive num canal só, mas é exatamente o risco que trava o multicanal: sem baixa cross-canal,
vender no ML não reflete no saldo que seria empurrado para qualquer outro canal publicado,
abrindo oversell. Além disso, produto só entra no sistema por planilha, o que exige que o
cliente tenha um ERP (ou processo equivalente) gerando essa planilha — inviabilizando quem
quer cadastrar produto novo ou dar entrada de mercadoria direto no PubliAI.

## Decisão

A tabela abaixo é cópia **verbatim** da seção 5 (`## 5. Decisões travadas`) da spec
`docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`, incluindo a ordem
das linhas (D-16..D-20 nasceram na revisão adversarial e D-15/D-13/D-14 fecham a tabela
original — a ordem não é numérica).

| # | Decisão | Racional |
|---|---|---|
| **D-1** | **Sessão de cadastro = um lote.** O cadastro manual cria um `lote` normal (marcado como manual) com N famílias e suas variações, e cai na **mesma tela de Revisão de sempre**. | Zero mudança em `process-familia`, nos dois workers de publicação, no realtime, no roteamento e na unique `(lote_id, codigo_pai)`. Nada do caminho que fatura é tocado. A alternativa (`lote_id` nullable) custa 6 frentes, duas delas em código que publica anúncio real. |
| **D-1.1** | **"Sessão" = o lote manual aberto da org.** O cadastro reusa o lote com `origem='manual'` e `status in ('importando','processando','revisao')`; se não houver, cria um novo. Ao anexar família, o lote volta para `status='processando'`. | Verificado: `talvezFinalizarLote` (`publish-familia-ml/processar.ts:44-52`) **não** compara contadores — recalcula do estado vivo (`publicando` → não mexe; senão `pronto` → `revisao`; senão `concluido`). Logo o ciclo se auto-corrige e nenhum worker precisa mudar. A regra evita os dois extremos: um lote por produto (polui a tela de Lotes) e um lote permanente (nunca fecha, e a Revisão vira lista infinita misturando produto novo com produto de 6 meses). Corresponde ao que o operador chama de "meus cadastros ainda não publicados". |
| **D-2** | `lotes.origem text not null default 'planilha'` com check `in ('planilha','manual')`. A tela de Lotes rotula. | 1 linha de migration, sem ambiguidade. Inferir por `planilha_path is null` funcionaria na maioria dos casos, mas quebra num lote que falhou antes de gravar o path. |
| **D-3** | Cadastro é **multi-variação desde a fase 1**: dados do PAI + tabela de linhas de variação. | Família = 1 anúncio, variação = 1 SKU é o modelo do PubliAI inteiro; split, user products e resolução de cor já assumem N. Fazer só produto simples obrigaria a refazer a tela. |
| **D-4** | **Guard LOUD de duplicata:** o cadastro rejeita `codigo_pai` que já exista na org (em qualquer lote), com mensagem "esse produto já existe — use Entrada de estoque". | A unique é `(lote_id, codigo_pai)`, então dois lotes diferentes aceitariam o mesmo produto e criariam duas linhas canônicas concorrentes. Erro explícito, nunca merge silencioso. |
| **D-5** | **Ledger `estoque_movimentos`** com idempotência por `(org_id, referencia_externa)` única. Motivos: `venda`, `entrada`, `estorno_venda`, `venda_sku_nao_encontrado`, `estorno_sku_nao_encontrado`, `cancelamento_sem_baixa`, `venda_cancelada_antes`. | Herdado de D-E6b.2. Baixa nunca aplica 2× (webhook re-entregue, backfill, reconciliação) e todo movimento é auditável. |
| **D-6** | **Baixa sempre que o pedido está pago** (`status === 'paid'`), para todas as orgs, sem flag — **não** na transição `novaPaga`. | Mesmo mecanismo, dois regimes de graça: para a org de planilha evita oversell **entre** importações e a próxima importação segue sobrescrevendo (D-E6b.1 intacto); para a org do módulo é a verdade permanente, porque ela nunca importa. A condição é "está pago" e não "acabou de ficar pago" porque `novaPaga` é **one-shot** (calculado do status já persistido): uma baixa que falhasse no meio nunca seria retomada pelo retry do QStash. A idempotência vem do ledger, não do gatilho. |
| **D-7** | **Cancelamento repõe — mas só o que foi de fato baixado.** O estorno (`estorno_venda`, idempotente por referência própria) só roda quando existe movimento de `venda` para aquele `(canal, pedido, sku)`. **Devolução não é tocada** neste épico: nem repõe, nem notifica. | Fisicamente diferentes: cancelado antes do despacho = mercadoria nunca saiu; devolvido = precisa conferir o que voltou. A condicional é obrigatória porque a baixa só ocorre com o pedido pago: pedido criado → nunca pago → cancelado (comum no ML) jamais gerou baixa, e estornar aí criaria **estoque fantasma**, propagado para todos os canais. A checagem vive DENTRO da RPC, atômica com o estorno (ver D-19). **Inverte parcialmente D-E6b.7**, que não repunha em nenhum caso. |
| **D-16** | **`talvezFinalizarLote` passa a considerar famílias `pendente`/`processando`**: lote com trabalho em curso vira `processando`, não `concluido`. | Defeito **pré-existente** (`publish-familia-ml/processar.ts:44-52` olha só `publicando` e `pronto`): publicar as famílias prontas de um lote enquanto a IA ainda roda nas demais marcava o lote como concluído, e o trigger de transição só promove lote em `'processando'` — o lote ficava travado com família publicável dentro. O D-1.1 torna isso frequente, mas o bug já atinge o caminho de planilha hoje. Correção na função compartilhada, não `if` no caminho novo. |
| **D-17** | **Toda escrita de estoque exige referência de idempotência**, inclusive a entrada manual (`registrar_entrada(..., p_ref)` obrigatório; o formulário gera um uuid por submissão). | Sem isso, duplo clique ou retry de rede soma o saldo duas vezes e sobrescreve o custo duas vezes — e custo alimenta markup e preço (ADR-0055). Caminho financeiro não aceita "provavelmente só roda uma vez". |
| **D-8** | **Venda maior que o saldo:** baixa até zero (`greatest(0, estoque - qtd)`). O ledger grava em `quantidade` o **delta realmente aplicado** e em `quantidade_pedida` o que o pedido pediu. Notifica via `notificarCategoria`. A venda **nunca** falha por causa de estoque. | O saldo negativo obrigaria todo o resto (publicabilidade, push, ML) a aguentar negativo — e o ML não aceita quantidade negativa. **A separação das duas quantidades é obrigatória, não cosmética:** com saldo 2 e venda de 5, gravar `-5` faria o estorno devolver 5 e **criar 3 unidades do nada**. `quantidade` é o que o estorno desfaz; `quantidade_pedida` é o que o operador precisa ver. |
| **D-18** | **Outbox no próprio ledger** (`estoque_movimentos.push_enfileirado_em`): o push só é considerado entregue depois que o QStash aceitou; o que enfileirar vem da varredura de pendentes, não do retorno da RPC. | Sem isso, uma RPC que commita seguida de um enfileiramento que falha vira perda **permanente** — o retry recebe "já aplicado" e o push nunca é refeito. Uma coluna no ledger entrega o mesmo que uma tabela de outbox, sem tabela nova. |
| **D-19** | **Tombstone de cancelamento.** Cancelamento sem baixa correspondente grava `cancelamento_sem_baixa`; a baixa consulta essa marca e se recusa a aplicar. | `SELECT … FOR UPDATE` **não trava linha que não existe**, então nada garante a ordem entre as execuções `paid` e `cancelled` do mesmo pedido. Se o cancelamento chegar primeiro, sem o tombstone a baixa posterior derrubaria o saldo e ninguém reporia. |
| **D-20** | **Escrita direta de `variacoes.estoque` é bloqueada por trigger `before update`**, não por revoke de coluna. | Em Postgres privilégios de tabela e coluna são **cumulativos** e não existe "deny" de coluna: como `authenticated` tem `UPDATE` na tabela, `revoke update (estoque)` seria inócuo — a proteção pareceria aplicada e não seria. O trigger é preciso, sobrevive a coluna nova e preserva o `service_role` (`auth.uid()` nulo). |
| **D-9** | **Entrada sobrescreve `variacoes.custo`** com o custo unitário informado (último custo) — **só quando o custo é informado e maior que zero**. Custo ausente → entrada registra a quantidade e **não toca** em `custo`. Custo zero ou negativo → **rejeita a entrada** com erro explícito, nunca trata como ausente. | É como o operador pensa e é o que a planilha já faz na importação. Zero estado extra; o histórico por entrada fica em `estoque_movimentos.custo_unitario`, que é a trilha de auditoria. `variacoes.custo` alimenta markup e preço (ADR-0055): é caminho financeiro, então valor inválido falha LOUD em vez de virar default silencioso — mesma classe do incidente de ORIGEM em `ingest-lote`. **Efeito aceito e intencional:** dar entrada com custo novo num produto já publicado muda o markup exibido em Revisão/Publicados/Financeiro; o ledger explica a mudança. |
| **D-10** | **Propagação por valor absoluto**, fila serial `estoque-{orgId}` (parallelism 1). Entrada e estorno propagam **na hora, para TODOS os canais publicados, inclusive o ML**. Baixa por venda propaga para todos os canais **exceto o de origem** (que já se auto-decrementou). **Não existe ajuste manual de estoque pelo app** (D-20 bloqueia a escrita direta); toda mudança de saldo passa por entrada, baixa ou estorno, e todas propagam. | Push absoluto é idempotente e auto-corretivo; a fila serial garante ordem. **Amplia D-E6b.5**, que excluía sempre o canal de origem — regra que só valia para venda. O ajuste manual saiu do escopo por consequência de D-20: com a escrita direta bloqueada, um trigger de auditoria seria código morto. Se for pedido um dia, entra como edge que grava o ledger e enfileira o push, igual à entrada. |
| **D-11** | **Estoque zero: nenhuma ação.** Push manda `available_quantity: 0` e o ML pausa sozinho; ao entrar mercadoria, o push sobe o saldo e o anúncio volta. | Comportamento nativo do ML. Pausar explicitamente duplicaria a lógica e criaria a pergunta "quem reativa, e quando?". |
| **D-12** | **Reconciliação diária = rede de segurança do PUSH, não do WEBHOOK.** Só re-empurra produtos que **têm movimento no ledger** (outbox pendente ou movimento recente). **Não existe** re-push de produto sem movimento. | Webhook de venda perdido significa que a baixa nunca aconteceu e o saldo local está **alto demais**; re-empurrá-lo para todos os canais — inclusive aquele onde a venda ocorreu — **restauraria unidades já vendidas** e ampliaria o oversell que o épico existe para evitar. Recuperar webhook perdido exigiria importar o pedido faltante e aplicar a baixa: fora de escopo, registrado. **Aperta D-E6b.8**, que re-empurrava todo produto multicanal. |
| **D-15** | **Toda escrita de estoque passa por edge com `service_role`** — as RPCs `baixar_estoque`/`estornar_estoque`/`registrar_entrada` são revogadas de `authenticated`, e a edge repassa o `user_id` do chamador em `criado_por`. O browser nunca chama a RPC direto. | As RPCs são revogadas de `public`/`anon`/`authenticated` **e concedidas explicitamente ao `service_role`** — sem o grant elas ficariam inexecutáveis também pelas edges (padrão do repo em `20260723215424:80-81`). O bloqueio da escrita direta vem de D-20. É também onde o gate do módulo (D-13) é aplicado de fato. |
| **D-13** | **Módulo opt-in por org:** `organizations.modulos_habilitados text[]` + action `set_modulos_org` na edge `usuarios` (mesma trava `is_super_admin && !org_id`) + checkbox em `/admin`. O gate vai **no menu E na edge** de cadastro/entrada. | Espelha exatamente `canais_habilitados`. Esconder o menu é navegação, **não** fronteira de segurança (ADR-0047) — sem o gate na edge, qualquer token autenticado chamaria o endpoint. Permite cobrar pelo módulo sem construir billing (ADR-0028 segue stub). |
| **D-14** | A **baixa/ledger/push (D-5..D-12) não é gated** pelo módulo; só **cadastro e entrada (D-1..D-4, D-9)** são. | A baixa serve as duas populações (D-6). Gatear criaria um `if` no gancho da venda e duas realidades para manter. |

## Diagrama do fluxo

Cópia verbatim do bloco ASCII da seção 6 (`## 6. Arquitetura`) da spec. Dois blocos
independentes, entregáveis em ordem.

### Bloco A — Estoque (serve todas as orgs)

```
venda paga (sync-venda, pedido.status === 'paid')
  └─ registrarBaixaVenda(admin, {orgId, canal, orderId, itens})
       └─ RPC baixar_estoque(org, codigo, qtd, canal, ref)   [atômica, idempotente]
            ├─ insert em estoque_movimentos (unique ref → duplicata = no-op)
            ├─ resolve variação canônica: família mais recente do (org_id, codigo)
            └─ update variacoes.estoque = greatest(0, estoque - qtd)
       └─ enfileirarSincronizacaoEstoque({org_id, codigo_pai, canal_origem})
            └─ fila serial estoque-{orgId}
                 └─ worker sincronizar-estoque
                      └─ push ABSOLUTO por anúncio publicado (≠ canal_origem)
                           └─ conn.atualizarEstoque(ctx, itemExternoId, estoques, variacoesExternas)

entrada de mercadoria / ajuste manual
  └─ RPC registrar_entrada(org, codigo, qtd, custo, doc, obs)
       ├─ insert em estoque_movimentos (motivo 'entrada')
       ├─ update variacoes.estoque = estoque + qtd
       └─ update variacoes.custo = custo            [D-9, só se custo informado]
  └─ enfileirarSincronizacaoEstoque({..., canal_origem: null})   [null = TODOS os canais, D-10]

pedido cancelado (sync-venda / sync-devolucao)
  └─ cancelado antes do despacho → movimento 'estorno_venda' (repõe, D-7)
  └─ devolvido / já despachado   → notificarCategoria (só avisa)

diário (QStash)
  └─ reconciliar-estoque → re-push absoluto de todo produto publicado
```

### Bloco B — Cadastro manual + Entrada (gated pelo módulo)

```
tela Estoque (menu novo)
  ├─ [Cadastrar produto]  → sessão de cadastro
  │    ├─ dados do PAI: codigo_pai, nome_pai, descricao_pai, unidade, fornecedor, origem
  │    ├─ tabela de variações: codigo, gtin, preco, custo, estoque inicial,
  │    │                       peso_gramas, altura/largura/comprimento_cm, foto
  │    ├─ fotos comuns da família: capa, capa2, capa3
  │    └─ [Salvar] → edge cadastrar-produto
  │         ├─ valida (D-4: codigo_pai duplicado na org = 400 LOUD)
  │         ├─ cria/reusa lote da sessão (origem='manual', status='processando')
  │         ├─ insere familias (operacao='CREATE') + variacoes (estoque = 0)
  │         ├─ estoque inicial > 0 → registrar_entrada(...)   [caminho único, D-15]
  │         └─ enfileirarFamilia({familia_id, lote_id})   → IA de atributos, INTACTA
  │    → redireciona para /revisao/{loteId}   ← fluxo existente daqui pra frente
  │
  ├─ lista de produtos com saldo (codigo, nome, cor, estoque, custo, canais publicados)
  ├─ [Dar entrada] → SKU + quantidade + custo unitário + documento + observação
  └─ histórico de movimentos por SKU (data, motivo, qtd, canal, estoque resultante)
```

### O que a implementação do Bloco B acrescentou ao desenho acima

Cinco decisões que o plano não previa e o código exigiu:

1. **Trava LOUD de `origem` no cadastro.** `familias.origem` é `NOT NULL DEFAULT 'nacional'`.
   Sem validação explícita, um cliente que omitisse o campo gravaria o produto como nacional
   em silêncio e pagaria a alíquota errada — o mesmo risco do incidente de 2026-07-14 no
   `ingest-lote` (ADR-0055). `validarProdutoNovo` recusa `origem` ausente ou inválida com 400,
   e a UI mantém o rádio sem seleção inicial, travando o botão de salvar.

2. **Guard de SKU entre produtos.** A unique do banco é `(familia_id, codigo)` — **não existe**
   unique por org. Como as RPCs de estoque resolvem a variação por `(org_id, codigo)` pegando a
   família mais recente (âncora ADR-0025), um SKU repetido entre produtos diferentes faria uma
   venda baixar o estoque do produto **errado**. A edge é o único ponto onde isso dá para
   impedir; responde 409 listando os SKUs em conflito.

3. **Correção de `talvezFinalizarLote` (defeito pré-existente).** A função olhava só `publicando`
   e `pronto`, ignorando `pendente`/`processando`: um lote com IA ainda rodando virava
   `concluido` — status terminal — quando o worker de outra família terminava, e o trigger de
   transição (`20260609132501`) só promove lote em `processando`, então o lote nunca era
   resgatado e ficava concluído com família publicável dentro. Acontecia **também no caminho de
   planilha**. Eram três cópias idênticas (`publish-familia-ml`, `update-familia-ml`,
   `publicar-split-ml`); viraram uma em `_shared/lote/finalizar.ts`.
   A leitura das famílias agora checa `error` e **não escreve** quando falha (contagem vazia
   decidiria `concluido`), e **não lança** de propósito: a chamada roda dentro do `try` dos
   workers e o `catch` marcaria a família como `erro` mesmo já publicada com sucesso no ML.

4. **`useModulosHabilitados` sem retry.** O hook roda dentro do `MenuGuard`, que bloqueia toda
   rota enquanto carrega. Com retry padrão, uma falha da RPC deixaria o app inteiro na tela
   "Carregando…" — inclusive para org que não usa o módulo. Falhando de primeira, o guard
   degrada para "nenhum módulo" e o resto do sistema segue funcionando.

5. **Ordem de escrita no reuso de lote.** O lote reusado só é marcado `processando` **depois**
   do insert da família. Fazer antes abre uma janela em que um worker de publicação roda
   `talvezFinalizarLote`, não enxerga a família (que ainda não existe) e fecha o lote — a
   família nasceria dentro de um lote fechado.

### Risco residual aceito

Um lote com família travada em `pendente` (job de IA perdido) fica em `processando`
indefinidamente: o `LoteCard` desabilita excluir nesse status e `destinoDoLote` manda para
`/progresso`. Isso **já acontecia** no caminho de planilha — o trigger de transição também só
promove quando não há família pendente. O que a correção (3) removeu foi uma válvula de escape
acidental (o worker fechava o lote errado como `concluido`, tornando-o deletável). Mitigação:
a tela Progresso ganhou um botão **"Ir para a Revisão"** sempre visível quando há família
pronta, para o operador nunca ficar preso com famílias publicáveis. O gate de exclusão **não**
foi afrouxado — `processando` bloqueia exclusão por um motivo real (worker em voo).

## Alternativas rejeitadas

- **`lote_id` nullable** — custo verificado em 6 frentes, duas em código que publica anúncio
  real.
- **Delta em vez de push absoluto** — não é idempotente, um retry duplica a correção.
- **Tabela `produtos` separada** — duplica a fonte de verdade do produto.
- **Custo médio ponderado** — cálculo num caminho financeiro sem demanda.
- **Emissão de NF-e** — ver seção 11 da spec.

## Consequências

- Toda venda paga baixa o estoque de forma atômica e idempotente, e todo movimento (venda,
  entrada, ajuste, estorno) propaga o saldo absoluto para os marketplaces onde o produto
  está publicado — o risco de oversell cross-canal deixa de existir.
- Produto passa a poder entrar no sistema sem planilha/ERP do cliente, via cadastro manual
  e entrada de mercadoria.
- Extensões futuras registradas, fora de escopo por ora: importação do XML de compra,
  reposição automática em devolução, custo médio ponderado, leitura comparativa por
  variação na reconciliação.

## Cortes declarados

Cópia da seção 3 (`## 3. Fora de escopo`) da spec.

| Item | Por quê |
|---|---|
| **Emissão de NF-e** | Discutido e descartado nesta sessão. É commodity (6 providers fazem igual), é passivo e não ativo (nota errada = multa do cliente, suporte contábil que o time não tem), e é manutenção fiscal perpétua (reforma tributária em transição — o próprio mercado vende "calculadora da reforma" como módulo à parte, e o motor da NFE.io é add-on de parceiro sem preço público). Não multiplica nada do que o PubliAI já construiu. Registrado com detalhe na seção 11. |
| **Importação do XML de compra do fornecedor** | Fase 2. Grava exatamente as mesmas linhas que a tela de entrada, então encaixa depois sem refazer nada. Antes de construir, validar que o cliente-alvo tem os XMLs em mãos. |
| **Multi-depósito / estoque por localização** | YAGNI. Um saldo por SKU por org. |
| **Reserva de estoque / estoque de segurança** | YAGNI. O ML já baixa por conta própria no momento da venda. |
| **Custo médio ponderado** | Decidido: último custo sobrescreve (D-9). O ledger guarda o histórico por entrada, então nada se perde e dá para evoluir depois. |
| **Devolução (fluxo `sync-devolucao`)** | **Não é tocada:** nem repõe estoque, nem notifica. Repor exige saber se a mercadoria voltou e em que estado — decisão do operador. Só o **cancelamento** visto pelo `sync-venda` é tratado (D-7). |
| **Ajuste manual de estoque pelo app** | Consequência de D-20: com a escrita direta bloqueada, não existe caminho de ajuste. Toda mudança de saldo é entrada, baixa ou estorno. Se for pedido, entra como edge própria. |
