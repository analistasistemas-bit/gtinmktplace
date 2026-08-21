# Concorrentes Relevantes no Pulse e na Viabilidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer Pulse e Viabilidade ignorarem ofertas comercialmente irrelevantes nos cálculos, preservando-as como mercado observado e explicando sua classificação.

**Architecture:** Um módulo TypeScript puro em `supabase/functions/_shared/concorrencia/qualificacao.ts` será importado tanto pelas Edge Functions quanto pelo frontend e será a única implementação da regra. O Pulse classificará snapshots persistidos; a Viabilidade reutilizará snapshots com até 24 horas e preencherá lacunas pela API do Mercado Livre com cache e concorrência limitada.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, Supabase/PostgreSQL, Supabase Edge Functions/Deno, Redis/Upstash, API Mercado Livre.

**Spec:** `docs/superpowers/specs/2026-08-20-concorrentes-relevantes-pulse-viabilidade-design.md`

## Global Constraints

- Corte fixo: pelo menos 10 transações; zero visitas medidas reprova; visita `null` não reprova; reputação `1_red` ou `2_orange` reprova.
- `transactions_total = null` produz `observacao`; reputação ausente não reprova.
- Nunca usar o menor preço observado como fallback financeiro.
- Mercado observado permanece armazenado e auditável; nenhuma oferta é apagada.
- Pulse e Viabilidade devem importar a mesma função de qualificação.
- Snapshots do Pulse só podem ser reutilizados pela Viabilidade com correspondência segura de organização/produto e idade máxima de 24 horas.
- Cache público nunca contém token; falhas de API permanecem `null`, nunca viram zero.
- Não adicionar dependências.
- Toda consulta a tabelas multi-tenant no backend inclui `org_id` explícito.

---

## File Structure

- `supabase/functions/_shared/concorrencia/qualificacao.ts`: regra pura e agregação observado/relevante; compartilhada por Deno e Vite.
- `supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts`: limites e agregação da regra.
- `supabase/functions/_shared/ml/perfil-vendedor.ts`: normalização de `/users/{id}` e cache v2 de 24 horas.
- `supabase/functions/_shared/ml/__tests__/perfil-vendedor.test.ts`: contrato aninhado da API e falhas.
- `supabase/functions/_shared/ml/visitas-item.ts`: consulta/cache de visitas 30d para uso sob demanda.
- `supabase/migrations/20260821003000_pulse_qualificacao_vendedor.sql`: detalhe/timestamp do perfil e timestamp de visitas.
- `supabase/functions/pulse-coletar/processar.ts`: persistência normalizada, atualização por idade e alertas relevantes.
- `supabase/functions/_shared/pulse/vendedor.ts`: decisão pura de gravação do snapshot.
- `supabase/functions/_shared/concorrencia/tipos.ts`: detalhes por oferta necessários à qualificação.
- `supabase/functions/_shared/concorrencia/parse.ts`: preserva item, frete e logística por oferta.
- `src/lib/pulse.ts`: contratos do front e carregamento dos snapshots enriquecidos.
- `src/lib/pulse-margem.ts`: montagem do mercado observado/relevante no Pulse.
- `src/pages/Pulse.tsx`: KPIs e filtros baseados no mercado relevante.
- `src/components/pulse/dialog-detalhe.tsx`: badges, motivos, contagens e alternância de ofertas.
- `src/components/pulse/tabela-radar.tsx`: menor relevante e posição.
- `supabase/functions/analisar-viabilidade/index.ts`: qualificação e cálculo sob demanda.
- `supabase/functions/_shared/analise/tipos.ts`: contrato de mercado observado/relevante no servidor.
- `src/lib/viabilidade.ts`: espelho do contrato para o navegador.
- `src/pages/Viabilidade.tsx`: cabeçalhos corretos.
- `src/components/viabilidade-linha.tsx`: estado sem relevante e valores observados separados.

---

### Task 1: Classificador e agregador compartilhados

**Files:**
- Create: `supabase/functions/_shared/concorrencia/qualificacao.ts`
- Create: `supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts`

**Interfaces:**
- Consumes: dados normalizados de oferta e vendedor.
- Produces: `qualificarOferta(dados): QualificacaoOferta` e `resumirMercadoQualificado(ofertas): MercadoQualificado`.

