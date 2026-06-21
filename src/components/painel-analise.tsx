import { Coins, Store, AlertTriangle, TrendingUp, Truck, DollarSign, Trophy, Calendar } from 'lucide-react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';
import { StatusPill } from '@/components/ui/status-pill';
import type { StatusTone } from '@/components/ui/status-pill';
import { fmtBRL, fmtMilhar } from '@/lib/formato';
import { familiaSemDimensoesValidas } from '@/lib/publicavel';
import type { Familia, Concorrencia } from '@/lib/tipos-dominio';
import { SemaforoPreco } from '@/components/semaforo-preco';

const TONE_CONCORRENCIA: Record<Concorrencia, StatusTone> = {
  sem: 'neutral',
  moderada: 'info',
  alta: 'warning',
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
  const semDimensoes = familiaSemDimensoesValidas(familia);

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Análise para publicação
      </span>

      <SemaforoPreco
        preco={precoPublicacao}
        piso={variacaoRepresentativa?.preco ?? precoPublicacao}
        custo={custoRepresentativo}
        categoriaMlId={familia.categoriaMlId}
      />

      {familia.precoAbaixo20pc && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="text-destructive">
            Preço de publicação abaixo do mínimo aceitável (mais de 20% abaixo da planilha). Reveja antes de aprovar.
          </span>
        </div>
      )}

      {semDimensoes && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="text-warning">
            Sem dimensões/peso reais — o Mercado Livre vai <strong>estimar o frete</strong> (pode ficar alto e gerar moderação). Atualize a planilha com altura, largura, comprimento e peso reais.
          </span>
        </div>
      )}

      {/* Cards em linha única responsiva (largura total): a tela prioriza a análise.
          Cada card cresce (flex-1) com um piso de largura; quebram em linhas quando faltar espaço. */}
      <div className="flex flex-wrap gap-2">
        {/* Estratégia + Concorrência (agrupados num box compacto: a tela prioriza
            Potencial de venda e Você recebe, que ficam maiores ao lado) */}
        <div className="flex min-w-[180px] flex-1 flex-col gap-2 rounded-md border bg-card p-2">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Coins className="h-3.5 w-3.5" /> Estratégia
            </div>
            <StatusPill tone={proprio ? 'info' : 'warning'}>
              {labelEstrategia}
            </StatusPill>
            <p className="mt-1 text-xs text-muted-foreground">{familia.estrategiaMotivo}</p>
          </div>
          <div className="border-t pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Store className="h-3.5 w-3.5" /> Concorrência
            </div>
            {temConcorrencia ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill tone={TONE_CONCORRENCIA[familia.concorrencia]} className="capitalize">
                  {familia.concorrencia}
                </StatusPill>
                <span>{familia.concorrenciaVendedores} vendedores</span>
                {familia.concorrenciaPrecoMin != null && (
                  <span>· menor preço <span className="font-medium text-foreground">{fmtBRL(familia.concorrenciaPrecoMin)}</span></span>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">sem concorrência detectada</p>
            )}
          </div>
        </div>

        {/* Potencial de venda (prioritário → flex-[2], mais largura) */}
        {familia.analiseMercado && (
          <div className="min-w-[240px] flex-[2] rounded-md border bg-card p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Potencial de venda
            </div>
            <div className="flex flex-col gap-1 text-xs">
              {familia.concorrenciaPrecoMin != null && familia.analiseMercado.preco_max != null && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3 shrink-0 text-muted-foreground" />
                  Preço concorrentes:{' '}
                  <span className="font-medium text-foreground">
                    {fmtBRL(familia.concorrenciaPrecoMin)} – {fmtBRL(familia.analiseMercado.preco_max)}
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 shrink-0 text-muted-foreground" />
                {familia.analiseMercado.lideres}/{familia.concorrenciaVendedores} MercadoLíder
                {familia.analiseMercado.maior_vendas > 0 && (
                  <> · maior <span className="font-medium text-foreground">{fmtMilhar(familia.analiseMercado.maior_vendas)} vendas</span></>
                )}
              </span>
              <span className="flex items-center gap-1">
                <Truck className="h-3 w-3 shrink-0 text-muted-foreground" />
                Frete grátis: {familia.analiseMercado.frete_gratis}/{familia.analiseMercado.total_ofertas}
                {' · '}FULL: {familia.analiseMercado.full}/{familia.analiseMercado.total_ofertas}
              </span>
              <span className="flex items-center gap-1">
                <Trophy className="h-3 w-3 shrink-0 text-muted-foreground" />
                {familia.analiseMercado.ranking_categoria != null
                  ? `#${familia.analiseMercado.ranking_categoria} mais vendido na categoria`
                  : 'fora do top de mais vendidos da categoria'}
              </span>
              {familia.analiseMercado.produto_desde && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-3 w-3 shrink-0" />
                  no catálogo desde {familia.analiseMercado.produto_desde}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Você recebe por venda (prioritário → flex-[2]; compara Clássico × Premium) */}
        <div className="min-w-[300px] flex-[2]">
          <CardVoceRecebe preco={precoPublicacao} categoriaMlId={familia.categoriaMlId} custo={custoRepresentativo} />
        </div>
      </div>
    </div>
  );
}
