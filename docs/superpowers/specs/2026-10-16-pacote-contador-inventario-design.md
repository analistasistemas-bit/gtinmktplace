# Pacote do contador: inventário (ADR-0181, Plano 2b-2) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-12; D-13, parte "inventário")
**Base:** Planos 1, 2a e 2b-1 em produção (main `1344d638`) — notas de compra, card "Pacote do contador" em `/estoque`.
**Revisão:** adversarial Codex `gpt-6.1-sol` high, rodada 1 (2026-10-16): 14 achados incorporados (marcados `[Rn]`).

## Objetivo

Dar à empresa e ao contador o inventário avaliado pelo **custo médio ponderado móvel de aquisição**, sem inventar custo:

- **Inventário de hoje** — calculado na hora, sob demanda, não grava nada;
- **Foto de 31/12** — gravada automaticamente e imutável, base do Livro Registro de Inventário (modelo 7);
- **Confirmação da contagem física** sobre a foto — diferenças justificadas viram movimento de estoque.

**Sucesso:** em janeiro a empresa abre a foto de 31/12, confere a contagem, confirma, e o pacote de dezembro leva o
inventário confirmado. Nenhum SKU aparece com custo que não veio de nota; nenhuma unidade nem divergência some do relatório.
Erro de avaliação, quando inevitável, é sempre **para menos** (unidade com nota tratada como "sem nota"), nunca para mais.

## Decisões do Diego (2026-10-16)

1. **Camadas por SKU.** As unidades com nota são avaliadas pelo custo médio móvel delas. O resto do saldo aparece na mesma
   linha como **"sem nota de compra"**: quantidade, sem valor. Convenção: **as unidades sem nota saem primeiro** (vendas,
   ajustes). Planilha, cadastro manual e entrada manual são "sem nota", inclusive quando informaram custo — esse custo é de
   precificação (`variacoes.custo`) e não entra no pacote contábil.
2. **Separação próprio / Full / terceiros fora da v1.** O saldo total sai como estoque próprio, com aviso fixo: o saldo inclui
   o que estiver no armazém do ML (Full), que a empresa separa na contagem, e mercadoria de terceiros não é controlada. O banco
   não separa Full (um saldo por SKU). O ADR registra a pendência.
3. **Foto em tabela + diferença vira movimento.** Tabelas `inventarios` e `inventarios_itens` (migration), imutáveis por
   trigger; `pg_cron` em 31/12 23:59 (America/Sao_Paulo). A empresa digita a contagem (padrão = quantidade do sistema); toda
   diferença exige justificativa. Ao confirmar, **falta vira ajuste relativo** e **sobra vira entrada sem custo**, pelo fluxo
   normal (com push ao canal), e a foto trava.
4. **Entrega:** botão próprio **"Inventário de hoje"** no card (`inventario-AAAA-MM-DD.xlsx`/`.pdf`, avulso) + a **foto de
   31/12 dentro do pacote de dezembro** (`pacote-AAAA-12.zip` → `inventario/`), com status "confirmado" ou "aguardando
   contagem". Os outros meses não levam inventário.

## Ordem dos movimentos `[R2]`

`(criado_em, id)` não serve: `criado_em = now()` é o início da transação, `id` é UUID aleatório, e
`registrar_entrada`/`ajustar_estoque` inserem o movimento **antes** de travar a variação
(`20260903002527_kit_vinculado_guards.sql:61,71,121,130`).

**Coluna nova `estoque_movimentos.ordem bigint`** (nullable, sem default: sem reescrita da tabela) + sequência + trigger
`before update` que atribui `ordem = nextval()` quando `estoque_resultante` passa de null a valor. Esse update acontece
**depois** do `update variacoes`, com a linha da variação ainda travada até o commit. Assim, para um mesmo SKU, `ordem`
segue a ordem real de aplicação, inclusive na mesma transação (nota com o SKU em dois itens). Nenhuma RPC muda. O plano
confere que **todas** as RPCs que preenchem `estoque_resultante` (`registrar_entrada`, `ajustar_estoque`, `baixar_estoque`,
estorno) o fazem com a variação travada, e que nenhuma insere o movimento já com `estoque_resultante` preenchido. Se alguma
fizer isso, o trigger também cobre `before insert`.

