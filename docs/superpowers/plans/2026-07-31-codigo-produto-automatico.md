# Código de produto automático no cadastro manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No cadastro manual de produto, o sistema passa a gerar o código do PAI e os SKUs das variações — sequência única e crescente por organização, oito dígitos com zeros à esquerda — para que quem não tem ERP não precise inventar código.

**Architecture:** Uma sequência por org em `organizations.produto_seq`, reservada por RPC `SECURITY DEFINER` atômica (espelha `lote_seq`/`proximo_numero_lote`). A edge `cadastrar-produto` reserva a faixa inteira antes dos inserts, deriva PAI + SKUs por uma função pura, confere contra as duas tabelas e ressincroniza se colidir. Um uuid de submissão torna o cadastro idempotente, porque o guard de duplicata deixa de proteger contra retry quando o código é gerado.

**Tech Stack:** Postgres/Supabase (migration + plpgsql), Deno (edge functions), React + TypeScript (front), vitest.

**Spec:** `docs/superpowers/specs/2026-07-31-codigo-produto-automatico-design.md` — leia antes de começar. As decisões são referenciadas abaixo como D-1..D-10.

## Global Constraints

- **Oito dígitos com zeros à esquerda é contrato, não formatação.** `_shared/upload/match.ts:11` só casa `^(\d{8})\.(jpe?g|png)$`. Nunca truncar, nunca passar a nove dígitos (D-1, D-5).
- **Nunca editar a main.** Todo o trabalho sai na branch do worktree atual.
- **Migrations só por `supabase migration new` + `supabase db push`**, validadas com `npm run db:check`. Nunca `apply_migration` nem painel (ADR-0043).
- **RPC nova segue o padrão de permissão do repo:** `revoke execute … from public, anon, authenticated` **e** `grant execute … to service_role`. Sem o grant a RPC fica inexecutável também pelas edges (ADR-0094 D-15).
- **Edge Functions idempotentes** — regra inegociável do CLAUDE.md. É a razão de existir a Task 4.
- **Nunca rebaixar modelo** em migrations e código financeiro (este plano toca os dois).
- Comandos: `pnpm test`, `pnpm lint`, `pnpm check:functions`, `pnpm lint:functions`, `npm run db:check`.

---

### Task 1: Função pura de derivação dos códigos

A única lógica com ramos deste trabalho, e a única testável por vitest — as edges rodam em Deno e não têm teste de integração no projeto. Fica isolada de propósito.

**Files:**
- Create: `supabase/functions/_shared/produto/codigos.ts`
- Test: `supabase/functions/_shared/__tests__/codigos.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `derivarCodigos(ultimo: number, qtd: number): { codigoPai: string; codigos: string[] }` e a constante `CODIGO_MAX = 99_999_999`. A Task 3 chama as duas.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/functions/_shared/__tests__/codigos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CODIGO_MAX, derivarCodigos } from '../produto/codigos.ts';

describe('derivarCodigos', () => {
  it('usa o menor número da faixa como PAI e os seguintes como SKU', () => {
    expect(derivarCodigos(3, 3)).toEqual({
      codigoPai: '00000001',
      codigos: ['00000002', '00000003'],
    });
  });

  it('formata sempre com oito dígitos e zeros à esquerda', () => {
    const r = derivarCodigos(10, 4);
    expect([r.codigoPai, ...r.codigos]).toEqual(
      ['00000007', '00000008', '00000009', '00000010'],
    );
    expect(r.codigoPai).toMatch(/^\d{8}$/);
  });

  it('não repete número entre PAI e SKUs', () => {
    const r = derivarCodigos(100, 5);
    const todos = [r.codigoPai, ...r.codigos];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('aceita exatamente o limite de oito dígitos', () => {
    const r = derivarCodigos(CODIGO_MAX, 2);
    expect(r.codigos.at(-1)).toBe('99999999');
  });

  it('lança ao ultrapassar o limite em vez de truncar', () => {
    expect(() => derivarCodigos(CODIGO_MAX + 1, 2)).toThrow(/esgotada/i);
  });

  it('rejeita faixa menor que PAI + uma variação', () => {
    expect(() => derivarCodigos(5, 1)).toThrow(/inválida/i);
  });

  it('rejeita faixa que começaria abaixo de 1', () => {
    expect(() => derivarCodigos(1, 3)).toThrow(/inválida/i);
  });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `pnpm test -- codigos`
Expected: FAIL — não resolve `../produto/codigos.ts`.

- [ ] **Step 3: Implementar o mínimo**

Criar `supabase/functions/_shared/produto/codigos.ts`:

```ts
// Código de produto gerado no cadastro manual (spec 2026-07-31).
//
// Oito dígitos com zeros à esquerda NÃO é estética: é o contrato do upload de foto.
// `_shared/upload/match.ts` só casa `^(\d{8})\.(jpe?g|png)$`, e a Revisão renomeia o arquivo
// para `{codigo}.{ext}` — código fora desse formato faz a foto simplesmente não grudar.

export const CODIGO_MAX = 99_999_999;

export interface CodigosGerados {
  codigoPai: string;
  codigos: string[];
}

/**
 * Converte a faixa reservada pela RPC nos códigos formatados.
 *
 * `ultimo` é o valor devolvido por `proximo_codigo_produto` (o ÚLTIMO número da faixa) e
 * `qtd` é quantos números foram reservados: 1 PAI + N variações. O PAI é o MENOR número da
 * faixa (D-2) — a ordem é fixa para os códigos não trocarem de significado entre execuções.
 */
