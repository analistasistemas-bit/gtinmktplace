# CUSTO + FORNECEDOR + Markup — Design

**Data:** 2026-06-05
**Status:** Aprovado (brainstorming) — pronto para plano
**Relacionado:** ADR-0009 (categoria/atributos, BRAND fixo "Avil") · ADR-0008 (preço) · ADR-0016 (UPDATE) · card "Você recebe por venda" (`calcular-tarifa-ml`)

## Objetivo

A planilha do sistema interno passou a exportar duas colunas novas: **CUSTO** (custo do produto) e **FORNECEDOR**. Este design integra ambas ao PubliAI:

1. **FORNECEDOR** substitui o valor fixo `"Avil"` no atributo **BRAND** do anúncio ML.
2. **CUSTO** alimenta o cálculo de **markup** (e lucro em R$) por anúncio, distinguindo **Clássico** vs **Premium** (que diferem na comissão do ML).

## Decisões (do brainstorming)

| Tema | Decisão |
|---|---|
| Métrica | **Markup sobre o custo** + lucro em R$, por tipo. `markup = (líquido − custo) / custo`; `lucro = líquido − custo`. Sempre sobre o **líquido** (após comissão), por isso difere entre Clássico/Premium. |
| Onde exibir | **Dentro do card "Você recebe por venda"** — uma linha de lucro/markup em cada coluna (Clássico/Premium) que já existe. |
| Obrigatoriedade | **Obrigatórias.** CUSTO vazio → ingest rejeita o lote (igual às outras colunas). FORNECEDOR vazio → fallback `"Avil"` (marca nunca fica em branco no ML). |
| Granularidade | CUSTO é **por variação**; FORNECEDOR é **por família** (BRAND é atributo do anúncio, vem da linha PAI). |
| Custo no card | **Custo representativo da família** = custo da variação incluída que define o `precoPublicacao` exibido (menor preço; empate → primeira). Custo nulo/0 → oculta as linhas de markup, mantém o "recebe". |

**Fora de escopo (YAGNI):** markup por cor individual; edição do fornecedor/marca na UI.

## Arquitetura

### 1. Planilha & parser (`_shared/parser.ts`, `_shared/types.ts`)

- `COLUNAS_OBRIGATORIAS` += `CUSTO`, `FORNECEDOR` (a ordem não importa; `validarColunas` checa pertencimento ao conjunto).
- `PlanilhaRow` += `CUSTO: number`, `FORNECEDOR: string`.
- `FamiliaAgrupada` += `fornecedor: string` — extraído da **linha PAI** (`pai.FORNECEDOR`), como já é feito com `nome_pai`/`descricao_pai`/`unidade`.
- `ingest-lote` mapeia: `CUSTO: Number(r.CUSTO ?? 0)`, `FORNECEDOR: String(r.FORNECEDOR ?? '')`.

### 2. Banco (migration aditiva)

- `variacoes.custo numeric` — custo do produto (distinto de `custo_centavos`, que é custo de IA).
- `familias.fornecedor text` — marca da família.
- Tipos regenerados (`supabase gen types`).

### 3. Persistência no ingest (`ingest-lote/index.ts`)

- Variação (CREATE e UPDATE): `custo: v.CUSTO`.
- Família (CREATE e UPDATE): `fornecedor: g.fornecedor`.
- No UPDATE, `custo`/`fornecedor` são gravados (markup funciona no UPDATE), mas o `atributos_ml` (BRAND) continua **herdado** do anúncio anterior (ADR-0016 — UPDATE não altera atributos). A marca nova só vale em publicações CREATE.

### 4. BRAND a partir do fornecedor (`_shared/categoria/atributos.ts`, `process-familia`)

- `montarAtributosML(tipo: TipoAviamento, nome: string, marca: string)` — novo parâmetro `marca`.
- Dentro: `const brand = marca?.trim() || 'Avil';` usado em todos os ramos (linha/fita/botão) no lugar da constante `MARCA`.
- `process-familia` (ramo CREATE) passa `claimed.fornecedor` (precisa incluir `fornecedor` no `select` da família e no claim). Ramo UPDATE não chama `montarAtributosML`.

### 5. Markup no card "Você recebe" (frontend)

- **Tipos/adapter** (`tipos-dominio.ts`, `queries.ts`): `Variacao.custo: number | null`; adapter lê `r.custo`; `select` das variações inclui `custo`.
- **Função pura** `calcularMarkup(liquido: number, custo: number): { lucro: number; markup: number }` (novo util, ex. `src/lib/markup.ts`):
  - `lucro = liquido − custo`
  - `markup = lucro / custo` (fração; o componente formata em %)
- **`PainelAnalise`**: calcula `custoRepresentativo` = custo da variação (incluída) cujo `precoPublicacao ?? preco` é o menor (mesma que define `precoPublicacao`); empate → primeira. Passa `custo={custoRepresentativo}` ao `CardVoceRecebe`.
- **`CardVoceRecebe`**: novo prop opcional `custo?: number | null`. Em cada `Coluna` (Clássico/Premium), quando `custo` é válido (`> 0`), renderiza:
  - `lucro` em R$ (`fmtBRL`)
  - `markup` em % (inteiro). Markup < 0 → vermelho com rótulo "prejuízo".
  - Custo nulo/0 → não renderiza as linhas de markup (card volta ao comportamento atual).
- Reatividade: `recebe`/`comissao` já recalculam ao editar o preço de publicação (via `useTarifaML`); o markup acompanha sem trabalho extra.

## Fluxo de dados

```
Planilha (CUSTO, FORNECEDOR)
   │  ingest-lote
   ├─ variacoes.custo  ─────────────► PainelAnalise.custoRepresentativo ─► CardVoceRecebe (markup por tipo)
   └─ familias.fornecedor ──► process-familia (CREATE) ──► montarAtributosML(...,marca) ──► atributos_ml (BRAND) ──► publish
```

## Erros & casos de borda

- Falta CUSTO ou FORNECEDOR na planilha → `validarColunas` lança erro claro; ingest devolve 500 com a coluna ausente.
- FORNECEDOR vazio numa família → BRAND = `"Avil"`.
- CUSTO 0/nulo numa variação representativa → card mostra só o "recebe", sem markup.
- Líquido < custo → markup negativo, exibido em vermelho ("prejuízo") — sinaliza reprecificação.

## Testes (TDD)

- **parser:** valida as 2 colunas novas; `agruparPorPai` popula `fornecedor` a partir da linha PAI; mapeamento de CUSTO numérico.
- **`montarAtributosML`:** usa o fornecedor como BRAND; fallback `"Avil"` quando vazio/só espaços; nos três tipos (linha/fita/botão).
- **`calcularMarkup`:** lucro/markup positivos; líquido < custo (negativo); custo 0 (tratado pelo componente — função recebe só custo > 0).

## Documentação

- **Adendo ao ADR-0009:** BRAND passa de fixo `"Avil"` para o `FORNECEDOR` da planilha (fallback `"Avil"`); registra as colunas novas `variacoes.custo` e `familias.fornecedor`.
- Atualizar `CLAUDE.md` (schema esperado da planilha + histórico) e `docs/TASKS.md` ao concluir.