O frontend importará este módulo puro por
`../../supabase/functions/_shared/concorrencia/qualificacao.ts`; ele não poderá importar APIs de
Deno, Redis ou Supabase.

- [ ] **Step 1: Escrever testes falhando para os limites da classificação**

```ts
import { describe, expect, it } from 'vitest';
import { qualificarOferta, resumirMercadoQualificado } from '../qualificacao.ts';

const base = {
  item_id: 'MLB1', seller_id: 1, preco: 70.19,
  frete_gratis: false, full: false,
  transactions_total: 10, visitas_30d: 1, nivel: '3_yellow',
};

describe('qualificarOferta', () => {
  it('qualifica exatamente 10 transações', () => {
    expect(qualificarOferta(base)).toEqual({ status: 'relevante', motivos: ['QUALIFICADO'] });
  });
  it('reprova 9 transações', () => {
    expect(qualificarOferta({ ...base, transactions_total: 9 })).toEqual({
      status: 'fora_referencia', motivos: ['POUCAS_TRANSACOES'],
    });
  });
  it('reprova zero visitas e aceita visitas não medidas', () => {
    expect(qualificarOferta({ ...base, visitas_30d: 0 }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, visitas_30d: null }).status).toBe('relevante');
  });
  it('reprova vermelho/laranja e aceita reputação ausente', () => {
    expect(qualificarOferta({ ...base, nivel: '1_red' }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, nivel: '2_orange' }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, nivel: null }).status).toBe('relevante');
  });
  it('mantém transações ausentes em observação', () => {
    expect(qualificarOferta({ ...base, transactions_total: null })).toEqual({
      status: 'observacao', motivos: ['DADOS_INSUFICIENTES'],
    });
  });
});
```

- [ ] **Step 2: Executar os testes e confirmar falha por módulo ausente**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts`

Expected: FAIL porque `qualificacao.ts` ainda não existe.

- [ ] **Step 3: Implementar tipos e regra determinística mínima**

```ts
export const MIN_TRANSACOES_RELEVANTE = 10;
export type MotivoQualificacao = 'QUALIFICADO' | 'DADOS_INSUFIENTES' |
  'POUCAS_TRANSACOES' | 'SEM_VISITAS_30D' | 'REPUTACAO_BAIXA';
export type StatusQualificacao = 'relevante' | 'observacao' | 'fora_referencia';

export interface OfertaQualificavel {
  item_id: string; seller_id: number; preco: number;
  frete_gratis: boolean; full: boolean;
  transactions_total: number | null; visitas_30d: number | null; nivel: string | null;
}
export interface QualificacaoOferta { status: StatusQualificacao; motivos: MotivoQualificacao[] }
export interface OfertaClassificada extends OfertaQualificavel { qualificacao: QualificacaoOferta }
export interface MercadoQualificado {
  ofertas: OfertaClassificada[];
  menor_observado: number | null; menor_relevante: number | null; maior_relevante: number | null;
  total_observadas: number; total_relevantes: number;
  vendedores_observados: number; vendedores_relevantes: number;
  frete_gratis_relevantes: number; full_relevantes: number;
}

export function qualificarOferta(d: OfertaQualificavel): QualificacaoOferta {
  const motivos: MotivoQualificacao[] = [];
  if (d.transactions_total != null && d.transactions_total < MIN_TRANSACOES_RELEVANTE) motivos.push('POUCAS_TRANSACOES');
  if (d.visitas_30d === 0) motivos.push('SEM_VISITAS_30D');
  if (d.nivel === '1_red' || d.nivel === '2_orange') motivos.push('REPUTACAO_BAIXA');
  if (motivos.length) return { status: 'fora_referencia', motivos };
  if (d.transactions_total == null) return { status: 'observacao', motivos: ['DADOS_INSUFICIENTES'] };
  return { status: 'relevante', motivos: ['QUALIFICADO'] };
}
```

Implementar `resumirMercadoQualificado` retornando ofertas classificadas, mínimos observado/relevante, máximo relevante, vendedores distintos, frete grátis e FULL somente dos relevantes.

- [ ] **Step 4: Acrescentar cenário Aptamil ao agregador**

```ts
it('separa R$36 observado de R$70,19 relevante', () => {
  const r = resumirMercadoQualificado([
    { ...base, item_id: 'MLB36', preco: 36, transactions_total: 0, visitas_30d: 19 },
    { ...base, item_id: 'MLB70', preco: 70.19, transactions_total: 10, visitas_30d: 1 },
  ]);
  expect(r.menor_observado).toBe(36);
  expect(r.menor_relevante).toBe(70.19);
  expect(r.total_observadas).toBe(2);
  expect(r.total_relevantes).toBe(1);
});
```

- [ ] **Step 5: Executar teste focalizado e commit**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts`

