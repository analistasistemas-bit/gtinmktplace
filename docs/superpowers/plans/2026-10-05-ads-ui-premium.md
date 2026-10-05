# Redesenho premium do módulo Ads: plano de implementação

> **Execução:** outro agente implementa; Opus 5.5 revisa este plano. Usar `superpowers:executing-plans` na implementação, tarefa por tarefa, com os checkboxes abaixo.
>
> **Status:** planejamento concluído em modo somente leitura. Nenhum arquivo alterado; testes e validação visual da proposta ainda não executados.

**Objetivo:** permitir que Diego identifique rapidamente **quanto gastou, quanto sobrou após Ads e quais famílias precisam de atenção**, incluindo o filtro **Mês atual**.

**Arquitetura:** preservar `montarPainelAds` e os contratos financeiros. Alterar a apresentação, acrescentar uma resolução explícita de período mensal e reaproveitar o seletor compartilhado com opções compatíveis com Ads.

**Stack confirmada:** React 18, TypeScript, Tailwind 4, shadcn/ui, Radix, Lucide, TanStack Query e Vitest. `recharts ^3.8.1` já está instalado; nenhum gráfico novo será necessário.

**Referências de domínio:** `docs/decisions/0179-painel-de-ads.md`, `docs/superpowers/specs/2026-10-04-painel-de-ads-design.md` e termos de Ads em `docs/reference/glossario.md`.

**Estimativa:** 6–8 horas de implementação e testes; 1–2 horas de validação visual e ajustes.

## 1. Base da proposta

### 1.1 Modo de design e fontes consultadas

Este é **system work**: evolução de uma tela dentro de um produto existente.

| Fonte | Aplicação no plano |
|---|---|
| `frontend-design-fable5/SKILL.md` | Priorizar integração ao sistema, hierarquia dos dados, densidade por alinhamento e cobertura de estados. |
| `ui-ux-pro-max-fable5/SKILL.md` e `references/quick-reference.md` | Divulgação progressiva, números tabulares, recuperação de erros, teclado, contraste e alvos de toque. |
| `taste-design-fable5/SKILL.md` | A skill exclui dashboards do seu escopo. Aproveitar a disciplina de preservação; não aplicar prescrições de landing page, novas fontes ou identidade. |
| `src/index.css` e componentes `ui` | Herdar Geist Variable, tokens semânticos, raios, foco e superfícies claro/escuro. |
| Promoções, Vitrine e Dashboard | Reaproveitar o idioma de filtros, informações contextuais, números destacados e acesso ao dossiê. |

O motor da `ui-ux-pro-max-fable5` foi executado somente leitura:

```bash
rtk proxy python3 -B /Users/diego/.claude/skills/ui-ux-pro-max-fable5/scripts/search.py \
  "dashboard analytics SaaS financeiro" \
  --design-system -p "PubliAI Ads" --variance 2 --motion 1 --density 8
```

**Adotado:** filtros explícitos, baixa ornamentação, foco visível, contraste e densidade de dashboard. A consulta complementar para shadcn recomendou tabela semântica.

**Descartado:** o motor sugeriu também uma landing operacional, tipografia exagerada e Fira. Isso não atende ao produto existente. Manter Geist, tokens e componentes do PubliAI.

`graphify-out/` não existe neste worktree. Foram consultados o vault de Faturamento, os documentos indicados e os arquivos do módulo. A instrução de somente leitura prevaleceu sobre a criação de outro worktree.

### 1.2 Restrições globais

1. **Não alterar cálculos:** agregação por Σ/Σ, deduplicação de grupos, cobertura, atribuição, histórico, custos e bloqueios permanecem em `montarPainelAds`.
2. **Preservar significado:** resultado após Ads não é lucro causal; desconhecido é `—`; gasto compartilhado ou não identificado nunca é rateado.
3. **Preservar semáforo ligado:** usar `FamiliaPainel.semaforo`, condicionado a `painel.semaforoLiberado`; a comparação continua sendo **ACOS direto × ACOS de equilíbrio**.
4. **Preservar escopo:** nenhuma escrita no Mercado Livre, mudança de tenant, RPC, migration ou dependência nova.
5. **Preservar identidade:** claro/escuro, Geist, tokens existentes e Lucide; sem gradiente de cabeçalho, BorderTrail ou efeitos do Pulse.

### 1.3 Pontos obrigatórios da revisão

| Risco a revisar | Evidência exigida |
|---|---|
| Virada do mês e fuso do navegador | Testes BRT, dia 1, dia 2 antes da coleta e dezembro/janeiro. |
| Dados antigos sob filtro novo | Teste com respostas assíncronas fora de ordem e janela compartilhada por vendas/Ads. |
| Desconhecido apresentado como zero | Testes de conta indisponível e motivos por família. |
| Famílias sem referência interpretadas como saudáveis | Contagem separada e mensagem sem conclusão de “tudo certo”. |
| Perda de informação ao compactar | Testes de expansão, valores total/direto, compartilhados, procedência e teclado. |

## 2. Diagnóstico dos prints

Os prints representam versões diferentes. Os prints 3 e 6 têm tabela cortada; o print 1 já mostra uma correção de largura. Os avisos de semáforo desligado também ficaram antigos: o código atual contém `BASE_ACOS_VALIDADA = true`.

Não há um print de 1920 px identificável entre os sete anexos; essa largura permanece como validação obrigatória da implementação.

### 2.1 Hierarquia e decisão

| Problema | Evidência | Consequência |
|---|---|---|
| 1. Despesa e resultado têm pouco destaque relativo | Prints 1–3 | As respostas centrais competem com ROAS, ACOS e ressalvas. |
| 2. Falta “Mês atual” | Prints 2, 3, 5 e 6 | O usuário precisa interpretar 30 dias como se fosse um recorte mensal. |
| 3. Não existe leitura imediata de onde agir | Prints 1, 3 e 6 | É necessário percorrer famílias e comparar indicadores manualmente. |
| 4. O resumo mobile consome quase toda a primeira tela | Print 2 | A decisão por família fica distante dos números principais. |
| 5. Há repetição de informações total/direto com pesos semelhantes | Prints 1–4 | A tela exige decodificação de pares antes de permitir comparação. |

### 2.2 Densidade, confiança e interação

| Problema | Evidência | Consequência |
|---|---|---|
| 6. A tabela tenta expor oito colunas simultaneamente | Prints 3 e 6 | Colunas decisivas ficam fora da área visível; a correção do print 1 ainda produz cabeçalhos densos. |
| 7. O cartão mobile reproduz a tabela inteira | Print 4 | Cada família vira um relatório longo, prejudicando comparação. |
| 8. Motivos longos ocupam o espaço do resultado | Print 1 | Ausência de dado e valor financeiro deixam de ter representação consistente. |
| 9. Divergência aparece como texto dentro de uma composição aparentemente normal | Print 6 | O usuário pode interpretar parcelas incompatíveis como uma soma válida. |
| 10. Estados e controles são pouco orientados à recuperação | Print 5 e código atual | O vazio não oferece outro período; botões `size="sm"` têm 28 px de altura. |

## 3. Direção de design

**Assunto:** despesa de Product Ads confrontada com a margem observada da conta e das famílias.

**Público:** operador de marketplace que precisa decidir onde investigar o investimento.

**Trabalho da página:** responder “quanto gastei, quanto sobrou e onde preciso olhar”.