export function derivarCodigos(ultimo: number, qtd: number): CodigosGerados {
  if (!Number.isInteger(ultimo) || !Number.isInteger(qtd) || qtd < 2) {
    throw new Error('Faixa de códigos inválida.');
  }
  const primeiro = ultimo - qtd + 1;
  if (primeiro < 1) throw new Error('Faixa de códigos inválida.');
  // D-5: falha LOUD. Truncar geraria código duplicado em silêncio e nove dígitos quebraria o
  // upload de foto de novo — os dois são piores que recusar o cadastro.
  if (ultimo > CODIGO_MAX) {
    throw new Error(
      `Sequência de códigos da organização esgotada (limite ${CODIGO_MAX}). `
      + 'Nenhum produto foi cadastrado.',
    );
  }
  const formatar = (n: number) => String(n).padStart(8, '0');
  return {
    codigoPai: formatar(primeiro),
    codigos: Array.from({ length: qtd - 1 }, (_, i) => formatar(primeiro + 1 + i)),
  };
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `pnpm test -- codigos`
Expected: PASS, 7 testes.

- [ ] **Step 5: Checar tipos das edges**

Run: `pnpm check:functions && pnpm lint:functions`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/produto/codigos.ts supabase/functions/_shared/__tests__/codigos.test.ts
git commit -m "feat(cadastro): derivacao pura do codigo de produto gerado"
```

---

### Task 2: Migration — sequência, chave de idempotência e RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_codigo_produto_automatico.sql` (gerado pelo CLI)

**Interfaces:**
- Consumes: nada.
- Produces: coluna `organizations.produto_seq bigint not null default 0`; coluna `familias.chave_cadastro uuid`; índice único parcial `familias_org_chave_cadastro_key`; RPC `proximo_codigo_produto(p_org uuid, p_qtd int, p_resync boolean default false) returns bigint`. As Tasks 3 e 4 usam os três.

- [ ] **Step 1: Criar o arquivo da migration**

Run: `supabase migration new codigo_produto_automatico`

- [ ] **Step 2: Escrever a migration**

Colar no arquivo criado:

```sql
-- Código de produto automático no cadastro manual (spec 2026-07-31).
-- Quem usa o módulo de estoque não tem ERP, logo não tem código de produto nem SKU — o
-- sistema passa a gerar os dois, numa sequência única e crescente por organização.

alter table public.organizations
  add column produto_seq bigint not null default 0;

comment on column public.organizations.produto_seq is
  'Sequência do código de produto gerado no cadastro manual (spec 2026-07-31). Só deve ser reservada via proximo_codigo_produto().';

alter table public.familias
  add column chave_cadastro uuid;

comment on column public.familias.chave_cadastro is
  'Idempotência do cadastro manual: uuid da submissão. Retry com a mesma chave devolve o cadastro original em vez de criar um segundo produto.';

-- Parcial de propósito: só o cadastro manual preenche a chave. O caminho de planilha deixa
-- null e não disputa a unique.
create unique index familias_org_chave_cadastro_key
  on public.familias (org_id, chave_cadastro) where chave_cadastro is not null;

-- Inicializa a sequência acima do que JÁ EXISTE, por org e NUMERICAMENTE.
--
-- Por que numericamente e não por string: `subirCapaFamilia` (src/lib/upload-imagens.ts:43)
-- faz padStart(8,'0') no codigo_pai antes de montar o nome do arquivo. Um codigo_pai '1' já
-- gravado e um gerado '00000001' são strings diferentes no banco — nenhum guard os relaciona —
-- mas produzem o MESMO arquivo CAPA_00000001.jpg no storage, e a capa de um sobrescreveria a
-- do outro. A comparação numérica é o que fecha esse canal.
update public.organizations o set produto_seq = greatest(
  coalesce((select max(f.codigo_pai::bigint) from public.familias f
            where f.org_id = o.id and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
  coalesce((select max(v.codigo::bigint) from public.variacoes v
            where v.org_id = o.id and v.codigo ~ '^[0-9]{1,8}$'), 0)
);

create or replace function public.proximo_codigo_produto(
  p_org uuid,
  p_qtd int,
  p_resync boolean default false
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_max bigint;
  v_ultimo bigint;
begin
  -- p_qtd <= 0 rebobinaria a sequência, e sequência rebobinada vira colisão silenciosa
  -- depois. Falha alto, como o resto do caminho de cadastro.
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'p_qtd deve ser maior que zero';
  end if;

  -- Só no caminho da colisão (D-4.1): a inicialização acima é a foto de um alvo em
  -- movimento. Uma org sem o módulo hoje segue importando planilha e seus códigos crescem;
  -- ao habilitar o módulo meses depois, a sequência estaria congelada. Nada impede também
  -- usar o módulo E a planilha ao mesmo tempo. O resync paga o scan só quando colide, nunca
  -- no caminho feliz.
  if p_resync then
    select greatest(
      coalesce((select max(f.codigo_pai::bigint) from public.familias f
                where f.org_id = p_org and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
      coalesce((select max(v.codigo::bigint) from public.variacoes v
                where v.org_id = p_org and v.codigo ~ '^[0-9]{1,8}$'), 0)
    ) into v_max;
    update public.organizations set produto_seq = greatest(produto_seq, v_max)
      where id = p_org;
  end if;

  update public.organizations
    set produto_seq = produto_seq + p_qtd, atualizado_em = now()
    where id = p_org
    returning produto_seq into v_ultimo;

  if v_ultimo is null then
    raise exception 'organização % não encontrada', p_org;
  end if;

  return v_ultimo;
end $$;

-- Padrão do repo (20260729084329_e6b_estoque_movimentos.sql:350-363): revogar de todo mundo
-- E conceder explicitamente ao service_role. Sem o grant a RPC fica inexecutável também pelas
-- edge functions. O browser nunca chama esta RPC (ADR-0094 D-15).
revoke execute on function public.proximo_codigo_produto(uuid, int, boolean)
  from public, anon, authenticated;
grant execute on function public.proximo_codigo_produto(uuid, int, boolean)
  to service_role;
```

- [ ] **Step 3: Aplicar e validar**

Run: `supabase db push && npm run db:check`
Expected: migration aplicada, `db:check` sem divergência.

- [ ] **Step 4: Conferir os valores de inicialização no banco real**

Run:

```bash
supabase db query --linked "select nome, produto_seq from public.organizations order by nome;"
```

Expected: `Avil → 31327733`, `DSA → 1`. Se vier `0` para alguma, a inicialização não rodou — parar e investigar antes de seguir.

- [ ] **Step 5: Conferir que a RPC rejeita quantidade inválida**

Run:

```bash
supabase db query --linked "select public.proximo_codigo_produto((select id from public.organizations where nome = 'DSA'), 0);"
```

Expected: erro `p_qtd deve ser maior que zero`. A sequência não pode ter mudado — conferir com o comando do Step 4 que `DSA` continua em `1`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): sequencia de codigo de produto por org e chave de idempotencia do cadastro"
```

---

### Task 3: Edge — gerar os códigos, cruzar os guards e ressincronizar

**Files:**
- Modify: `supabase/functions/_shared/produto/validar.ts`
- Modify: `supabase/functions/cadastrar-produto/index.ts`

**Interfaces:**
- Consumes: `derivarCodigos`, `CODIGO_MAX` (Task 1); RPC `proximo_codigo_produto` (Task 2).
- Produces: `montarLinhasProduto(p, ctx)` com `ctx` estendido para `{ loteId, userId, orgId, codigoPai, codigos, chaveCadastro }`. `ProdutoEntrada` sem `codigoPai`, `VariacaoEntrada` sem `codigo`, `ProdutoEntrada.chaveCadastro: string`. A Task 5 envia esse contrato do front.

- [ ] **Step 1: Ajustar o contrato e a validação**

Em `supabase/functions/_shared/produto/validar.ts`, trocar as interfaces e `validarProdutoNovo`/`montarLinhasProduto`:

```ts
export interface VariacaoEntrada {
  nome?: string | null;
  gtin?: string | null;
  preco: number;
  custo?: number | null;
  estoqueInicial?: number | null;
  pesoGramas?: number | null;
  alturaCm?: number | null;
  larguraCm?: number | null;
  comprimentoCm?: number | null;
}

