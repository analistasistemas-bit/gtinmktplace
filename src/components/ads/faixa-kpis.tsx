import { useState } from 'react';
import { cn } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi-card';
import { DeltaAds } from '@/components/ads/delta-ads';
import {
  MOTIVOS_METRICA_ADS as MOTIVOS, inteiroAds as inteiro, moedaAds as moeda, pctAds as pct, razaoAds as razao,
} from '@/lib/ads-metricas';
import {
  compararIndicadorAds,
  type SentidoAds,
  type UnidadeAds,
} from '@/lib/ads-metricas';
import type { ValorAds } from '../../../supabase/functions/_shared/ads/metricas';

// Faixa dos dez indicadores (plano ads-redesign §4.2/4.3). Desktop: 2 linhas de 5; mobile: 4 visíveis + expansão.
// Seta = direção do número; cor = significado (só indicadores com sentido, e nunca em comparação provisória).

export type EstadoComparacaoAds = 'disponivel' | 'provisoria' | 'indisponivel' | 'desligada';

interface Def {
  chave: string;
  rotulo: string;
  unidade: UnidadeAds;
  sentido: SentidoAds;
  formato: (n: number) => string;
}

// Ordem = leitura do wireframe: linha 1 (resultado) e linha 2 (funil). Os 4 primeiros ficam visíveis no mobile.
const KPIS: Def[] = [
  { chave: 'investimento', rotulo: 'Investimento', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'vendas', rotulo: 'Vendas atribuídas', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'roas', rotulo: 'ROAS', unidade: 'razao', sentido: 'maior_melhor', formato: razao },
  { chave: 'acos', rotulo: 'ACOS', unidade: 'percentual', sentido: 'menor_melhor', formato: pct },
  { chave: 'tacos', rotulo: 'TACOS da conta', unidade: 'percentual', sentido: 'menor_melhor', formato: pct },
  { chave: 'impressoes', rotulo: 'Impressões', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'cliques', rotulo: 'Cliques', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'ctr', rotulo: 'CTR', unidade: 'percentual', sentido: 'maior_melhor', formato: pct },
  { chave: 'cpc', rotulo: 'CPC', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'conversao', rotulo: 'Conversão', unidade: 'percentual', sentido: 'maior_melhor', formato: pct },
];
const VISIVEIS_MOBILE = 4;


export function FaixaKpis({
  atual, anterior, comparacao, loading = false, ocultar, mostrarPedidos = false,
}: {
  /** Acrescenta "N pedidos atribuídos" (advertising_items_quantity) como apoio do card de vendas — usado no detalhe. */
  mostrarPedidos?: boolean;
  /** Indicadores que não fazem sentido no escopo (ex.: `tacos` numa campanha). */
  ocultar?: string[];
  atual: Record<string, ValorAds>;
  anterior: Record<string, ValorAds> | null;
  comparacao: EstadoComparacaoAds;
  loading?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  const provisoria = comparacao === 'provisoria';
  const compara = anterior !== null && (comparacao === 'disponivel' || provisoria);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {KPIS.filter((k) => !ocultar?.includes(k.chave)).map((k, i) => {
          const valor = atual[k.chave] ?? { valor: null, motivo: 'nao_retornada' as const };
          const oculto = i >= VISIVEIS_MOBILE && !expandido;
          const cmp = compara
            ? compararIndicadorAds(valor, anterior[k.chave] ?? { valor: null, motivo: 'nao_retornada' }, k.unidade, provisoria, k.sentido)
            : null;
          const receita = k.chave === 'vendas' ? atual.receita : null;
          const indisponivel = valor.valor === null;

          const pedidos = mostrarPedidos && k.chave === 'vendas' ? atual.pedidos : null;
          const apoio = (receita || pedidos) && (
            <>
              {receita && (
                <div className={cn('mt-0.5 tracking-normal', receita.valor === null ? 'text-xs font-normal text-muted-foreground' : 'text-sm font-medium text-foreground')}>
                  {receita.valor === null
                    ? `Receita indisponível: ${MOTIVOS[receita.motivo ?? 'nao_retornada']}`
                    : `${moeda(receita.valor)} em receita`}
                </div>
              )}
              {pedidos?.valor != null && (
                <div className="mt-0.5 text-xs font-normal tracking-normal text-muted-foreground">
                  {`${inteiro(pedidos.valor)} ${pedidos.valor === 1 ? 'pedido atribuído' : 'pedidos atribuídos'}`}
                </div>
              )}
            </>
          );
          const corpo = indisponivel ? (
            <>
              <span className="text-muted-foreground">Indisponível</span>
              <p className="mt-1 text-xs font-normal leading-snug tracking-normal text-muted-foreground">
                {MOTIVOS[valor.motivo ?? 'nao_retornada']}
              </p>
              {apoio}
            </>
          ) : (
            <>
              {k.formato(valor.valor!)}
              {apoio}
              {cmp && (
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <DeltaAds {...cmp} className="mt-1 flex" />
                  {provisoria && cmp.texto !== 'Sem comparação' && (
                    <span className="mt-1 rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">Provisória</span>
                  )}
                </div>
              )}
            </>
          );

          return (
            <div key={k.chave} data-kpi={k.chave} className={cn(oculto && 'hidden lg:block')}>
              <KpiCard label={k.rotulo} infoKey={`${k.rotulo}::Ads`} loading={loading} value={corpo} />
            </div>
          );
        })}
      </div>
      {!expandido && (
        <button
          type="button"
          onClick={() => setExpandido(true)}
          className="mt-3 w-full min-h-11 rounded-md border py-2 text-sm font-medium text-muted-foreground lg:hidden"
        >
          Mostrar todos os indicadores
        </button>
      )}
    </div>
  );
}
