# Código da cor nas variações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair o código da cor e o nome literal da cor do campo NOME (ex.: `1354 VERMELHO TOMATE` → "Vermelho Tomate 1354") e embuti-los em `variacoes.cor`, na publicação CREATE.

**Architecture:** Uma função pura `extrairCorECodigo` (parser de tokens, sem dicionário) no `_shared/cor/extrair.ts`, usada como "Camada 0" no `process-familia` antes do dicionário. Quando o NOME tem `{número} {cor}`, usa o nome literal (abreviações expandidas + title-case) + código; senão, mantém o dicionário atual. Sem migração, sem mudança de frontend (a cor já é exibida e enviada ao ML).

**Tech Stack:** Supabase Edge Function Deno/TS (testada via vitest), `pnpm test`. Branch: `feat/codigo-da-cor` (já criada).

**Spec:** `docs/superpowers/specs/2026-06-05-codigo-da-cor-design.md`

**Verificação:** `_shared/cor/extrair.ts` é coberto por `pnpm test`. O `process-familia/index.ts` (Edge) não tem teste unitário — verifica-se por grep do diff + bug bash. Deploy do `process-familia` via MCP e push/merge da branch só no fim, com OK do Diego.

---

### Task 1: Função pura `extrairCorECodigo`

**Files:**
- Modify: `supabase/functions/_shared/cor/extrair.ts`
- Test: `supabase/functions/_shared/cor/__tests__/extrair.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao final de `extrair.test.ts` (o arquivo já importa de `../extrair` e usa describe/it/expect):

```ts
import { extrairCorECodigo } from '../extrair';

