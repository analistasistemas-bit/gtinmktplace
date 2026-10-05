# Redesenho premium do módulo Ads — plano de implementação revisado

> **Execução:** usar `superpowers:executing-plans`, tarefa por tarefa, acompanhando os checkboxes. Cada commit deve passar em `pnpm build`.
>
> **Status:** plano reescrito após leitura da revisão do Opus e conferência do código atual. Trabalho somente leitura: nenhum arquivo alterado; builds, testes e validação visual da implementação ainda não executados.

**Objetivo:** tornar imediata a leitura de **quanto foi gasto, quanto sobrou após Ads e quais famílias precisam de atenção**, acrescentando **Mês atual** sem alterar os contratos financeiros.

**Arquitetura:** preservar `montarPainelAds`, `fimDiasAds` e os contratos de vendas. Resolver o período no hook, acrescentar o quarto botão diretamente em `Ads.tsx` e reorganizar os componentes existentes com detalhes expansíveis. As contagens são filtros locais derivados dos semáforos existentes.

**Stack:** React 18, TypeScript, Tailwind 4, TanStack Query, componentes UI existentes, Lucide, Vitest e Testing Library. Nenhuma dependência nova.

**Referências:** [ADR-0179](../../decisions/0179-painel-de-ads.md), [spec do painel](../specs/2026-10-04-painel-de-ads-design.md) e revisão em `/Users/diego/.claude/jobs/c9eb53e2/tmp/opus_review_ui.md`.

**Estimativa:** 4–5 horas, incluindo testes direcionados, builds por commit e validação visual.

## 1. Base conferida e limites

### 1.1 Evidências do código atual

| Local | Contrato confirmado |
|---|---|
| `src/pages/Ads.tsx` | Presets locais 7/30/90; preferência na chave `ads-painel-dias`; chamada atual `useAdsPainel(dias)`. |
| `src/hooks/useAdsPainel.ts` | Sync precede as consultas financeiras; Ads e vendas usam o mesmo intervalo; montagem depende também de catálogo e códigos. |
| `src/lib/ads-painel-dados.ts` | `DiasAds = 7 \| 30 \| 90`; `periodoAds`, `janelaBRT`, `lucroPorFamilia` e RPC existentes. |
| `src/lib/ads-painel.ts` | Semáforo ligado; valores conciliados em centavos; resultado desconhecido é `null`; `conta.fonteCusto === null` identifica histórico insuficiente. |
| `src/lib/sku-ads.ts` | `fimDiasAds` termina ontem ou anteontem; o recuo adicional é limitado a um dia. |

| Componente ou teste | Consequência para a implementação |
|---|---|
| `src/components/ads/resumo-conta.tsx` | Já apresenta selo provisório, marca de custo e divergência; essas informações devem permanecer visíveis após a compactação. |
| `src/components/ads/ranking-familias.tsx` | Hoje mistura oito colunas, cartões completos e gastos compartilhados. Separar detalhes sem eliminar informações. |
| `src/components/ui/page-header.tsx` | Já possui `actions: ReactNode`; não precisa mudar. |
| `src/components/ui/section.tsx` | Já produz `h2.text-h3`; não aceita `aria-label`. Nomear o contêiner externo quando necessário. |
| `src/components/ui/kpi-card.tsx` | Já possui `size="compact"`, `onClick`, `ativo`, suporte a teclado e `aria-pressed`. |

Os testes de página existentes usam `PAINEL`, `montar` e `hook`. Os testes do hook usam `m`, `FONTE`, `vendasQ` e `ultimaChamada`.

**Atenção ao build:** `src/hooks/__tests__/useAdsPainel.test.ts` está dentro de `src` e entra no TypeScript da aplicação. Alterar a assinatura do hook exige atualizar esse arquivo no mesmo commit.

`graphify-out/` não existe neste worktree. Foram consultados o vault de Faturamento, os documentos de status, tarefas, roadmap, ADR e spec. A leitura permaneceu no worktree fornecido, conforme o pedido de somente leitura.

### 1.2 Restrições globais

1. Preservar agregação por Σ/Σ, reconciliação em centavos, deduplicação, cobertura, atribuição, histórico e custos.
2. Preservar `—` para desconhecido, sinais monetários e marcas de custo parcial/estimado. Não ratear compartilhados ou não identificados.
3. Preservar `FamiliaPainel.semaforo`, condicionado a `painel.semaforoLiberado`; a referência continua **ACOS direto × ACOS de equilíbrio**.
4. Não alterar RPC, banco, autorização, tenant, coletor, dossiê, seletor compartilhado ou dados de produção.
5. Preservar Geist, tokens, temas, componentes e linguagem visual do aplicativo. Sem gráfico novo, gradiente, animação de números ou efeitos do Pulse.

### 1.3 Foco da revisão e respectivas provas

| Condição | Comportamento exigido | Prova |
|---|---|---|
| Virada do mês e diferença entre UTC/BRT | Não consultar mês anterior como “Mês atual” nem produzir intervalo invertido | Tarefas 1 e 2 |
| Troca de período com consulta anterior pendente | Nunca montar o novo recorte com a resposta antiga | Tarefa 2 |
| Resultado desconhecido | Mostrar `—` e motivo; não renderizar ponte inválida | Tarefas 4 e 5 |
| Informação financeira condicionada | Provisório, custo e divergência visíveis com detalhes fechados | Tarefas 4 e 5 |
| Sem referência ou semáforo desligado | Não classificar como saudável; mensagem de validação em um único lugar | Tarefa 5 |

## 2. Decisões de produto

### 2.1 Período padrão: decisão do Diego (2026-10-05) — **Mês atual**

O Diego escolheu abrir a tela em **Mês atual** (mês civil BRT até o último dia coletado). No início do mês, antes da
1ª coleta, a página mostra o estado `aguardando_mes` com o atalho "Ver últimos 30 dias". A escolha fica numa
única constante, em `src/lib/ads-painel-dados.ts`:

```ts
export const PERIODO_PADRAO_ADS: PeriodoAds = {
  tipo: 'mes_atual',
};
```

Preferências válidas já salvas sempre vencem o padrão. Testes de fallback comparam com `PERIODO_PADRAO_ADS`, sem
repetir a decisão.

### 2.2 Escopo de períodos

Entram **7 dias, 30 dias, 90 dias e Mês atual**.

**Mês anterior fica registrado como próxima entrega**, para fechamento mensal. Deverá usar o mês civil anterior inteiro, preservar cobertura e atribuição aberta e não encurtar silenciosamente o intervalo.

Hoje e Personalizado permanecem fora desta entrega.

### 2.3 “Onde agir” é o próprio conjunto de filtros

Não haverá painel adicional “Onde agir” nem botão “Ver famílias em atenção”.

Os cartões compactos de contagem serão os próprios filtros:

| Rótulo | Filtro |
|---|---|
| Todas | Todas as famílias recebidas |
| Em atenção | `acima` ou `sem_espaco` |
| Dentro do equilíbrio | `dentro` |
| Sem referência | Semáforo nulo; todas quando o semáforo estiver desligado |

O clique no filtro ativo volta para `todas`. A ordenação por gasto recebida do domínio permanece intacta.

Com zero famílias em atenção, não renderizar um botão “Em atenção 0”. Mostrar:

- Todas avaliáveis: **“Nenhuma família acima do equilíbrio neste período.”**
- Com famílias sem referência: **“Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.”**
- Sem famílias: **“Nenhum gasto de Ads por família no período.”**

Com semáforo desligado, mostrar uma única mensagem de validação; não acrescentar uma frase sugerindo que todas estão bem.

## 3. Direção visual e hierarquia

### 3.1 Ordem da página

1. `PageHeader`: título, descrição, presets e legenda BRT no slot `actions`.
2. Resumo: despesa e resultado, ressalvas visíveis, ponte e composição expansível.
3. `Section title="Famílias por gasto"`: filtros com contagem e ranking.
4. Gastos associados: compartilhados e não identificados, independentes do filtro.
5. Procedência e início do histórico de vendas.

Não criar coluna lateral com as mesmas contagens dos filtros.

### 3.2 Layout, escala e controles

| Elemento | Especificação |
|---|---|
| Contêiner | `mx-auto w-full max-w-[1440px] min-w-0 p-4 sm:p-6` |
| Ritmo | `space-y-6`; agrupamentos internos com `gap-3` ou `gap-4` |
| Superfícies | `rounded-lg border border-border bg-card` |
| Valores primários | `text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums` |
| Textos e números | Corpo `text-sm`; legendas `text-xs`; números alinhados à direita |

Presets, ações de recuperação e botões de detalhes usam **`h-11 sm:h-8`**. Botões apenas com ícone usam `h-11 w-11 sm:h-8 sm:w-8`.

Os cartões `KpiCard` mantêm sua altura natural, suficiente para rótulo e valor; não comprimir cartões em 32 px.

Presets selecionados usam o padrão do aplicativo:

```tsx
variant={selecionado ? 'default' : 'outline'}
```

O primário sólido indica seleção. Não criar outra linguagem de seleção com `bg-primary/10`.

Manter foco visível e `gap-2` entre controles independentes. Em mobile, os quatro presets formam uma grade de duas colunas.

### 3.3 Wireframe desktop