**Backfill** dos movimentos existentes: `ordem` por `(criado_em, id)`. O plano mede em produção (só leitura) quantas
transações têm o mesmo SKU em mais de um movimento `nfe:`. Se houver, o backfill dessas usa a cadeia
`estoque_anterior → estoque_resultante`.

## Critério de avaliação (fonte única em SQL)

Uma função SQL `inventario_calcular(p_org uuid)` calcula tudo. O inventário de hoje e a foto a usam, e o TypeScript só
formata. **É uma única instrução SQL** (CTE recursiva por SKU), para ler saldo, notas e movimentos num só snapshot
`[R10]`.

**Universo de SKUs:** variações da família canônica (mesma regra de `produtos_estoque_resumo()`: `distinct on (codigo_pai)
… order by criado_em desc`, `kit_multiplicador is null`). Saldo = `variacoes.estoque` da canônica.

**Entradas com custo:** linhas de `notas_compra_distribuicao` com nota em `status = 'importada'` (desfazer não apaga a
distribuição, só muda o status), casadas com o movimento `entrada` de `referencia_externa = 'nfe:{chave}:{n_item}:{codigo}'`.
A entrada pendente de nota (`registrar_entrada_nota_pendente`, gravada antes da importação com a mesma ref) vale na posição
original, porque a ref é a mesma.

**Replay por SKU** sobre **todos** os movimentos do código com `estoque_anterior`/`estoque_resultante` preenchidos, em
`ordem` `[R1]`. `k` = unidades com nota ainda em estoque, `c` = custo médio; início `k = 0`, `c = null`:

```
para cada movimento m (em ordem):
  k = min(k, m.estoque_anterior)        -- piso: o saldo logo antes de m (pega saída e salto fora do ledger)
  se m é entrada de nota com custo (q, u):
     c = (k = 0) ? u : (k·c + q·u) / (k + q)          [R3]
     k = k + q
  senão:
     k = min(k, m.estoque_resultante)   -- saída consome "sem nota" primeiro; só o que passa do resto sai de k
no fim: k = min(k, saldo_atual)
        se saldo_atual <= 0: qtd_valorizada = 0, marca 'saldo_negativo' se < 0     [R13]
        senão: qtd_valorizada = k;  qtd_sem_nota = saldo_atual − k
        valor = round(qtd_valorizada · c, 2)
```

Por que funciona: na convenção "sem nota sai primeiro", as unidades com nota só saem quando o saldo cai abaixo de `k`. O
menor saldo observado no intervalo (os pisos `estoque_anterior`/`estoque_resultante` e o saldo final) é exatamente esse
limite. O contraexemplo do Codex (nota 10 → vende 10 → entrada manual 10) dá `k = 0` no piso da venda, e as 10 novas saem
"sem nota".

`u` = `custo_aquisicao_unit` (nota + frete/seguro/outros/IPI/ST − desconto, por unidade de estoque, já com fator —
`_shared/nfe/regras.ts:101-104`). `c` em `numeric(14,6)`.

**Limitações conhecidas (sempre para menos, nunca custo inventado):**
- **Salto fora do ledger** (planilha via `ingest-lote` grava `variacoes.estoque` sem movimento): é pego pelo
  `estoque_anterior` do próximo movimento ou pelo saldo final. Duas escritas fora do ledger seguidas, sem movimento entre
  elas, escondem um vale intermediário (raro; aviso no relatório).
- **Devolução/estorno** aumenta o saldo sem aumentar `k`, então a unidade devolvida sai "sem nota".
- **Nota desfeita** fica fora das entradas. As unidades dela entram e saem do saldo como "sem nota".
- **Entrada de nota sem movimento no ledger** (o produto foi excluído e `limpar_movimentos_orfaos` apagou o histórico): é
  ignorada, e o SKU recebe a marca `historico_incompleto`.
