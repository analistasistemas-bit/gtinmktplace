# Kit com variação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar em Publicados kits de cores por combinação × tamanho, numa família User Products, com estoque separado e toda escrita de quantidade feita só com anúncio pausado.

**Architecture:** O kit tem saldo próprio em `variacoes`, com composição imutável. Peça muda de lugar só por uma **saga** durável (`kit_transferencias`), que avança um passo por invocação de um worker QStash. Uma política por SKU (`sku_politica_kit`) é consultada por todo caminho que escreve quantidade ou reativa anúncio. Tudo fica atrás do módulo `kit_variacao`: org sem o módulo não muda de comportamento.

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), QStash, React/TS, vitest, API Mercado Livre, OpenRouter.

**Spec:** `docs/superpowers/specs/2026-11-06-kit-com-variacao-design.md`. Ler inteira antes de qualquer task.

## Global Constraints

- Migration só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043).
- RPC de estoque pertence a `estoque_rpc_executor`; `revoke`/`grant` antes da troca de dono (memória `reference_estoque_push_ml`).
- `baixar_estoque`/`estornar_estoque`: `quantidade` do ledger é o delta aplicado, nunca o pedido.
- Peças por kit: 2 a 6. Cores distintas por kit.
- Quarentena T: 300 s, por env `KIT_QUARENTENA_S`.
- Resultado incerto nunca reenvia escrita; só resposta 4xx permite repetir.
- Pausa só vale com `paused_by_seller` em `sub_status`.
- Pedido pago solta reserva só quando a quantidade lida cair em relação à leitura do passo 1. `last_updated` não solta.
- Crédito automático de cancelamento só dentro do ADR-0121.
- Só user product, só `selling_address`, sem Full, sem Kit Virtual nem kit vinculado na base.
- Dropdown: `Select` de `src/components/ui/select.tsx`. Workers QStash: `verify_jwt=false`.
- Nunca editar anúncio publicado fora do fluxo do app; todo teste de escrita real exige autorização do Diego.
- Teste SQL das demais tasks: mesmo comando, passando todas as migrations novas em ordem. Sem migration é a prova de vermelho.
- Revisão de cada task: Codex `gpt-6.1-sol` high, nunca revisor Claude. Portão de pré-push: `pnpm preflight:static`.
- Módulo novo: `kit_variacao` e `imagem_ia`, em `src/lib/modulos.ts` e no `MODULOS_VALIDOS` da edge `usuarios`.

## Review Focus

1. **Operador pausa ou edita o kit no meio da saga:** a saga não reativa o que o operador pausou. Teste na Task 4.
2. **Pedido com quantidade maior que 1 ou pack com várias cores:** a reserva conta a quantidade, não o pedido. Teste na Task 3.
3. **ML modera item durante a saga:** saga trava com alerta e nunca reativa. Teste na Task 4.
4. **Duas operações na mesma cor:** a segunda fica na fila, sem ler saldo velho. Teste nas Tasks 2 e 4.
5. **Kit sem peça suficiente na hora de aplicar:** aborta inteiro, sem baixa parcial. Teste na Task 2.

---

## Ordem de execução (recomendação do Codex, 07/11)

Modo: subagentes **sequenciais**, com revisão bloqueante do Codex por task e revisão final da branch.

- Ordem das tasks: 0 → 1 a 9 → 10 → 14 → 11 → 12 → 13 → 15 → 16 → 17. A Task 14 vem antes da tela, para a interface não expor reposição nem "Vender só em kit" sem backend pronto.
- Conjuntos: 2–4 são um conjunto transacional, e 5–7 um conjunto de proteções. Cada task tem revisão própria, e cada conjunto ganha um teste integrado. Tasks 8–9 ganham teste integrado de venda, cancelamento e inventário.
- Nunca em paralelo: implementação → revisão → correção → aprovação → próxima task; migrations dependentes.
- Deploy nesta ordem: migrations → todas as edges e dependências → hashes conferidos → módulo → piloto autorizado.
- Pendência crítica de estoque bloqueia avanço e ativação.

---

## Fase 0 — Portão e ADR

### Task 0: Testes restantes e ADR-0197

**Files:**
- Create: `docs/decisions/0197-kit-com-variacao.md`
- Modify: `docs/decisions/0151-*.md`, `docs/decisions/0074-*.md`, `docs/decisions/0111-*.md`, `docs/decisions/README.md`, spec