**Intenção visual:** uma demonstração de resultado curta, seguida de uma lista comparável de famílias.

O aspecto premium virá de alinhamento, seleção de informação e estados bem resolvidos. Não será uma nova identidade visual.

### 3.1 Hierarquia da página

1. **Cabeçalho e período:** título, descrição curta, presets e intervalo efetivo BRT.
2. **Resumo e atenção:** despesa, resultado, ponte financeira e famílias que pedem análise.
3. **Ranking:** cinco colunas no desktop; cartões compactos no mobile; detalhes expansíveis.
4. **Gastos fora das famílias exclusivas:** compartilhados e não identificados em bloco próprio.
5. **Procedência:** fonte da despesa, ressalva causal e início do histórico de vendas.

**Acima da dobra em 1440×900:** cabeçalho, período, resumo, “Onde agir”, filtros e pelo menos três famílias no cenário normal.

**Acima da dobra em 360×800:** cabeçalho, período, despesa, resultado, ressalva causal e início de “Onde agir”. O objetivo não depende de esconder alertas ou motivos longos.

### 3.2 Grid, escala e tokens

| Elemento | Especificação |
|---|---|
| Contêiner | `mx-auto w-full max-w-[1440px] min-w-0 p-4 sm:p-6` |
| Ritmo principal | `space-y-6`; dentro dos blocos, `gap-3` e `gap-4` |
| Topo | `grid grid-cols-1 gap-4 xl:grid-cols-12`; resumo `xl:col-span-8`, atenção `xl:col-span-4` |
| Superfícies | `rounded-lg border border-border bg-card`; sem glow, blur ou gradiente |
| Tipografia | `text-h1` no título; `text-h3` nas seções; valores principais `text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums` |

Detalhes de composição:

- Rótulos e informações operacionais: `text-sm leading-5`.
- Legendas auxiliares: `text-xs leading-5 text-muted-foreground`; nunca reduzir números principais para fazê-los caber.
- Números em tabela: `text-right tabular-nums`.
- Texto de família: `min-w-0 whitespace-normal break-words`.
- Em 1920 px, limitar a largura do conteúdo para evitar colunas excessivamente afastadas.
- Em valores excepcionalmente longos, permitir quebra entre `R$` e o número; não abreviar silenciosamente dinheiro para “mil” ou “mi”.

### 3.3 Cor e interação

| Situação | Tratamento |
|---|---|
| Dentro do equilíbrio | `StatusPill tone="success"` + `CircleCheck` + texto “Dentro do equilíbrio” |
| Acima do equilíbrio | `StatusPill tone="danger"` + `CircleAlert` + texto “Acima do equilíbrio” |
| Sem espaço para Ads | `StatusPill tone="danger"` + `CircleX` + texto completo |
| Provisório, desatualizado ou divergente | `warning`, acompanhado de texto; sem pulsação |
| Sem referência ou desconhecido | `neutral`, valor `—` e motivo disponível |

Resultado positivo permanece em `text-foreground`; resultado negativo usa `text-danger`, preservando o sinal. ROAS alto não recebe verde automaticamente.

O roxo existente indica seleção e foco, sem significado financeiro. Para controles selecionados do Ads, preferir fundo sutil `bg-primary/10`, texto `text-foreground` e borda `border-primary`, sujeitos à medição de contraste.

Todos os controles novos terão:

```text
min-h-11
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-ring
focus-visible:ring-offset-2
focus-visible:ring-offset-background
```

Usar `size-11` para botões apenas com ícone. Espaçamento entre alvos: `gap-2`. Transições restritas a cor/opacidade, sem animação de números ou entrada escalonada.

### 3.4 Wireframe desktop: 1440 px

Valores ilustrativos extraídos do cenário injetado; não representam nova medição.

