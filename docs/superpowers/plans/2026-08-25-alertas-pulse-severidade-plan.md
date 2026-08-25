# Plano — Alertas do Pulse: severidade gravada e aba dedicada

**Spec:** `docs/superpowers/specs/2026-08-25-alertas-pulse-severidade-design.md`
**ADR:** `docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md`
**Branch:** `worktree-pulse-alertas-severidade`

## Correção ao spec, feita durante o planejamento

O spec previa "link com `?tab=alertas`" na notificação. **Não é implementável:**
`gravarNotificacoesInApp` (`_shared/notificacoes/config.ts:56-58`) insere apenas
`user_id, org_id, categoria, texto` — a tabela `notificacoes` não tem campo de link, e o Telegram
recebe texto puro. A notificação passa a **citar a aba em texto**; deep-link exigiria mudar o schema
de notificações e está fora deste escopo.

## Restrições globais (valem para TODAS as tasks)

Copiadas do `CLAUDE.md` do projeto e da memória do operador. Cada task as inclui implicitamente.

1. **Migrations só por CLI** (ADR-0043): `supabase migration new` + `supabase db push`, validado com
   `npm run db:check`. Nunca painel, nunca `apply_migration`. O worktree **não vem linkado** —
   `supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null` antes do push.
2. **Edge functions por CLI completa.** Mudança em `_shared/` exige redeploy de todas as funções que
   importam. Verificado: `_shared/pulse/diff.ts` e `_shared/pulse/tipos.ts` são importados **apenas**
   por `supabase/functions/pulse-coletar/processar.ts` — o redeploy é só de `pulse-coletar`.
   Conferir a versão pós-deploy.
3. **`pnpm lint` e `pnpm test` passando** antes de cada commit.
4. **Nunca editar a `main` direto.** Todo trabalho fica nesta branch.
5. **RLS por `org_id`** em toda leitura e escrita de tabela de domínio.
6. **Idempotência** das edge functions preservada.
7. **Mock não basta em feature nova**: a regra de severidade precisa de prova contra dado real antes
   de ser considerada entregue (Task 5).
8. **`.env.local` é gitignored e não vem no worktree** — copiar do checkout principal antes de rodar
   dev ou qualquer comando que leia segredo. Extrair segredo sempre com `grep '^NOME=.\+'` (o `.\+`
   recusa linha vazia).
9. **Não regenerar `database.types.ts`** para tabelas `pulse_*`: elas usam cast `as never` em
   `src/lib/pulse.ts:10-14`. Basta acrescentar a coluna à string do `select`.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade única |
|---|---|---|
| `supabase/migrations/<ts>_pulse_alertas_severidade.sql` | criar | Coluna `severidade` + índice de contagem |
| `supabase/functions/_shared/pulse/tipos.ts` | modificar | `SeveridadeAlerta` e `severidade` em `AlertaNovo` |
| `supabase/functions/_shared/pulse/diff.ts` | modificar | Classificar cada alerta que emite (regra pura) |
| `supabase/functions/_shared/pulse/__tests__/diff.test.ts` | modificar | Provar a regra de severidade |
| `supabase/functions/pulse-coletar/processar.ts` | modificar | Fornecer `meuPreco` e `nickname`; gravar severidade; notificar por severidade |
| `supabase/functions/pulse-coletar/__tests__/alertas-severidade.test.ts` | **criar** | Provar a regra na fronteira do coletor (errata 1) e o texto da notificação |
| `src/lib/pulse.ts` | modificar | Leitura paginada, contagem exata, marcar escopado |
| `src/lib/queries.ts` | modificar | Chaves de cache por severidade e página |
| `src/lib/pulse-alerta-texto.ts` | modificar | Nomear o vendedor no texto |
| `src/lib/__tests__/pulse-alerta-texto.test.ts` | modificar | Provar nickname / fallback |
| `src/components/pulse/aba-alertas.tsx` | **criar** | A aba: filtro, contagem, lista paginada, marcar |
| `src/components/pulse/__tests__/aba-alertas.test.tsx` | **criar** | Provar filtro, contagem real, escopo do marcar |
| `src/components/pulse/painel-alertas.tsx` | **remover** | Substituído pela aba |
| `src/components/pulse/__tests__/painel-alertas.test.tsx` | **remover** | Idem |
| `src/pages/Pulse.tsx` | modificar | Terceira aba + badge; painel sai do Radar |

Três arquivos novos — a aba, seu teste e o teste do coletor. O restante é modificação. O teste do
coletor é o que prova a regra da errata 1 no ponto em que o coletor decide o que passar ao
classificador; a regra pura já tem cobertura em `diff.test.ts`, mas nenhuma das duas cobre a outra.