export interface ProdutoEntrada {
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  // Idempotência da submissão (spec 2026-07-31, D-9). Sem ela um retry criaria um segundo
  // produto: o código é gerado, então os guards de duplicata NÃO pegam a repetição.
  chaveCadastro: string;
  variacoes: VariacaoEntrada[];
}
```

Dentro de `validarProdutoNovo`, remover as validações de `codigoPai` e de `v.codigo` (incluindo o `Set` de repetidos, que perde o objeto) e acrescentar a trava da chave, logo após a validação de `nomePai`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trava LOUD da idempotência: sem chave válida o retry duplica produto e duplica o estoque
// inicial. "Edge Functions idempotentes" é regra inegociável do projeto — não trocar por um
// default gerado aqui dentro, que mudaria a cada tentativa e não travaria nada.
if (!UUID.test(p.chaveCadastro ?? '')) {
  erros.push({ campo: 'chaveCadastro', mensagem: 'Chave de idempotência ausente ou inválida.' });
}
```

Em `montarLinhasProduto`, estender `ctx` e usar os códigos gerados — o payload da request nunca é mutado:

```ts
export function montarLinhasProduto(
  p: ProdutoEntrada,
  ctx: {
    loteId: string; userId: string; orgId: string;
    codigoPai: string; codigos: string[]; chaveCadastro: string;
  },
): { familia: Record<string, unknown>; variacoes: Array<Record<string, unknown>> } {
  const familia = {
    lote_id: ctx.loteId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo_pai: ctx.codigoPai,
    chave_cadastro: ctx.chaveCadastro,
    nome_pai: p.nomePai.trim(),
    descricao_pai: p.descricaoPai?.trim() || null,
    unidade: p.unidade?.trim() || null,
    fornecedor: p.fornecedor?.trim() || null,
    origem: p.origem,
    operacao: 'CREATE',
    status: 'pendente',
  };

  const variacoes = p.variacoes.map((v, i) => ({
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo: ctx.codigos[i],
    nome: v.nome?.trim() || null,
    gtin: v.gtin?.trim() || null,
    preco: v.preco,
    custo: v.custo ?? null,
    estoque: 0,
    peso_gramas: v.pesoGramas ?? null,
    altura_cm: v.alturaCm ?? null,
    largura_cm: v.larguraCm ?? null,
    comprimento_cm: v.comprimentoCm ?? null,
  }));

  return { familia, variacoes };
}
```