```text
Ads                              [7 dias] [30 dias] [90 dias] [Mês atual]
Quanto o Ads custa...             01/10/2026 a 03/10/2026 · BRT

┌ Resumo da conta ────────────────────────────────────────────────────┐
│ Despesa de Ads                  Resultado após Ads                  │
│ R$ 345,00                       R$ 2.872,87                          │
│                                provisório · custo estimado         │
│                                aviso de divergência, quando houver │
│                                                                    │
│ Lucro antes de Ads − Despesa de Ads = Resultado após Ads             │
│ R$ 3.217,87        − R$ 345,00      = R$ 2.872,87                    │
│ Não é o lucro causado pelo Ads.                                     │
│ [Composição e indicadores ▾]                                       │
└────────────────────────────────────────────────────────────────────┘

Famílias por gasto
ACOS direto comparado à margem observada.
[Todas N] [Em atenção N] [Dentro do equilíbrio N] [Sem referência N]

Família          Gasto        ACOS direto × equilíbrio    Resultado   Detalhes
Nome / código    R$ 89,21      15% × 12%                   R$ 32,00    [v]
                              Acima do equilíbrio         ressalvas

Gastos associados
Procedência e histórico
```

### 3.4 Wireframe mobile — 360 px

```text
Ads
Quanto o Ads custa e o que sobra depois dele.

[7 dias       ] [30 dias      ]
[90 dias      ] [Mês atual    ]
01/10/2026 a 03/10/2026 · BRT

┌ Resumo da conta ──────────────┐
│ Despesa de Ads                │
│ R$ 345,00                     │
│                              │
│ Resultado após Ads           │
│ R$ 2.872,87                   │
│ provisório · custo estimado  │
│ aviso de divergência         │
│                              │
│ Lucro antes de Ads  3.217,87  │
│ Não é o lucro causado        │
│ pelo Ads.                    │
│ [Composição e indicadores v] │
└──────────────────────────────┘

Famílias por gasto
[Todas N]        [Em atenção N]
[Dentro N]       [Sem referência N]

Cartões de família
```

Em 360 px, a ponte contém **somente a linha “Lucro antes de Ads”**. Não repetir despesa e resultado já destacados.

Metas para o cenário normal:

- Em 1440×900: cabeçalho, resumo, filtros e pelo menos três famílias.
- Em 360×800: despesa, resultado e início da seção de famílias.
- Alertas, zoom e textos longos podem aumentar a altura; nunca ocultar ressalvas para cumprir a dobra.

### 3.5 Ranking fechado e expansão

Desktop em `xl:block`, cartões em `xl:hidden`.

| Coluna | Largura |
|---|---:|
| Família | 34% |
| Gasto | 14% |
| ACOS direto × equilíbrio | 22% |
| Resultado após Ads | 24% |
| Detalhes | 6% |

Usar `Table` com `table-fixed`, `px-3 py-3 align-top`, cabeçalhos quebráveis e `scope="col"`. Não usar `overflow-hidden` para disfarçar colunas cortadas.

Linha e cartão fechados mostram nome, código, gasto, resultado, referência, motivo e marca de custo. Nome é link; expansão é botão separado.

Detalhes mostram:

| Grupo | Conteúdo |
|---|---|
| Atribuição | Vendas atribuídas total/direta |
| Eficiência | ROAS total/direto e ACOS total/direto |
| Margem | Lucro antes de Ads e margem consumida |
| Associação | Quantidade de grupos exclusivos e gasto compartilhado associado |
| Contexto | Aviso percentual de não identificado, quando disponível, e nome completo |

O nome pode usar `line-clamp-2` fechado, desde que apareça completo no detalhe.

O link permanece:

```tsx
to={`/faturamento/sku/familia/${encodeURIComponent(f.codigoPai)}`}
```

Não prometer preservar período ou selecionar a aba Ads do dossiê sem contrato de navegação existente.

## 4. Contratos financeiros e ressalvas

### 4.1 Valores e semáforo

A apresentação não recalcula lucro, resultado, semáforo ou percentuais.

| Condição | Apresentação |
|---|---|
| `resultado === null` | `—` e motivo visível |
| Resultado negativo conhecido | Valor negativo com `fmtBRLSinal` e `text-danger` |
| Resultado positivo | `text-foreground`; não colorir automaticamente de verde |
| Zero medido | Valor zero formatado; nunca `—` |
| Denominador indisponível | `—`, salvo o texto específico de ausência de venda direta |

A comparação principal mostra **ACOS direto × equilíbrio**. Nos detalhes, os pares continuam **total/direto**.

Quando `vendasDiretas === 0`, mostrar **“sem venda direta”** no lugar do ACOS direto numérico. Não mudar o semáforo recebido:

- Com equilíbrio positivo e elegibilidade, o domínio retorna `acima`.
- Com equilíbrio não positivo, retorna `sem_espaco`.
- Sem referência ou com bloqueio, pode permanecer nulo.

A UI não deve fabricar `acima` para uma família bloqueada.

### 4.2 Motivos da conta

`ResumoConta` recebe:

```ts
{
  conta: ContaPainel;
  historicoDesde: string | null;
}
```

Não recebe nem calcula `historicoCobre`.

```ts
function motivoResultadoConta(
  conta: ContaPainel,
  historicoDesde: string | null,
): string | null {
  if (conta.resultado != null) return null;

  if (conta.fonteCusto == null) {
    return historicoDesde
      ? `período antes do histórico de vendas (desde ${dataBRT(historicoDesde)})`
      : 'período antes do histórico de vendas';
  }

  return 'sem custo cadastrado';
}
```

No domínio atual, resultado nulo com fonte não nula decorre de lucro indisponível por custo.

Com `lucroAntes === null`, **não renderizar a ponte**, nem no desktop nem no mobile. O resultado continua mostrando `—` com o motivo.

Nunca produzir:

```text
— − R$ 345,00 = —
```

### 4.3 Informações que permanecem fora da expansão

| Informação | Local obrigatório |
|---|---|
| `provisório — N dias com atribuição em aberto` | Junto ao resultado da conta, mesmo com composição fechada |
| `custo parcial` / `custo estimado` | Junto ao resultado da conta e da família, na linha/cartão fechado |
| Motivo de resultado ou referência indisponível | Linha/cartão fechado |
| Divergência da conta | Aviso completo junto ao resultado da conta, antes de qualquer expansão |
| Ressalva causal | Visível junto ao resumo |

A família não possui `diasAbertos`. Não inventar contagem por família. Se a informação provisória for repetida junto ao resultado da família, identificá-la como **“Atribuição da conta em aberto”**, derivada de `conta.diasAbertos`.

Para divergência, manter **uma ocorrência do aviso completo**:

> A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.

Nas linhas/cartões fechados, usar a indicação curta **“Composição da conta divergente”**, sem repetir o alerta completo nem bloquear resultados válidos.

### 4.4 Composição, compartilhados e não identificado

A expansão da conta contém as parcelas disponíveis, ROAS, ACOS total, vendas atribuídas e margem consumida.

Em divergência:

- Preservar despesa total e resultados válidos.
- Preservar valores conhecidos de famílias e compartilhados.
- Não apresentar a decomposição como soma conciliada.
- Ocultar o valor e o percentual de não identificado.
- Manter o aviso de divergência visível fora da expansão.

O bloco “Gastos associados” permanece independente do filtro de famílias. Reaproveitar a soma e os textos existentes de grupos compartilhados, inclusive:

```text
Grupo 7: sem código identificado (1 anúncio)
```

Não transformar `custoCompartilhado` em parte do gasto exclusivo da família.

Quando `naoIdentificadoPct > 0`, o detalhe da família informa:

> X% do gasto da conta não tem família identificada e não foi rateado entre famílias.

### 4.5 Motivos das famílias

Preservar os textos:

| Motivo | Texto |
|---|---|
| `compartilhado` | gasto compartilhado com outra família |
| `cobertura` | coleta de Ads incompleta no período |
| `historico` | período antes do histórico de vendas (desde DD/MM/AAAA), quando houver data |
| `sem_vendas` | sem vendas no período |
| `sem_custo` | sem custo cadastrado |
| `custo_parcial` | custo parcial: sem semáforo |

`sem_vendas` não elimina um resultado negativo conhecido. Custo parcial/estimado não vira custo real.

## 5. Período e ciclo de dados

### 5.1 Tipos e resolução mensal

Adicionar a `src/lib/ads-painel-dados.ts`:

```ts
import type { Periodo } from '@/lib/metricas';
import { diaBRT } from '@/lib/calendario-brt';

export type PeriodoAds = Extract<
  Periodo,
  { tipo: 'preset' } | { tipo: 'mes_atual' }
>;

export type JanelaDiasAds = {
  desde: string;
  ate: string;
};

export type ResolucaoPeriodoAds =
  | { tipo: 'pronto'; janela: JanelaDiasAds }
  | {
      tipo: 'aguardando_mes';
      janela: null;
      inicioMes: string;
      fimDisponivel: string;
    };

export function resolverPeriodoAds(
  periodo: PeriodoAds,
  agora: Date,
  ultimoOkEm: string | null,
): ResolucaoPeriodoAds {
  if (periodo.tipo === 'preset') {
    return {
      tipo: 'pronto',
      janela: periodoAds(periodo.dias, agora, ultimoOkEm),
    };
  }

  const inicioMes = `${diaBRT(agora.getTime()).slice(0, 7)}-01`;
  const fimDisponivel = fimDiasAds(agora, ultimoOkEm);

  if (fimDisponivel < inicioMes) {
    return {
      tipo: 'aguardando_mes',
      janela: null,
      inicioMes,
      fimDisponivel,
    };
  }

  return {
    tipo: 'pronto',
    janela: { desde: inicioMes, ate: fimDisponivel },
  };
}
```

