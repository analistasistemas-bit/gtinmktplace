# Sugestões de promoção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aba Sugestões na Central de Promoções, com produtos que vendem pouco, em duas faixas, ordenados por Oportunidade, com Aderir por card e Dispensar por 30 dias. Execução: sessão única, com revisão do contrato da RPC antes da tela e revisão do Codex no fim.

**Architecture:** o cálculo é uma função pura em `src/lib/sugestoes-promocao.ts`, rodando no front sobre leituras do banco (convites, participações, promoções, RPC de sinais, dispensas). Aderir reusa `PreviewOperacao`. A edge `operacoes-massa` ganha dispensa/reativação e a marcação de origem; o sync grava a data de criação do anúncio.

**Tech Stack:** React + TS + Tailwind v4, Supabase (Postgres, RLS, edge Deno), vitest.

**Spec:** [ADR-0194](../../decisions/0194-sugestoes-de-promocao.md). Termos em `CONTEXT.md`.

## Global Constraints

- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043). Nunca rebaixar modelo em migration, RLS ou publicação em marketplace.
- Limites exatos: vende pouco `< 5` unidades; janela `30` dias; Quase vendendo `visitas_ok >= max(30, 3 * visitasPorUnidade)` e `unidades_ok < visitas_ok / visitasPorUnidade`; cobertura mínima `80%`; empate de desconto `2` pontos; dispensa `30` dias; idade mínima `30` dias; `20` por página.
- Vendas: regra de `ehFaturavel` (`src/lib/resumo-vendas.ts`). Janela de 30 dias em BRT. Conversão: visitas e unidades nos mesmos pares MLB×dia com `estado = 'ok'` (modelo: `supabase/migrations/20261003232750_vitrine_identificacao.sql`).
- RPC com mais de 1000 linhas: `supabase.rpc(fn, undefined, { get: true }).range()` via `buscarTodasPaginas`.
- Escrita em `promocao_sugestoes_dispensadas` só pela edge (service role). Dropdown: `ui/select`. Nada de `<select>` nativo.
- Cada mudança de edge exige deploy pela CLI e conferência da versão. Nenhuma escrita no ML fora do fluxo de operação.
- Worktree próprio; revisão de diff pelo Codex `gpt-6.1-sol` high; `pnpm preflight:static` e também `pnpm lint` antes do push (o preflight deixou passar erro de lint em 03/11).

## Review Focus

1. Conta sem nenhuma venda em 30 dias: `visitasPorUnidade` nulo não pode gerar `Infinity`/`NaN` na tela.
2. Produto com anúncios em estados mistos: um participa e outro é convidado. O que participa sai; o resto continua, e vendas e visitas seguem somando todos.
3. Amarelo no painel: `PreviewOperacao` abre desmarcado para não verde. O card não pode prometer adesão em um clique nesse caso.
4. Par catálogo/normal: `anuncio_normal_id` deve levar ao mesmo produto do normal, sem duplicar card.
5. Dispensa expirada ou de produto que mudou de chave (ganhou vínculo): não pode esconder nem quebrar a lista.

---

### Task 1: Banco — tabela, colunas e RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_sugestoes_promocao.sql`
- Modify: `src/lib/database.types.ts` (gerado)

**Interfaces:**
- Produces: tabela `promocao_sugestoes_dispensadas(org_id uuid, chave text, dispensado_por uuid, dispensado_em timestamptz default now(), expira_em timestamptz not null, primary key (org_id, chave))`, RLS ligada, `revoke all` de `public, anon, authenticated` antes do grant, policy de select por `org_id = current_org_id()`, grant só de select a `authenticated`, sem policy de escrita (modelo: `ml_posvenda_acoes`).
- Produces: `ml_promocao_itens.anuncio_criado_em timestamptz`, `operacoes_massa.sugestao jsonb`.
- Produces: `sugestoes_promocao_sinais()` `returns setof json`, `stable security definer`, `set search_path = ''`, filtrando por `public.current_org_id()`, com revoke de `public, anon` e grant a `authenticated` (modelo: `vendas_sku_catalogo`). Cada linha: `{ ml_item_id, unidades_30d, visitas_ok, unidades_ok, dias_ok, ativo, codigo_pai, nome_produto, estoque_produto, criado_em }`, com `order by ml_item_id` (paginação estável). `unidades_30d` = todas as faturáveis da janela; `visitas_ok`/`unidades_ok` = só dos pares MLB×dia `ok`; `criado_em` = menor entre `ml_promocao_itens.anuncio_criado_em` e `publicado_em` de `anuncios_externos`/`familias`. Todo join filtra pelo `org_id` da CTE `org`.

