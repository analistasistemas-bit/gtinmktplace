# Fiscal: UF em dropdown, CEP automático e campos por regime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na seção Configurações → Fiscal: (1) UF de "Venda dentro do estado" vira dropdown com as 27 UFs; (2/4) no Simples Nacional, "Operação fiscal" pede só o Papel da empresa — Natureza, CFOPs e CST PIS/COFINS ficam opcionais num bloco recolhido e deixam de bloquear a ativação do módulo; (3) CEP consulta o ViaCEP e preenche logradouro, bairro, município, UF e código IBGE.

**Architecture:** Mudança só de frontend (`secao-fiscal.tsx` + helper `src/lib/cep.ts`) e da validação pura de ativação (`supabase/functions/_shared/fiscal/ativacao.ts`, consumida só pela edge `usuarios`). Sem migration: as colunas de `empresa_fiscal` já são nullable e o banco não tem constraint de completude. Os demais leitores de `empresa_fiscal` (`gate.ts`, `cadastrar-produto`, `atualizar-fiscal-familia`, `sincronizar-fiscal-ml`) só leem `regime_tributario`/`origin_type` — não são afetados.

**Tech Stack:** React 18.3 + TS, shadcn/Radix Select, TanStack Query, vitest + Testing Library, Deno edge functions (Supabase), ViaCEP (`https://viacep.com.br/ws/{cep}/json/`, grátis, sem chave, CORS liberado).

**Spec:** desenho aprovado em chat em 2026-10-15 (caminho bounded, sem spec file). Resumo fiel:
- Item 1: dropdown com 27 UFs + "Nenhuma" (= em branco). Regra ADR-0112 mantida: UF e % andam juntos.
- Itens 2/4: decisão do Diego = **"Opcionais, recolhidos"**. Simples pede só Papel da empresa; os 6 campos de portabilidade (`natureza_operacao`, `cfop_dentro_uf`, `cfop_fora_uf_nao_contribuinte`, `cfop_fora_uf_contribuinte`, `cst_pis`, `cst_cofins`) vão para um bloco recolhido "Para trocar de emissor (opcional)"; o servidor deixa de exigir 5 deles (`cfop_fora_uf_contribuinte` já era opcional). Regime Normal: aviso "ainda não emite pelo PubliAI (v2)", sem campos novos (Normal já é recusado na ativação). Contadores dos subgrupos espelham a lista do servidor.
- Item 3: blur do CEP com 8 dígitos → ViaCEP → grava logradouro, bairro, município, UF, IBGE. Número/complemento manuais. Erro → mensagem no campo, edição manual segue possível.
- Base factual: da empresa, só `origin_type` entra no payload do ML (`_shared/canais/fiscal-ml.ts:45`); `regime_tributario` é lido pelo worker (`sincronizar-fiscal-ml/processar.ts:51`) para decidir CSOSN×CST, mas não é enviado. Natureza/CFOP/CST PIS-COFINS nunca saem do PubliAI; no Simples o ML dispensa regras tributárias (doc oficial `envio-regras-tributarias`). O ADR-0135 D-3 guarda os campos de operação só por portabilidade.

## Global Constraints

