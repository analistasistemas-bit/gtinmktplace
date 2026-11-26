# API de agentes v2, passo 1: plano de implementação

> **Para agentes executores:** sub-skill obrigatória: superpowers:subagent-driven-development. Os passos usam checkbox (`- [ ]`).

**Objetivo:** entregar os filtros de recorte e de "sem número" no catálogo, a ferramenta `publiai_comparar_precos` e as permissões por chave (`margens` e `catalogo`) da API de agentes, tudo somente leitura.

**Arquitetura:**
- A regra pura fica em `_shared/agentes/`, com IO injetado como hoje. A edge `agentes` só monta as dependências.
- As permissões vêm da linha da conexão, lida na autenticação, e são aplicadas na casca MCP antes de qualquer argumento.
- A comparação generaliza `calcular` para uma lista de preços.

**Stack:** Deno edge functions (Supabase), TypeScript, vitest (os testes de `_shared` rodam no vitest do repositório), React e Radix na tela.

**Spec:** `docs/decisions/0210-acesso-de-agentes-mcp.md`, seção "Emenda 6" (aprovada em 2026-11-26). Ler a emenda inteira antes de cada tarefa.

## Restrições globais

- Somente leitura no Mercado Livre e em dado de cliente. Nenhuma permissão dá escrita.
- A organização vem só da conexão. Nenhuma ferramenta nova recebe organização.
- `margem_pct` continua sem arredondar; os componentes em reais continuam com `r2`.
- Permissões válidas: exatamente `margens` e `catalogo`. `publiai_loja` não exige permissão.
- Tetos:
  - comparação: 100 consultas de tarifa por chamada e de 2 a 5 preços;
  - página do catálogo: 50;
  - `abaixo_de_pct`: número finito em [−100, 100];
  - `sem_numero`: só `true`.
- Ferramenta nova ou alterada: atualizar `INSTRUCOES` (`mcp.ts`), o teste e o guia (`docs/reference/acesso-de-agentes.md`, `docs/reference/api-agentes.md`).
- Migration: só `supabase migration new` + `supabase db push` (ADR-0043). **Aplicar só com OK do Diego.**
- Merge e deploy só com OK do Diego.
- Revisão independente do branch inteiro (Codex Sol high) antes do merge.
- Comandos:
  - teste de um arquivo: `pnpm vitest run <caminho>` (`pnpm test -- arquivo` roda a suíte toda);
  - lint do backend: `deno lint supabase/functions`;
  - portão antes do push: `pnpm preflight`.
- Worktree: `pnpm install` real; nunca symlink do `node_modules` do checkout principal.
- Tela: `Checkbox` de `src/components/ui/checkbox.tsx`; nada de input nativo.

## Roteamento de modelos (CLAUDE.md §0.1)

| Tarefa | Modelo | Motivo |
|---|---|---|
| 1, 2, 3 | Opus | autorização e migration: nunca rebaixar |
| 5 | Opus | `calcular`, núcleo da conta de margem |
| 4, 6 | Sonnet medium | regra de leitura, tela e documentação |
| Revisão final | Codex Sol high | operação crítica |

## Foco de revisão

1. **Chave com `permissoes` corrompida** (nula, string, `['vendas']`): não vê nem chama ferramenta de negócio. Teste na Tarefa 2.
2. **Cursor forjado com `f` inválido** (`abaixo_de_pct: 999`, `sem_numero: false`): `cursor_invalido`, e nada vai para a auditoria. Teste na Tarefa 4.
3. **Comparação com preços que viram um só depois de `r2`** (`[49.9, 49.901]`): uma linha em `resultados` e tarifas reservadas uma vez. Teste na Tarefa 5.
4. **Alterar permissão de conexão revogada ou de outra organização**: 404 igual a inexistente; nada gravado. Teste na Tarefa 3.
5. **Página do catálogo vazia com filtro** (fim da loja): contagens zeradas presentes e `proximo_cursor` nulo. Teste na Tarefa 4.

---

### Tarefa 1: Migration da coluna `permissoes`

**Arquivos:** criar `supabase/migrations/<timestamp>_agente_conexoes_permissoes.sql`, por `supabase migration new agente_conexoes_permissoes`. Antes, `git fetch` e conferir que o timestamp é maior que o da última migration da `origin/main`.

