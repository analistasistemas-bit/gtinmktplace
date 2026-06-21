# Fatia 2 — Dashboard: painel "Precisa da sua atenção"

> Tarefa 2 / Onda 1 / Fatia 2 de 4. Transforma o Dashboard em centro de ação destacando pendências pós-publicação acionáveis. Sem nova chamada de rede — usa dados já carregados.

**Goal:** o operador vê num bloco único, e só quando existe, o que precisa da atenção dele, com 1 clique para resolver.

## Comportamento

Bloco no Dashboard **abaixo do card "Continuar de onde parei"** e **acima dos KPIs**. Renderiza só se houver ≥1 pendência; senão retorna `null` (sem ruído — o normal é tudo em dia).

### Pendências (dados já presentes no Dashboard)
| Pendência | Origem | Destino "Ver" |
|---|---|---|
| Anúncios com problema | `kpis.comProblema` (moderado/inativo/pausado) | `/publicados` |
| Erros de publicação | lotes com `totalErros > 0` | `/relatorio/{lote mais recente com erro}` |

`label` com plural correto ("1 anúncio com problema" / "3 anúncios com problema").

### `src/lib/pendencias.ts` (função pura, testável)
```ts
export interface Pendencia { chave: 'problema' | 'erro'; label: string; destino: string }
export function montarPendencias(comProblema: number, lotes: Lote[]): Pendencia[];
```
- `comProblema > 0` → pendência `problema` → `/publicados`.
- lotes com `totalErros > 0` → pendência `erro`, soma dos erros, destino = relatório do lote mais recente (maior `criadoEm`).
- nenhuma → `[]`.

### `src/components/dashboard-pendencias.tsx`
`<Pendencias comProblema lotes />`. Monta via `montarPendencias`; se vazio, `null`. Título "Precisa da sua atenção". Cada linha: ícone de atenção (warning) + label + botão "Ver" (Link ao destino). Tom de atenção sutil (borda/realce warning), consistente com os cards planos da Fatia 1.5.

## Escopo de arquivos
- **Criar:** `lib/pendencias.ts`, `tests/lib/pendencias.test.ts`, `components/dashboard-pendencias.tsx`.
- **Modificar:** `Dashboard.tsx` — montar `<Pendencias comProblema={kpis.comProblema} lotes={lotes} />` entre o card de andamento e o grid de KPIs.

## Testes
- **Unit (Vitest):** `montarPendencias` — vazio, só problema (singular/plural), só erro (soma + destino mais recente), ambas.
- **Visual (navegador, light+dark):** Dashboard com pendência (override temporário, depois revertido) e sem pendência (oculto).

## Não-objetivos (outras fatias)
"A revisar" (já no card "Continuar" da Fatia 1) · encalhados (menu Publicados, depende de período) · deep-link com filtro pré-aplicado (Onda 2, #4) · financeiro (não é pendência) · Revisão por exceção (Fatia 3) · pré-validação upload (Fatia 4).