---

## Task 1 — Regra de severidade (pura, sem I/O)

**Arquivos:** `_shared/pulse/tipos.ts`, `_shared/pulse/diff.ts`, `_shared/pulse/__tests__/diff.test.ts`

**Produz para as tasks seguintes:**
- `export type SeveridadeAlerta = 'acao' | 'info'`
- `AlertaNovo` com o campo `severidade: SeveridadeAlerta`
- `diffOfertas(anteriores, atuais, opcoes?: OpcoesDiff)` com
  `OpcoesDiff = { primeiraColeta?: boolean; meuPreco?: number | null; nicknames?: Map<number, string | null> }`

### Passo 1.1 — `tipos.ts`

Substituir as duas linhas atuais:

```ts
export type TipoAlerta = 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
export interface AlertaNovo { tipo: TipoAlerta; payload: Record<string, unknown>; }
```

por:

```ts
export type TipoAlerta = 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
/** ADR-0133: `acao` = muda decisão de preço; `info` = movimento de mercado sem decisão. Congelada
 *  no instante do evento — nunca recalculada na leitura. */
export type SeveridadeAlerta = 'acao' | 'info';
export interface AlertaNovo {
  tipo: TipoAlerta;
  payload: Record<string, unknown>;
  severidade: SeveridadeAlerta;
}
```

### Passo 1.2 — `diff.ts`

Acrescentar, logo abaixo do `import` de `qualificarOferta`:

```ts
export interface OpcoesDiff {
  primeiraColeta?: boolean;
  /** Preço da NOSSA oferta no mesmo snapshot das concorrentes (ADR-0133 D-3). `null` = não
   *  vendemos o item; sem preço nosso não há decisão de preço, então tudo vira `info`. */
  meuPreco?: number | null;
  /** Apelido por seller_id, para congelar o nome no payload e não depender de join no render. */
  nicknames?: Map<number, string | null>;
}

/** Só um preço medido abaixo do nosso ameaça a posição. `meuPreco` nulo nunca qualifica. */
const abaixoDeNos = (preco: number, meuPreco: number | null | undefined): boolean =>
  meuPreco != null && Number.isFinite(meuPreco) && preco < meuPreco;
```

Trocar a assinatura de `diffOfertas`:

```ts
export function diffOfertas(
  anteriores: OfertaAnterior[],
  atuais: OfertaColetada[],
  opcoes?: OpcoesDiff,
): DiffOfertas {
```

Dentro do corpo, logo após `const alertas: AlertaNovo[] = [];`, acrescentar:

```ts
  const meuPreco = opcoes?.meuPreco ?? null;
  const apelido = (sellerId: number) => opcoes?.nicknames?.get(sellerId) ?? null;
```

**`novo_concorrente`** — substituir o push atual por:

```ts
        alertas.push({
          tipo: 'novo_concorrente',
          payload: {
            item_id: atual.item_id, seller_id: atual.seller_id, preco: atual.preco,
            meu_preco: meuPreco, nickname: apelido(atual.seller_id),
          },
          severidade: abaixoDeNos(atual.preco, meuPreco) ? 'acao' : 'info',
        });
```

**`preco_caiu`** — substituir o push atual por:

```ts
    alertas.push({
      tipo: 'preco_caiu',
      payload: { de: minAntes, para: minAtual, meu_preco: meuPreco },
      severidade: abaixoDeNos(minAtual, meuPreco) ? 'acao' : 'info',
    });
```

**`concorrente_saiu`** — antes do laço `for (const d of desativar)`, inserir:

```ts
  // A decisão que este alerta habilita é SUBIR preço, e ela depende do mercado DEPOIS da saída:
  // com relevantes a 70 e 71 e nosso preço 75, a saída do de 70 não nos torna o menor. Ficha que
  // ficou sem nenhuma oferta relevante é o caso mais forte — `Math.min` de lista vazia devolve
  // Infinity, não null, então a checagem de finitude tem de vir primeiro e como aprovação.
  const ninguemAbaixoAgora = meuPreco != null && Number.isFinite(meuPreco)
    && (!Number.isFinite(minAtual) || minAtual >= meuPreco);
```

e substituir o push dentro do laço por:

```ts
      alertas.push({
        tipo: 'concorrente_saiu',
        payload: {
          item_id: d.item_id, seller_id: d.seller_id, preco: d.preco,
          meu_preco: meuPreco, nickname: apelido(d.seller_id),
        },
        severidade: abaixoDeNos(d.preco, meuPreco) && ninguemAbaixoAgora ? 'acao' : 'info',
      });
```

### Passo 1.3 — testes em `diff.test.ts`

