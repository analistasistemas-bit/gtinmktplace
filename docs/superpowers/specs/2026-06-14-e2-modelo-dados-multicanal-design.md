# E2 — Modelo de dados multicanal (`anuncios_externos`) — Design

**Data:** 2026-06-14
**Épico:** Fase 0 / E2 · **ADR:** [0025](../../decisions/0025-modelo-de-dados-multicanal.md)
**Relaciona:** ADR-0007 (modelo), ADR-0021 (catálogo), E1/E1b (camada de abstração de canais)
**Status:** aprovado (Diego, 2026-06-14)

## 1. Objetivo

Desacoplar o **estado de publicação** do produto, criando a estrutura **1 produto → N anúncios (por
canal)** que destrava o 2º marketplace (Shopee). Refactor **aditivo e de baixo risco**: nada que hoje
fatura muda de fonte de verdade.

## 2. Decisões-chave (do ADR-0025)

1. **Âncora `(user_id, canal, codigo_pai)`**, não `familia_id` — `familias` é por-lote e várias linhas
   compartilham o mesmo `ml_item_id` após UPDATE; `(user_id, codigo_pai)` é a identidade estável.
2. **Estoque único** (fica na `variacoes`); estoque-por-canal é YAGNI/diferido.
3. **`canais_conectados` fora do E2** (vai para o E7/tenancy); `ml_credentials` continua.
4. **Strangler dual-write:** workers gravam `ml_*`/`catalog_*` como hoje **e** espelham em
   `anuncios_externos`. Leitura/idempotência **inalteradas**.
5. **`catalog_*` (ADR-0021)** vai para o mapa `variacoes_externas` JSONB.

## 3. Schema

### 3.1 Enum `canal_externo`

```sql
create type public.canal_externo as enum ('mercado_livre');
```

Extensível (`alter type … add value 'shopee'`) sem migração de dados.

### 3.2 Tabela `anuncios_externos`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid not null | FK `auth.users`, `on delete cascade` |
| `canal` | `canal_externo` not null | |
| `codigo_pai` | text not null | identidade do produto lógico |
| `item_externo_id` | text | `= ml_item_id` |
| `permalink` | text | |
| `status` | text not null default `'publicado'` | estado de publicação no canal |
| `erro_mensagem` | text | |
| `variacoes_externas` | jsonb not null default `'{}'` | mapa `codigo → { variation_id, catalog_product_id, catalog_listing_id, catalog_status }` |
| `metadados_canal` | jsonb not null default `'{}'` | reservado (capa picture ids etc. — vazio hoje) |
| `preco_override` | numeric | reservado (null hoje) |
| `publicado_em` | timestamptz | |
| `atualizado_em` | timestamptz not null default `now()` | trigger `moddatetime` |

- **unique `(user_id, canal, codigo_pai)`** → upsert idempotente do espelho.
- Índice `(user_id, canal)` para listagens futuras.
- RLS por `user_id` (select/insert/update/delete own) — padrão das tabelas de domínio.
- **Sem FK para `familias`** (codigo_pai não é único lá; familia_id não é estável).

### 3.3 Forma do `variacoes_externas`

```jsonc
{
  "02841037": {
    "variation_id": "175...:...",
    "catalog_product_id": "MLB34175726",
    "catalog_listing_id": "MLB6937529524",
    "catalog_status": "vinculado"
  },
  "02841053": { "variation_id": "175...:...", "catalog_status": "pendente" }
}
```

Só inclui variações com `ml_variation_id` (casadas). Campos `catalog_*` ausentes quando não há vínculo.

## 4. Backfill (na própria migration)

Para cada `(user_id, codigo_pai)` com `ml_item_id` não nulo, usa a **família mais recente** (último lote):

```sql
insert into public.anuncios_externos
  (user_id, canal, codigo_pai, item_externo_id, permalink, status, variacoes_externas, publicado_em)
select distinct on (f.user_id, f.codigo_pai)
  f.user_id, 'mercado_livre'::public.canal_externo, f.codigo_pai,
  f.ml_item_id, f.ml_permalink, 'publicado',
  coalesce((
    select jsonb_object_agg(v.codigo, jsonb_strip_nulls(jsonb_build_object(
      'variation_id', v.ml_variation_id,
      'catalog_product_id', v.catalog_product_id,
      'catalog_listing_id', v.catalog_listing_id,
      'catalog_status', nullif(v.catalog_status, 'pendente')
    )))
    from public.variacoes v
    where v.familia_id = f.id and v.ml_variation_id is not null
  ), '{}'::jsonb),
  f.publicado_em
from public.familias f
where f.ml_item_id is not null
order by f.user_id, f.codigo_pai, f.publicado_em desc nulls last
on conflict (user_id, canal, codigo_pai) do nothing;
```