- [ ] **Step 1:** criar a migration. Vínculo MLB → `codigo_pai`, as fontes da Vitrine (`anuncios_externos`, `anuncios_externos_itens` com `catalog_listing_id`, `familias.ml_item_id`, `variacoes.catalog_listing_id`) e por último `ml_vendas_itens.codigo` → `variacoes.codigo`. `ativo` = status em `ml_trafego_item` igual a `active` ou desconhecido. Universo de linhas: união dos MLBs com visita ou venda em 30 dias e dos que têm linha em `ml_promocao_itens`. `unidades_30d` espelha `ehFaturavel`, conferido no arquivo antes de escrever o filtro.
- [ ] **Step 2:** testar com `scripts/teste-sql-desfeito.py` (migration e teste em transação desfeita), simulando `authenticated` com claims de uma org: devolve só linhas dela, sem vazar por join; soma de `visitas_ok` da Avil bate com a consulta direta de `estado='ok'`; `authenticated` não consegue `insert`, `update`, `delete` nem `truncate` na tabela. Acrescentar a tabela e a RPC a `scripts/verificar-isolamento-tenant.ts`.
- [ ] **Step 3:** `supabase db push`, `npm run db:check`, regenerar tipos.
- [ ] **Step 4:** commit.

### Task 2: Regra pura das sugestões

**Files:**
- Create: `src/lib/sugestoes-promocao.ts`
- Test: `src/lib/__tests__/sugestoes-promocao.test.ts`

**Interfaces:**
- Consumes: `abaDa`, `Promocao`, `Participacao`, `ItemPromocao` de `src/lib/promocoes.ts`; `ehTipoOperavel` de `src/lib/operacoes.ts`.
- Produces:

```ts
export interface SinalAnuncio { ml_item_id: string; unidades_30d: number; visitas_ok: number; unidades_ok: number; dias_ok: number; ativo: boolean; codigo_pai: string | null; nome_produto: string | null; estoque_produto: number | null; criado_em: string | null }
export interface Dispensa { chave: string; expira_em: string; dispensado_em: string; dispensado_por: string | null }
export type ConvitePromocao = ItemPromocao & { promocao_id: string }
export interface OpcaoCampanha { promocao: Promocao; itens: ConvitePromocao[]; descontoPct: number; lucroPorVenda: number; semaforo: 'verde' | 'amarelo' }
export interface Sugestao { chave: string; titulo: string; thumbnail: string | null; faixa: 'quase_vendendo' | 'invisivel'; unidades: number; visitas: number; estoque: number | null; anunciosConvidados: number; vendasAbaixo: number; oportunidade: number; recomendada: OpcaoCampanha; alternativas: OpcaoCampanha[] }
export interface ResultadoSugestoes { quaseVendendo: Sugestao[]; invisivel: Sugestao[]; dispensadas: Sugestao[]; visitasPorUnidade: number | null }
export function montarSugestoes(e: { convites: ConvitePromocao[]; participacoes: Participacao[]; promocoes: Promocao[]; sinais: SinalAnuncio[]; dispensas: Dispensa[]; agoraMs: number }): ResultadoSugestoes
```

