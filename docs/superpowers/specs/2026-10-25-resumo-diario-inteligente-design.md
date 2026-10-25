# Resumo diário mais inteligente — fase 1: estoque acabando e prejuízo nomeado

**Data:** 2026-10-25 · **ADR base:** ADR-0190 (D-6 resumo, "Para depois") · **Status:** design para aprovação

## Por quê

O resumo das 08:00 (ADR-0190) diz *quanto* foi ontem, mas não diz *onde agir*. Na entrevista
(Codex no papel de diretor de uma empresa tipo Hairfly, respondendo pelo Diego), a primeira dúvida
de uma manhã ruim foi "vendi pouco porque faltou produto?" e a primeira cobrança do dia seria
"quais campeões vão acabar e já têm reposição?". Hoje o resumo também diz "1 com prejuízo" sem dizer
qual — o diretor precisa abrir o sistema para descobrir.

Sucesso = o diretor lê o resumo e sabe, sem abrir nada, **o que repor** e **qual anúncio está
perdendo dinheiro**.

## Escopo (decidido com o Diego)

Ordem de entrega: **fase 1** (este documento) = estoque acabando + prejuízo nomeado; **fase 2** =
por que o lucro variou (A); **fase 3** = Ads consumindo a margem (C). Fases 2 e 3 terão design próprio.

### Goals da fase 1
1. **📦 Estoque acabando** — campeões de venda com cobertura baixa ou já zerados.
2. **Prejuízo nomeado** — a linha "N com prejuízo" passa a dizer quais itens e quanto.

### Non-goals
- Resumo separado para gerente/não-admin (pedido do diretor; exige categoria nova — outro projeto).
- Prazo do fornecedor (não existe no banco; **não inventar**).
- Qualquer ação (repor, pausar): o resumo é só leitura.
- Mudar o restante do resumo. **O markup fica** (decisão do Diego, contra a sugestão do diretor de cortar).

### Anti-goals (seria falha mesmo funcionando)
- Alerta que repete todo dia sem dar para agir, ou que acusa produto que vende 1 vez por mês.
- Número que diverge da tela **Vendas SKU** sem explicação (cobertura, nome do produto).
- Cobertura calculada sobre kit como se tivesse estoque próprio.
- Resumo que estoura o tempo/CPU da edge ou atrasa o envio das 08:00.

## Como funciona

### 📦 Estoque acabando
- **Campeão**: SKU entre os **20 que mais deixaram lucro nos últimos 30 dias** (pedido do diretor:
  lucro total, venda recorrente). "Recorrente" = vendeu em pelo menos **3 dias distintos** na janela
  (escolha minha — evita a venda única de valor alto).
- **Cobertura**: mesma regra da tela (`coberturaDias` de `src/lib/vendas-sku.ts`): `floor(estoque /
  (unidades_30d / 30))`; kit vinculado = sem número próprio (fica fora; a base é que conta). Estoque =
  `variacoes.estoque` da variação canônica (mesma de `vendas_sku_catalogo`).
- **Dispara** quando cobertura **< 7 dias** (pedido do diretor) **ou estoque = 0 com venda nos últimos
  7 dias** (decisão do Diego: zerado há mais de uma semana sai do resumo e segue visível na tela Vendas SKU;
  sem estado persistido). A tela Vendas SKU usa
  15 dias para o selo "cobertura baixa"; o resumo usa 7 porque é o que pede ação *hoje*. A diferença é
  intencional e a linha mostra os números, então não há contradição a explicar.
- **Mostra** no máximo **3 itens**, ordenados: zerados primeiro (por lucro 30d), depois menor cobertura;
  se houver mais, `• e mais N` . Cada item: nome curto (40 car., `encurtar`), estoque, ritmo e cobertura:
  ```
  📦 Estoque acabando
  • Shampoo X — 12 un. · 3/dia · 4 dias
  • Máscara Y — zerado (vendia 2/dia)
  • e mais 2
  ```
- Sem item que dispare → seção some (padrão `blocos`).
- **Lugar no resumo**: logo depois do bloco do mês, antes do 🏆 Top lucro (é a prioridade nº 1 do diretor).