- [ ] **Step 1:** Rebase da branch sobre `origin/main`; `git fetch` e conferir que 0197 segue livre.
- [ ] **Step 2:** Com autorização do Diego, rodar os testes de "Testes antes de construir" ainda abertos: `POST /items/validate` em MLB3112 com `COLOR` combinada e `MAIN_COLOR`; 2 combinações × 2 tamanhos reais conferindo seletor e agrupamento; política do ML sobre imagem por IA; qualidade e custo real por imagem.
- [ ] **Step 3:** Falha em COLOR ou agrupamento: parar e voltar ao Diego. Falha na imagem: Fase 4 sai do escopo e toda empresa envia foto.
- [ ] **Step 4:** Escrever ADR-0197 com o quarto sentido de "kit" e as decisões da spec. Emendas: ADR-0151 (texto por IA), ADR-0074 (imagem deixa de ser dormente), ADR-0111 (exceção de SKU Guardado).
- [ ] **Step 5:** Commit `docs(kit): ADR-0197 e resultado dos testes`.

---

## Fase 1 — Núcleo de estoque

Nada nesta fase muda org sem kit. Toda checagem começa por "SKU participa de kit?".

### Task 1: Schema

**Files:**
- Create: `supabase/migrations/<ts>_kit_variacao_schema.sql`
- Modify: `src/lib/database.types.ts`, `src/lib/modulos.ts`, `supabase/functions/usuarios/index.ts`, `docs/reference/modelo-de-dados.md`

`set_modulos_org` recusa desligar `kit_variacao` com kit que tenha saldo ou transferência aberta.
- Test: `supabase/tests/kit_variacao_schema.sql`

**Interfaces — Produces:**

| Tabela | Colunas essenciais |
|---|---|
| `kits_variacao` | `id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit (2..6), preco, so_em_kit bool, reposicao_auto bool, meta int >= 0, versao int, status` |
| `kit_variacao_skus` | `id, org_id, kit_id, codigo` único por org, `tamanho, cores text[], rotulo_cor` |
| `kit_variacao_componentes` | `kit_sku_id, codigo, quantidade`; trigger recusa `update`/`delete` (imutável) |
| `sku_politica_kit` | `org_id, codigo` PK, `estado` (`normal`, `guardado`, `sobra`), `versao`, `bloqueio_operador, bloqueio_moderacao, bloqueio_retirada` bool |
| `sku_reivindicacoes_kit` | `org_id, codigo, kit_id` PK: quais kits em "só em kit" usam o SKU |
| `kit_transferencias` | `id, org_id, kit_id, tipo` (`montar, desmontar, repor, cancelamento, sair_sobra, entrada`), `passo, estado` (`ativa, concluida, travada, abortada`), `versao_politica, itens jsonb, alerta, criado_em, passo_em` |
| `kit_transferencia_alvos` | `transferencia_id, up_id, item_ids text[], qtd_passo1, valor_anterior, valor_alvo, pausado_pela_saga text[], escrita_em, confirmada_em` |

Exclusão durável única: tabela `kit_exclusoes (org_id, codigo, up_id, dono_tipo, dono_id, criado_em)` com PK `(org_id, codigo)`. `dono_tipo`: `transferencia`, `publicacao`, `ativacao`. Transferência, publicação e ativação de SKU participante adquirem a mesma exclusão **antes** de validar, e só soltam com resultado confirmado. Resultado incerto ou `travada` mantém a exclusão até o operador resolver. Colunas extras em `kit_transferencias`: `execucao_token, execucao_ate` (claim atômico). Em `kit_transferencia_alvos`: `intencao_escrita_em, recusa_definitiva_em` (intenção gravada antes do PUT).

`estoque_movimentos`: motivos novos `kit_saida`, `kit_entrada`; coluna `transferencia_id uuid`; índice único `(transferencia_id, codigo, motivo)`.

RLS por `org_id` em todas; escrita só por service role.

- [ ] **Step 1:** Escrever `kit_variacao_schema.sql`: `update` em componente falha; segunda exclusão no mesmo SKU falha; `pecas_por_kit = 7` falha; usuário de outra org não lê.
- [ ] **Step 2:** Rodar `python3 scripts/teste-sql-desfeito.py supabase/tests/kit_variacao_schema.sql`, sem migration. Esperado: falha, tabelas inexistentes.
- [ ] **Step 3:** Escrever a migration; atualizar tipos, módulos e `MODULOS_VALIDOS`.
- [ ] **Step 4:** Rodar `python3 scripts/teste-sql-desfeito.py supabase/tests/kit_variacao_schema.sql supabase/migrations/<ts>_kit_variacao_schema.sql` e `npm run db:check`. Esperado: `TESTE_OK`.
- [ ] **Step 5:** Commit.

