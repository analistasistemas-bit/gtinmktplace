// Card de veredito do Sonar (ADR-0124): a conclusão do garimpo, antes dos números crus.
// Identidade visual deliberadamente distinta do SemaforoPreco (ADR-0020) — aquele julga um preço,
// este julga um nicho; ícones de tendência aqui, ícones de círculo lá.
import { Gauge, Minus, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { NivelFator, Veredito } from '@/lib/veredito-sonar';

const CLS_VEREDITO = {
  alta: { borda: 'border-success/40', fundo: 'bg-success/5', texto: 'text-success' },
  media: { borda: 'border-warning/40', fundo: 'bg-warning/5', texto: 'text-warning' },
  baixa: { borda: 'border-destructive/40', fundo: 'bg-destructive/5', texto: 'text-destructive' },
} as const;

const CLS_FATOR: Record<NivelFator, string> = {
  bom: 'text-success',
  medio: 'text-warning',
  ruim: 'text-destructive',
};

const ICONE_FATOR: Record<NivelFator, typeof TrendingUp> = {
  bom: TrendingUp,
  medio: Minus,
  ruim: TrendingDown,
};

export function VereditoSonar({ veredito }: { veredito: Veredito }) {
  const cls = CLS_VEREDITO[veredito.nivel];
  return (
    <Card className={`mb-4 border ${cls.borda} ${cls.fundo} p-4`}>
      <div className="flex flex-wrap items-start gap-3">
        <Gauge className={`mt-0.5 h-6 w-6 shrink-0 ${cls.texto}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-semibold ${cls.texto}`}>{veredito.titulo}</span>
            {veredito.semVendas && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                sem dados de venda
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{veredito.motivo}</p>
        </div>
      </div>

      {/* Ordem = peso na decisão: Demanda é gate, Disputa é o que separa nicho aberto de fechado,
          Tração refina. A ordem vem do array e não é reordenada aqui de propósito. */}
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        {veredito.fatores.map((f) => {
          const Icone = ICONE_FATOR[f.nivel];
          return (
            <div key={f.chave} className="flex items-baseline gap-2">
              <Icone className={`h-4 w-4 shrink-0 self-center ${CLS_FATOR[f.nivel]}`} aria-hidden />
              <span className="text-sm font-medium">{f.label}</span>
              <span className="truncate text-xs text-muted-foreground" title={f.detalhe}>
                {f.detalhe}
              </span>
            </div>
          );
        })}
      </div>

      {/* Marca fica fora do grid pontuado: por decisão do Diego ela alerta mas NÃO entra na conta,
          e misturá-la aos outros faria parecer que entra. */}
      {veredito.marca && veredito.marca.nivel !== 'bom' && (
        <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
          <ShieldAlert className={`h-3.5 w-3.5 shrink-0 ${CLS_FATOR[veredito.marca.nivel]}`} aria-hidden />
          <span>
            {veredito.marca.detalhe}
            {veredito.marca.nivel === 'ruim'
              ? ' — revender marca com loja oficial forte tem risco de moderação por propriedade intelectual.'
              : ' — confira se a marca permite revenda antes de cadastrar.'}
          </span>
        </div>
      )}
    </Card>
  );
}
