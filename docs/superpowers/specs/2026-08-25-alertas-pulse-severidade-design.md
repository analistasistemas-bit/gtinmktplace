# Alertas do Pulse: severidade gravada e área dedicada — design

**Data:** 2026-08-25
**ADR:** [0133](../../decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md)
**Status:** design aprovado, implementação não iniciada

## Objetivo

Tirar os alertas da lista corrida no topo do Radar e colocá-los numa aba própria que continue
legível com milhares de produtos, exibindo por padrão apenas os alertas que exigem decisão de preço.

## Fatos medidos (produção, 2026-08-25)

Não repetir a medição na implementação; estes números já orientaram o desenho.

- 228 produtos no radar; 180 com ofertas ativas; 95 com `meu_preco` não nulo.
- 262 alertas em 10 dias (~26/dia, pico 42). Taxa: 0,11 por produto por dia.
- 145 não lidos em 60 produtos distintos no momento da medição.
- Tipos: `concorrente_saiu` 48%, `novo_concorrente` 35%, `preco_caiu` 17%.
- Exigiam decisão: 14 de 262 (5%). Projeção a 2.000 produtos: ~230 alertas/dia, ~12/dia de ação.
- 52 dos 95 produtos com preço nosso têm concorrente relevante abaixo **agora** (estado, não evento).

## Arquitetura

Três camadas, cada uma com uma responsabilidade:

1. **Classificador (puro)** — decide `acao` vs `info` a partir do diff e do nosso preço.
   Vive em `supabase/functions/_shared/pulse/diff.ts`, sem I/O, testável isoladamente.
2. **Coletor** — fornece o `meu_preco` do mesmo snapshot e persiste a severidade.
   `supabase/functions/pulse-coletar/processar.ts`.
3. **Área dedicada** — lê, filtra, conta e marca como lido.
   `src/pages/Pulse.tsx` + componente novo + `src/lib/pulse.ts`.

### Fluxo do dado

```
ficha do ML ─┬─ ofertas concorrentes ──┐
             └─ nossa oferta ──────────┤
                                       ▼
              AlertaPendente { produtoId, anteriores, atuais, estadoGravado, meuPreco }
                                       ▼
              entradaDiffRelevante (ADR-0130) ── diffOfertas ── AlertaNovo{tipo,payload,severidade}
                                       ▼
              insert em pulse_alertas (severidade congelada)
                                       ▼
              aba Alertas: filtro por severidade · contagem exata · marcar lido escopado
```

## Banco

Migration nova (`supabase migration new pulse_alertas_severidade`), aplicada por
`supabase db push` — nunca pelo painel (ADR-0043).

```sql
alter table public.pulse_alertas
  add column severidade text not null default 'info'
    check (severidade in ('acao','info'));

-- Contagem do badge e filtro da aba: sempre org + não lido + severidade.
create index pulse_alertas_org_sev_lido_idx
  on public.pulse_alertas (org_id, severidade, lido, criado_em desc);
```

O `default 'info'` é o backfill: as linhas existentes ficam informativas sem `UPDATE` (ADR-0133 D-8).

**Grants e RLS: nada a fazer.** `grant select on public.pulse_alertas to authenticated`
(`20260816125057_pulse_v1.sql:75`) é table-level e cobre a coluna nova. O update do app continua
escrevendo só `lido`, coberto por `grant update (lido)` (linha 80) e pela policy de update por org
(linhas 78-79); filtrar o `WHERE` por `severidade` exige apenas SELECT, já concedido. A escrita de
`severidade` é do coletor via service_role, que ignora RLS.

`database.types.ts` segue não regenerado para as tabelas `pulse_*` (cast `as never` em
`src/lib/pulse.ts:10-14`) — basta acrescentar `severidade` à string do select.

## Backend

### `_shared/pulse/tipos.ts`

`AlertaNovo` ganha `severidade: 'acao' | 'info'`.

### `_shared/pulse/diff.ts`

`diffOfertas` passa a receber o nosso preço e a classificar cada alerta que emite:

```ts
export function diffOfertas(
  anteriores: OfertaAnterior[],
  atuais: OfertaColetada[],
  opcoes?: { primeiraColeta?: boolean; meuPreco?: number | null },
): DiffOfertas
```