- [ ] **Step 2: Substituir os guards por checagem cruzada sobre código gerado**

Em `supabase/functions/cadastrar-produto/index.ts`, remover os dois blocos de guard atuais (o de `codigo_pai`, linhas ~43-59, e o de SKU, ~61-80) e a leitura `const codigoPai = produto.codigoPai.trim()`. No lugar, acrescentar acima do `Deno.serve` a função de conferência:

```ts
/**
 * Confere os códigos GERADOS contra as duas tabelas (D-6).
 *
 * Cruzado de propósito: o guard antigo de PAI só olhava `familias` e o de SKU só olhava
 * `variacoes`. Com a sequência dessincronizada, um PAI gerado igual a um SKU já existente
 * passava pelos dois — e a resolução de estoque por (org_id, codigo) não distingue os dois
 * campos, então a venda baixaria o produto errado.
 */
async function codigosJaUsados(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  codigos: string[],
): Promise<string[]> {
  const [{ data: pais }, { data: vars }] = await Promise.all([
    admin.from('familias').select('codigo_pai').eq('org_id', orgId).in('codigo_pai', codigos),
    admin.from('variacoes').select('codigo').eq('org_id', orgId).in('codigo', codigos),
  ]);
  return [...new Set([
    ...(pais ?? []).map((f) => f.codigo_pai as string),
    ...(vars ?? []).map((v) => v.codigo as string),
  ])];
}
```

- [ ] **Step 3: Reservar a faixa antes dos inserts**

Ainda em `index.ts`, logo depois de `validarProdutoNovo` e **antes** de resolver o lote, inserir:

```ts
  // A reserva vem ANTES de qualquer insert: assim o estouro de oito dígitos (D-5) e a
  // colisão falham sem deixar lote/família pela metade.
  const qtd = produto.variacoes.length + 1;
  let gerados: CodigosGerados;
  try {
    const { data: ultimo, error } = await admin.rpc('proximo_codigo_produto', {
      p_org: orgId, p_qtd: qtd,
    });
    if (error || ultimo == null) throw new Error(error?.message ?? 'sequência indisponível');
    gerados = derivarCodigos(Number(ultimo), qtd);

    // Colisão sobre código gerado: a sequência está atrás do que existe na org (planilha em
    // paralelo, ou módulo habilitado depois). Ressincroniza e tenta UMA vez (D-4.1).
    let usados = await codigosJaUsados(admin, orgId, [gerados.codigoPai, ...gerados.codigos]);
    if (usados.length > 0) {
      console.warn('cadastrar_produto_resync_sequencia', { orgId, usados });
      const { data: reUltimo, error: reErro } = await admin.rpc('proximo_codigo_produto', {
        p_org: orgId, p_qtd: qtd, p_resync: true,
      });
      if (reErro || reUltimo == null) throw new Error(reErro?.message ?? 'sequência indisponível');
      gerados = derivarCodigos(Number(reUltimo), qtd);
      usados = await codigosJaUsados(admin, orgId, [gerados.codigoPai, ...gerados.codigos]);
      if (usados.length > 0) {
        // D-10: erro de sistema. O operador não escolheu código nenhum — mandá-lo "renomear"
        // seria instrução impossível.
        console.error('cadastrar_produto_colisao_pos_resync', { orgId, usados });
        return json({ error: 'Falha na numeração automática. Tente novamente.' }, 500);
      }
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha na numeração automática.' }, 500);
  }
```

Acrescentar o import do tipo junto com o da função (Step 4).

- [ ] **Step 4: Passar os códigos para a montagem**

Substituir a chamada de montagem por:

```ts
  const { familia, variacoes } = montarLinhasProduto(produto, {
    loteId, userId, orgId,
    codigoPai: gerados.codigoPai,
    codigos: gerados.codigos,
    chaveCadastro: produto.chaveCadastro,
  });
```

E, no laço do estoque inicial, trocar `const codigo = v.codigo.trim()` por `const codigo = gerados.codigos[i]`, convertendo o laço para `produto.variacoes.entries()`:

```ts
  for (const [i, v] of produto.variacoes.entries()) {
    if (!v.estoqueInicial || v.estoqueInicial <= 0) continue;
    const codigo = gerados.codigos[i];
    const { error } = await admin.rpc('registrar_entrada', {
      p_org: orgId, p_codigo: codigo, p_qtd: v.estoqueInicial,
      p_custo: v.custo ?? null, p_doc: 'Cadastro inicial', p_obs: null,
      p_criado_por: userId, p_ref: `cadastro:${familiaId}:${codigo}`,
    });
    if (error) falhasEstoque.push(`${codigo}: ${error.message}`);
  }
```

Acrescentar o import no topo:

```ts
import { type CodigosGerados, derivarCodigos } from '../_shared/produto/codigos.ts';
```

- [ ] **Step 5: Checar tipos e lint das edges**