`chave` = `p:<codigo_pai>` ou `a:<ml_item_id>`. Lucro de uma linha = menor `liquido - custo` entre as cores; linha com cor sem `custo` (nulo ou zero) ou sem `liquido` é inválida. Lucro da opção = média das linhas. Desconto da opção = média de `1 - preco_avaliado / preco_original`, sem arredondar. Candidatas = as que estão a até 2 pontos do maior desconto; entre elas ganha o maior lucro, depois a maior cobertura. Linha válida exige lucro maior que zero, anúncio ativo e, em `LIGHTNING`, preço de pelo menos R$ 19. Cobertura do produto = média de `dias_ok / 30` dos seus anúncios; abaixo de 0,8 sai. `estoque_produto === 0` sai. Não usar `descontoPct` (arredonda para inteiro), que fica só para exibir. `visitasPorUnidade` = soma de `visitas_ok` ÷ soma de `unidades_ok`; `unidades` do corte = `unidades_30d`, somando o produto. Faixa usa `visitas_ok`/`unidades_ok` do produto. `vendasAbaixo` e `oportunidade` usam só os anúncios da recomendada. Produto com visitas no corte e vendas na média ou acima fica fora.

- [ ] **Step 1:** escrever os testes, com estes nomes e valores:
  - `classifica Quase vendendo pelo corte da conta`: 2390 visitas e 100 unidades na conta (23,9); produto com 72 visitas e 0 unidades é `quase_vendendo`; com 71, `invisivel`.
  - `visitas no corte e conversão na média fica fora`: 72 visitas e 4 unidades não aparece em nenhuma faixa.
  - `cobertura abaixo de 80% sai`, `estoque zero sai`, `anúncio inativo não entra`, `lucro zero não entra`, `Relâmpago abaixo de 19 não entra`.
  - `piso de 30 visitas`: conta a 8,6 visitas por unidade; 29 visitas é `invisivel`, 30 é `quase_vendendo`.
  - `conta sem vendas`: `visitasPorUnidade` nulo, `oportunidade` 0, 30 visitas é `quase_vendendo`.
  - `oportunidade`: 212 visitas, 23,9, 1 unidade, lucro 6 → `vendasAbaixo` `212/23.9 - 1`, `oportunidade` vezes 6; visitas de anúncio fora da campanha não entram.
  - `produto que vende 5 ou mais sai`, mesmo com anúncio individual zerado.
  - `soma anúncios não convidados do produto` em unidades e visitas.
  - `participante sai`: MLB `candidate` numa campanha e `started` em outra não entra.
  - `exclui vermelho, indisponivel, cor sem custo, preço acima do original, tipo não operável, campanha encerrada`.
  - `recomenda maior desconto; empate por lucro; depois cobertura`; `alternativas` traz as demais. Caso: 9,9% com lucro 5 vence 10,1% com lucro 2 (empate de 2 pontos); 20% com lucro 2 vence 10% com lucro 5.
  - `produto novo sai pela menor data entre todos os sinais do produto`: anúncio antigo sem convite mantém o produto na lista; `sem data entra`.
  - `conversão ignora dia pendente`: `unidades_30d` 10 e `unidades_ok` 4 usa 4 na conversão e 10 no corte.
  - `dispensa vigente vai para dispensadas; expirada volta`.
  - `par de catálogo cai no produto do normal` (Review Focus 4), `sem vínculo vale o anúncio` e `mesma ordem por oportunidade, desempate por visitas`.
- [ ] **Step 2:** `pnpm vitest run src/lib/__tests__/sugestoes-promocao.test.ts`. Esperado: falha por módulo inexistente.
- [ ] **Step 3:** implementar `montarSugestoes`.
- [ ] **Step 4:** rodar de novo. Esperado: todos passam.
- [ ] **Step 5:** commit.

### Task 3: Sync grava a data de criação

**Files:**
- Modify: `supabase/functions/_shared/promocoes/ml.ts:12,74`, `tipos.ts`, `sincronizar.ts:134`, `deps.ts:174`
- Test: `tests` existentes do sync em `supabase/functions/_shared/promocoes/__tests__/`

**Interfaces:**
- Produces: `date_created` em `ATRIBUTOS_ITEM`; `criado_em: string | null` no item lido; `anuncio_criado_em` em `LinhaItem` e no upsert de `gravarLote`.