Acrescentar ao final do arquivo (os helpers `oferta`/`anterior` já existem no topo):

```ts
describe('severidade do alerta (ADR-0133)', () => {
  const semMeuPreco = { primeiraColeta: false };

  it('preco_caiu vira acao quando o menor fica abaixo do nosso preço', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 80 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'preco_caiu')?.severidade).toBe('acao');
  });

  it('preco_caiu fica info quando o menor continua acima do nosso preço', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 95 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'preco_caiu')?.severidade).toBe('info');
  });

  it('sem meuPreco todo alerta é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 10 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 5 })],
      semMeuPreco,
    );
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertas.every((a) => a.severidade === 'info')).toBe(true);
  });

  it('novo_concorrente vira acao só quando entra abaixo de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 80 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    const novo = alertas.filter((a) => a.tipo === 'novo_concorrente');
    expect(novo).toHaveLength(1);
    expect(novo[0].severidade).toBe('acao');
  });

  it('concorrente_saiu vira acao quando o único abaixo de nós sai', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 95 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 95 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    const saiu = alertas.filter((a) => a.tipo === 'concorrente_saiu');
    expect(saiu).toHaveLength(1);
    expect(saiu[0].severidade).toBe('acao');
  });

  it('concorrente_saiu fica info quando ainda resta alguém abaixo de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 70 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 71 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 71 })],
      { primeiraColeta: false, meuPreco: 75 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  it('concorrente_saiu fica info quando quem saiu estava acima de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 120 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 130 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 130 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  it('ficha que ficou sem nenhuma oferta relevante é acao', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      [],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('acao');
  });

  it('congela o nickname no payload quando o mapa o conhece', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 80 })],
      { primeiraColeta: false, meuPreco: 90, nicknames: new Map([[2, 'LOJA DOIS']]) },
    );
    expect(alertas.find((a) => a.tipo === 'novo_concorrente')?.payload.nickname).toBe('LOJA DOIS');
  });
});
```

Os testes existentes de `diffOfertas` que só olham `tipo` continuam válidos; se algum comparar o
objeto de alerta inteiro com `toEqual`, acrescentar `severidade: 'info'` ao esperado.

**Comando e saída esperada:**
`pnpm test -- diff.test.ts` → todos os testes do arquivo passando, incluindo os 9 novos.
`pnpm lint` → sem erros.

**Commit:** `feat(pulse): severidade acao|info na regra de alerta (ADR-0133)`

---

## Task 2 — Migration e coletor

**Arquivos:** migration nova, `pulse-coletar/processar.ts`,
`docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`

**Consome da Task 1:** `SeveridadeAlerta`, `AlertaNovo.severidade`, `OpcoesDiff`.

### Passo 2.1 — migration

```bash
supabase migration new pulse_alertas_severidade
```

Conteúdo do arquivo gerado:

```sql
-- ADR-0133: severidade congelada no instante do evento. O `default 'info'` É o backfill dos
-- alertas históricos — classificá-los contra o preço de hoje contradiria o congelamento.
alter table public.pulse_alertas
  add column severidade text not null default 'info'
    check (severidade in ('acao','info'));

-- Badge e filtro sempre consultam org + severidade + não lido, ordenados por data.
create index pulse_alertas_org_sev_lido_idx
  on public.pulse_alertas (org_id, severidade, lido, criado_em desc);
```

Sem grant novo: `grant select on public.pulse_alertas to authenticated`
(`20260816125057_pulse_v1.sql:75`) é table-level e cobre coluna adicionada depois; o app continua
escrevendo só `lido`, coberto por `grant update (lido)` (linha 80).

```bash
supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null
supabase db push --linked --dry-run --yes < /dev/null   # conferir O QUE sobe
supabase db push --linked --yes < /dev/null
npm run db:check                                         # esperado: "Migrations alinhadas"
```

### Passo 2.2 — `processar.ts`: perfil com nickname

Em `PerfilVendedorAtual` (linha ~46), acrescentar `nickname: string | null;`.

Em `perfisAtuaisParaAlertas` (linha ~190), trocar o select:

```ts
        .select('seller_id, nickname, transactions_total, nivel, dia, perfil_coletado_em')
```

### Passo 2.3 — `processar.ts`: `meuPreco` em memória

Em `AlertaPendente` (linha ~40), acrescentar:

```ts
  /** Preço da nossa oferta no MESMO snapshot das concorrentes (ADR-0133 D-3). Viaja em memória
   *  de propósito: reler `pulse_produtos` herdaria o update abaixo, que não checa erro. */
  meuPreco: number | null;
```

