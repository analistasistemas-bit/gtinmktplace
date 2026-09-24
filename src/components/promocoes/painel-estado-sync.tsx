import { Link } from 'react-router-dom';
import { BadgePercent, PlugZap } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import type { EstadoSyncPromo } from '@/lib/promocoes';

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

export function PainelEstadoSync({ estado, temDados, onAtualizar, atualizando }: {
  estado: EstadoSyncPromo | null; temDados: boolean; onAtualizar: () => void; atualizando: boolean;
}) {
  if (estado?.estado === 'sincronizando' && !temDados) {
    return <EmptyState icon={BadgePercent} title="Buscando as promoções no Mercado Livre…" description="Leva até 2 minutos." />;
  }
  if (!estado && !temDados) {
    return (
      <EmptyState icon={BadgePercent} title="Ainda não buscamos as promoções desta conta."
        action={<Button onClick={onAtualizar} disabled={atualizando}>Buscar promoções agora</Button>} />
    );
  }
  if (estado?.estado === 'sem_acesso' && !temDados) {
    return (
      <EmptyState icon={PlugZap} title="O Mercado Livre não liberou promoções para esta conta."
        description="Isso depende da reputação da conta e da permissão de ofertas da conexão."
        action={<Button asChild variant="outline"><Link to="/canais">Reconectar em Canais</Link></Button>} />
    );
  }
  if (estado?.estado === 'sem_promocoes' && !temDados) {
    return (
      <EmptyState icon={BadgePercent} title="O Mercado Livre não convidou seus anúncios para nenhuma promoção agora."
        description="Campanhas novas aparecem aqui sozinhas a cada 6 horas." />
    );
  }
  if ((estado?.estado === 'erro' || estado?.estado === 'sem_acesso') && temDados) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-2 text-sm text-warning">
        <span>A última atualização falhou às {hora(estado.ultimo_erro_em)}. Mostrando dados de {hora(estado.ultimo_ok_em)}.</span>
        <Button size="sm" variant="outline" onClick={onAtualizar} disabled={atualizando}>Tentar de novo</Button>
      </div>
    );
  }
  if (estado?.estado === 'erro') {
    return (
      <EmptyState icon={BadgePercent} title="Não foi possível buscar as promoções."
        description={estado.erro ?? undefined}
        action={<Button onClick={onAtualizar} disabled={atualizando}>Tentar de novo</Button>} />
    );
  }
  return null;
}
