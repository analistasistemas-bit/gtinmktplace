import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
import { Section } from '@/components/ui/section';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtBRLSinal } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContaPainel, FamiliaPainel, PainelAds, Semaforo } from '@/lib/ads-painel';
import {
  NADA, pct, textoMotivo, contarFamiliasAds, filtrarFamiliasAds, type FiltroFamiliasAds,
} from '@/lib/ads-apresentacao';
import { DetalheFamilia } from '@/components/ads/detalhe-familia';

const SEMAFORO: Record<Semaforo, { tom: 'success' | 'danger'; txt: string }> = {
  dentro: { tom: 'success', txt: 'Dentro do equilíbrio' },
  acima: { tom: 'danger', txt: 'Acima do equilíbrio' },
  sem_espaco: { tom: 'danger', txt: 'Sem espaço para Ads' },
};
const LINK = 'font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';
const CELULA = 'px-3 py-3 align-top whitespace-normal';
const NUM = `${CELULA} text-right tabular-nums`;

interface PropsFamilia {
  f: FamiliaPainel;
  liberado: boolean;
  conta: ContaPainel | null;
  historicoDesde: string | null;
}

function NomeFamilia({ f }: { f: FamiliaPainel }) {
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

const ROTULO_USO = 'Ads sobre a margem';
const INFO_USO = `${ROTULO_USO}::Ads`;

function CabecalhoUso() {
  return (
    <span className="inline-flex items-center gap-1.5 max-sm:[&_button]:-m-[15px] max-sm:[&_button]:p-[15px]">
      {ROTULO_USO}<KpiInfoButton infoKey={INFO_USO} />
    </span>
  );
}

/** Uso da margem pelo Ads: ACOS direto sobre o ACOS de equilíbrio. Barra só com semáforo do domínio (cor e selo nunca
 *  fabricados aqui); a largura é só a proporção, travada em 100%. Sem semáforo, fica só o texto. */
function UsoMargem({ f, liberado }: { f: FamiliaPainel; liberado: boolean }) {
  const sem = liberado && f.semaforo ? SEMAFORO[f.semaforo] : null;
  const ads = f.vendasDiretas === 0 ? null : f.acosDireto;
  const eq = f.acosEquilibrio;
  const largura = sem && ads != null && eq != null && eq > 0 ? Math.min(ads / eq, 1) : null;
  const limite = eq == null ? ' · sem referência' : eq <= 0 ? ' · sem margem para Ads'
    : ads == null ? ` · até ${pct(eq)} possíveis` : ` de ${pct(eq)} possíveis`;
  return (
    <div className="space-y-1.5">
      {largura != null && (
        <div aria-hidden className="ml-auto h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
          <div data-testid="barra-uso-margem" style={{ width: `${largura * 100}%` }}
            className={cn('h-full rounded-full motion-safe:transition-[width]',
              sem?.tom === 'danger' ? 'bg-danger' : 'bg-success')} />
        </div>
      )}
      <span className="block tabular-nums">
        Ads {ads == null ? <span>sem venda direta</span> : pct(ads)}{limite}
      </span>
      {sem && <StatusPill tone={sem.tom}>{sem.txt}</StatusPill>}
    </div>
  );
}

/** Resultado após Ads com tudo o que o condiciona: travessão + motivo, marca de custo e divergência da conta. */
function Resultado({ f, conta, historicoDesde }: Omit<PropsFamilia, 'liberado'>) {
  // O texto longo só vale quando o motivo é custo_parcial; com outro motivo, a fonte vira marca curta.
  const marca =
    f.motivo === 'custo_parcial'
      ? textoMotivo('custo_parcial', null)
      : f.fonteCusto === 'parcial' || f.fonteCusto === 'estimado'
        ? `custo ${f.fonteCusto}`
        : null;
  return (
    <div role="group" aria-label="Resultado após Ads" className="space-y-1">
      <span className={cn('block font-medium tabular-nums', f.resultado != null && f.resultado < 0 && 'text-danger')}>
        {f.resultado == null ? NADA : fmtBRLSinal(f.resultado)}
      </span>
      {f.motivo && f.motivo !== 'custo_parcial' && (
        <span className="block text-xs text-muted-foreground">{textoMotivo(f.motivo, historicoDesde)}</span>
      )}
      {marca && <StatusPill tone="neutral">{marca}</StatusPill>}
      {conta?.divergente && <span className="block text-xs text-warning">Composição da conta divergente</span>}
    </div>
  );
}

function BotaoDetalhes({ f, aberto, controla, onClick, compacto }: {
  f: FamiliaPainel; aberto: boolean; controla: string; onClick: () => void; compacto?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={compacto ? 'ghost' : 'outline'}
      size="sm"
      className={compacto ? 'h-11 w-11 px-0 sm:h-8 sm:w-8' : 'h-11 sm:h-8'}
      aria-label={`Ver detalhes de ${f.nome ?? f.codigoPai}`}
      aria-expanded={aberto}
      aria-controls={controla}
      onClick={onClick}
    >
      {!compacto && 'Detalhes'}
      <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
    </Button>
  );
}

function LinhaFamilia({ f, liberado, conta, historicoDesde }: PropsFamilia) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <>
      <TableRow>
        <TableCell className={CELULA}><NomeFamilia f={f} /></TableCell>
        <TableCell className={NUM}>{fmtBRL(f.custo)}</TableCell>
        <TableCell className={NUM}><UsoMargem f={f} liberado={liberado} /></TableCell>
        <TableCell className={NUM}><Resultado f={f} conta={conta} historicoDesde={historicoDesde} /></TableCell>
        <TableCell className={`${CELULA} text-right`}>
          <BotaoDetalhes f={f} aberto={aberto} controla={id} onClick={() => setAberto(v => !v)} compacto />
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell id={id} colSpan={5} className="px-3 py-3 whitespace-normal">
            <DetalheFamilia familia={f} conta={conta} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function CartaoFamilia({ f, liberado, conta, historicoDesde }: PropsFamilia) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <li className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0"><NomeFamilia f={f} /></div>
      <dl className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Gasto</dt>
          <dd className="text-right tabular-nums">{fmtBRL(f.custo)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground"><CabecalhoUso /></dt>
          <dd className="text-right"><UsoMargem f={f} liberado={liberado} /></dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Resultado após Ads</dt>
          <dd className="text-right"><Resultado f={f} conta={conta} historicoDesde={historicoDesde} /></dd>
        </div>
      </dl>
      <BotaoDetalhes f={f} aberto={aberto} controla={id} onClick={() => setAberto(v => !v)} />
      {aberto && (
        <div id={id} className="border-t border-border pt-3">
          <DetalheFamilia familia={f} conta={conta} />
        </div>
      )}
    </li>
  );
}