### Task 2: RPCs de transferência

**Files:**
- Create: `supabase/migrations/<ts>_kit_variacao_rpc.sql`
- Test: `supabase/tests/kit_variacao_rpc.sql`

**Interfaces — Produces:**
- `kit_reservar_transferencia(p_org uuid, p_transferencia uuid) returns jsonb`: trava `variacoes` dos SKUs em ordem de `codigo`, revalida disponível, trânsito e **capacidade até a meta** do kit, grava `kit_saida` nas origens. Insuficiência devolve `{ok:false, motivo:'peca_insuficiente', codigo}` sem gravar nada.
- `kit_creditar_transferencia(p_org uuid, p_transferencia uuid) returns jsonb`: grava `kit_entrada` no destino.
- `kit_cancelar_transferencia(p_org uuid, p_transferencia uuid) returns jsonb`: devolve o que saiu e não chegou.
- `kit_adquirir_exclusao(p_org uuid, p_codigos text[], p_dono_tipo text, p_dono_id uuid) returns jsonb` e `kit_soltar_exclusao(p_org uuid, p_dono_id uuid)`: tudo ou nada, em ordem de `codigo`; conflito devolve `{ok:false, codigo}`.

`registrar_entrada` e `ajustar_estoque` recusam com `sku_em_transferencia` quando o SKU tem transferência `ativa` ou `travada`: o operador repete depois. `baixar_estoque` e `estornar_estoque` nunca recusam, porque venda é sagrada; a saga relê no `confirmar`.

Peça em trânsito é a soma de `kit_saida` sem `kit_entrada` da mesma transferência. Unidade de `kit_entrada` em SKU de kit é **kit**; o total em peças vem da composição (invariante 2).

- [ ] **Step 1:** Testes SQL: reserva move N cores juntas; cor sem saldo aborta sem movimento nenhum; duas chamadas iguais aplicam uma vez; total em peças igual antes e depois de reservar, creditar e cancelar; duas transferências concorrentes no mesmo SKU: uma recebe `peca_insuficiente`; capacidade acima da meta recusa; entrada e ajuste durante transferência recusam; venda durante transferência aplica.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar, com dono `estoque_rpc_executor` e grants antes da troca de dono. Sem `greatest(0, …)`.
- [ ] **Step 4:** Rodar. Esperado: `TESTE_OK`.
- [ ] **Step 5:** Commit.

### Task 3: Conciliação de pedidos

**Files:**
- Create: `supabase/functions/_shared/kit-variacao/conciliacao.ts`, `supabase/functions/_shared/kit-variacao/ml-oferta.ts`
- Test: `supabase/functions/_shared/kit-variacao/__tests__/conciliacao.test.ts`

**Interfaces — Produces:**

```ts
export function calcularReserva(p: {
  itemIds: string[];
  pendentes: PedidoPendente[];        // de /orders/search/pending
  pagosRecentes: PedidoPago[];        // de /orders/search
  qtdPasso1: number; qtdAgora: number;
}): { reservado: number; duvida: boolean };

export async function lerOferta(token: string, upId: string): Promise<OfertaUP>;
// OfertaUP: { upId, versao, locais, quantidade, itens: {id,status,subStatus}[], somenteSellingAddress: boolean }
export async function listarPendentes(token: string, seller: string): Promise<PedidoPendente[]>;
```

`importarPedidosDoItem(admin, orgId, itemIds)` reusa `registrarBaixaVenda`: todo pedido pago do item é baixado de forma idempotente **antes** do cálculo. `listarPendentes` pagina `GET /orders/search/pending`. Só conta pedido com pagamento `pending`. `lerOferta` soma `locations[].quantity` e lista itens do UP via `users/{id}/items/search?user_product_id=`.

- [ ] **Step 1:** Testes: pagamento `cancelled`/`rejected` não reserva; `pending` reserva a quantidade do item (Review Focus 2); pedido pago reserva até `qtdAgora < qtdPasso1`; pedido com vários itens conta só os do UP; leitura com falha devolve `duvida: true`; pedido parcialmente conciliado segue reservado; pagamento perto de T segue reservado; importar duas vezes baixa uma; segundo local devolve `somenteSellingAddress: false`.
- [ ] **Step 2:** Rodar `pnpm test -- conciliacao`. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 4: Saga e worker

