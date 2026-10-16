# Pacote do contador: inventário (ADR-0181, Plano 2b-2) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-12; D-13, parte "inventário")
**Base:** Planos 1, 2a e 2b-1 em produção (main `1344d638`) — notas de compra, card "Pacote do contador" em `/estoque`.
**Revisão:** pendente (Codex `gpt-6.1-sol` high).

## Objetivo

Dar à empresa e ao contador o inventário avaliado pelo **custo médio ponderado móvel de aquisição**, sem inventar custo:

- **Inventário de hoje** — calculado na hora, sob demanda, não grava nada;
- **Foto de 31/12** — gravada automaticamente e imutável, base do Livro Registro de Inventário (modelo 7);
- **Confirmação da contagem física** sobre a foto — diferenças justificadas viram movimento de estoque.

**Sucesso:** em janeiro a empresa abre a foto de 31/12, confere a contagem, confirma, e o pacote de dezembro leva o
inventário confirmado. Nenhum SKU aparece com custo que não veio de nota; nenhuma unidade some do relatório.

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

## Critério de avaliação (fonte única em SQL)

Uma função SQL `inventario_calcular(p_org uuid)` calcula tudo. O inventário de hoje e a foto a usam, e o TypeScript só
formata. SQL porque a foto roda no `pg_cron`, sem navegador.

**Universo de SKUs:** variações da família canônica (mesma regra de `produtos_estoque_resumo()`: `distinct on (codigo_pai)
… order by criado_em desc`, `kit_multiplicador is null`). Saldo = `variacoes.estoque`.

**Entradas com custo:** linhas de `notas_compra_distribuicao` cuja nota está com `status = 'importada'` (desfazer não apaga a
distribuição, só muda o status). Cada linha casa com o movimento `entrada` de `referencia_externa =
'nfe:{chave}:{n_item}:{codigo}'`, que traz `estoque_anterior`. A ordem é a do movimento (`criado_em`, `id`), não a da emissão.

**Recursão por SKU** (`c` = custo médio, `k` = unidades com nota ainda em estoque; começa `k = 0`, `c = null`):

```
para cada entrada i (q_i unidades, custo de aquisição u_i, estoque_anterior a_i):
  k_antes = min(a_i, k)              -- unidades sem nota saíram primeiro; o que faltar saiu da camada com nota
  c = (k_antes·c + q_i·u_i) / (k_antes + q_i)
  k = k_antes + q_i
no fim: qtd_valorizada = min(saldo, k);  qtd_sem_nota = saldo − qtd_valorizada
        valor = round(qtd_valorizada · c, 2)
```

`u_i` = `custo_aquisicao_unit` (nota + frete/seguro/outros/IPI/ST − desconto, por unidade de estoque, já com fator —
`_shared/nfe/regras.ts`). `c` em `numeric(14,6)`.

**Casos de borda:**
- **Entrada de nota sem movimento no ledger** (produto excluído e recriado com o mesmo código; `limpar_movimentos_orfaos`
  apagou o histórico): a entrada é **ignorada** e o SKU recebe a marca "histórico de nota incompleto".
- **Devolução/estorno de venda** aumenta o saldo sem aumentar `k`. A unidade devolvida pode cair em "sem nota" quando a
  camada com nota já tinha sido consumida. A avaliação fica para menos, nunca inventada (aviso no relatório).
- **Nota desfeita** fica fora das entradas. As unidades dela passaram pelo saldo e saíram pelo ajuste `nfe-desfazer:`, então o
  `min()` absorve o efeito.
- **SKU sem nenhuma nota:** `qtd_valorizada = 0`, linha marcada "sem nota de compra".

## Modelo de dados (migration)

`inventarios` (cabeçalho), org-scoped:
- `id`, `org_id` (FK organizations), `data_base date`, `gerado_em timestamptz`, `origem` ('cron' | 'manual');
- congelados: `cnpj`, `inscricao_estadual`, `razao_social` (de `empresa_fiscal`);
- `status` ('aberto' | 'confirmado'), `confirmado_por`, `confirmado_em`;
- `unique (org_id, data_base)`.