- **Código reutilizado `[R7]`:** `limpar_movimentos_orfaos` apaga o histórico assim que o último código some
  (`20260801092323…:39-50`). Clonagem de família (`adicionar-variacoes-familia`) mantém o código vivo e é a mesma linhagem
  do SKU, então o histórico continua valendo. Resta o caso em que a limpeza (best-effort) falhou e o código foi recriado:
  aí o produto novo herdaria as camadas antigas. Isso fica registrado como risco residual, sem tratamento na v1.

## Modelo de dados (migration)

`inventarios` (cabeçalho), org-scoped:
- `id`, `org_id` (FK organizations, `on delete cascade`), `data_base date`, `gerado_em timestamptz` (instante real da
  leitura), `origem` ('cron' | 'manual');
- congelados: `cnpj`, `inscricao_estadual`, `razao_social` (de `empresa_fiscal`);
- `status` ('aberto' | 'confirmado' | 'falhou'), `erro text` (só em 'falhou'), `versao int` (sobe a cada `salvar`),
  `confirmado_por`, `confirmado_em`;
- `unique (org_id, data_base)`; `unique (id, org_id)`.

`inventarios_itens`, uma linha por SKU canônico (inclusive saldo 0, para permitir sobra na contagem):
- FK composta `(inventario_id, org_id)` → `inventarios (id, org_id)`;
- **foto (congelada):** `codigo`, `codigo_pai`, `descricao`, `ncm`, `unidade`, `cor`, `tamanho`, `quantidade_sistema`,
  `qtd_valorizada`, `qtd_sem_nota`, `custo_medio`, `valor_total`, `marcas text[]` ('sem_nota', 'historico_incompleto',
  'ncm_ausente', 'saldo_negativo');
- **contagem (editável só com o cabeçalho 'aberto'):** `quantidade_contada int check (>= 0)` (null = igual ao sistema),
  `justificativa text`;
- **confirmação (escrita só por `confirmar_inventario`) `[R4]`:** `qtd_final`, `qtd_valorizada_final`, `qtd_sem_nota_final`,
  `valor_final`;
- `unique (inventario_id, codigo)`.

**Imutabilidade `[R4]`:** trigger `before update` recusa mudança em coluna da foto e em identidade/vínculo (`id`,
`inventario_id`, `org_id`, `codigo`). Recusa a contagem quando o cabeçalho não está 'aberto'. As colunas de confirmação e a
transição aberto → confirmado só passam com a flag de transação `publiai.inventario_confirmando` ligada por
`confirmar_inventario`. Com o cabeçalho 'confirmado', recusa qualquer update. Trigger `before insert` em itens recusa a
inserção fora de `gerar_foto_inventario`. **Exclusão:** sem grant para `authenticated`/`anon`; só a service_role exclui
(exclusão de org em cascata e limpeza da validação).

**Matriz de privilégios `[R5]`** (todas as funções com `security definer`, `set search_path = public, pg_temp`, `revoke all … from
public, anon, authenticated` antes do grant, no padrão de `20260811203500_fix_grants_ajustar_estoque.sql`):

| Objeto | Owner | Execute/acesso |
|---|---|---|
| `inventarios`, `inventarios_itens` | postgres | RLS `select` por `(select current_org_id())` para `authenticated`; sem insert/update/delete para `authenticated`/`anon` |
| `inventario_calcular(p_org)` | postgres | service_role |
| `inventario_hoje_json(p_org)` / `inventario_foto_json(p_org, p_id)` | postgres | service_role (a edge passa o org do token) |
| `gerar_fotos_inventario(…)` (procedure) | postgres | service_role (pg_cron roda como postgres) |
| `salvar_contagem_inventario(p_org, p_id, p_versao, p_itens)` | postgres | service_role |
| `confirmar_inventario(p_org, p_id, p_versao, p_user)` | mesmo owner de `importar_nota_compra` (que já chama `registrar_entrada`/`ajustar_estoque`) | service_role |

Toda função que recebe `p_id` valida `p_id` **junto com `p_org`** (cross-org = erro). Os testes chamam cada função como
`authenticated` e `anon` (precisa negar) e com o `p_id` de outra org.