**Files:**
- Create: `supabase/functions/_shared/kit-variacao/saga.ts`, `supabase/functions/kit-transferencia/index.ts`
- Modify: `supabase/functions/_shared/queue.ts`, `supabase/config.toml` (`verify_jwt=false`)
- Test: `supabase/functions/_shared/kit-variacao/__tests__/saga.test.ts`

**Interfaces — Produces:**

```ts
export type PassoSaga = 'pausar' | 'aguardar' | 'conciliar' | 'calcular' | 'reduzir' | 'confirmar_reducao' | 'aumentar' | 'confirmar_aumento' | 'reativar' | 'fim';
export async function avancarSaga(deps: DepsSaga, transferenciaId: string): Promise<ResultadoPasso>;
export async function enfileirarSaga(id: string, orgId: string, delaySegundos?: number): Promise<void>;
export async function criarTransferencia(admin, input): Promise<{ id: string } | { motivo: string }>;
```

Um passo por invocação. Cada invocação reivindica a execução atomicamente (`execucao_token` com prazo), e reentrega simultânea sai sem agir. `aguardar` agenda com `delay` de T, sem segurar a fila serial. `criarTransferencia` nasce numa RPC que trava a org com `for share`, valida o módulo e cria transferência e exclusão na mesma transação. `itens` fica imutável no banco depois da reserva, com teste de troca de destinos mantendo as mesmas origens. Grava alvos e adquire a exclusão; conflito devolve `{motivo:'up_ocupado'}` e o chamador reagenda.

Regras por passo, da spec "Escrita de estoque com anúncio pausado":
- `pausar`: `lerOferta`, grava `qtd_passo1`, pausa e registra em `pausado_pela_saga` só o que estava ativo. Exige `somenteSellingAddress` e `paused_by_seller` em todos.
- `calcular`: grava `valor_anterior` e `valor_alvo` uma única vez; `kit_reservar_transferencia` roda aqui.
- `reduzir` e `aumentar`: gravam `intencao_escrita_em` **antes** do `PUT /items`. 4xx grava `recusa_definitiva_em` e permite repetir. Retomada com intenção e sem recusa registrada é resultado incerto: nunca reenvia, segue para a confirmação.
- `confirmar_reducao`: **todas** as origens lidas e iguais a `valor_alvo`, gravado em `confirmada_em`. Só então `aumentar` pode rodar. Nenhum PUT de aumento nem CREATE com saldo inicial acontece antes disso.
- `confirmar_aumento`: leitura igual a `valor_alvo`, identidade do UP e pausa vigente; só então `kit_creditar_transferencia`.
- Em qualquer confirmação, incerto com outro número: `estado='travada'`, alerta, sem reenvio, exclusão mantida.
- `reativar`: só itens de `pausado_pela_saga`, se a política vigente permitir e a versão bater.

- [ ] **Step 1:** Testes, com `deps` falsos: sequência feliz; reentrega do mesmo passo não duplica; timeout com leitura igual ao alvo conclui; timeout com leitura igual ao anterior trava sem reenviar (caso do Grok); 4xx repete; `duvida` na conciliação bloqueia; `versao_politica` velha aborta sem reativar; item com pausa manual antes da saga não é reativado (Review Focus 1); item moderado durante a saga trava e nunca reativa (Review Focus 3); segunda transferência no mesmo UP recebe `up_ocupado` (Review Focus 4); UP `travada` segue ocupado; queda depois do PUT e antes de persistir a resposta não reenvia; duas invocações simultâneas agem uma vez; origem não confirmada impede qualquer chamada ao destino; `out_of_stock` sem `paused_by_seller` não passa de `pausar`.
- [ ] **Step 2:** Rodar `pnpm test -- saga`. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Guarda de escrita de quantidade

