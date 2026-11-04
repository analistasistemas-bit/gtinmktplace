# Pré-preenchimento fiscal completo na importação do XML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao cadastrar produto novo a partir de item da nota de compra, a etapa fiscal chega toda preenchida (NCM, origem NF-e, origem binária, FCI, CSOSN, CEST, descrição), com conferência obrigatória e decisão explícita nos casos de exceção.

**Architecture:** Leitor do XML passa a extrair grupo ICMS/CSOSN/CST/CEST/nFCI do item e UF do emitente. Função pura nova classifica a entrada (ST / sem ST / exceção) e sugere o CSOSN de saída. `prefillCadastro` monta o `CadastroInicial` com tudo + avisos; os dois diálogos de cadastro pré-selecionam a origem binária (só com `sugestaoDaNota`) e o form fiscal exibe avisos e checkboxes obrigatórios, que caem quando o campo atestado muda.

**Tech Stack:** React + TS (Vite), vitest + Testing Library, código `_shared` puro importado pelo front e pelo Deno.

**Spec:** `docs/superpowers/specs/2026-11-03-fiscal-prefill-xml-design.md`

## Global Constraints

- Nada fiscal em silêncio: todo campo vindo da nota tem selo "Veio da nota do fornecedor — confira" e o "Conferi" segue obrigatório.
- CSOSN do fornecedor nunca é copiado; CSOSN de saída só ∈ {`500`, `csosn_padrao_revenda` válido em `CSOSN_VALIDOS`} ou vazio.
- Exceção → CSOSN vazio, sem sugestão (contador: "não deixar em branco ou replicar, analisar caso a caso" — o vazio aqui obriga a escolha antes de salvar).
- Viabilidade (sem `sugestaoDaNota`) mantém a trava V-3: origem binária nunca pré-selecionada.
- `_shared/nfe/regras.ts` NÃO é alterado (importado por `_shared/canais/fiscal-ml.ts` e `_shared/produto/gtin.ts`).
- Dropdown sempre `src/components/ui/select.tsx` (nada de `<select>` nativo).
- Sem migration, sem RPC nova, sem edge nova.
- Validação por task: `pnpm test -- <escopo>`; fim: `pnpm preflight:static`.

## Review Focus

1. XML de ERP com namespace prefixado (`nfe:ICMS60`) — grupo ICMS precisa ser lido com `PFX` (teste em T1).
2. `orig` = 0 (falsy) — origem binária e origem NF-e precisam pré-selecionar mesmo assim (teste em T2).
3. Operador troca o CSOSN 500 sugerido para 102 depois de marcar "Conferi" → "Conferi" desmarca (teste em T3).
4. CEST digitado depois do aviso → checkbox "sem CEST vigente" deixa de ser exigido (teste em T3).
5. `empresa_fiscal.uf` nula ou `emitenteUf` nula → não é "interestadual" (sem aviso; sem trava) (teste em T2).

---

### Task 1: Leitura do XML + classificação ICMS da entrada

**Files:**
- Modify: `supabase/functions/_shared/nfe/tipos.ts`
- Modify: `supabase/functions/_shared/nfe/ler-nfe.ts`
- Create: `supabase/functions/_shared/nfe/icms-entrada.ts`
- Test: `supabase/functions/_shared/nfe/__tests__/ler-nfe.test.ts`, create `supabase/functions/_shared/nfe/__tests__/icms-entrada.test.ts`
- Modify (fixtures tipados que quebram com os campos novos): `src/components/estoque/importar-nota/__tests__/estado.test.ts:11` e qualquer outro `ItemNotaLido`/`NotaCompraLida` literal achado por `pnpm exec tsc -b`; ajustar o `toEqual` existente do leitor