Regra (ADR-0133 D-2). `meuPreco` nulo ou não finito → **tudo `info`**, sem exceção.

| Tipo | `acao` quando |
|---|---|
| `preco_caiu` | `minAtual < meuPreco` |
| `novo_concorrente` | `atual.preco < meuPreco` |
| `concorrente_saiu` | quem saiu estava abaixo de nós (`d.preco < meuPreco`) **e**, depois da saída, ninguém mais está: `!Number.isFinite(minAtual) \|\| minAtual >= meuPreco` |

A condição do `concorrente_saiu` olha o mercado **depois** da saída, não o de antes. Testar contra
`minAntes` produz um alerta perigoso: com concorrentes a R$70 e R$71 e nosso preço a R$75, a saída
do de R$70 avisaria "pode subir" enquanto o de R$71 continua abaixo de nós. As duas condições juntas
significam exatamente "quem nos segurava embaixo saiu e ninguém tomou o lugar".

`minAtual` já é calculado logo acima do laço de saídas (`diff.ts:64`) e está em escopo. O cuidado com
`Number.isFinite` é o mesmo do `preco_caiu` (`diff.ts:65`): `Math.min(...[])` devolve `Infinity`, não
`null` — ficha que ficou sem nenhuma oferta relevante é o caso mais forte de `acao` (não sobrou
ninguém para nos furar), e um teste de finitude solto a descartaria em silêncio.

As entradas já chegam filtradas por `entradaDiffRelevante`, então "menor" aqui é sempre "menor
relevante" — não reimplementar a qualificação (ADR-0130 D-4 proíbe cópia da regra).

O payload dos **três** tipos ganha `meu_preco` (o número usado na comparação, para o texto explicar
a classificação) e `nickname` quando disponível.

### `pulse-coletar/processar.ts`

1. `AlertaPendente` ganha `meuPreco: number | null`, preenchido no passo 3 com o
   `nossa?.preco ?? null` já extraído em `extrairNossaOferta` (linha ~394). **Em memória — não reler
   `pulse_produtos`** (ADR-0133 D-3).
2. `perfisAtuaisParaAlertas` acrescenta `nickname` ao select (hoje: `seller_id, transactions_total,
   nivel, dia, perfil_coletado_em`, linha ~190).
3. `gravarAlertasRelevantes` passa `meuPreco` ao `diffOfertas`, grava `severidade` no insert e
   retorna `{ total, acao }` em vez de um número.
4. A notificação (linha ~624) usa `acao` (ADR-0133 D-10):
   - `acao > 0` → `Pulse: N alerta(s) exigem decisão — abra o Pulse para agir.`
   - `acao === 0` → `Pulse: N atualização(ões) de mercado.`
   - Link/deep-link com `?tab=alertas` em ambos.

## Frontend

### `src/lib/pulse.ts`

```ts
type SeveridadeAlerta = 'acao' | 'info';
type FiltroSeveridade = SeveridadeAlerta | 'todos';

fetchPulseAlertas(opcoes: { severidade: FiltroSeveridade; pagina: number })  // .range(), 50/página
contarPulseAlertas(severidade: FiltroSeveridade): Promise<number>            // count exact, head true
marcarAlertasLidos(severidade: FiltroSeveridade): Promise<void>              // escopo só local
```

**As três operam apenas sobre `lido = false`.** A área dedicada é a caixa de não lidos, não o
arquivo histórico: o badge conta não lidos de `acao`, a lista mostra não lidos do filtro ativo e o
marcar age sobre os não lidos do filtro ativo. Consultar alertas já lidos está fora de escopo.

- `PulseAlerta` ganha `severidade`.
- `fetchPulseAlertas` perde o `.limit(20)`.
- `marcarTodosAlertasLidos` é substituída por `marcarAlertasLidos`, que aplica
  `.eq('severidade', …)` quando o filtro não é `todos`. **Nunca** filtrar por título de produto
  (ADR-0133 D-9).
- Chaves de cache novas em `src/lib/queries.ts`, parametrizadas por severidade e página.

### `src/pages/Pulse.tsx`