- Sem dependência nova (nada em `package.json`).
- Toda copy em pt-BR com acentuação correta.
- Radix `SelectItem` não aceita `value=""` — usar sentinela `'__nenhuma__'` para "Nenhuma".
- Comentários no estilo do arquivo: explicam o *porquê*, citando ADR quando houver.
- Front e Deno não compartilham módulo: a lista de obrigatórios existe nos dois lados (`secao-fiscal.tsx` e `ativacao.ts`) e precisa ficar idêntica (comentário de sincronia nos dois).
- Testes: `pnpm vitest run <arquivo>`; portão final `pnpm preflight:static` (não remontar checklist à mão).
- Git em worktree: `/usr/bin/git` simples, um comando por chamada, `git commit -F <arquivo absoluto>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Edge `usuarios` tem `verify_jwt = true` no `supabase/config.toml` — deploy SEM `--no-verify-jwt`.

## Review Focus

1. **CEP "geral" de cidade** (ViaCEP devolve `logradouro`/`bairro` vazios): não apagar o que o usuário digitou — campos vazios da resposta são ignorados. Teste na Task 4.
2. **CEP digitado com máscara** (`51021-530`, espaços): normalizar para 8 dígitos antes de validar/gravar/consultar. Teste na Task 4.
3. **ViaCEP fora do ar / timeout**: o CEP em si continua salvo e aparece mensagem pedindo preenchimento manual; nada trava. Teste na Task 4 (rejeição) e timeout de 5 s no helper (Task 2).
4. **"Nenhuma" com percentual preenchido**: escolher "Nenhuma" limpa UF **e** % juntos (grava `null/null`), em vez de cair no erro de meia-configuração. Teste na Task 3.
5. **Duas consultas de CEP em sequência (A depois B) com respostas fora de ordem**: só a resposta da última consulta é aplicada; a atrasada é descartada. Teste na Task 4. Teto conhecido: edição manual de logradouro/bairro durante os ≤5 s de espera da consulta vigente pode ser sobrescrita — aceitável, o usuário vê o valor e corrige.
6. **Falha ao gravar o CEP no banco**: o erro da fila aparece no campo (não é mascarado pelo erro local do CEP). Teste na Task 4.
7. **Org que já preencheu os campos de portabilidade**: valores continuam visíveis e editáveis dentro do bloco recolhido; nada é apagado. Teste na Task 5.

---

### Task 1: Servidor — campos de portabilidade deixam de bloquear a ativação

**Model:** sonnet

**Files:**
- Modify: `supabase/functions/_shared/fiscal/ativacao.ts:16-27`
- Test: `supabase/functions/_shared/fiscal/__tests__/ativacao.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `pendenciasAtivacaoFiscal(org, empresa, ufConfiguracoes): string[]` — assinatura inalterada; só a lista `OBRIGATORIOS` encolhe.

- [ ] **Step 1: Ajustar o teste existente e escrever o novo (RED)**

Em `ativacao.test.ts`, o caso `'campos vazios são listados TODOS de uma vez, nomeados'` usa `cst_pis: null` e espera `/PIS/`. Trocar `cst_pis` por `bairro` e a asserção `/PIS/` por `/bairro/`. Acrescentar dentro do `describe`:

```ts
  it('campos de portabilidade (natureza, CFOPs, CST PIS/COFINS) são opcionais — emenda 2026-10-15', () => {
    const semPortabilidade = {
      ...completa,
      natureza_operacao: null, cfop_dentro_uf: null, cfop_fora_uf_nao_contribuinte: null,
      cfop_fora_uf_contribuinte: null, cst_pis: null, cst_cofins: null,
    };
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, semPortabilidade, 'PE')).toEqual([]);
  });
  it('origin_type continua obrigatório (é o que vai ao ML)', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, origin_type: null }, 'PE')
      .join(' ')).toMatch(/origin_type/);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run supabase/functions/_shared/fiscal/__tests__/ativacao.test.ts`
Expected: FAIL em "campos de portabilidade … são opcionais" (recebe 5 pendências em vez de `[]`).

- [ ] **Step 3: Implementar**

Substituir o comentário e a constante `OBRIGATORIOS` em `ativacao.ts` por:

```ts
// cfop_fora_uf_contribuinte, nome_fantasia e complemento são OPCIONAIS (spec §2.2).
// Emenda 2026-10-15 (ADR-0135 D-3/D-7): natureza_operacao, CFOPs e CST de PIS/COFINS também
// saem da lista — o Faturador do ML não os recebe (da empresa, só origin_type vai no payload); ficam
// guardados como portabilidade para troca de emissor. Espelho: OBRIGATORIOS em
// src/components/configuracoes/secao-fiscal.tsx — manter os dois iguais.
const OBRIGATORIOS: Array<[keyof EmpresaFiscalRow, string]> = [
  ['cnpj', 'CNPJ'], ['razao_social', 'razão social'],
  ['inscricao_estadual', 'inscrição estadual'], ['regime_tributario', 'regime tributário'],
  ['cep', 'CEP'], ['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'],
  ['municipio', 'município'], ['municipio_ibge', 'código IBGE do município'], ['uf', 'UF'],
  ['origin_type', 'papel da empresa (origin_type)'],
  ['emissao_a_partir_de', 'data de início da emissão (emissao_a_partir_de)'],
];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run supabase/functions/_shared/fiscal/__tests__/ativacao.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add supabase/functions/_shared/fiscal/ativacao.ts supabase/functions/_shared/fiscal/__tests__/ativacao.test.ts
/usr/bin/git commit -F <arquivo com: "feat(fiscal): campos de portabilidade não bloqueiam a ativação do módulo (emenda ADR-0135)">
```

