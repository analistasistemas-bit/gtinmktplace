import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { ROTULO_ALERTA, type AlertaCampanha, type CampanhaVista, type FamiliaCampanha } from '@/lib/ads-campanhas';
import { ReguaMargem } from './regua-margem';
import { LinhaMlb } from './linha-mlb';

const LINK = 'font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';
export const CELULA = 'px-3 py-3 align-top whitespace-normal';
const TOM_ALERTA: Record<AlertaCampanha, StatusTone> = {
  roas_acima_margem: 'danger', patrocinado_parado: 'warning', parcialmente_patrocinada: 'neutral',
};

export interface AcoesFamilia {
  verDesempenho?: (codigoPai: string) => void;
  /** Só famílias com linha no painel do período atual têm o link; ausente = todas. */
  temDesempenho?: (codigoPai: string) => boolean;
}
interface Props extends AcoesFamilia { f: FamiliaCampanha; campanha: CampanhaVista }

function NomeFamilia({ f }: { f: FamiliaCampanha }) {
  return (
    <>
      <Link to={`/faturamento/sku/familia/${encodeURIComponent(f.codigoPai)}`} className={cn(LINK, 'line-clamp-2 break-words')}
        title={f.nome ?? f.codigoPai}>
        {f.nome ?? f.codigoPai}
      </Link>
      {f.nome && <span className="block text-xs text-muted-foreground tabular-nums">{f.codigoPai}</span>}
    </>
  );
}

const Patrocinio = ({ f }: { f: FamiliaCampanha }) => (
  <span className="tabular-nums">
    {f.publicados > 0 ? `${f.patrocinados} de ${f.publicados} anúncios` : 'Sem dado'}
  </span>
);

function Alertas({ f }: { f: FamiliaCampanha }) {
  if (!f.alertas.length) return <span className="text-muted-foreground">Sem alertas</span>;
  return (
    <ul aria-label="Alertas" className="flex flex-wrap gap-1.5">
      {f.alertas.map(a => <li key={a}><StatusPill tone={TOM_ALERTA[a]}>{ROTULO_ALERTA[a]}</StatusPill></li>)}
    </ul>
  );
}

function Regua({ f, campanha }: { f: FamiliaCampanha; campanha: CampanhaVista }) {
  return (
    <ReguaMargem equilibrioPct={f.equilibrioPct} motivo={f.motivoEquilibrio} acosAlvo={campanha.acosObjetivo}
      acima={f.alertas.includes('roas_acima_margem')} />
  );
}

function BotaoDetalhes({ f, aberto, controla, onClick, compacto }: {
  f: FamiliaCampanha; aberto: boolean; controla: string; onClick: () => void; compacto?: boolean;
}) {
  return (
    <Button type="button" variant={compacto ? 'ghost' : 'outline'} size="sm"
      className={compacto ? 'h-11 w-11 px-0 sm:h-8 sm:w-8' : 'h-11 sm:h-8'}
      aria-label={`Ver anúncios de ${f.nome ?? f.codigoPai}`} aria-expanded={aberto} aria-controls={controla} onClick={onClick}>
      {!compacto && 'Detalhes'}
      <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
    </Button>
  );
}

function Detalhe({ f, verDesempenho, temDesempenho }: { f: FamiliaCampanha } & AcoesFamilia) {
  return (
    <div className="space-y-2">
      <ul aria-label={`Anúncios patrocinados de ${f.nome ?? f.codigoPai}`} className="divide-y divide-border">
        {f.anuncios.map(a => <LinhaMlb key={a.mlb} a={a} />)}
      </ul>
      {verDesempenho && (temDesempenho?.(f.codigoPai) ?? true) && (
        <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => verDesempenho(f.codigoPai)}>
          Ver desempenho
        </Button>
      )}
    </div>
  );
}

export function LinhaFamilia({ f, campanha, verDesempenho, temDesempenho }: Props) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <>
      <TableRow>
        <TableCell className={CELULA}><NomeFamilia f={f} /></TableCell>
        <TableCell className={CELULA}><Patrocinio f={f} /></TableCell>
        <TableCell className={CELULA}><Regua f={f} campanha={campanha} /></TableCell>
        <TableCell className={CELULA}><Alertas f={f} /></TableCell>
        <TableCell className={`${CELULA} text-right`}>
          <BotaoDetalhes f={f} aberto={aberto} controla={id} onClick={() => setAberto(v => !v)} compacto />
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell id={id} colSpan={5} className="px-3 py-3 whitespace-normal">
            <Detalhe f={f} verDesempenho={verDesempenho} temDesempenho={temDesempenho} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function CartaoFamilia({ f, campanha, verDesempenho, temDesempenho }: Props) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <li className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0"><NomeFamilia f={f} /></div>
      <Regua f={f} campanha={campanha} />
      {f.alertas.length > 0 && <Alertas f={f} />}
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Patrocínio</span><Patrocinio f={f} />
      </p>
      <BotaoDetalhes f={f} aberto={aberto} controla={id} onClick={() => setAberto(v => !v)} />
      {aberto && (
        <div id={id} className="border-t border-border pt-3"><Detalhe f={f} verDesempenho={verDesempenho} temDesempenho={temDesempenho} /></div>
      )}
    </li>
  );
}