- `tab` passa a aceitar `'radar' | 'sonar' | 'alertas'` — dois pontos a tocar: a leitura
  (linha ~39) e o `onValueChange` (linha ~121), que hoje colapsa tudo que não é `sonar` em `{}`.
- `<TabsTrigger value="alertas">` com badge de `contarPulseAlertas('acao')` — some quando zero.
- `<PainelAlertas>` sai da aba Radar. **Nada entra no lugar** (ADR-0133 D-5).
- Os dialogs `DialogDetalhe` e `DialogReprecificar` continuam no nível da página, acionados pela
  nova aba pelos mesmos `setDetalheId` / `setAlertaReprecificar`.

### Componente novo — `src/components/pulse/aba-alertas.tsx`

Substitui `painel-alertas.tsx` (que é removido junto com seu teste).

- Filtro de severidade em `Tabs` ou `ToggleGroup`: **Ação · Informativo · Todos**, abrindo em Ação.
- Cabeçalho com a contagem exata do filtro ativo e o botão `Marcar N como lidos` — sem confirmação.
- Lista paginada de 50 com "Carregar mais"; linha idêntica à atual (texto, `Ver produto`,
  `Reprecificar` para `preco_caiu` com `codigo_pai`, check de marcar lido).
- Estado de erro: mantém a faixa `role="alert"` atual — consulta quebrada nunca pode parecer
  "nenhum alerta".
- **Estado vazio de "Ação"** (o caso do dia 1, com o backfill mandando tudo para `info`): título
  "Nenhum alerta exige decisão agora", com dois caminhos explícitos — `Ver informativos (N)` e um
  link para o Radar com o foco `mais_caro` aplicado (ADR-0133 D-6).

### `src/lib/pulse-alerta-texto.ts`

`textoAlerta` passa a nomear o vendedor quando `payload.nickname` existir, caindo em
`payload.seller_id` e, na falta dos dois, no texto atual:

- `concorrente_saiu` → `LOJA X saiu de <ficha>` (hoje: "Um concorrente saiu de …").
- `novo_concorrente` → `LOJA X entrou em <ficha> a R$ Y`.
- `preco_caiu` inalterado.

## Testes

| Arquivo | Cobre |
|---|---|
| `_shared/pulse/__tests__/diff.test.ts` | Severidade dos 3 tipos × `meuPreco` nulo / acima / abaixo. Inclui: `concorrente_saiu` do único que estava abaixo → `acao`; saída de um dos dois que estavam abaixo, restando um → `info`; saída de quem estava acima → `info`; ficha que ficou sem oferta relevante → `acao`; `meuPreco` nulo → tudo `info`. |
| `src/components/pulse/__tests__/aba-alertas.test.tsx` | Abre em Ação; troca de filtro refaz a query; contagem vem da query de count (não de `lista.length`); `Marcar N como lidos` chama `marcarAlertasLidos` com a severidade ativa; estado vazio de Ação mostra os dois caminhos; erro mostra a faixa. |
| `src/lib/__tests__/pulse-alerta-texto.test.ts` | Nickname presente, nickname ausente com `seller_id`, ambos ausentes. |

Rodar `pnpm lint` e `pnpm test` antes de considerar concluído. A regra de severidade também precisa
de uma prova contra dado real antes do merge (memória: mock não basta para feature nova) — coletar
uma vez com `Atualizar agora` numa org e conferir por SQL que as severidades gravadas batem com a
comparação `menor relevante × meu_preco`.

## Fora de escopo

Notificação por e-mail ou push; regra de severidade configurável por org; modelo de condição aberta;
timeline de mercado no detalhe do produto; agrupamento por produto na lista; busca por produto na
aba; confirmação ao marcar muitos como lidos.

## Documentação a atualizar no mesmo commit da entrega

- `docs/reference/modelo-de-dados.md` — coluna `severidade` em `pulse_alertas`.
- `docs/reference/edge-functions.md` — mudança de contrato do `pulse-coletar` (retorno e notificação).
- `docs/how-to/usar-o-pulse.md` — a aba Alertas e o que cada filtro significa.
- `docs/TASKS.md` e `obsidian-vault/04-Decisões/Índice de ADRs.md`.