`inventarios_itens`, uma linha por SKU canônico (inclusive saldo 0, para permitir sobra na contagem):
- congelados: `codigo`, `codigo_pai`, `descricao`, `ncm`, `unidade`, `cor`, `tamanho`, `quantidade_sistema`,
  `qtd_valorizada`, `qtd_sem_nota`, `custo_medio`, `valor_total`, `marcas text[]` ('sem_nota', 'historico_incompleto',
  'ncm_ausente');
- editáveis só com o cabeçalho 'aberto': `quantidade_contada int` (null = igual ao sistema), `justificativa text`;
- `unique (inventario_id, codigo)`.

**Imutabilidade:** trigger `before update` recusa mudança em coluna congelada. Com o cabeçalho 'confirmado', recusa
qualquer update (também no próprio cabeçalho, salvo a transição aberto → confirmado feita pela função de confirmação).
**RLS:** `select` por `(select current_org_id())`; nenhuma policy de escrita. Escrita só por funções `security definer` e
pela service_role (a exclusão de org e a limpeza da validação continuam possíveis).

**Avaliação da quantidade contada:** a confirmação recalcula `qtd_valorizada`/`qtd_sem_nota`/`valor_total` da linha com
a mesma convenção (falta consome "sem nota" primeiro; sobra entra como "sem nota"). O custo médio não muda.

## Foto de 31/12

- Função `gerar_foto_inventario(p_data_base date)`: para cada org com `'estoque' = any(modulos_habilitados)`,
  `tipo_pessoa = 'pj'` e `empresa_fiscal.cnpj` preenchido, grava cabeçalho + itens a partir de `inventario_calcular`.
  É idempotente por `unique (org_id, data_base)`: org que já tem foto é pulada. Cada org roda no próprio bloco, e a falha de
  uma não derruba as outras (`raise warning`).
- `pg_cron`, no padrão de `20260726153552_finalize_support_access.sql` (desagenda por nome, agenda): **31/12 23:59 em
  America/Sao_Paulo**. O plano confere `cron.timezone` no projeto antes de fixar a expressão (em GMT: `59 2 1 1 *`).
- **Contingência:** se a cron falhar, a mesma função roda à mão (suporte), com `origem = 'manual'`. O relatório mostra
  "gerada em <data/hora>", e quando isso cai depois de 31/12 23:59 a diferença fica explícita. Não há reconstrução de data
  passada (D-12).

## Confirmação da contagem

Edge nova **`inventario-contagem`** (verify_jwt true), com duas ações:
- `salvar`: grava `quantidade_contada`/`justificativa` (rascunho; a contagem leva dias);
- `confirmar`: chama a função SQL `confirmar_inventario(p_org, p_inventario, p_user)`.

Gate igual ao `ajustar-estoque`: `requireUserOrg(write)`, **admin**, módulo `estoque` e auditoria de suporte
(`auditarOperacaoSuporte`). Depois de confirmar, enfileira o push dos códigos alterados com `enfileirarSincronizacaoEstoque`,
como o ajuste já faz.

`confirmar_inventario` (security definer, owner `estoque_rpc_executor`, execute só service_role), numa transação:
1. trava o cabeçalho (`for update`); se já estiver 'confirmado', devolve o resultado anterior (idempotente);
2. recusa se houver diferença sem justificativa;
3. para cada diferença `d = contada − sistema` (relativa, porque o saldo de hoje já andou desde 31/12):
   - `d < 0` (falta): trava a variação; se o saldo de hoje for menor que `|d|`, **recusa a confirmação inteira** e lista
     os SKUs (o operador revisa). Senão, `ajustar_estoque(saldo_hoje + d, …, ref 'inventario:{id}:{codigo}')`;
   - `d > 0` (sobra): `registrar_entrada(…, qtd d, custo null, doc 'Inventário <data-base>', obs justificativa, ref
     'inventario:{id}:{codigo}')`;
4. recalcula a avaliação das linhas com diferença e marca 'confirmado'.

Refs determinísticas mantêm o retry idempotente nas duas RPCs.

## Relatório (xlsx + pdf, no navegador)

Mesmo gerador para "hoje" e para a foto (`src/lib/pacote-contador/`, nos moldes de `relatorio-compras-*`):
- **Cabeçalho:** data-base, CNPJ, IE, razão social, status ("inventário de hoje — não é foto, não confirmado" |
  "foto de 31/12 — aguardando contagem" | "confirmado em <data> por <nome>"), "gerada em".
