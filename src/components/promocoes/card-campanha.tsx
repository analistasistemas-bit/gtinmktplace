import { Link } from 'react-router-dom';
import { CircleX, ChevronRight, Clock, Handshake, Layers, Loader2, Megaphone, Scale, Ticket, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtInt, fmtPct } from '@/lib/formato';
import { ehCupom, emLeitura, prazoUrgente, rotuloTipo, STATUS_CAMPANHA as STATUS, STATUS_CAMPANHA_DOT as STATUS_DOT, type Promocao } from '@/lib/promocoes';
import { DistribuicaoSemaforo } from './contagem-semaforo';
const ICONE_TIPO: Record<string, typeof Zap> = {
  LIGHTNING: Zap, SELLER_COUPON_CAMPAIGN: Ticket, PRICE_MATCHING: Scale, SMART: Handshake, VOLUME: Layers,
};
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CardCampanha({ promocao: p, agoraMs }: { promocao: Promocao; agoraMs: number }) {
  const cupom = ehCupom(p.tipo);
  const banca = p.contagem?.ml_pct_max ?? null;
  const IconeTipo = ICONE_TIPO[p.tipo] ?? Megaphone;

  const stats = p.contagem && (
    p.status === 'started'
      ? [{ label: 'Participando', valor: p.contagem.participando }, { label: 'Convidados', valor: p.contagem.convidados }]
      : [{ label: 'Convidados', valor: p.contagem.convidados }, { label: 'Vale a pena', valor: p.contagem.convidados_verde }]
  );

  const corpo = (
    <Card className="h-full gap-0 p-0 transition-[transform,box-shadow] duration-200 motion-safe:group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-primary/30">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <IconeTipo className="size-3.5" aria-hidden />{rotuloTipo(p.tipo)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[p.status] ?? 'bg-muted-foreground/50')} aria-hidden />
              {STATUS[p.status] ?? p.status}
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight">{p.nome ?? rotuloTipo(p.tipo)}</h3>
          {p.prazo_adesao && p.status === 'pending' && (
            <p className={cn('inline-flex items-center gap-1.5 text-xs', prazoUrgente(p.prazo_adesao, agoraMs) ? 'font-medium text-warning' : 'text-muted-foreground')}>
              <Clock className="size-3.5" aria-hidden />Adesão até {dataHora(p.prazo_adesao)}
            </p>
          )}
        </header>
        {cupom ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Ticket className="size-4 shrink-0" aria-hidden />Cupom vale no carrinho; sem cálculo de líquido.
          </p>
        ) : p.contagem && stats ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col-reverse">
                  <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums tracking-tight">{fmtInt(stat.valor)}</dd>
                </div>
              ))}
            </dl>
            <DistribuicaoSemaforo contagem={p.contagem} />
            {p.contagem.participando_vermelho > 0 && (
              <p className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                <CircleX className="size-3.5" aria-hidden />{fmtInt(p.contagem.participando_vermelho)} participando com líquido abaixo do custo
              </p>
            )}
          </>
        ) : (
          <StatusPill tone="neutral" title={p.erro ?? undefined}>{p.erro ? 'Não foi possível ler os anúncios' : 'Anúncios ainda não lidos'}</StatusPill>
        )}
        {emLeitura(p, agoraMs) && (
          <p className="inline-flex items-center gap-1.5 text-xs text-info">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Lendo anúncios…
          </p>
        )}
        {p.erro && p.contagem && <StatusPill tone="neutral">Não foi possível ler os anúncios</StatusPill>}
      </div>
      {!cupom && (
        <footer className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <span>{banca != null ? `ML banca até ${fmtPct(banca)}` : ''}</span>
          <span className="inline-flex items-center gap-1 font-medium transition-colors group-hover:text-primary">
            Ver anúncios<ChevronRight className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
          </span>
        </footer>
      )}
    </Card>
  );
  if (cupom) return corpo;
  return (
    <Link to={`/promocoes/${encodeURIComponent(p.promocao_id)}`}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {corpo}
    </Link>
  );
}
