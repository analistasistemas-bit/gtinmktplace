// Análise PubliAI no Sonar (ADR-0142): seções 2.6–2.9, 3.2–3.4 e 7.4 — só exibe payload da edge.
import { BarChart3, CircleDollarSign, Loader2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatarFaturamentoSecoes237,
  formatarMedianaVendasMesSecoes237,
  formatarProporcaoCobertura,
  type CoberturaEstimativaSonar,
  type RespostaSecoes237Sonar,
  type VendedoresSemEstimativaSonar,
} from '@/lib/sonar';

export type SonarAnalisePubliAIProps = {
  data?: RespostaSecoes237Sonar;
  carregando: boolean;
  erro: Error | null;
  onRetry?: () => void;
};

/**
 * 3.3 + 3.4 em duas linhas, uma por unidade (spike 045): o percentual pertence aos anúncios, e a
 * contagem de 3.4 só faz sentido ao lado do denominador de vendedores. Misturar as duas é o
 * defeito que o contrato criou 3.3 para impedir.
 */
function LinhasCobertura(
  { cobertura, semEstimativa }:
  { cobertura: CoberturaEstimativaSonar; semEstimativa: VendedoresSemEstimativaSonar },
) {
  const pct = cobertura.proporcao_anuncios != null
    ? ` (${formatarProporcaoCobertura(cobertura.proporcao_anuncios)})`
    : '';
  const linhaAnuncios =
    `${cobertura.anuncios_cobertos} de ${cobertura.anuncios_na_amostra} anúncios da amostra cobertos${pct}`;
  const linhaVendedores =
    `${cobertura.com_estimativa} de ${cobertura.vendedores_distintos} vendedores com estimativa mensal`
    + (semEstimativa.contagem > 0 ? ` · ${semEstimativa.contagem} sem estimativa` : '');

  return (
    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
      <p>
        <BarChart3 className="mr-1.5 inline h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{linhaAnuncios}</span>
      </p>
      <p>
        <Users className="mr-1.5 inline h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{linhaVendedores}</span>
      </p>
    </div>
  );
}

export function SonarAnalisePubliAI({ data, carregando, erro, onRetry }: SonarAnalisePubliAIProps) {
  if (carregando) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Análise PubliAI — demanda por vendedor
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      </Card>
    );
  }

  if (erro) {
    return (
      <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm font-medium text-destructive">Não foi possível carregar a Análise PubliAI.</p>
        <p className="mt-1 text-sm text-muted-foreground">{erro.message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const s = data.secoes237;
  const fat = s['2.6'];
  const vol = s['3.2'];
  const conc = s['7.4'];

  if (fat.estado === 'sem_dado') {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Análise PubliAI</span>
          <Badge variant="outline">demanda por vendedor</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{fat.mensagem}</p>
        <LinhasCobertura cobertura={s['3.3']} semEstimativa={s['3.4']} />
      </Card>
    );
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Análise PubliAI</span>
        <Badge variant="outline">demanda por vendedor</Badge>
        <span className="text-xs text-muted-foreground">
          vendas/mês = loja inteira do vendedor, janela móvel 365d
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          size="compact"
          label="Faturamento do nicho"
          value={formatarFaturamentoSecoes237(fat)}
          hint={fat.rotulo}
          icon={CircleDollarSign}
          tom="info"
        />
        <KpiCard
          size="compact"
          label="Mediana vendas/mês por vendedor"
          value={formatarMedianaVendasMesSecoes237(vol)}
          hint={vol.estado === 'valor' ? vol.rotulo : undefined}
          icon={BarChart3}
          tom="info"
        />
      </div>

      <LinhasCobertura cobertura={s['3.3']} semEstimativa={s['3.4']} />

      <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {s['2.9'].parecer}
      </div>

      {conc != null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">{conc.rotulo}</span>
          <span>
            <span className="text-muted-foreground">Top vendedor: </span>
            <span className="font-semibold tabular-nums">{Math.round(conc.top1 * 100)}%</span>
          </span>
          <span>
            <span className="text-muted-foreground">Dominante: </span>
            <span className="font-semibold">{conc.dominante ? 'sim' : 'não'}</span>
          </span>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/80">{s.limitacao_3_2}</p>
    </Card>
  );
}
