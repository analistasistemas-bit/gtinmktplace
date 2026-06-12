import type { Familia } from '@/lib/tipos-dominio';
import { fmtInt } from '@/lib/formato';
import { variacoesEstoqueAlterado } from '@/lib/publicavel';
import { coresNovasPendentes } from '@/lib/revisao-variacoes';

// UPDATE: mostra, por cor casada, o estoque antes→depois (só as que mudaram),
// e sinaliza cores novas/removidas (mudança estrutural, não aplicada).
export function DiffEstoque({ familia }: { familia: Familia }) {
  if (familia.operacao !== 'UPDATE') return null;

  const mudaram = variacoesEstoqueAlterado(familia);
  const me = familia.mudancaEstrutural;
  // Cores novas ainda PENDENTES (as já publicadas saem do aviso — `me.novas` é estático
  // do ingest e não filtra as que entraram no anúncio).
  const novasPendentes = coresNovasPendentes(familia);
  const temAvisoEstrutural = novasPendentes.length > 0 || (me?.removidas.length ?? 0) > 0;

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
                estoque {fmtInt(v.estoqueAnterior ?? 0)} → {fmtInt(v.estoque)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {me && temAvisoEstrutural && (
        <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <span className="font-semibold">Mudança estrutural:</span>
          {novasPendentes.length > 0 && (
            <div>Cores novas (marque "incluir" na lista para publicá-las): {novasPendentes.map((c) => c.cor).join(', ')}</div>
          )}
          {me.removidas.length > 0 && (
            <div>Cores sumidas da planilha (mantidas no anúncio, não removidas): {me.removidas.map((r) => r.cor || r.codigo).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