### Prejuízo nomeado
- Hoje `contarAtencao` só conta. Passa a devolver também a lista de itens com prejuízo (mesmo critério:
  semáforo vermelho), agregada por SKU no dia: nome, prejuízo total em R$ e nº de vendas.
- No bloco ⚠️ Atenção, a linha `• N com prejuízo` vira até 3 linhas nomeadas + `e mais N`:
  ```
  ⚠️ Atenção
  • Prejuízo: Máscara Y — −R$ 4,10 (1 venda)
  • 1 abaixo do mínimo
  ```
  "Abaixo do mínimo" e "sem custo" continuam só contados.

## Restrições
- Edge `resumo-diario` e `/ontem` (mesma `montarDadosResumo`): CPU hoje ≤ 90 ms; limite de 2 s.
  A janela de 30 dias **não** pode reaproveitar `lerVendasJanela` + cascata item a item se isso
  estourar o teto de `LIMITE_VENDAS_POR_EXECUCAO` (5.000 vendas) ou o CPU — o builder mede com o
  volume real da Hairfly e da Avil antes de escolher (agregação SQL em RPC × porta TS).
- `coberturaDias` e o ranking vivem no front; a edge precisa de porta em `_shared` **com teste de
  paridade** contra `src/lib/vendas-sku.ts` (mesmo padrão de `cascataDoPedido`/`resultado.ts`).
- Texto puro, layout em blocos, nunca nome de comprador; só admin (categorias atuais).
- Migration nova (se houver RPC) só via `supabase migration new` + `db push`; RPC com `current_org_id`
  ou parâmetro de org validado por `service_role`; sem expor a outros papéis.

## Decisões do builder check (minhas, marcadas para conferência)
Regra geral: **paridade com a tela Vendas SKU** (`src/lib/vendas-sku.ts`), para o número do Telegram
nunca divergir da tela.
1. **Ritmo da base não soma venda de kit** — igual a `unidadesPorCodigo` da tela (conta só o próprio
   código). Limitação conhecida nas duas pontas: base vendida também via kit tem cobertura otimista.
   Corrigir depois, nas duas ao mesmo tempo.
2. **Lucro 30d do ranking = o da tela** (`agregarPorSku`: desconta devolução real; SKU sem lucro
   calculado fica fora do ranking, como `-Infinity` na tela).
3. **Kit vinculado sai antes do ranking** (não ocupa vaga do top 20; não tem cobertura própria).
4. **Janela**: 30 dias terminando no fim de ontem em BRT (`janelaDia`), por `date_closed`; "3 dias
   distintos" contados em BRT.
5. **Estoque nulo** = ignorado (não é zero). SKU fora do catálogo (sem variação canônica) = fora.
6. **Prejuízo nomeado**: soma só das vendas vermelhas do SKU no dia; item sem código usa o título;
   ordena por maior prejuízo em R$; `contarAtencao` mantém `prejuizo: number` e ganha a lista.
7. **Nome**: `nomeSku` (o da tela) nas duas seções novas, cortado em 40 caracteres.
8. **CPU**: teto de 500 ms por execução após a mudança; cada seção nova em `try/catch` próprio —
   se falhar, o resumo sai **sem a seção** (log de erro), nunca deixa de sair.
9. **Estoque é o de agora** (no envio); o rodapé "Apurado às HH:MM" já data o número.

## O que fica para o builder
- RPC SQL × leitura paginada + porta TS para lucro 30d por SKU (decidir pela medição de volume/CPU).
- Nome do item: usar o mesmo nome curto que o resumo já usa no Top lucro.
- Testes: paridade de `coberturaDias`, ordenação/limite de 3, seção some quando vazia, kit fora,
  prejuízo agregado por SKU.

## Fases seguintes (não fazer agora)
- **Fase 2 — por que o lucro variou**: ontem × mesmo dia da semana passada, até 3 SKUs por impacto em
  R$ (altas e quedas), com quantidade e lucro/unidade dos dois dias; porta de `explicarVariacao`.
- **Fase 3 — Ads consumindo a margem**: dado da véspera **com a data escrita**; alerta quando gasto de
  Ads > lucro antes de Ads das vendas atribuídas; sem ACOS único; sem descontar Ads duas vezes.
- Candidatos do diretor ainda sem fase: perguntas sem resposta (qtd + mais antiga) e reclamações que
  pedem providência (motivo + prazo).