---

### Task 2: Helper `buscarCep` + lista de UFs

**Model:** sonnet

**Files:**
- Create: `src/lib/cep.ts`
- Create: `src/lib/__tests__/cep.test.ts`
- Modify: `src/lib/fiscal.ts` (acrescentar `UFS` no fim)

**Interfaces:**
- Produces:
  - `export interface EnderecoCep { logradouro: string; bairro: string; municipio: string; uf: string; municipio_ibge: string }`
  - `export async function buscarCep(cep8: string, f: typeof fetch = fetch): Promise<EnderecoCep | null>` — recebe 8 dígitos já normalizados; `null` = CEP inexistente (`{"erro": true}` ou HTTP 400); lança em falha de rede/timeout/HTTP 5xx.
  - `export const UFS: readonly string[]` em `src/lib/fiscal.ts` — 27 siglas em ordem alfabética.

- [ ] **Step 1: Teste (RED)** — `src/lib/__tests__/cep.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buscarCep } from '../cep';
import { UFS } from '../fiscal';

const resposta = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buscarCep (ViaCEP)', () => {
  it('mapeia a resposta para os campos de empresa_fiscal', async () => {
    const f = resposta({
      cep: '51021-530', logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      localidade: 'Recife', uf: 'PE', ibge: '2611606',
    });
    expect(await buscarCep('51021530', f)).toEqual({
      logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606',
    });
    expect(f).toHaveBeenCalledWith('https://viacep.com.br/ws/51021530/json/', expect.anything());
  });
  it('CEP inexistente ({erro:true}) devolve null', async () => {
    expect(await buscarCep('99999999', resposta({ erro: true }))).toBeNull();
  });
  it('HTTP 400 devolve null; 5xx lança', async () => {
    expect(await buscarCep('00000000', resposta({}, 400))).toBeNull();
    await expect(buscarCep('51021530', resposta({}, 503))).rejects.toThrow();
  });
  it('CEP geral de cidade: logradouro/bairro vazios chegam como string vazia', async () => {
    const r = await buscarCep('55000000', resposta({ logradouro: '', bairro: '', localidade: 'Caruaru', uf: 'PE', ibge: '2604106' }));
    expect(r).toEqual({ logradouro: '', bairro: '', municipio: 'Caruaru', uf: 'PE', municipio_ibge: '2604106' });
  });
});

describe('UFS', () => {
  it('tem as 27 unidades federativas, sem repetição', () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    expect(UFS).toContain('PE');
    expect(UFS).toContain('DF');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/__tests__/cep.test.ts`
Expected: FAIL — módulo `../cep` não existe.

- [ ] **Step 3: Implementar** — `src/lib/cep.ts`:

