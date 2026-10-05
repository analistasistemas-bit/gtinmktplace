import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdsPainel } from '@/hooks/useAdsPainel';
import { PERIODO_PADRAO_ADS, type DiasAds, type PeriodoAds } from '@/lib/ads-painel-dados';
import type { EstadoPainel } from '@/lib/ads-painel';
import { ResumoConta } from '@/components/ads/resumo-conta';
import { RankingFamilias } from '@/components/ads/ranking-familias';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

const PRESETS: {
  valor: '7' | '30' | '90' | 'mes_atual';
  label: string;
  periodo: PeriodoAds;
}[] = [
  { valor: '7', label: '7 dias', periodo: { tipo: 'preset', dias: 7 } },
  { valor: '30', label: '30 dias', periodo: { tipo: 'preset', dias: 30 } },
  { valor: '90', label: '90 dias', periodo: { tipo: 'preset', dias: 90 } },
  { valor: 'mes_atual', label: 'Mês atual', periodo: { tipo: 'mes_atual' } },
];
const CHAVE = 'ads-painel-dias';

function periodoSalvo(): PeriodoAds {
  try {
    const valor = localStorage.getItem(CHAVE);

    if (valor === 'mes_atual') return { tipo: 'mes_atual' };

    if (valor === '7' || valor === '30' || valor === '90') {
      const dias: DiasAds = valor === '7' ? 7 : valor === '30' ? 30 : 90;
      return { tipo: 'preset', dias };
    }
  } catch {
    return PERIODO_PADRAO_ADS;
  }

  return PERIODO_PADRAO_ADS;
}

/** Dia literal YYYY-MM-DD → DD/MM/AAAA (sem `new Date`, que leria o dia em UTC). */
const dataDia = (dia: string) =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

const BOTAO_ACAO = 'h-11 sm:h-8';

// Mesmos textos do dossiê (src/components/sku-dossie/ads-dossie.tsx).
const AVISO: Partial<Record<EstadoPainel, string>> = {
  sem_coleta: 'A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.',
  sem_permissao: 'O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada. Reconecte a conta em Canais; se continuar, confira a permissão “Publicidade” do aplicativo.',
  sem_advertiser: 'Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.',
  sem_acesso: 'A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.',
  coletando: 'Coletando os dados de Ads da conta…',
};