- **Linhas** (só quantidade final > 0): código, descrição, NCM, unidade, cor, tamanho, quantidade, qtd valorizada, custo
  médio unitário, valor total, qtd sem nota de compra, marcas. Na foto confirmada: quantidade do sistema, contada,
  diferença e justificativa.
- **Totais:** valor total avaliado, unidades avaliadas, unidades sem nota de compra.
- **Avisos fixos:**
  - critério: custo médio ponderado móvel de aquisição, unidades sem nota saem primeiro;
  - o saldo inclui o Full;
  - mercadoria de terceiros não é controlada;
  - a devolução pode ser avaliada para menos;
  - é base para o Livro mod. 7, não a escrituração.

**Fonte:** inventário de hoje → RPC `inventario_hoje()` (security definer, `current_org_id()`, gate de módulo `estoque`);
foto → `select` direto em `inventarios`/`inventarios_itens` (RLS).

## UI (`/estoque`, card "Pacote do contador")

- Botão **"Inventário de hoje"** → baixa xlsx + pdf (nome `inventario-AAAA-MM-DD`).
- Com uma foto 'aberta': aviso "Foto de 31/12 aguardando contagem" + **"Conferir contagem"** → tela com código,
  descrição, cor/tamanho, sistema, contada (input), justificativa (obrigatória quando difere), salvar rascunho e confirmar
  (só admin, com diálogo de confirmação que resume faltas e sobras e avisa que o estoque e os anúncios serão atualizados).
- **Pacote de dezembro:** se existe foto `data_base = AAAA-12-31`, o zip leva `inventario/relatorio-inventario.xlsx`/`.pdf`
  com o status. Sem foto, a aba Conferência registra "foto de 31/12 inexistente", e o pacote **não** recebe o selo PARCIAL
  (o selo é das vendas/compras do mês).

## Fora do escopo

Separação Full/terceiros; custo de abertura declarado; PEPS; inventário de fim de mês; reconstrução de data passada;
escrituração do livro; foto em data diferente de 31/12; inventário de kit vinculado (não tem estoque próprio).

## Testes

- **SQL** (`scripts/teste-sql-desfeito.py`, sem Docker):
  - `inventario_calcular`: planilha + nota + vendas; duas notas com venda entre elas (média móvel ≠ média simples); nota
    desfeita ignorada; entrada sem ledger → marca; SKU sem nota;
  - trigger de imutabilidade;
  - `confirmar_inventario`: falta, sobra, sem justificativa, saldo insuficiente e idempotência;
  - `gerar_foto_inventario`: idempotente, só orgs elegíveis.
- **Vitest:** gerador xlsx/pdf (colunas, totais, avisos, linhas com quantidade 0 fora); card (botão, conferir, pacote de
  dezembro com e sem foto).
- **Runtime:** org de teste descartável + conta VALIDATION (procedimento do Plano 1): planilha, nota, venda/ajuste →
  inventário de hoje conferido à mão; foto gerada pela função à mão; contagem com falta e sobra; confirmação; pacote de
  dezembro. Limpeza total depois.

## Calls do builder (não decididas pelo Diego)

- Descrição = `coalesce(familias.descricao_fiscal, familias.nome_pai)`; cor e tamanho em colunas próprias.
- Foto inclui SKUs com saldo 0 (para sobra), mas o relatório só imprime quantidade final > 0.
- Falta maior que o saldo de hoje recusa a confirmação inteira (sem zerar parcialmente).
- Foto ausente não marca o pacote de dezembro como PARCIAL.
- Entrada de nota sem ledger é ignorada e marcada, em vez de bloquear o inventário.
- Um edge (`inventario-contagem`) com duas ações, em vez de duas edges.

## Docs a atualizar

ADR-0181 (emenda do D-12 com as 4 decisões, **antes** do código), `docs/reference/edge-functions.md`, glossário
(Custo médio de aquisição, Foto de inventário, Unidades sem nota de compra), `obsidian-vault/03-Módulos/Estoque.md` e
`Fiscal.md`, `project-status.md`.