```text
┌───────────────────┬─────────────────────────────────────────────────────────┐
│ Navegação do app  │ Ads                                                     │
│ existente         │ Quanto o Ads custa e o que sobra depois dele.           │
│                   │                                                         │
│                   │ Período  [7 dias] [30 dias] [90 dias] [Mês atual]        │
│                   │ 01/10/2026 a 03/10/2026 · horário de Brasília            │
│                   │                                                         │
│                   │ ┌ Resumo da conta ─────────────────┐ ┌ Onde agir ─────┐ │
│                   │ │ provisório — N dias...           │ │ Acima: N      │ │
│                   │ │                                  │ │ Sem espaço: N │ │
│                   │ │ Despesa de Ads  Resultado após Ads│ │ Sem ref.: N   │ │
│                   │ │ R$ 345,00       R$ 2.872,87       │ │               │ │
│                   │ │                                  │ │ [Ver famílias │ │
│                   │ │ Lucro antes  − Despesa = Resultado│ │  em atenção]  │ │
│                   │ │ R$ 3.217,87  − 345,00 = 2.872,87  │ └───────────────┘ │
│                   │ │ Não é o lucro causado pelo Ads.  │                   │
│                   │ │ [Composição e indicadores  v]    │                   │
│                   │ └──────────────────────────────────┘                   │
│                   │                                                         │
│                   │ Famílias por gasto                                     │
│                   │ [Todas N] [Em atenção N] [Dentro N] [Sem referência N] │
│                   │ ACOS direto comparado à margem observada.              │
│                   │ ┌─────────────┬─────────┬─────────────┬──────────┬─────┐ │
│                   │ │ Família     │ Gasto   │ ACOS direto │Resultado │     │ │
│                   │ │             │         │× equilíbrio │após Ads  │     │ │
│                   │ ├─────────────┼─────────┼─────────────┼──────────┼─────┤ │
│                   │ │ Nome e cód. │R$ 89,21 │15% × 12%    │R$ 32,00 │ [v] │ │
│                   │ │             │         │Acima         │          │     │ │
│                   │ └─────────────┴─────────┴─────────────┴──────────┴─────┘ │
│                   │ Compartilhados e gasto não identificado                │
│                   │ Procedência e histórico de vendas                      │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

A ponte repete os valores de propósito: explica a relação entre lucro, despesa e resultado. Deve ser discreta, sem três cartões adicionais.

### 3.5 Wireframe mobile: 360 px

```text
┌──────────────────────────────────┐
│ Cabeçalho global existente       │
├──────────────────────────────────┤
│ Ads                              │
│ Quanto o Ads custa e o que        │
│ sobra depois dele.               │
│                                  │
│ Período                          │
│ [ 7 dias       ] [ 30 dias      ] │
│ [ 90 dias      ] [ Mês atual    ] │
│ 01/10/2026 a 03/10/2026 · BRT      │
│                                  │
│ ┌ Resumo da conta ─────────────┐ │
│ │ provisório — N dias com      │ │
│ │ atribuição em aberto         │ │
│ │                             │ │
│ │ Despesa de Ads              │ │
│ │ R$ 345,00                   │ │
│ │                             │ │
│ │ Resultado após Ads          │ │
│ │ R$ 2.872,87                 │ │
│ │                             │ │
│ │ Lucro antes       3.217,87   │ │
│ │ Despesa de Ads     −345,00   │ │
│ │ Resultado         2.872,87   │ │
│ │ Não é o lucro causado       │ │
│ │ pelo Ads.                   │ │
│ │ [Composição e indicadores v]│ │
│ └─────────────────────────────┘ │
│ Onde agir                        │
│ N acima · N sem espaço            │
│ N famílias sem referência         │
│ [Ver famílias em atenção]         │
├──────── dobra-alvo ───────────────┤
│ Famílias por gasto                │
│ [Todas N] [Em atenção N]          │
│ [Dentro N] [Sem referência N]     │
│ ┌ Cartão de família ──────────┐  │
│ └─────────────────────────────┘  │
└──────────────────────────────────┘
```

A dobra é uma meta para o cenário normal em 360×800. Em zoom, alertas simultâneos ou textos maiores, a página cresce naturalmente.

### 3.6 Linha e cartão de família

**Desktop, fechado:**

```text
Família / código       Gasto       ACOS direto × equilíbrio    Resultado       Detalhes
Eucerin Aquaphor       R$ 25,00    62,5% × 19,7%               —               [v]
Família 00000028                  [Acima do equilíbrio]        Gasto compartilhado
```

**Mobile, fechado:**

```text
┌────────────────────────────────┐
│ Eucerin Aquaphor Duo Pack      │
│ Pomada Reparadora 18g          │
│ Família 00000028               │
│ [Acima do equilíbrio]          │
│                                │
│ Gasto              Resultado   │
│ R$ 25,00           —           │
│ Gasto compartilhado com outra  │
│ família                        │
│                                │
│ ACOS direto 62,5%               │
│ Equilíbrio 19,7%                │
│ [Ver detalhes               v] │
└────────────────────────────────┘
```

**Detalhe expandido, comum às duas apresentações:**

```text
Nome completo da família
Vendas atribuídas: total / direta
ROAS: total / direto
ACOS: total / direto
Lucro antes de Ads · Margem consumida · Marca de custo
Grupos exclusivos · Gasto compartilhado associado
Aviso do gasto não identificado da conta
[Abrir dossiê da família]
```

Não abrir a linha inteira por clique: o nome é um link, e o botão de expansão é uma ação separada.

## 4. Período: decisão funcional

### 4.1 Presets da entrega

**Entram:** 7 dias, 30 dias, 90 dias e **Mês atual**.

**Padrão preservado:** 30 dias para quem não tem preferência válida. Adicionar “Mês atual” não deve mudar silenciosamente o recorte inicial dos usuários.

**Não entram nesta entrega:** Hoje, Personalizado e Mês anterior.

“Mês anterior” é útil para fechamento, mas não é necessário para resolver a solicitação urgente. Além disso, **mês civil encerrado não significa atribuição finalizada**. Quando implementado, deverá usar o mês anterior inteiro, preservar o selo provisório e mostrar cobertura incompleta se o último dia ainda não tiver sido coletado, sem encurtar silenciosamente o mês.

### 4.2 Regra de “Mês atual”

Usar o mês corrente em **BRT**, calculado por `diaBRT(agora.getTime())`, disponível em `src/lib/calendario-brt.ts`.

```ts
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
): ResolucaoPeriodoAds;
```

Implementar em `src/lib/ads-painel-dados.ts`, preservando `periodoAds(dias, agora, ultimoOkEm)` para os consumidores e testes atuais.

| Situação | Resultado |
|---|---|
| Preset 7/30/90 | Delegar a `periodoAds`; comportamento atual intacto. |
| Mês atual com `fimDiasAds >= primeiro dia do mês` | `{ desde: primeiroDiaBRT, ate: fimDiasAds(...) }`. |
| Dia 1, inclusive depois da coleta | `aguardando_mes`: Ads não possui hoje; o fim continua no mês anterior. |
| Dia 2 antes da coleta, fim ainda no mês anterior | `aguardando_mes`. |
| Sync ausente ou antigo, mas intervalo não vazio | Preservar o fallback de `fimDiasAds`; cobertura e estado do backend determinam a disponibilidade. |

**Não substituir** `fimDiasAds` por uma busca indefinida do último dia coletado. O recuo máximo de um dia é parte da regra existente.

Quando `aguardando_mes`:

- Mostrar “Aguardando o primeiro dia de Ads deste mês”.
- Explicar: “Os dados de hoje ainda não entram no painel. O mês aparecerá quando houver um dia encerrado coletado.”
- Oferecer **Ver últimos 30 dias**.
- Não chamar `ads_painel`, não habilitar a consulta de vendas para esse intervalo e não chamar `montarPainelAds`.
- Não apresentar zero, datas invertidas nem dados do mês anterior.

A legenda será **“01/10/2026 a 03/10/2026 · BRT”**. Não afirmar “último dia coletado” em todos os casos: `fimDiasAds` também retorna ontem quando o sync está ausente ou parado.

### 4.3 Um recorte para todas as métricas

Resolver o período uma única vez no hook:

```text
sync concluído
    ↓
resolverPeriodoAds
    ├── aguardando_mes → estado informativo, sem consulta financeira
    └── pronto
          ├── buscarPainelAds(desde, ate)
          ├── useVendasSku({ tipo: 'range', desde, ate }, janelaBRT(...), true)
          └── montarPainelAds({ janela: { desde, ate }, ... })
```

`useVendasSku` também busca uma janela estendida internamente. Preservar esse comportamento: o importante é que a agregação financeira recebida pelo painel use a mesma `janelaBRT`.

Todos os períodos expostos terão no máximo 90 dias.

## 5. Componentes e arquivos

### 5.1 Período e carregamento

| Arquivo | Mudança e contrato |
|---|---|
| `src/lib/ads-painel-dados.ts` | Adicionar tipos e `resolverPeriodoAds`; manter a RPC e `periodoAds`. |
| `src/hooks/usePeriodoAds.ts` **novo** | `usePeriodoAds(): { periodo: PeriodoAds; escolherPeriodo: (p: PeriodoAds) => void }`; preferência versionada e fallback seguro. |
| `src/hooks/useAdsPainel.ts` | Receber `PeriodoAds`; devolver `janela: JanelaDiasAds \| null`, `situacaoPeriodo`, `isFetching`, `ultimoOkEm`, além dos campos atuais. |
| `src/components/ui/seletor-periodo.tsx` | Adicionar opções retrocompatíveis para ocultar Hoje/Personalizado e ajustar classes; manter os defaults atuais. |
| `src/components/ads/periodo-ads.tsx` **novo** | Adaptar o seletor ao subconjunto de Ads, exibir intervalo BRT e atualização. |

Props adicionais do seletor compartilhado:

```ts
mostrarHoje?: boolean;          // default true
mostrarPersonalizado?: boolean; // default true
buttonClassName?: string;
grupoClassName?: string;
```

Também acrescentar `aria-pressed` aos presets, Hoje e Mês atual. Não alterar `resolverJanela` global nem introduzir regras BRT no componente de UI.

Uso em Ads:

```tsx
<SeletorPeriodo
  periodo={periodo}
  onPeriodo={receberPeriodoSuportado}
  mostrarMesAtual
  mostrarHoje={false}
  mostrarPersonalizado={false}
  rotulo="Período"
  carregando={isFetching}
  grupoClassName="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"
  buttonClassName="h-11 px-3 text-sm aria-pressed:bg-primary/10 aria-pressed:text-foreground aria-pressed:border-primary"