Preservar `periodoAds` e `fimDiasAds` integralmente.

### 5.2 Os 11 casos mensais obrigatórios

| # | Agora | Último sync | Resultado |
|---:|---|---|---|
| 1 | `2026-10-05T08:00:00-03:00` | `2026-10-04T14:17:00Z` | 01/10 a 03/10 |
| 2 | `2026-10-05T12:00:00-03:00` | `2026-10-05T14:17:00Z` | 01/10 a 04/10 |
| 3 | `2026-10-05T08:00:00-03:00` | `null` | 01/10 a 04/10 |
| 4 | `2026-10-05T08:00:00-03:00` | `2026-10-01T14:17:00Z` | 01/10 a 04/10; sem recuo ilimitado |
| 5 | `2026-10-01T08:00:00-03:00` | `2026-09-30T14:17:00Z` | `aguardando_mes` |
| 6 | `2026-10-01T12:00:00-03:00` | `2026-10-01T14:17:00Z` | `aguardando_mes` |
| 7 | `2026-10-02T08:00:00-03:00` | `2026-10-01T14:17:00Z` | `aguardando_mes` |
| 8 | `2027-01-01T12:00:00-03:00` | `2027-01-01T14:17:00Z` | `aguardando_mes` |
| 9 | `2026-10-02T12:00:00-03:00` | `2026-10-02T14:17:00Z` | 01/10 a 01/10 |
| 10 | `2026-10-01T02:30:00Z` | `null` | 01/09 a 29/09; ainda é setembro em BRT |
| 11 | `2028-02-29T15:00:00-03:00` | `null` | 01/02 a 28/02 |

O fallback de sync ausente ou antigo permanece o existente. Cobertura e estado do backend determinam a disponibilidade dos dados.

### 5.3 Persistência local, sem migração

Continuar usando:

```ts
const CHAVE = 'ads-painel-dias';
```

Valores aceitos: **`'7' | '30' | '90' | 'mes_atual'`**.

Em `Ads.tsx`:

```ts
function periodoSalvo(): PeriodoAds {
  try {
    const valor = localStorage.getItem(CHAVE);

    if (valor === 'mes_atual') return { tipo: 'mes_atual' };

    if (valor === '7' || valor === '30' || valor === '90') {
      const dias: DiasAds = valor === '7' ? 7 : valor === '30' ? 30 : 90;
      return { tipo: 'preset', dias };
    }
  } catch {
    return PERIODO_PADRAO_ADS;
  }

  return PERIODO_PADRAO_ADS;
}
```

Inicialização lazy:

```tsx
const [periodo, setPeriodo] = useState<PeriodoAds>(periodoSalvo);

const escolherPeriodo = (proximo: PeriodoAds) => {
  setPeriodo(proximo);

  try {
    localStorage.setItem(
      CHAVE,
      proximo.tipo === 'preset' ? String(proximo.dias) : 'mes_atual',
    );
  } catch {
    // A seleção continua válida nesta visita.
  }
};
```

Não criar chave versionada, JSON, migração, `usePeriodoAds.ts` ou componente de período.

### 5.4 Contrato do hook

```ts
export interface RetornoAdsPainel {
  painel: PainelAds | null;
  janela: JanelaDiasAds | null;
  situacaoPeriodo: 'carregando' | 'pronto' | 'aguardando_mes';
  historicoDesde: string | null;
  ultimoOkEm: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAdsPainel(periodo: PeriodoAds): RetornoAdsPainel;
```

Calcular a data BRT **a cada render**, sem timer ou listener:

```ts
const hoje = diaBRT(Date.now());
const tipo = periodo.tipo;
const dias = periodo.tipo === 'preset' ? periodo.dias : null;
const ultimoOkEm = syncQ.data ?? null;

const resolucao = useMemo(() => {
  const selecionado: PeriodoAds =
    tipo === 'preset' && dias !== null
      ? { tipo: 'preset', dias }
      : { tipo: 'mes_atual' };

  return resolverPeriodoAds(
    selecionado,
    new Date(`${hoje}T12:00:00-03:00`),
    ultimoOkEm,
  );
}, [tipo, dias, hoje, ultimoOkEm]);
```

Usar meio-dia BRT aqui é seguro: a resolução depende do dia civil e do sync, não da hora dentro do dia.

Não incluir o objeto `periodo` nas dependências. Nos demais memos, preferir também os limites primitivos `desde` e `ate`.

### 5.5 Consultas, atualização e precedência

Resolver uma janela e compartilhá-la entre:

```text
buscarPainelAds(desde, ate)
useVendasSku({ tipo: 'range', desde, ate }, janelaBRT(desde, ate), true)
montarPainelAds({ janela: { desde, ate }, ... })
```

Enquanto o sync não concluir ou o mês estiver aguardando:

- `janela` pública e `painel` são `null`.
- Não habilitar `buscarPainelAds`, busca de códigos ou vendas do período.
- Não chamar `montarPainelAds`.
- Chamar hooks incondicionalmente.
- Para os argumentos obrigatórios de vendas, fornecer internamente um dia válido no início do mês, sempre com `enabled=false`.

Esse intervalo interno não pode aparecer no retorno ou na montagem. `useVendasSku` possui consultas auxiliares próprias; a garantia não é “zero rede”.

Usar query keys com o intervalo efetivo, sem `placeholderData` que reaproveite números do período anterior. Códigos só ficam habilitados quando o período está pronto e a fonte atual concluiu.

Precedência pública:

```text
erro de sync
→ sync carregando
→ aguardando_mes
→ erro das fontes habilitadas
→ carregamento das fontes necessárias
→ painel disponível
```

Em `aguardando_mes`, erros de consultas desabilitadas e estados auxiliares antigos não podem substituir o estado mensal nem manter loading infinito.

`refetch()`:

1. Atualiza primeiro `syncQ`.
2. Se houver erro, não inicia consultas financeiras.
3. Resolve novamente com o sync retornado e o dia BRT atual.
4. Se a janela mudou, deixa as novas query keys carregar; não chama manualmente refetch da janela antiga.
5. Se permaneceu igual e pronta, repete fonte, códigos, vendas e catálogo; em mês aguardando, encerra sem consultar finanças.

Se o usuário trocar o preset durante a espera do sync, não continuar a atualização manual do preset abandonado. Uma referência à identidade primitiva da seleção é suficiente; não criar controlador genérico.

No mesmo período, manter os dados durante refetch e apresentar **“Atualizando…”**. Uma aba parada não ganha timer próprio: a virada do dia é observada no próximo render, retorno de consulta ou interação.

## 6. Estados da página

### 6.1 Bloqueantes e recuperação

| Estado | Conteúdo | Ação |
|---|---|---|
| Carregando | Skeleton de resumo e três famílias; `aria-busy` | Sem ação falsa de sincronização |
| Erro | “Não foi possível carregar o painel de Ads.”; `role="alert"` | Tentar de novo |
| `sem_coleta` / `coletando` | Preservar explicações atuais | Verificar novamente |
| `sem_permissao` / `sem_acesso` | Preservar orientação atual | Abrir Canais, em `/canais` |
| `sem_advertiser` | Preservar orientação “Meu perfil → Publicidade” | Sem URL externa inventada |

### 6.2 Vazios e condições parciais

| Estado | Conteúdo |
|---|---|
| `aguardando_mes` | “Aguardando o primeiro dia de Ads deste mês”; ação **Ver últimos 30 dias** |
| `sem_ads` | “Nenhum gasto de Ads no período”; oferecer **Ver últimos 90 dias** se 90 não estiver selecionado |
| Conta indisponível | Região “Resumo da conta” com motivo de cobertura; ranking preservado |
| Desatualizado | Aviso antes do resumo; dados preservados, sem afirmar atualização bem-sucedida |
| Divergente | Aviso junto ao resultado, visível fechado; parcela não identificada sem número |

Explicação de `aguardando_mes`:

> Os dados de hoje ainda não entram no painel. O mês aparecerá quando houver um dia encerrado coletado.

Não apresentar zero, datas invertidas ou números do mês anterior.

A procedência fica fora das ramificações de sucesso:

> Despesa informada pela API de Ads do Mercado Livre.  
> Vendas desde DD/MM/AAAA, quando a organização começou a vender pelo PubliAI.

Sem data disponível:

> Vendas desde a entrada da organização no PubliAI.

A ressalva causal aparece uma vez junto ao resumo quando ele existe. Nos estados sem resumo financeiro, aparece junto à procedência.

## 7. Arquivos e sequência de commits

### 7.1 Mapa de alterações

| Grupo | Arquivos |
|---|---|
| Período e hook | `src/lib/ads-painel-dados.ts`, `src/hooks/useAdsPainel.ts` |
| Página | `src/pages/Ads.tsx` |
| Componentes existentes | `src/components/ads/resumo-conta.tsx`, `src/components/ads/ranking-familias.tsx` |
| Extrações necessárias | `src/lib/ads-apresentacao.ts`, `src/components/ads/detalhe-familia.tsx`, `src/components/ads/gastos-associados.tsx` |
| Documentação | Uma linha em `docs/decisions/0179-painel-de-ads.md` |

Testes: arquivos existentes de dados, hook e página; novo `tests/lib/ads-apresentacao.test.ts`.

As quatro descrições dos filtros entram no dicionário existente `src/lib/kpi-descriptions.ts`, com cobertura em `src/lib/__tests__/kpi-descriptions.test.ts`.