```ts
// Consulta de CEP para o cadastro fiscal (emenda ADR-0135, 2026-10-15). ViaCEP: grátis, sem
// chave, CORS aberto — chamado direto do navegador. Falha aqui nunca bloqueia: quem chama
// mostra o erro e o endereço continua editável à mão.

export interface EnderecoCep {
  logradouro: string; bairro: string; municipio: string; uf: string; municipio_ibge: string;
}

/** `cep8` já normalizado (8 dígitos). `null` = CEP inexistente; lança em falha de rede/5xx. */
export async function buscarCep(cep8: string, f: typeof fetch = fetch): Promise<EnderecoCep | null> {
  const r = await f(`https://viacep.com.br/ws/${cep8}/json/`, { signal: AbortSignal.timeout(5000) });
  if (r.status === 400) return null;
  if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  if (d.erro) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    logradouro: s(d.logradouro), bairro: s(d.bairro), municipio: s(d.localidade),
    uf: s(d.uf), municipio_ibge: s(d.ibge),
  };
}
```

Acrescentar ao fim de `src/lib/fiscal.ts`:

```ts
export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/__tests__/cep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(fiscal): helper buscarCep (ViaCEP) e lista de UFs`, arquivos `src/lib/cep.ts src/lib/__tests__/cep.test.ts src/lib/fiscal.ts`.

---

### Task 3: UF de "Venda dentro do estado" em dropdown

**Model:** sonnet

**Files:**
- Modify: `src/components/configuracoes/secao-fiscal.tsx` (bloco `SettingsRow titulo="Venda dentro do estado"`, ~linhas 298-327, e `salvarInterna` ~143-160)
- Create: `src/components/configuracoes/__tests__/secao-fiscal.test.tsx`

**Interfaces:**
- Consumes: `UFS` de `@/lib/fiscal` (Task 2).
- Produces: o arquivo de teste com o harness (mocks) que as Tasks 4 e 5 estendem — `renderSecao({ aliquotas?, empresa? })`, `salvarAliquotas`, `salvarEmpresa` (mocks `mutateAsync`).

- [ ] **Step 1: Teste (RED)** — criar `src/components/configuracoes/__tests__/secao-fiscal.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { salvarAliquotas, salvarEmpresa, buscarCep, estado } = vi.hoisted(() => ({
  salvarAliquotas: vi.fn(async (_s: Record<string, unknown>) => undefined),
  // Aplica o patch no estado, como o refetch do invalidateQueries faria — o teste re-renderiza
  // e confere os inputs, não só as chamadas.
  salvarEmpresa: vi.fn(async (p: Record<string, unknown>) => {
    estado.empresa = { ...(estado.empresa as object | null), ...p };
  }),
  buscarCep: vi.fn(),
  estado: { aliquotas: null as unknown, empresa: null as Record<string, unknown> | null },
}));

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: estado.aliquotas, isLoading: false }),
  useSalvarAliquotas: () => ({ mutateAsync: salvarAliquotas, isSuccess: false }),
  useEmpresaFiscal: () => ({ data: estado.empresa, isLoading: false }),
  useSalvarEmpresaFiscal: () => ({ mutateAsync: salvarEmpresa, isSuccess: false }),
}));
vi.mock('@/components/configuracoes/permissoes', () => ({
  usePermissoesConfig: () => ({ podeEditarConfig: true, podeEditarEmpresa: true }),
}));
vi.mock('@/lib/cep', () => ({ buscarCep }));

import { SecaoFiscal } from '../secao-fiscal';

// Radix Select usa pointer capture e scrollIntoView, que o jsdom não implementa.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ALIQ = { nacional: 8, importado: 16, ufEmpresa: null, internaPct: null, confirmada: true };