## Foto de 31/12 `[R11][R12]`

- Procedure `gerar_fotos_inventario(p_data_base date default null, p_origem text default 'cron', p_org uuid default null)`:
  - `p_data_base` nulo = **último 31/12 até `now() at time zone 'America/Sao_Paulo' + 1 hora`**. O disparo de 23:59 resolve
    para o 31/12 do ano corrente, e um disparo atrasado na madrugada de 01/01 também. Nunca usa `current_date` em UTC;
  - orgs elegíveis: `'estoque' = any(modulos_habilitados)`, `tipo_pessoa = 'pj'`, `empresa_fiscal.cnpj` preenchido (ou só
    `p_org`, na contingência);
  - pula org que já tem foto 'aberto'/'confirmado' nessa data, e refaz a que está em 'falhou';
  - **uma org por transação** (`commit` entre orgs) com `set local statement_timeout` (valor medido no plano). A falha de
    uma org grava o cabeçalho em `status = 'falhou'` com `erro` e segue para a próxima.
- `pg_cron` no padrão de `20260726153552_finalize_support_access.sql` (desagenda por nome, agenda), com o comando
  `call public.gerar_fotos_inventario()`. O plano confere `cron.timezone` no projeto. Em GMT, a expressão é `59 2 1 1 *`.
- **Contingência:** suporte roda `call gerar_fotos_inventario('AAAA-12-31', 'manual', '<org>')`. O relatório mostra "saldo
  lido em <gerado_em>", e quando a leitura é posterior a 31/12 23:59 isso fica explícito. Não há reconstrução de data
  passada (D-12).
- **Detecção:** em janeiro, o card mostra "Foto de 31/12 não gerada — acione o suporte" para a org elegível sem foto ou com
  foto em 'falhou'.
- **Orçamento `[R12]`:** o plano mede, só leitura em produção, o maior número de movimentos e de SKUs por org, reproduz esse
  volume sintético em `teste-sql-desfeito.py` com `EXPLAIN ANALYZE` e fixa o critério: **≤ 10 s por org** no volume medido.
  Se precisar, cria um índice `(org_id, codigo, ordem)`.

## Leitura, contagem e confirmação: edge `inventario` `[R14]`

Edge nova **`inventario`** (verify_jwt true), com quatro ações. Todas usam `requireUserOrg` e o gate de módulo `estoque`
(`exigirModulo`), e as de escrita passam por `auditarOperacaoSuporte`. Em suporte somente leitura, o AppShell já desabilita
os controles do card (`card-pacote-contador.tsx:2`). As leituras em suporte "full" também são auditadas, como o pacote.

| Ação | Quem | Faz |
|---|---|---|
| `hoje` | membro (read) | `inventario_hoje_json(org)` → JSON (cabeçalho com `gerado_em` + linhas), numa chamada só, sem paginação |
| `foto` | membro (read) | `inventario_foto_json(org, id)` → cabeçalho + itens numa instrução só (consistente com uma confirmação concorrente) |
| `salvar` | admin | `salvar_contagem_inventario` |
| `confirmar` | admin | `confirmar_inventario` + push |

O resultado de `hoje`/`foto` sai em JSON único pela RPC (não passa pelo `max_rows=1000` do PostgREST). A edge só
repassa, para caber nos 2 s de CPU (ADR-0173). O card mantém o controle de troca de org/abort que já usa
(`card-pacote-contador.tsx:48-76`). "Foto inexistente" (resposta vazia) é distinta de erro de leitura (erro).

**`salvar_contagem_inventario` `[R8]`:** trava o cabeçalho (`for update`), exige `status = 'aberto'` e `versao = p_versao`
(senão: "a contagem mudou em outra aba; recarregue"), valida que todos os itens pertencem à foto, que a contagem é um inteiro ≥
0 e que a justificativa não é vazia quando contada ≠ sistema. Grava e faz `versao + 1`.

**`confirmar_inventario`**, numa transação:
1. trava o cabeçalho (`for update`). Se já está 'confirmado', vai direto ao passo 5 (idempotente). Exige `versao = p_versao`
   (a versão que o operador revisou no diálogo) `[R8]`;
