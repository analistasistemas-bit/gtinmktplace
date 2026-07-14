import { useState } from 'react';
import { Coins, Store, AlertTriangle, TrendingUp, Truck, DollarSign, Trophy, Calendar } from 'lucide-react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';
import { StatusPill } from '@/components/ui/status-pill';
import type { StatusTone } from '@/components/ui/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtBRL, fmtMilhar } from '@/lib/formato';
import { familiaSemDimensoesValidas } from '@/lib/publicavel';
import { propsAnaliseDaVariacao, variacaoRepresentativa } from '@/lib/analise-viabilidade';
import type { Familia, Concorrencia, Variacao } from '@/lib/tipos-dominio';
import { SemaforoPreco } from '@/components/semaforo-preco';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useTarifaML } from '@/hooks/useTarifaML';
import { calcularSemaforo, type Semaforo } from '@/lib/semaforo';
import { cn } from '@/lib/utils';

const COR_DOT: Record<Semaforo, string> = {
  verde: 'bg-success',
  amarelo: 'bg-warning',
  vermelho: 'bg-destructive',
  indisponivel: 'bg-muted-foreground',
};
const LABEL_DOT: Record<Semaforo, string> = {
  verde: 'Vale a pena',
  amarelo: 'Abaixo do mínimo',
  vermelho: 'Prejuízo',
  indisponivel: 'Viabilidade indisponível',
};

/** Bolinha do semáforo (🟢🟡🔴) de uma variação — reusa o mesmo `useTarifaML`/`calcularSemaforo`
 *  do SemaforoPreco (react-query deduplica a chamada já feita pela lista de variações). */
function SemaforoDot({
  variacao,
  categoriaMlId,
  aliquotaPct,
}: {
  variacao: Variacao;
  categoriaMlId: string | null;
  aliquotaPct: number;
}) {
  const p = propsAnaliseDaVariacao(variacao);
  const { data, isLoading } = useTarifaML(p.preco, categoriaMlId, p.dimensoes, aliquotaPct);
  const liquido = data ? data.classico.recebe : null;
  const sem: Semaforo = isLoading ? 'indisponivel' : calcularSemaforo(liquido, p.piso, p.custo);
  return (
    <span
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COR_DOT[sem])}
      title={LABEL_DOT[sem]}
      aria-label={LABEL_DOT[sem]}
    />
  );
}

const TONE_CONCORRENCIA: Record<Concorrencia, StatusTone> = {
  sem: 'neutral',
  moderada: 'info',
  alta: 'warning',
};

export function PainelAnalise({
  familia,
  precoOverride,
  listingTypeReal,
}: {
  familia: Familia;
  /** Quando definido, substitui o preço de publicação calculado (ex.: preço atual no ML). */
  precoOverride?: number;
  /** Modo real publicado, para destacar Clássico/Premium no card "Você recebe". */
  listingTypeReal?: 'classico' | 'premium' | null;
}) {
  // Imposto por origem (ADR-0055): alíquota aplicada no líquido do card e do semáforo.
  const { data: aliquotas } = useAliquotas();
  const aliquotaPct = familia.origem === 'importado' ? (aliquotas?.importado ?? 16) : (aliquotas?.nacional ?? 8);

  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const representativa = variacaoRepresentativa(familia);
  // Seletor de variação só na Revisão (sem precoOverride) e com >1 cor: em Publicados o
  // precoOverride é family-level (preço real no ML) e casá-lo com o custo de outra cor daria
  // markup errado; com 1 cor não há o que escolher. Default = representativa → painel abre igual a hoje.
  const mostrarSeletor = precoOverride == null && incluidas.length >= 2;
  const [codigoSel, setCodigoSel] = useState<string | null>(null);
  const selecionada = incluidas.find((v) => v.codigo === codigoSel) ?? representativa;

  const propsVar = selecionada ? propsAnaliseDaVariacao(selecionada) : null;
  const precoExibido = precoOverride ?? propsVar?.preco ?? 0;
  const custoRepresentativo = propsVar?.custo ?? null;
  const pisoSemaforo = propsVar?.piso ?? precoExibido;
  // Dimensões/peso da variação selecionada p/ o frete do vendedor.
  const dimensoesRepresentativas = propsVar?.dimensoes ?? null;

  const proprio = familia.estrategiaPreco === 'PROPRIO';
  const labelEstrategia = familia.precoReancoradoLider
    ? 'COMPETITIVO · âncora líder'
    : proprio ? 'PRÓPRIO' : 'COMPETITIVO';
  const temConcorrencia = familia.concorrenciaVendedores > 0;
  const semDimensoes = familiaSemDimensoesValidas(familia);

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Análise para publicação
        </span>
        {mostrarSeletor && (
          <Select value={selecionada?.codigo ?? ''} onValueChange={setCodigoSel}>
            <SelectTrigger className="h-7 w-auto min-w-[160px] gap-1 text-xs">
              <span className="text-muted-foreground">Variação:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {incluidas.map((v) => (
                <SelectItem key={v.codigo} value={v.codigo} className="text-xs">
                  <span className="flex items-center gap-2">
                    <SemaforoDot variacao={v} categoriaMlId={familia.categoriaMlId} aliquotaPct={aliquotaPct} />
                    {v.cor || v.codigo} · {fmtBRL(v.precoPublicacao ?? v.preco)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <SemaforoPreco
        preco={precoExibido}
        piso={pisoSemaforo}
        custo={custoRepresentativo}
        categoriaMlId={familia.categoriaMlId}
        dimensoes={dimensoesRepresentativas}
        aliquotaPct={aliquotaPct}
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

      {/* Mobile: empilha (flex-col, cada card largura total) — sem isso o flex-1 força
          flex-basis:0% e os cards se espremem numa linha só, cortando o texto do "Você recebe".
          sm+: linha responsiva, cada card cresce (flex-1) com piso de largura, quebrando quando faltar espaço. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {/* Estratégia + Concorrência (agrupados num box compacto: a tela prioriza
            Potencial de venda e Você recebe, que ficam maiores ao lado) */}
        <div className="flex w-full flex-1 flex-col gap-2 rounded-md border bg-card p-2 sm:w-auto sm:min-w-[180px]">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Coins className="h-3.5 w-3.5" /> Estratégia
            </div>
            <StatusPill tone={familia.precoReancoradoLider ? 'danger' : proprio ? 'info' : 'warning'}>
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
          <div className="w-full flex-[2] rounded-md border bg-card p-2 sm:w-auto sm:min-w-[240px]">
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
        <div className="w-full flex-[2] sm:w-auto sm:min-w-[300px]">
          <CardVoceRecebe preco={precoExibido} categoriaMlId={familia.categoriaMlId} custo={custoRepresentativo} real={listingTypeReal} dimensoes={dimensoesRepresentativas} aliquotaPct={aliquotaPct} />
        </div>
      </div>
    </div>
  );
}
