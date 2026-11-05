# Confirmação no ML e divisão automática por estoque — desenho

**Data:** 2026-11-05 · **Decisor:** Diego · **ADR a escrever antes do código:** 0195
**Refina:** ADR-0048 (split e teto), ADR-0088/0104 (User Products), ADR-0089 (atualização rápida)

## Por que

Na conferência do lote #68 (Avil, 05/11/2026), a tela mostrou 127 famílias `publicado`, mas uma delas
nunca recebeu estoque: a Fita N.2 (`00446050`, `MLB6937855624`) está parada no saldo de 03/08 e três
atualizações se perderam sem aviso. Só apareceu porque Diego pediu a conferência. Na mesma leitura, 61
cores da Linha 1500MT (`02835002`) estavam cortadas em 1.164 porque o anúncio soma mais que os 99.999
do ML.

Duas coisas precisam mudar: `publicado` deixa de ser "o worker terminou" e passa a ter confirmação do
canal, e o teto deixa de esconder saldo em silêncio.

Pedidos de Diego:

1. Corrigir a Fita (código, limpeza dos registros órfãos, reenvio).
2. "Preciso ser sinalizado por esse tipo de erro no frontend."
3. Quebrar no limite e processar o restante, e "o sistema já fique pronto para processar quando passar
   do limite do ML", para qualquer família, não só a Linha.

## Objetivos

- Nenhuma família termina `publicado` sem ter enviado o que foi pedido.
- Depois de cada escrita, o operador vê na tela se o ML confirmou.
- Família acima do limite: o sistema detecta e monta a divisão sozinho, e o operador aprova.
- Fita corrigida em produção, com os 77 SKUs conferidos no ML.

## Fora de escopo

- Varredura periódica app × ML em todas as famílias (fica para depois, se a confirmação pós-escrita não bastar).
- Reenvio automático de estoque ao achar divergência.
- Mesma cor em dois anúncios com saldo dividido (rejeitada: o push manda saldo integral a cada anúncio do SKU, `_shared/estoque/alvos.ts`).
- Migrar família dividida para User Products (bloqueado em `migrar-preco-por-variacao/processar.ts`).
- Corrigir os 5 anúncios removidos do lote #68 (precisam de republicação, decisão separada).

## Anti-objetivos (falha mesmo que "funcione")

- Falso alarme por venda concorrente ou por teto: operador deixa de confiar no aviso.
- O mesmo saldo à venda em dois anúncios durante a movimentação.
- Anúncio novo criado sem aprovação humana.
- Qualquer escrita no ML fora do fluxo do app.

## Entrega 1 — Fita e fim do no-op silencioso

**Causa medida:** raiz em `anuncios_externos` (`publicando`, `item_externo_id` null, 01/09 13:33) com 77
filhos sem item (76 `pendente`, 1 `criacao_incerta`). O anúncio real é Legacy. `update-familia-ml/processar.ts`
roteia para UP por existir linha filha. Em `somenteEstoque`, `atualizar-composicao.ts` zera `paraAdicionar`,
`reposicao` não acha filho ativo, devolve `sem_mudanca` e `atualizar-familia-up.ts` marca `publicado`.

**Comportamento novo**

- Trava no roteamento de `update-familia-ml/processar.ts`: raiz com filhos e **nenhum** filho com `item_externo_id`
  é criação UP pendente. Vira `erro` antes de qualquer escrita, nos dois modos. Cobre também "Atualizar tudo", que
  hoje tentaria criar todos os itens com o anúncio Legacy no ar. Nunca cai em Legacy por conta própria: a saga UP
  reserva os filhos antes de criar o primeiro item (`publicar-grupo.ts`), então "sem ID" sozinho não prova Legacy.
- `atualizarComposicao`, em `somenteEstoque`: filho existente de SKU desejado que não está ativo com item vira erro
  acionável com a lista de SKUs, antes de qualquer PUT, com as reservas preservadas. O contrato testado de **cor sem
  linha filha** (cor nova ignorada enquanto as existentes repõem, ADR-0104 §4) continua igual, salvo se não sobrar
  nenhum alvo: zero alvos com SKUs desejados é erro, nunca `sem_mudanca`.
- `paisUP` em `publicar-familias/index.ts` não muda: ele só evita split por preço, e a família com raiz órfã para na
  trava acima.
- **Regressão obrigatória:** 77 filhos sem ID em `somenteEstoque` → erro visível, zero PUT, nunca `publicado`.

**Criação pendente na tela:** família fica `erro` com a mensagem e a lista de SKUs; aparece em `Progresso` e no
relatório e dispara `notificarCategoria` categoria `estoque`. Resolver é manual neste primeiro momento: é a primeira
ocorrência em todas as orgs, um botão de limpeza seria código para um caso só.

**Limpeza em produção (Diego autorizou em 05/11)**, nesta ordem:

1. Deploy da correção.
2. Prévia das linhas exatas com organização e `org_id`, e ok de Diego sobre elas (AGENTS.md). Pré-condições: família
   mais recente `UPDATE`, `ml_item_id=MLB6937855624`, status diferente de `publicando` (é o claim; sem ele não há job em voo).
3. Salvar cópia das 78 linhas.
4. Apagar a raiz (`73690294-642a-43c8-a36b-0ac540497834`) com filtro de `org_id`; a única FK é
   `anuncios_externos_itens`, com `ON DELETE CASCADE`. Leitura entre organizações depois.
5. Reenviar com **mini-planilha só dessa família** pelo upload normal. `familias` e `lotes` não recebem escrita direta
   (proibida pelo AGENTS.md). O ingest herda `ml_item_id` como UPDATE, sem CREATE nem anúncio duplicado.
6. Diego clica em "Atualizar estoque (1)", que força `somente_estoque` (ADR-0089).
7. Conferir os 77 SKUs no ML. `espelharAnuncioExterno` recria a raiz já com o item.

Já verificado em 05/11: busca por SKU na conta AVILBV devolve só `MLB6937855624` para os 77. A escrita no ML sai pelo
app, nunca por PUT manual.

## Entrega 2 — Confirmação no ML e aviso na tela

**Mecanismo:** depois de escrever, o worker grava o que enviou e agenda uma conferência (QStash com atraso curto,
fora da fila serial de publicação). A conferência lê os itens tocados por `/items/bulk` e compara por SKU com o
**valor enviado** (depois do teto), nunca com o saldo do banco. Legacy casa por `seller_custom_field`; UP pelo item
do filho; item plano por `available_quantity`. Cobre `update-familia-ml` e `publicar-split-ml`.

**Estados:** `aguardando`, `confirmado`, `inconclusivo`, `falhou`.

- Igual ao enviado → `confirmado`.
- Diferente, e `enviado + soma dos movimentos do SKU em estoque_movimentos depois do envio = observado` → `confirmado`. Vale também para SKU com teto: a venda reduz os dois lados igual.
- SKU escrito de novo depois do envio (push posterior) → a conferência daquele SKU fica `inconclusivo`; a escrita nova tem a sua.
- Diferente sem explicação → nova **leitura** com atraso (cerca de 1, 3 e 10 minutos, bem acima dos ~11 s medidos de propagação); esgotadas, `falhou`.
- Leitura impossível (429, 5xx) esgotada → `inconclusivo`. A conferência só lê: nunca reenvia estoque sozinha.

**Persistência:** tabela nova com RLS por `org_id`, uma linha por família e item conferido: lote, família, item,
status, esperado, observado, SKUs divergentes, tentativas, verificado_em. Não reutiliza `familias.status`.

**Tela:** `Progresso.tsx` e `Relatorio.tsx` ganham o resumo (N confirmadas, N aguardando, N inconclusivas, N com
falha) e, na falha, a lista de SKU com enviado e observado. Polling enquanto houver `aguardando`. Teto aparece como
aviso informativo, não como falha. Relatório deixa de truncar essa mensagem. Dropdown, se houver, é `ui/select`.

**Aviso fora da tela:** `falhou` chama `notificarCategoria(admin, orgId, 'estoque', texto, { chave })` com chave por
lote e família: sino e Telegram sem repetir.

## Entrega 3 — Divisão automática por estoque

**Regra geral (qualquer família, qualquer org):** um anúncio com soma real acima de 99.999 é dividido. Hoje
`particionar.ts` só olha contagem e preço, e `decidir-split.ts` só desvia para split por cores ou preço.

**Detecção:** o sinal é `confirmacoes_ml.capados > 0` (Entrega 2). A família segue no atalho com teto, que só atualiza
saldo (ADR-0089 intacto), e o resumo do lote oferece a divisão. Publicação nova nasce dividida: `decidirSplit` considera a
soma no CREATE. O protocolo de bloqueio, erro e identidade está no plano da Entrega 3.

**Fora de lote** (entrada de nota, ajuste, push): nesta entrega não abre divisão. O teto protege o anúncio e o sino
avisa uma vez ("anúncio passou do limite; a divisão será proposta na próxima planilha"). A Avil repõe por planilha, e a
Revisão é presa a lote; aprovação fora de lote é tela nova sem caso real hoje.

**Plano de divisão (função pura, nova, com teste):** dado anúncios atuais, estoque real e vendas, escolhe as cores a mover.

- Só tira cores da partição que excede, até ela caber no limite.
- Dados: `sold_quantity` por variação do GET do item; 90 dias de `estoque_movimentos` com `motivo='venda'`. Sem dado de venda, a cor conta como **vendida** (nunca é candidata preferencial por falta de informação).
- Prioridade: cor sem venda nas duas fontes; entre elas, maior estoque primeiro (menos cores movidas).
- Cores sem venda não bastam: o plano inclui cores com venda, as de menos venda primeiro, marcadas no plano para o operador ver antes de aprovar.
- Destino: partição existente com a mesma faixa de preço, com vaga de cor e de saldo; sem vaga, partição nova.
- Cor com mais de 99.999 sozinha não tem como dividir: fica com teto, e isso aparece como aviso informativo em `Progresso`, uma vez por lote.