**Interfaces:** produz a coluna `agente_conexoes.permissoes text[] not null default '{margens,catalogo}'`.

- [ ] **Passo 1:** escrever o SQL re-executável (`db push` não abre transação):
  ```sql
  alter table public.agente_conexoes add column if not exists permissoes text[] not null default '{margens,catalogo}';
  do $$ begin
    alter table public.agente_conexoes add constraint agente_conexoes_permissoes_check
      check (permissoes <@ '{margens,catalogo}'::text[] and cardinality(permissoes) >= 1);
  exception when duplicate_object then null; end $$;
  comment on column public.agente_conexoes.permissoes is 'Ferramentas que a chave pode usar (ADR-0210, Emenda 6).';
  ```
- [ ] **Passo 2:** validar sem aplicar, pelo método "Teste SQL sem Docker" (memória `reference_teste_sql_sem_docker`): numa única requisição `begin; <migration>`, com estas asserções:
  - linhas existentes ficam com `{margens,catalogo}`;
  - insert com `'{vendas}'` falha com 23514;
  - insert com `'{}'` falha com 23514.

  Termina em `raise exception 'TESTE_OK'` e `rollback`. Esperado: erro `P0001: TESTE_OK`.
- [ ] **Passo 3:** commit `feat(agentes): coluna permissoes por chave (migration, não aplicada)`. **Não rodar `db push`**: pedir OK ao Diego no fim do plano.

### Tarefa 2: Permissões na autenticação e na casca MCP

**Arquivos:**
- modificar `_shared/agentes/credencial.ts`, `auth-agente.ts`, `deps-banco.ts` (`buscarConexaoPorHash`), `http.ts` (tipo de `despachar`), `mcp.ts` e `agentes/index.ts`;
- testes: `__tests__/credencial.test.ts`, `auth-agente.test.ts`, `mcp.test.ts` e `http.test.ts`.

**Interfaces produzidas:**
- `credencial.ts`:
  - `export type Permissao = 'margens' | 'catalogo'`;
  - `export const PERMISSOES: readonly Permissao[] = ['margens', 'catalogo']`;
  - `export function permissoesDaLinha(x: unknown): Permissao[]`: não-array → `[]`; senão filtra os valores conhecidos, sem repetir;
  - `LinhaConexao` ganha `permissoes: unknown`.
- `ResultadoAuthAgente` ok: `{ ok: true; conexaoId: string; orgId: string; permissoes: Permissao[] }`.
- `http.ts`: `despachar(corpo, auth: { conexaoId: string; orgId: string; permissoes: Permissao[] })`.
- `mcp.ts`:
  - `Ferramenta` ganha `permissao: Permissao | null`, obrigatória;
  - `tratarMcp(corpo, f, auditar, permissoes: readonly Permissao[])`.

**Passos:**

- [ ] **Passo 1: testes que falham.**
  - **`credencial.test.ts`**: `permissoesDaLinha(null)`, `('margens')`, `({})` → `[]`; `(['vendas', 'margens', 'margens'])` → `['margens']`.
  - **`auth-agente.test.ts`**: linha com `permissoes: ['catalogo']` → resultado ok com `permissoes: ['catalogo']`; linha com `permissoes: null` → ok com `permissoes: []`.
  - **`mcp.test.ts`**:
    - `tools/list` com `['margens']`: só `publiai_loja`, `publiai_margem_anuncio` e `publiai_simular_margem` (e `publiai_comparar_precos` quando a Tarefa 5 entrar);
    - com `[]`: só `publiai_loja`;
    - `tools/call` de `publiai_margens_catalogo` com `['margens']` e cursor `'%%%'`:
      - `isError: true`, `JSON.parse(text)` = `{ estado: 'sem_permissao' }`;
      - `f.catalogo` não chamado;
      - auditoria `('publiai_margens_catalogo', null, 'sem_permissao')`;
    - ferramenta inexistente com `[]` → `-32602`, como hoje;
    - toda entrada de `FERRAMENTAS` tem a chave `permissao` (`'permissao' in def`).
