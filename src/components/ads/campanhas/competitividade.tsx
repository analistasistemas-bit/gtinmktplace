import { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { cn } from '@/lib/utils';
import type {
  MetricaBrutaAds, MotivoMetricaAds, PedidoAdsMetricas, ValorAds,
} from '../../../../supabase/functions/_shared/ads/metricas';
import type { PedidoBaseDetalhe } from './detalhe-campanha';

// Competitividade da campanha (plano ads-redesign §2.7/3.5/4.1/4.9): participação em impressões em barras
// rotuladas, no lugar do donut. Os três campos são fração 0–1 (spike 058) e somam 1. `top_impression_share`
// tem escala não confirmada e NUNCA entra aqui; campo ausente mostra o motivo, nunca zero. A consulta só
// dispara ao expandir e a falha fica contida neste bloco.

interface Barra {
  campo: MetricaBrutaAds;
  rotulo: string;
  explicacao: string;
  cor: string;
}

const BARRAS: Barra[] = [
  { campo: 'impression_share', rotulo: 'Ganhas', cor: 'bg-primary',
    explicacao: 'Impressões que seus anúncios conquistaram entre as que poderiam ter recebido.' },
  { campo: 'lost_impression_share_by_budget', rotulo: 'Perdidas por orçamento', cor: 'bg-muted-foreground/60',
    explicacao: 'Impressões perdidas porque o orçamento diário acabou antes do fim do dia.' },
  { campo: 'lost_impression_share_by_ad_rank', rotulo: 'Perdidas por classificação', cor: 'bg-muted-foreground/30',
    explicacao: 'Impressões perdidas porque o lance ou a qualidade do anúncio ficou abaixo dos concorrentes.' },
];

const MOTIVOS: Record<MotivoMetricaAds, string> = {
  nao_retornada: 'O ML não retornou esta métrica.',
  fora_da_retencao: 'Período fora da retenção do ML.',
  sem_denominador: 'Sem denominador no período.',
  resposta_invalida: 'Resposta inválida do ML.',
  sem_permissao: 'Sem permissão para ler esta métrica.',
  limite_de_leitura: 'Limite de leitura atingido.',
};

const SEM_VALOR: ValorAds = { valor: null, motivo: 'nao_retornada' };
const pct = (fracao: number) => `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function Linha({ b, v }: { b: Barra; v: ValorAds }) {
  const largura = v.valor === null ? 0 : Math.min(100, Math.max(0, v.valor * 100));
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{b.rotulo}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {v.valor === null ? '—' : pct(v.valor)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn('h-full rounded-full', b.cor)} style={{ width: `${largura}%` }} />
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {v.valor === null ? MOTIVOS[v.motivo ?? 'nao_retornada'] : b.explicacao}
      </p>
    </li>
  );
}

interface Props {
  campanhaId: number;
  pedido: PedidoBaseDetalhe;
}

export function Competitividade({ campanhaId, pedido }: Props) {
  const [aberto, setAberto] = useState(false);
  const { desde, ate } = pedido;
  const pedidoComp = useMemo<PedidoAdsMetricas>(
    // Sem comparação: a participação do período anterior não é pedida aqui.
    () => ({ desde, ate, comparar: 'nenhum', escopo: 'competitividade', campanhaId }),
    [desde, ate, campanhaId],
  );
  const q = useAdsMetricas(pedidoComp, aberto);
  const data = q.data;
  const resumo = data?.atual?.resumo;

  return (
    <section aria-label="Competitividade" className="space-y-3">
      <Button
        type="button" variant="outline" size="sm" aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <ChevronDown className={cn('size-4 transition-transform', aberto && 'rotate-180')} aria-hidden="true" />
        {aberto ? 'Ocultar competitividade' : 'Ver competitividade'}
      </Button>
      {aberto && (
        <div className="space-y-3">
          {q.isLoading ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lendo a participação em impressões…
            </p>
          ) : q.isError ? (
            <p role="status" className="text-sm text-muted-foreground">
              Não foi possível ler a competitividade agora. O restante da campanha não foi afetado.
            </p>
          ) : data && !resumo ? (
            <p role="status" className="text-sm text-muted-foreground">
              Competitividade indisponível{data.comparacao.motivo ? `: ${data.comparacao.motivo}` : ' para este período.'}
            </p>
          ) : resumo ? (
            <>
              <p className="text-xs text-muted-foreground">
                Participação em impressões no período: de cada 100 chances de aparecer, quantas você ganhou e por que perdeu o resto.
              </p>
              <ul className="space-y-4">
                {BARRAS.map((b) => <Linha key={b.campo} b={b} v={resumo[b.campo] ?? SEM_VALOR} />)}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