Expected: PASS.

```bash
rtk git add supabase/functions/_shared/concorrencia/qualificacao.ts supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts
rtk git commit -m "feat: classificar concorrentes relevantes"
```

---

### Task 2: Persistência dos detalhes de reputação e frescor

**Files:**
- Create: `supabase/migrations/20260821003000_pulse_qualificacao_vendedor.sql`
- Modify: `docs/reference/modelo-de-dados.md`

**Interfaces:**
- Consumes: tabelas `pulse_vendedores` e `pulse_ofertas` existentes.
- Produces: `reputacao_detalhe jsonb`, `perfil_coletado_em timestamptz`, `visitas_30d_em timestamptz` e view atualizada.

- [ ] **Step 1: Gerar migration pelo CLI e inserir SQL aditivo**

Run: `rtk supabase migration new pulse_qualificacao_vendedor`

Usar o timestamp gerado no nome indicado em **Files** e aplicar:

```sql
alter table public.pulse_vendedores
  add column if not exists reputacao_detalhe jsonb,
  add column if not exists perfil_coletado_em timestamptz;

alter table public.pulse_ofertas
  add column if not exists visitas_30d_em timestamptz;

comment on column public.pulse_vendedores.reputacao_detalhe is
  'Perfil público normalizado do vendedor: período/transações, avaliações e métricas do ML.';
comment on column public.pulse_vendedores.perfil_coletado_em is
  'Instante exato da leitura de /users/{seller_id}; null = snapshot legado.';
comment on column public.pulse_ofertas.visitas_30d_em is
  'Instante da leitura de visitas 30d; null = nunca medido ou snapshot legado.';

create or replace view public.pulse_ofertas_atual with (security_invoker = true) as
  select distinct on (produto_id, item_id)
    id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis,
    loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em
  from public.pulse_ofertas
  order by produto_id, item_id, dia desc;

grant select on public.pulse_ofertas_atual to authenticated;
```

- [ ] **Step 2: Atualizar a referência do modelo de dados**

Documentar que `reputacao_detalhe` é normalizado, que os timestamps controlam a janela de 24 horas e que `null` permanece diferente de zero.

- [ ] **Step 3: Validar migration localmente**

Run: `rtk pnpm run db:check`

Expected: PASS, sem DDL fora de migration e sem view sem `security_invoker`.

- [ ] **Step 4: Fazer dry-run vinculado sem aplicar produção**

Run: `rtk supabase db push --linked --dry-run --yes`

Expected: somente a nova migration pendente.

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/migrations docs/reference/modelo-de-dados.md
rtk git commit -m "feat: armazenar qualificação dos vendedores do Pulse"
```

---

### Task 3: Normalizador e cache v2 do perfil do vendedor

**Files:**
- Create: `supabase/functions/_shared/ml/perfil-vendedor.ts`
- Create: `supabase/functions/_shared/ml/__tests__/perfil-vendedor.test.ts`
- Modify: `supabase/functions/_shared/ml/mercado.ts`
- Modify: `supabase/functions/_shared/ml/mercado-agregar.ts`
- Modify: `supabase/functions/_shared/preco/piso-lider.ts`

**Interfaces:**
- Consumes: payload desconhecido de `GET /users/{seller_id}`.
- Produces: `PerfilVendedor | null`, `normalizarPerfilVendedor(json)` e `buscarPerfilVendedor(token, sellerId)` com cache `cache:seller:v2:{id}` por 24h.

- [ ] **Step 1: Escrever teste do contrato aninhado e da falha honesta**

```ts
import { describe, expect, it } from 'vitest';
import { normalizarPerfilVendedor } from '../perfil-vendedor.ts';