**Não criar:** `usePeriodoAds.ts`, `periodo-ads.tsx`, `onde-agir-ads.tsx`, `estado-ads.tsx` ou teste do seletor compartilhado. As ramificações de estado continuam em `Ads.tsx`.

**Não modificar:** `seletor-periodo.tsx`, `page-header.tsx`, `section.tsx`, `kpi-card.tsx`, `ads-painel.ts`, `sku-ads.ts` ou componentes do dossiê.

### 7.2 Regra de cada commit

Cada tarefa segue teste vermelho → implementação → teste verde → build → commit.

Executar **`rtk pnpm build` antes de cada commit**, inclusive o último. O script real é `tsc -b && vite build`.

Não criar commits intermediários com assinatura incompatível, imports pendentes ou testes TypeScript quebrados.

| Tarefa | Tempo |
|---|---:|
| 1. Resolução mensal | 25 min |
| 2. Hook e migração atômica dos consumidores | 50 min |
| 3. Período, cabeçalho e estados | 45 min |
| 4. Resumo financeiro | 35 min |
| 5. Filtros, ranking e detalhes | 80 min |
| 6. Validação visual e documentação | 35 min |
| **Total previsto** | **270 min — 4 h 30 min** |

### Tarefa 1 — Resolver Mês atual preservando o calendário existente

**Modificar:** `src/lib/ads-painel-dados.ts`, `tests/lib/ads-painel-dados.test.ts`.

**Produz:** `PeriodoAds`, `JanelaDiasAds`, `ResolucaoPeriodoAds`, `resolverPeriodoAds` e `PERIODO_PADRAO_ADS`.

- [ ] Acrescentar os 11 casos abaixo e equivalência dos presets.
- [ ] Executar o teste e confirmar falha pela ausência do resolver.
- [ ] Implementar o código de §5.1 e a constante de §2.1.
- [ ] Executar testes direcionados e `rtk pnpm build`.
- [ ] Commit: `feat(ads): resolve current month in BRT`.

Acrescentar `resolverPeriodoAds` aos imports do teste existente:

```ts
describe('resolverPeriodoAds: mês atual', () => {
  const mensal = { tipo: 'mes_atual' } as const;

  it.each([
    ['2026-10-05T08:00:00-03:00', '2026-10-04T14:17:00Z', '2026-10-03'],
    ['2026-10-05T12:00:00-03:00', '2026-10-05T14:17:00Z', '2026-10-04'],
    ['2026-10-05T08:00:00-03:00', null, '2026-10-04'],
    ['2026-10-05T08:00:00-03:00', '2026-10-01T14:17:00Z', '2026-10-04'],
  ])('resolve %s com o recuo existente', (agora, sync, ate) => {
    expect(resolverPeriodoAds(mensal, new Date(agora), sync)).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-10-01', ate },
    });
  });

  it.each([
    ['2026-10-01T08:00:00-03:00', '2026-09-30T14:17:00Z', '2026-10-01', '2026-09-29'],
    ['2026-10-01T12:00:00-03:00', '2026-10-01T14:17:00Z', '2026-10-01', '2026-09-30'],
    ['2026-10-02T08:00:00-03:00', '2026-10-01T14:17:00Z', '2026-10-01', '2026-09-30'],
    ['2027-01-01T12:00:00-03:00', '2027-01-01T14:17:00Z', '2027-01-01', '2026-12-31'],
  ])('aguarda sem gerar intervalo invertido em %s',
    (agora, sync, inicioMes, fimDisponivel) => {
      expect(resolverPeriodoAds(mensal, new Date(agora), sync)).toEqual({
        tipo: 'aguardando_mes',
        janela: null,
        inicioMes,
        fimDisponivel,
      });
    },
  );

  it('libera o primeiro dia após a coleta do dia 2', () => {
    expect(resolverPeriodoAds(
      mensal,
      new Date('2026-10-02T12:00:00-03:00'),
      '2026-10-02T14:17:00Z',
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-10-01', ate: '2026-10-01' },
    });
  });

  it('usa setembro quando UTC já está em outubro', () => {
    expect(resolverPeriodoAds(
      mensal,
      new Date('2026-10-01T02:30:00Z'),
      null,
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-09-01', ate: '2026-09-29' },
    });
  });

  it('respeita fevereiro bissexto', () => {
    expect(resolverPeriodoAds(
      mensal,
      new Date('2028-02-29T15:00:00-03:00'),
      null,
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2028-02-01', ate: '2028-02-28' },
    });
  });

  it.each([7, 30, 90] as const)('preserva o preset de %i dias', dias => {
    const agora = new Date('2026-10-05T08:00:00-03:00');
    const sync = '2026-10-04T14:17:00Z';

    expect(resolverPeriodoAds({ tipo: 'preset', dias }, agora, sync))
      .toEqual({
        tipo: 'pronto',
        janela: periodoAds(dias, agora, sync),
      });
  });
});
```

Validação:

```bash
rtk pnpm exec vitest run tests/lib/ads-painel-dados.test.ts tests/lib/sku-ads.test.ts
rtk pnpm build
```

### Tarefa 2 — Alterar o hook e seus consumidores no mesmo commit

**Modificar:** `src/hooks/useAdsPainel.ts`, `src/pages/Ads.tsx`, `src/hooks/__tests__/useAdsPainel.test.ts`, `tests/pages/Ads.test.tsx`.

**Consome:** resolução da Tarefa 1.  
**Produz:** `RetornoAdsPainel` e o comportamento de §5.4–§5.5.

- [ ] Acrescentar testes mensais, de mudança de janela e de resposta tardia.
- [ ] Confirmar falhas e atualizar os mocks para o contrato público completo.
- [ ] Implementar o hook e migrar todos os consumidores neste commit.
- [ ] Executar os testes direcionados e `rtk pnpm build`.
- [ ] Commit: `feat(ads): share resolved period across panel data sources`.

**Migração atômica obrigatória em `Ads.tsx`:**

```tsx
const {
  painel,
  janela,
  historicoDesde,
  isError,
  refetch,
} = useAdsPainel({ tipo: 'preset', dias });
```

Nesta tarefa, o estado local ainda pode continuar sendo `dias`. O quarto botão entra na Tarefa 3.

Como `janela` passa a admitir `null`, atualizar imediatamente a guarda da legenda:

```tsx
{painel && janela && (
  <p className="text-xs text-muted-foreground tabular-nums">
    {`${diaMesLiteral(janela.desde)} – ${diaMesLiteral(janela.ate)} · até ${diaMesLiteral(janela.ate)}`}
  </p>
)}
```

Atualizar o teste existente:

```tsx
it('trocar o período chama o hook com o preset estruturado', () => {
  localStorage.setItem('ads-painel-dias', '30');
  montar();

  expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 30 });

  fireEvent.click(screen.getByRole('button', { name: '7 dias' }));

  expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 7 });
});
```

No teste do hook, substituir `useAdsPainel(30)` por `useAdsPainel({ tipo: 'preset', dias: 30 })`.

Substituir o wrapper que cria um `QueryClient` durante cada render por uma fábrica estável por montagem:

```ts
function criarWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const render = () => renderHook(
  () => useAdsPainel({ tipo: 'preset', dias: 30 }),
  { wrapper: criarWrapper() },
);
```

Nos testes existentes que desestruturam `janela`, estreitar o tipo:

```ts
const { janela } = r.result.current;
if (!janela) throw new Error('O período deveria estar pronto');
```

Acrescentar `isFetching` e `refetch` aos mocks de catálogo e vendas. O `refetch` de catálogo retorna uma Promise. Restaurar esses campos no `beforeEach`.

Os testes existentes de erro de vendas/catálogo devem aguardar a conclusão do sync antes de esperar `isError`, respeitando a nova precedência.

**Testes concretos a acrescentar:**

```ts
it('mês atual usa a mesma janela em Ads, vendas e montagem', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-05T08:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');

  const { result } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper: criarWrapper() },
  );

  await waitFor(() => expect(result.current.painel).not.toBeNull());

  const janela = { desde: '2026-10-01', ate: '2026-10-03' };

  expect(result.current.janela).toEqual(janela);
  expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
  expect(m.useVendasSku).toHaveBeenLastCalledWith(
    { tipo: 'range', ...janela },
    janelaBRT(janela.desde, janela.ate),
    true,
  );
  expect(ultimaChamada().janela).toEqual(janela);
});

it('mês aguardando não consulta finanças nem herda erro de vendas', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-01T12:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');
  m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));

  const { result } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper: criarWrapper() },
  );

  await waitFor(() =>
    expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
  );

  expect(result.current.janela).toBeNull();
  expect(result.current.painel).toBeNull();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isError).toBe(false);
  expect(m.buscarPainelAds).not.toHaveBeenCalled();
  expect(m.buscarCodigosMlbs).not.toHaveBeenCalled();
  expect(m.montarPainelAds).not.toHaveBeenCalled();
  expect(m.useVendasSku.mock.calls.every(call => call[2] === false)).toBe(true);
});

it('recalcula o mês no próximo render, sem timer próprio', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-09-30T15:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue(null);

  const { result, rerender } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper: criarWrapper() },
  );

  await waitFor(() => expect(result.current.painel).not.toBeNull());
  expect(result.current.janela).toEqual({
    desde: '2026-09-01',
    ate: '2026-09-29',
  });

  m.buscarPainelAds.mockClear();
  m.montarPainelAds.mockClear();

  vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
  rerender();

  expect(result.current.situacaoPeriodo).toBe('aguardando_mes');
  expect(result.current.janela).toBeNull();
  expect(result.current.painel).toBeNull();
  expect(m.buscarPainelAds).not.toHaveBeenCalled();
  expect(m.montarPainelAds).not.toHaveBeenCalled();
});
```

