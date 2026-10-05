import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdsPainel } from '@/hooks/useAdsPainel';
import type { DiasAds } from '@/lib/ads-painel-dados';
import type { EstadoPainel } from '@/lib/ads-painel';
import { ResumoConta } from '@/components/ads/resumo-conta';
import { RankingFamilias } from '@/components/ads/ranking-familias';
import { dataBRT, diaMesLiteral } from '@/components/sku-dossie/formato-dossie';

const PRESETS: { dias: DiasAds; label: string }[] = [
  { dias: 7, label: '7 dias' }, { dias: 30, label: '30 dias' }, { dias: 90, label: '90 dias' },
];
const CHAVE = 'ads-painel-dias';

function diasSalvos(): DiasAds {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    return v === 7 || v === 90 ? v : 30;
  } catch { return 30; }
}

// Mesmos textos do dossiê (src/components/sku-dossie/ads-dossie.tsx).
const AVISO: Partial<Record<EstadoPainel, string>> = {
  sem_coleta: 'A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.',
  sem_permissao: 'O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada. Reconecte a conta em Canais; se continuar, confira a permissão “Publicidade” do aplicativo.',
  sem_advertiser: 'Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.',
  sem_acesso: 'A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.',
  coletando: 'Coletando os dados de Ads da conta…',
};

export default function Ads() {
  const [dias, setDias] = useState<DiasAds>(diasSalvos);
  const { painel, janela, historicoDesde, isError, refetch } = useAdsPainel(dias);
  const escolher = (d: DiasAds) => {
    setDias(d);
    try { localStorage.setItem(CHAVE, String(d)); } catch { /* sem storage: vale só nesta visita */ }
  };

  let corpo;
  if (isError) {
    corpo = (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <p>Não foi possível carregar o painel de Ads.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Tentar de novo</Button>
      </div>
    );
  } else if (!painel) {
    corpo = (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-40" /><Skeleton className="h-64" />
      </div>
    );
  } else if (AVISO[painel.estado]) {
    corpo = <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{AVISO[painel.estado]}</p>;
  } else if (painel.estado === 'sem_ads') {
    corpo = <EmptyState icon={Megaphone} title="Nenhum gasto de Ads no período" description="Quando houver despesa nos anúncios, o resultado aparece aqui." />;
  } else {
    corpo = (
      <div className="flex flex-col gap-4">
        {painel.desatualizado && (
          <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Os dados de Ads estão desatualizados: a última coleta bem-sucedida foi há mais de 48 h.
          </p>
        )}
        {!painel.semaforoLiberado && (
          <p className="text-xs text-muted-foreground">Semáforo em validação: por ora o painel mostra o ACOS de equilíbrio de cada família como referência, sem verde ou vermelho.</p>
        )}
        {painel.conta
          ? <ResumoConta conta={painel.conta} />
          : <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Total da conta indisponível: a coleta ainda não cobre este período.</p>}
        <RankingFamilias painel={painel} historicoDesde={historicoDesde} />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Despesa informada pela API de Ads do Mercado Livre.</p>
          <p>Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.</p>
          <p>
            {historicoDesde
              ? `Vendas desde ${dataBRT(historicoDesde)}, quando a organização começou a vender pelo PubliAI.`
              : 'Vendas desde a entrada da organização no PubliAI.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Ads" subtitle="Quanto o Ads custa e o que sobra depois dele." />
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="group" aria-label="Período" className="flex gap-1">
          {PRESETS.map((p) => (
            <Button key={p.dias} size="sm" variant={dias === p.dias ? 'default' : 'outline'} aria-pressed={dias === p.dias} onClick={() => escolher(p.dias)}>
              {p.label}
            </Button>
          ))}
        </div>
        {painel && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {`${diaMesLiteral(janela.desde)} – ${diaMesLiteral(janela.ate)} · até ${diaMesLiteral(janela.ate)}, último dia com Ads coletado`}
          </p>
        )}
      </div>
      {corpo}
    </div>
  );
}
