// Mesmo "Você recebe por venda" de Publicados (card-voce-recebe), com a tarifa que o servidor gravou no preço da campanha.
import { Info, Wallet } from 'lucide-react';
import { fmtBRL } from '@/lib/formato';
import { tipoAnuncio } from '@/lib/pulse-formato';
import type { ResumoLucro } from '@/lib/promocao-simulacao';
import { cn } from '@/lib/utils';

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const pctInt = (n: number) => `${Math.round(n * 100)}%`;

export function DetalheRecebe({ r, preco, original, listingType, variasCores, rotuloPreco = 'preço na campanha' }: {
  r: ResumoLucro; preco: number; original: number | null; listingType?: string | null; variasCores: boolean;
  /** Kit com variação (ADR-0197) reaproveita o card fora de campanha. */
  rotuloPreco?: string;
}) {
  const desconto = original != null && original > preco ? Math.round((1 - preco / original) * 100) : null;
  return (
    <div className="rounded-md border p-2 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="size-3.5" aria-hidden /> Você recebe por venda
      </div>
      <p className="mb-1 text-xs tabular-nums text-muted-foreground">
        {rotuloPreco} <span className="font-medium text-foreground">{fmtBRL(preco)}</span>
        {desconto != null && ` (−${desconto}%)`}
        {' · '}custo do produto <span className="font-medium text-foreground">{fmtBRL(r.custo)}</span>
      </p>
      <div className="rounded-md border bg-card p-2">
        {listingType && <p className="text-xs font-medium text-muted-foreground">{tipoAnuncio(listingType)}</p>}
        <p className="text-base font-semibold tabular-nums text-foreground">{fmtBRL(r.recebe)}</p>
        <div className="text-xs tabular-nums text-muted-foreground">
          <p>comissão −{fmtBRL(r.comissao)} ({pct(r.comissaoPct)}{r.comissaoFixa ? ` + ${fmtBRL(r.comissaoFixa)}` : ''})</p>
          {r.imposto > 0 && <p>imposto −{fmtBRL(r.imposto)} ({pct(r.aliquotaPct)})</p>}
        </div>
        <p className={cn('mt-0.5 text-xs tabular-nums', r.lucro < 0 ? 'text-destructive' : 'text-success')}>
          {r.lucro < 0 ? 'prejuízo ' : 'lucro '}<span className="font-semibold">{fmtBRL(r.lucro)}</span>
          {r.margem != null && <>{' · margem '}<span className="font-semibold">{pctInt(r.margem)}</span></>}
          {' · markup '}<span className="font-semibold">{pctInt(r.markup)}</span>
        </p>
      </div>
      <p className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          {r.frete > 0
            ? <>Já desconta o frete grátis ao comprador por sua conta: <span className="font-medium text-foreground">−{fmtBRL(r.frete)}</span> (estimado; varia por região).</>
            : 'Sem frete por sua conta neste preço.'}
        </span>
      </p>
      {variasCores && r.cor && <p className="mt-0.5 text-[11px] text-muted-foreground">Conta feita na cor de menor líquido: {r.cor}.</p>}
    </div>
  );
}