No passo 3, dentro do `pool`, **mover `const nossa = extrairNossaOferta(json, proprioSellerId);`
para ANTES do `alertasPendentes.push(...)`** (hoje ele vem depois) e passar o preço:

```ts
    const nossa = extrairNossaOferta(json, proprioSellerId);
    if (nossa) precoEfetivoPorItem.set(nossa.item_id, nossa.preco);
    alertasPendentes.push({
      produtoId: produto.id, anteriores, atuais, estadoGravado,
      meuPreco: nossa?.preco ?? null,
    });
```

Remover a linha `if (nossa) precoEfetivoPorItem.set(...)` da posição antiga para não duplicar.

### Passo 2.4 — `processar.ts`: gravar severidade e contar ação

`gravarAlertasRelevantes` passa a devolver `{ total: number; acao: number }`:

```ts
async function gravarAlertasRelevantes(
  admin: SupabaseClient, orgId: string, pendentes: AlertaPendente[],
): Promise<{ total: number; acao: number }> {
  if (pendentes.length === 0) return { total: 0, acao: 0 };
  const [perfis, visitasAtuais] = await Promise.all([
    perfisAtuaisParaAlertas(admin, orgId, pendentes),
    visitasAtuaisParaAlertas(admin, orgId, pendentes),
  ]);
  const nicknames = new Map<number, string | null>(
    [...perfis.entries()].map(([sellerId, p]) => [sellerId, p.nickname ?? null]),
  );
  let total = 0;
  let acao = 0;
```

No `diffOfertas` dentro do laço:

```ts
    const { alertas } = diffOfertas(anteriores, atuais, {
      primeiraColeta: pendente.anteriores.length === 0,
      meuPreco: pendente.meuPreco,
      nicknames,
      // ANTES da qualificação: `atuais` aqui é `pendente.atuais`, cru. Passar a lista já filtrada
      // faria "não qualifiquei ninguém" se passar por "a ficha esvaziou" — e o alerta mandaria
      // subir preço com concorrente vendendo abaixo (ADR-0133 errata 1).
      mercadoObservadoVazio: pendente.atuais.length === 0,
    });
```

`textoNotificacaoAlertas` e `gravarAlertasRelevantes` são **exportadas** (`export function` /
`export async function`) para permitir `pulse-coletar/__tests__/alertas-severidade.test.ts`, que
chama as duas direto com um fake do `SupabaseClient`. Sem o export, a regra da errata 1 só teria
prova na função pura do `_shared`, e a passagem coletor → classificador ficaria sem cobertura.

**Não confundir os dois `atuais` deste trecho:** o `const atuais` local é a lista **já filtrada** por
`entradaDiffRelevante`; `pendente.atuais` é a lista **crua** da ficha. `mercadoObservadoVazio` só
pode olhar a crua.

No insert:

```ts
    const { error } = await admin.from('pulse_alertas').insert(
      alertas.map((a) => ({
        org_id: orgId, produto_id: pendente.produtoId,
        tipo: a.tipo, payload: a.payload, severidade: a.severidade,
      })),
    );
    if (!error) {
      total += alertas.length;
      acao += alertas.filter((a) => a.severidade === 'acao').length;
    } else console.warn(`pulse-coletar: alertas do produto ${pendente.produtoId} falharam:`, error.message);
  }
  return { total, acao };
}
```

### Passo 2.5 — `processar.ts`: notificação por severidade

Substituir o bloco atual (linha ~621 em diante):

```ts
  const resultadoAlertas = await gravarAlertasRelevantes(admin, orgId, alertasPendentes);
  alertasTotal = resultadoAlertas.total;

  // Uma notificação agregada por org por execução — SÓ para org com o módulo habilitado.
  if (alertasTotal > 0) {
    const { data: org } = await admin.from('organizations')
      .select('modulos_habilitados').eq('id', orgId).maybeSingle();
    const moduloAtivo = ((org?.modulos_habilitados as string[] | null) ?? []).includes('pulse');
    if (!moduloAtivo) {
      console.warn(`pulse-coletar: ${alertasTotal} alerta(s) da org ${orgId} sem notificação — módulo pulse desabilitado`);
    } else {
      const { count } = await admin.from('pulse_alertas')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('lido', false).eq('severidade', 'acao');
      const pendentesAcao = count ?? 0;
      // Prometer ação num lote 100% informativo treina o operador a ignorar a notificação — e a
      // próxima, que era real, morre junto (ADR-0133 D-10).
      const texto = resultadoAlertas.acao > 0
        ? `Pulse: ${resultadoAlertas.acao} alerta(s) exigem decisão de preço`
          + (pendentesAcao > resultadoAlertas.acao ? ` (${pendentesAcao} aguardando no total)` : '')
          + ' — abra a aba Alertas do Pulse.'
        : `Pulse: ${alertasTotal} atualização(ões) de mercado, nenhuma exige decisão.`;
      await notificarCategoria(admin, orgId, 'pulse', texto);
    }
  }
```