- [ ] **Passo 2:** `pnpm vitest run supabase/functions/_shared/agentes/__tests__` → falham nos casos novos.
- [ ] **Passo 3: implementar.**
  - `buscarConexaoPorHash` seleciona também `permissoes`.
  - `autenticarAgente` devolve `permissoes: permissoesDaLinha(linha.permissoes)`.
  - `tratarRequisicao` repassa o campo a `despachar`; `index.ts` o passa a `tratarMcp`.
  - Em `chamarFerramenta`, logo depois do `-32602` e antes de ler `arguments`: se `def.permissao !== null && !permissoes.includes(def.permissao)`, auditar `(nome, null, 'sem_permissao')` e devolver `conteudo(id, { estado: 'sem_permissao' }, true)`.
  - `tools/list` filtra pela mesma regra.
  - Mapa: `publiai_loja: null`, `publiai_margem_anuncio` e `publiai_simular_margem: 'margens'`, `publiai_margens_catalogo: 'catalogo'`.
- [ ] **Passo 4:** os mesmos testes → PASS; `deno lint supabase/functions/_shared/agentes supabase/functions/agentes` sem erro.
- [ ] **Passo 5:** commit `feat(agentes): permissão por chave na autenticação e no MCP`.

### Tarefa 3: Criar e alterar permissões em `agente-conexoes`

**Arquivos:**
- modificar `_shared/agentes/conexoes.ts`, `conexoes-http.ts` e `agente-conexoes/index.ts`;
- testes: `__tests__/conexoes.test.ts` e `conexoes-http.test.ts`.

**Interfaces:**
- Consome `Permissao` e `PERMISSOES` (Tarefa 2).
- Produz:
  - `validarPermissoes(x: unknown): Permissao[] | null`: array, ao menos um, todos conhecidos, sem repetir; senão `null`;
  - `validarNova` passa a devolver também `permissoes`: ausente = `['margens', 'catalogo']`; presente e inválido = `{ erro: 'permissoes_invalidas' }`;
  - `inserirConexao` recebe `permissoes`;
  - `ConexaoLista` e `projetarConexao` ganham `permissoes: Permissao[]` (por `permissoesDaLinha`);
  - `alterarPermissoes(admin, orgId, id, p: Permissao[]): Promise<boolean>`: update com `.eq('org_id').eq('id').is('revogada_em', null).select('id')`; `true` só com uma linha;
  - ação HTTP `{ acao: 'permissoes', id, permissoes }` → `{ ok: true }`, 400 `{ erro: 'Escolha ao menos uma permissão válida.' }` ou 404 `NAO_ENCONTRADA`;
  - em `DepsConexoes.acoes`: `alterarPermissoes(orgId, id, p): Promise<boolean>`; `criar` recebe `permissoes`.

**Passos:**

- [ ] **Passo 1: testes que falham.**
  - `validarPermissoes(['margens'])` → `['margens']`; `([])`, `(['vendas'])`, `('margens')` e `(['margens', 'margens'])` → `null`.
  - `validarNova({ nome: 'x', dias: null })` → `permissoes: ['margens', 'catalogo']`.
  - **HTTP:**
    - `permissoes` com id válido e `acoes.alterarPermissoes` devolvendo `false` → 404;
    - com `permissoes: []` → 400, sem chamar a ação;
    - em sessão de suporte → 403 antes de ler o corpo, como as outras ações;
    - `listar` projeta `permissoes` e nunca `hash`.
  - **Banco (mock do client):** `alterarPermissoes` chama os filtros `org_id`, `id` e `revogada_em is null`.
- [ ] **Passo 2:** rodar os dois arquivos → FAIL.
- [ ] **Passo 3:** implementar e ligar em `agente-conexoes/index.ts`.
- [ ] **Passo 4:** os dois arquivos → PASS; lint.
- [ ] **Passo 5:** commit `feat(agentes): criar e alterar permissões da chave`.

### Tarefa 4: Filtros do catálogo

**Arquivos:**
- modificar `_shared/agentes/margens.ts`, `mcp.ts` (esquema, `preparar`, auditoria do catálogo) e `agentes/index.ts`;
- testes: `__tests__/margens.test.ts` e `mcp.test.ts`.

