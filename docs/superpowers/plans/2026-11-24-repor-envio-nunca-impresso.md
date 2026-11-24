# Repor envio cancelado cuja etiqueta nunca foi impressa (ADR-0121, emenda 8)

Critério: cancelamento com envio `cancelled`, sem substatus e nunca impresso volta ao estoque nos 3 caminhos; o resto
fica igual. Sem migration. Classificação crítica.

## Desenho (revisão 2)
1. `_shared/estoque/nunca-saiu.ts` (novo): `provaNuncaSaiu(h, shippingId)` puro e `lerNuncaSaiu(token, shippingId):
   'sim'|'nao'|'indisponivel'` (AbortSignal 8 s). 401/403/408/429/5xx/rede/corpo ilegível = `indisponivel`; outro 4xx ou
   formato sem prova = `nao`.
2. Fonte única = ledger. `baixasAbertas(admin, orgId, orderId)` usa a RPC `cancelamento_baixas` (a da fila; baixa sem
   estorno). Os itens do estorno são os `codigo_ref` ABERTOS, nunca o catálogo atual: SKU que mudou ou sumiu não some, e
   pedido todo estornado dá `sem-baixa` (some o aviso falso "NÃO reposto"). Vale só neste ramo novo.
3. `saldoMexidoDepois(admin, orgId, orderId)`: lê as baixas do pedido por prefixo exato da referência; por
   `movimento.codigo` (o saldo protegido, inclusive a BASE do kit vinculado) procura `entrada`/`ajuste` posterior ou linha
   de `variacoes` (mesmo `codigo`) criada depois. Lança em erro.
4. `tratarPedidoCancelado`, ramo novo só se `st==='cancelled' && substatus==null && temEnvio && lerNuncaSaiu` presente:
   abertas vazias → `sem-baixa`; `notificacaoJaEnviada` → `silenciado`; prova `nao` → aviso de hoje; `sim` sem trava →
   caminho de pré-despacho de hoje (kit incluso) com os itens do ledger; `sim` com trava → aviso de hoje;
   indisponível ou erro de leitura → `deps`/`p.aoIndisponivel()`.
5. `aoIndisponivel` (retentativa durável):
   - webhook e reconciliação: se a obrigação do ADR-0211 está ARMADA e pendente, `DRENAR_CANCELAMENTOS=1`,
     `FANOUT_RECONCILIAR=1`, org não arquivada e conexão ML com `conta_externa_id` E `criado_por` na mesma linha (as condições em que a fila drena) →
     resultado novo `adiado` (a fila decide em até ~1 h; não reserva aviso). Senão, ou se essa leitura falhar, AVISA agora.
     `adiado` conta como sucesso em `desfechoKit`/claims, porque o dono é a fila.
   - fila: `erro` (pendente) até 2 tentativas; da 3ª em diante avisa. `adiado` nunca é emitido pela fila.
   O crédito de kit mantém `pendente`/`repetir` de hoje; o chamador de claims não fecha o claim com `repetir`.
6. Fila, estado misto (parte já estornada): a prova entra antes do corte. `sim` → repõe só as abertas e relê o ledger.
   Sem prova: pendente até 2 tentativas, depois segue para o aviso (hoje ficava pendente para sempre, calado).
   `cancelamento_tentativas` é lido junto da geração em `aindaPendente`.
7. Depois do estorno pela prova, TODOS os caminhos releem o ledger. Sobrou baixa aberta: webhook/reconciliação seguem
   `aoIndisponivel` (adia ou avisa); fila fica pendente até 2 tentativas e então avisa. Cobre a variação apagada, em que a
   RPC grava `estorno_sku_nao_encontrado` (qtd 0) e a referência fica ocupada (retorna `duplicata` para sempre).
8. Aviso em estado parcial (há baixa estornada e baixa aberta): mesma chave e mesmo canal, com o texto dizendo que parte
   já voltou e listando só SKU e quantidade ainda abertos. Fora desse estado o texto não muda.
9. No ramo novo o aviso recebe as baixas do ledger (não chama `houveBaixaDeVenda` com os SKUs resolvidos): baixa aberta
   confirmada nunca vira `sem-baixa`. `pendente`/`repetir` do kit preservam a retentativa e NÃO disparam o aviso de entrada.
10. No texto do aviso, SKU e quantidade vêm de `estoque_movimentos.codigo`/`quantidade` (unidades da base no kit vinculado);
   `codigo_ref` serve só para localizar o estorno. Predicado de claims exercitado em `processarClaim` real.
11. Sem thunk = igual à main. O mecanismo do aviso (reserva e envio) não muda.

## Testes (RED antes)
- prova: cada campo preenchido/ausente, `mode`≠me2, id/status divergente, impressa; 401/403/404/429/500/timeout.
- tratamento: repõe; impressa avisa; substatus não lê; já avisado silencia sem ler; entrada/ajuste/planilha depois avisa,
  antes repõe; SKU sumido do catálogo repõe pela ref original; tudo estornado = `sem-baixa`; sem thunk = main; kit credita;
  base do kit vinculado com SKU vendido ≠ movimentado (entrada manual e planilha na base).
- indisponível: armada+flag → `adiado` sem reservar; não armada, flag off ou erro → avisa.
- fila: misto com prova repõe só as abertas; misto sem prova avisa na 3ª; indisponível avisa na 3ª; `reposto` relê o ledger.
- adiar: fan-out desligado, org arquivada ou conexão sem conta → avisa. Estorno que deixa baixa aberta (`duplicata`) → avisa.
- parcial: o aviso lista só os SKUs abertos.
- `desfechoKit`/claims: `adiado` ok; envio `cancelled` com prova e `repetir` → `gravarDevolucao` NUNCA chamado. Fiação: todo chamador passa o thunk.

## Deploy
`reconciliar-faturamento` e `sync-venda` (conferir com `deno info`). Reversão: deploy da versão anterior.
Depois do deploy: acompanhar os primeiros casos (saldo + ML), sem reposição retroativa.