it('normaliza seller_reputation aninhada', () => {
  const perfil = normalizarPerfilVendedor({
    id: 123, nickname: 'LOJA',
    seller_reputation: {
      level_id: '5_green', power_seller_status: 'platinum',
      transactions: {
        period: '60 days', total: 120, completed: 118, canceled: 2,
        ratings: { positive: 0.98, neutral: 0.01, negative: 0.01 },
      },
      metrics: { claims: { rate: 0.01, value: 1 } },
    },
  });
  expect(perfil?.nivel).toBe('5_green');
  expect(perfil?.power_seller).toBe('platinum');
  expect(perfil?.transactions_total).toBe(120);
  expect(perfil?.detalhe.transactions.period).toBe('60 days');
});

it('não converte payload inválido em vendedor com zero vendas', () => {
  expect(normalizarPerfilVendedor(null)).toBeNull();
  expect(normalizarPerfilVendedor({ seller_reputation: {} })).toBeNull();
});
```

- [ ] **Step 2: Confirmar falha e implementar o normalizador defensivo**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/perfil-vendedor.test.ts`

Expected antes da implementação: FAIL por módulo ausente. Depois, criar tipos explícitos e aceitar somente `transactions.total` numérico.

- [ ] **Step 3: Implementar cache versionado sem negativo falso**

```ts
const TTL_PERFIL = 60 * 60 * 24;

export async function buscarPerfilVendedor(token: string, sellerId: number): Promise<PerfilVendedor | null> {
  const chave = `cache:seller:v2:${sellerId}`;
  const cache = await redisGet(chave).catch(() => null);
  if (cache) {
    const salvo = validarPerfilVendedor(JSON.parse(cache));
    if (salvo) return salvo;
  }
  const resposta = await mlGetJson(`/users/${sellerId}`, token);
  const perfil = normalizarPerfilVendedor(resposta);
  if (perfil) await redisSet(chave, JSON.stringify(perfil), TTL_PERFIL).catch(() => undefined);
  return perfil;
}
```

Definir no mesmo módulo:

```ts
export interface PerfilVendedor {
  seller_id: number; nickname: string | null; nivel: string | null; power_seller: string | null;
  transactions_total: number; uf: string | null;
  detalhe: {
    transactions: {
      period: string | null; total: number; completed: number | null; canceled: number | null;
      ratings: { positive: number | null; neutral: number | null; negative: number | null };
    };
    metrics: Record<string, unknown>;
  };
}

export function validarPerfilVendedor(valor: unknown): PerfilVendedor | null;
```

`mlGetJson` será uma função privada deste módulo: URL base oficial, `Authorization: Bearer`, timeout
de 15 segundos e retorno `null` para resposta não OK.

Manter `reputacaoVendedor` como adaptador compatível que devolve `{ lider, vendas }` a partir do perfil v2. Se o perfil for `null`, o adaptador lança/retorna ausência ao caller; callers resilientes já usam `catch`.

