// ADR-0161 — vendas de anúncios ENCERRADOS pela migração "preço por variação".
//
// A migração re-aponta `familias.ml_item_id` para os anúncios novos, e o id antigo sairia de
// `idsPubliai`. Um pedido feito ANTES da migração, se reprocessado depois (reconciliação, backfill,
// webhook atrasado), deixaria de ser reconhecido como venda do PubliAI: `is_publiai=false`, sem
// código, sem custo, fora dos números do app — e disparando o alerta de "venda de SKU fora do
// catálogo". É a mesma classe de falha que, em 2026-08-11, fez 12 unidades venderem sem baixar
// estoque.
//
// O snapshot tirado antes do disparo (`variations[]` com `id` e `seller_custom_field`) resolve
// também o código: o pedido antigo continua sendo resolvido por `variation_id` mesmo quando o ML
// não mandou o SKU no pedido.


export interface BaseMigrados {
  idsPubliai: Set<string>;
  /** chave `"itemId:variationId"` → código da variação. */
  codPorVar: Map<string, string>;
  /** chave `"itemId:variationId"` → GTIN. */
  eanPorVar: Map<string, string>;
}

export interface AnuncioMigrado {
  mlItemIdAnterior: string | null;
  /** `migracao_pxv_snapshot` cru do banco (jsonb). */
  snapshot: unknown;
}

export function fundirAnunciosMigrados(
  base: BaseMigrados,
  migrados: AnuncioMigrado[],
  eanDoCodigo: (sku: string) => string | null,
): void {
  for (const m of migrados) {
    const anterior = m.mlItemIdAnterior;
    if (!anterior) continue;
    base.idsPubliai.add(anterior);

    const snap = Array.isArray(m.snapshot)
      ? m.snapshot as Array<{ id?: unknown; sku?: unknown }>
      : [];
    for (const v of snap) {
      const id = v?.id != null ? String(v.id) : null;
      // SKU vai CRU, sem `normalizarCodigo` — apesar da simetria aparente com o casamento da
      // adoção. Lá se COMPARA snapshot com banco, e normalizar aproxima os dois. Aqui o valor é
      // GRAVADO como o código do produto que a venda resolve, e os mapas vizinhos deste módulo
      // (`eanPorCodigo`, `codPorItem`, em `io.ts`) são todos populados com `variacoes.codigo` cru.
      // `normalizarCodigo` faz `padStart(8, '0')`, então normalizar aqui produziria `000000V1` para
      // um código `V1` — um código que não existe em lugar nenhum, e que nenhum lookup encontraria.
      const sku = typeof v?.sku === 'string' && v.sku !== '' ? v.sku : null;
      if (!id || !sku) continue;
      const chave = `${anterior}:${id}`;
      // `if (!has)`: o anúncio encerrado não pode sobrescrever um mapeamento vivo. Se um id de
      // variação coincidir com o de um anúncio atual, quem manda é o atual — o antigo é histórico.
      if (!base.codPorVar.has(chave)) base.codPorVar.set(chave, sku);
      const ean = eanDoCodigo(sku);
      if (ean && !base.eanPorVar.has(chave)) base.eanPorVar.set(chave, ean);
    }
  }
}