Adicionar `act` aos imports e usar o helper abaixo para as corridas:

```ts
function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>(resolve => {
    resolver = resolve;
  });
  return { promise, resolver };
}
```

```ts
it('ignora a resposta tardia do preset anterior', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-05T12:00:00-03:00'),
  });

  const antiga = pendente<FontePainelAds>();
  m.buscarUltimoOkAds.mockResolvedValue(null);
  m.buscarPainelAds.mockImplementation((desde: string) =>
    desde === '2026-09-05' ? antiga.promise : Promise.resolve(FONTE),
  );

  const { result, rerender } = renderHook(
    ({ dias }: { dias: 7 | 30 }) => useAdsPainel({ tipo: 'preset', dias }),
    { initialProps: { dias: 30 }, wrapper: criarWrapper() },
  );

  await waitFor(() =>
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04'),
  );

  rerender({ dias: 7 });

  await waitFor(() => expect(result.current.painel).not.toBeNull());
  expect(result.current.janela).toEqual({
    desde: '2026-09-28',
    ate: '2026-10-04',
  });

  await act(async () => {
    antiga.resolver(FONTE);
    await antiga.promise;
  });

  expect(ultimaChamada().janela).toEqual({
    desde: '2026-09-28',
    ate: '2026-10-04',
  });
});

it('refetch do dia 2 libera o mês após atualizar o sync', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-02T12:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');

  const { result } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper: criarWrapper() },
  );

  await waitFor(() =>
    expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
  );

  m.buscarUltimoOkAds.mockResolvedValue('2026-10-02T14:17:00Z');

  await act(async () => {
    await result.current.refetch();
  });

  await waitFor(() => expect(result.current.painel).not.toBeNull());

  expect(result.current.janela).toEqual({
    desde: '2026-10-01',
    ate: '2026-10-01',
  });
  expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
  expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-10-01', '2026-10-01');
});
```

Cobrir também os seguintes contratos no mesmo arquivo:

| Teste | Preparação e assertivas |
|---|---|
| Catálogo carregando | `data=undefined`, `isLoading=true`; depois do sync, `painel=null` e `isLoading=true` |
| Erro de catálogo | `isError=true`; depois do sync, `isError=true`, sem skeleton permanente |
| Refetch da mesma janela | Fixar data e sync; após refetch, RPC repete os mesmos argumentos, vendas e catálogo recebem refetch |
| Refetch muda o fim | Sync de 04/10 passa para 05/10; novas chamadas financeiras terminam em 04/10, sem refetch manual do intervalo que terminava em 03/10 |
| Troca durante refetch | Segurar a Promise do sync, mudar 30→7 e liberá-la; não repetir manualmente as fontes de 30 dias |

Validação:

```bash
rtk pnpm exec vitest run src/hooks/__tests__/useAdsPainel.test.ts tests/pages/Ads.test.tsx tests/lib/ads-painel-dados.test.ts
rtk pnpm build
```

### Tarefa 3 — Acrescentar o quarto preset, cabeçalho e estados

**Modificar:** `src/pages/Ads.tsx`, `tests/pages/Ads.test.tsx`.

**Consome:** contrato completo do hook.  
**Produz:** seleção persistida, cabeçalho e recuperação de estados.

- [ ] Acrescentar testes de storage, Mês atual, legenda e recuperação.
- [ ] Confirmar falhas.
- [ ] Implementar estado local de período, `PageHeader.actions` e ramificações de §6.
- [ ] Executar o teste de página e `rtk pnpm build`.
- [ ] Commit: `feat(ads): add monthly preset and period recovery states`.

Declarar os quatro presets em `Ads.tsx`:

```ts
const PRESETS: {
  valor: '7' | '30' | '90' | 'mes_atual';
  label: string;
  periodo: PeriodoAds;
}[] = [
  { valor: '7', label: '7 dias', periodo: { tipo: 'preset', dias: 7 } },
  { valor: '30', label: '30 dias', periodo: { tipo: 'preset', dias: 30 } },
  { valor: '90', label: '90 dias', periodo: { tipo: 'preset', dias: 90 } },
  { valor: 'mes_atual', label: 'Mês atual', periodo: { tipo: 'mes_atual' } },
];
```

Usar `useAdsPainel(periodo)`. Comparar a seleção pelo valor primitivo.

A legenda não usa `new Date('YYYY-MM-DD')`. Formatar datas literais:

```ts
const dataDia = (dia: string) =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
```

Exemplo de composição dentro de `actions`:

```tsx
<div className="w-full min-w-0 space-y-2 sm:w-auto">
  <div
    role="group"
    aria-label="Período"
    className="grid grid-cols-2 gap-2 sm:flex"
  >
    {PRESETS.map(p => {
      const atual = periodo.tipo === 'preset'
        ? String(periodo.dias)
        : 'mes_atual';
      const selecionado = atual === p.valor;

      return (
        <Button
          key={p.valor}
          size="sm"
          variant={selecionado ? 'default' : 'outline'}
          aria-pressed={selecionado}
          className="h-11 sm:h-8"
          onClick={() => escolherPeriodo(p.periodo)}
        >
          {p.label}
        </Button>
      );
    })}
  </div>

  {janela && (
    <p className="text-xs text-muted-foreground tabular-nums">
      {`${dataDia(janela.desde)} a ${dataDia(janela.ate)} · BRT`}
    </p>
  )}

  {isFetching && painel && (
    <p role="status" className="text-xs text-muted-foreground">
      Atualizando…
    </p>
  )}
</div>
```

Esse conteúdo vai em:

```tsx
<PageHeader
  title="Ads"
  subtitle="Quanto o Ads custa e o que sobra depois dele."
  actions={acoesPeriodo}
/>
```

`acoesPeriodo` é a expressão JSX anterior, declarada no componente. Não alterar `PageHeader`.

**Fixture de página:** importar `RetornoAdsPainel` como tipo e atualizar o helper existente:

```tsx
const montar = (
  painel: PainelAds | null = PAINEL,
  extra: Partial<RetornoAdsPainel> = {},
) => {
  const retorno: RetornoAdsPainel = {
    painel,
    janela: { desde: '2026-09-04', ate: '2026-10-03' },
    situacaoPeriodo: 'pronto',
    historicoDesde: '2026-01-01T03:00:00.000Z',
    ultimoOkEm: '2026-10-04T14:17:00Z',
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };

  hook.mockReturnValue(retorno);
  return render(<MemoryRouter><Ads /></MemoryRouter>);
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  hook.mockReset();
});
```

Acrescentar `afterEach(() => vi.restoreAllMocks())`.

Testes de storage permanecem **em `Ads.test.tsx`**:

```tsx
it.each([7, 30, 90] as const)('preserva a preferência existente de %i dias', dias => {
  localStorage.setItem('ads-painel-dias', String(dias));
  montar();
  expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias });
});

it.each([null, '', '31', '0', '030', 'range', '{"tipo":"mes_atual"}'])(
  'usa o padrão para preferência inválida %s',
  valor => {
    if (valor !== null) localStorage.setItem('ads-painel-dias', valor);
    montar();
    expect(hook).toHaveBeenLastCalledWith(PERIODO_PADRAO_ADS);
  },
);

it('salva e restaura mês atual na chave existente', () => {
  const primeira = montar();

  fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

  expect(localStorage.getItem('ads-painel-dias')).toBe('mes_atual');
  expect(hook).toHaveBeenLastCalledWith({ tipo: 'mes_atual' });

  primeira.unmount();
  montar();

  expect(screen.getByRole('button', { name: 'Mês atual' }))
    .toHaveAttribute('aria-pressed', 'true');
});

it('permite selecionar período com storage bloqueado', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });

  montar();

  expect(hook).toHaveBeenLastCalledWith(PERIODO_PADRAO_ADS);

  fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

  expect(hook).toHaveBeenLastCalledWith({ tipo: 'mes_atual' });
  expect(screen.getByRole('button', { name: 'Mês atual' }))
    .toHaveAttribute('aria-pressed', 'true');
});

it('mês aguardando oferece os últimos 30 dias sem apresentar números', () => {
  localStorage.setItem('ads-painel-dias', 'mes_atual');
  montar(null, { janela: null, situacaoPeriodo: 'aguardando_mes' });

  expect(screen.getByText('Aguardando o primeiro dia de Ads deste mês'))
    .toBeVisible();
  expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Ver últimos 30 dias' }));

  expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 30 });
  expect(localStorage.getItem('ads-painel-dias')).toBe('30');
});

it('mostra o intervalo completo em BRT', () => {
  montar();
  expect(screen.getByText('04/09/2026 a 03/10/2026 · BRT')).toBeVisible();
});
```

Acrescentar testes de estado:

```tsx
it.each(['sem_permissao', 'sem_acesso'] as const)(
  '%s oferece Canais sem apresentar resultado',
  estado => {
    montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] });

    expect(screen.getByRole('link', { name: 'Abrir Canais' }))
      .toHaveAttribute('href', '/canais');
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
  },
);

it('erro oferece uma nova consulta', () => {
  const refetch = vi.fn().mockResolvedValue(undefined);
  montar(null, { isError: true, refetch });

  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

  expect(refetch).toHaveBeenCalledTimes(1);
});

it('refetch mantém os dados da mesma janela visíveis', () => {
  montar(PAINEL, { isFetching: true });

  expect(screen.getByText('Atualizando…')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Resumo da conta' }))
    .toBeInTheDocument();
});
```