/>
```

`receberPeriodoSuportado` deve estreitar o tipo por `p.tipo`, sem `as PeriodoAds` indiscriminado.

### 5.2 Resumo e famílias

| Arquivo | Responsabilidade e props |
|---|---|
| `src/components/ads/resumo-conta.tsx` | Reorganizar `ResumoConta({ conta, historicoDesde })`; destaque financeiro, ponte, motivo de resultado desconhecido e detalhes secundários. |
| `src/components/ads/onde-agir-ads.tsx` **novo** | `OndeAgirAds({ familias, semaforoLiberado, onVerAtencao })`; contagens derivadas, sem pontuação nova. |
| `src/components/ads/ranking-familias.tsx` | `RankingFamilias({ painel, historicoDesde, filtro, onFiltro })`; cinco colunas, cartões, filtros e expansão. |
| `src/components/ads/detalhe-familia.tsx` **novo** | `DetalheFamilia({ familia, conta, historicoDesde })`; métricas secundárias compartilhadas por desktop/mobile. |
| `src/lib/ads-apresentacao.ts` **novo** | Mover `pct`, `razao` e textos de motivos; fornecer contagem e filtragem sem recalcular métricas. |

Tipos de apresentação:

```ts
export type FiltroFamiliasAds =
  | 'todas'
  | 'atencao'
  | 'dentro'
  | 'sem_referencia';

export type ContagemFamiliasAds = {
  total: number;
  acima: number;
  semEspaco: number;
  dentro: number;
  semReferencia: number;
};

export function contarFamiliasAds(
  familias: readonly FamiliaPainel[],
  liberado: boolean,
): ContagemFamiliasAds;