Run: `pnpm check:functions && pnpm lint:functions`
Expected: sem erro. Se acusar `codigoPai` inexistente em algum ponto, sobrou uso do campo removido — remover.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/produto/validar.ts supabase/functions/cadastrar-produto/index.ts
git commit -m "feat(cadastro): gera codigo do PAI e dos SKUs na edge, com guards cruzados e resync"
```

---

### Task 4: Edge — idempotência por chave de submissão

Separada da Task 3 de propósito: é a correção de uma propriedade de segurança, e um revisor pode querer aprová-la ou rejeitá-la sozinha.

**Files:**
- Modify: `supabase/functions/cadastrar-produto/index.ts`

**Interfaces:**
- Consumes: coluna `familias.chave_cadastro` e o índice único parcial (Task 2); `produto.chaveCadastro` já validado (Task 3).
- Produces: nada novo para tarefas seguintes.

- [ ] **Step 1: Devolver o cadastro original quando a chave repetir**

Em `index.ts`, logo **depois** de `validarProdutoNovo` e **antes** da reserva da faixa (Task 3, Step 3), inserir:

```ts
  // D-9: idempotência da submissão. Com código gerado, um retry produz códigos NOVOS e os
  // guards de duplicata não disparam — sem esta checagem, um timeout depois do insert
  // seguido de um segundo clique criaria uma segunda família e aplicaria o estoque inicial
  // duas vezes (a ref `cadastro:{familiaId}:{codigo}` muda junto com a família).
  const { data: jaCadastrado } = await admin.from('familias')
    .select('id, lote_id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro)
    .maybeSingle();
  if (jaCadastrado) {
    const { data: vars } = await admin.from('variacoes')
      .select('id, codigo').eq('familia_id', jaCadastrado.id).order('codigo');
    return json({
      loteId: jaCadastrado.lote_id,
      familiaId: jaCadastrado.id,
      filaOk: true,
      falhasEstoque: [],
      variacoes: (vars ?? []).map((v) => ({ id: v.id, codigo: v.codigo })),
    });
  }
```

- [ ] **Step 2: Traduzir a violação da unique em resposta idempotente**

Duas submissões simultâneas com a mesma chave passam as duas pelo `select` acima e só uma sobrevive ao insert. Onde hoje o insert da família trata erro (`if (famErr || !familiaCriada)`), tratar antes o código `23505`:

```ts
  if (famErr) {
    // Corrida com outra submissão da MESMA chave: a unique parcial decidiu quem grava.
    // A perdedora devolve o cadastro da vencedora em vez de um erro que o operador não
    // consegue interpretar.
    if (famErr.code === '23505' && famErr.message.includes('chave_cadastro')) {
      const { data: vencedora } = await admin.from('familias')
        .select('id, lote_id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro)
        .maybeSingle();
      if (vencedora) {
        const { data: vars } = await admin.from('variacoes')
          .select('id, codigo').eq('familia_id', vencedora.id).order('codigo');
        return json({
          loteId: vencedora.lote_id, familiaId: vencedora.id,
          filaOk: true, falhasEstoque: [],
          variacoes: (vars ?? []).map((v) => ({ id: v.id, codigo: v.codigo })),
        });
      }
    }
    return json({ error: famErr.message }, 400);
  }
  if (!familiaCriada) return json({ error: 'Falha criando família.' }, 400);
```

- [ ] **Step 3: Checar tipos e lint**

Run: `pnpm check:functions && pnpm lint:functions`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/cadastrar-produto/index.ts
git commit -m "feat(cadastro): idempotencia por chave de submissao, retry nao duplica produto"
```

---

### Task 4b: Extrair a decisão de divergência e cobri-la com testes

Acrescentada durante a execução, aprovada por Diego em 2026-07-31. Motivo: nenhum teste do
projeto executa `cadastrar-produto/index.ts` — a suíte verde prova que nada mais regrediu,
não que a idempotência funciona. Três quebras novas passaram batido nos rounds 1-3 da Task 4
por causa disso, e a única rede foi revisão por leitura. O repositório já tem o padrão de
extrair a lógica para um `processar.ts` testável (`publish-familia-ml`, `upload-imagens-lote`).

Só a decisão PURA é extraída. As consultas continuam no handler — o objetivo é cobrir o que
decide dinheiro, não simular o banco.

**Files:**
- Create: `supabase/functions/cadastrar-produto/processar.ts`
- Create: `supabase/functions/cadastrar-produto/__tests__/processar.test.ts`
- Modify: `supabase/functions/cadastrar-produto/index.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `variacoesDivergem(payload, gravadas): boolean` — usada pelo handler no guard do
  retry idempotente.

- [ ] **Step 1: Escrever os testes que falham**

Criar `supabase/functions/cadastrar-produto/__tests__/processar.test.ts`. Os casos abaixo são
o requisito — o reenvio legítimo NUNCA pode ser barrado, e qualquer edição TEM que ser:

```ts
import { describe, expect, it } from 'vitest';
import { variacoesDivergem } from '../processar.ts';

const gravada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });
const enviada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });

