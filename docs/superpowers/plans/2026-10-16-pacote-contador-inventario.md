# Pacote do contador: inventário (Plano 2b-2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** inventário avaliado por custo médio ponderado móvel de aquisição (hoje, sob demanda) + foto imutável de 31/12 com
confirmação da contagem física + foto no pacote de dezembro.

**Architecture:** o cálculo fica todo em SQL (`inventario_calcular`, uma instrução, replay por SKU sobre o ledger com a
coluna nova `estoque_movimentos.ordem`). A foto é gravada por uma procedure no `pg_cron`. Leitura, contagem e confirmação
passam por uma edge nova `inventario`. O navegador só formata xlsx/pdf e monta o zip, como no 2a/2b-1.

**Tech Stack:** Postgres (plpgsql, pg_cron), Supabase Edge (Deno), React + Vite, vitest, SheetJS/jsPDF/fflate (já usados em
`src/lib/pacote-contador/`).

**Spec:** `docs/superpowers/specs/2026-10-16-pacote-contador-inventario-design.md` (aprovada pelo Diego em 2026-10-16;
Codex 4 rodadas). O executor lê a spec inteira antes da sua task. Toda regra citada como "spec §X" está lá.

## Global Constraints

- Migrations só por `supabase migration new <nome>`. **Nada de `supabase db push` até o Diego pedir o deploy** (Task 9).
  Prova de SQL: `python3 scripts/teste-sql-desfeito.py supabase/tests/<t>.sql <migrations…>` (transação desfeita em
  produção). Sucesso = `TESTE_OK`. Rodar também **sem** a migration nova, para provar o vermelho.
- `npm run db:check` **antes do deploy** (Codex plano r1): vale verde se as únicas divergências listadas forem as
  migrations novas desta branch, só do lado local. Qualquer outra divergência bloqueia. Depois da Task 9, tem de dar
  "alinhadas". Nunca usar `db push` para satisfazer o check.
- Testes SQL rodam dentro de `BEGIN … ROLLBACK` (`scripts/teste-sql-desfeito.py:42`). Nada que faça `COMMIT` (a procedure)
  é chamado neles: os testes usam a função por org da Task 4. O commit da procedure só se prova pelo job real (Task 9).
  Não mexer no `BEGIN` do runner.
- `custo_medio` sai **nulo** quando `qtd_valorizada = 0` (o `c` residual do replay não é exposto); `valor_total = 0.00`.
- Referências fora do repo: memória `~/.claude/projects/-Users-diego-Desktop-IA-Anuncios-MktPlace/memory/project_entrada_nota_compra.md`
  (procedimento da org de teste + VALIDATION); skills `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/skills/docs-update-checklist/SKILL.md`
  e `…/.claude/skills/graphify-update-maintenance/SKILL.md` (ler o SKILL.md e seguir).
- Repo público: fixtures com CNPJ `11222333000181` / `11444777000161`. Nenhum dado real de cliente.
- Org de teste SQL no padrão de `supabase/tests/estoque_rpc_tamanho.sql` (organizations → auth.users → profiles → lotes →
  familias → variacoes). IDs fixos com prefixo `93…`. `now()` é fixo na transação: famílias e movimentos que precisam de
  ordem temporal recebem `criado_em` explícito (update depois da RPC).
- Funções novas: `security invoker`, `set search_path = public, pg_temp` (**exceto** a procedure
  `gerar_fotos_inventario`: sem `set` e sem definer, nomes qualificados `public.`), `revoke all … from public, anon,
  authenticated` e grant só a `service_role` (spec §Matriz de privilégios).
- Família canônica = `distinct on (codigo_pai) … order by criado_em desc`, `kit_multiplicador is null`, **só famílias com
  ≥ 1 variação**.
- Marco de linhagem = `criado_em` da família mais recente do código cujo `lotes.origem = 'planilha'`. Clone, cadastro e
  kit gravam `'manual'` (`adicionar-variacoes-familia/index.ts:318`, `criar-kit-vinculado/processar.ts:512`).
  Movimento com `criado_em <= marco` fica antes do marco.
- Refs de movimento: `inventario:{inventario_id}:{codigo}`. Doc da entrada de sobra: `Inventário DD/MM/AAAA`.
- Nomes de arquivo: `inventario-AAAA-MM-DD.xlsx|pdf` (avulso); `inventario/relatorio-inventario.xlsx|pdf` (pacote de
  dezembro).
- Copy (pt-BR, exata):
  - avisos fixos do relatório: spec §Relatório;
  - status: `Inventário de hoje — não é foto, não confirmado` | `Foto de 31/12 — aguardando contagem` |
    `Confirmado em <data> por <nome>`;
  - aviso de versão: `A contagem mudou em outra aba; recarregue.`;
  - foto ausente: `Foto de 31/12 não gerada — acione o suporte.`
- Modelos: Opus nas Tasks 3–5 (migration, RLS, cálculo fiscal) e na 9 (deploy/validação). Sonnet nas Tasks 1, 2, 6, 7,
  8 e 10.
- Revisão do diff de cada task e pré-merge: Grok 4.7 xhigh (`cursor-agent -p --mode ask --model grok-4.7-xhigh … < /dev/null`).
  Nunca revisor Claude. O Grok pré-merge é rodada única.
- Portão de pré-push: `pnpm preflight` verde.

## Review Focus

1. **Planilha importada às 23:59 de 31/12:** a foto não pode perder os SKUs do produto em transição. O teste "família nova
   vazia" fica no cenário Q da Task 3 e na Task 4 (foto).
2. **Admin com a contagem aberta em duas abas:** a segunda gravação recebe "A contagem mudou em outra aba; recarregue.",
   nunca sobrescreve em silêncio (Tasks 5 e 8).
