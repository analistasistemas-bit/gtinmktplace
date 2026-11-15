// Kit vinculado na adesão: logo abaixo do "Você recebe por venda", o anúncio avulso da base com o mesmo desconto %
// do kit — valor cheio, promoção, lucro, margem e markup dele (conta do servidor). Não é kit → não aparece.
import { Package } from 'lucide-react';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { resumoLucro } from '@/lib/promocao-simulacao';
import type { ItemPromocao } from '@/lib/promocoes';
import { useUnitarioKit } from '@/hooks/useOperacoes';

const pctInt = (n: number) => `${Math.round(n * 100)}%`;

export function UnitarioKit({ mlItemId, preco, original }: { mlItemId: string; preco: number; original: number | null }) {
  const { data: u, isLoading } = useUnitarioKit({ ml_item_id: mlItemId, preco, preco_original: original });
  if (isLoading || !u) return null;
  const r = resumoLucro({ projecao: u.projecao, pior_semaforo: u.pior_semaforo } as ItemPromocao, { preco: u.preco, projecao: u.projecao, pior_semaforo: u.pior_semaforo });
  const desconto = u.preco_cheio > u.preco ? Math.round((1 - u.preco / u.preco_cheio) * 100) : null;
  return (
    <div className="mt-2 rounded-md border p-2 shadow-sm" data-testid="unitario-kit">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Package className="size-3.5" aria-hidden /> Produto unitário
        <span className="font-normal">· {u.base_item_id} (avulso, mesmo desconto)</span>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        valor cheio <span className="font-medium text-foreground">{fmtBRL(u.preco_cheio)}</span>
        {' · '}promoção <span className="font-medium text-foreground">{fmtBRL(u.preco)}</span>
        {desconto != null && ` (−${desconto}%)`}
      </p>
      {r ? (
        <p className={cn('mt-0.5 text-xs tabular-nums', r.lucro < 0 ? 'text-destructive' : 'text-success')}>
          {r.lucro < 0 ? 'prejuízo ' : 'lucro '}<span className="font-semibold">{fmtBRL(r.lucro)}</span>
          {r.margem != null && <>{' · margem '}<span className="font-semibold">{pctInt(r.margem)}</span></>}
          {' · markup '}<span className="font-semibold">{pctInt(r.markup)}</span>
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">Sem custo no PubliAI para calcular o lucro do unitário.</p>
      )}
    </div>
  );
}