Para `sem_ads`, testar a ação de 90 dias e sua ausência quando 90 já está selecionado. Para `sem_coleta` e `coletando`, testar “Verificar novamente” chamando `refetch`. Preservar o teste de ausência de anunciante.

Validação:

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx
rtk pnpm build
```

### Tarefa 4 — Destacar despesa e resultado sem esconder ressalvas

**Modificar:** `src/components/ads/resumo-conta.tsx`, `src/pages/Ads.tsx`, `tests/pages/Ads.test.tsx`.

**Consome:** `ContaPainel` e `historicoDesde`.  
**Produz:** resumo com duas métricas primárias, ponte condicional e composição expansível.

- [ ] Acrescentar testes de motivo, ponte, custo e divergência fechada.
- [ ] Confirmar falhas.
- [ ] Reorganizar o componente e passar `historicoDesde` pela página.
- [ ] Executar testes de página/domínio e `rtk pnpm build`.
- [ ] Commit: `refactor(ads): prioritize financial result with visible caveats`.

Manter `pct` e `razao` exportados de `resumo-conta.tsx` até a Tarefa 5, porque o ranking atual os importa. Não quebrar esse import antecipadamente.

Contrato de acessibilidade:

| Elemento | Contrato |
|---|---|
| Resumo | `section aria-label="Resumo da conta"` |
| Valores primários | `role="group"` com `aria-labelledby` |
| Ponte | Contêiner nomeado “Cálculo do resultado”, apenas com valores conhecidos |
| Expansão | Botão “Composição e indicadores”, `aria-expanded`, `aria-controls` |
| Conteúdo expandido | Montagem condicional em região “Composição e indicadores” |

A ponte desktop usa os valores já fornecidos pelo domínio, sem recalcular `resultado`. No mobile, mostra só “Lucro antes de Ads”.

Testes:

```tsx
it('revela a composição sob demanda', () => {
  montar();
  const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

  expect(resumo.getByText('Despesa de Ads')).toBeVisible();
  expect(resumo.getByText('Resultado após Ads')).toBeVisible();
  expect(resumo.queryByText('Em famílias')).not.toBeInTheDocument();

  fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));

  expect(resumo.getByText('Em famílias')).toBeVisible();
  expect(resumo.getByText('Compartilhado entre famílias')).toBeVisible();
  expect(resumo.getByText('Gasto de Ads não identificado')).toBeVisible();
});

it.each([
  [null, 'período antes do histórico de vendas (desde 10/09/2026)'],
  ['sem_custo', 'sem custo cadastrado'],
] as const)('explica resultado nulo com fonte %s e oculta a ponte', (fonteCusto, motivo) => {
  montar({
    ...PAINEL,
    conta: { ...PAINEL.conta!, lucroAntes: null, resultado: null, fonteCusto },
  }, { historicoDesde: '2026-09-10T15:00:00.000Z' });

  const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
  const resultado = resumo.getByRole('group', { name: 'Resultado após Ads' });

  expect(resultado).toHaveTextContent('—');
  expect(resultado).toHaveTextContent(motivo);
  expect(resultado).not.toHaveTextContent(/R\$\s*0,00/);
  expect(resumo.queryByRole('group', { name: 'Cálculo do resultado' }))
    .not.toBeInTheDocument();
});

it.each(['parcial', 'estimado'] as const)(
  'mantém custo %s junto ao resultado com composição fechada',
  fonteCusto => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, fonteCusto } });

    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    const resultado = within(resumo.getByRole('group', { name: 'Resultado após Ads' }));

    expect(resultado.getByText(`custo ${fonteCusto}`)).toBeVisible();
    expect(resumo.getByRole('button', { name: 'Composição e indicadores' }))
      .toHaveAttribute('aria-expanded', 'false');
  },
);

it('mantém provisório e divergência visíveis antes da expansão', () => {
  montar({
    ...PAINEL,
    conta: {
      ...PAINEL.conta!,
      diasAbertos: 14,
      divergente: true,
      naoIdentificado: null,
      naoIdentificadoPct: null,
    },
  });

  const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

  expect(resumo.getByText('provisório — 14 dias com atribuição em aberto'))
    .toBeVisible();
  expect(screen.getByText(/não fecha com o total da conta/)).toBeVisible();
  expect(resumo.getByRole('button', { name: 'Composição e indicadores' }))
    .toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));

  expect(resumo.queryByText('Gasto de Ads não identificado')).not.toBeInTheDocument();
  expect(resumo.getByRole('group', { name: 'Despesa de Ads' }))
    .toHaveTextContent(/R\$\s*100,00/);
  expect(resumo.getByRole('group', { name: 'Resultado após Ads' }))
    .toHaveTextContent(/200,00/);
});
```

Atualizar nesta tarefa o teste existente de histórico incompleto para usar `fonteCusto: null`, como o domínio realmente entrega.

O teste existente **“conta divergente: mostra o aviso…” continua passando sem clicar em expansão**.

Validação:

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx tests/lib/ads-painel.test.ts
rtk pnpm build
```

### Tarefa 5 — Unificar contagens e filtros; compactar ranking

**Criar:** `src/lib/ads-apresentacao.ts`, `tests/lib/ads-apresentacao.test.ts`, `src/components/ads/detalhe-familia.tsx`, `src/components/ads/gastos-associados.tsx`.

**Modificar:** ranking, resumo, página, testes de página e dicionário/teste de descrições de KPI.

**Consome:** `PainelAds`, semáforos e motivos existentes.  
**Produz:** filtros, cinco colunas, cartões compactos e detalhes preservados.

- [ ] Testar contagens, filtragem, expansão e ressalvas fechadas.
- [ ] Confirmar falhas.
- [ ] Implementar helpers e reorganizar componentes com `Section` e `KpiCard`.
- [ ] Executar os testes direcionados e `rtk pnpm build`.
- [ ] Commit: `refactor(ads): compact family ranking and reuse status filters`.

#### Helpers de apresentação

Mover `pct`, `razao` e `textoMotivo` para `ads-apresentacao.ts`, atualizando todos os imports no mesmo commit.

```ts
export type FiltroFamiliasAds =
  | 'todas'
  | 'atencao'
  | 'dentro'
  | 'sem_referencia';

export interface ContagemFamiliasAds {
  total: number;
  acima: number;
  semEspaco: number;
  dentro: number;
  semReferencia: number;
}

export function contarFamiliasAds(
  familias: readonly FamiliaPainel[],
  liberado: boolean,
): ContagemFamiliasAds {
  const contagem: ContagemFamiliasAds = {
    total: familias.length,
    acima: 0,
    semEspaco: 0,
    dentro: 0,
    semReferencia: 0,
  };

  for (const familia of familias) {
    const estado = liberado ? familia.semaforo : null;
    if (estado === 'acima') contagem.acima++;
    else if (estado === 'sem_espaco') contagem.semEspaco++;
    else if (estado === 'dentro') contagem.dentro++;
    else contagem.semReferencia++;
  }

  return contagem;
}

export function filtrarFamiliasAds(
  familias: readonly FamiliaPainel[],
  filtro: FiltroFamiliasAds,
  liberado: boolean,
): FamiliaPainel[] {
  return familias.filter(familia => {
    const estado = liberado ? familia.semaforo : null;

    if (filtro === 'todas') return true;
    if (filtro === 'atencao') return estado === 'acima' || estado === 'sem_espaco';
    if (filtro === 'dentro') return estado === 'dentro';
    return estado === null;
  });
}
```

Fixture completa do novo teste:

```ts
import { describe, expect, it } from 'vitest';
import type { FamiliaPainel } from '@/lib/ads-painel';
import { contarFamiliasAds, filtrarFamiliasAds } from '@/lib/ads-apresentacao';

const base: FamiliaPainel = {
  codigoPai: 'A',
  nome: 'Fam A',
  grupos: 1,
  custoCompartilhado: 0,
  custo: 50,
  vendasDiretas: 400,
  vendasTotais: 500,
  cliques: 0,
  impressoes: 0,
  roas: 10,
  roasDireto: 8,
  acos: 0.1,
  acosDireto: 0.125,
  lucroAntes: 250,
  resultado: 200,
  margemConsumida: 0.2,
  acosEquilibrio: 0.25,
  semaforo: 'dentro',
  motivo: null,
  fonteCusto: 'real',
};

describe('apresentação de famílias Ads', () => {
  const familias: FamiliaPainel[] = [
    base,
    { ...base, codigoPai: 'B', semaforo: 'acima' },
    { ...base, codigoPai: 'C', semaforo: null },
    { ...base, codigoPai: 'D', semaforo: 'sem_espaco' },
  ];

  it('conta estados e preserva a ordem recebida', () => {
    expect(contarFamiliasAds(familias, true)).toEqual({
      total: 4,
      acima: 1,
      semEspaco: 1,
      dentro: 1,
      semReferencia: 1,
    });

    expect(filtrarFamiliasAds(familias, 'atencao', true).map(f => f.codigoPai))
      .toEqual(['B', 'D']);
    expect(filtrarFamiliasAds(familias, 'dentro', true).map(f => f.codigoPai))
      .toEqual(['A']);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', true).map(f => f.codigoPai))
      .toEqual(['C']);
  });

  it('semáforo desligado torna todas sem referência', () => {
    expect(contarFamiliasAds(familias, false)).toEqual({
      total: 4,
      acima: 0,
      semEspaco: 0,
      dentro: 0,
      semReferencia: 4,
    });
    expect(filtrarFamiliasAds(familias, 'atencao', false)).toEqual([]);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', false)).toEqual(familias);
  });
});
```

