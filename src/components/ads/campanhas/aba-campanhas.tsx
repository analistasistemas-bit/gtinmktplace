import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import type { useAdsCampanhas } from '@/hooks/useAdsCampanhas';
import type { CampanhaVista } from '@/lib/ads-campanhas';
import { Aviso, AVISO } from '@/components/ads/aviso';
import { BlocoCampanha } from './bloco-campanha';
import type { AcoesFamilia } from './familia-campanha';

type Filtro = 'todas' | 'alerta' | 'sem_referencia';
const BOTAO = 'h-11 sm:h-8';
// Mesmo ajuste de alvo de toque do ranking (o (i) do KpiCard tem 38 px).
const CARD_FILTRO = 'sm:min-w-36 max-sm:[&_button]:p-[15px] max-sm:[&_button]:-m-[15px]';

export type DadosCampanhas = ReturnType<typeof useAdsCampanhas>;

const lidoAs = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
    .format(new Date(iso));

const PASSA: Record<Filtro, (f: CampanhaVista['familias'][number]) => boolean> = {
  todas: () => true,
  alerta: f => f.alertas.length > 0,
  sem_referencia: f => f.equilibrioPct == null,
};

function Carregando() {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" aria-busy="true" aria-label="Carregando campanhas">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
    </div>
  );
}

/** Aba Campanhas: estado atual das campanhas no ML agrupado por família (emenda ADR-0179). */
export function AbaCampanhas({ dados, ...acoes }: { dados: DadosCampanhas } & AcoesFamilia) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const { resposta, campanhas, isLoading, isError, erro, atualizando, atualizar } = dados;

  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <p>{erro?.message || 'Não foi possível carregar as campanhas.'}</p>
        <Button variant="outline" size="sm" className={`mt-3 ${BOTAO}`} onClick={() => void atualizar()}>Tentar de novo</Button>
      </div>
    );
  }
  if (isLoading || !resposta || !campanhas) return <Carregando />;
  if (resposta.estado !== 'ok') {
    const texto = AVISO[resposta.estado] ?? 'Não foi possível ler as campanhas.';
    const precisaCanais = resposta.estado === 'sem_conexao' || resposta.estado === 'sem_permissao' || resposta.estado === 'sem_acesso';
    return (
      <Aviso texto={texto} acao={precisaCanais && (
        <Button asChild variant="outline" size="sm" className={BOTAO}><Link to="/configuracoes/canais">Abrir Canais</Link></Button>
      )} />
    );
  }
  if (campanhas.length === 0) {
    return (
      <EmptyState icon={Megaphone} title="Nenhuma campanha ativa ou pausada"
        description="Quando você criar uma campanha no Mercado Ads, ela aparece aqui com os produtos e a margem de cada um." />
    );
  }

  const todas = campanhas.flatMap(c => c.familias);
  const emAlerta = todas.filter(PASSA.alerta).length;
  const semRef = todas.filter(PASSA.sem_referencia).length;
  const alternar = (alvo: Filtro) => setFiltro(atual => (atual === alvo ? 'todas' : alvo));
  const filtrando = filtro !== 'todas';
  const visiveis = campanhas
    .map(c => ({ ...c, familias: c.familias.filter(PASSA[filtro]) }))
    .filter(c => !filtrando || c.familias.length > 0);

  return (
    <div className="space-y-6">
      {!resposta.aliquotasConfirmadas && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Confirme as alíquotas de imposto em <Link to="/configuracoes" className="font-medium underline underline-offset-2">Configurações</Link> para ver a margem.
        </p>
      )}
      {resposta.projecaoLimitada && (
        <p role="status" className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info">
          Alguns anúncios ficaram fora da projeção de margem nesta leitura.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <KpiCard size="compact" label="Todas" infoKey="Todas::Campanhas" value={todas.length}
          ativo={filtro === 'todas'} onClick={() => setFiltro('todas')} className={CARD_FILTRO} />
        <KpiCard size="compact" label="Em alerta" infoKey="Em alerta::Campanhas" value={emAlerta} tom="warning"
          ativo={filtro === 'alerta'} onClick={() => alternar('alerta')} desabilitado={emAlerta === 0} className={CARD_FILTRO} />
        <KpiCard size="compact" label="Sem referência" infoKey="Sem referência::Campanhas" value={semRef}
          ativo={filtro === 'sem_referencia'} onClick={() => alternar('sem_referencia')} desabilitado={semRef === 0} className={CARD_FILTRO} />
      </div>
      {visiveis.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p>Nenhuma família neste filtro.</p>
          <Button type="button" variant="outline" size="sm" className={BOTAO} onClick={() => setFiltro('todas')}>Ver todas</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {visiveis.map(c => <BlocoCampanha key={c.id} c={c} filtrando={filtrando} {...acoes} />)}
        </div>
      )}
      <div className="space-y-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums">Lido às {lidoAs(resposta.lidoEm)}</span>
          <Button type="button" variant="outline" size="sm" className={BOTAO} disabled={atualizando} onClick={() => void atualizar()}>
            {atualizando && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {atualizando ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
        <div className="space-y-1">
          <p>Estado atual das campanhas no Mercado Livre; gasto e resultado ficam em Desempenho.</p>
          <p>Margem para Ads = ACOS máximo que o produto aguenta sem prejuízo no preço atual.</p>
        </div>
      </div>
    </div>
  );
}