**Files:**
- Create: `supabase/functions/_shared/kit-variacao/politica.ts`
- Modify: `supabase/functions/sincronizar-estoque/processar.ts`, `supabase/functions/_shared/user-products/atualizar-composicao.ts`, `supabase/functions/_shared/user-products/atualizar-familia-up.ts`, `supabase/functions/reconciliar-estoque/index.ts`, `supabase/functions/reconciliar-convergencia-up/processar.ts`, `supabase/functions/_shared/canais/mercado-livre.ts`, `supabase/functions/_shared/user-products/publicar-grupo.ts`, `supabase/functions/_shared/user-products/portas-supabase.ts`, `supabase/functions/publicar-split-ml/index.ts`, `supabase/functions/ajustar-estoque/processar.ts`, `supabase/functions/entrada-estoque/processar.ts`
- Test: `supabase/functions/_shared/kit-variacao/__tests__/politica.test.ts`, testes existentes de cada caminho

**Interfaces — Produces:**

```ts
export async function skusParticipantes(admin, orgId: string, skus: string[]): Promise<Set<string>>;
export function podeEscreverQuantidade(p: { participa: boolean; origem: 'saga' | 'outro' }): boolean;
export function podeReativar(p: { politica: PoliticaSku | null; origem: 'saga' | 'operador' | 'automatico' }): DecisaoReativar;
```

Org sem módulo sai antes de qualquer consulta nova. Falha ao ler o módulo ou os participantes lança: quem chama não escreve, e o retry da fila repete.

CREATE e ativação de SKU participante: `publicar-grupo.ts:216`, `portas-supabase.ts:83` e `:98`, e `publicar-split-ml/index.ts:316` chamam `kit_adquirir_exclusao` **antes** de validar a versão da política, mantêm a exclusão durante a chamada remota e a soltam só com resultado confirmado. Snapshot anterior à transferência não publica.

SKU participante fora da saga: `sincronizar-estoque` retira do push e chama `criarTransferencia` tipo `entrada`, para entrada, ajuste e estorno. Os demais caminhos omitem `available_quantity` do payload. Reconciliação diária reprocessa transferências `ativa` sem limite de 24 h.

- [ ] **Step 1:** Testes: em `sincronizar-estoque`, SKU participante não gera alvo e cria transferência; SKU comum segue igual (teste de regressão); falha de leitura não escreve; `atualizar-composicao` não leva `available_quantity` em SKU participante; reconciliação pega transferência parada há 2 dias; org sem módulo não faz consulta nova e segue igual; publicação antiga, Reenviar, split e retomada concorrentes à transferência não escrevem; transferência que começa entre a validação e a chamada remota recebe `up_ocupado`; entrada recusada mostra mensagem ao operador.
- [ ] **Step 2:** Rodar `pnpm test -- politica sincronizar-estoque atualizar-composicao`. Esperado: falha.
- [ ] **Step 3:** Implementar nos 5 caminhos da tabela da spec.
- [ ] **Step 4:** Rodar. Esperado: PASS, com testes antigos intactos.
- [ ] **Step 5:** Commit.

### Task 6: Guarda de reativação

**Files:**
- Modify: `supabase/functions/atualizar-status-publicado/index.ts`, `supabase/functions/_shared/operacoes/executar-status.ts`, `supabase/functions/_shared/user-products/atualizar-familia-up.ts`, `supabase/functions/sincronizar-estoque/processar.ts`
- Test: testes existentes de cada arquivo

Todo caminho que ativa anúncio chama `podeReativar`. Guardado: `reativar` do job é ignorado, operação em massa e Reverter recusam com mensagem, e `atualizar-status-publicado` devolve 409 pedindo para desligar "Vender só em kit". `moderado` nunca é ativado. Pausa manual do operador grava `bloqueio_operador` e incrementa `versao`, invalidando jobs antigos.

- [ ] **Step 1:** Testes: `reativar=true` em Guardado não ativa; operação em massa não ativa Guardado; pausa manual incrementa versão; SKU comum segue ADR-0111.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 7: Saldo e composição duráveis

**Files:**
- Create: `supabase/migrations/<ts>_kit_variacao_guards.sql`
- Modify: `supabase/functions/ingest-lote/index.ts`, `supabase/functions/adicionar-variacoes-familia/index.ts`, `supabase/functions/remover-publicado/processar.ts`, `supabase/functions/criar-kit-vinculado/processar.ts`, `supabase/functions/criar-kit-virtual/*`
- Test: `supabase/tests/kit_variacao_guards.sql`, testes das edges