**Interfaces produzidas (`margens.ts`):**
- `export type FiltroCatalogo = { abaixo_de_pct?: number; sem_numero?: true }`.
- `export function validarFiltro(a: { abaixo_de_pct?: unknown; sem_numero?: unknown }): FiltroCatalogo | 'invalido'`: os dois ausentes → `{}`.
- `export function chaveFiltro(f: FiltroCatalogo): string | null`: `null` sem filtro; senão `abaixo_de:<n>`, `sem_numero` ou `abaixo_de:<n>+sem_numero`, com `<n>` = `String(Number(n))`. Serve ao cursor e à auditoria.
- `margensDoCatalogo(cursor, d, filtro: FiltroCatalogo = {})`.
- `RespostaCatalogo` ok ganha `examinados: number`, `sem_numero_por_motivo: Record<string, number>` e `com_margem_ate_zero: number`.
- Cursor:
  - `{ o, d, f? }`, em que `f` é `chaveFiltro`;
  - `lerCursor` revalida `f` (reconstrói pelo `validarFiltro` a partir da chave; falhou → inválido);
  - chamada sem filtro herda `f` do cursor;
  - chamada com filtro diferente do `f` do cursor (inclusive cursor sem `f`) → `cursor_invalido`.
- `Ferramentas.catalogo(cursor: string | null, filtro: FiltroCatalogo)`.

**Passos:**

- [ ] **Passo 1: testes que falham** (`margens.test.ts`, deps falsas como os testes existentes).
  - **Página com 4 anúncios** (margens 30, 10, −2 e sem número com `sem_custo`):
    - `{ abaixo_de_pct: 18 }` → `anuncios` = os de 10 e −2; `examinados: 4`; `sem_numero_por_motivo: { sem_custo: 1 }`; `com_margem_ate_zero: 1`;
    - `{ sem_numero: true }` → só o `sem_custo`;
    - os dois juntos → 10, −2 e `sem_custo`;
    - sem filtro → os 4, com as contagens.
  - **Cursor:**
    - `proximo_cursor` da página filtrada, reusado sem filtro, aplica o mesmo filtro;
    - reusado com `{ abaixo_de_pct: 20 }` → `cursor_invalido`;
    - forjado com `f: 'abaixo_de:999'` → `cursor_invalido`.
  - **Página vazia com filtro** → `examinados: 0`, contagens `{}` e `0`, `proximo_cursor: null`.
  - **Validação:** `validarFiltro({ abaixo_de_pct: NaN })`, `({ abaixo_de_pct: 101 })` e `({ sem_numero: false })` → `'invalido'`.
  - **`mcp.test.ts`:**
    - `abaixo_de_pct: '18'` (string) → `argumento_invalido`, auditoria com `alvo` nulo;
    - `{ abaixo_de_pct: 18, sem_numero: true }` → auditoria com `alvo` `abaixo_de:18+sem_numero`;
    - o esquema declara `abaixo_de_pct` (number) e `sem_numero` (boolean).
- [ ] **Passo 2:** FAIL.
- [ ] **Passo 3: implementar.**
  - As contagens saem do resultado de `calcular` antes do filtro.
  - O filtro é aplicado depois de `parcial`, que continua sobre a página lida.
  - A auditoria do catálogo grava `chaveFiltro` do filtro **validado**. O filtro herdado do cursor só é conhecido depois de ler o cursor: nesse caso gravar a chave lida, já validada.
  - Descrições (copy exata):
    - **ferramenta:** `'Margens dos anúncios publicados, 50 por página. Filtros opcionais: abaixo_de_pct (margem menor que o valor, inclui prejuízo) e sem_numero (anúncios sem margem calculada, com o motivo). A loja inteira só está lida quando proximo_cursor vier nulo: página com anuncios vazio não é o fim; siga o cursor e some examinados e as contagens.'`;
    - **`cursor`:** `'proximo_cursor da página anterior; o filtro fica preso a ele.'`.
- [ ] **Passo 4:** PASS; lint.
- [ ] **Passo 5:** commit `feat(agentes): recorte e sem número no catálogo`.

### Tarefa 5: `publiai_comparar_precos`