export function filtrarFamiliasAds(
  familias: readonly FamiliaPainel[],
  filtro: FiltroFamiliasAds,
  liberado: boolean,
): FamiliaPainel[];
```

`atencao` inclui apenas `acima` e `sem_espaco`. `sem_referencia` inclui semáforo nulo; quando o semáforo estiver desabilitado, todas as famílias ficam sem referência.

Preservar a ordenação original por gasto; filtros não classificam por uma pontuação nova.

### 5.3 Estados, gastos associados e composição da página

| Arquivo | Responsabilidade |
|---|---|
| `src/components/ads/gastos-associados.tsx` **novo** | Compartilhados, expansão de grupos, anúncios sem código e gasto não identificado. Props: `{ painel: PainelAds }`. |
| `src/components/ads/estado-ads.tsx` **novo** | `EstadoAds` para estados bloqueantes e `AvisosAds` para condições parciais; usar `EmptyState`, `Button` e `Skeleton`. |
| `src/pages/Ads.tsx` | Compor seções, controlar filtro, coordenar foco e reiniciar expansão/filtro quando o período efetivo mudar. |
| `tests/pages/Ads.test.tsx` | Adaptar consultas à hierarquia nova e preservar contratos de negócio. |
| `docs/decisions/0179-painel-de-ads.md` | Registrar a ampliação dos presets e que “Onde agir” é um filtro local, sem fila operacional. |

A procedência pode continuar como pequena função privada em `Ads.tsx`; não precisa de um arquivo próprio.

### 5.4 O que sai e o que entra

| Sai | Entra |
|---|---|
| Resumo com sete métricas disputando o mesmo peso | Duas métricas primárias, ponte e “Composição e indicadores” |
| Oito colunas abertas | Cinco colunas decisórias, com detalhe expansível |
| Cartão mobile com todas as linhas financeiras | Cartão com gasto, resultado, referência e motivo |
| Compartilhados como pseudo-famílias no ranking | Bloco separado, preservado mesmo quando o ranking está filtrado |
| Avisos genéricos sem próxima ação | Estados com título, explicação e recuperação apropriada |

### 5.5 Regras dos componentes

**Resumo da conta**

A região mantém `aria-label="Resumo da conta"`.

A expansão “Composição e indicadores” mostra:

| Grupo | Informação |
|---|---|
| Composição | Em famílias; compartilhado entre famílias; gasto não identificado e percentual |
| Eficiência | ROAS total/direto; ACOS total |
| Vendas | Vendas atribuídas total/direta |
| Margem | Margem consumida; marca de custo parcial/estimado |

O selo **“provisório — N dias com atribuição em aberto”** permanece visível fora da expansão. Permitir quebra natural no selo em 360 px.

Se `resultado === null`, mostrar `—` e um motivo visível. Para a conta existente, distinguir histórico insuficiente usando `historicoCobre`; se o histórico cobre e falta lucro, informar ausência de custo disponível. Não criar um resultado substituto.

**Onde agir**

Exibir contagens de acima, sem espaço e sem referência. O botão aplica `atencao` e leva o foco ao título do ranking, com `tabIndex={-1}`.

Se nenhuma família pede atenção:

- Com todas avaliáveis: “Nenhuma família acima do equilíbrio neste período.”
- Com famílias sem referência: “Nenhuma família avaliável acima do equilíbrio. N famílias estão sem referência.”
- Sem família: “Não há famílias com gasto para avaliar.”
- Semáforo desligado: mostrar a mensagem de validação já existente; não afirmar que está tudo bem.

Sem CTA para pausar anúncio, aumentar orçamento ou escrever no ML.

**Tabela**

Usar `Table` existente, com `table-fixed`, em `xl:block`; cartões em `xl:hidden`. Aumentar o breakpoint atual evita comprimir a tabela entre 768 e 1279 px.

Distribuição:

| Coluna | Largura |
|---|---:|
| Família | 34% |
| Gasto | 14% |
| ACOS direto × equilíbrio | 22% |
| Resultado após Ads | 24% |
| Expandir | 6% |

Usar `px-3 py-3 align-top`; cabeçalhos podem quebrar em duas linhas. Preservar o wrapper de `Table`; não esconder overflow como solução para conteúdo cortado.

O nome pode usar `line-clamp-2` na apresentação fechada, desde que o detalhe revele o nome completo. Não depender de `title` para acessibilidade.

**Expansão**

Cada botão tem `aria-expanded`, `aria-controls` e nome como “Ver detalhes de Eucerin Aquaphor”. Usar IDs distintos nas apresentações desktop e mobile.

No desktop, inserir `<tr><td colSpan={5}>…</td></tr>`. Não envolver `<tr>` em um `div`.

**Sem referência e motivos**

Mostrar sempre `—` quando o resultado for desconhecido, mesmo que haja um motivo. Preservar:

```text
compartilhado → gasto compartilhado com outra família
cobertura    → coleta de Ads incompleta no período
historico    → período antes do histórico de vendas (desde DD/MM/AAAA)
sem_vendas   → sem vendas no período
sem_custo    → sem custo cadastrado
custo_parcial→ custo parcial: sem semáforo
```

`sem_vendas` não apaga um resultado negativo conhecido. Custo parcial/estimado não se transforma em custo real.

**Compartilhados e não identificado**

Manter valores independentes do filtro de famílias. O detalhe por família pode mostrar `custoCompartilhado`, identificado como gasto associado que **não foi somado ao gasto exclusivo**.

Quando `naoIdentificadoPct > 0`, o detalhe da família informa:

> X% do gasto da conta não tem família identificada e não foi rateado entre famílias.

Em divergência, ocultar a parcela numérica de não identificado e mostrar:

> A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.

Não desenhar uma barra de composição nem uma igualdade falsa. O total informado pela conta e a ponte lucro−despesa continuam válidos conforme o contrato existente.

### 5.6 Gráfico e dossiê

**Sem gráfico novo.** O `PainelAds` atual entrega agregados; uma série exigiria ampliar o contrato e a decisão de análise temporal. Uma barra de composição também ocuparia espaço sem acrescentar decisão à decomposição numérica.

**Sem redesenho de `ads-dossie.tsx`.** A aba do dossiê tem outra função: evolução temporal e alcance do gasto de uma família/SKU. Já usa tokens, BRT e gráfico próprios. Preservar seus testes como regressão.

O link do ranking continua em:

```text
/faturamento/sku/familia/:codigoPai
```

Usar `encodeURIComponent(codigoPai)`. Não prometer abrir a aba Ads com o mesmo período sem um contrato de navegação já suportado.

## 6. Estados e precedência

### 6.1 Estados bloqueantes

| Estado | Apresentação | Ação |
|---|---|---|
| Carregando | Skeleton com forma do resumo e três famílias; `aria-busy` | Nenhuma ação falsa de sincronização |
| Erro de consulta | “Não foi possível carregar o painel de Ads.”, `role="alert"` | Tentar de novo |
| `sem_coleta` / `coletando` | Textos atuais, título e ícone coerentes | Verificar novamente, sem disparar coletor |
| `sem_permissao` / `sem_acesso` | Explicar recusa e preservar orientação existente | Abrir `/canais` |
| `sem_advertiser` | Explicar ausência de anunciante Product Ads | Instrução “Meu perfil → Publicidade”; sem URL externa inventada |

### 6.2 Estados vazios e parciais

| Estado | Comportamento |
|---|---|
| `aguardando_mes` | Manter Mês atual selecionado; explicar ausência de dia encerrado; oferecer 30 dias. |
| `sem_ads` | Preservar “Nenhum gasto de Ads no período”; oferecer 90 dias se não estiver selecionado. |
| `desatualizado` | Aviso visível antes do resumo; manter os dados e seus limites; não afirmar que foram atualizados. |
| Conta indisponível | Região de resumo com “Total da conta indisponível: a coleta ainda não cobre este período”; ranking continua. |
| Divergente | Aviso na composição; números da conta e famílias preservados; sem parcela inventada. |

Precedência:

```text
erro de sync
→ sync carregando
→ aguardando_mes
→ erro das fontes do período
→ fontes carregando
→ estado de acesso/coleta
→ sem_ads
→ dados com avisos parciais
```

Erros de consultas desabilitadas de um período anterior não devem substituir `aguardando_mes`.

No refetch do **mesmo** período, manter os dados visíveis e mostrar “Atualizando…”. Na troca de período, não usar `placeholderData` que apresente valores anteriores como pertencentes ao novo recorte.

A procedência fica fora das ramificações de sucesso:

> Despesa informada pela API de Ads do Mercado Livre.  
> Resultado após a despesa de Ads; não é o lucro causado pelo Ads.  
> Vendas desde DD/MM/AAAA, quando a organização começou a vender pelo PubliAI.

Se a data ainda não estiver disponível, preservar a formulação atual sobre a entrada da organização no PubliAI. Não inventar uma data.

## 7. Tarefas de implementação e TDD

Os trechos abaixo são **testes a acrescentar**, não substitutos dos arquivos inteiros. Onde aparece `PAINEL`, `montar`, `m` ou `wrapper`, usar os fixtures/helpers já existentes nos testes indicados.

Cada tarefa segue: teste → falha confirmada → implementação mínima → teste verde → commit.

### Tarefa 1 — Resolver “Mês atual” em BRT

**Tempo:** 25–35 minutos.  
**Arquivos:** `src/lib/ads-painel-dados.ts`, `tests/lib/ads-painel-dados.test.ts`.

**Produz:** `PeriodoAds`, `ResolucaoPeriodoAds` e `resolverPeriodoAds`.

- [ ] Acrescentar os testes abaixo.
- [ ] Executar o teste e confirmar falha por export ausente.
- [ ] Implementar a resolução; preservar `periodoAds` e `fimDiasAds`.
- [ ] Executar os testes de dados e `sku-ads`.
- [ ] Commit: `feat(ads): resolve current month using BRT collection window`.

```ts
describe('resolverPeriodoAds: mês atual', () => {
  const mensal = { tipo: 'mes_atual' } as const;

  it.each([
    ['2026-10-05T08:00:00-03:00', '2026-10-04T14:17:00Z', '2026-10-03'],
    ['2026-10-05T12:00:00-03:00', '2026-10-05T14:17:00Z', '2026-10-04'],
    ['2026-10-05T08:00:00-03:00', null, '2026-10-04'],
    ['2026-10-05T08:00:00-03:00', '2026-10-01T14:17:00Z', '2026-10-04'],
  ])('resolve %s sem recuo ilimitado', (agora, sync, ate) => {
    expect(resolverPeriodoAds(mensal, new Date(agora), sync)).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-10-01', ate },
    });
  });

  it.each([
    ['2026-10-01T08:00:00-03:00', '2026-09-30T14:17:00Z'],
    ['2026-10-01T12:00:00-03:00', '2026-10-01T14:17:00Z'],
    ['2026-10-02T08:00:00-03:00', '2026-10-01T14:17:00Z'],
    ['2027-01-01T12:00:00-03:00', '2027-01-01T14:17:00Z'],
  ])('não gera intervalo invertido em %s', (agora, sync) => {
    expect(resolverPeriodoAds(mensal, new Date(agora), sync))
      .toMatchObject({ tipo: 'aguardando_mes', janela: null });
  });

  it('libera o primeiro dia depois da coleta do dia 2', () => {
    expect(resolverPeriodoAds(
      mensal,
      new Date('2026-10-02T12:00:00-03:00'),
      '2026-10-02T14:17:00Z',
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-10-01', ate: '2026-10-01' },
    });
  });

  it('usa o mês BRT mesmo quando UTC já virou o mês', () => {
    expect(resolverPeriodoAds(
      mensal, new Date('2026-10-01T02:30:00Z'), null,
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-09-01', ate: '2026-09-29' },
    });
  });

  it('respeita fevereiro bissexto', () => {
    expect(resolverPeriodoAds(
      mensal, new Date('2028-02-29T15:00:00-03:00'), null,
    )).toEqual({
      tipo: 'pronto',
      janela: { desde: '2028-02-01', ate: '2028-02-28' },
    });
  });
});
```

Preservar os testes numéricos existentes de 7/30/90. Acrescentar equivalência entre `resolverPeriodoAds({ tipo: 'preset', dias })` e `periodoAds(dias, ...)`.

```bash
rtk pnpm exec vitest run tests/lib/ads-painel-dados.test.ts tests/lib/sku-ads.test.ts
```

### Tarefa 2 — Persistir a intenção de período

**Tempo:** 20–30 minutos.  
**Criar:** `src/hooks/usePeriodoAds.ts`, `src/hooks/__tests__/usePeriodoAds.test.ts`.

**Consome:** `PeriodoAds`.  
**Produz:** estado controlado do período.

Persistir em `ads-painel-periodo-v1`:

```json
{"versao":1,"periodo":{"tipo":"mes_atual"}}
```

Persistir o preset, nunca as datas resolvidas. Na ausência da chave nova, ler `ads-painel-dias` e migrar 7/30/90 em memória. Não apagar a chave antiga.

- [ ] Testar default, migração, JSON inválido e storage bloqueado.
- [ ] Confirmar testes vermelhos.
- [ ] Implementar leitura lazy e escrita em `escolherPeriodo`, ambas com `try/catch`.
- [ ] Executar os testes; restaurar spies e limpar storage entre casos.
- [ ] Commit: `feat(ads): persist period preference with safe legacy fallback`.

```ts
it('migra o preset antigo sem perder a preferência', () => {
  localStorage.setItem('ads-painel-dias', '90');
  const { result } = renderHook(() => usePeriodoAds());
  expect(result.current.periodo).toEqual({ tipo: 'preset', dias: 90 });
});