function renderSecao(o: { aliquotas?: object; empresa?: Record<string, unknown> | null } = {}) {
  estado.aliquotas = { ...ALIQ, ...o.aliquotas };
  estado.empresa = o.empresa === undefined ? null : { ...o.empresa };
  return render(<SecaoFiscal />);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Venda dentro do estado — dropdown de UF', () => {
  it('lista as 27 UFs + Nenhuma e grava UF+% juntos', async () => {
    const user = userEvent.setup();
    renderSecao({ aliquotas: { internaPct: 4 } });
    await user.click(screen.getByRole('combobox', { name: 'UF da venda dentro do estado' }));
    expect(await screen.findAllByRole('option')).toHaveLength(28);
    await user.click(screen.getByRole('option', { name: 'PE' }));
    await waitFor(() => expect(salvarAliquotas).toHaveBeenCalledWith(
      expect.objectContaining({ ufEmpresa: 'PE', internaPct: 4 })));
  });
  it('"Nenhuma" limpa UF e % juntos (não cai na meia-configuração)', async () => {
    const user = userEvent.setup();
    renderSecao({ aliquotas: { ufEmpresa: 'PE', internaPct: 4 } });
    await user.click(screen.getByRole('combobox', { name: 'UF da venda dentro do estado' }));
    await user.click(await screen.findByRole('option', { name: 'Nenhuma' }));
    await waitFor(() => expect(salvarAliquotas).toHaveBeenCalledWith(
      expect.objectContaining({ ufEmpresa: null, internaPct: null })));
    expect(screen.getByLabelText('Alíquota dentro do estado')).toHaveValue(null);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/configuracoes/__tests__/secao-fiscal.test.tsx`
Expected: FAIL — não existe combobox "UF da venda dentro do estado" (hoje é `<Input>`).

- [ ] **Step 3: Implementar**

Em `secao-fiscal.tsx`, importar `UFS`: `import { UFS, validarCnpj } from '@/lib/fiscal';`. Adicionar constante no topo do módulo (perto de `OBRIGATORIOS`):

```ts
// Radix Select não aceita value="" — sentinela para "sem alíquota interna" (ADR-0112).
const UF_NENHUMA = '__nenhuma__';
```

Substituir o `<Input>` de UF (o que tem `value={ufEmpresaInput}` dentro do `SettingsRow` "Venda dentro do estado") por:

```tsx
                <Select
                  value={ufEmpresaInput === '' ? UF_NENHUMA : ufEmpresaInput}
                  disabled={!podeEditarConfig}
                  onValueChange={(v) => {
                    // "Nenhuma" desliga a regra inteira: limpa UF e % juntos, senão o
                    // percentual órfão cairia na trava de meia-configuração.
                    if (v === UF_NENHUMA) {
                      setUfEmpresaInput(''); setInternaInput('');
                      salvarInterna('', '');
                      return;
                    }
                    setUfEmpresaInput(v);
                    salvarInterna(v, internaInput);
                  }}
                >
                  <SelectTrigger aria-label="UF da venda dentro do estado" className="h-8 w-24 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UF_NENHUMA}>Nenhuma</SelectItem>
                    {UFS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                  </SelectContent>
                </Select>
```

Em `salvarInterna`, o ramo `u === '' && p === null` hoje só faz `setErroInterna(null)` e segue para gravar — confirmar que continua gravando `{ ufEmpresa: null, internaPct: null }` (não adicionar `return`). O teste de regex `/^[A-Z]{2}$/` permanece (defesa em profundidade).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/components/configuracoes/__tests__/secao-fiscal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(fiscal): UF da venda dentro do estado em dropdown com as 27 UFs`.

---

### Task 4: CEP preenche o endereço

**Model:** sonnet

**Files:**
- Modify: `src/components/configuracoes/secao-fiscal.tsx` (estado `erroCep`, função `salvarCep`, linha `{campo('cep', 'CEP')}`)
- Test: `src/components/configuracoes/__tests__/secao-fiscal.test.tsx` (acrescentar `describe`)

**Interfaces:**
- Consumes: `buscarCep(cep8)` de `@/lib/cep` (Task 2); harness `renderSecao`, `salvarEmpresa`, `buscarCep` mock (Task 3).

- [ ] **Step 1: Teste (RED)** — acrescentar ao arquivo de teste:

```tsx
const EMPRESA_BASE = { cnpj: '69541033000145', regime_tributario: 'simples' };
const gravados = (): Record<string, unknown>[] => salvarEmpresa.mock.calls.map((c) => c[0]);

describe('CEP preenche o endereço (ViaCEP)', () => {
  it('normaliza a máscara, grava o CEP e os 5 campos retornados', async () => {
    buscarCep.mockResolvedValue({
      logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606',
    });
    const user = userEvent.setup();
    const { rerender } = renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021-530');
    await user.tab();
    await waitFor(() => expect(gravados()).toEqual(expect.arrayContaining([
      { cep: '51021530' }, { logradouro: 'Rua Padre Luiz Marques Teixeira' }, { bairro: 'Boa Viagem' },
      { municipio: 'Recife' }, { uf: 'PE' }, { municipio_ibge: '2611606' },
    ])));
    expect(buscarCep).toHaveBeenCalledWith('51021530');
    rerender(<SecaoFiscal />); // equivale ao refetch pós-invalidateQueries
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Padre Luiz Marques Teixeira');
    expect(screen.getByLabelText('Bairro')).toHaveValue('Boa Viagem');
    expect(screen.getByLabelText('Município')).toHaveValue('Recife');
    expect(screen.getByLabelText('UF')).toHaveValue('PE');
    expect(screen.getByLabelText('Código IBGE do município')).toHaveValue('2611606');
  });
  it('CEP geral (logradouro/bairro vazios) não apaga o que já foi digitado', async () => {
    buscarCep.mockResolvedValue({ logradouro: '', bairro: '', municipio: 'Caruaru', uf: 'PE', municipio_ibge: '2604106' });
    const user = userEvent.setup();
    renderSecao({ empresa: { ...EMPRESA_BASE, logradouro: 'Rua X', bairro: 'Centro' } });
    await user.type(screen.getByLabelText('CEP'), '55000000');
    await user.tab();
    await waitFor(() => expect(gravados()).toContainEqual({ municipio_ibge: '2604106' }));
    expect(gravados().some((p) => 'logradouro' in p || 'bairro' in p)).toBe(false);
  });
  it('CEP com menos de 8 dígitos: erro no campo, sem consulta', async () => {
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '5102');
    await user.tab();
    expect(await screen.findByText('CEP inválido (8 dígitos).')).toBeInTheDocument();
    expect(buscarCep).not.toHaveBeenCalled();
  });
  it('CEP inexistente: CEP salvo + aviso para preencher à mão', async () => {
    buscarCep.mockResolvedValue(null);
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '99999999');
    await user.tab();
    expect(await screen.findByText(/CEP não encontrado/)).toBeInTheDocument();
    expect(gravados()).toContainEqual({ cep: '99999999' });
  });
  it('ViaCEP fora do ar: aviso e endereço segue editável', async () => {
    buscarCep.mockRejectedValue(new Error('rede'));
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021530');
    await user.tab();
    expect(await screen.findByText(/Não foi possível consultar o CEP/)).toBeInTheDocument();
    expect(screen.getByLabelText('Logradouro')).toBeEnabled();
  });
  it('consultas fora de ordem: só a resposta do último CEP é aplicada', async () => {
    let resolverA!: (v: unknown) => void;
    buscarCep
      .mockImplementationOnce(() => new Promise((r) => { resolverA = r; }))
      .mockResolvedValueOnce({ logradouro: 'Rua B', bairro: 'Bairro B', municipio: 'Olinda', uf: 'PE', municipio_ibge: '2609600' });
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    const cep = screen.getByLabelText('CEP');
    await user.type(cep, '11111111');
    await user.tab();
    await user.clear(cep);
    await user.type(cep, '22222222');
    await user.tab();
    await waitFor(() => expect(gravados()).toContainEqual({ municipio: 'Olinda' }));
    resolverA({ logradouro: 'Rua A', bairro: 'Bairro A', municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606' });
    await new Promise((r) => setTimeout(r, 0));
    expect(gravados()).not.toContainEqual({ municipio: 'Recife' });
  });
  it('falha ao gravar o CEP aparece no campo', async () => {
    buscarCep.mockResolvedValue(null);
    salvarEmpresa.mockRejectedValueOnce(new Error('falha de rede ao salvar'));
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021530');
    await user.tab();
    expect(await screen.findByText(/falha de rede ao salvar/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/configuracoes/__tests__/secao-fiscal.test.tsx`
Expected: FAIL — `buscarCep` nunca é chamado; CEP gravado com máscara.

- [ ] **Step 3: Implementar**

Import: `import { buscarCep } from '@/lib/cep';` e acrescentar `useRef` ao import de `react`. Junto dos outros `useState` de erro (`erroCnpj`, `erroIbge`, `erroUf`): `const [erroCep, setErroCep] = useState<string | null>(null);` e `const consultaCep = useRef(0);`. Depois de `salvarUf`:

```tsx
  // CEP → ViaCEP preenche o resto do endereço (emenda ADR-0135, 2026-10-15). Campo vazio na
  // resposta (CEP geral de cidade) não sobrescreve o que o usuário já digitou. Falha na consulta
  // não bloqueia: o CEP fica salvo e o endereço segue editável à mão.
  // Cada blur invalida a consulta anterior: resposta que chega depois de um CEP mais novo é
  // descartada (A→B terminando B→A gravaria o endereço de A).
  const salvarCep = async (v: string) => {
    const n = ++consultaCep.current;
    const d = v.replace(/\D/g, '');
    if (d === '') { setErroCep(null); gravarEmpresa('cep', null); return; }
    if (d.length !== 8) { setErroCep('CEP inválido (8 dígitos).'); return; }
    setErroCep(null);
    gravarEmpresa('cep', d);
    let endereco;
    try {
      endereco = await buscarCep(d);
    } catch {
      if (n === consultaCep.current) setErroCep('Não foi possível consultar o CEP agora — preencha o endereço à mão.');
      return;
    }
    if (n !== consultaCep.current) return;
    if (!endereco) { setErroCep('CEP não encontrado — confira ou preencha o endereço à mão.'); return; }
    for (const [c, valor] of Object.entries(endereco)) if (valor) gravarEmpresa(c, valor);
  };
```

Trocar `{campo('cep', 'CEP')}` por:

```tsx
              {campo('cep', 'CEP', {
                placeholder: '00000-000',
                // falha de gravação da fila vem primeiro: o aviso local (formato/ViaCEP) não pode escondê-la
                erro: filaEmpresa.erros.cep ?? erroCep ?? null,
                onSalvar: (v) => void salvarCep(v),
              })}
```

Nota: `gravarEmpresa` enfileira na mesma fila (`useFilaDeSalvamento`), uma gravação por campo, em série — cada campo mostra seu próprio "✓ Salvo". O `invalidateQueries` do `useSalvarEmpresaFiscal` recarrega `empresa`, e o `useEffect` do `CampoEmpresa` sincroniza os inputs.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/components/configuracoes/__tests__/secao-fiscal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(fiscal): CEP consulta o ViaCEP e preenche endereço, UF e IBGE`.

---

### Task 5: Operação fiscal conforme o regime + contadores espelhando o servidor

**Model:** sonnet

**Files:**
- Modify: `src/components/configuracoes/secao-fiscal.tsx` (`OBRIGATORIOS` ~14-23; `Subgrupo titulo="Operação fiscal"` ~386-413)
- Test: `src/components/configuracoes/__tests__/secao-fiscal.test.tsx` (acrescentar `describe`)

**Interfaces:**
- Consumes: harness da Task 3; lista do servidor da Task 1 (tem que bater 1:1).

- [ ] **Step 1: Teste (RED)**:

```tsx
describe('Operação fiscal conforme o regime', () => {
  it('Simples: só Papel da empresa à vista; portabilidade num bloco recolhido', () => {
    renderSecao({ empresa: { ...EMPRESA_BASE, natureza_operacao: 'Venda de mercadoria' } });
    expect(screen.getByRole('combobox', { name: 'Papel da empresa' })).toBeInTheDocument();
    const bloco = screen.getByText('Para trocar de emissor (opcional)').closest('details')!;
    expect(bloco).not.toHaveAttribute('open');
    expect(within(bloco).getByLabelText('Natureza da operação')).toHaveValue('Venda de mercadoria');
    expect(within(bloco).getByLabelText('CST de COFINS')).toBeInTheDocument();
    expect(screen.queryByText(/Regime Normal ainda não emite/)).not.toBeInTheDocument();
  });
  it('Regime Normal: aviso de v2', () => {
    renderSecao({ empresa: { ...EMPRESA_BASE, regime_tributario: 'normal' } });
    expect(screen.getByText(/Regime Normal ainda não emite pelo PubliAI/)).toBeInTheDocument();
  });
  it('contadores seguem a lista do servidor (complemento, nome fantasia e portabilidade não contam)', () => {
    renderSecao({ empresa: {
      cnpj: '69541033000145', razao_social: 'X LTDA', inscricao_estadual: '1', regime_tributario: 'simples',
      cep: '51021530', logradouro: 'Rua', numero: '1', bairro: 'B', municipio: 'Recife', municipio_ibge: '2611606', uf: 'PE',
    } });
    expect(screen.getAllByText('✓ completo')).toHaveLength(2); // Identidade + Endereço
    expect(screen.getAllByText('0 de 1')).toHaveLength(2);     // Operação (origin_type) + Emissão
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/configuracoes/__tests__/secao-fiscal.test.tsx`
Expected: FAIL — não há `details`; contadores contam complemento/nome fantasia.

- [ ] **Step 3: Implementar**

Substituir comentário + `OBRIGATORIOS` no topo de `secao-fiscal.tsx`:

```ts
// Obrigatórios por subgrupo — espelho exato de OBRIGATORIOS em
// supabase/functions/_shared/fiscal/ativacao.ts (front e Deno não compartilham módulo; manter
// os dois iguais). Emenda 2026-10-15 (ADR-0135 D-3/D-7): natureza, CFOPs e CST de PIS/COFINS
// são portabilidade — o Faturador do ML não os recebe — e não contam; nome fantasia e
// complemento já eram opcionais no servidor.
const OBRIGATORIOS = {
  identidade: ['cnpj', 'razao_social', 'inscricao_estadual', 'regime_tributario'],
  endereco: ['cep', 'logradouro', 'numero', 'bairro', 'municipio', 'municipio_ibge', 'uf'],
  operacao: ['origin_type'],
  emissao: ['emissao_a_partir_de'],
} as const;
```

No `Subgrupo titulo="Operação fiscal"`: deixar como filhos diretos o bloco do Select "Papel da empresa" (inalterado) e, antes dele, o aviso de Normal; depois dele, o `<details>`. Os seis `campo(...)` de portabilidade saem do grid principal e vão para dentro do `<details>`:

```tsx
            <Subgrupo titulo="Operação fiscal" campos={OBRIGATORIOS.operacao} empresa={empresa as Empresa}>
              {empresa?.regime_tributario === 'normal' && (
                <p className="text-xs text-warning sm:col-span-2">
                  Regime Normal ainda não emite pelo PubliAI (v2) — o módulo fiscal só liga no
                  Simples Nacional (ADR-0135 D-6).
                </p>
              )}
              {/* bloco "Papel da empresa" (Select origin_type) — inalterado */}
              <details className="sm:col-span-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Para trocar de emissor (opcional)
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  O Faturador do Mercado Livre não usa estes dados. Ficam guardados para uma futura
                  troca de emissor.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {campo('natureza_operacao', 'Natureza da operação')}
                  {campo('cfop_dentro_uf', 'CFOP dentro da UF')}
                  {campo('cfop_fora_uf_nao_contribuinte', 'CFOP fora da UF (não contribuinte)')}
                  {campo('cfop_fora_uf_contribuinte', 'CFOP fora da UF (contribuinte)')}
                  {campo('cst_pis', 'CST de PIS')}
                  {campo('cst_cofins', 'CST de COFINS')}
                </div>
              </details>
            </Subgrupo>
```

Verificar que `empresaVazia` (usa `Object.values(OBRIGATORIOS)`) continua correto — continua: "nenhum obrigatório preenchido".

- [ ] **Step 4: Rodar e ver passar + suíte do diretório**

Run: `pnpm vitest run src/components/configuracoes`
Expected: PASS (inclusive testes já existentes da pasta).

- [ ] **Step 5: Commit** — `feat(fiscal): operação fiscal pede só o papel da empresa; portabilidade recolhida e opcional`.

---

### Task 6: Documentação + portão final

**Model:** sonnet

**Files:**
- Modify: `docs/decisions/0135-cadastro-fiscal-e-faturador-do-ml.md` (seção nova no fim, antes de "A verificar antes de codar" ou após "Consequências")
- Modify: `docs/TASKS.md` (entrada da entrega)
- Seguir a skill `docs-update-checklist` para os demais arquivos de `docs/` e `obsidian-vault/` afetados.

- [ ] **Step 1: Emenda no ADR-0135** — acrescentar:

```markdown
## Emenda — 2026-10-15: portabilidade opcional, CEP automático

- **D-3 / D-7.3:** `natureza_operacao`, `cfop_dentro_uf`, `cfop_fora_uf_nao_contribuinte`,
  `cst_pis` e `cst_cofins` deixam de ser exigidos para ligar o módulo. Motivo medido no código: da
  empresa, só `origin_type` entra no payload do ML (`_shared/canais/fiscal-ml.ts`); `regime_tributario`
  só é lido localmente (`sincronizar-fiscal-ml`) para CSOSN×CST. No Simples o ML dispensa regras
  tributárias (doc oficial `envio-regras-tributarias`). As colunas
  ficam (portabilidade para troca de emissor) e aparecem na tela num bloco recolhido opcional.
  "`empresa_fiscal` completa" passa a ser: CNPJ válido, razão social, IE, regime, endereço
  (CEP, logradouro, número, bairro, município, IBGE, UF), `origin_type` e `emissao_a_partir_de`.
- **Regime Normal** segue recusado na ativação (D-6); a tela só avisa — os campos de `tax_rules`
  nascem com a V2.
- **CEP:** a tela consulta o ViaCEP (navegador, sem chave) e preenche logradouro, bairro,
  município, UF e código IBGE. Falha na consulta não bloqueia — endereço segue editável.
- Decisão do Diego em 2026-10-15 (opção "opcionais, recolhidos").
```

- [ ] **Step 2: `docs/TASKS.md`** — entrada curta no padrão do arquivo, citando a emenda e a edge `usuarios` a redeployar.

- [ ] **Step 3: Portão**

Run: `pnpm preflight:static`
Expected: exit 0.

- [ ] **Step 4: Commit** — `docs(adr-0135): emenda — portabilidade opcional e CEP automático`.

---

### Pós-tasks (orquestrador, não subagente)

1. Revisão do diff da branch pelo Grok 4.7 xhigh (`cursor-agent -p --mode ask --model grok-4.7-xhigh … < /dev/null`), rodada única.
2. Validação visual no app real (skill `playwright-cli`, sessão isolada): dropdown de UF, CEP `51021530` preenchendo, bloco recolhido, contadores.
3. Merge só quando o Diego pedir: CI verde → fast-forward na `main`.
4. **Deploy obrigatório pós-merge:** `supabase functions deploy usuarios --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`), conferir versão nova e `verify_jwt=true` via `supabase functions list`.