- [ ] **Step 4: Atualizar consumidores e executar regressões**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/perfil-vendedor.test.ts supabase/functions/_shared/preco/__tests__/piso-lider.test.ts`

Expected: PASS; reâncora MercadoLíder mantém comportamento anterior.

- [ ] **Step 5: Verificar Deno e commit**

Run: `rtk pnpm run check:functions`

```bash
rtk git add supabase/functions/_shared/ml supabase/functions/_shared/preco/piso-lider.ts
rtk git commit -m "fix: normalizar reputacao aninhada do Mercado Livre"
```

---

### Task 4: Enriquecer ofertas e coleta do Pulse

**Files:**
- Modify: `supabase/functions/_shared/concorrencia/tipos.ts`
- Modify: `supabase/functions/_shared/concorrencia/parse.ts`
- Modify: `supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`
- Create: `supabase/functions/_shared/ml/visitas-item.ts`
- Create: `supabase/functions/_shared/ml/__tests__/visitas-item.test.ts`
- Modify: `supabase/functions/_shared/pulse/vendedor.ts`
- Modify: `supabase/functions/_shared/pulse/__tests__/vendedor.test.ts`
- Modify: `supabase/functions/pulse-coletar/processar.ts`

**Interfaces:**
- Consumes: `PerfilVendedor | null` da Task 3.
- Produces: `OfertaVendedor` com `item_id`, `frete_gratis` e `full`; snapshots com timestamps; `buscarVisitas30d` cacheado.

- [ ] **Step 1: Fazer o parser preservar os campos por oferta**

Alterar o contrato para:

```ts
export interface OfertaVendedor {
  item_id: string | null;
  seller_id: number | null;
  preco: number | null;
  frete_gratis: boolean;
  full: boolean;
}
```

Adicionar ao teste de `parseItensProduto` uma oferta com `item_id`, frete grátis e `logistic_type='fulfillment'` e verificar os quatro campos.

- [ ] **Step 2: Implementar consulta/cache de visitas**

Criar `buscarVisitas30d(token, itemId): Promise<number | null>` usando
`/items/${itemId}/visits/time_window?last=30&unit=day`, cache
`cache:item-visits30d:v1:${itemId}` e TTL de 6 horas. Somente resposta com `total` numérico é cacheada;
zero é válido e `null` representa falha.

- [ ] **Step 3: Atualizar a decisão de persistência do vendedor**

```ts
export function deveGravarVendedor(
  anterior: { transactions_total: number | null; uf?: string | null; perfil_coletado_em?: string | null } | null,
  atual: { transactions_total: number | null; uf: string | null },
  agoraMs: number,
): boolean {
  if (!anterior) return true;
  if (anterior.transactions_total !== atual.transactions_total || anterior.uf !== atual.uf) return true;
  const coletado = anterior.perfil_coletado_em ? Date.parse(anterior.perfil_coletado_em) : Number.NaN;
  return !Number.isFinite(coletado) || agoraMs - coletado >= 24 * 60 * 60 * 1000;
}
```

Cobrir perfil legado sem timestamp, 23h59 e 24h exatas.

- [ ] **Step 4: Usar perfil normalizado no `pulse-coletar`**

No passo de vendedores, substituir o cast ad hoc por `buscarPerfilVendedor`; persistir `nivel`,
`power_seller`, `transactions_total`, `reputacao_detalhe` e `perfil_coletado_em`. No passo de visitas,
preencher `visitas_30d_em` junto de `visitas_30d`. Não gravar zeros para falhas.

- [ ] **Step 5: Executar testes, check e commit**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/concorrencia/__tests__/parse.test.ts supabase/functions/_shared/ml/__tests__/visitas-item.test.ts supabase/functions/_shared/pulse/__tests__/vendedor.test.ts`

Run: `rtk pnpm run check:functions`

Expected: PASS.

```bash
rtk git add supabase/functions/_shared supabase/functions/pulse-coletar/processar.ts
rtk git commit -m "feat: enriquecer ofertas e perfis do Pulse"
```

---

### Task 5: Aplicar mercado relevante aos cálculos e alertas do Pulse

**Files:**
- Modify: `src/lib/pulse.ts`
- Modify: `src/lib/pulse-margem.ts`
- Modify: `src/lib/__tests__/pulse-margem.test.ts`
- Modify: `src/lib/pulse-filtros.ts`
- Modify: `src/lib/__tests__/pulse-filtros.test.ts`
- Modify: `supabase/functions/_shared/pulse/diff.ts`
- Modify: `supabase/functions/_shared/pulse/__tests__/diff.test.ts`
- Modify: `supabase/functions/pulse-coletar/processar.ts`

**Interfaces:**
- Consumes: `qualificarOferta` e `resumirMercadoQualificado` da Task 1; snapshots das Tasks 2–4.
- Produces: `mercadoPulse(ofertas, vendedores): MercadoQualificado`; alertas somente de relevantes.

- [ ] **Step 1: Escrever teste de junção oferta-vendedor e resumo**

Adicionar em `pulse-margem.test.ts`:

```ts
it('usa R$70,19 como menor relevante e preserva R$36 observado', () => {
  const mercado = mercadoPulse([
    oferta({ item_id: 'MLB36', seller_id: 1, preco: 36, visitas_30d: 19 }),
    oferta({ item_id: 'MLB70', seller_id: 2, preco: 70.19, visitas_30d: 1 }),
  ], [
    vendedor({ seller_id: 1, transactions_total: 0 }),
    vendedor({ seller_id: 2, transactions_total: 10, nivel: '3_yellow' }),
  ]);
  expect(mercado.menor_observado).toBe(36);
  expect(mercado.menor_relevante).toBe(70.19);
});
```

- [ ] **Step 2: Estender contratos e selects do Pulse**

Adicionar `visitas_30d_em` em `PulseOferta` e `reputacao_detalhe`/`perfil_coletado_em` em
`PulseVendedor`; incluir as colunas nos selects de `fetchPulseDetalhe` e no carregamento resumido.
Deduplicar vendedor pelo snapshot mais recente antes da junção.

- [ ] **Step 3: Fazer KPIs e filtros consumirem somente o menor relevante**

`fetchPulseResumoOfertas` deve devolver, por produto, mercado observado e relevante. Atualizar
`filtrarProdutos`/`contarPulse` para que “mais caro”, “menor preço” e posição usem
`menor_relevante`; produto sem relevante fica sem comparação, não como preço zero.

- [ ] **Step 4: Filtrar alertas antes de `diffOfertas`**

Mover a geração dos alertas para depois da atualização de perfis e visitas na execução. Criar entrada
de diff a partir de ofertas qualificadas. Testar que entrada/queda/saída de uma oferta fora da
referência não gera alerta e que a mesma mudança em oferta relevante continua gerando.

- [ ] **Step 5: Executar testes e commit**

Run: `rtk pnpm exec vitest run src/lib/__tests__/pulse-margem.test.ts src/lib/__tests__/pulse-filtros.test.ts supabase/functions/_shared/pulse/__tests__/diff.test.ts`

Expected: PASS.

```bash
rtk git add src/lib/pulse.ts src/lib/pulse-margem.ts src/lib/pulse-filtros.ts src/lib/__tests__ supabase/functions/_shared/pulse supabase/functions/pulse-coletar/processar.ts
rtk git commit -m "feat: usar concorrentes relevantes no Pulse"
```

---

### Task 6: Mostrar qualificação e mercado observado no Pulse

**Files:**
- Modify: `src/pages/Pulse.tsx`
- Modify: `src/components/pulse/tabela-radar.tsx`
- Modify: `src/components/pulse/dialog-detalhe.tsx`
- Modify: `src/components/pulse/__tests__/dialog-detalhe.test.tsx`
- Modify: `src/lib/pulse-formato.ts`
- Modify: `src/lib/__tests__/pulse-formato.test.ts`

**Interfaces:**
- Consumes: `MercadoQualificado` e ofertas classificadas da Task 5.
- Produces: resumo relevante/observado, filtro padrão e badges explicativos.

- [ ] **Step 1: Escrever teste de interface para os dois preços**

```tsx
expect(await screen.findByText('Menor concorrente relevante')).toBeInTheDocument();
expect(screen.getByText('R$ 70,19')).toBeInTheDocument();
expect(screen.getByText(/Menor oferta observada: R\$ 36,00/)).toBeInTheDocument();
expect(screen.getByText('1 relevante de 2 observadas')).toBeInTheDocument();
expect(screen.getByText('Fora da referência')).toBeInTheDocument();
expect(screen.getByText('Poucas transações')).toBeInTheDocument();
```

- [ ] **Step 2: Adicionar formatadores de reputação e motivos**

Mapear `5_green`, `4_light_green`, `3_yellow`, `2_orange`, `1_red` e `null` para rótulos explícitos.
Mapear os cinco códigos de motivo definidos na Task 1; não usar texto vindo da API.

- [ ] **Step 3: Atualizar tabela principal e diálogo**

Exibir menor relevante na tabela Radar. No diálogo, mostrar contagens, menor observado separado,
colunas Qualificação/Reputação/MercadoLíder e filtro local com padrão `relevantes`. No detalhe ou
tooltip da reputação, exibir período/transações, avaliações e métricas disponíveis de reclamações,
atrasos e cancelamentos, sempre com rótulo de dado da conta. A opção `todas` deve mostrar observação
e fora da referência sem mudar os cálculos do cabeçalho.