**Interfaces:**
- Produces:
  - `ItemNotaLido` += `icmsGrupo: string | null` (nome do 1º filho de `<ICMS>`, ex. `'ICMS60'`, `'ICMSSN102'`, `'ICMSST'`), `csosn: string | null`, `cstIcms: string | null` (só do bloco ICMS — nunca PIS/COFINS), `cest: string | null` (`prod/CEST`, só se `/^\d{7}$/`), `nFci: string | null` (`prod/nFCI`).
  - `NotaCompraLida` += `emitenteUf: string | null` (`emit/enderEmit/UF`, maiúsculo, só se `/^[A-Z]{2}$/`).
  - `type ClasseIcmsEntrada = 'st' | 'sem_st' | 'excecao'`
  - `classificarIcmsEntrada(i: Pick<ItemNotaLido, 'icmsGrupo' | 'csosn' | 'cstIcms'>): ClasseIcmsEntrada`
  - `csosnSaidaSugerido(classe: ClasseIcmsEntrada, padrao: string | null): string | null` — `st`→`'500'`; `sem_st`→`padrao` se ∈ `CSOSN_VALIDOS` (import de `../fiscal/validar.ts`), senão `null`; `excecao`→`null`.
  - `CODIGO_FORNECEDOR(i): string | null` não é necessário — o form exibe `csosn ?? cstIcms`.

Tabela de classificação (ordem: grupo `ICMSST` → st; depois CSOSN; depois CST; nada → excecao):
- CSOSN `201|202|203|500` → st · `101|102` → sem_st · demais (`103|300|400|900`/desconhecido) → excecao
- CST `10|30|60|70` → st · `00|20` → sem_st · demais (`40|41|50|51|90|02|15|53|61`/desconhecido) → excecao

- [ ] **Step 1: Testes que falham**