2. recusa se houver diferença sem justificativa;
3. para cada diferença `d = contada − sistema`, **em ordem de `codigo`** (locks determinísticos). A diferença é relativa,
   porque o saldo de hoje já andou desde 31/12:
   - resolve e trava a variação canônica de hoje. Aplica o **mesmo guard canônico de `desfazer_nota_compra`**
     (`20261016001451_adr181_desfazer_guard_canonico.sql:28-57`) `[R6]`: se o canônico mudar entre a trava e a RPC, aborta
     tudo e o operador tenta de novo;
   - `d < 0` (falta): se o saldo de hoje for menor que `|d|`, **recusa a confirmação inteira** e lista os SKUs. Senão,
     `ajustar_estoque(saldo_hoje + d, …, ref 'inventario:{id}:{codigo}')`;
   - `d > 0` (sobra): `registrar_entrada(…, qtd d, custo null, doc 'Inventário <data-base>', obs justificativa, ref
     'inventario:{id}:{codigo}')`;
4. preenche as colunas `*_final` de todas as linhas com a mesma convenção (a falta consome "sem nota" primeiro, a sobra
   entra como "sem nota", o custo médio não muda), marca 'confirmado', `confirmado_por/em`;
5. devolve `{ codigo_pai, reativar }` dos produtos movimentados, derivado dos movimentos `inventario:{id}:%` (o retry
   idempotente devolve a mesma lista) `[R9]`.

Risco herdado (ADR-0181, "Consequências"): a clonagem de família do "adicionar variação" (ADR-0129) roda sem lock. O guard
canônico detecta a troca, mas não impede que a clonagem leia um saldo velho. Fica como está, coberto pelo issue próprio já
registrado.

**Push `[R9]`:** a edge enfileira `enfileirarSincronizacaoEstoque` para cada `codigo_pai`, com `canal_origem: null`. Falta
segue o ajuste (sem reativar, `ajustar-estoque/processar.ts:51-56`). Sobra segue a entrada (`reativar: true`,
`entrada-estoque/processar.ts:54-71`), que recoloca no ar o anúncio pausado por estoque zero. Commit seguido de falha no
enqueue → resposta `push_pendente`, e a tela oferece "tentar de novo", que repete `confirmar`: o caminho idempotente devolve
a lista e reenfileira.

## Relatório (xlsx + pdf, no navegador)

Mesmo gerador para "hoje" e para a foto (`src/lib/pacote-contador/`, nos moldes de `relatorio-compras-*`):
- **Cabeçalho:** data-base, CNPJ, IE, razão social, status ("inventário de hoje — não é foto, não confirmado" |
  "foto de 31/12 — aguardando contagem" | "confirmado em <data> por <nome>"), "saldo lido em <gerado_em>".
- **Livro** (só quantidade final > 0): código, descrição, NCM, unidade, cor, tamanho, quantidade, qtd valorizada, custo
  médio unitário, valor total, qtd sem nota de compra, marcas.
- **Conferência** `[R13]`: **todas** as divergências da contagem (sistema, contada, diferença, justificativa), inclusive as
  que terminam em zero, mais os SKUs com saldo negativo, histórico incompleto ou NCM ausente.
- **Totais:** valor total avaliado, unidades avaliadas, unidades sem nota de compra.
- **Avisos fixos:**
  - critério: custo médio ponderado móvel de aquisição, unidades sem nota saem primeiro;
  - o saldo inclui o Full;
  - mercadoria de terceiros não é controlada;
  - devolução e escrita de planilha podem ser avaliadas para menos;
  - é base para o Livro mod. 7, não a escrituração.

## UI (`/estoque`, card "Pacote do contador")

- Botão **"Inventário de hoje"** → baixa xlsx + pdf (nome `inventario-AAAA-MM-DD`).
- Com foto 'aberta': aviso "Foto de 31/12 aguardando contagem" + **"Conferir contagem"** → tela com código, descrição,
  cor/tamanho, sistema, contada (input), justificativa (obrigatória quando difere), salvar rascunho e confirmar (só admin,
  com diálogo que resume faltas e sobras e avisa que o estoque e os anúncios serão atualizados).
