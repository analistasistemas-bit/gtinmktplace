// Análise PubliAI no Sonar (ADR-0142 + ADR-0143): demanda do nicho por vendedor.
// Só exibe o payload da edge — nenhum número nasce aqui. O faturamento do nicho (2.6) não existe
// mais: a estimativa é da loja inteira do vendedor, não do anúncio (ADR-0143 D-3).
import { BarChart3, Loader2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
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

function Cabecalho() {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Análise PubliAI</span>
      <Badge variant="outline">demanda por vendedor</Badge>
    </div>
  );
}

/**
 * 3.3 + 3.4 em duas linhas, uma por unidade (spike 045): o percentual pertence aos anúncios, e a
 * contagem de 3.4 só faz sentido ao lado do denominador de vendedores.
 */
function LinhasCobertura(
  { cobertura, semEstimativa }:
  { cobertura: CoberturaEstimativaSonar; semEstimativa: VendedoresSemEstimativaSonar },
) {
  const pct = cobertura.proporcao_anuncios != null
    ? ` (${formatarProporcaoCobertura(cobertura.proporcao_anuncios)})`
    : '';
  const linhaAnuncios =
    `${cobertura.anuncios_com_catalogo} de ${cobertura.anuncios_na_amostra} anúncios da amostra têm catálogo${pct}`;
  // ADR-0145: com_estimativa e a contagem de 3.4 já são sobre ESTABELECIDOS — o denominador
  // desta linha precisa ser o mesmo conjunto, senão "X de Y" mistura população crua com filtrada.
  const linhaVendedores =
    `${cobertura.com_estimativa} de ${cobertura.estabelecidos} vendedores estabelecidos com estimativa mensal`
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

  if (!data.conectado) {
    return (
      <Card className="mb-4 p-4">
        <Cabecalho />
        <p className="text-sm text-muted-foreground">
          Conecte o Mercado Livre para estimar a demanda do nicho por vendedor.
        </p>
      </Card>
    );
  }

  const s = data.secoes237;
  const conc = s['7.4'];
  const atividade = s['3.6'];

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Análise PubliAI</span>
        <Badge variant="outline">demanda por vendedor</Badge>
        <span className="text-xs text-muted-foreground">
          vendas/mês = loja inteira do vendedor
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {atividade.estabelecidos > 0 && (
          <KpiCard
            size="compact"
            label="Concorrentes vendendo"
            value={`${atividade.ativos} de ${atividade.estabelecidos}`}
            hint={atividade.rotulo}
            icon={Users}
            tom="info"
          />
        )}
        <KpiCard
          size="compact"
          label="Mediana de vendas/mês por vendedor"
          value={formatarMedianaVendasMesSecoes237(s['3.2'])}
          hint={s['3.2'].estado === 'valor' ? s['3.2'].rotulo : undefined}
          icon={BarChart3}
          tom="info"
        />
      </div>

      {atividade.base_pequena && (
        <p className="mt-2 text-xs text-warning">
          Base pequena: só {atividade.estabelecidos} vendedor{atividade.estabelecidos === 1 ? '' : 'es'} estabelecido{atividade.estabelecidos === 1 ? '' : 's'} nesta amostra.
        </p>
      )}

      <LinhasCobertura cobertura={s['3.3']} semEstimativa={s['3.4']} />

      {conc != null && (
        // 7.4 tem denominador próprio (anúncios da amostra), diferente do de 3.3 logo acima —
        // o percentual carrega o seu para não ser lido como share dos vendedores do catálogo.
        <div className="mt-3 text-xs text-muted-foreground">
          <span>
            {`Top vendedor: ${Math.round(conc.top1 * 100)}% de ${conc.elegiveis} com venda registrada na amostra`}
            {conc.dominante ? ' — dominante' : ''}
          </span>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/80">{s.limitacao_3_2}</p>
      <p className="mt-1 text-[11px] text-muted-foreground/70">{s['2.9'].mensagem}</p>
    </Card>
  );
}
