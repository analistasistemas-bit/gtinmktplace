import { Coins, Tag, Store, AlertTriangle, TrendingUp } from 'lucide-react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtMilhar } from '@/lib/formato';
import type { Familia, TipoAviamento, Concorrencia } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  switch (tipo) {
    case 'linha': return 'Fios e Cadarços';
    case 'fita': return 'Fita de Cetim';
    case 'botao': return 'Botões';
    default: return '—';
  }
}

const CORES_CONCORRENCIA: Record<Concorrencia, string> = {
  sem: 'bg-muted text-muted-foreground',
  moderada: 'bg-blue-50 text-blue-700 border border-blue-200',
  alta: 'bg-amber-50 text-amber-700 border border-amber-200',
};

export function PainelAnalise({ familia }: { familia: Familia }) {
  const proprio = familia.estrategiaPreco === 'PROPRIO';
  const labelEstrategia = proprio ? 'PRÓPRIO' : 'COMPETITIVO';
  const temConcorrencia = familia.concorrenciaVendedores > 0;
  const categoriaIndefinida = !familia.categoriaMlId;

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border bg-background p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Análise para publicação
      </span>

      {familia.precoAbaixo20pc && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="text-destructive">
            Preço de publicação abaixo do mínimo aceitável (mais de 20% abaixo da planilha). Reveja antes de aprovar.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* Estratégia */}
        <div className="rounded-md border p-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins className="h-3.5 w-3.5" /> Estratégia
          </div>
          <Badge
            className={cn(
              'font-semibold',
              proprio
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            )}
          >
            {labelEstrategia}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{familia.estrategiaMotivo}</p>
        </div>

        {/* Categoria */}
        <div className={cn('rounded-md border p-2', categoriaIndefinida && 'border-destructive/30 bg-destructive/5')}>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" /> Categoria
          </div>
          {categoriaIndefinida ? (
            <p className="text-xs font-medium text-destructive">
              Categoria indefinida — escolha antes de publicar
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">{nomeCategoriaAmigavel(familia.tipoAviamento)}</p>
              <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
            </>
          )}
        </div>
      </div>

      {/* Concorrência */}
      <div className="rounded-md border p-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Store className="h-3.5 w-3.5" /> Concorrência
        </div>
        {temConcorrencia ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className={cn('font-semibold capitalize', CORES_CONCORRENCIA[familia.concorrencia])}>
              {familia.concorrencia}
            </Badge>
            <span>{familia.concorrenciaVendedores} vendedores</span>
            {familia.concorrenciaPrecoMin != null && (
              <span>· menor preço <span className="font-medium text-foreground">{fmtBRL(familia.concorrenciaPrecoMin)}</span></span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">sem concorrência detectada</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {familia.analiseMercado ? (
          <div className="rounded-md border p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Potencial de venda
            </div>
            <div className="flex flex-col gap-1 text-xs">
              {familia.concorrenciaPrecoMin != null && familia.analiseMercado.preco_max != null && (
                <span>
                  💲 Preço concorrentes:{' '}
                  <span className="font-medium text-foreground">
                    {fmtBRL(familia.concorrenciaPrecoMin)} – {fmtBRL(familia.analiseMercado.preco_max)}
                  </span>
                </span>
              )}
              <span>
                📈 {familia.analiseMercado.lideres}/{familia.concorrenciaVendedores} MercadoLíder
                {familia.analiseMercado.maior_vendas > 0 && (
                  <> · maior <span className="font-medium text-foreground">{fmtMilhar(familia.analiseMercado.maior_vendas)} vendas</span></>
                )}
              </span>
              <span>
                🚚 Frete grátis: {familia.analiseMercado.frete_gratis}/{familia.analiseMercado.total_ofertas}
                {' · '}⚡ FULL: {familia.analiseMercado.full}/{familia.analiseMercado.total_ofertas}
              </span>
              <span>
                🏆 {familia.analiseMercado.ranking_categoria != null
                  ? `#${familia.analiseMercado.ranking_categoria} mais vendido na categoria`
                  : 'fora do top de mais vendidos da categoria'}
              </span>
              {familia.analiseMercado.produto_desde && (
                <span className="text-muted-foreground">📅 no catálogo desde {familia.analiseMercado.produto_desde}</span>
              )}
            </div>
          </div>
        ) : (
          <div />
        )}
        <CardVoceRecebe preco={familia.precoMin} categoriaMlId={familia.categoriaMlId} />
      </div>
    </div>
  );
}
