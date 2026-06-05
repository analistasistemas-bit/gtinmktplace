import type { Familia } from '@/lib/tipos-dominio';
import { fmtMilhar } from '@/lib/formato';

// UPDATE: mostra, por cor casada, o estoque antes→depois (só as que mudaram),
// e sinaliza cores novas/removidas (mudança estrutural, não aplicada).
export function DiffEstoque({ familia }: { familia: Familia }) {
  if (familia.operacao !== 'UPDATE') return null;

  const mudaram = familia.variacoes.filter(
    (v) => v.mlVariationId && !v.excluidaDaPublicacao && v.estoqueAnterior !== v.estoque,
  );
  const me = familia.mudancaEstrutural;

  return (
    <div className="mb-4 rounded border bg-background p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        ATUALIZAÇÃO DE ESTOQUE
      </div>
      {mudaram.length === 0 ? (
        <div className="text-xs text-muted-foreground">Nenhuma mudança de estoque nesta família.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {mudaram.map((v) => (
            <li key={v.codigo} className="flex items-center gap-2">
              <span className="font-medium">{v.cor || v.codigo}</span>
              <span className="text-muted-foreground">
                estoque {fmtMilhar(v.estoqueAnterior ?? 0)} → {fmtMilhar(v.estoque)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {me && (
        <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <span className="font-semibold">Mudança estrutural:</span>
          {me.novas.length > 0 && (
            <div>Cores novas (marque "incluir" na lista para publicá-las): {me.novas.join(', ')}</div>
          )}
          {me.removidas.length > 0 && (
            <div>Cores sumidas da planilha (mantidas no anúncio, não removidas): {me.removidas.map((r) => r.cor || r.codigo).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