- Foto 'falhou' ou ausente para org elegível, a partir de 01/01: aviso para acionar o suporte.
- **Pacote de dezembro:** se existe foto `data_base = AAAA-12-31` ('aberto' ou 'confirmado'), o zip leva
  `inventario/relatorio-inventario.xlsx`/`.pdf` com o status. Foto inexistente → a aba Conferência registra "foto de 31/12
  inexistente", **sem** selo PARCIAL. Erro ao ler a foto → aborta o pacote (o operador tenta de novo), para não confundir
  com "inexistente".

## Fora do escopo

Separação Full/terceiros; custo de abertura declarado; PEPS; inventário de fim de mês; reconstrução de data passada;
escrituração do livro; foto em data diferente de 31/12; inventário de kit vinculado (não tem estoque próprio); tratamento de
código reutilizado após falha da limpeza.

## Testes

- **SQL** (`scripts/teste-sql-desfeito.py`, sem Docker):
  - `ordem`: atribuída sob trava; duas entradas do mesmo SKU na mesma transação na ordem certa;
  - `inventario_calcular`: planilha + nota + vendas; nota → vende tudo → entrada manual (sai "sem nota"); duas notas com
    venda entre elas (média móvel ≠ média simples); camada esgotada e reiniciada (`c = u`); salto de planilha fora do
    ledger; nota desfeita; entrada pendente de nota; entrada sem ledger → marca; SKU sem nota; saldo negativo;
  - triggers de imutabilidade (foto, identidade, insert, contagem fora de 'aberto', confirmação sem a flag);
  - privilégios: cada função como `authenticated`/`anon` → negado; `p_id` de outra org → erro;
  - `salvar`: versão obsoleta, item alheio, contagem negativa, justificativa vazia;
  - `confirmar`: falta, sobra, sem justificativa, saldo insuficiente, versão obsoleta, idempotência (lista de push igual
    no retry);
  - `gerar_fotos_inventario`: data-base às 23:59 de 31/12 e às 01:00 de 01/01, idempotência, refaz 'falhou', só orgs
    elegíveis, falha de uma org não afeta outra; volume medido com `EXPLAIN ANALYZE` dentro do orçamento.
- **Vitest:**
  - gerador xlsx/pdf: colunas, totais, avisos, Conferência com divergência zerada, linhas com quantidade 0 fora do livro;
  - card: botão, conferir/salvar/confirmar/push pendente, pacote de dezembro com foto, sem foto e com erro de leitura.
- **Runtime:** org de teste descartável + conta VALIDATION (procedimento do Plano 1). Planilha, nota, venda/ajuste →
  inventário de hoje conferido à mão. Depois: foto gerada pela procedure à mão; contagem com falta e sobra; confirmação;
  pacote de dezembro. Limpeza total depois.

## Calls do builder (não decididas pelo Diego)

- Descrição = `coalesce(familias.descricao_fiscal, familias.nome_pai)`; cor e tamanho em colunas próprias.
- Foto inclui SKUs com saldo 0 (para sobra), mas o livro só imprime quantidade final > 0. A Conferência lista todas as
  divergências.
- Falta maior que o saldo de hoje recusa a confirmação inteira (sem zerar parcialmente).
- Foto ausente não marca o pacote de dezembro como PARCIAL; erro de leitura aborta.
- Entrada de nota sem ledger é ignorada e marcada, em vez de bloquear o inventário.
- Uma edge (`inventario`) com quatro ações.
- `ordem` por trigger em vez de mudar as RPCs de estoque.

## Docs a atualizar

ADR-0181 (emenda do D-12 com as 4 decisões, **antes** do código), `docs/reference/edge-functions.md`,
`docs/reference/modelo-de-dados.md` (tabelas novas, coluna `ordem`), glossário (Custo médio de aquisição, Foto de
inventário, Unidades sem nota de compra), `obsidian-vault/03-Módulos/Estoque.md` e `Fiscal.md`, `project-status.md`.
