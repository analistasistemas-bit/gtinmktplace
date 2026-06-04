import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { useTarifaML } from '@/hooks/useTarifaML';
import type { TarifaTipo } from '@/lib/tarifa';

function Coluna({ titulo, t, melhor }: { titulo: string; t: TarifaTipo; melhor: boolean }) {
  return (
    <div className={cn('rounded-md border p-2', melhor && 'border-blue-200 bg-blue-50')}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        {melhor && <span className="text-[10px] font-semibold text-blue-700">melhor</span>}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{fmtBRL(t.recebe)}</div>
      <div className="text-[11px] text-muted-foreground">
        comissão −{fmtBRL(t.comissao)} ({t.percentual}%)
      </div>
    </div>
  );
}

export function CardVoceRecebe({ preco, categoriaMlId }: { preco: number; categoriaMlId: string | null }) {
  const { data, isLoading, isError } = useTarifaML(preco, categoriaMlId);

  return (
    <div className="rounded-md border p-2">
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
            <Coluna titulo="Clássico" t={data.classico} melhor={data.classico.recebe >= data.premium.recebe} />
            <Coluna titulo="Premium" t={data.premium} melhor={data.premium.recebe > data.classico.recebe} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            ℹ️ Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região).
          </p>
        </>
      )}
    </div>
  );
}
