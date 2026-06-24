import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { useTarifaML } from '@/hooks/useTarifaML';
import { calcularMarkup } from '@/lib/markup';
import type { TarifaTipo } from '@/lib/tarifa';

function Coluna({
  titulo,
  t,
  melhor,
  custo,
  real,
}: {
  titulo: string;
  t: TarifaTipo;
  melhor: boolean;
  custo: number | null;
  /** Modo realmente publicado neste anúncio (destaca a coluna). */
  real?: boolean;
}) {
  const temCusto = custo != null && custo > 0;
  const { lucro, markup } = temCusto ? calcularMarkup(t.recebe, custo) : { lucro: 0, markup: 0 };
  const prejuizo = temCusto && lucro < 0;
  return (
    <div className={cn(
      'rounded-md border bg-card p-2',
      melhor && 'border-primary/30 bg-primary/5',
      real && 'ring-2 ring-success ring-offset-1 ring-offset-background',
    )}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <div className="flex items-center gap-1.5">
          {real && <span className="text-[10px] font-semibold text-success">✓ publicado</span>}
          {melhor && <span className="text-[10px] font-semibold text-primary">melhor</span>}
        </div>
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{fmtBRL(t.recebe)}</div>
      <div className="text-[11px] text-muted-foreground">
        comissão −{fmtBRL(t.comissao)} ({t.percentual}%)
      </div>
      {temCusto && (
        <div className={cn('mt-0.5 text-[11px]', prejuizo ? 'text-destructive' : 'text-success')}>
          {prejuizo ? 'prejuízo ' : 'lucro '}
          <span className="font-semibold">{fmtBRL(lucro)}</span>
          {' · markup '}
          <span className="font-semibold">{Math.round(markup * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export function CardVoceRecebe({
  preco,
  categoriaMlId,
  custo,
  real,
}: {
  preco: number;
  categoriaMlId: string | null;
  custo?: number | null;
  /** Modo realmente publicado: destaca a coluna Clássico ou Premium. */
  real?: 'classico' | 'premium' | null;
}) {
  const { data, isLoading, isError } = useTarifaML(preco, categoriaMlId);

  return (
    <div className="rounded-md border p-2 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" /> Você recebe por venda
      </div>

      {!categoriaMlId ? (
        <p className="text-xs text-muted-foreground">defina a categoria para calcular</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">calculando…</p>
      ) : isError || !data ? (
        <p className="text-xs text-muted-foreground">tarifa indisponível</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted-foreground">
            preço de publicação <span className="font-medium text-foreground">{fmtBRL(preco)}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Coluna titulo="Clássico" t={data.classico} melhor={data.classico.recebe >= data.premium.recebe} custo={custo ?? null} real={real === 'classico'} />
            <Coluna titulo="Premium" t={data.premium} melhor={data.premium.recebe > data.classico.recebe} custo={custo ?? null} real={real === 'premium'} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            ℹ️ Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região).
          </p>
        </>
      )}
    </div>
  );
}