- [ ] **Step 4: Cobrir produto sem relevante**

Adicionar fixture em que todas as ofertas falham. Esperar “Sem concorrente relevante”, menor
observado visível e posição/percentual ausentes.

- [ ] **Step 5: Testes e commit**

Run: `rtk pnpm exec vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx src/lib/__tests__/pulse-formato.test.ts src/lib/__tests__/pulse-filtros.test.ts`

Expected: PASS.

```bash
rtk git add src/pages/Pulse.tsx src/components/pulse src/lib/pulse-formato.ts src/lib/__tests__
rtk git commit -m "feat: explicar concorrentes relevantes no Radar"
```

---

### Task 7: Qualificar o mercado na Análise de Viabilidade

**Files:**
- Modify: `supabase/functions/_shared/analise/tipos.ts`
- Create: `supabase/functions/_shared/analise/mercado-relevante.ts`
- Create: `supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts`
- Modify: `supabase/functions/analisar-viabilidade/index.ts`
- Modify: `src/lib/viabilidade.ts`
- Modify: `src/lib/__tests__/analise-viabilidade.test.ts`
- Modify: `src/pages/Viabilidade.tsx`
- Modify: `src/components/viabilidade-linha.tsx`
- Create: `src/components/__tests__/viabilidade-linha-mercado.test.tsx`

**Interfaces:**
- Consumes: detalhes de ofertas da Task 4, perfil/cache da Task 3, visitas/cache da Task 4 e classificador da Task 1.
- Produces: `Mercado` relevante com `observado`; nenhuma taxa derivada quando `menor === null`.

- [ ] **Step 1: Definir contrato servidor/navegador**

```ts
export interface MercadoObservado {
  menor: number | null; maior: number | null;
  vendedores: number; ofertas: number;
}
export interface Mercado {
  menor: number | null; maior: number | null;
  vendedores: number; freteGratis: number; full: number;
  ofertas: number;
  observado: MercadoObservado;
}
```

Espelhar exatamente o contrato em `_shared/analise/tipos.ts` e `src/lib/viabilidade.ts`.

- [ ] **Step 2: Escrever teste do resolvedor de mercado**

Injetar funções `buscarPerfil` e `buscarVisitas` no resolvedor para testar sem rede. Cobrir:

```ts
expect(resultado.menor).toBe(70.19);
expect(resultado.observado.menor).toBe(36);
expect(resultado.vendedores).toBe(1);
expect(resultado.observado.vendedores).toBe(2);
```

Adicionar caso em que todas falham e esperar `menor: null` com observado preservado.

- [ ] **Step 3: Implementar reuso seguro e preenchimento de lacunas**

Em `mercado-relevante.ts`, buscar snapshot Pulse com:

```ts
db.from('pulse_produtos')
  .select('id, ultimo_snapshot_em')
  .eq('org_id', orgId)
  .eq('catalog_product_id', productId)
  .maybeSingle();
```

Aceitar somente `ultimo_snapshot_em >= agora - 24h`; consultar ofertas/vendedores sempre com
`.eq('org_id', orgId)`. Para item/perfil ausente ou vencido, deduplicar `seller_id`, usar
`buscarPerfilVendedor` uma vez por vendedor e `buscarVisitas30d` uma vez por item, ambos em pool
limitado a 6. Classificar todas as ofertas para produzir contagens exatas.

- [ ] **Step 4: Mover os cálculos para depois da qualificação**

Em `analisarItem`, manter `existeNoML: true` quando o produto existe mesmo sem relevante. Buscar
listing price e frete apenas se `mercado.menor != null`. Sem relevante, omitir `classico`, `premium`
e `frete`; nunca chamar essas APIs com preço observado.

- [ ] **Step 5: Atualizar interface e impedir `R$ 0,00`**

Renomear cabeçalho para `Menor relevante`; mostrar `${mercado.vendedores} de ${mercado.observado.vendedores}`.
Quando `menor` for `null`, renderizar “Sem concorrente relevante”, travessões nos derivados e o menor
observado no detalhe. Remover `fmtBRL(item.mercado!.menor ?? 0)` deste fluxo.

