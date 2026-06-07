import { Coins, Tag, Store, AlertTriangle, TrendingUp, Truck } from 'lucide-react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtMilhar } from '@/lib/formato';
import { familiaSemDimensoesValidas } from '@/lib/publicavel';
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
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const baseVariacoes = incluidas.length > 0 ? incluidas : familia.variacoes;
  const precoPublicacao = baseVariacoes.length > 0
    ? Math.min(...baseVariacoes.map((v) => v.precoPublicacao ?? v.preco))
    : 0;

  // Custo da variação cujo preço de publicação é o menor (a mesma que define precoPublicacao);
  // empate → a primeira. Alimenta o markup do card "Você recebe".
  const variacaoRepresentativa = baseVariacoes.length > 0
    ? baseVariacoes.reduce((min, v) =>
        (v.precoPublicacao ?? v.preco) < (min.precoPublicacao ?? min.preco) ? v : min,
      baseVariacoes[0])
    : null;
  const custoRepresentativo = variacaoRepresentativa?.custo ?? null;

  const proprio = familia.estrategiaPreco === 'PROPRIO';
  const labelEstrategia = proprio ? 'PRÓPRIO' : 'COMPETITIVO';
  const temConcorrencia = familia.concorrenciaVendedores > 0;
  const categoriaIndefinida = !familia.categoriaMlId;
  const semDimensoes = familiaSemDimensoesValidas(familia);

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3">
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

      {semDimensoes && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-amber-700 dark:text-amber-400">
            Sem dimensões/peso reais — o Mercado Livre vai <strong>estimar o frete</strong> (pode ficar alto e gerar moderação). Atualize a planilha com altura, largura, comprimento e peso reais.
          </span>
        </div>
      )}

      {/* Cards em linha única responsiva (largura total): a tela prioriza a análise.
          Cada card cresce (flex-1) com um piso de largura; quebram em linhas quando faltar espaço. */}
      <div className="flex flex-wrap gap-2">
        {/* Estratégia */}
        <div className="min-w-[160px] flex-1 rounded-md border p-2">
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
        <div className={cn('min-w-[160px] flex-1 rounded-md border p-2', categoriaIndefinida && 'border-destructive/30 bg-destructive/5')}>
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

        {/* Concorrência */}
        <div className="min-w-[180px] flex-1 rounded-md border p-2">
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

        {/* Potencial de venda */}
        {familia.analiseMercado && (
          <div className="min-w-[200px] flex-1 rounded-md border p-2">
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
        )}

        {/* Você recebe por venda (precisa de mais largura: compara Clássico × Premium) */}
        <div className="min-w-[280px] flex-1">
          <CardVoceRecebe preco={precoPublicacao} categoriaMlId={familia.categoriaMlId} custo={custoRepresentativo} />
        </div>
      </div>
    </div>
  );
}