describe('variacoesDivergem', () => {
  it('reenvio idêntico não diverge', () => {
    expect(variacoesDivergem([enviada()], [gravada()])).toBe(false);
  });

  it('normalização: espaços e string vazia equivalem ao que foi gravado', () => {
    expect(variacoesDivergem(
      [enviada({ nome: '  Azul  ', gtin: '' })],
      [gravada({ nome: 'Azul', gtin: null })],
    )).toBe(false);
  });

  it('nulos em ambos os lados não divergem', () => {
    expect(variacoesDivergem(
      [enviada({ nome: null, gtin: null, custo: null })],
      [gravada({ nome: null, gtin: null, custo: null })],
    )).toBe(false);
  });

  it('contagem diferente diverge', () => {
    expect(variacoesDivergem([enviada(), enviada()], [gravada()])).toBe(true);
  });

  it('reordenação diverge', () => {
    const a = enviada({ nome: 'Azul' });
    const b = enviada({ nome: 'Verde' });
    expect(variacoesDivergem([b, a], [gravada({ nome: 'Azul' }), gravada({ nome: 'Verde' })])).toBe(true);
  });

  it('preço alterado em um centavo diverge', () => {
    expect(variacoesDivergem([enviada({ preco: 10.51 })], [gravada({ preco: 10.5 })])).toBe(true);
  });

  it('custo alterado diverge — alimenta markup (ADR-0055)', () => {
    expect(variacoesDivergem([enviada({ custo: 4.26 })], [gravada({ custo: 4.25 })])).toBe(true);
  });

  it('custo que sai de ausente para preenchido diverge', () => {
    expect(variacoesDivergem([enviada({ custo: 4.25 })], [gravada({ custo: null })])).toBe(true);
  });

  it('nome ou gtin alterado diverge', () => {
    expect(variacoesDivergem([enviada({ nome: 'Verde' })], [gravada()])).toBe(true);
    expect(variacoesDivergem([enviada({ gtin: '111' })], [gravada()])).toBe(true);
  });

  it('preço vindo do PostgREST como string compara igual', () => {
    expect(variacoesDivergem([enviada({ preco: 10.5 })], [gravada({ preco: '10.50' })])).toBe(false);
  });

  it('peso e dimensões alterados divergem', () => {
    expect(variacoesDivergem(
      [enviada({ pesoGramas: 500 })],
      [gravada({ peso_gramas: 400 })],
    )).toBe(true);
    expect(variacoesDivergem(
      [enviada({ alturaCm: 10 })],
      [gravada({ altura_cm: 12 })],
    )).toBe(true);
  });

  it('troca de posição entre linhas que só diferem no custo diverge', () => {
    // Sem comparar `custo`, estas duas seriam indistinguíveis e a troca passaria —
    // aplicando o estoque inicial de uma no SKU da outra.
    const a = enviada({ custo: 4.25 });
    const b = enviada({ custo: 9.9 });
    expect(variacoesDivergem([b, a], [gravada({ custo: 4.25 }), gravada({ custo: 9.9 })])).toBe(true);
  });

  it('preço com empate de arredondamento não é falso positivo', () => {
    // `1.005 * 100` em IEEE dá 100.49999…, mas numeric(12,2) guarda 1.01.
    // Só passa se a gravação arredondar antes (Step 3b).
    expect(variacoesDivergem([enviada({ preco: 1.005 })], [gravada({ preco: '1.01' })])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm test -- processar`
Expected: FAIL — não resolve `../processar.ts`.

- [ ] **Step 3: Implementar `processar.ts`**

Extraia a lógica que hoje vive inline no guard do retry em `index.ts`. Regras que o código
precisa respeitar, e que os testes acima cobrem:

- A normalização de `nome`/`gtin` tem que ser IDÊNTICA à de `montarLinhasProduto`
  (`_shared/produto/validar.ts`): `?.trim() || null`. Se divergir, o retry legítimo é barrado
  e a feature inteira perde o sentido.
- `preco` e `custo` chegam do PostgREST podendo ser string (coluna `numeric`). Compare como
  número, em centavos, e trate `null` em `custo` (que é opcional) sem tratá-lo como zero.
- A comparação é posicional, e é isso que faz a reordenação divergir — comportamento desejado.
- **Compare TODAS as colunas que `montarLinhasProduto` grava e têm contrapartida armazenada:**
  `nome, gtin, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm`. Uma lista
  curada (só nome/gtin/preço) deixa passar a troca de posição entre duas linhas que diferem
  apenas em peso ou custo — e aí o estoque inicial de uma entra no SKU da outra.
  `estoqueInicial` fica de fora porque não tem contrapartida gravada (`estoque` nasce 0).
- O `select` do handler precisa passar a trazer essas colunas; hoje ele busca menos campos.

- [ ] **Step 3b: Gravar `preco` já arredondado a duas casas**

Em `montarLinhasProduto` (`_shared/produto/validar.ts`), grave `preco` arredondado a 2 casas
em vez do float cru. A coluna é `numeric(12,2)`, então o Postgres arredonda de qualquer jeito
— o problema é que o JS e o Postgres discordam em empates: `1.005 * 100` em IEEE dá
`100.4999…` (arredonda para 1.00) enquanto `1.005::numeric(12,2)` dá `1.01`. Sem isto, um
retry legítimo com preço nesse formato é barrado por engano.

Não é "3+ casas decimais" em geral — é só o subconjunto de empates `x.xx5` cujo double cai
logo abaixo do meio. Arredondar na gravação elimina a classe inteira.

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm test -- processar`
Expected: PASS, 10 testes.

- [ ] **Step 5: Ligar o handler à função extraída**

Em `index.ts`, substitua o guard inline pela chamada a `variacoesDivergem(...)`, preservando
exatamente o comportamento atual: divergiu → 409 **com** `familiaId` e `loteId` (que o front
converte em `ProdutoJaExisteError`); lista vazia → 409 **sem** `familiaId`. O `custo` passa a
entrar na comparação — é a correção pendente da Task 4, e a razão é ADR-0055: custo alimenta
markup, então um retry que grave custo divergente no ledger é caminho financeiro.

- [ ] **Step 6: Verificar e commitar**

Run: `pnpm test && pnpm check:functions && pnpm lint:functions`
Expected: tudo verde, incluindo os 10 testes novos.

```bash
git add supabase/functions/cadastrar-produto/
git commit -m "test(cadastro): extrai decisao de divergencia e cobre os ramos de idempotencia"
```

---

### Task 5: Front — remover os campos de código e enviar a chave

**Files:**
- Modify: `src/lib/produto-entrada.ts`
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx`

**Interfaces:**
- Consumes: contrato da Task 3 (`ProdutoEntrada` sem códigos, com `chaveCadastro`).
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Espelhar o contrato**

Em `src/lib/produto-entrada.ts`, remover `codigo` de `VariacaoEntrada` e `codigoPai` de `ProdutoEntrada`, e acrescentar em `ProdutoEntrada`:

```ts
  // Idempotência da submissão: o mesmo uuid reenviado devolve o cadastro original em vez de
  // criar um segundo produto. Nasce ao abrir o diálogo (ver dialog-cadastro-produto.tsx).
  chaveCadastro: string;
```

Atualizar o comentário do topo do arquivo, que hoje descreve os campos obrigatórios.

- [ ] **Step 2: Tirar os campos da tela e enviar a chave**

Em `src/components/estoque/dialog-cadastro-produto.tsx`:

1. Em `LinhaVariacao` e `LINHA_VAZIA`, remover a propriedade `codigo`.
2. Na lista de colunas da tabela, remover `'SKU'` do array de cabeçalhos e `'codigo'` do array de campos renderizados.
3. Remover o bloco do input "Código do produto (PAI)" (o `<div>` com `htmlFor="cad-codigo"`), deixando o campo Nome ocupar a linha.
4. Trocar o state e o efeito de limpeza para incluir a chave, espelhando `dialog-entrada.tsx:33-45`:

```ts
  // Nasce ao ABRIR e só troca depois de um sucesso confirmado: duplo clique e retry de rede
  // reusam a mesma chave, e a 2ª tentativa devolve o cadastro original em vez de duplicar.
  const [chaveCadastro, setChaveCadastro] = useState(() => crypto.randomUUID());
```

No `useEffect` que hoje limpa o formulário ao fechar, acrescentar `setChaveCadastro(crypto.randomUUID());`.

5. Em `montarPayload`, remover `codigo` do map de variações e `codigoPai` do retorno, e receber a chave:

```ts
function montarPayload(
  pai: { nomePai: string; descricaoPai: string; unidade: string; fornecedor: string; origem: 'nacional' | 'importado' },
  linhas: LinhaVariacao[],
  chaveCadastro: string,
): ProdutoEntrada {
  const variacoes: VariacaoEntrada[] = linhas.map((l) => ({
    nome: l.nome.trim() || null,
    gtin: l.gtin.trim() || null,
    preco: num(l.preco) ?? 0,
    custo: num(l.custo),
    estoqueInicial: num(l.estoqueInicial),
    pesoGramas: num(l.pesoGramas),
    alturaCm: num(l.alturaCm),
    larguraCm: num(l.larguraCm),
    comprimentoCm: num(l.comprimentoCm),
  }));
  return {
    nomePai: pai.nomePai.trim(),
    descricaoPai: pai.descricaoPai.trim() || null,
    unidade: pai.unidade.trim() || null,
    fornecedor: pai.fornecedor.trim() || null,
    origem: pai.origem,
    chaveCadastro,
    variacoes,
  };
}
```

6. Em `salvar()`, passar a chave e renovar após sucesso:

```ts
      const r = await cadastrarProduto(montarPayload(
        { nomePai, descricaoPai, unidade, fornecedor, origem }, linhas, chaveCadastro,
      ));
      setResultado(r);
      setChaveCadastro(crypto.randomUUID());
```

7. Ajustar `podeSalvar`, que hoje exige `codigoPai` e `l.codigo`:

```ts
  const podeSalvar = !!nomePai.trim() && !!origem
    && linhas.length > 0
    && linhas.every((l) => (num(l.preco) ?? 0) > 0);
```

8. Acrescentar o aviso na etapa 1, logo acima da tabela de variações:

```tsx
                <span className="text-xs text-muted-foreground">
                  Códigos gerados automaticamente ao salvar.
                </span>
```

- [ ] **Step 3: Conferir que o `ProdutoJaExisteError` não sobrou pendurado**

O erro 409 de PAI duplicado deixou de existir para código gerado (D-10). Em `src/lib/produtos-saldo.ts`, o `ProdutoJaExisteError` continua exportado e usado pelo catch do diálogo — deixar como está: a edge ainda pode devolver 409 por outro motivo e o tratamento é inofensivo. **Não remover** nesta tarefa.

- [ ] **Step 4: Rodar lint, tipos e testes**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: tudo passa. `pnpm build` roda `tsc -b` e é o que pega campo removido usado em algum lugar esquecido.

- [ ] **Step 5: Commit**

```bash
git add src/lib/produto-entrada.ts src/components/estoque/dialog-cadastro-produto.tsx
git commit -m "feat(cadastro): tela sem campos de codigo, com chave de idempotencia"
```

---

### Task 6: Verificação em runtime

Nenhum teste automatizado cobre a edge (não há teste de integração de edge no projeto), então esta tarefa é a única prova de que o caminho inteiro funciona.

**Files:**
- Nenhum. Só deploy e verificação.

- [ ] **Step 1: Deployar as edges afetadas**

`_shared/produto/` mudou, então **todas** as edges que o importam precisam ir junto:

Run: `supabase functions deploy cadastrar-produto --project-ref txvncrgkoynoxwopfkbp`

Depois conferir a versão publicada:

Run: `supabase functions list --project-ref txvncrgkoynoxwopfkbp | grep cadastrar-produto`
Expected: `version` maior que o anterior (era 2).

- [ ] **Step 2: Cadastrar um produto de teste pela tela**

Na org DSA, cadastrar um produto com duas variações. Conferir na tela que não há campo de código nem coluna SKU, e que a etapa de fotos mostra os códigos gerados.

- [ ] **Step 3: Conferir os códigos no banco**

Run:

```bash
supabase db query --linked "select f.codigo_pai, f.chave_cadastro is not null as tem_chave, v.codigo from public.familias f join public.variacoes v on v.familia_id = f.id where f.org_id = 'a1fcd536-bb43-4fae-9f44-1e09d19e6c8e' order by f.criado_em desc, v.codigo limit 5;"
```

Expected: `codigo_pai = '00000002'`, variações `'00000003'` e `'00000004'`, `tem_chave = true`. Os códigos começam em 2 porque a DSA já tem um produto com PAI `1` — é o comportamento correto da inicialização.

- [ ] **Step 4: Provar a idempotência**

Recarregar a tela e cadastrar outro produto; enquanto a requisição estiver em voo, não há como clicar duas vezes pela UI (o botão desabilita). Provar pelo banco que a chave é única e está gravada:

Run:

```bash
supabase db query --linked "select count(*) as familias, count(distinct chave_cadastro) as chaves from public.familias where org_id = 'a1fcd536-bb43-4fae-9f44-1e09d19e6c8e' and chave_cadastro is not null;"
```

Expected: `familias = chaves` (nenhuma chave repetida).

- [ ] **Step 5: Provar o efeito colateral da foto**

Na tela de Revisão do lote criado, subir uma foto pela câmera da variação `00000003`. Conferir:

```bash
supabase db query --linked "select codigo, imagem_path from public.variacoes where codigo = '00000003';"
```

Expected: `imagem_path` preenchido. É a confirmação de que o código gerado casa com o `^\d{8}` do match — o produto antigo, de SKU 13 dígitos, continua sem conseguir.

- [ ] **Step 6: Commit (se algo precisou de ajuste)**

Se os passos acima exigiram correção, commitar com mensagem descrevendo o que a verificação em runtime revelou. Se nada mudou, não há commit nesta tarefa.

---

### Task 7: Documentação e ADR

Regra de conclusão do projeto: doc atualizada **no mesmo commit da entrega**.

**Files:**
- Create: `docs/decisions/0095-codigo-produto-automatico.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/reference/modelo-de-dados.md`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md`

- [ ] **Step 1: Conferir o número do próximo ADR**

Run: `ls docs/decisions/ | tail -5`
Expected: confirmar que `0095` está livre; se não estiver, usar o próximo número e ajustar todas as referências abaixo.

- [ ] **Step 2: Escrever o ADR**

Criar `docs/decisions/0095-codigo-produto-automatico.md` no formato dos ADRs existentes (ver `0094-estoque-unico-cadastro-manual.md`), com: Status Aceito, Data 2026-07-31, Decisores Diego. Copiar a tabela de decisões D-1..D-10 da spec verbatim, mais a seção "Alternativas rejeitadas" com: número puro sem zeros (mantinha o upload de foto quebrado), geração no front (colide entre abas), `max(codigo)+1` (colide sob concorrência), formato configurável por org (reabriria o bug que este trabalho fecha).

- [ ] **Step 3: Atualizar as referências técnicas**

Em `docs/reference/edge-functions.md`, na seção de `cadastrar-produto`: registrar que o payload não tem mais `codigoPai`/`codigo`, que passa a exigir `chaveCadastro`, e que a edge gera os códigos com oito dígitos.

Em `docs/reference/modelo-de-dados.md`: acrescentar `organizations.produto_seq`, `familias.chave_cadastro` e o índice único parcial.

- [ ] **Step 4: Atualizar TASKS.md e o índice de ADRs**

Em `docs/TASKS.md`, registrar o trabalho concluído. Em `obsidian-vault/04-Decisões/Índice de ADRs.md`, acrescentar a linha do ADR-0095.

- [ ] **Step 5: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(adr-0095): codigo de produto automatico no cadastro manual"
```

---

## Notas para quem executa

- **A ordem importa.** Task 2 antes da 3 e da 4 (as duas usam a coluna e a RPC). Task 3 antes da 5 (o front espelha o contrato da edge). Task 6 depois de tudo.
- **Se a Task 6 Step 3 mostrar código começando em `00000001` na DSA**, a inicialização da migration não rodou — isso significa que a capa do produto novo sobrescreveria a capa do produto `1` existente no storage. Parar e corrigir antes de seguir.
- **Não "simplificar" a comparação numérica da inicialização para comparação de string.** O motivo está no comentário da migration e é um canal de colisão real, não teórico.
- **Não sofisticar o estouro de oito dígitos.** Falhar é a resposta certa (D-5); a folga real é de 68 milhões de códigos no pior caso.