describe('extrairCorECodigo', () => {
  it('código + cor literal (perde nada): VERMELHO TOMATE', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT'))
      .toEqual({ cor: 'Vermelho Tomate', codigo: '1354' });
  });
  it('expande abreviações: AZ TIFFANY → Azul Tiffany', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 247 AZ TIFFANY 10MT'))
      .toEqual({ cor: 'Azul Tiffany', codigo: '247' });
  });
  it('expande VD LIMA → Verde Lima', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2036 VD LIMA 10MT'))
      .toEqual({ cor: 'Verde Lima', codigo: '2036' });
  });
  it('expande AMA CL → Amarelo Claro', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2052 AMA CL 10MT'))
      .toEqual({ cor: 'Amarelo Claro', codigo: '2052' });
  });
  it('preserva zero à esquerda no código: 009', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 009 ROSA PETALA 10MT'))
      .toEqual({ cor: 'Rosa Petala', codigo: '009' });
  });
  it('vários dígitos: usa o último seguido de letras (10 BCA → Branco 10)', () => {
    expect(extrairCorECodigo('LINHA P/COST.XIK 120 2000J 10 BCA'))
      .toEqual({ cor: 'Branco', codigo: '10' });
  });
  it('sem dígito antes da cor → null (cai no dicionário)', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.3 PRETO 10MT')).toBeNull();
  });
  it('ignora o tamanho (10MT) e tokens mistos', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1355 MARSALA 10MT'))
      .toEqual({ cor: 'Marsala', codigo: '1355' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- extrair`
Expected: FAIL — `extrairCorECodigo` não existe.

- [ ] **Step 3: Implementar**

Em `supabase/functions/_shared/cor/extrair.ts`, adicione ao final do arquivo:

```ts
// Mapa de abreviações comuns de cor (chave em MAIÚSCULAS) → forma por extenso.
const ABREVIACOES_COR: Record<string, string> = {
  AZ: 'Azul', VD: 'Verde', AMA: 'Amarelo', CL: 'Claro',
  ESC: 'Escuro', BCA: 'Branco', PTO: 'Preto',
};

const SO_LETRAS = /^\p{L}+$/u;
const SO_DIGITOS = /^\d+$/;

function titleCase(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();
}

/**
 * Produtos cujo NOME traz "{código} {cor}" (ex.: "... 1354 VERMELHO TOMATE 10MT"):
 * devolve o código e o nome literal da cor (abreviações expandidas + title-case).
 * Sem esse padrão (nenhum dígito-puro seguido de palavra só-letras) → null (usa o dicionário).
 */
export function extrairCorECodigo(nome: string): { cor: string; codigo: string } | null {
  const tokens = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  // Último dígito-puro seguido de token só-letras (a cor fica perto do fim, antes do tamanho).
  let idx = -1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (SO_DIGITOS.test(tokens[i]) && SO_LETRAS.test(tokens[i + 1])) idx = i;
  }
  if (idx < 0) return null;

  const codigo = tokens[idx];
  const palavras: string[] = [];
  for (let i = idx + 1; i < tokens.length; i++) {
    if (!SO_LETRAS.test(tokens[i])) break; // tamanho (10MT) / token misto encerra a cor
    palavras.push(tokens[i]);
  }
  const cor = palavras
    .map((p) => ABREVIACOES_COR[p.toUpperCase()] ?? titleCase(p))
    .join(' ');
  return { cor, codigo };
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- extrair`
Expected: PASS (todos os casos novos + os antigos de `extrairCorDoTexto`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cor/extrair.ts supabase/functions/_shared/cor/__tests__/extrair.test.ts
git commit -m "feat(m4): extrairCorECodigo (codigo + nome literal da cor com expansao de abreviacoes)"
```

---

### Task 2: Integrar no `process-familia` (Camada 0)

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

Sem teste unitário (Edge). Verificação por grep do diff + `pnpm test` (sem regressão).

- [ ] **Step 1: Importar a função nova**

Troque o import existente:

```ts
import { extrairCorDoTexto } from '../_shared/cor/extrair.ts';
```

por:

```ts
import { extrairCorDoTexto, extrairCorECodigo } from '../_shared/cor/extrair.ts';
```

- [ ] **Step 2: Adicionar a Camada 0 antes do dicionário**

No `pool` de resolução de cor, o trecho atual é:

```ts
      if (v.cor) return v;

      // Camada 1 — dicionário
      const corTexto = extrairCorDoTexto([
        v.nome,
        claimed.nome_pai,
        claimed.descricao_pai,
      ]);
      if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };
```

Troque por (insere a Camada 0):

```ts
      if (v.cor) return v;

      // Camada 0 — código + nome literal da cor quando o NOME tem "{número} {cor}".
      const comCodigo = extrairCorECodigo(v.nome ?? '');
      if (comCodigo) {
        return { ...v, cor: `${comCodigo.cor} ${comCodigo.codigo}`, cor_origem: 'descricao' as OrigemCor };
      }

      // Camada 1 — dicionário
      const corTexto = extrairCorDoTexto([
        v.nome,
        claimed.nome_pai,
        claimed.descricao_pai,
      ]);
      if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };
```

(Os caminhos de cache Redis e Vision, logo abaixo, ficam inalterados.)

- [ ] **Step 3: Verificar diff + suíte**

Run: `git diff supabase/functions/process-familia/index.ts | grep -E "extrairCorECodigo|Camada 0"` (mostra o import e a Camada 0) e `pnpm test` (sem regressão).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m4): process-familia usa extrairCorECodigo (Camada 0) antes do dicionario"
```

---

### Task 3: Documentação — adendo ADR-0004 + CLAUDE.md

**Files:**
- Modify: `docs/decisions/0004-atribuicao-de-cor.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Adendo ao ADR-0004**

Acrescente ao final de `docs/decisions/0004-atribuicao-de-cor.md`:

```markdown

## Adendo (2026-06-05) — Código da cor no NOME

Quando o NOME traz `{número} {cor}` (ex.: `1354 VERMELHO TOMATE`), uma camada anterior ao
dicionário (`extrairCorECodigo`) extrai o **código** e o **nome literal** da cor — abreviações
comuns expandidas (AZ→Azul, VD→Verde, AMA→Amarelo, CL→Claro, ESC→Escuro, BCA→Branco, PTO→Preto)
e title-case — embutindo em `variacoes.cor` como `"{Cor} {código}"` (ex.: `Vermelho Tomate 1354`).
Sem esse padrão, mantém-se o dicionário canônico. Vale no CREATE; falsos positivos
(ex.: `10 BCA` → `Branco 10`) são corrigidos pelo operador na Revisão.
```

- [ ] **Step 2: Linha no histórico do CLAUDE.md**

Na tabela "Histórico deste CLAUDE.md", adicione (após a última linha `| 2026-06-05 |`):

```markdown
| 2026-06-05 | **Código da cor nas variações** (Superpowers completo, branch `feat/codigo-da-cor`). Para produtos cujo NOME traz `{código} {cor}` (ex.: `FITA ... 1354 VERMELHO TOMATE 10MT`), `extrairCorECodigo` (`_shared/cor/extrair.ts`, parser de tokens: último dígito-puro seguido de só-letras = código; palavras só-letras seguintes = cor literal, até o tamanho) extrai código + nome comercial exato, expande abreviações (AZ→Azul, VD→Verde, AMA→Amarelo, CL→Claro, ESC→Escuro, BCA→Branco, PTO→Preto) + title-case, embutindo em `variacoes.cor` como `"Vermelho Tomate 1354"`. Camada 0 no `process-familia` antes do dicionário (sem código → dicionário atual). Exibido na Revisão (editável) e no COLOR do ML; sem coluna nova, sem frontend. Adendo ADR-0004. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0004-atribuicao-de-cor.md CLAUDE.md
git commit -m "docs(m4): adendo ADR-0004 (codigo da cor) + CLAUDE.md"
```

---

### Task 4: Verificação final + deploy + push/merge (com OK do Diego)

**Files:** nenhum

- [ ] **Step 1: Suíte + build**

Run: `pnpm test && pnpm build`
Expected: tudo verde (≈258 testes), `✓ built`.

- [ ] **Step 2: Pedir OK ao Diego**

Não prosseguir sem confirmação para deploy + push/merge.

- [ ] **Step 3: Deploy do `process-familia` via MCP (após OK)**

Redeploy do `process-familia` (mudaram `index.ts` + `_shared/cor/extrair.ts`). Padrão da sessão: `get_edge_function` → `index.ts` = repo com `../_shared/`→`./_shared/`; substituir `_shared/cor/extrair.ts` pelo conteúdo do repo; demais files inalterados; `deploy_edge_function` com `verify_jwt:false`. Confirmar a versão.

- [ ] **Step 4: Push da branch + merge (após OK)**

```bash
git push -u origin feat/codigo-da-cor
```
Merge para `main` conforme o Diego preferir (PR ou merge direto).

- [ ] **Step 5: Bug bash (Diego)**

Subir um lote com produtos codificados (FITA CETIM PROGRESSO) e conferir na Revisão as cores no formato `"Vermelho Tomate 1354"`, `"Azul Tiffany 247"`; publicar e ver o COLOR no anúncio. Conferir um caso de falso positivo (LINHA SETTA `10 BCA` → `Branco 10`) — editável.

---

## Self-Review

**Spec coverage:**
- §1 Extração `extrairCorECodigo` (parser + abreviações + title-case) → Task 1 ✓
- §2 Integração Camada 0 no process-familia → Task 2 ✓
- §3 Exibição/ML sem mudança → coberto (nada a fazer) ✓
- §Testes (tabela de exemplos) → Task 1 (8 casos) ✓
- §Docs (ADR-0004 + CLAUDE.md) → Task 3 ✓
- Deploy/push com OK → Task 4 ✓

**Type consistency:** `extrairCorECodigo(nome) → { cor: string; codigo: string } | null` (Tasks 1, 2); import em process-familia casa com o export (Task 2). Consistente.

**Placeholders:** nenhum — código e comandos concretos em todos os steps.