### Passo 2.6 — deploy e docs

```bash
export SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=.\+' .env.local | cut -d= -f2-)"
supabase functions deploy pulse-coletar --project-ref txvncrgkoynoxwopfkbp
```
Conferir a versão pós-deploy. `pulse-coletar` é chamada por QStash cron — o `config.toml` já congela
seu `verify_jwt`; **não** passar `--no-verify-jwt` por hábito.

Atualizar no mesmo commit:
- `docs/reference/modelo-de-dados.md`: coluna `severidade` em `pulse_alertas` com os dois valores e o
  significado de cada um.
- `docs/reference/edge-functions.md`: `pulse-coletar` passa a classificar severidade e a distinguir o
  texto da notificação.

**Comando e saída esperada:** `npm run db:check` → "Migrations alinhadas"; `pnpm lint` sem erros.

**Commit:** `feat(pulse): coletor grava severidade e notifica só decisão real`

---

## Task 3 — Camada de dados do front

**Arquivos:** `src/lib/pulse.ts`, `src/lib/queries.ts`

**Produz para a Task 4:** `SeveridadeAlerta`, `FiltroSeveridade`, `ALERTAS_POR_PAGINA`,
`fetchPulseAlertas`, `contarPulseAlertas`, `marcarAlertasLidos`, `QK.pulseAlertas`,
`QK.pulseAlertasContagem`.

### Passo 3.1 — `pulse.ts`

Em `PulseAlerta` (linha ~76), acrescentar `severidade: SeveridadeAlerta;` e declarar acima:

```ts
/** ADR-0133. `acao` = muda decisão de preço; `info` = movimento de mercado sem decisão. */
export type SeveridadeAlerta = 'acao' | 'info';
export type FiltroSeveridade = SeveridadeAlerta | 'todos';
export const ALERTAS_POR_PAGINA = 50;
```

Substituir `fetchPulseAlertas` e `marcarTodosAlertasLidos` por:

```ts
/** Uma página de alertas NÃO LIDOS do filtro. A aba é a caixa de não lidos, não o arquivo
 *  histórico (ADR-0133). Sem teto fixo: o teto é o tamanho da página. */
export async function fetchPulseAlertas(
  { severidade, pagina }: { severidade: FiltroSeveridade; pagina: number },
): Promise<PulseAlerta[]> {
  const de = pagina * ALERTAS_POR_PAGINA;
  let q = pulseFrom('pulse_alertas')
    .select('id, produto_id, tipo, severidade, payload, lido, criado_em, pulse_produtos(titulo, codigo_pai, catalog_product_id)')
    .eq('lido', false)
    .order('criado_em', { ascending: false })
    .range(de, de + ALERTAS_POR_PAGINA - 1);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PulseAlerta[];
}

/** Contagem VERDADEIRA de não lidos do filtro — separada da página. O rótulo antigo usava o
 *  tamanho da lista, que era o teto de leitura: dizia "20" com 145 não lidos (ADR-0133 D-7). */
export async function contarPulseAlertas(severidade: FiltroSeveridade): Promise<number> {
  let q = pulseFrom('pulse_alertas')
    .select('id', { count: 'exact', head: true })
    .eq('lido', false);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Marca como lidos os não lidos do filtro ativo. O escopo só admite colunas locais de
 *  `pulse_alertas`: o update do PostgREST não filtra por coluna de recurso embutido, então um
 *  escopo por título de produto ou apagaria o que o operador não viu, ou mentiria no número
 *  (ADR-0133 D-9). Grant é column-level em `lido` — nada mais pode ir no update. */
export async function marcarAlertasLidos(severidade: FiltroSeveridade): Promise<void> {
  let q = pulseFrom('pulse_alertas').update({ lido: true }).eq('lido', false);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { error } = await q;
  if (error) throw error;
}
```

`marcarAlertaLido` (singular) fica como está.

### Passo 3.2 — `queries.ts`

Substituir `pulseAlertas: ['pulse', 'alertas'] as const,` (linha 63) por:

```ts
  pulseAlertas: (severidade: string, pagina: number) => ['pulse', 'alertas', 'lista', severidade, pagina] as const,
  pulseAlertasContagem: (severidade: string) => ['pulse', 'alertas', 'contagem', severidade] as const,
```

