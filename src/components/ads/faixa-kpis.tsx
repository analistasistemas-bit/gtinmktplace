import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi-card';
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

const num = (n: number, casas: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const moeda = (n: number) => `R$ ${num(n, 2)}`;
const inteiro = (n: number) => num(n, 0);
const razao = (n: number) => `${num(n, 2)}×`;
const pct = (n: number) => `${num(n * 100, 1)}%`;

// Ordem = leitura do wireframe: linha 1 (resultado) e linha 2 (funil). Os 4 primeiros ficam visíveis no mobile.
const KPIS: Def[] = [
  { chave: 'investimento', rotulo: 'Investimento', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'vendas', rotulo: 'Vendas por Ads', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
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

const MOTIVOS: Record<NonNullable<ValorAds['motivo']>, string> = {
  nao_retornada: 'O ML não retornou esta métrica.',
  fora_da_retencao: 'Período fora da retenção do ML.',
  sem_denominador: 'Sem denominador no período (ex.: sem faturamento, cliques ou impressões).',
  resposta_invalida: 'Resposta inválida do ML.',
  sem_permissao: 'Sem permissão para ler esta métrica.',
  limite_de_leitura: 'Limite de leitura atingido. Tente novamente.',
};

function Delta({ texto, direcao, tom }: { texto: string; direcao: 'up' | 'down' | 'neutral'; tom: 'success' | 'danger' | 'neutral' }) {
  const Seta = direcao === 'up' ? ArrowUp : direcao === 'down' ? ArrowDown : null;
  return (
    <div
      data-delta
      data-direcao={direcao}
      data-tom={tom}
      className={cn(
        'mt-1 flex items-center gap-0.5 text-xs font-medium',
        tom === 'success' ? 'text-success' : tom === 'danger' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {Seta && <Seta className="h-3 w-3" aria-hidden />}
      {texto}
    </div>
  );
}

export function FaixaKpis({
  atual, anterior, comparacao, loading = false, ocultar,
}: {
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

          const apoio = receita && (
            <div className={cn('mt-0.5 tracking-normal', receita.valor === null ? 'text-xs font-normal text-muted-foreground' : 'text-sm font-medium text-foreground')}>
              {receita.valor === null
                ? `Receita indisponível: ${MOTIVOS[receita.motivo ?? 'nao_retornada']}`
                : `${moeda(receita.valor)} em receita`}
            </div>
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
                  <Delta {...cmp} />
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