Regras: `ingest-lote` e `adicionar-variacoes-familia` não trazem saldo de planilha nem de snapshot em SKU participante: o saldo da nova cópia é lido e gravado dentro de RPC sob o lock do SKU, recusando se houver transferência ativa. `preparar_republicacao` e `remover-publicado` recusam só com transferência ativa ou travada; fora disso preservam política e composição e incrementam `versao`, invalidando trabalhos antigos. Exclusão de cor e `limpar_movimentos_orfaos` preservam movimentos de SKU em composição. Criar kit vinculado ou Kit Virtual sobre base em kit com variação é recusado, e o inverso também (`base_em_kit`).

- [ ] **Step 1:** Testes: planilha com `ESTOQUE` diferente não altera saldo de SKU participante; adicionar variação concorrente com transferência recusa; excluir cor em composição falha; republicar com trânsito recusa; republicar sem trânsito preserva composição e invalida job velho; Kit Virtual recusado nos dois sentidos.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 8: Venda e cancelamento do kit

**Files:**
- Modify: `supabase/functions/_shared/estoque/baixa.ts`, `supabase/functions/_shared/estoque/cancelamento.ts`, `supabase/functions/_shared/estoque/kit.ts`
- Test: `supabase/functions/_shared/estoque/__tests__/`

Portão da revisão da Task 3: `sync-venda` usa catálogo tolerante, e a referência da baixa inclui o SKU; para SKU participante, falha de leitura não pode gerar outra referência para o mesmo pedido. Fechar aqui, antes de ligar o módulo. `resolverOrigemEstoque` continua neutro para este kit, porque o predicado é `kit_multiplicador`. Venda baixa o SKU do kit. Cancelamento dentro do ADR-0121 credita o saldo local e cria transferência `cancelamento`, mesmo com `reposicao_auto = false`. Fora do ADR-0121, só o aviso existente. Só para SKU participante: falha de crédito não devolve `reposto` e fica pendente com retry. Os demais SKUs seguem o `cancelamento.ts:97` atual, sem mudança. Telegram avisa saldo zero do kit em modo manual.

- [ ] **Step 1:** Testes: venda baixa só o SKU do kit; cancelamento pré-despacho credita e agenda; pós-despacho não credita; falha mantém pendente; SKU retirado segue creditável; SKU comum e org sem módulo mantêm o resultado de hoje.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 9: Inventário

**Files:**
- Create: `supabase/migrations/<ts>_kit_variacao_inventario.sql`
- Test: `supabase/tests/kit_variacao_inventario.sql`

Replay de `20261016233218_adr181_inventario_calculo.sql` reconhece `kit_saida`/`kit_entrada` em montagem, desmontagem, cancelamento e trânsito, preservando quantidade por componente, custo e nota de origem. Kit de 2 peças conta 2 peças.

- [ ] **Step 1:** Teste: entrada com nota de P e B, montar 1 kit: inventário segue com 1 P e 1 B valorizados e com a nota; trânsito também conta; desmontar devolve a nota; venda e cancelamento do kit mantêm a conta.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: `TESTE_OK`.
- [ ] **Step 5:** Commit.

---

## Fase 2 — Criar e gerenciar

### Task 10: Edge de criação e publicação

**Files:**
- Create: `supabase/functions/criar-kit-variacao/index.ts`, `supabase/functions/criar-kit-variacao/processar.ts`, `src/lib/kit-variacao.ts`
- Modify: `supabase/functions/_shared/user-products/publicar-familia-up.ts`
- Test: `supabase/functions/criar-kit-variacao/__tests__/processar.test.ts`, `src/lib/__tests__/kit-variacao.test.ts`

**Interfaces — Produces:**

```ts
export function gerarCombinacoes(cores: string[], pecas: number): string[][];   // sem repetição
export function rotuloCombinacao(cores: string[]): string;                       // "Preto, Branco e Marrom"
export interface CriarKitVariacaoInput {
  familiaBaseId: string; cores: string[]; pecasPorKit: number; preco: number;
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  titulo: string; descricao: string; fotos: Record<string, string>;
  soEmKit: boolean; meta: number;
}
```

Valida: módulo, base user product, `somenteSellingAddress`, sem Full, sem outro kit, cores distintas, preço > 0, guia de tamanhos da própria conta, e nenhuma foto usada em item moderado (`under_review`, `forbidden`, `waiting_for_patch`): no teste de 07/11, as fotos de item `forbidden` foram a causa provável de revisão imediata. Depois de publicar, a tela avisa que o seletor do ML leva minutos para juntar os itens. Só `quantidade > 0` vira SKU. `proximo_codigo_produto()` para códigos, `familias` com `status='pronto'` em lote técnico, como `criar-kit-vinculado`. Custo e peso somados; altura × N. O CREATE é o passo `aumentar` da saga: saldo inicial só depois de `confirmar_reducao`, com proteção contra criação duplicada. Item novo fica na mesma família.