O prefixo `['pulse']` continua invalidando ambas — o `invalidateQueries({ queryKey: ['pulse'] })` do
botão "Atualizar agora" segue funcionando sem mudança.

**Comando e saída esperada:** `pnpm lint` sem erros; `npx tsc -b --force` sem erros — o build local é
incremental e passa com `tsbuildinfo` velho enquanto o `tsc -b` do CI reprova.

**Commit:** `feat(pulse): leitura de alertas paginada, contagem exata e marcar escopado`

---

## Task 4 — A aba Alertas

**Arquivos:** `src/components/pulse/aba-alertas.tsx` (criar),
`src/components/pulse/__tests__/aba-alertas.test.tsx` (criar),
`src/components/pulse/painel-alertas.tsx` (remover),
`src/components/pulse/__tests__/painel-alertas.test.tsx` (remover),
`src/pages/Pulse.tsx`, `src/lib/pulse-alerta-texto.ts`,
`src/lib/__tests__/pulse-alerta-texto.test.ts`,
`docs/how-to/usar-o-pulse.md`, `docs/TASKS.md`

**Consome da Task 3:** as seis exportações listadas ali.

### Passo 4.1 — `pulse-alerta-texto.ts`

Nomear o vendedor quando o payload o trouxer. Dentro de `textoAlerta`, acrescentar após a linha do
`valor`:

```ts
  // Nome congelado no payload pelo coletor. Vendedor visto pela primeira vez no tier quente ainda
  // não tem linha em `pulse_vendedores` (o passo de vendedores só roda no tier completo), então o
  // fallback pelo id é o caso normal, não a exceção.
  const quem = typeof payload.nickname === 'string' && payload.nickname.trim()
    ? payload.nickname.trim()
    : (payload.seller_id != null ? `vendedor ${payload.seller_id}` : null);
```

Trocar os dois casos:

```ts
    case 'novo_concorrente': {
      const preco = valor(payload.preco);
      const entrou = quem ? `${quem} entrou em ${titulo}` : `Novo concorrente em ${titulo}`;
      return preco ? `${entrou} a ${preco}` : entrou;
    }
    case 'concorrente_saiu':
      return quem ? `${quem} saiu de ${titulo}` : `Um concorrente saiu de ${titulo}`;
```

Testes a acrescentar em `pulse-alerta-texto.test.ts`:

```ts
it('nomeia o vendedor quando o payload traz nickname', () => {
  expect(textoAlerta(alerta({
    tipo: 'concorrente_saiu', payload: { item_id: 'MLB1', seller_id: 7, nickname: 'LOJA SETE' },
  }))).toBe('LOJA SETE saiu de Aptamil Premium 1');
});

it('cai no seller_id quando não há nickname', () => {
  expect(textoAlerta(alerta({
    tipo: 'concorrente_saiu', payload: { item_id: 'MLB1', seller_id: 7 },
  }))).toBe('vendedor 7 saiu de Aptamil Premium 1');
});

it('mantém o texto genérico sem nickname e sem seller_id', () => {
  expect(textoAlerta(alerta({ tipo: 'concorrente_saiu', payload: {} })))
    .toBe('Um concorrente saiu de Aptamil Premium 1');
});
```

Ajustar o helper `alerta()` desse arquivo de teste para incluir `severidade: 'info'`.

### Passo 4.2 — `aba-alertas.tsx`

Componente novo. Estrutura, com as regras que ele tem de respeitar:

```tsx
// Pulse (ADR-0133): a aba de alertas. Abre em "Ação" — os alertas que mudam decisão de preço.
// Informativo fica a um clique, e nunca disputa a mesma lista.
export function AbaAlertas({
  onVerProduto, onReprecificar,
}: {
  onVerProduto: (produtoId: string) => void;
  onReprecificar: (alerta: PulseAlerta) => void;
}) {
```

- Estado local `severidade: FiltroSeveridade`, inicial `'acao'`.
- `useQuery` para `contarPulseAlertas(severidade)` com `QK.pulseAlertasContagem(severidade)`.
- `useQuery` para `contarPulseAlertas('info')` — necessário para o estado vazio apontar o número.
- `useInfiniteQuery` para a lista, `queryKey: QK.pulseAlertas(severidade, 0)`,
  `queryFn: ({ pageParam = 0 }) => fetchPulseAlertas({ severidade, pagina: pageParam })`,
  `getNextPageParam: (ultima, todas) => (ultima.length < ALERTAS_POR_PAGINA ? undefined : todas.length)`,
  `initialPageParam: 0`.
- `useMutation` de `marcarAlertaLido` e outra de `marcarAlertasLidos(severidade)`; ambas invalidam
  `['pulse','alertas']` no `onSettled`.
