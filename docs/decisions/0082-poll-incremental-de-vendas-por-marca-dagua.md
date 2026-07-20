# ADR-0082: Poll incremental de vendas por marca d'água (`atualizado_em`)

**Status:** Aceito
**Data:** 2026-07-19
**Decisores:** Diego

## Contexto

ADR-0081 já cortou o poll de `useVendas` de 45s para 180s, reduzindo o REST de ~227 MB/dia para
~57 MB/dia. Mas o desenho continua igual: cada tick baixa a **janela inteira** de vendas com
itens, e a janela anterior — usada só para calcular variação percentual — é imutável (pedidos
fechados não mudam de `date_closed`), ainda assim é rebaixada por inteiro a cada 3 minutos.
`Dashboard.tsx:103-104` monta **duas** janelas (`vendasRaw` e `vendasRawAnt`), dobrando o
problema no pior caso.

## Decisão

Poll incremental por marca d'água: `buscarVendas` ganha um 4º parâmetro opcional
`atualizadoDesde`, que filtra `atualizado_em >= atualizadoDesde`. `useVendas` guarda o maior
`atualizado_em` do cache atual (`marcaDagua`) e, a partir do segundo tick, busca só o delta desde
essa marca, mesclando no cache existente (`mesclarVendas`, substitui por id, nunca deleta).

Contrato que isso impõe: **todo writer que altera uma coluna exibida na UI de vendas precisa
bumpar `atualizado_em`**. Sem isso o delta fica cego à mudança — a linha nunca reaparece até um
fetch completo (troca de página, refresh de sessão). `registrar_saque_ml_vendas` /
`desfazer_saque_ml_vendas` e o marcador de `tem_devolucao` em `devolucoes-io.ts` foram corrigidos
para cumprir esse contrato (ver A1/A2 do plano de execução).

A marca d'água vem sempre dos **dados** (`atualizado_em` da última linha recebida), nunca do
relógio do cliente — clock skew perderia updates em silêncio.

### Folga de 60s na marca d'água (obrigatória)

`atualizado_em = now()` no Postgres é o timestamp do **início da transação**, não do commit. Uma
escrita que começou antes de outra mas commitou depois carrega um timestamp **menor** que uma já
visível: se o poll ler entre os dois commits, a marca avança para o valor maior e a linha atrasada
**nunca mais entra no delta** — some do Faturamento até a troca de período. O backfill grava
centenas de vendas em transações concorrentes dentro do mesmo segundo (confirmado em produção:
três linhas em `.326`, `.936`, `.978` do mesmo segundo), então a janela é real, não teórica.

Por isso `marcaDagua` recua o máximo em `FOLGA_MARCA_MS = 60_000` antes de usá-lo como filtro.
Custa reler as poucas linhas do último minuto por tick e fecha a janela. É dado financeiro:
sumiço silencioso de venda não é tradeoff aceitável por alguns KB.

### Armadilha ao recriar as RPCs de saque

A migration de A1 recria `registrar_saque_ml_vendas` / `desfazer_saque_ml_vendas`. O corpo correto
é o **que está em produção** (`pg_get_functiondef`), não o da migration original
`20260702162832`: a E7 (`20260705165828_e7_rls_org.sql`) dropou `is_membro_operacao()` e reescreveu
as duas para `current_org_id()` + filtro `org_id = v_org`. Copiar da migration antiga quebraria o
saque (função inexistente) e **removeria o isolamento entre organizações** — qualquer membro
marcaria saque em venda de outra org. Foi exatamente o erro cometido na primeira tentativa, pego
na revisão.

## Alternativa descartada: Realtime em `ml_vendas`

Supabase Realtime entregaria o delta via websocket sem poll. Descartado porque exige policy de
Realtime própria (a RLS de `select` não cobre Realtime automaticamente), um canal extra por
usuário/janela, e reintroduz o problema original: o payload de cada evento ainda carrega a linha
inteira com itens. O ganho de banda não compensa a complexidade de mais uma superfície
stateful (canal, reconexão, replay) para o mesmo tipo de corte que o watermark já entrega em
poll.

### Chave de cache pela data, não pelo instante

`resolverJanela` chama `new Date()`: 'hoje' e 'mes_atual' têm `ate` = agora, e 'preset' tem
também o `desde` = agora−N. Duas montagens do mesmo período produziam ISOs diferentes por alguns
segundos e, com o ISO cheio na queryKey, viravam **caches distintos**. Como as abas do Faturamento
desmontam ao trocar (Radix `TabsContent`), cada ida e volta entre Vendas e Geografia refazia o
fetch completo da janela e ainda descartava o cache de que o delta depende — medido: 3 fetches
completos em 4 trocas de aba, contra **0** depois da correção.

`chaveJanela` trunca **só o `ate`** na data. Isso é seguro porque não existe venda com
`date_closed` no futuro: duas janelas que terminam no mesmo dia cobrem o mesmo conjunto pelo lado
de cima. A janela real, com hora, continua indo para a query.

O `desde` fica inteiro na chave, de propósito. Truncá-lo também seria mais eficiente e foi a
primeira versão — mas abre um furo financeiro: um preset resolvido às 15:00 começa às 15:00 de N
dias atrás, enquanto um range que escolha aquele mesmo dia começa às 00:00. Colidindo na chave, o
range herdaria o cache do preset e o refetch, em modo delta, nunca traria as vendas da madrugada
que faltam — KPI menor que o real, sem nenhum aviso. Preferimos perder compartilhamento de cache
a arriscar número errado. **Consequência aceita:** telas com período `preset` (Geografia,
Devoluções) continuam refazendo o fetch completo a cada remontagem, porque o `desde` delas é
móvel; 'hoje', 'mes_atual' e 'range' têm `desde` fixo e reaproveitam. Medido na troca de abas:
3 fetches completos em 4 movimentos → 2.

Fechar o resto exigiria mudar a semântica de `preset` para começar à meia-noite, o que altera os
números exibidos — decisão do dono, não de refactor.

## Verificação

- Tick sem mudança: resposta `[]` (~2 bytes) em vez da janela inteira (~120 KB).
- Teste automatizado (`marcaDagua`, `mesclarVendas`) cobre merge idempotente, reordenação por
  `date_closed` e delta vazio preservando a referência (evita re-render).
- Confirmação final é o próximo ciclo de billing, junto com a métrica do ADR-0081.

## Como reverter

Remover o parâmetro `atualizadoDesde` de `buscarVendas` e voltar o `queryFn` de `useVendas` para
`() => buscarVendas(janela, origem, canal)` (fetch completo a cada tick). Não é preciso reverter
a migration — bumpar `atualizado_em` a mais nunca quebrou nada, só deixou de ser aproveitado.