Referência medida para a Linha: mover 23 cores sem venda (91.009 unidades) deixa `MLB6914358210` com 98.968; a
partição 1 tem folga de 63.866; são 3 anúncios no total.

**Aprovação:** a Revisão mostra o plano (cores, de qual anúncio para qual, título do anúncio novo) e um botão de
confirmar. Um clique aprova. Sem aprovar, a família segue atualizando com teto e aviso. "Sempre há revisão humana
antes de publicar" é regra do projeto, então a parte automática é detectar e montar, não publicar sozinho.

**Movimentação (estado durável, retomável):** tabela nova com uma linha por cor movida:
`planejado → origem_zerada → destino_criado → concluido`, mais `erro`.

1. Zera a cor no anúncio de origem e confirma. Vem primeiro de propósito: indisponível por minutos é melhor que vender saldo duplicado.
2. Cria a cor no destino (`novas` do `atualizarAnuncio`, ou CREATE de partição com `gerarTituloParticao`).
3. Atualiza `variacoes.ml_variation_id`, **remove o SKU de `variacoes_externas` da origem** e o inclui no destino. Só aí a cor pertence ao destino.
4. Retries retomam do estado salvo. Durante a movimentação, `sincronizar-estoque` e o UPDATE da família não escrevem nas cores envolvidas.

Tirar o SKU do mapa da origem é o que impede o reabastecimento: `resolverAlvosPush` só escreve nos SKUs do mapa, e
`montarVariacoesUpdate` reenvia as variações fora do pedido com o saldo vivo (0). O worker de split só manda ao anúncio
as cores da partição dele. A baixa de venda é por SKU, então não muda; a cor zerada não vende. Família com mais de uma
partição sempre vai ao worker de split, então o UPDATE comum não regrava o mapa da origem.

**Lacunas apontadas pelo Codex, obrigatórias no plano desta entrega:**

- `vincular-catalogo/index.ts:124` espelha todas as variações na partição 0 e pode reinserir o SKU movido.
- Mapa vazio manda todos os SKUs no push (`alvos.ts:58`): esvaziar a origem a reabasteceria. A origem nunca pode ficar sem SKU no mapa.
- Consultar o estado da movimentação não basta: jobs em voo precisam terminar antes do zeramento.
- O retry precisa recuperar criação remota cujo ID não foi persistido (adotar por SKU, como a saga UP), e pertencimento e mapas mudam juntos.

**A cor fica zerada no anúncio de origem, não excluída:** apagar é irreversível e o ML recusa em variação com venda.
Consequência: ela segue ocupando vaga das 100 no anúncio de origem, então `particionar` passa a contar as variações
reais do anúncio, não só o mapa local.

**Exceção formal à ancoragem:** ADR-0048 diz que cor publicada nunca migra. A ADR-0195 abre a exceção só para divisão
por estoque aprovada pelo operador.

**Teto continua como proteção:** entre a detecção e a aprovação, e quando o saldo volta a subir depois. E passa a valer
também em `atualizarEstoque` (push), que hoje envia sem aplicar o teto. Sem leitura extra: o push já faz `buscarItemML`,
então o cálculo usa o saldo vivo das outras variações daquele item, por anúncio (cada partição tem o seu limite).

**Integrações a preservar:** baixa de venda por SKU; custo de venda antiga (cadeia em `custos.ts`, cai no código);
fiscal do SKU no item novo (`enfileirarSincronizacaoFiscal` com `split: true`); catálogo segue só na partição 0
(TODO existente, fora de escopo); atacado por partição.

## Ordem

Entrega 1 → merge e deploy → Fita corrigida. Entrega 2 → merge e deploy. Entrega 3 → merge, deploy, plano da Linha
aprovado por Diego na Revisão. Cada entrega com TDD, revisão de diff pelo Codex, CI verde e deploy das edges/migrations.

## Decisões tomadas pelo agente (Diego pode vetar)

- Um clique de aprovação na divisão, por causa da regra de revisão humana.
- Cor movida fica zerada na origem, em vez de excluída.
- Conferir por `/items/bulk` só o que foi tocado, sem varredura global.
- Movimentos do ledger explicam diferença sem virar falso alarme; 3 tentativas antes de `falhou`.
- Critério de escolha das cores: sem venda primeiro, maior estoque depois; sem dado conta como vendida.
- Divisão nasce só no lote de planilha; fora de lote, teto e aviso.
- Criação UP pendente se resolve manualmente, sem botão de limpeza.

## Deixado para quem implementar

Nomes de tabelas e colunas, atraso exato da conferência, formato do texto do aviso, layout do cartão na Revisão
(dentro do padrão visual do sistema).