3. **Confirmação gravada, mas o enqueue do push falhou:** a tela mostra "tentar de novo", e o retry reenfileira a mesma
   lista sem duplicar movimento (Tasks 5 e 6).
4. **Org com milhares de SKUs:** o "inventário de hoje" e a foto cabem no orçamento (≤ 10 s por org no SQL; JSON único, sem
   corte de 1000 linhas) (Tasks 3 e 4).
5. **Suporte trocando de org no meio do download:** o arquivo não sai com dados da org errada (`ErroOrgMudou`, Tasks 7 e
   8).

---

### Task 1: Emenda do ADR-0181 (D-12) — antes de qualquer código

**Files:**
- Modify: `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (linha de status + bloco "Plano 2b-2"
  logo após o bloco do 2b-1, ~linha 205)

- [ ] **Step 1:** Acrescentar o bloco **"Plano 2b-2 — inventário (D-12) — decisões do Diego (2026-10-16)"** com as 4
  decisões da spec (§Decisões do Diego) em uma linha cada, a "Garantia" da spec em 2 linhas e o link da spec e do plano.
  Na linha de status: "Plano 2b-2 em implementação na branch `worktree-adr0181-plano-2b2-inventario`". Registrar em
  "Consequências", como pendências: separação Full/terceiros (decisão 2) e corrida do clone (spec §Limitações).
- [ ] **Step 2:** `pnpm docs:links` → sem link quebrado.
- [ ] **Step 3: Commit** `docs(adr-0181): emenda D-12 — decisões do Plano 2b-2`.

---

### Task 2: Medições só leitura em produção (insumo das Tasks 3–5)

Nada é escrito no banco. Consultas por `POST https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query`
com o `SUPABASE_ACCESS_TOKEN` de `.env.local` (mesmo token de `scripts/teste-sql-desfeito.py`). Só `select`/`show`.

**Files:**
- Create: `docs/superpowers/plans/2026-10-16-pacote-contador-inventario-medicoes.md` (resultado das consultas, sem dado de
  cliente: só contagens e nomes de config)

- [ ] **Step 1:** Medir e registrar:
  - (a) `select max(n) from (select org_id, count(*) n from estoque_movimentos group by 1) t` e o mesmo para variações
    (volume sintético da Task 3), mais `select count(*) from estoque_movimentos` (custo do backfill);
  - (a2) inspeção de código, sem banco: listar todo caminho que insere `variacoes` com `estoque ≠ 0` ou grava
    `variacoes.estoque` fora das 4 RPCs (`ingest-lote/index.ts:345-416`, `adicionar-variacoes-familia/index.ts:362-380`,
    `cadastrar-produto`, `criar-kit-vinculado`, demais por `grep -rn "estoque" supabase/functions --include=*.ts`).
    Classificar cada um como marco (lote 'planilha'), contínuo (clone) ou saldo 0 + ledger, e confirmar que as variações de
    uma família entram num único insert (spec §Universo de SKUs);
  - (b) códigos (org anonimizada como `org-1..n`) com movimento `nfe:` e qualquer outro movimento: quantos são (corte da
    Task 3);
  - (c) transações com o mesmo código em mais de um movimento `nfe:` com o mesmo `criado_em`;
  - (d) `select setting from pg_settings where name = 'cron.timezone'` e `select rolconfig from pg_roles where rolname =
    'postgres'` (timeout da role);
  - (e) quem preenche `estoque_resultante`: `select proname from pg_proc where prosrc ilike '%estoque_resultante%'`.
    Conferir que só são `registrar_entrada`, `ajustar_estoque`, `baixar_estoque` e `estornar_estoque`, e que todas fazem
    insert com resultante nulo e o update depois do `for update` da variação. Função extra → a Task 3 cobre também `before
    insert`.
- [ ] **Step 2: Commit** `docs(adr-0181): medições do Plano 2b-2`.

---

### Task 3: `estoque_movimentos.ordem` + corte do backfill + `inventario_calcular` (Opus)

**Files:**
- Create: `supabase/migrations/<ts>_adr181_inventario_calculo.sql` (via `supabase migration new adr181_inventario_calculo`)
- Create: `supabase/tests/inventario_calculo.sql`

**Interfaces:**
- Produces:
  - coluna `public.estoque_movimentos.ordem bigint`; sequência `public.estoque_movimentos_ordem_seq`;
  - tabela `public.inventario_corte_backfill (org_id uuid, codigo text, ate_ordem bigint, primary key (org_id, codigo))`;
  - `public.inventario_calcular(p_org uuid) returns table (codigo text, codigo_pai text, descricao text, ncm text, unidade
    text, cor text, tamanho text, quantidade_sistema int, qtd_valorizada int, qtd_sem_nota int, custo_medio numeric(14,6),
    valor_total numeric(14,2), marcas text[])`. Marcas possíveis: `sem_nota` (qtd_sem_nota > 0), `historico_incompleto`,
    `ncm_ausente`, `saldo_negativo`.

- [ ] **Step 1: Teste vermelho** `supabase/tests/inventario_calculo.sql`. Cenários com valores exatos. Montagem (assinaturas
  reais):
  - "Nota" = linhas em `notas_compra` (status 'importada'), `notas_compra_itens` e `notas_compra_distribuicao`, mais
    `registrar_entrada(org, codigo, q, null, 'NF', null, user, 'nfe:{chave}:{n_item}:{codigo}')`;
  - "Venda" = `baixar_estoque(org, codigo, qtd, canal, ref)`;
  - "Desfazer" = `desfazer_nota_compra(org, user, nota_id, 'desfeita')`;
  - "Pendente" = `registrar_entrada_nota_pendente(org, chave, codigo, qtd, custo, doc, user, ref)`, chamada **antes** de
    existir a linha em `notas_compra`;
  - "Planilha N" = família nova em lote `origem 'planilha'` com a variação já com `estoque = N`;
  - "Clone" = família nova em lote `'manual'` com `operacao = 'UPDATE'` (o guard só deixa copiar saldo assim,
    `20260820143736_guard_estoque_update_manual.sql:35-43`);
  - "Lacuna" (G) = `set local role estoque_rpc_executor; update variacoes set estoque = 3 …; reset role;` (o guard libera
    só esse papel, `20260804113000…:56-60`);
  - cada passo grava `criado_em` explícito, crescente (famílias e movimentos), por `update` depois da RPC.

  A tabela abaixo usa a saída de `inventario_calcular`. "—" = nulo.

  | Cenário | Sequência | qtd_valorizada | qtd_sem_nota | custo_medio | valor_total | marcas contém |
  |---|---|---|---|---|---|---|
  | ordem | nota com o mesmo SKU nos itens 1 (10 @ 10) e 2 (10 @ 20), mesma transação | 20 | 0 | 15.000000 | 300.00 | — |
  | A | planilha 5 → nota 10 @ 10 → venda 7 | 8 | 0 | 10.000000 | 80.00 | — |
  | B | nota 10 @ 10 → venda 10 → entrada manual 10 | 0 | 10 | — | 0.00 | sem_nota |
  | C | nota 10 @ 10 → venda 5 → nota 10 @ 20 | 15 | 0 | 16.666667 | 250.00 | — |
  | D | nota 10 @ 10 → venda 10 → nota 4 @ 30 | 4 | 0 | 30.000000 | 120.00 | — |
  | E | nota 10 @ 10 → planilha 0 → planilha 10 | 0 | 10 | — | 0.00 | historico_incompleto, sem_nota |
  | F | nota 10 @ 10 → planilha −5 → nota 10 @ 20 | 5 | 0 | 20.000000 | 100.00 | historico_incompleto |
  | G | nota 10 @ 10 → `update variacoes set estoque = 3` → venda 1 | 0 | 2 | — | 0.00 | historico_incompleto |
  | H1 | nota 10 @ 10 → exclui a família → planilha 10 (sem limpeza) | 0 | 10 | — | 0.00 | historico_incompleto |
  | H2 | nota 10 @ 10 → exclui → cadastro manual (lote 'manual', saldo 0) + `registrar_entrada` 10 ref `cadastro:x:y` | 0 | 10 | — | 0.00 | historico_incompleto, sem_nota |
  | H1′/H2′ | H1 e H2 seguidos de `limpar_movimentos_orfaos(org)` (preserva, o código existe) | iguais a H1/H2 | | | | |
  | I | nota 10 @ 10 → clone (família nova em lote 'manual' copiando estoque 10) → venda 2 | 8 | 0 | 10.000000 | 80.00 | — |
  | J | nota 10 @ 10 + linha em `inventario_corte_backfill` com `ate_ordem` = ordem da entrada | 0 | 10 | — | 0.00 | historico_incompleto |
  | K | nota 10 @ 10 → `desfazer_nota_compra(…, 'desfeita')` | 0 | 0 | — | 0.00 | — |
  | L | `registrar_entrada_nota_pendente` 10 antes das linhas da nota → depois as linhas (custo 12) | 10 | 0 | 12.000000 | 120.00 | — |
  | M | linhas de nota importada sem o movimento `nfe:` + planilha 3 | 0 | 3 | — | 0.00 | historico_incompleto |
  | N | planilha 7 | 0 | 7 | — | 0.00 | sem_nota |
  | O | planilha −3 | 0 | 0 | — | 0.00 | saldo_negativo |
  | P | nota 10 @ 1 → planilha 10 → nota 10 @ 100 → venda 10 | 10 | 0 | 100.000000 | 1000.00 | historico_incompleto |
  | Q | família com 1 variação + família mais nova do mesmo `codigo_pai` sem variação | SKU presente | | | | |

  Mais as asserções:
  - em todas as linhas de todos os cenários: `qtd_valorizada ≤` soma das quantidades de nota importada do código,
    `qtd_valorizada + qtd_sem_nota = max(quantidade_sistema, 0)`, e `custo_medio` (quando não nulo) entre o menor e o maior
    `custo_aquisicao_unit` das notas do código;
  - `ordem` atribuída e crescente nas 4 RPCs (entrada, venda, estorno, ajuste);
  - um insert com `estoque_resultante` já preenchido também recebe `ordem`, se a Task 2 achou esse caminho;
  - `has_function_privilege('anon'|'authenticated', 'public.inventario_calcular(uuid)', 'execute') = false`;
  - `ncm_ausente` quando `familias.ncm is null`;
  - `descricao = coalesce(descricao_fiscal, nome_pai)`;
  - kit (`kit_multiplicador` não nulo) fora.

  Termina com `raise exception 'TESTE_OK'`.
- [ ] **Step 2:** `python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_calculo.sql` → falha (função
  inexistente).
- [ ] **Step 3: Migration.**
  - `alter table estoque_movimentos add column ordem bigint`, sequência, `grant usage on sequence … to
    estoque_rpc_executor`;
  - **backfill atômico** (a migration roda numa transação), nesta ordem:
    - `lock table public.estoque_movimentos in share row exclusive mode` (bloqueia escrita, deixa leitura) — duração medida
      pelo (a) da Task 2;
    - `update … set ordem = s.rn from (select id, row_number() over (order by criado_em, id) rn …) s`;
    - `select setval('public.estoque_movimentos_ordem_seq', coalesce(max(ordem), 0) + 1, false)`;
    - preenche `inventario_corte_backfill` (RLS ligada, sem policy) com `max(ordem)` de cada código que tem movimento
      `nfe:` e outro movimento (consulta (b) da Task 2);
    - **só então** cria o trigger `before update` que preenche `ordem := nextval(…)` quando `old.estoque_resultante is
      null and new.estoque_resultante is not null and new.ordem is null` (mais `before insert` se a Task 2 mandar).

    Assim, nenhum movimento novo recebe ordem antiga nem cai abaixo do corte. O teste confere que `nextval` > `max(ordem)`
    do backfill;
  - `inventario_calcular` como **uma instrução SQL** (`language sql`, CTE recursiva por SKU), implementando o pseudocódigo
    da spec §Critério de avaliação literalmente. Onde ele conta como "entrada de nota com custo": movimento com
    `referencia_externa = 'nfe:'||chave||':'||n_item||':'||codigo` e nota `importada`; `q = quantidade` da distribuição
    (soma, se repetida), `u = custo_aquisicao_unit`. Movimentos antes do marco ou com `ordem <= ate_ordem` do corte não
    entram, e se havia entrada de nota lá a marca é `historico_incompleto`.
- [ ] **Step 4:** `python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_calculo.sql supabase/migrations/<ts>_adr181_inventario_calculo.sql` → `TESTE_OK`.
- [ ] **Step 5: Orçamento.** No mesmo teste (bloco separado), gerar volume sintético = (a) da Task 2 numa org de teste e
  rodar `explain analyze select * from inventario_calcular(org)`. Registrar o tempo em `…-medicoes.md`. Critério: **≤ 10
  s**. Acima disso, criar `index (org_id, codigo, ordem)` e medir de novo.
- [ ] **Step 6:** `npm run db:check` → só esta migration pendente do lado local (Global Constraints).
- [ ] **Step 7: Commit** `feat(adr-0181): ordem do ledger e cálculo do custo médio do inventário`.

---

### Task 4: Foto de 31/12 — tabelas, imutabilidade, procedure, cron, leitura JSON (Opus)

**Files:**
- Create: `supabase/migrations/<ts>_adr181_inventario_foto.sql`
- Create: `supabase/tests/inventario_foto.sql`

**Interfaces:**
- Consumes: `inventario_calcular(p_org)` (Task 3).
- Produces:
  - tabelas `public.inventarios` e `public.inventarios_itens` com as colunas exatas da spec §Modelo de dados;
  - `public.gerar_foto_inventario_org(p_org uuid, p_data_base date, p_origem text) returns text` (função, **sem
    commit**): grava a foto de uma org e devolve `'gerada' | 'existia' | 'falhou'`. Pula a org que já tem cabeçalho
    'aberto'/'confirmado'. Apaga e refaz a que está em 'falhou'. Erro do cálculo → `exception when others` grava o cabeçalho
    'falhou' com `sqlerrm`. É o que os testes chamam;
  - `public.inventario_data_base(p_agora timestamptz) returns date`;
  - `public.gerar_fotos_inventario(p_data_base date default null, p_origem text default 'cron', p_org uuid default null)`
    (procedure): só itera as orgs elegíveis chamando `gerar_foto_inventario_org` e faz `commit` depois de cada uma;
  - `public.inventario_hoje_json(p_org uuid) returns jsonb` → `{cabecalho:{data_base, gerado_em, cnpj, inscricao_estadual,
    razao_social, status:'hoje'}, itens:[…linhas de inventario_calcular…]}`;
  - `public.inventario_foto_json(p_org uuid, p_data_base date) returns jsonb` → `null` (sem foto) ou `{cabecalho:{id,
    data_base, gerado_em, origem, status, erro, versao, cnpj, inscricao_estadual, razao_social, confirmado_em,
    confirmado_por_nome}, itens:[…todas as colunas de inventarios_itens…]}`, numa instrução só.

- [ ] **Step 1: Teste vermelho** `supabase/tests/inventario_foto.sql`. Ele nunca chama a procedure (tem `COMMIT`); usa
  `gerar_foto_inventario_org`:
  - **elegibilidade:** a query de orgs elegíveis da procedure fica numa view ou função `public.inventario_orgs_elegiveis()
    returns setof uuid`, testada à parte. A org PJ com CNPJ `11222333000181` e módulo `estoque` entra; org PF, org sem
    módulo e org sem CNPJ não entram;
  - **data-base:** `2026-12-31 23:59 -03` → `2026-12-31`; `2027-01-01 01:00 -03` → `2026-12-31`; `2026-12-31 10:00 -03` →
    `2025-12-31`;
  - **idempotência:** a segunda chamada devolve `'existia'` e não duplica; foto em 'falhou' é refeita (`'gerada'`);
  - **falha isolada:** dentro da transação do teste (desfeita no fim), `create or replace function
    public.inventario_calcular` com uma versão que dá `raise exception` só para a org A, mantendo a assinatura → `'falhou'`
    com `erro` na A; logo em seguida a org B → `'gerada'`. Depois recriar a versão real (ou separar em bloco próprio);
  - **família nova vazia** (Review Focus 1): o SKU continua na foto;
  - **1.200 SKUs:** `jsonb_array_length(inventario_hoje_json(org)->'itens') = 1200` e o mesmo para `inventario_foto_json`
    (resposta escalar única, sem corte de 1000);
  - **imutabilidade, itens:** update de cada coluna da foto (`codigo`, `codigo_pai`, `descricao`, `ncm`, `unidade`, `cor`,
    `tamanho`, `quantidade_sistema`, `qtd_valorizada`, `qtd_sem_nota`, `custo_medio`, `valor_total`, `marcas`) e de
    `inventario_id`/`org_id` → erro. `quantidade_contada` com cabeçalho 'confirmado' ou 'falhou' → erro. Qualquer
    `*_final` sem a flag `publiai.inventario_confirmando` → erro. Insert direto → erro;
  - **imutabilidade, cabeçalho:** `status` de 'aberto' para 'confirmado' sem a flag → erro; `cnpj`, `data_base`,
    `gerado_em` → erro; qualquer update com 'confirmado' → erro;
  - **privilégios, um por chamada:** `has_table_privilege('authenticated', t, p) = false` para `t` em (`inventarios`,
    `inventarios_itens`, `inventario_corte_backfill`) e `p` em (`insert`, `update`, `delete`); o mesmo para `anon`, com
    `select` incluído. Como `authenticated` da org B, `select` em `inventarios` → só a org B. `has_function_privilege` de
    `anon`/`authenticated` em cada função nova = false. Positivo: `set local role service_role` gera e lê a foto;
  - **duas orgs com foto na mesma data:** `inventario_foto_json(A, d)` só traz itens de A, e o de B só de B. Sem foto →
    `null`. `inventario_hoje_json` traz `status 'hoje'` e as linhas.

  Termina com `TESTE_OK`.
- [ ] **Step 2:** rodar sem a migration → falha.
- [ ] **Step 3: Migration.**
  - Tabelas, FK composta, `unique (org_id, data_base)`, RLS `select` por `(select current_org_id())`.
  - Triggers de imutabilidade:
    - a flag de transação é `current_setting('publiai.inventario_confirmando', true) = 'on'`;
    - o insert em itens só passa com `publiai.inventario_gerando = 'on'`, que **`gerar_foto_inventario_org`** liga com
      `set_config(…, true)` antes de inserir os itens e desliga logo depois (Codex plano r2: os testes chamam a função
      direto).
  - A procedure, em ordem:
    - resolve `p_data_base` por `inventario_data_base(now())` quando nulo;
    - itera `inventario_orgs_elegiveis()` (ou só `p_org`);
    - para cada org: `perform public.gerar_foto_inventario_org(org, data, origem); commit;`.

    A procedure é a única peça sem teste SQL. O commit dela é provado pelo job real na Task 9.
  - Cron: desagenda o job `inventario-foto-31-12` por nome e agenda com a expressão da Task 2 (d) (`59 2 1 1 *` se o fuso
    for GMT), comando exatamente `call public.gerar_fotos_inventario()`.
- [ ] **Step 4:** teste com a migration da Task 3 + esta → `TESTE_OK`.
- [ ] **Step 5:** `npm run db:check` → só as migrations da branch pendentes do lado local.
- [ ] **Step 6: Commit** `feat(adr-0181): foto anual imutável do inventário`.

---

### Task 5: Contagem e confirmação no banco (Opus)

**Files:**
- Create: `supabase/migrations/<ts>_adr181_inventario_confirmar.sql`
- Create: `supabase/tests/inventario_confirmar.sql`

**Interfaces:**
- Produces:
  - `public.salvar_contagem_inventario(p_org uuid, p_id uuid, p_versao int, p_itens jsonb) returns int` (nova versão).
    `p_itens = [{codigo, quantidade_contada: int|null, justificativa: text|null}]`;
  - `public.confirmar_inventario(p_org uuid, p_id uuid, p_versao int, p_user uuid) returns jsonb` →
    `{produtos: [{codigo_pai text, reativar boolean}]}` (`reativar = true` quando o produto teve sobra).

- [ ] **Step 1: Teste vermelho** `supabase/tests/inventario_confirmar.sql`, sobre uma foto gerada por
  `gerar_foto_inventario_org` (nunca pela procedure) numa org de teste:
  - **salvar:**
    - versão errada → erro com a mensagem exata `A contagem mudou em outra aba; recarregue.`;
    - código fora da foto → erro;
    - contagem −1 → erro;
    - contada ≠ sistema sem justificativa ou com justificativa em branco → erro;
    - caso válido devolve `versao + 1`;
  - **confirmar, falta:** sistema 10, contada 7, saldo de hoje 9 → saldo 6, movimento `ajuste` com ref
    `inventario:{id}:{codigo}`, `qtd_final = 7`;
  - **confirmar, sobra:** sistema 2, contada 5, saldo de hoje 2 → saldo 5, movimento `entrada` com `custo_unitario` nulo
    e `variacoes.custo` inalterado, `qtd_sem_nota_final` +3, `reativar = true`;
  - **confirmar, recusas:**
    - falta 5 com saldo de hoje 3 → recusa inteira, mensagem lista o código, nenhum movimento gravado;
    - diferença sem justificativa → recusa;
    - versão obsoleta → recusa;
    - cabeçalho 'falhou' → recusa;
  - **idempotência:** a segunda chamada devolve a mesma lista `produtos` e não cria movimento;
  - **guard canônico:** um trigger temporário `after insert on estoque_movimentos` (função em `pg_temp`, só para ref
    `inventario:%`) insere uma família mais nova do mesmo código com 1 variação. A confirmação tem de falhar com `40001`, e
    nenhum movimento pode sobrar (a transação aborta; conferir num bloco `begin … exception` do teste);
  - **positivo como `service_role`:** `set local role service_role; select confirmar_inventario(…)` aplica;
  - **negativo:** `anon`/`authenticated` sem `execute`; `p_id` de outra org → erro.

  Termina com `TESTE_OK`.
- [ ] **Step 2:** rodar sem a migration → falha.
- [ ] **Step 3: Migration.** As duas funções seguem a spec §Confirmação passo a passo:
  - travam o cabeçalho com `for update` filtrando `id = p_id and org_id = p_org`;
  - ordem por `codigo`;
  - trava e guard canônico copiados de `20261016001451_adr181_desfazer_guard_canonico.sql:28-57`;
  - `set_config('publiai.inventario_confirmando','on', true)` antes de gravar as colunas `*_final` e a transição;
  - a lista de retorno vem dos movimentos `inventario:{id}:%` (falta → `reativar false`, sobra → `true`; produto com as
    duas → `true`).
- [ ] **Step 4:** teste com as migrations das Tasks 3, 4 e 5 → `TESTE_OK`.
- [ ] **Step 5:** `npm run db:check` → só as migrations da branch pendentes do lado local.
- [ ] **Step 6: Commit** `feat(adr-0181): contagem física e confirmação do inventário`.

---

### Task 6: Edge `inventario` (Sonnet)

**Files:**
- Create: `supabase/functions/inventario/index.ts`, `processar.ts`, `validar.ts`
- Create: `supabase/functions/inventario/__tests__/processar.test.ts`, `__tests__/validar.test.ts`
- Modify: `supabase/config.toml` (bloco `[functions.inventario]` com `verify_jwt = true`, comentário `# ADR-0181 D-12 —
  inventário (hoje, foto, contagem, confirmação).`)

**Interfaces:**
- Consumes: as 4 funções SQL das Tasks 4 e 5; `requireUserOrg` (`_shared/auth.ts:36`), `exigirModulo`
  (`_shared/produto/modulo.ts`), `auditarOperacaoSuporte`, `enfileirarSincronizacaoEstoque(job, orgId)`
  (`_shared/queue.ts:222`).
- Produces (contrato HTTP, `POST`, corpo JSON):
  - `{acao:'hoje'}` → `200 {cabecalho, itens}`;
  - `{acao:'foto', data_base:'AAAA-12-31'}` → `200 {cabecalho, itens}` ou `200 {vazio:true}`;
  - `{acao:'salvar', inventario_id, versao, itens}` → `200 {versao}`; versão obsoleta → `409 {error:'A contagem mudou em
    outra aba; recarregue.'}`;
  - `{acao:'confirmar', inventario_id, versao}` → `200 {push:'ok'|'pendente'}`;
  - não-admin em `salvar`/`confirmar` → `403`; módulo desligado → `403`; corpo inválido → `400`.
  - Toda resposta 200 leva `X-Org-Id` **e** `Access-Control-Expose-Headers: X-Org-Id`, como em
    `baixar-notas-venda/index.ts:56-57`. Sem o expose, o navegador não lê o header. O card confere a org, como em
    `baixar.ts`. O teste de `processar` confere os dois headers.

- [ ] **Step 1: Testes vermelhos.**
  - `validar.test.ts`: ação desconhecida; `data_base` que não é `AAAA-12-31`; `versao` não inteira; itens com
    `quantidade_contada` negativa ou não inteira → erro.
  - `processar.test.ts` (deps falsas como em `ajustar-estoque/__tests__/processar.test.ts`):
    - `confirmar` enfileira um job por `codigo_pai` com `canal_origem: null` e `reativar` vindo do SQL;
    - um enqueue que lança → `push:'pendente'`, sem lançar erro;
    - o retry enfileira de novo a mesma lista;
    - `salvar` traduz o erro de versão do SQL em `409`.
- [ ] **Step 2:** `pnpm test -- supabase/functions/inventario` → falha.
- [ ] **Step 3:** Implementar no padrão de `ajustar-estoque/index.ts`:
  - `requireUserOrg(req, { access: acao === 'hoje' || acao === 'foto' ? 'read' : 'write' })`;
  - admin obrigatório em `salvar`/`confirmar`;
  - `exigirModulo(admin, orgId, 'estoque')`;
  - `auditarOperacaoSuporte` em todas as ações quando há sessão de suporte;
  - RPC via `admin.rpc`, repassando o JSON sem reprocessar.
- [ ] **Step 4:** `pnpm test -- supabase/functions/inventario` → passa; `pnpm lint:functions && pnpm check:functions`
  verdes.
- [ ] **Step 5: Commit** `feat(adr-0181): edge inventario`.

---

### Task 7: Relatório e fonte no navegador (Sonnet)

**Files:**
- Create: `src/lib/pacote-contador/tipos-inventario.ts`, `inventario-fonte.ts`, `relatorio-inventario-xlsx.ts`,
  `relatorio-inventario-pdf.ts`
- Modify: `src/lib/pacote-contador/montar.ts` (parâmetro opcional `inventario?: { xlsx: Uint8Array; pdf: Uint8Array }` →
  `inventario/relatorio-inventario.xlsx|pdf`; função `nomeInventarioHoje(agora: Date): string` →
  `inventario-AAAA-MM-DD`, data em America/Sao_Paulo)
- Test: `src/lib/pacote-contador/__tests__/relatorio-inventario.test.ts`, `inventario-fonte.test.ts`, `montar.test.ts`

**Interfaces:**
- Produces:
  - `type ItemInventario` e `type LeituraInventario = { cabecalho: CabecalhoInventario; itens: ItemInventario[] }`,
    espelhando o JSON da Task 4;
  - `buscarInventarioHoje(orgEsperada: string, signal?: AbortSignal): Promise<LeituraInventario>`;
  - `buscarFoto(dataBase: string, orgEsperada: string, signal?: AbortSignal): Promise<LeituraInventario | null>` (null =
    `{vazio:true}`; erro de rede ou HTTP lança `ErroPacote`/`ErroRede`; org divergente lança `ErroOrgMudou`, reusando as
    classes de `baixar.ts`);
  - `salvarContagem(id: string, versao: number, itens: ContagemItem[]): Promise<number>`;
  - `confirmarInventario(id: string, versao: number): Promise<'ok' | 'pendente'>`;
  - `gerarRelatorioInventarioXlsx(l: LeituraInventario): Uint8Array`, `montarRelatorioInventarioPdf(l:
    LeituraInventario): jsPDF` e `gerarRelatorioInventarioPdf(l: LeituraInventario): Uint8Array`;
  - `COLUNAS_LIVRO = ['Código', 'Descrição', 'NCM', 'Unidade', 'Cor', 'Tamanho', 'Quantidade', 'Qtd. avaliada', 'Custo
    médio unitário', 'Valor total', 'Qtd. sem nota de compra', 'Marcas']` e `COLUNAS_CONFERENCIA_INV = ['Código',
    'Descrição', 'Sistema', 'Contada', 'Diferença', 'Justificativa', 'Marcas']`.
  - Valores do Livro (quantidade, avaliada, sem nota, valor): foto 'confirmado' → colunas `*_final`; foto 'aberto' e
    "hoje" → colunas da foto/cálculo (`quantidade_sistema`, `qtd_valorizada`, `qtd_sem_nota`, `valor_total`). A contagem
    em andamento (aberto) aparece **só** na Conferência (sistema, contada, diferença, justificativa), nunca misturada à
    avaliação (Codex plano r2). Teste: foto aberta com 10 avaliadas a R$ 10 e contada 7 → Livro mostra 10 / R$ 100,00, e
    a Conferência mostra 10 → 7.

- [ ] **Step 1: Testes vermelhos** (`relatorio-inventario.test.ts`; xlsx lido com SheetJS como em
  `relatorio-compras.test.ts`; PDF por `montarRelatorioInventarioPdf(...).output()` como em `relatorio-pdf.test.ts`):
  - **xlsx e PDF:**
    - cabeçalho do Livro = `COLUNAS_LIVRO`;
    - Livro sem as linhas de quantidade final ≤ 0;
    - foto confirmada usa as colunas `*_final`;
    - Conferência com a divergência sistema 4 → contada 0 e a justificativa, e com as linhas marcadas `saldo_negativo`,
      `historico_incompleto` e `ncm_ausente`;
    - totais: valor avaliado, unidades avaliadas, unidades sem nota;
    - os 5 avisos fixos com o texto exato da spec;
    - status com o texto exato dos 3 casos;
    - CNPJ `11222333000181`;
    - bytes do PDF começam com `%PDF`.

  `inventario-fonte.test.ts`: `X-Org-Id` divergente → `ErroOrgMudou`; `{vazio:true}` → `null`; 500 → lança.

  `montar.test.ts`: com `inventario`, o zip tem `inventario/relatorio-inventario.xlsx`; sem, não tem.
- [ ] **Step 2:** `pnpm test -- src/lib/pacote-contador` → falha.
- [ ] **Step 3:** Implementar nos moldes de `relatorio-compras-xlsx.ts` e `relatorio-compras-pdf.ts`. Valores em reais
  com 2 casas, custo médio com 6.
- [ ] **Step 4:** `pnpm test -- src/lib/pacote-contador` → passa.
- [ ] **Step 5: Commit** `feat(adr-0181): relatório do inventário (xlsx/pdf)`.

---

### Task 8: UI no card + tela de contagem + pacote de dezembro (Sonnet)

**Files:**
- Modify: `src/components/estoque/pacote-contador/card-pacote-contador.tsx`
- Modify: `src/lib/pacote-contador/tipos.ts:20-32` (campo opcional `avisos?: string[]` em `conferencia`: avisos sem selo
  PARCIAL) e `src/lib/pacote-contador/cabecalho.ts` (`linhasConferencia` imprime `avisos` logo depois dos avisos fixos;
  xlsx e PDF de vendas usam essa função)
- Modify: `src/lib/pacote-contador/montar.ts` (`ultimoTrintaEUmDezembro(agora: Date): string` → `AAAA-12-31` do último
  31/12 até agora, em America/Sao_Paulo; constante `INVENTARIO_DESDE = '2026-12-31'`)
- Create: `src/components/estoque/pacote-contador/dialog-contagem-inventario.tsx`
- Test: `src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx` (estender),
  `__tests__/dialog-contagem-inventario.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`buscarInventarioHoje`, `buscarFoto`, `salvarContagem`, `confirmarInventario`, geradores,
  `montarPacote`, `nomeInventarioHoje`); `useProfile().isAdmin`.

- [ ] **Step 1: Testes vermelhos.**
  - **Card:**
    - botão "Inventário de hoje" baixa `inventario-AAAA-MM-DD.xlsx` e `.pdf`;
    - mês `AAAA-12` com foto → o zip tem `inventario/`;
    - mês `AAAA-12` sem foto → zip sem `inventario/`, Conferência com "foto de 31/12 inexistente" e **sem** PARCIAL;
    - mês `AAAA-12` com erro ao ler a foto → toast de erro e nenhum `salvarArquivo`;
    - na abertura, o card busca a foto de `ultimoTrintaEUmDezembro(agora)`;
    - foto 'aberto' → aviso "Foto de 31/12 aguardando contagem" + botão "Conferir contagem";
    - 'falhou' → "Foto de 31/12 não gerada — acione o suporte.";
    - ausente → a mesma frase **só se** a data-base for `>= INVENTARIO_DESDE` (em 10/2026, sem foto de 2025-12-31, não
      aparece aviso nenhum);
    - `avisos` com "foto de 31/12 inexistente" aparece na Conferência do xlsx **e** do PDF de vendas (teste em
      `relatorio-xlsx.test.ts` e `relatorio-pdf.test.ts`), sem PARCIAL;
    - org trocada no meio → nada salvo.
  - **Diálogo:**
    - justificativa obrigatória quando contada ≠ sistema (o botão Confirmar desabilita);
    - não-admin não vê Salvar/Confirmar;
    - 409 → mensagem exata `A contagem mudou em outra aba; recarregue.`;
    - o diálogo de confirmação resume faltas e sobras e avisa "o estoque e os anúncios serão atualizados";
    - `push:'pendente'` → botão "Tentar de novo" que chama `confirmarInventario` de novo.
- [ ] **Step 2:** `pnpm test -- src/components/estoque/pacote-contador` → falha.
- [ ] **Step 3:** Implementar:
  - a geração do pacote de dezembro chama `buscarFoto(\`${ano}-12-31\`, org, ctl.signal)` antes de `montarPacote`, com
    `conferir()` logo depois;
  - o botão "Inventário de hoje" usa a mesma trava `emCurso` e o mesmo `conferir()`;
  - em dezembro sem foto, `vendas.conferencia.avisos = ['Foto de 31/12 inexistente — o inventário não vai neste pacote.']`
    (texto exato);
  - a tela de contagem usa os componentes de UI já existentes em `src/components/ui/`.
- [ ] **Step 4:** `pnpm test -- src/components/estoque/pacote-contador` → passa.
- [ ] **Step 5: Commit** `feat(adr-0181): inventário no card do pacote do contador`.

---

### Task 9: Validação em runtime (só depois do "pode fazer o deploy" do Diego)

**Gate:** o Diego pediu merge e deploy. Antes disso o plano para na Task 10. Sequência: Task 10 → merge → esta task.

- [ ] **Step 1:** `supabase db push`, `supabase functions deploy inventario`, conferir a versão ativa
  (`supabase functions list`). `select jobname, schedule, command from cron.job where jobname = 'inventario-foto-31-12'`
  → o comando é exatamente `call public.gerar_fotos_inventario()`.
- [ ] **Step 2:** Org de teste descartável PJ (CNPJ `11444777000161`, módulo `estoque`) + conta VALIDATION (procedimento da
  memória citada em Global Constraints). Dois SKUs:
  - **SKU 1:** planilha de 5 un → nota de 10 @ R$ 10 importada pela tela → ajuste para 8 (−7);
  - **SKU 2:** planilha de 4 un, sem nota.

  Conferir que o "inventário de hoje" baixado mostra:
  - SKU 1: 8 avaliadas, R$ 80,00;
  - SKU 2: 0 avaliadas, 4 sem nota.
- [ ] **Step 3:** Agendar um job **temporário** do pg_cron, `call public.gerar_fotos_inventario('2025-12-31', 'manual',
  '<org teste>')` (2025-12 aparece no seletor de meses em 10/2026), para daqui a 2 minutos. Conferir:
  - `cron.job_run_details` com status `succeeded`;
  - a foto gravada e visível de outra conexão (prova do commit).

  Depois desagendar o job.
- [ ] **Step 4:** Com o card aberto (busca a foto de 2025-12-31):
  1. Aparece "Foto de 31/12 aguardando contagem".
  2. Em "Conferir contagem": SKU 1 contado 6 (falta 2, justificativa) e SKU 2 contado 5 (sobra 1, justificativa). Salvar,
     confirmar.
  3. Conferir no banco: SKU 1 com saldo 6 e movimento `ajuste`; SKU 2 com saldo 5 e movimento `entrada` sem custo, ambos
     com ref `inventario:{id}:{codigo}`. Conferir também 2 jobs na fila QStash `estoque-…`.
  4. Gerar o pacote de 2025-12. O zip tem `inventario/relatorio-inventario.xlsx` e `.pdf` com "Confirmado em…" e as
     colunas finais.
  5. Abrir xlsx e PDF e conferir os números à mão.
- [ ] **Step 5: Limpeza total.** Org, usuário de teste, fotos, movimentos, notas e objetos no bucket. Conferir por consulta
  que zerou.

---

### Task 10: Docs, Graphify e portão de entrega (Sonnet)

**Files:**
- Modify:
  - `docs/decisions/0181-…md` (status final do 2b-2);
  - `docs/reference/edge-functions.md` (edge `inventario`);
  - `docs/reference/modelo-de-dados.md` (`inventarios`, `inventarios_itens`, `inventario_corte_backfill`,
    `estoque_movimentos.ordem`);
  - `docs/reference/glossario.md` (Custo médio de aquisição, Foto de inventário, Unidades sem nota de compra);
  - `obsidian-vault/03-Módulos/Estoque.md` e `Fiscal.md`;
  - `docs/project-status.md`;
  - `docs/TASKS.md`.

- [ ] **Step 1:** Atualizar os docs listados, seguindo o mapeamento de
  `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/skills/docs-update-checklist/SKILL.md`.
- [ ] **Step 2:** Graphify `--update` e `python3 scripts/graphify-podar-falsos.py`, seguindo
  `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/skills/graphify-update-maintenance/SKILL.md`.
- [ ] **Step 3:** `pnpm preflight` → verde (colar o resumo).
- [ ] **Step 4:** Revisão do Grok 4.7 xhigh sobre o diff da branch (rodada única), corrigir os achados, `pnpm preflight`
  de novo.
- [ ] **Step 5: Commit + push** da branch; CI verde (`frontend`, `backend-lint`). Merge e deploy só quando o Diego pedir
  (então a Task 9).