- [ ] **Step 1:** teste: item do ML com `date_created` chega à linha gravada; sem o campo, `null`.
- [ ] **Step 2:** rodar e ver falhar. **Step 3:** implementar. **Step 4:** rodar e ver passar.
- [ ] **Step 5:** deploy `supabase functions deploy sincronizar-promocoes`, conferir versão. Commit.

### Task 4: Edge — dispensa e marcação de origem

**Files:**
- Modify: `supabase/functions/operacoes-massa/index.ts:143-169,248-262,349-358`
- Test: `supabase/functions/_shared/operacoes/__tests__/` (extrair `lerSugestao` para `_shared/operacoes/sugestao.ts`, para o vitest carregar)

**Interfaces:**
- Produces: `etapa: 'dispensar_sugestao'` e `'reativar_sugestao'`, corpo `{ etapa, chave }`, com a mesma autorização de escrita de `criar` e `exigirModulo('promocoes')`. A lógica fica em `dispensarSugestao(deps, orgId, chave)` e `reativarSugestao(deps, orgId, chave)` em `_shared/operacoes/sugestao.ts`, com `deps` injetável. `chave` válida: `/^(p|a):.{1,80}$/`. Dispensar faz upsert com `expira_em = now() + 30 dias`, reativar faz delete; os dois escopados por `orgId`.
- Produces: pedido de promoção aceita `sugestao?: { faixa: 'quase_vendendo' | 'invisivel'; oportunidade: number; chave: string }`, validado por `lerSugestao`; inválido responde 400. Gravado em `operacoes_massa.sugestao`. Só com `acao === 'aderir'` e sem `origem_id`.

- [ ] **Step 1:** testes de `lerSugestao`: válido passa; faixa desconhecida, oportunidade não numérica e chave fora do padrão falham; ausente devolve `null`. Testes dos ramos novos: membro sem permissão recebe 403, org sem o módulo recebe 403, suporte `read` é recusado, e dispensar e reativar só tocam a própria org. Seguir o padrão de autorização já testado da edge.
- [ ] **Step 2:** rodar e ver falhar. **Step 3:** implementar. **Step 4:** rodar e ver passar.
- [ ] **Step 5:** deploy `supabase functions deploy operacoes-massa`, conferir versão. Commit.

### Task 5: Dados no front

**Files:**
- Modify: `src/lib/promocoes.ts` (`fetchConvites`), `src/hooks/useOperacoes.ts` (`PedidoOperacao.sugestao?`)
- Create: `src/hooks/useSugestoesPromocao.ts`
- Modify: `src/components/promocoes/preview-operacao.tsx:70,187` (prop `sugestao?`, repassada no `mutateAsync`)
- Test: `src/hooks/__tests__/useSugestoesPromocao.test.tsx`, `src/components/promocoes/__tests__/preview-operacao.test.tsx`

**Interfaces:**
- Produces: `fetchConvites(promocaoIds: string[]): Promise<ConvitePromocao[]>` (`status = 'candidate'`, `.in('promocao_id', promocaoIds)` só das campanhas vivas e operáveis, `order` por `promocao_id` e `ml_item_id`, paginado); `useSugestoesPromocao(): { data: ResultadoSugestoes | undefined; isLoading: boolean; isError: boolean }`, combinando `usePromocoes`, `useParticipacoes` e queries de convites, sinais e dispensas; `useDispensarSugestao()` e `useReativarSugestao()`, invalidando as dispensas.

- [ ] **Step 1:** testes: o hook entrega `isError` se qualquer fonte falha (falha não vira lista vazia); o preview repassa `sugestao` no pedido de aderir e omite sem a prop.
- [ ] **Step 2:** rodar e ver falhar. **Step 3:** implementar. **Step 4:** rodar e ver passar. **Step 5:** commit.

### Task 6: Aba Sugestões

Antes de codar, invocar `frontend-design-fable5` em modo sistema e `ui-ux-pro-max-fable5`. Herda tokens de `src/index.css` e os componentes de `src/components/ui/`. Referência de idioma: `lista-participando.tsx` e o redesenho premium do `/ads`.

