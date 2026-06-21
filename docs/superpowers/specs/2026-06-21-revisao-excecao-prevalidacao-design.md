# Fatias 3 e 4 — Revisão por exceção + Pré-validação do upload

> Tarefa 2 / Onda 1 / Fatias 3 e 4 (juntas). Fecham a Onda 1 (workflow operacional contínuo).

## Fatia 3 — Revisão orientada a exceções

**Goal:** na Revisão, os itens que precisam de ação aparecem no topo; "tudo certo" fica abaixo. Reaproveita as tabs/filtros existentes (não os remove).

### `src/lib/revisao-ordem.ts` (função pura, testável)
```ts
export function prioridadeExcecao(f: Familia): number; // menor = mais urgente
export function ordenarPorExcecao(familias: Familia[]): Familia[]; // sort estável
```
Prioridade (0 = topo):
| 0 | `status === 'erro'` |
| 1 | precisa de ação — `familiaIncompleta(f)` (sem foto/cor/etc.) |
| 2 | aviso — `f.precoAbaixo20pc` |
| 3 | pronto, sem pendência (não publicado) |
| 4 | `status === 'publicado'` |

Sort **estável**: dentro do mesmo nível mantém a ordem original (código/planilha).

### Integração
`Revisao.tsx`: aplicar `ordenarPorExcecao` sobre o resultado de `filtrarFamilias` (antes da paginação). Filtros/tabs/busca inalterados — só a ordem da lista muda.

## Fatia 4 — Pré-validação guiada do upload

**Goal:** no Novo lote, validar as colunas obrigatórias da planilha **no cliente, antes de enviar**, com feedback inline; bloquear "Processar" se faltar coluna. Backend continua validando (defesa em profundidade).

### `src/lib/validar-planilha.ts`
```ts
export const COLUNAS_OBRIGATORIAS_PLANILHA: string[]; // espelha _shared/types.ts (14 colunas)
export function colunasFaltando(headers: string[]): string[]; // uppercase+trim, retorna ausentes
export function lerCabecalhoXlsx(file: File): Promise<string[]>; // SheetJS: 1ª linha de headers
```
14 colunas (do backend): CODIGO, PAI, NOME, UNIDADE, GTIN, CUSTO, PRECO, ESTOQUE, DESCRICAO_DETALHADO, PESO_GRAMAS, ALTURA_CM, LARGURA_CM, COMPRIMENTO_CM, FORNECEDOR. Comparação case-insensitive (igual ao backend).

### Integração
`NovoLote.tsx`: ao selecionar a planilha, ler o cabeçalho e validar. Feedback inline:
- **OK:** "✓ Planilha válida — 14 colunas obrigatórias presentes" (verde).
- **Faltando:** "Faltam colunas obrigatórias: X, Y" (destrutivo) + bloqueia "Processar".
- **Ilegível:** aviso brando "Não consegui ler o cabeçalho — confira se é um .xlsx válido" (não bloqueia hard; backend ainda valida).
`podeProcessar` passa a exigir planilha sem colunas faltando.

## Escopo de arquivos
- **Criar:** `lib/revisao-ordem.ts` + teste · `lib/validar-planilha.ts` + teste (do `colunasFaltando` puro).
- **Modificar:** `Revisao.tsx` (ordenação), `NovoLote.tsx` (validação inline).

## Testes
- **Unit:** `ordenarPorExcecao`/`prioridadeExcecao` (ordem por grupo + estabilidade); `colunasFaltando` (completo, faltando 1+, case-insensitive, espaços).
- **Visual (navegador, light+dark):** Revisão com famílias ordenadas (override temp se faltar dado real); Novo lote com planilha válida/ inválida.

## Não-objetivos
Mudar tab default da Revisão (só ordena, sem surpresa) · validar valores célula-a-célula no cliente (backend faz) · ações em massa (Onda 2).
