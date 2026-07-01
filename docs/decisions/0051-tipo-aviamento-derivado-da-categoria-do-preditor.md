# ADR-0051 — Tipo de aviamento derivado da categoria do preditor (obrigatórios curados sempre montados)

**Data:** 2026-07-01
**Status:** aceito (implementado na branch `worktree-fix-classificacao-barbante-lote49`, aguardando validação)
**Decisores:** Diego
**Relaciona:** corrige lacuna de [ADR-0009](0009-campos-payload-ml-e-categoria-deterministica.md) (tipo determinístico por regex) e [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (categoria/atributos por preditor+IA); interage com [ADR-0049](0049-atributos-opcionais-e-numericos-por-ia.md)

## Contexto

O lote #49 falhou na publicação de 3 famílias de **barbante**:

- `00456713` — ML recusou: `The attributes [MODEL, BRAND] are required for category MLB270273`.
- `01187678` e `03075788` — recusa transiente de foto que, mesmo resolvida, bateria no mesmo erro de atributos.

Investigação (banco de produção): as 3 tinham `tipo_aviamento = 'outro'`, `categoria_ml_id = MLB270273`
(**Fios e Cadarços** — a categoria de `linha`), `atributos_ml = []` e `atributos_faltantes = []`. Na mesma
categoria, **13 famílias publicadas com `tipo = 'linha'` (0 erros)**.

Duas causas compostas:

1. **Classificação incompleta.** A regex de tipo (`detectar.ts`) não tinha o termo `barbante`. Barbante é
   fio de algodão → deveria ser `linha`, mas caía em `outro`.
2. **Tipo perdido no caminho do preditor.** Sem override de regex, o `resolverCategoria` chama o preditor
   do ML, que **acerta a categoria** (MLB270273), mas o resultado era devolvido com `tipo: 'outro'` fixo.
   Como os obrigatórios curados (`OBRIGATORIOS`) são indexados por **tipo**, `tipo = 'outro'` (`OBRIGATORIOS.outro = []`)
   fazia o `process-familia` seguir o ramo genérico (schema dinâmico + IA). Quando esse ramo falha, o
   `catch` deixa `atributos_ml = []` **e** `atributos_faltantes = []` — a família fica publicável com zero
   atributos e sem faltantes sinalizados, e o erro só aparece na recusa do ML (tarde demais).

"Sempre funcionou": lotes anteriores tinham `LINHA`/`CONE`/`FIO` no nome (casavam a regex); este trouxe
`BARBANTE`.

## Decisão

1. **`barbante`/`barbantes` entram na regex de `linha`** (`detectar.ts`) — barbante é fio.
2. **Lookup reverso categoria → tipo** (`tipoParaCategoria` em `atributos.ts`): quando o preditor devolve uma
   categoria-folha que já temos como override (MLB270273, MLB255054, MLB270272, MLB277319), o `resolverCategoria`
   recupera o tipo correspondente em vez de fixar `'outro'`. Categoria desconhecida → `'outro'` (inalterado).
3. **`process-familia` usa o caminho determinístico para todo tipo conhecido**: a condição de entrada passa de
   `cat.origem === 'regex'` para `categoriaParaTipo(tipo) != null`. Assim, tipo conhecido — venha da regex ou
   derivado da categoria do preditor — monta os obrigatórios curados (`montarAtributosML`) e só então enriquece
   pelo schema/IA (ADR-0049). Os obrigatórios deixam de depender do schema/IA, que podem falhar.

## Consequências

- Barbante (e qualquer produto cujo preditor aponte para uma categoria de aviamento conhecida) sai com
  `BRAND`/`MODEL` garantidos → some a recusa de atributo obrigatório do ML.
- Fecha a classe do bug, não só barbante: o descasamento tipo↔categoria não reaparece para categorias conhecidas.
- O enriquecimento do ADR-0049 continua igual (mesma lógica interna, só a condição de entrada foi ampliada).
- Não altera categorias fora do conjunto de aviamentos conhecidos (continuam no ramo genérico).
- Ainda existe o risco residual da falha silenciosa do ramo genérico (catch → atributos/faltantes vazios) para
  categorias **não** conhecidas; mitigação futura registrada em `docs/TASKS.md` (não incluída aqui para manter o
  fix focado).