**Arquivos:**
- modificar `_shared/agentes/margens.ts`, `mcp.ts` e `agentes/index.ts`;
- testes: `__tests__/margens.test.ts` e `mcp.test.ts`.

**Interfaces:**
- **Consome:** `permissao` (Tarefa 2).
- **Produz:**
  - `export function compararPrecos(identificador: string, precos: unknown, d: DepsMargens): Promise<RespostaComparacao>`;
  - `RespostaComparacao`:
    - `({ estado: 'ok'; resultados: { preco_brl: number; anuncios: MargemSimulada[]; referencia: Referencia }[] } & Lido)`;
    - `| { estado: 'candidatos'; candidatos; lista_cortada }`;
    - `| { estado: 'nao_encontrado' | 'alvo_grande' | 'preco_invalido' }`;
    - `| Falha`;
  - `Ferramentas.comparar(identificador: string, precos: unknown)`; ferramenta `publiai_comparar_precos` com `permissao: 'margens'` e esquema `{ identificador: string, precos_brl: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 5 } }`, ambos obrigatórios.
- **Conta:** `calcular(mlbs, d, precosSimulados: number[] | null)` passa a devolver uma lista de `Calculada[]` por preço (`null` = preço atual, como hoje). `simularMargem` e o catálogo usam o novo formato sem mudar a saída.

**Passos:**

- [ ] **Passo 1: testes que falham.**
  - **Ordem e reaproveitamento:** `[59.9, 49.9]` num MLB de 1 cor → `resultados[0].preco_brl === 59.9` e `[1] === 49.9`; `reservarLeituras` chamado uma vez com `2 * 1 + 1`; `buscarItensML` uma vez; `reservarTarifas` uma vez com `4`.
  - **Deduplicação:** `[49.9, 49.901]` → um resultado, `reservarTarifas(2)`.
  - **Validação:** `[49.9]`, 6 preços, `[49.9, -1]` e `'49.9'` → `preco_invalido`, sem nenhuma reserva.
  - **Primeiro corte:** 5 preços × 11 MLBs (110 > 100) → `alvo_grande` antes de `reservarLeituras`.
  - **Segundo corte:** 5 preços × 1 MLB com 11 cores → `alvo_grande`, com `reservarLeituras` chamado, `lerPrecos` e `reservarTarifas` não chamados.
  - **Concorrência:** com `tarifaEm` contando as chamadas simultâneas, 1 MLB de 10 cores × 5 preços nunca passa de 4.
  - **`referencia` por preço:** pior margem do alvo naquele preço, como em `simularMargem`.
  - **`mcp.test.ts`:** `tools/list` com `['catalogo']` não mostra a ferramenta; auditoria com o alvo canônico do identificador.
- [ ] **Passo 2:** FAIL.
- [ ] **Passo 3: implementar.**
  - **Ordem de `calcular`:** alíquota → leituras → itens e status → segundo corte (só na comparação) → `lerPrecos` → reserva de tarifas (`Σ cores × 2 × nº de preços`) → cadastro → `emParalelo` sobre os pares (mlb, preço) com 4 de concorrência.
  - O primeiro corte fica em `compararPrecos`, depois de `resolverAlvo` e antes de `calcular`.
  - Constante `TETO_TARIFAS_COMPARACAO = 100`.
  - O detalhe por par chama `detalheEquilibrioDoMlb` como hoje (sem mexer em `campanhas.ts`).
- [ ] **Passo 4:** todos os testes de `margens.test.ts` (antigos inclusive) → PASS; lint.
- [ ] **Passo 5:** commit `feat(agentes): comparar preços`.

### Tarefa 6: Instruções, tela e guias

**Arquivos:**
- modificar `mcp.ts` (`INSTRUCOES`), `src/hooks/useAgenteConexoes.ts`, `src/components/configuracoes/secao-agentes.tsx`, `docs/reference/acesso-de-agentes.md` e `docs/reference/api-agentes.md`;
- testes: `mcp.test.ts`, `src/hooks/__tests__/useAgenteConexoes.test.ts` e `src/components/configuracoes/__tests__/secao-agentes.test.tsx`.