it('salva mês atual como intenção, sem datas fixas', () => {
  const { result } = renderHook(() => usePeriodoAds());
  act(() => result.current.escolherPeriodo({ tipo: 'mes_atual' }));

  expect(JSON.parse(localStorage.getItem('ads-painel-periodo-v1')!))
    .toEqual({ versao: 1, periodo: { tipo: 'mes_atual' } });
});

it('funciona quando ler ou gravar storage lança exceção', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });

  const { result } = renderHook(() => usePeriodoAds());
  expect(result.current.periodo).toEqual({ tipo: 'preset', dias: 30 });

  act(() => result.current.escolherPeriodo({ tipo: 'mes_atual' }));
  expect(result.current.periodo).toEqual({ tipo: 'mes_atual' });
});
```

Validar explicitamente JSON com versão incorreta, `dias: 31`, `tipo: 'range'` e `null`: todos caem no fallback válido, sem coerção.

```bash
rtk pnpm exec vitest run src/hooks/__tests__/usePeriodoAds.test.ts
```

### Tarefa 3 — Integrar o período ao hook sem consultas indevidas

**Tempo:** 45–60 minutos.  
**Arquivos:** `src/hooks/useAdsPainel.ts`, `src/hooks/__tests__/useAdsPainel.test.ts`.

**Consome:** `resolverPeriodoAds`.  
**Produz:** hook preparado para janela nula e mudança de mês.

- [ ] Atualizar os testes existentes para receber `{ tipo: 'preset', dias: 30 }`; acrescentar casos mensais.
- [ ] Confirmar falhas de gating e de igualdade das janelas.
- [ ] Implementar habilitação, carregamento, atualização do calendário e retry.
- [ ] Executar os testes do hook e a regressão do dossiê.
- [ ] Commit: `feat(ads): share resolved period across ads and sales queries`.

Teste central, reutilizando os mocks existentes:

```ts
it('mês atual usa o mesmo recorte em vendas, RPC e montagem', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-05T08:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');

  const { result } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper },
  );

  await waitFor(() => expect(result.current.painel).not.toBeNull());

  const janela = { desde: '2026-10-01', ate: '2026-10-03' };
  expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
  expect(m.useVendasSku).toHaveBeenLastCalledWith(
    { tipo: 'range', ...janela },
    janelaBRT(janela.desde, janela.ate),
    true,
  );
  expect(ultimaChamada().janela).toEqual(janela);
});