#### Composição dos filtros

Manter filtro e expansões locais ao ranking. Usar uma `key` na página formada por seleção e janela efetiva para reiniciá-los ao mudar período; um refetch da mesma janela não muda a key.

`RankingFamilias` mantém props enxutas:

```ts
{
  painel: PainelAds;
  historicoDesde: string | null;
}
```

Compor:

```tsx
<div role="region" aria-label="Ranking de famílias">
  <Section
    title="Famílias por gasto"
    description="ACOS direto comparado à margem observada."
  >
    {filtros}
    {conteudoRanking}
  </Section>
</div>
```

`filtros` e `conteudoRanking` são expressões JSX locais do ranking. Não passar props inexistentes a `Section`.

Exemplo do cartão de atenção:

```tsx
<KpiCard
  size="compact"
  label="Em atenção"
  infoKey="Em atenção::Ads"
  value={contagem.acima + contagem.semEspaco}
  tom="warning"
  ativo={filtro === 'atencao'}
  onClick={() => setFiltro(atual => atual === 'atencao' ? 'todas' : 'atencao')}
/>
```

Renderizá-lo somente quando a contagem for maior que zero.

O nome acessível real do componente será **“Filtrar por Em atenção”** ou **“Remover filtro Em atenção”**. Os testes devem usar esse contrato existente.

Adicionar quatro descrições ao dicionário:

```ts
'Todas::Ads':
  'Famílias presentes no painel neste período, mantendo a ordem por gasto.',
'Em atenção::Ads':
  'Famílias acima do ACOS de equilíbrio ou sem espaço para Ads. O filtro usa o semáforo existente e não recomenda alteração de orçamento.',
'Dentro do equilíbrio::Ads':
  'Famílias cujo ACOS direto está dentro da referência pela margem observada no período.',
'Sem referência::Ads':
  'Famílias sem semáforo disponível. Inclui todas as famílias enquanto o semáforo estiver em validação.',
```

Acrescentar essas quatro chaves à lista `ALL_EXPECTED_KEYS` do teste existente. Não alterar `KpiCard`.

#### Detalhes e gastos associados

Interfaces:

```ts
export interface DetalheFamiliaProps {
  familia: FamiliaPainel;
  conta: ContaPainel | null;
  historicoDesde: string | null;
}

export interface GastosAssociadosProps {
  painel: PainelAds;
}
```

`DetalheFamilia` apresenta os campos de §3.5 e o aviso percentual de §4.4. Ressalvas obrigatórias permanecem no conteúdo fechado.

`GastosAssociados` recebe o painel completo, nunca a lista filtrada. Usar uma única região responsiva `aria-label="Gastos associados"`; não duplicar os grupos em uma tabela desktop e outro bloco mobile.

A tabela possui `aria-label="Famílias por gasto"`. A lista mobile possui `aria-label="Famílias por gasto em cartões"`.

Botões de expansão:

```text
Ver detalhes de Fam A
aria-expanded="false|true"
aria-controls="<id único>"
```

Usar IDs distintos por apresentação, preferencialmente com `useId` em componentes de linha/cartão. No desktop, detalhes ocupam um segundo `<tr>` com `<td colSpan={5}>`.

Não envolver `<tr>` em `<div>`.

#### Testes de interação e confiança

```tsx
it('os cartões de contagem filtram sem alterar gastos associados', () => {
  montar({
    ...PAINEL,
    familias: [
      PAINEL.familias[0],
      { ...PAINEL.familias[1], semaforo: 'acima', acosEquilibrio: 0.2 },
    ],
  });

  const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
  const associados = screen.getByRole('region', { name: 'Gastos associados' });
  const antes = associados.textContent;

  fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Em atenção' }));

  expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
  expect(tabela.getByRole('row', { name: /Fam B/ })).toBeInTheDocument();
  expect(associados.textContent).toBe(antes);
  expect(screen.getByRole('button', { name: 'Remover filtro Em atenção' }))
    .toHaveAttribute('aria-pressed', 'true');
});

it('zero em atenção mostra frase sem botão de atenção', () => {
  montar();

  expect(screen.queryByRole('button', { name: /Filtrar por Em atenção/ }))
    .not.toBeInTheDocument();
  expect(screen.getByText(
    'Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.',
  )).toBeVisible();
});

it('sem venda direta tem texto explícito e preserva o semáforo', () => {
  montar({
    ...PAINEL,
    familias: [{
      ...PAINEL.familias[0],
      vendasDiretas: 0,
      acosDireto: null,
      acosEquilibrio: 0.25,
      semaforo: 'acima',
    }],
  });

  const linha = within(screen.getByRole('row', { name: /Fam A/ }));

  expect(linha.getByText('sem venda direta')).toBeVisible();
  expect(linha.getByText('Acima do equilíbrio')).toBeVisible();
});

it.each(['parcial', 'estimado'] as const)(
  'família mantém custo %s no resultado fechado',
  fonteCusto => {
    montar({
      ...PAINEL,
      familias: [{
        ...PAINEL.familias[0],
        fonteCusto,
        motivo: fonteCusto === 'parcial' ? 'custo_parcial' : null,
        semaforo: fonteCusto === 'parcial' ? null : 'dentro',
      }],
    });

    const linha = within(screen.getByRole('row', { name: /Fam A/ }));
    const resultado = linha.getByRole('group', { name: 'Resultado após Ads' });

    expect(resultado).toHaveTextContent(
      fonteCusto === 'parcial' ? 'custo parcial: sem semáforo' : 'custo estimado',
    );
    expect(linha.getByRole('button', { name: 'Ver detalhes de Fam A' }))
      .toHaveAttribute('aria-expanded', 'false');
  },
);

it('resultado bloqueado conserva travessão e motivo', () => {
  montar({
    ...PAINEL,
    familias: [{
      ...PAINEL.familias[0],
      resultado: null,
      custoCompartilhado: 20,
      semaforo: null,
      motivo: 'compartilhado',
    }],
  });

  const linha = within(screen.getByRole('row', { name: /Fam A/ }));
  const resultado = linha.getByRole('group', { name: 'Resultado após Ads' });

  expect(resultado).toHaveTextContent('—');
  expect(resultado).toHaveTextContent('gasto compartilhado com outra família');
});

it('expande métricas secundárias e preserva o link do nome', () => {
  montar();

  const linha = within(screen.getByRole('row', { name: /Fam A/ }));
  const botao = linha.getByRole('button', { name: 'Ver detalhes de Fam A' });

  fireEvent.click(botao);

  expect(botao).toHaveAttribute('aria-expanded', 'true');

  const id = botao.getAttribute('aria-controls');
  if (!id) throw new Error('Expansão sem aria-controls');

  const detalhe = document.getElementById(id);
  if (!detalhe) throw new Error('Conteúdo da expansão não encontrado');

  expect(within(detalhe).getByText('ROAS (total / direto)')).toBeVisible();
  expect(within(detalhe).getByText('Vendas atribuídas (total / direta)'))
    .toBeVisible();
  expect(linha.getByRole('link', { name: /Fam A/ }))
    .toHaveAttribute('href', '/faturamento/sku/familia/A');
});

it('semáforo em validação tem uma única mensagem', () => {
  montar({
    ...PAINEL,
    semaforoLiberado: false,
    familias: [{ ...PAINEL.familias[0], semaforo: null }],
  });

  expect(screen.getByText(/Semáforo em validação:/)).toBeVisible();
  expect(screen.getAllByText(/Semáforo em validação:/)).toHaveLength(1);
  expect(within(screen.getByRole('row', { name: /Fam A/ }))
    .queryByText('Dentro do equilíbrio')).not.toBeInTheDocument();
});
```

A mensagem completa de semáforo em validação permanece em `Ads.tsx`. Ranking e filtros não a repetem.

**Adaptação explícita dos testes atuais:**

| Teste atual | Nova consulta |
|---|---|
| Três parcelas no resumo | Abrir “Composição e indicadores” antes de consultar parcelas |
| Compartilhado/não identificado na coluna Gasto | Consultar “Gastos associados”; não são mais linhas de família |
| Ordem total/direto | Abrir composição e detalhe de uma família; manter a ordem |
| Período com “intervalo · até” | Consultar intervalo completo com ano e `· BRT` |
| Hook chamado com dias | Objeto `PeriodoAds`, corrigido desde a Tarefa 2 |
| Semáforo em validação | `getByText` encontra uma única mensagem |
| Conta divergente | Aviso passa **sem expandir**; após expansão, número não identificado continua ausente |
| Grupo sem família | Expandir o grupo na região “Gastos associados” |
| Sem famílias | Mensagem única; não criar tabela vazia |
| Histórico incompleto | Data do motivo preservada e fixture da conta com `fonteCusto: null` |

Acrescentar um teste de reset: aplicar atenção, expandir uma família, trocar o período e verificar retorno a `todas` com detalhes fechados. O mesmo estado permanece durante `isFetching=true` sem mudança de seleção/janela.

JSDOM não comprova breakpoints. Consultar tabela e lista explicitamente; a exclusão visual de uma delas será verificada no navegador.

Validação:

```bash
rtk pnpm exec vitest run tests/lib/ads-apresentacao.test.ts tests/pages/Ads.test.tsx tests/lib/ads-painel.test.ts src/lib/__tests__/kpi-descriptions.test.ts
rtk pnpm build
```

### Tarefa 6 — Validar a interface e registrar o preset

**Modificar:** somente arquivos da entrega que precisarem de correção e uma linha do ADR-0179.

**Produz:** evidências de layout, acessibilidade e regressão.

- [ ] Preparar fixtures locais e gerar as dez capturas de §8.1.
- [ ] Medir overflow, contraste e comportamento por teclado.
- [ ] Corrigir os achados em um lote e repetir somente as verificações afetadas.
- [ ] Executar a regressão direcionada, `rtk pnpm preflight:static` e `rtk pnpm build`.
- [ ] Commit: `docs(ads): record monthly preset and validate premium layout`.

Antes de iniciar Vite, garantir `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, sem imprimir valores. Em branco de tela, verificar primeiro o console e o ambiente.

Adicionar **somente esta linha** ao ADR:

> A interface passa a oferecer o preset “Mês atual”, do primeiro dia do mês BRT até `fimDiasAds`; sem dia elegível, apresenta “aguardando mês” com acesso aos últimos 30 dias.

Não alterar o status de piloto nem declarar cumprido o aceite D7.

Regressão final:

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx tests/lib/ads-apresentacao.test.ts tests/lib/ads-painel.test.ts tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts src/lib/__tests__/kpi-descriptions.test.ts src/hooks/__tests__/useSkuDossie.test.ts tests/lib/sku-ads.test.ts
rtk pnpm preflight:static
rtk pnpm build
```

Os testes do dossiê protegem o calendário compartilhado e os contratos preservados. Não incluir regressão de seletor de movimentos por uma alteração que não ocorreu.

## 8. Validação visual e critérios de aceite

### 8.1 Matriz reduzida de capturas

| Cenário | Viewports e temas | Quantidade |
|---|---|---:|
| Dados completos, semáforo ligado e nomes longos | 360×800 e 1440×900, claro e escuro | 4 |
| Mês atual aguardando | 360×800 e 1440×900, claro e escuro | 4 |
| Conta divergente, detalhes fechados | 1440×900, escuro | 1 |
| Conta indisponível com famílias | 1440×900, escuro | 1 |
| **Total** | | **10** |

Usar fixtures locais, sem alterar produção. Registrar cenário, tema, viewport, seleção e intervalo de cada captura.

Na fixture divergente, incluir custo parcial/estimado e atribuição aberta para verificar que as ressalvas permanecem visíveis.

Em 1920 px, fazer medição de largura e inspeção funcional, **sem acrescentar capturas obrigatórias**.

### 8.2 Overflow e hierarquia

Executar nas larguras 360, 1440 e 1920, com detalhes fechados e abertos:

```js
document.documentElement.scrollWidth <=
  document.documentElement.clientWidth + 1
```

Resultado esperado: `true`.

Em 1440 e 1920, verificar a tabela:

```js
const tabela = document.querySelector(
  '[aria-label="Famílias por gasto"]',
);

const contêiner = tabela?.closest('[data-slot="table-container"]');

contêiner != null &&
  contêiner.scrollWidth <= contêiner.clientWidth + 1;
```

Resultado esperado: `true` com nomes e valores representativos.

Não aceitar corte por `overflow-hidden`, abreviação silenciosa de dinheiro ou remoção de motivos para passar na medição.

### 8.3 Acessibilidade

| Verificação | Aceite |
|---|---|
| Contraste | Texto normal ≥4,5:1; texto grande ≥3:1; foco e contornos necessários ≥3:1 |
| Mobile | Presets e ações com altura de 44 px; botões só com ícone com largura de 44 px |
| Desktop | Controles `sm:h-8`, com foco e espaçamento preservados |
| Teclado | Selecionar período, filtrar, expandir, abrir dossiê e repetir consulta |
| Semântica | Um `h1`; `Section` com `h2.text-h3`; cabeçalhos de tabela; IDs únicos; `aria-pressed` e `aria-expanded` |

Medir contraste nos dois temas, especialmente `StatusPill`, botão selecionado, textos auxiliares e alertas.

Testar zoom de 200%, nomes longos e valores monetários extensos. O conteúdo deve crescer e quebrar naturalmente.

### 8.4 Validações mecânicas

Executar **`pnpm preflight:static`** do projeto.

**Não executar o `preflight.sh` da skill de frontend.** Ele reprova os travessões obrigatórios deste domínio e foi removido deste plano.

O caractere `—` continua obrigatório para desconhecido e no selo provisório. Não substituí-lo por zero nem escondê-lo com escapes para satisfazer scanner.

### 8.5 Aceite final

- [ ] Os 11 casos mensais e a compatibilidade 7/30/90 passam.
- [ ] Cada commit passa em `pnpm build`.
- [ ] Resultado, custo, provisório, motivos e divergência permanecem corretos com detalhes fechados.
- [ ] As dez capturas e medições comprovam a composição responsiva nos dois temas.
- [ ] Nenhum cálculo financeiro, seletor compartilhado, dossiê ou dado de produção foi alterado.

## 9. Riscos e limites

| Risco | Controle |
|---|---|
| Trocar assinatura e quebrar commits intermediários | Hook, chamada da página, mocks e testes dentro de `src` migram juntos na Tarefa 2 |
| Mês vazio virar intervalo inválido ou loading infinito | União discriminada, janela pública nula e gating testado |
| Compactação esconder confiança financeira | Selo provisório, custo parcial/estimado, motivos e divergência fora da expansão, junto ao resultado |
| Resposta atrasada aparecer sob outro filtro | Query keys por intervalo, ausência de dados anteriores como placeholder e teste de corrida |
| Sem referência parecer situação saudável | Contagem própria, mensagem única de validação e nenhuma recomendação automática |

Sem timer de meia-noite: a virada é reconhecida no próximo render. Esse limite é deliberado.

Ficam fora desta entrega: Mês anterior — próxima entrega registrada —, Personalizado, tendências, gráficos novos, campanhas, metas, exportação, busca/paginação, alteração de custos, rateio, escrita no ML e redesenho do dossiê.

Não são necessários campos novos em `PainelAds`, `ContaPainel` ou `FamiliaPainel`.

## 10. Ajustes da revisão do Opus

| Achado | Onde foi aplicado |
|---:|---|
| **1 — Ressalvas fora da expansão** | §4.3–§4.4, Tarefas 4 e 5 e §9: provisório, custo parcial/estimado, motivos e divergência visíveis fechados; somente o número não identificado fica indisponível em divergência. |
| **2 — Commits compiláveis ao mudar o hook** | Tarefa 2: `Ads.tsx` passa imediatamente `{ tipo: 'preset', dias }`; teste da página, teste do hook e guardas de `janela` migram juntos. §7.2 exige build em cada commit. |
| **3 — Seletor e persistência locais** | §5.3 e Tarefa 3: quarto botão no grupo de `Ads.tsx`, primário sólido, chave `ads-painel-dias`, sem migração. Arquivos extras de período e teste do seletor removidos. |
| **4 — Sem timer/listener** | §5.4–§5.5 e Tarefa 2: `diaBRT(Date.now())` a cada render, dependências primitivas e teste de virada por rerender. |
| **5 — Motivo da conta pelo contrato existente** | §4.2 e Tarefa 4: `fonteCusto == null` distingue histórico; lucro nulo com fonte não nula indica custo ausente; ponte não existe com lucro desconhecido. |
| **6 — Contagens são “Onde agir”** | §2.3 e Tarefa 5: `KpiCard` compacto como filtro; removidos painel duplicado, CTA e teste de transferência de foco. Zero atenção apresenta frase sem botão. |
| **7 — Regressões de mensagem e divergência** | Tarefas 4 e 5: tabela de ajustes inclui semáforo em validação em um único lugar e divergência verificável sem expansão. |
| **8 — Componentes de cabeçalho e seção** | §3.1 e Tarefas 3 e 5: período/legenda em `PageHeader.actions`; ranking usa `Section` com `h2.text-h3`. |
| **9 — Sem venda direta** | §4.1 e Tarefa 5: célula mostra “sem venda direta”; semáforo recebido do domínio é preservado. |
| **10 — Altura responsiva dos controles** | §3.2 e §8.3: `h-11 sm:h-8`; 44 px no mobile, sem impor essa altura ao desktop. |
| **11 — Retirar preflight incompatível** | Tarefa 6 e §8.4: removido `preflight.sh`; mantidos screenshots, medições e `pnpm preflight:static`. |
| **12 — Padrão, recuperação e ponte mobile** | §2.1: decisão do Diego via `PERIODO_PADRAO_ADS`; §2.2: Mês anterior como próxima entrega; §6.2: ação de 30 dias; §3.4: ponte mobile só com Lucro antes de Ads. |

| Corte solicitado | Aplicação |
|---|---|
| Tarefa antiga de seletor compartilhado | Eliminada integralmente |
| Persistência como subsistema próprio | Substituída por leitura/escrita local na página |
| `onde-agir-ads.tsx` e teste de foco | Eliminados |
| Matriz extensa de screenshots | Reduzida a dez capturas |
| ADR e estimativa | Uma linha sobre o preset; alvo de 4–5 horas |

**Decisão registrada:** `PERIODO_PADRAO_ADS = { tipo: 'mes_atual' }` (Diego, 2026-10-05).