- [ ] **Step 6: Executar testes, checks e commit**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts src/lib/__tests__/analise-viabilidade.test.ts src/components/__tests__/viabilidade-linha-mercado.test.tsx src/components/__tests__/viabilidade-linha-cadastrar.test.tsx`

Run: `rtk pnpm run check:functions`

Expected: PASS.

```bash
rtk git add supabase/functions/_shared/analise supabase/functions/analisar-viabilidade src/lib/viabilidade.ts src/lib/__tests__/analise-viabilidade.test.ts src/pages/Viabilidade.tsx src/components/viabilidade-linha.tsx src/components/__tests__
rtk git commit -m "feat: usar mercado relevante na Viabilidade"
```

---

### Task 8: Verificação integrada, documentação e preparação do deploy

**Files:**
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/reference/glossario.md`
- Modify: `docs/project-status.md`
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes: todas as tarefas anteriores.
- Produces: evidência de consistência, documentação operacional e sequência segura de implantação.

- [ ] **Step 1: Executar a suíte focalizada completa**

Run:

```bash
rtk pnpm exec vitest run \
  supabase/functions/_shared/concorrencia/__tests__/qualificacao.test.ts \
  supabase/functions/_shared/concorrencia/__tests__/parse.test.ts \
  supabase/functions/_shared/ml/__tests__/perfil-vendedor.test.ts \
  supabase/functions/_shared/ml/__tests__/visitas-item.test.ts \
  supabase/functions/_shared/pulse/__tests__/vendedor.test.ts \
  supabase/functions/_shared/pulse/__tests__/diff.test.ts \
  supabase/functions/_shared/analise/__tests__/mercado-relevante.test.ts \
  src/lib/__tests__/pulse-margem.test.ts \
  src/lib/__tests__/pulse-filtros.test.ts \
  src/lib/__tests__/pulse-formato.test.ts \
  src/lib/__tests__/analise-viabilidade.test.ts \
  src/components/pulse/__tests__/dialog-detalhe.test.tsx \
  src/components/__tests__/viabilidade-linha-mercado.test.tsx
```

Expected: todos PASS.

- [ ] **Step 2: Executar verificações estruturais**

Run: `rtk pnpm run db:check`

Run: `rtk pnpm run check:functions`

Run: `rtk pnpm run build`

Expected: todos com exit code 0.

- [ ] **Step 3: Atualizar documentação**

Registrar regra fixa, semântica de `null`, cache de 24h, ausência de fallback bruto e contratos de
Pulse/Viabilidade. Marcar a entrega no status e nas tarefas sem declarar deploy ainda não executado.

- [ ] **Step 4: Fazer revisão final do diff**

Run: `rtk git diff --check`

Run: `rtk git status --short`

Confirmar: nenhum segredo, nenhuma mutação de dados de tenant, nenhum cálculo usa preço observado e
nenhuma cópia adicional da regra existe fora de `qualificacao.ts`.

- [ ] **Step 5: Commit de documentação**

```bash
rtk git add docs/reference docs/project-status.md docs/TASKS.md
rtk git commit -m "docs: registrar mercado relevante no Pulse e Viabilidade"
```

- [ ] **Step 6: Implantar somente após autorização explícita**

Ordem operacional:

```bash
rtk supabase db push --linked --dry-run --yes
rtk supabase db push --linked --yes
rtk supabase functions deploy pulse-coletar --no-verify-jwt
rtk supabase functions deploy analisar-viabilidade
rtk git push origin HEAD
```

Depois do deploy, executar uma coleta Pulse e analisar o GTIN `7891025111825` na Viabilidade.
Critério: R$ 36,00 observado, R$ 70,19 relevante, 28/90 no snapshot de referência e nenhum cálculo
quando o conjunto relevante estiver vazio. O deploy do frontend seguirá o mecanismo já configurado
no repositório após o push da branch integrada.

---

## Execution Notes

- Use `apply_patch` para todas as edições manuais.
- Prefixe todos os comandos de shell com `rtk`.
- Preserve alterações não relacionadas encontradas no worktree.
- Cada tarefa passa por revisão de conformidade com a spec antes da revisão de qualidade.
- Não faça deploy, push ou merge sem autorização explícita do usuário na etapa correspondente.