it('mês sem dia disponível não consulta dados financeiros', async () => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-10-01T12:00:00-03:00'),
  });
  m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');

  const { result } = renderHook(
    () => useAdsPainel({ tipo: 'mes_atual' }),
    { wrapper },
  );

  await waitFor(() =>
    expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
  );

  expect(result.current.janela).toBeNull();
  expect(result.current.painel).toBeNull();
  expect(result.current.isLoading).toBe(false);
  expect(m.buscarPainelAds).not.toHaveBeenCalled();
  expect(m.buscarCodigosMlbs).not.toHaveBeenCalled();
  expect(m.montarPainelAds).not.toHaveBeenCalled();
  expect(m.useVendasSku.mock.calls.every((call) => call[2] === false)).toBe(true);
});
```

Decisões de implementação:

- Hooks continuam sendo chamados incondicionalmente. Para `useVendasSku`, que exige uma janela válida, fornecer internamente um intervalo de um dia no início do mês **com `enabled=false`**. Esse intervalo não sai pelo retorno público nem entra na montagem.
- O `enabled` atual de `useVendasSku` bloqueia a busca de vendas, não todas as consultas auxiliares. Não prometer “zero chamadas de rede”.
- Desabilitar também a consulta de códigos enquanto não houver período pronto.
- Incluir catálogo no estado de carregamento pertinente; não deixar skeleton eterno após erro.
- Recalcular o dia BRT à meia-noite e ao voltar à aba, com cleanup do timer/listener. Uma mudança do mês deve resolver novamente o preset persistido.

Acrescentar testes de virada de mês com o componente montado, transição antes/depois da coleta e resposta tardia de um período anterior.

`refetch()` deve atualizar primeiro o sync. Se o intervalo mudar, as novas query keys carregam as fontes; não refazer manualmente a janela antiga. Se permanecer igual, repetir as fontes necessárias, inclusive as que falharam.

```bash
rtk pnpm exec vitest run src/hooks/__tests__/useAdsPainel.test.ts src/hooks/__tests__/useSkuDossie.test.ts
```

### Tarefa 4 — Reaproveitar o seletor com controles acessíveis

**Tempo:** 25–35 minutos.  
**Modificar:** `src/components/ui/seletor-periodo.tsx`.  
**Criar:** `src/components/ads/periodo-ads.tsx`, `tests/components/seletor-periodo.test.tsx`.

- [ ] Testar configuração Ads e defaults dos consumidores existentes.
- [ ] Confirmar falha.
- [ ] Implementar as quatro props opcionais e `aria-pressed`; compor `PeriodoAdsBar`.
- [ ] Executar teste do seletor e regressão dos filtros de movimentos.
- [ ] Commit: `feat(ads): add current month using shared period selector`.

```tsx
it('expõe mês atual sem Hoje nem Personalizado no Ads', () => {
  const onPeriodo = vi.fn();

  render(
    <SeletorPeriodo
      periodo={{ tipo: 'mes_atual' }}
      onPeriodo={onPeriodo}
      mostrarMesAtual
      mostrarHoje={false}
      mostrarPersonalizado={false}
    />,
  );

  expect(screen.queryByRole('button', { name: 'Hoje' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Personalizado' }))
    .not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mês atual' }))
    .toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
  expect(onPeriodo).toHaveBeenCalledWith({ tipo: 'preset', dias: 7 });
});

it('preserva os controles atuais quando as novas props são omitidas', () => {
  render(
    <SeletorPeriodo
      periodo={{ tipo: 'preset', dias: 30 }}
      onPeriodo={vi.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Personalizado' })).toBeInTheDocument();
});
```

Não usar o rascunho local de Personalizado para resolver datas do Ads.

```bash
rtk pnpm exec vitest run tests/components/seletor-periodo.test.tsx tests/components/filtros-movimentos.test.tsx
```

### Tarefa 5 — Criar a leitura “Onde agir”

**Tempo:** 30–40 minutos.  
**Criar:** `src/lib/ads-apresentacao.ts`, `src/components/ads/onde-agir-ads.tsx`, `tests/lib/ads-apresentacao.test.ts`.  
**Modificar:** `tests/pages/Ads.test.tsx`.

- [ ] Testar contagens, filtros e semáforo desligado.
- [ ] Confirmar falha.
- [ ] Implementar a derivação e o bloco; manter a ordem de gasto.
- [ ] Testar a ação de filtrar e mover foco.
- [ ] Commit: `feat(ads): expose actionable family status counts`.

No teste de apresentação, usar uma família-base tipada e criar variações explícitas:

```ts
it('atenção inclui acima e sem espaço, preservando a ordem recebida', () => {
  const familias: FamiliaPainel[] = [
    { ...base, codigoPai: 'A', semaforo: 'dentro' },
    { ...base, codigoPai: 'B', semaforo: 'acima' },
    { ...base, codigoPai: 'C', semaforo: null },
    { ...base, codigoPai: 'D', semaforo: 'sem_espaco' },
  ];

  expect(contarFamiliasAds(familias, true)).toEqual({
    total: 4, acima: 1, semEspaco: 1, dentro: 1, semReferencia: 1,
  });
  expect(filtrarFamiliasAds(familias, 'atencao', true).map(f => f.codigoPai))
    .toEqual(['B', 'D']);
  expect(contarFamiliasAds(familias, false).semReferencia).toBe(4);
  expect(filtrarFamiliasAds(familias, 'atencao', false)).toEqual([]);
});
```

A base deve conter todos os campos de `FamiliaPainel`, sem `as unknown as`. Este teste verifica apresentação; os testes existentes de `montarPainelAds` continuam sendo a prova financeira.

Na página:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Ver famílias em atenção' }));
expect(screen.getByRole('heading', { name: 'Famílias por gasto' })).toHaveFocus();
expect(screen.getByRole('button', { name: /Em atenção/ }))
  .toHaveAttribute('aria-pressed', 'true');
```

```bash
rtk pnpm exec vitest run tests/lib/ads-apresentacao.test.ts tests/pages/Ads.test.tsx
```

### Tarefa 6 — Reorganizar o resumo financeiro

**Tempo:** 35–50 minutos.  
**Modificar:** `src/components/ads/resumo-conta.tsx`, `src/lib/ads-apresentacao.ts`, `tests/pages/Ads.test.tsx`.

- [ ] Acrescentar testes de divulgação, desconhecido, provisório e divergência.
- [ ] Confirmar falhas esperadas.
- [ ] Implementar destaque, ponte e expansão acessível.
- [ ] Executar testes da página e da regra pura.
- [ ] Commit: `refactor(ads): prioritize spend and after-ads result`.

```tsx
it('mantém os números centrais visíveis e revela a composição sob demanda', () => {
  montar();
  const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

  expect(resumo.getByText('Despesa de Ads')).toBeVisible();
  expect(resumo.getByText('Resultado após Ads')).toBeVisible();

  fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));
  expect(resumo.getByText('Em famílias')).toBeVisible();
  expect(resumo.getByText('Compartilhado entre famílias')).toBeVisible();
  expect(resumo.getByText('Gasto de Ads não identificado')).toBeVisible();
});

it('não converte resultado desconhecido em zero', () => {
  montar({
    ...PAINEL,
    conta: { ...PAINEL.conta!, lucroAntes: null, resultado: null },
  });

  const resultado = screen.getByRole('group', { name: 'Resultado após Ads' });
  expect(resultado).toHaveTextContent('—');
  expect(resultado).not.toHaveTextContent(/R\$\s*0,00/);
});

it('mantém o selo provisório visível com detalhes fechados', () => {
  montar({ ...PAINEL, conta: { ...PAINEL.conta!, diasAbertos: 14 } });
  expect(screen.getByText('provisório — 14 dias com atribuição em aberto'))
    .toBeVisible();
});
```

Usar `role="group"` com `aria-labelledby` nos grupos financeiros, permitindo consultas sem depender da posição do DOM.

Para divergência, abrir a composição e confirmar aviso visível, ausência de valor não identificado e preservação da despesa total.

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx tests/lib/ads-painel.test.ts
```

### Tarefa 7 — Compactar ranking e preservar detalhes

**Tempo:** 60–80 minutos.  
**Modificar:** `src/components/ads/ranking-familias.tsx`, `tests/pages/Ads.test.tsx`.  
**Criar:** `src/components/ads/detalhe-familia.tsx`, `src/components/ads/gastos-associados.tsx`.

- [ ] Testar expansão, motivo visível, pares total/direto e grupos compartilhados.
- [ ] Confirmar falhas.
- [ ] Implementar cinco colunas, cartões e bloco de gastos associados.
- [ ] Executar testes da página e apresentação.
- [ ] Commit: `refactor(ads): add compact family ranking with progressive details`.

```tsx
it('mostra o motivo sem exigir expansão e mantém resultado conhecido', () => {
  montar();

  const linha = screen.getByRole('row', { name: /Fam B/ });
  expect(within(linha).getByText(/sem vendas no período/i)).toBeVisible();
  expect(linha).toHaveTextContent(/30,00/);
});

it('expande métricas secundárias sem alterar a navegação do nome', () => {
  montar();

  const linha = screen.getByRole('row', { name: /Fam A/ });
  const botao = within(linha).getByRole('button', {
    name: 'Ver detalhes de Fam A',
  });

  fireEvent.click(botao);
  expect(botao).toHaveAttribute('aria-expanded', 'true');

  const detalhe = document.getElementById(botao.getAttribute('aria-controls')!)!;
  expect(within(detalhe).getByText('ROAS (total / direto)')).toBeVisible();
  expect(within(detalhe).getByText('Vendas atribuídas (total / direta)'))
    .toBeVisible();

  expect(within(linha).getByRole('link', { name: /Fam A/ }))
    .toHaveAttribute('href', '/faturamento/sku/familia/A');
});
```

Ajustar os testes existentes conscientemente:

| Teste atual | Nova expectativa |
|---|---|
| Parcelas da despesa no resumo | Abrir “Composição e indicadores” antes de consultar. |
| Compartilhado/não identificado na coluna Gasto | Consultar a região “Gastos associados”; deixa de ser linha da tabela de famílias. |
| ROAS total/direto em toda a tela | Abrir os detalhes; preservar a ordem do par. |
| Data repetida “intervalo · até” | Consultar o intervalo completo e BRT. |
| Hook chamado com número | Esperar `PeriodoAds` estruturado. |

O novo comparativo **ACOS direto × equilíbrio** é uma exceção intencional aos pares total/direto: compara métricas diferentes. Dentro dos detalhes, manter **ACOS total/direto**.

O JSDOM não reproduz os breakpoints do Tailwind. Nos testes, consultar a região de tabela ou lista explicitamente; a alternância visual desktop/mobile será validada no navegador.

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx tests/lib/ads-apresentacao.test.ts
```

### Tarefa 8 — Compor página e estados completos

**Tempo:** 45–60 minutos.  
**Criar:** `src/components/ads/estado-ads.tsx`.  
**Modificar:** `src/pages/Ads.tsx`, `tests/pages/Ads.test.tsx`.

- [ ] Parametrizar testes dos estados e recuperação.
- [ ] Confirmar falhas.
- [ ] Compor o layout, avisos, procedência e reset do filtro por período.
- [ ] Executar a bateria direcionada.
- [ ] Commit: `refactor(ads): compose responsive page and complete state coverage`.

```tsx
it.each(['sem_permissao', 'sem_acesso'] as const)(
  '%s oferece acesso a Canais sem apresentar números',
  estado => {
    montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] });
    expect(screen.getByRole('link', { name: /Abrir Canais/i }))
      .toHaveAttribute('href', '/canais');
    expect(screen.queryByRole('region', { name: 'Resumo da conta' }))
      .not.toBeInTheDocument();
  },
);

it('conta indisponível não remove famílias nem inventa zero', () => {
  montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura' });
  expect(screen.getByText(/Total da conta indisponível/)).toBeVisible();
  expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
});

it('mês aguardando coleta oferece 30 dias', () => {
  hook.mockReturnValue({
    painel: null,
    janela: null,
    situacaoPeriodo: 'aguardando_mes',
    historicoDesde: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
  render(<MemoryRouter><Ads /></MemoryRouter>);

  fireEvent.click(screen.getByRole('button', { name: 'Ver últimos 30 dias' }));
  expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 30 });
});
```

Acrescentar `localStorage.clear()` no `beforeEach` de `Ads.test.tsx` e restaurar mocks após os testes de storage.

Cobrir também `sem_coleta`, `coletando`, `sem_advertiser`, `sem_ads`, erro/retry, desatualizado e ausência de famílias. Os testes devem verificar texto e comportamento, sem snapshots extensos de classes.

```bash
rtk pnpm exec vitest run tests/pages/Ads.test.tsx tests/lib/ads-painel.test.ts tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts src/hooks/__tests__/usePeriodoAds.test.ts
```

### Tarefa 9 — Validar visualmente e registrar a mudança

**Tempo:** 60–120 minutos.  
**Arquivos:** somente os componentes que precisarem de correção; atualização pontual do ADR-0179.

- [ ] Gerar a matriz de prints e medir overflow/contraste.
- [ ] Corrigir desvios de layout, foco e legibilidade.
- [ ] Executar testes afetados, lint dos arquivos alterados e preflight da skill.
- [ ] Registrar evidências e a exceção dos travessões obrigatórios.
- [ ] Commit: `test(ads): verify responsive states and document monthly preset`.

Antes do Vite, garantir `.env.local` no worktree com as variáveis exigidas pelo projeto, sem imprimir valores.

A etapa não exige alterações no dossiê. Executar sua regressão porque o seletor compartilhado mudou:

```bash
rtk pnpm exec vitest run src/hooks/__tests__/useSkuDossie.test.ts tests/lib/sku-ads.test.ts tests/components/seletor-periodo.test.tsx tests/components/filtros-movimentos.test.tsx
```

## 8. Critérios de aceite visual e funcional

### 8.1 Matriz de screenshots

| Cenário | Capturas |
|---|---|
| Dados completos, semáforo ligado, nomes longos | 360×800, 1440×900 e 1920×1080, claro e escuro: seis capturas |
| Histórico insuficiente, compartilhados, custo parcial e zero medido | 360 e 1440, ambos os temas |
| Sem Ads e Mês atual aguardando coleta | 360 e 1440, ambos os temas |
| Conta indisponível, divergente e desatualizado | 360 e 1440, ambos os temas |
| Expansão, foco por teclado e erro/retry | 360 e 1440; incluir detalhe aberto e foco visível |

Usar fixtures locais para estados injetados. Não alterar dados de produção para produzir screenshots.

Cada captura deve registrar tema, viewport, preset, intervalo efetivo e cenário. Não comparar contas ou períodos diferentes como se fossem evidência de regressão financeira.

### 8.2 Medições objetivas

**Overflow da página:**

```js
document.documentElement.scrollWidth <=
  document.documentElement.clientWidth + 1
```

Deve ser verdadeiro nas três larguras, com detalhes abertos e fechados.

**Tabela em 1440 px:**

```js
const tabela = document.querySelector('[data-slot="table-container"]');
tabela.scrollWidth <= tabela.clientWidth + 1;
```

Deve caber sem scroll horizontal no cenário de títulos e valores representativos. Não aceitar `overflow-hidden` como correção de colunas cortadas.

**Hierarquia:**

- Em 1440×900, resumo, atenção, filtros e três famílias visíveis no cenário normal.
- Em 360×800, despesa, resultado e começo de “Onde agir” visíveis.
- O nome completo, métricas secundárias e motivos continuam acessíveis.
- Valores desconhecidos são `—`; zeros medidos usam formato monetário/numérico.
- A ordem dos pares total/direto é consistente.

### 8.3 Acessibilidade

| Verificação | Aceite |
|---|---|
| Contraste | Texto normal ≥4,5:1; texto grande ≥3:1; controles/foco ≥3:1 contra adjacências. Medir claro e escuro. |
| Toque | Alvos novos ≥44×44 px; intervalos de 8 px entre controles independentes. |
| Teclado | Selecionar período, filtrar, expandir, abrir dossiê e repetir consulta sem mouse. |
| Leitor de tela | Um `h1`; seções nomeadas; `<th scope="col">`; `aria-pressed`, `aria-expanded` e IDs únicos. |
| Ampliação | Zoom de 200%, texto longo e movimento reduzido sem perda de acesso às ações. |

Não presumir que a existência de um token garante AA em qualquer combinação de opacidade. Medir `StatusPill`, botão selecionado, textos auxiliares e superfícies reais.

### 8.4 Preflight da skill

Executar sobre os arquivos alterados:

```bash
rtk proxy bash /Users/diego/.claude/skills/frontend-design-fable5/scripts/preflight.sh \
  --allow-lucide \
  src/pages/Ads.tsx \
  src/components/ads \
  src/components/ui/seletor-periodo.tsx \
  src/lib/ads-apresentacao.ts
```

O scanner foi inspecionado: ele reprova qualquer `—` ou `–`.

**Exceção explícita do brief:** manter `—` para desconhecido e o texto “provisório — N dias com atribuição em aberto”. A exigência do produto prevalece sobre a skill. Registrar os locais atingidos; não substituir por zero, ocultar o caractere com escape ou declarar exit code zero quando não ocorreu.

Checklist final:

- [ ] Tokens e componentes existentes; nenhuma identidade nova ou efeito do Pulse.
- [ ] Estados completos e informação essencial acessível sem hover.
- [ ] Nenhuma falha mecânica não justificada pelo brief.
- [ ] Revisão independente da UI construída com evidência de arquivo/linha e screenshots.
- [ ] Rubrica de system work: consistência, cobertura de estados, tipografia, contenção e acessibilidade.

A revisão do plano pelo Opus não substitui a revisão da interface renderizada.

## 9. Riscos e limites de escopo

| Risco | Controle |
|---|---|
| Expandir um seletor usado em outras telas | Props opcionais com defaults preservados; testes dos consumidores relevantes. |
| Mês sem dias elegíveis virar loading infinito ou consulta inválida | União discriminada, janela pública nula e gating testado. |
| Compactação esconder ressalvas financeiras | Motivos bloqueantes e selo provisório fora da expansão; demais detalhes com acesso explícito. |
| “Onde agir” parecer recomendação automática de orçamento | Apenas classificação existente e link ao dossiê; sem fila, escrita ou nova pontuação. |
| Prints antigos conduzirem regressão | Código e ADR prevalecem: semáforo ligado, pares consistentes e limites BRT preservados. |

**Fora desta entrega:** Mês anterior, Personalizado, gráficos novos, comparações de tendência, campanhas, metas configuráveis, exportação, busca/paginação nova, alteração de custos, rateio, escrita no ML e redesenho do dossiê.

**Nenhum campo novo em `ads-painel.ts` é necessário.** As contagens são derivadas dos semáforos existentes; a situação mensal pertence ao recorte temporal do hook.

**Próxima ação, 2 minutos:** encaminhar este plano ao Opus 5.5 para revisar os contratos de período, a preservação das regras financeiras e a matriz de estados.