/** Estado sem números: explicação e, quando houver, a única ação que resolve. */
function Aviso({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <p>{texto}</p>
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}

export default function Ads() {
  const [periodo, setPeriodo] = useState<PeriodoAds>(periodoSalvo);
  const {
    painel,
    janela,
    situacaoPeriodo,
    historicoDesde,
    isFetching,
    isError,
    refetch,
  } = useAdsPainel(periodo);

  const escolherPeriodo = (proximo: PeriodoAds) => {
    setPeriodo(proximo);

    try {
      localStorage.setItem(
        CHAVE,
        proximo.tipo === 'preset' ? String(proximo.dias) : 'mes_atual',
      );
    } catch {
      // A seleção continua válida nesta visita.
    }
  };
  const atual = periodo.tipo === 'preset' ? String(periodo.dias) : 'mes_atual';

  const acoesPeriodo = (
    <div className="w-full min-w-0 space-y-2 sm:w-auto">
      <div
        role="group"
        aria-label="Período"
        className="grid grid-cols-2 gap-2 sm:flex"
      >
        {PRESETS.map(p => {
          const selecionado = atual === p.valor;

          return (
            <Button
              key={p.valor}
              size="sm"
              variant={selecionado ? 'default' : 'outline'}
              aria-pressed={selecionado}
              className={BOTAO_ACAO}
              onClick={() => escolherPeriodo(p.periodo)}
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      {janela && (
        <p className="text-xs text-muted-foreground tabular-nums sm:text-right">
          {`${dataDia(janela.desde)} a ${dataDia(janela.ate)} · BRT`}
        </p>
      )}

      {isFetching && painel && (
        <p role="status" className="text-xs text-muted-foreground sm:text-right">
          Atualizando…
        </p>
      )}
    </div>
  );

  const verificar = (
    <Button variant="outline" size="sm" className={BOTAO_ACAO} onClick={() => refetch()}>Verificar novamente</Button>
  );
  const abrirCanais = (
    <Button asChild variant="outline" size="sm" className={BOTAO_ACAO}><Link to="/canais">Abrir Canais</Link></Button>
  );

  // A ressalva causal fica junto ao resumo quando ele existe; sem resumo, vai para a procedência.
  let temResumo = false;
  let corpo;
  if (isError) {
    corpo = (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <p>Não foi possível carregar o painel de Ads.</p>
        <Button variant="outline" size="sm" className={`mt-3 ${BOTAO_ACAO}`} onClick={() => refetch()}>Tentar de novo</Button>
      </div>
    );
  } else if (situacaoPeriodo === 'aguardando_mes') {
    corpo = (
      <EmptyState
        icon={CalendarClock}
        title="Aguardando o primeiro dia de Ads deste mês"
        description="Os dados de hoje ainda não entram no painel. O mês aparecerá quando houver um dia encerrado coletado."
        action={(
          <Button variant="outline" size="sm" className={BOTAO_ACAO}
            onClick={() => escolherPeriodo({ tipo: 'preset', dias: 30 })}>
            Ver últimos 30 dias
          </Button>
        )}
      />
    );
  } else if (!painel) {
    corpo = (
      <div className="space-y-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-48" />
        <div className="space-y-2">
          <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
        </div>
      </div>
    );
  } else if (painel.estado === 'sem_coleta' || painel.estado === 'coletando') {
    corpo = <Aviso texto={AVISO[painel.estado]!} acao={verificar} />;
  } else if (painel.estado === 'sem_permissao' || painel.estado === 'sem_acesso') {
    corpo = <Aviso texto={AVISO[painel.estado]!} acao={abrirCanais} />;
  } else if (AVISO[painel.estado]) {
    corpo = <Aviso texto={AVISO[painel.estado]!} />;
  } else if (painel.estado === 'sem_ads') {
    corpo = (
      <EmptyState
        icon={Megaphone}
        title="Nenhum gasto de Ads no período"
        description="Quando houver despesa nos anúncios, o resultado aparece aqui."
        action={atual !== '90' && (
          <Button variant="outline" size="sm" className={BOTAO_ACAO}
            onClick={() => escolherPeriodo({ tipo: 'preset', dias: 90 })}>
            Ver últimos 90 dias
          </Button>
        )}
      />
    );
  } else {
    temResumo = painel.conta != null;
    corpo = (
      <>
        {painel.desatualizado && (
          <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Os dados de Ads estão desatualizados: a última coleta bem-sucedida foi há mais de 48 h.
          </p>
        )}
        {!painel.semaforoLiberado && (
          <p className="text-xs text-muted-foreground">Semáforo em validação: por ora o painel mostra o ACOS de equilíbrio de cada família como referência, sem verde ou vermelho.</p>
        )}
        {painel.conta
          ? <ResumoConta conta={painel.conta} historicoDesde={historicoDesde} />
          : <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Total da conta indisponível: a coleta ainda não cobre este período.</p>}
        <RankingFamilias painel={painel} historicoDesde={historicoDesde} />
      </>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] p-4 sm:p-6">
      <PageHeader
        title="Ads"
        subtitle="Quanto o Ads custa e o que sobra depois dele."
        actions={acoesPeriodo}
      />
      <div className="space-y-6">
        {corpo}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Despesa informada pela API de Ads do Mercado Livre.</p>
          {!temResumo && <p>Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.</p>}
          <p>
            {historicoDesde
              ? `Vendas desde ${dataBRT(historicoDesde)}, quando a organização começou a vender pelo PubliAI.`
              : 'Vendas desde a entrada da organização no PubliAI.'}
          </p>
        </div>
      </div>
    </div>
  );
}