**Interfaces:**
- **Consome:**
  - a ação `permissoes` e o campo `permissoes` da listagem (Tarefa 3);
  - os nomes de argumentos e campos das Tarefas 4 e 5.
- **Produz:** `criarConexaoAgente(nome, dias, permissoes: Permissao[])` e `alterarPermissoesAgente(id, permissoes)` no hook.

**Passos:**

- [ ] **Passo 1: testes que falham.**
  - **`INSTRUCOES` contém as frases (copy exata):**
    - `'"Abaixo de X%": use publiai_margens_catalogo com abaixo_de_pct=X e siga proximo_cursor até vir nulo; página vazia não é o fim. Diga até onde leu se parar antes.'`
    - `'"O que está sem margem e por quê": publiai_margens_catalogo com sem_numero=true (cadastro a corrigir, com o motivo). Prejuízo ou margem zero: abaixo_de_pct=0.01; só chame de prejuízo o anúncio com motivo sem_espaco_para_ads.'`
    - `'"Entre A, B e C, qual deixa X%": use publiai_comparar_precos e escolha o menor preço cuja referencia.margem_pct seja maior ou igual a X, comparando o número sem arredondar; com referencia.motivo anuncio_sem_numero, não escolha preço. alvo_grande: peça um MLB só.'`
    - `'Ao listar, separe anúncios active dos paused ou closed.'`
    - `'sem_permissao: a chave não pode usar essa ferramenta; avise o usuário, sem tentar outra ferramenta para obter o mesmo dado.'`
  - **Tela:**
    - o formulário de criação mostra dois `Checkbox` marcados: "Margem de anúncios (consulta, simulação e comparação)" e "Catálogo inteiro (consome a cota diária da loja)";
    - desmarcar os dois desabilita "Criar";
    - a lista mostra as permissões de cada chave ativa e um botão "Permissões", que abre o mesmo par de checkboxes e chama `alterarPermissoesAgente`;
    - abaixo dos checkboxes, a nota: "Sem 'Catálogo inteiro', o agente ainda consulta anúncios um a um e gasta a mesma cota diária."
- [ ] **Passo 2:** FAIL.
- [ ] **Passo 3: implementar.**
  - **Guias:**
    - **`acesso-de-agentes.md`:**
      - permissões e o que `catalogo` não protege;
      - filtros, regra do cursor e campos novos;
      - `publiai_comparar_precos` com exemplo;
      - estado `sem_permissao`;
      - limites: teto de 100 tarifas e 2 a 5 preços;
      - a frase sobre `isError` atualizada.
    - **`api-agentes.md`:** os mesmos contratos.
- [ ] **Passo 4:** `pnpm vitest run` dos três arquivos → PASS; `pnpm preflight` verde.
- [ ] **Passo 5:** commit `feat(agentes): instruções, tela de permissões e guias da Emenda 6`.

### Fechamento (sem tarefa de código)

1. **Revisão:** Codex Sol high em contexto limpo, sobre o diff do branch, a Emenda 6 e os arquivos tocados. Nada de `.env`. Corrigir os achados com teste.
2. **Pedir OK ao Diego para:**
   - `db push` da migration (depois, `npm run db:check` e a coluna conferida no `information_schema`);
   - deploy de `agentes` e `agente-conexoes` (`_shared/agentes` mudou), com a versão e os arquivos conferidos contra o commit;
   - merge fast-forward com CI verde.
3. **Aceite na Zaven, pelo conector:**
   - `tools/list` com as 5 ferramentas;
   - `abaixo_de_pct: 18` em sequência até o cursor nulo, conferindo contra a M1 (as camisas a 17,996% entram);
   - `sem_numero` → nenhum anúncio na Zaven hoje;
   - `publiai_comparar_precos` em `MLB5419187671` com `[55.7, 57.37, 61.17]`;
   - uma chave só com `margens` (criada pelo Diego), que recebe `sem_permissao` no catálogo.
4. **Documentos:**
   - na ADR, o aceite com o que foi medido e o que é inferência;
   - `docs/project-status.md`;
   - a memória `project_acesso_de_agentes`;
   - a nota no cofre Obsidian (`Compartilhado/Projetos/`).