**Files:**
- Create: `src/components/promocoes/lista-sugestoes.tsx`, `src/components/promocoes/card-sugestao.tsx`
- Modify: `src/pages/Promocoes.tsx:20,100-106` (aba `sugestoes`, depois de `participando`)
- Test: `src/components/promocoes/__tests__/lista-sugestoes.test.tsx`, `src/pages/__tests__/Promocoes.test.tsx`

**Interfaces:**
- Consumes: `useSugestoesPromocao`, `useDispensarSugestao`, `useReativarSugestao`, `usePodeExecutarOperacao`, `usePaginacao`, `Pagination`, `PreviewOperacao`, `StatusPill`.

**Desenho (trabalho de sistema, sem identidade nova):**
- Duas seções, não grade de cards: cabeçalho "Quase vendendo" + contagem + frase curta do que é, lista em `divide-y`, paginação; depois "Invisível". Mesmo idioma de `BlocoCampanha`.
- Linha: miniatura, produto, motivo em uma linha ("212 visitas, 0 vendas em 30 dias"), estoque. À direita, em `tabular-nums`, **~8 vendas abaixo do esperado** é o dado mais forte da linha, seguido do lucro por venda. Depois, campanha, preço riscado → preço, desconto, lucro por venda, "14 de 18 anúncios nesta campanha", selo `StatusPill` warning "abaixo do piso" no amarelo.
- "+N campanhas" expande as alternativas na própria linha; escolher uma troca a campanha do Aderir.
- Cor de destaque só no botão Aderir. Dispensar é `ghost`.
- Estados: esqueleto no carregamento; erro com "Tentar novamente"; vazio geral ("Nenhuma sugestão agora. Produtos que vendem pouco e têm convite de campanha aparecem aqui."); faixa vazia some; sem permissão, sem Aderir e Dispensar; sem campanha sincronizada, aponta para Atualizar agora.
- Tooltip explica a conta e que é estimativa, comparada à média da conta, não promessa de venda. Faixa de "Campanhas atualizadas há X h" reusa o estado do sync.
- Filtro "Dispensados" (`Tabs`/toggle do design system) com botão Reativar.
- 390 px: a coluna de valores desce para baixo do título; alvos de toque de 44 px; sem rolagem horizontal.

- [ ] **Step 1:** testes: ordem por oportunidade; duas faixas com paginação de 20; selo só no amarelo; `aria-label` em ações; Aderir abre o preview com só os itens da campanha escolhida e a `sugestao` certa; trocar a campanha muda os itens; Dispensar chama o hook; filtro mostra dispensados e Reativar; sem permissão não mostra ações; erro não vira vazio; `?aba=sugestoes` na página.
- [ ] **Step 2:** rodar e ver falhar. **Step 3:** implementar. **Step 4:** rodar e ver passar.
- [ ] **Step 5:** validação visual com `playwright-cli` em sessão isolada, dados injetados, 1440 e 390 px, claro e escuro, print real de cada estado. Medir o tempo até a lista na Avil: acima de 2 s, avisar antes do merge (plano B do ADR).
- [ ] **Step 6:** `scripts/preflight.sh` da skill de design e revisor independente (nota 8/10 ou mais). Commit.

### Task 7: Documentação e entrega

**Files:**
- Modify: `docs/decisions/0194-sugestoes-de-promocao.md` (status), `docs/decisions/README.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`, `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/reference/glossario.md`, `docs/TASKS.md`, `obsidian-vault/03-Módulos/Promoções.md`, `obsidian-vault/09-Logs/Changelog.md`

- [ ] **Step 1:** atualizar os arquivos acima.
- [ ] **Step 2:** `pnpm lint`, `pnpm preflight:static`, Codex no diff da branch, CI verde, merge fast-forward, conferir deploy do Render e das duas edges.
- [ ] **Step 3:** rodar o sync da Avil e conferir `anuncio_criado_em` preenchido.
