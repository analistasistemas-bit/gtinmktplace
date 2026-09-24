import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import { ehCupom, emLeitura, prazoUrgente, rotuloTipo, type Promocao } from '@/lib/promocoes';
import { ContagemSemaforo } from './contagem-semaforo';

const STATUS: Record<string, string> = { started: 'Ativa', pending: 'Futura', finished: 'Encerrada' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CardCampanha({ promocao: p, agoraMs }: { promocao: Promocao; agoraMs: number }) {
  const cupom = ehCupom(p.tipo);
  const banca = p.contagem?.ml_pct_max ?? null;
  const corpo = (
    <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{p.nome ?? rotuloTipo(p.tipo)}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{rotuloTipo(p.tipo)} · {STATUS[p.status] ?? p.status}</span>
      </div>
      {p.prazo_adesao && p.status === 'pending' && (
        <StatusPill tone={prazoUrgente(p.prazo_adesao, agoraMs) ? 'warning' : 'neutral'}>Adesão até {dataHora(p.prazo_adesao)}</StatusPill>
      )}
      {cupom ? (
        <p className="text-sm text-muted-foreground">Cupom vale no carrinho; sem cálculo de líquido.</p>
      ) : p.contagem ? (
        <>
          <p className="text-sm text-muted-foreground">
            {p.status === 'started'
              ? `${fmtInt(p.contagem.participando)} participando · ${fmtInt(p.contagem.convidados)} convidados`
              : `${fmtInt(p.contagem.convidados)} anúncios convidados`}
            {banca != null && ` · ML banca até ${banca}%`}
          </p>
          <ContagemSemaforo contagem={p.contagem} />
          {p.contagem.participando_vermelho > 0 && (
            <StatusPill tone="danger">{fmtInt(p.contagem.participando_vermelho)} participando com líquido abaixo do custo</StatusPill>
          )}
        </>
      ) : (
        <StatusPill tone="neutral">{p.erro ?? 'Anúncios ainda não lidos'}</StatusPill>
      )}
      {emLeitura(p, agoraMs) && <StatusPill tone="info">Lendo anúncios…</StatusPill>}
      {p.erro && p.contagem && <p className="text-xs text-muted-foreground">Não foi possível ler os anúncios na última atualização.</p>}
    </Card>
  );
  if (cupom) return corpo;
  return (
    <Link to={`/promocoes/${encodeURIComponent(p.promocao_id)}`}
      className="group block min-h-11 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {corpo}
    </Link>
  );
}