`icms-entrada.test.ts`:
```ts
it.each([
  [{ icmsGrupo: 'ICMSSN500', csosn: '500', cstIcms: null }, 'st'],
  [{ icmsGrupo: 'ICMSSN201', csosn: '201', cstIcms: null }, 'st'],
  [{ icmsGrupo: 'ICMS60', csosn: null, cstIcms: '60' }, 'st'],
  [{ icmsGrupo: 'ICMS30', csosn: null, cstIcms: '30' }, 'st'],
  [{ icmsGrupo: 'ICMSST', csosn: null, cstIcms: '41' }, 'st'],
  [{ icmsGrupo: 'ICMSSN102', csosn: '102', cstIcms: null }, 'sem_st'],
  [{ icmsGrupo: 'ICMS00', csosn: null, cstIcms: '00' }, 'sem_st'],
  [{ icmsGrupo: 'ICMSSN103', csosn: '103', cstIcms: null }, 'excecao'],
  [{ icmsGrupo: 'ICMS40', csosn: null, cstIcms: '40' }, 'excecao'],
  [{ icmsGrupo: 'ICMSSN900', csosn: '900', cstIcms: null }, 'excecao'],
  [{ icmsGrupo: null, csosn: null, cstIcms: null }, 'excecao'],
])('classifica %o → %s', (i, esperado) => expect(classificarIcmsEntrada(i)).toBe(esperado));
it('sugere CSOSN', () => {
  expect(csosnSaidaSugerido('st', '102')).toBe('500');
  expect(csosnSaidaSugerido('sem_st', '102')).toBe('102');
  expect(csosnSaidaSugerido('sem_st', null)).toBeNull();
  expect(csosnSaidaSugerido('sem_st', '999')).toBeNull();
  expect(csosnSaidaSugerido('excecao', '102')).toBeNull();
});
```
`ler-nfe.test.ts` (novo caso, XML inline mínimo — copiar a estrutura de `fixtures/nfe-exportacao-erp.xml` acrescentando `<enderEmit><UF>pe</UF></enderEmit>` no `emit`, `<CEST>2805900</CEST><nFCI>B01F70AF-10BF-4B1F-848C-65FF57F616FE</nFCI>` no `prod` e `<ICMS><nfe:ICMS60><orig>0</orig><CST>60</CST></nfe:ICMS60></ICMS>` com prefixo `nfe:` em todas as tags; e um 2º `det` com `<PIS><PISAliq><CST>01</CST>…` e `<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>`):
```ts
expect(nota.emitenteUf).toBe('PE');
expect(nota.itens[0]).toMatchObject({ icmsGrupo: 'ICMS60', cstIcms: '60', csosn: null, cest: '2805900', nFci: 'B01F70AF-10BF-4B1F-848C-65FF57F616FE' });
expect(nota.itens[1]).toMatchObject({ icmsGrupo: 'ICMSSN102', csosn: '102', cstIcms: null, cest: null, nFci: null });
```
E nas fixtures existentes: `cest`/`nFci`/`emitenteUf` `null` quando ausentes (não lançar erro). Casos negativos: item sem `<ICMS>` mas com `<PIS><PISAliq><CST>01</CST>` → `cstIcms`/`csosn`/`icmsGrupo` `null`; `ICMS60` com `vICMSSTRet` 0 e sem `vICMSST` → classifica `st`.

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/nfe` → FAIL.
- [ ] **Step 3:** Implementar. Grupo ICMS: primeiro match de `new RegExp(\`<${PFX}(ICMS[A-Z0-9]+)\\b\`)` dentro do corpo de `<ICMS>`. CSOSN/CST via `texto(icms, 'CSOSN'|'CST')`.
- [ ] **Step 4:** Mesmo comando → PASS (inclui `regras.test.ts` e testes da edge `importar-nota-compra` sem regressão: `pnpm test -- importar-nota-compra`).
- [ ] **Step 5:** Commit `feat(nfe): ler grupo ICMS, CEST, nFCI e UF do emitente; classificação ICMS da entrada`.

### Task 2: `prefillCadastro` completo + contrato `CadastroInicial`

**Files:**
- Modify: `src/components/estoque/importar-nota/prefill-cadastro.ts`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (só o tipo `CadastroInicial` e `fiscalDoInicial`)
- Modify: `src/components/estoque/importar-nota/dialog-importar-nota.tsx:63-68` (passa o contexto)
- Test: `src/components/estoque/importar-nota/__tests__/prefill-cadastro.test.ts`, `src/components/estoque/__tests__/dialog-cadastro-produto.test.tsx` (só `fiscalDoInicial`)

**Interfaces:**
- Consumes: T1 (`classificarIcmsEntrada`, `csosnSaidaSugerido`, novos campos).
- Produces:
  - `prefillCadastro(item: ItemConciliado, nota: NotaCompraLida, fator: number, ctx: { csosnPadrao: string | null; ufEmpresa: string | null }): CadastroInicial`
  - `CadastroInicial.fiscal?: { ncm?: string; origemNfe?: number; tributacaoIcms?: string; cest?: string; fci?: string }`
  - `CadastroInicial.avisosNota?: AvisosFiscaisNota` com
    `interface AvisosFiscaisNota { classe: ClasseIcmsEntrada; codigoFornecedor: string | null /* csosn ?? cstIcms */; semCest: boolean; interestadual: boolean; semPadrao: boolean /* classe sem_st e padrão inválido */ }` — exportado de `dialog-cadastro-produto.tsx`.
  - `fiscalDoInicial` passa a copiar `tributacaoIcms`, `cest`, `fci`.
  - `origemSugerida` continua; o comentário do tipo muda: "pré-seleciona a origem binária SOMENTE com `sugestaoDaNota`".
  - `dialog-importar-nota.tsx` lê `useEmpresaFiscal()` e passa `{ csosnPadrao: empresa?.csosn_padrao_revenda ?? null, ufEmpresa: empresa?.uf ?? null }`.

Regras: `fci` só quando `origemNfe ∈ {3,5,8}` e `item.nFci`; `interestadual = !!nota.emitenteUf && !!ufEmpresa && nota.emitenteUf !== ufEmpresa.trim().toUpperCase()`; `semCest = !item.cest`.

- [ ] **Step 1: Testes que falham** (atualizar os que hoje exigem `tributacaoIcms: ''`; hoje `item`/`nota` no teste são objetos — criar helpers `item(patch)`/`nota(patch)` sobre eles e passar `ctx` em TODAS as chamadas existentes):
```ts
const ctx = { csosnPadrao: '102', ufEmpresa: 'PE' };
it('ST → 500 e CEST da nota', () => {
  const r = prefillCadastro(item({ icmsGrupo: 'ICMS60', cstIcms: '60', cest: '2805900' }), nota({ emitenteUf: 'PE' }), 1, ctx);
  expect(r.fiscal).toMatchObject({ tributacaoIcms: '500', cest: '2805900' });
  expect(r.avisosNota).toEqual({ classe: 'st', codigoFornecedor: '60', semCest: false, interestadual: false, semPadrao: false });
});
it('sem ST → padrão', () => expect(prefillCadastro(item({ icmsGrupo: 'ICMSSN102', csosn: '102' }), nota(), 1, ctx).fiscal?.tributacaoIcms).toBe('102'));
it('exceção → vazio', () => expect(prefillCadastro(item({ icmsGrupo: 'ICMSSN400', csosn: '400' }), nota(), 1, ctx).fiscal?.tributacaoIcms).toBe(''));
it('sem padrão → vazio + semPadrao', () => {
  const r = prefillCadastro(item({ icmsGrupo: 'ICMSSN102', csosn: '102' }), nota(), 1, { ...ctx, csosnPadrao: null });
  expect(r.fiscal?.tributacaoIcms).toBe(''); expect(r.avisosNota?.semPadrao).toBe(true);
});
it('interestadual', () => expect(prefillCadastro(item({}), nota({ emitenteUf: 'SP' }), 1, ctx).avisosNota?.interestadual).toBe(true));
it('UF desconhecida não é interestadual', () => {
  expect(prefillCadastro(item({}), nota({ emitenteUf: null }), 1, ctx).avisosNota?.interestadual).toBe(false);
  expect(prefillCadastro(item({}), nota({ emitenteUf: 'SP' }), 1, { ...ctx, ufEmpresa: null }).avisosNota?.interestadual).toBe(false);
});
it('orig 0 pré-seleciona nacional', () => {
  const r = prefillCadastro(item({ orig: 0 }), nota(), 1, ctx);
  expect(r.fiscal?.origemNfe).toBe(0); expect(r.origemSugerida).toBe('nacional');
});
it('FCI só com origem 3/5/8', () => {
  expect(prefillCadastro(item({ orig: 5, nFci: 'B01F70AF-10BF-4B1F-848C-65FF57F616FE' }), nota(), 1, ctx).fiscal?.fci).toBe('B01F70AF-10BF-4B1F-848C-65FF57F616FE');
  expect(prefillCadastro(item({ orig: 0, nFci: 'B01F70AF-10BF-4B1F-848C-65FF57F616FE' }), nota(), 1, ctx).fiscal?.fci).toBeUndefined();
});
```
`fiscalDoInicial({ fiscal: { tributacaoIcms: '500', cest: '2805900', fci: 'X' } })` → `{ tributacaoIcms: '500', cest: '2805900', fci: 'X', … }`.
- [ ] **Step 2:** `pnpm test -- prefill-cadastro dialog-cadastro-produto` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando + `pnpm test -- importar-nota` → PASS.
- [ ] **Step 5:** Commit `feat(estoque): prefill fiscal completo a partir da nota (CSOSN, CEST, FCI, avisos)`.

### Task 3: Form fiscal + diálogos — origem pré-selecionada, avisos, confirmações e invalidação

**Files:**
- Modify: `src/components/estoque/etapa-fiscal-form.tsx`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx`
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx`
- Test: `src/components/estoque/__tests__/etapa-fiscal-form.test.tsx`, `dialog-cadastro-produto.test.tsx`, `dialog-cadastro-grade.test.tsx`

**Interfaces:**
- Consumes: T2 (`AvisosFiscaisNota`, `CadastroInicial.avisosNota`, `origemSugerida`).
- Produces:
  - `interface ConfirmacoesNota { conferido: boolean; semCestVigente: boolean; interestadualConferido: boolean }`
  - `confirmacoesNotaOk(f: FiscalForm, avisos: AvisosFiscaisNota | undefined, c: ConfirmacoesNota): boolean` (em `etapa-fiscal-form.tsx`): `c.conferido && (!avisos?.semCest || !!f.cest || c.semCestVigente) && (!avisos?.interestadual || c.interestadualConferido)`.
  - `EtapaFiscalForm` props: troca `conferido`/`onConferir` por `confirmacoes?: ConfirmacoesNota`, `onConfirmar?: (patch: Partial<ConfirmacoesNota>) => void`, `avisosNota?: AvisosFiscaisNota`.

Comportamento:
- Diálogos: no efeito de abertura, `if (fiscalAtivo && inicial.sugestaoDaNota && inicial.origemSugerida) setOrigem(inicial.origemSugerida)` (produto) — grade idem. **Sem módulo fiscal não existe etapa de conferência: a origem continua vazia e o selo antigo "escolha para confirmar" fica.** Como `fiscalAtivo` vem de query, incluir no array de dependências de um efeito próprio que só seta enquanto `origem === null`. Viabilidade intocada.
- Diálogos: uma única função `mudarFiscal(patch)` por diálogo, usada por `onMudar` **e por `onAplicarSugestao`** (hoje escreve direto em `setFiscal`, `dialog-cadastro-produto.tsx:276` e equivalente na grade). Matriz de invalidação, exportada como `confirmacoesAposMudanca(c: ConfirmacoesNota, antes: FiscalForm, depois: FiscalForm): ConfirmacoesNota` em `etapa-fiscal-form.tsx`: mudou `ncm|origemNfe|tributacaoIcms|cest|fci` → `conferido:false`; mudou `ncm|cest` → `semCestVigente:false`; mudou `tributacaoIcms` → `interestadualConferido:false`. Trocar a origem binária zera `conferido`.
- Botão "Cadastrar" (`dialog-cadastro-produto.tsx:468`, `dialog-cadastro-grade.tsx:869`): `!!inicial?.sugestaoDaNota && !conferiuFiscal` → `!!inicial?.sugestaoDaNota && !confirmacoesNotaOk(fiscal, inicial.avisosNota, confirmacoes)`.
- `SeloSugestaoOrigem` texto: "Veio da nota: Nacional|Importado — confira".
- Form, com `sugestaoDaNota`: selo também em CSOSN (quando preenchido), CEST (quando preenchido), FCI (quando preenchido).
- Avisos (`role="alert"` não; `StatusPill tone="warning"` + texto), copy exata:
  - `classe==='excecao'`: "O fornecedor usou {codigoFornecedor ?? 'um código sem regra'} (isenção, imunidade ou caso especial). Escolha o CSOSN de saída analisando o motivo — orientação do contador:" + lista: "102 — tributada pelo Simples, sem crédito, quando não se enquadrar em código específico", "103 — isenção por faixa de receita bruta do Simples", "300 — operação imune ao ICMS", "400 — não tributada pelo ICMS no Simples", "500 — ICMS já cobrado por ST ou antecipação".
  - `semPadrao`: "Sem CSOSN padrão de revenda no card Empresa — escolha o CSOSN."
  - Botão "Usar padrão da empresa": **oculto quando `avisosNota?.classe === 'excecao'`** (exceção é sem sugestão).
  - `classe==='st'`: "Nota do fornecedor com ST ({codigoFornecedor}) — CSOSN 500."
  - `semCest && !cest`: "A nota não trouxe CEST. Preencha se o NCM tiver CEST vigente." + checkbox "Este NCM não tem CEST vigente".
  - `interestadual`: "Compra de outro estado: pode haver ST por antecipação. Confira o CSOSN com o contador." + checkbox "Conferi o CSOSN com o contador".
  - Checkbox geral: "Conferi os dados fiscais (NCM, origem, CSOSN, CEST)".
- Checkboxes no padrão existente (`<input type="checkbox">` dentro de `<label>`, igual à linha 268-271).

- [ ] **Step 1: Testes que falham**
  - `etapa-fiscal-form.test.tsx`: `confirmacoesNotaOk` — tabela: sem avisos/conferido → true; `semCest` sem cest e sem `semCestVigente` → false; `semCest` com `cest:'2805900'` → true; `interestadual` sem `interestadualConferido` → false; `conferido:false` → false. Render com `avisosNota={{classe:'excecao', codigoFornecedor:'400', …}}` mostra "O fornecedor usou 400" e "300 — operação imune ao ICMS".
  - `dialog-cadastro-produto.test.tsx`: aberto com `inicial={{ sugestaoDaNota: true, origemSugerida: 'nacional', fiscal: { ncm, origemNfe: 0, tributacaoIcms: '500', cest: '2805900' }, avisosNota: { classe:'st', codigoFornecedor:'60', semCest:false, interestadual:false, semPadrao:false } }}` → rádio Nacional marcado; na etapa fiscal, marcar "Conferi os dados fiscais" habilita Cadastrar; trocar CSOSN para 102 desabilita de novo (Review Focus 3); sem `sugestaoDaNota` (`inicial={{ origemSugerida: 'nacional' }}`) → nenhum rádio marcado (V-3).
  - `confirmacoesAposMudanca`: tabela da matriz acima. Render com exceção + `csosnPadrao='102'` → sem botão "Usar padrão".
  - Mesmo caso de origem pré-selecionada + "Conferi" no `dialog-cadastro-grade.test.tsx`, incluindo: digitar CEST dispensa o checkbox de CEST; aplicar sugestão de NCM da IA desmarca "Conferi"; sem módulo fiscal a origem nasce vazia.
  - Atualizar SÓ os testes da nota que exigem rádio desmarcado/selo antigo/"Conferi NCM e origem" (`dialog-cadastro-produto.test.tsx:1156`, `dialog-cadastro-grade.test.tsx:967`); os de Viabilidade (V-3) ficam intocados.
- [ ] **Step 2:** `pnpm test -- src/components/estoque` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(estoque): etapa fiscal da nota com origem pré-selecionada, avisos e confirmações`.

### Task 4: Aviso de divergência em produto já existente

**Files:**
- Modify: `src/components/estoque/importar-nota/dialog-importar-nota.tsx` (query + prop)
- Modify: `src/components/estoque/importar-nota/etapa-itens.tsx`
- Test: `src/components/estoque/importar-nota/__tests__/etapa-itens.test.tsx`

**Interfaces:**
- Consumes: T1 (`classificarIcmsEntrada`, `csosnSaidaSugerido`), `useEmpresaFiscal`, `useModulosHabilitados`, `ProdutoEstoqueResumo.tributacaoIcms` (`src/lib/produtos-saldo.ts:92`, já vem da família canônica — **sem query nova**).
- Produces: props `fiscalAtivo?: boolean` e `csosnPadrao?: string | null` em `EtapaItens`; função pura exportada de `etapa-itens.tsx`:
  `avisoCsosnDivergente(item: Pick<ItemNotaLido,'icmsGrupo'|'csosn'|'cstIcms'>, csosnProduto: string | null | undefined, padrao: string | null): string | null` → `null` se a sugestão for `null` ou `csosnProduto` for `null/undefined` ou iguais; senão `"CSOSN do produto (${csosnProduto}) difere do indicado pela nota (${sugerido}) — confira o cadastro fiscal do produto."`.
- Render (só com `fiscalAtivo`): aviso (`StatusPill tone="warning"`) abaixo do selo do item vinculado, lendo `produtos.find(p => p.codigoPai === d.codigoPai)?.tributacaoIcms`. Não bloqueia.

- [ ] **Step 1:** Testes de `avisoCsosnDivergente`: ST + produto `102` → mensagem com `(102)` e `(500)`; ST + produto `500` → null; exceção + produto `102` → null; produto `null` → null. Render: item vinculado com divergência mostra o aviso com `fiscalAtivo` e não mostra sem ele.
- [ ] **Step 2:** `pnpm test -- etapa-itens` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(estoque): aviso de CSOSN divergente ao vincular produto existente`.

### Task 5: ADR, docs e verificação final

**Files:**
- Modify: `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (emenda datada 2026-11-03 sob D-10)
- Modify: `docs/TASKS.md`, `docs/project-status.md` (linha da entrega), `obsidian-vault/` changelog conforme skill `docs-update-checklist`

- [ ] **Step 1:** Emenda D-10: copiar a tabela "Regras" e "Fonte das regras" do spec; registrar que a origem binária passa a vir pré-selecionada no fluxo da nota (exceção ao "nunca pré-escolher" do ADR-0055/0107, com selo + "Conferi" + invalidação) e que exceção fica vazia com escolha obrigatória.
- [ ] **Step 2:** `pnpm preflight:static` → verde.
- [ ] **Step 3:** Commit `docs(adr-0181): emenda D-10 — pré-preenchimento fiscal completo da nota`.
- [ ] **Step 4 (orquestrador):** revisão Codex do diff da branch; validação visual (browser) do cadastro a partir de uma nota de teste; push, CI, merge ff; `supabase functions deploy importar-nota-compra` e conferência da versão.