// O (i) do KpiCard tem 38 px; no mobile o alvo de toque sobe para 44 px (14 + 2×15) sem mexer no layout
// (margem negativa igual ao padding). Fica aqui, não no KpiCard, para não alterar as outras telas.
const CARD_FILTRO = 'sm:min-w-36 max-sm:[&_button]:p-[15px] max-sm:[&_button]:-m-[15px]';

/** Ranking por gasto (ordem do domínio) com os filtros por semáforo; filtro e expansões são locais e a página
 *  reinicia tudo pela `key` quando a seleção ou a janela mudam. */
export function RankingFamilias({ painel, historicoDesde }: { painel: PainelAds; historicoDesde: string | null }) {
  const [filtro, setFiltro] = useState<FiltroFamiliasAds>('todas');
  const { conta, familias, semaforoLiberado: liberado } = painel;
  const contagem = contarFamiliasAds(familias, liberado);
  const atencao = contagem.acima + contagem.semEspaco;
  const visiveis = filtrarFamiliasAds(familias, filtro, liberado);
  const alternar = (alvo: FiltroFamiliasAds) => setFiltro(atual => (atual === alvo ? 'todas' : alvo));

  // Semáforo desligado: a única mensagem é a de validação, na página.
  const fraseAtencao = !liberado || atencao > 0
    ? null
    : contagem.semReferencia > 0
      ? 'Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.'
      : 'Nenhuma família acima do equilíbrio neste período.';

  const filtros = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <KpiCard size="compact" label="Todas" infoKey="Todas::Ads" value={contagem.total}
          ativo={filtro === 'todas'} onClick={() => setFiltro('todas')} className={CARD_FILTRO} />
        {atencao > 0 && (
          <KpiCard size="compact" label="Em atenção" infoKey="Em atenção::Ads" value={atencao} tom="warning"
            ativo={filtro === 'atencao'} onClick={() => alternar('atencao')} className={CARD_FILTRO} />
        )}
        <KpiCard size="compact" label="Dentro do equilíbrio" infoKey="Dentro do equilíbrio::Ads" value={contagem.dentro}
          tom={liberado ? 'success' : undefined} ativo={filtro === 'dentro'} onClick={() => alternar('dentro')} desabilitado={contagem.dentro === 0} className={CARD_FILTRO} />
        <KpiCard size="compact" label="Sem referência" infoKey="Sem referência::Ads" value={contagem.semReferencia}
          ativo={filtro === 'sem_referencia'} onClick={() => alternar('sem_referencia')} desabilitado={contagem.semReferencia === 0} className={CARD_FILTRO} />
      </div>
      {fraseAtencao && <p className="text-sm text-muted-foreground">{fraseAtencao}</p>}
    </div>
  );

  const props = (f: FamiliaPainel) => ({ f, liberado, conta, historicoDesde });
  const conteudoRanking = visiveis.length === 0 ? (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p>Nenhuma família neste filtro no período.</p>
      <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => setFiltro('todas')}>Ver todas</Button>
    </div>
  ) : (
    <>
      <div className="hidden rounded-lg border border-border xl:block">
        <Table aria-label="Famílias por gasto" className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-[34%] px-3 align-bottom whitespace-normal">Família</TableHead>
              <TableHead scope="col" className="w-[14%] px-3 text-right align-bottom whitespace-normal">Gasto</TableHead>
              <TableHead scope="col" className="w-[22%] px-3 text-right align-bottom whitespace-normal"><CabecalhoUso /></TableHead>
              <TableHead scope="col" className="w-[24%] px-3 text-right align-bottom whitespace-normal">Resultado após Ads</TableHead>
              <TableHead scope="col" className="w-[6%] px-3 text-right align-bottom whitespace-normal"><span className="sr-only">Detalhes</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map(f => <LinhaFamilia key={f.codigoPai} {...props(f)} />)}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Famílias por gasto em cartões" className="grid gap-3 md:grid-cols-2 xl:hidden">
        {visiveis.map(f => <CartaoFamilia key={f.codigoPai} {...props(f)} />)}
      </ul>
    </>
  );

  return (
    <div role="region" aria-label="Ranking de famílias">
      <Section title="Famílias por gasto" description="Quanto da margem de cada família o Ads está usando.">
        {familias.length === 0
          ? <p className="text-sm text-muted-foreground">Nenhum gasto de Ads por família no período.</p>
          : <>{filtros}{conteudoRanking}</>}
      </Section>
    </div>
  );
}
