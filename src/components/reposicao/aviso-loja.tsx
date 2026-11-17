import { Info } from 'lucide-react';

/** Spec §3.1: faixa única, sem data prometida, quando mais da metade ainda depende da curva da família. */
export function AvisoLoja({ pct }: { pct: number }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-sm text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <p>{Math.round(pct * 100)}% dos produtos ainda estimados pela família: a loja tem poucas vendas.</p>
    </div>
  );
}