Fiscal: SKU de kit herda NCM e origem da base e passa pelo fluxo de `tax_information` por SKU, com `title` próprio (memória `reference_ml_title_fiscal_xprod`). Cada combinação tem peso e custo do kit, e custo congelado de venda (ADR-0109) usa esse custo.

- [ ] **Step 1:** Testes: `gerarCombinacoes(['P','B','M','A','V'],4)` tem 5 itens; quantidade 0 não vira SKU; base Legacy recusa; Full recusa; custo é soma; CREATE repetido não duplica; origem não confirmada impede o CREATE; SKU de kit nasce com NCM da base.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 11: Texto por IA

**Files:**
- Create: `supabase/functions/gerar-texto-kit/index.ts`
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts`, `supabase/functions/reprocessar-familia/index.ts`, `supabase/functions/process-familia/index.ts`
- Test: `supabase/functions/gerar-texto-kit/__tests__/`

Etapa própria, com `resolverModeloTexto`, chamada pela prévia. Não usa `process-familia`. As travas de `reprocessar-familia` e `process-familia/index.ts:85` hoje só olham `kit_multiplicador`: estender para família de `kits_variacao`.

- [ ] **Step 1:** Testes: título contém "Kit N"; limite de 60 caracteres; `reprocessar-familia` e `process-familia` recusam família deste kit.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 12: Simulador

**Files:**
- Create: `src/components/kit-variacao/simulador-kit.tsx`, `src/lib/kit-variacao-simulacao.ts`
- Test: `src/lib/__tests__/kit-variacao-simulacao.test.ts`

Reusa `calcularTarifaML` e `DetalheRecebe`, sem fórmula nova. Tarifa com preço, categoria, dimensões e peso do kit; recota com debounce. Custo por `fetchFamiliaComCustoRecente`. Sem alíquota confirmada: aviso, sem presumir.

- [ ] **Step 1:** Testes: pior combinação destacada; prejuízo exige confirmação; cotação indisponível não mostra número; sem alíquota não calcula imposto.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 13: Telas Criar kit e Gerenciar kit

**Files:**
- Create: `src/components/kit-variacao/dialog-criar-kit-variacao.tsx`, `src/components/kit-variacao/dialog-gerenciar-kit.tsx`, `src/components/kit-variacao/explicacao-reposicao.tsx`
- Modify: `src/pages/Publicados.tsx`, `src/components/familia-expanded.tsx`
- Test: `src/components/kit-variacao/__tests__/`

Layout do rascunho aprovado em 06/11: cores, peças por kit, tabela combinação × tamanho, saldo de peças. `explicacao-reposicao.tsx` traz texto e tabela da spec com os valores digitados. Desmontar com reposição ligada desliga a reposição; em "Vender só em kit" pergunta se quer desligar a opção. Botão só com módulo `kit_variacao`; "Vender só em kit" só para admin.

- [ ] **Step 1:** Testes: combinações mudam com cores; excesso fica vermelho e bloqueia; Próximo bloqueia sem kit; sem foto bloqueia em empresa sem IA; explicação usa a meta digitada.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar, chamando a skill `frontend-design-fable5`.
- [ ] **Step 4:** Rodar e validar visual em sessão isolada (`playwright-cli`, com print).
- [ ] **Step 5:** Commit.

---

## Fase 3 — Vender só em kit

### Task 14: Estados e reposição automática

**Files:**
- Create: `supabase/functions/_shared/kit-variacao/reposicao.ts`, `supabase/functions/kit-reposicao/index.ts`
- Test: `supabase/functions/_shared/kit-variacao/__tests__/reposicao.test.ts`

**Interfaces — Produces:**

```ts
export function planejarReposicao(p: FotoKit): { moves: Move[]; sobras: string[]; voltarGuardado: string[] };
```

Função pura sobre fotografia consistente. Ordem determinística: maior falta para a meta, depois `codigo`. Cor em Sobra conta como disponível. Não vira Sobra com transferência pendente. Dispara em lote após venda, entrada, cancelamento e ajuste, com agrupamento por kit. Sobra → Guardado reserva os parceiros na mesma transação, antes de pausar. Ligar a opção confirma a pausa antes de usar peças. Desligar kit remove só a reivindicação dele; SKU só volta a Normal sem reivindicação. Automação só desfaz a pausa que fez. Virar Sobra reativa e avisa no Telegram.

- [ ] **Step 1:** Testes: meta 3 com saldo 2 move 1; falta de parceiro vira sobra e reativa; entrada do parceiro reserva, devolve a Guardado e só então monta; parceiro consumido no meio não deixa SKU preso em Guardado; dois kits, desligar um mantém Guardado; pausa manual anterior não é reativada ao desligar; decisão velha é rejeitada por versão.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

---

## Fase 4 — Foto por IA e cobrança

Só executa se a Task 0 aprovar imagem por IA.

### Task 15: Geração de imagem

**Files:**
- Create: `supabase/functions/gerar-foto-kit/index.ts`, `supabase/functions/_shared/ai/imagem.ts`
- Modify: `supabase/functions/_shared/ai/tokens.ts`, `src/components/configuracoes/secao-ia.tsx`, `src/components/kit-variacao/dialog-criar-kit-variacao.tsx`
- Test: `supabase/functions/_shared/ai/__tests__/imagem.test.ts`

Exige módulo `imagem_ia` e usa `ai_model_imagem`. Modelo padrão: `google/gemini-nano-banana-2.1` **[Diego, 07/11]**, incluído em `src/lib/ai-modelos.ts`. Migration amplia o `check` de `20260713120000_ai_model_por_org.sql`, que aceita só um slug. O pedido à IA precisa descrever a peça, porque isso mudou o resultado no teste; descrever por visão antes de gerar. Saída adequada ao ML (vertical ou quadrada). Modelos de imagem entram em `PRECOS`. Texto de Configurações deixa de dizer "não usado".

- [ ] **Step 1:** Testes: org sem módulo recebe 403; custo maior que zero; foto gerada não publica sem aprovação.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit.

### Task 16: Cobrança por imagem

**Files:**
- Create: `supabase/migrations/<ts>_platform_imagem_ia_metering.sql`
- Modify: função de demonstrativo de `20260918010100_platform_billing_tiers.sql` por migration nova, `src/components/platform-admin/commercial-terms-form.tsx`, `src/components/platform-admin/org-billing.tsx`
- Test: `supabase/tests/platform_imagem_ia.sql`

Espelha `platform_sonar_deliveries`: `platform_image_deliveries` (`org_id, month, terms_id, request_id` único, `units, total_cents`, custo real) e `image_unit_cents` nos termos. Linha "Imagens IA" no demonstrativo só com preço > 0 ou uso. Falha não cobra; descartada cobra. Regex em migration com escape simples.

- [ ] **Step 1:** Testes: duas imagens somam na fatura; repetir `request_id` não cobra de novo; falha não cobra; condição nova não altera mês fechado.
- [ ] **Step 2:** Rodar. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: `TESTE_OK`.
- [ ] **Step 5:** Commit.

---

## Fase 5 — Entrega

### Task 17: Piloto e documentação

- [ ] **Step 1:** Skill `docs-update-checklist`: `docs/reference/edge-functions.md`, `modelo-de-dados.md`, `TASKS.md`, `project-status.md`, vault.
- [ ] **Step 2:** Skill `graphify-update-maintenance`.
- [ ] **Step 3:** `pnpm preflight`. Revisão final Codex `gpt-6.1-sol` high do diff, e Grok 4.7 xhigh.
- [ ] **Step 4:** Com pedido do Diego: merge fast-forward e `supabase db push`. Gerar o manifesto pela **união** de edges novas, edges alteradas diretamente (inclusive `usuarios`) e dependentes transitivos de todo `_shared/` alterado. Deployar todas e conferir o hash de cada bundle por `functions download` antes de ligar qualquer módulo. Jobs antigos na fila são invalidados pela versão da política.
- [ ] **Step 4b (portão obrigatório):** rodar `supabase/tests/kit_variacao_rpc_concorrencia.sh` e demais testes de duas sessões em banco local com todas as migrations, integralmente verdes. Sem isso, o módulo não liga.
- [ ] **Step 5:** Ligar `kit_variacao` só na DSA ou Daludi e criar o primeiro kit real com Diego, com 1 combinação. Conferir invariante 2 por SQL antes e depois.