**Verificação:** `count(distinct (user_id, codigo_pai)) where ml_item_id not null` em `familias` deve
igualar `count(*)` em `anuncios_externos`.

## 5. Helper de espelhamento — `_shared/anuncios/espelhar.ts`

### 5.1 Pura `montarAnuncioExterno` (TDD)

```ts
type VariacaoEspelho = {
  codigo: string;
  ml_variation_id: string | null;
  catalog_product_id?: string | null;
  catalog_listing_id?: string | null;
  catalog_status?: string | null;
};
type FamiliaEspelho = {
  user_id: string; codigo_pai: string;
  ml_item_id: string | null; ml_permalink: string | null;
  status?: string; publicado_em?: string | null;
};
type AnuncioExternoRow = {
  user_id: string; canal: 'mercado_livre'; codigo_pai: string;
  item_externo_id: string | null; permalink: string | null;
  status: string; variacoes_externas: Record<string, unknown>;
  publicado_em: string | null;
};

export function montarAnuncioExterno(
  familia: FamiliaEspelho,
  variacoes: VariacaoEspelho[],
): AnuncioExternoRow;
```

Regras:
- Inclui no mapa **só** variações com `ml_variation_id` não nulo.
- Cada entrada: `variation_id` + `catalog_*` presentes só quando não nulos/≠`'pendente'`
  (`jsonb_strip_nulls` equivalente em TS).
- `status` default `'publicado'`; `canal` fixo `'mercado_livre'`.

### 5.2 Thin upsert `espelharAnuncioExterno(admin, familia, variacoes)`

`admin.from('anuncios_externos').upsert(row, { onConflict: 'user_id,canal,codigo_pai' })`.
**Best-effort:** falha logada (`console.error`), **não** derruba a publicação (o `ml_*` já é a fonte de
verdade). Sem `throw`.

## 6. Pontos de dual-write (workers)

| Worker | Onde | O quê |
|---|---|---|
| `publish-familia-ml` | após casar `ml_variation_id` das variações (antes do `Response` de sucesso) | `espelharAnuncioExterno` com `familia` (já com `ml_item_id`/`permalink`) + variações recarregadas |
| `update-familia-ml` | após casar novas + sincronizar descrição (antes do `Response`) | idem (recarrega variações com `ml_variation_id` atualizado) |
| `vincular-catalogo` | após persistir `catalog_*` nas variações | idem (mapa reflete `catalog_*` novos) |

Em todos: recarregar as variações do banco (`select codigo, ml_variation_id, catalog_*`) **depois** das
escritas `ml_*`, montar a row e fazer upsert. Como é best-effort, o `try/catch` interno do helper isola.

## 7. Tipos

Regenerar `src/lib/database.types.ts` (MCP `generate_typescript_types`) após a migration. Nenhum consumo
no frontend muda (dual-write não toca leitura).

## 8. Testes / critério de saída

- **TDD `montarAnuncioExterno`:** mapa com casadas+não-casadas; catalog presente/ausente; sem variação
  casada → mapa `{}`; permalink/publicado_em propagados.
- **Backfill:** SQL de verificação de contagem bate.
- **Bug bash real (browser-use):** publicar uma família de teste (CREATE) → conferir 1 linha em
  `anuncios_externos` com `item_externo_id` e mapa de variações corretos; rodar UPDATE (reposição + cor
  nova) → conferir o mapa atualizado (cor nova com `variation_id`); rodar opt-in de catálogo → conferir
  `catalog_status` no mapa. Limpar o dado de teste ao fim (anúncio encerrado no ML + linhas removidas).
- Backend: `pnpm test` verde; `tsc`/lint limpos.

## 9. Fora de escopo (YAGNI / diferido E2.5)

View de compatibilidade · cutover de leitura · drop das colunas `ml_*`/`catalog_*` · `canais_conectados`
· estoque por canal · `preco_override`/`metadados_canal` em uso.