- Erro: manter a faixa `role="alert"` do painel atual, texto
  "Não foi possível carregar os alertas." — consulta quebrada nunca pode parecer "nenhum alerta".
- Cabeçalho: `ToggleGroup` com **Ação · Informativo · Todos** e, à direita,
  `Marcar {contagem} como lidos` (desabilitado com contagem 0, sem diálogo de confirmação).
- Linha do alerta: reusar exatamente o layout de `painel-alertas.tsx` — texto por `textoAlerta`,
  `Ver produto` quando há `produto_id`, `Reprecificar` quando `tipo === 'preco_caiu'` e há
  `pulse_produtos.codigo_pai`, e o check de marcar lido com `disabled` só no alerta em voo.
- Rodapé: `Carregar mais` quando `hasNextPage`.
- **Estado vazio de "Ação"** (`EmptyState`), com os dois caminhos explícitos:
  título "Nenhum alerta exige decisão agora";
  descrição citando que movimentos de mercado sem decisão ficam em Informativo;
  ação primária `Ver informativos (N)` que troca o filtro para `'info'`;
  ação secundária que leva ao Radar com o foco `mais_caro` aplicado.
- Estado vazio de "Informativo"/"Todos": `EmptyState` simples, "Nenhum alerta pendente."

### Passo 4.3 — `Pulse.tsx`

1. Linha ~39, a leitura da aba:

```tsx
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'sonar' || tabParam === 'alertas' ? tabParam : 'radar';
```

2. Linha ~121, o `onValueChange` (hoje colapsa tudo que não é `sonar` em `{}`):

```tsx
        onValueChange={(v) => setSearchParams(v === 'radar' ? {} : { tab: v }, { replace: true })}
```

3. `TabsList` ganha a terceira aba com badge da contagem de ação:

```tsx
          <TabsTrigger value="alertas">
            Alertas
            {acaoPendente > 0 && (
              <span className="ml-1.5 rounded-full bg-warning px-1.5 text-xs font-medium text-warning-foreground">
                {acaoPendente}
              </span>
            )}
          </TabsTrigger>
```

com `acaoPendente` vindo de `useQuery({ queryKey: QK.pulseAlertasContagem('acao'), queryFn: () => contarPulseAlertas('acao'), enabled: !!modulos?.includes('pulse') })`.

4. Remover `<PainelAlertas … />` da aba Radar e o import. **Nada entra no lugar** (ADR-0133 D-5).
5. `<TabsContent value="alertas"><AbaAlertas onVerProduto={setDetalheId} onReprecificar={setAlertaReprecificar} /></TabsContent>`.
6. O `actions` do `PageHeader` hoje é `tab === 'radar' ? … : undefined` — continua correto, a aba
   nova não ganha botões de topo.
7. Apagar `painel-alertas.tsx` e seu teste.

### Passo 4.4 — testes em `aba-alertas.test.tsx`

Seguir o padrão do teste removido: mock de `@/lib/pulse` com `importActual`, `QueryClientProvider`
com `retry: false`. Casos obrigatórios:

1. Abre no filtro Ação: a primeira chamada de `fetchPulseAlertas` recebe `{ severidade: 'acao', pagina: 0 }`.
2. Trocar para Informativo refaz a busca com `severidade: 'info'`.
3. O cabeçalho mostra o número de `contarPulseAlertas`, **não** o tamanho da lista: com
   `contarPulseAlertas` devolvendo 145 e a página trazendo 2 alertas, a tela mostra 145.
4. `Marcar N como lidos` chama `marcarAlertasLidos` com a severidade ativa (`'info'` após a troca).
5. Estado vazio de Ação mostra "Ver informativos (N)" e o caminho para o Radar.
6. `fetchPulseAlertas` rejeitando renderiza a faixa `role="alert"` e **não** o estado vazio.

### Passo 4.5 — docs

- `docs/how-to/usar-o-pulse.md`: a aba Alertas, o que cada filtro significa e por que o badge conta
  só ação.
- `docs/TASKS.md`: entrada da entrega.

**Comando e saída esperada:** `pnpm test` inteiro verde; `pnpm lint` sem erros;
`npx tsc -b --force` sem erros.

**Commit:** `feat(pulse): aba Alertas com filtro de severidade e contagem real`

---

## Task 5 — Prova contra dado real

**Arquivo:** nenhum (verificação). Gate obrigatório: mock não basta em feature nova.

1. Rodar uma coleta: botão **Atualizar agora** no Pulse, com `.env.local` copiado no worktree.
2. Conferir por SQL, via Management API, que a severidade gravada bate com a comparação:

```sql
select a.severidade, count(*)
from pulse_alertas a
where a.criado_em > now() - interval '1 hour'
group by 1;

-- Nenhum alerta de ação pode existir sem meu_preco no payload.
select count(*) from pulse_alertas
where severidade = 'acao' and (payload->>'meu_preco') is null;   -- esperado: 0

-- COMPLEMENTO OBRIGATÓRIO da query acima, e o mais importante das três. Sozinha, ela é
-- vacuamente satisfeita: se `meuPreco` regredir para sempre-null, nenhum alerta vira `acao`, e
-- "zero linhas acao" devolve zero violações. Ou seja, a armadilha da ordem do `extrairNossaOferta`
-- (passo 2.3) passaria despercebida justamente pela query que deveria pegá-la.
select count(*) from pulse_alertas
where criado_em > now() - interval '1 hour'
  and (payload->>'meu_preco') is not null;   -- esperado: > 0 em produto que vendemos

-- preco_caiu marcado como acao tem de estar abaixo do preço congelado.
select count(*) from pulse_alertas
where severidade = 'acao' and tipo = 'preco_caiu'
  and (payload->>'para')::numeric >= (payload->>'meu_preco')::numeric;   -- esperado: 0

-- concorrente_saiu marcado como acao: quem saiu tinha de estar abaixo do preço congelado.
-- É o que o `preco` no payload existe para permitir auditar.
select count(*) from pulse_alertas
where severidade = 'acao' and tipo = 'concorrente_saiu'
  and (payload->>'preco')::numeric >= (payload->>'meu_preco')::numeric;  -- esperado: 0
```

3. Conferir na tela: badge com o número da consulta de contagem, filtro trocando a lista, "Marcar N
   como lidos" agindo só sobre o filtro ativo.

**Evidência exigida:** as três contagens acima, coladas no relatório, com os dois zeros esperados.

---

## Autorrevisão do plano (as três checagens da fase Plan)

**(a) Cobertura do spec — cada requisito aponta para uma task.**

| Requisito do spec | Task |
|---|---|
| Coluna `severidade` + índice, backfill por default | 2 |
| Regra de severidade dos 3 tipos + `meu_preco` nulo | 1 |
| `meu_preco` em memória, sem reler o banco | 2 (passo 2.3) |
| `nickname` no select do coletor e congelado no payload | 1 (payload) + 2 (select) |
| Notificação distinguindo severidade | 2 (passo 2.5) |
| `fetchPulseAlertas` paginado, `contarPulseAlertas`, `marcarAlertasLidos` escopado | 3 |
| Chaves de cache por severidade e página | 3 |
| Terceira aba, badge de ação, painel sai do Radar | 4 |
| Estado vazio de Ação com os dois caminhos | 4 (passo 4.2 e teste 5) |
| Texto nomeando o vendedor | 4 (passo 4.1) |
| Testes de `diff`, de componente e de texto | 1, 4 |
| Docs: modelo-de-dados, edge-functions, usar-o-pulse, TASKS | 2, 4 |

**Lacunas encontradas e resolvidas:** duas. (i) O spec prometia deep-link `?tab=alertas` na
notificação — impossível, a tabela `notificacoes` não tem campo de link; virou texto, registrado no
topo deste plano. (ii) O spec não dizia de onde o `nickname` chega ao `diff.ts`, que só recebe
ofertas; resolvido com `OpcoesDiff.nicknames`, um `Map` por `seller_id`, em vez de poluir
`OfertaColetada` com um campo que não vem da ficha do ML.

**Uma armadilha de ordem encontrada na leitura do coletor:** `extrairNossaOferta` hoje roda **depois**
do `alertasPendentes.push`. Sem mover a chamada para antes, `meuPreco` chegaria sempre `null` e
**todo alerta nasceria `info`** — a feature inteira falharia em silêncio, com os testes unitários
passando. Está explícito no passo 2.3.

**(b) Varredura de placeholders:** nenhum "TBD", "TODO", "tratar erros apropriadamente" ou "similar à
Task N". Todo código aparece por extenso; os testes trazem asserção real, não descrição.

**(c) Consistência de tipos e assinaturas entre tasks:** `SeveridadeAlerta` é declarado duas vezes de
propósito — uma em `_shared/pulse/tipos.ts` (Deno) e outra em `src/lib/pulse.ts` (browser). Os dois
runtimes não se importam (é o motivo de `_shared` ter área própria no Graphify), e o valor é o mesmo
literal `'acao' | 'info'`, travado no banco pelo `check`. `OpcoesDiff` (Task 1) é consumido só pela
Task 2, com os três campos batendo. As seis exportações que a Task 4 consome da Task 3 estão listadas
com nome exato em ambas.
