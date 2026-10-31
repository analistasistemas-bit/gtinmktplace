import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
import { Section } from '@/components/ui/section';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtBRLSinal } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContaPainel, FamiliaPainel, PainelAds, Semaforo } from '@/lib/ads-painel';
import {
  NADA, pct, textoMotivo, contarFamiliasAds, filtrarFamiliasAds, buscarFamiliasAds, ordenarFamiliasAds,
  type FiltroFamiliasAds, type ColunaFamiliasAds, type DirecaoAds,
} from '@/lib/ads-apresentacao';
import { DetalheFamilia } from '@/components/ads/detalhe-familia';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';
import { primeiroDiaCoberto } from '@/lib/sku-ads';

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
  /** Família que chegou pelo "Ver desempenho" da aba Campanhas: nasce aberta e rola até a tela. */
  foco?: boolean;
}

/** Rola até o elemento uma vez, quando a família é o foco (`scrollIntoView` ausente no jsdom). */
function useRolarAoFoco<T extends HTMLElement>(foco?: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => { if (foco) ref.current?.scrollIntoView?.({ block: 'center' }); }, [foco]);
  return ref;
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

/** Rótulo de coluna com (i); a descrição vive em `kpi-descriptions` sob `<rótulo>::Ads`. */
function Cabecalho({ rotulo }: { rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 max-sm:[&_button]:-m-[15px] max-sm:[&_button]:p-[15px]">
      {rotulo}<KpiInfoButton infoKey={`${rotulo}::Ads`} />
    </span>
  );
}

/** ACOS direto da família (gasto ÷ vendas diretas). A barra compara com o equilíbrio e só existe com semáforo do
 *  domínio (cor e selo nunca fabricados aqui); a largura é só a proporção, travada em 100%. */
function AcosDireto({ f, liberado }: { f: FamiliaPainel; liberado: boolean }) {
  const sem = liberado && f.semaforo ? SEMAFORO[f.semaforo] : null;
  const ads = f.vendasDiretas === 0 ? null : f.acosDireto;
  const eq = f.acosEquilibrio;
  const largura = sem && ads != null && eq != null && eq > 0 ? Math.min(ads / eq, 1) : null;
  return (
    <div className="space-y-1.5">
      <span className={cn('block font-medium tabular-nums', ads == null && 'text-sm font-normal text-muted-foreground')}>
        {ads == null ? 'sem venda direta' : pct(ads)}
      </span>
      {largura != null && (
        <div aria-hidden className="ml-auto h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
          <div data-testid="barra-uso-margem" style={{ width: `${largura * 100}%` }}
            className={cn('h-full rounded-full motion-safe:transition-[width]',
              sem?.tom === 'danger' ? 'bg-danger' : 'bg-success')} />
        </div>
      )}
      {sem && <StatusPill tone={sem.tom}>{sem.txt}</StatusPill>}
    </div>
  );
}

/** Equilíbrio observado: lucro antes de Ads sobre as vendas da família no período (texto, nunca zero presumido). */
function Equilibrio({ f }: { f: FamiliaPainel }) {
  const eq = f.acosEquilibrio;
  return eq != null && eq > 0
    ? <span className="block font-medium tabular-nums">{pct(eq)}</span>
    : <span className="block text-sm text-muted-foreground">{eq == null ? 'sem referência' : 'sem margem para Ads'}</span>;
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

/** Cabeçalho ordenável: o botão de ordenar e o (i) são irmãos (botão dentro de botão é inválido); aria-sort no <th>. */
function CabecalhoOrdenavel({ rotulo, coluna, ordem, onOrdenar, className, direita }: {
  rotulo: string; coluna: ColunaFamiliasAds; ordem: { coluna: ColunaFamiliasAds; direcao: DirecaoAds };
  onOrdenar: (c: ColunaFamiliasAds) => void; className: string; direita?: boolean;
}) {
  const ativa = ordem.coluna === coluna;
  const Icone = !ativa ? ChevronsUpDown : ordem.direcao === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead scope="col" className={cn('px-3 align-bottom whitespace-normal', direita && 'text-right', className)}
      aria-sort={ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className={cn('inline-flex items-center gap-1.5', direita && 'justify-end')}>
        <button type="button" onClick={() => onOrdenar(coluna)}
          className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ativa && 'text-foreground')}>
          {rotulo}
          <Icone aria-hidden className={cn('h-3 w-3 shrink-0', ativa ? 'opacity-100' : 'opacity-50')} />
        </button>
        <KpiInfoButton infoKey={`${rotulo}::Ads`} />
      </span>
    </TableHead>
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

function LinhaFamilia({ f, liberado, conta, historicoDesde, foco }: PropsFamilia) {
  const [aberto, setAberto] = useState(!!foco);
  const id = useId();
  const ref = useRolarAoFoco<HTMLDivElement>(foco);
  return (
    <>
      <TableRow>
        <TableCell className={CELULA}><div ref={ref}><NomeFamilia f={f} /></div></TableCell>
        <TableCell className={NUM}>{fmtBRL(f.custo)}</TableCell>
        <TableCell className={NUM}><AcosDireto f={f} liberado={liberado} /></TableCell>
        <TableCell className={NUM}><Equilibrio f={f} /></TableCell>
        <TableCell className={NUM}><Resultado f={f} conta={conta} historicoDesde={historicoDesde} /></TableCell>
        <TableCell className={`${CELULA} text-right`}>
          <BotaoDetalhes f={f} aberto={aberto} controla={id} onClick={() => setAberto(v => !v)} compacto />
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell id={id} colSpan={6} className="px-3 py-3 whitespace-normal">
            <DetalheFamilia familia={f} conta={conta} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function CartaoFamilia({ f, liberado, conta, historicoDesde, foco }: PropsFamilia) {
  const [aberto, setAberto] = useState(!!foco);
  const id = useId();
  const ref = useRolarAoFoco<HTMLLIElement>(foco);
  return (
    <li ref={ref} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0"><NomeFamilia f={f} /></div>
      <dl className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground"><Cabecalho rotulo="Investimento" /></dt>
          <dd className="text-right tabular-nums">{fmtBRL(f.custo)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground"><Cabecalho rotulo="ACOS direto" /></dt>
          <dd className="text-right"><AcosDireto f={f} liberado={liberado} /></dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground"><Cabecalho rotulo="Equilíbrio observado" /></dt>
          <dd className="text-right"><Equilibrio f={f} /></dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground"><Cabecalho rotulo="Resultado após Ads" /></dt>
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
export function RankingFamilias({ painel, historicoDesde, focoCodigoPai }: {
  painel: PainelAds; historicoDesde: string | null; focoCodigoPai?: string | null;
}) {
  const [filtro, setFiltro] = useState<FiltroFamiliasAds>('todas');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<{ coluna: ColunaFamiliasAds; direcao: DirecaoAds }>({ coluna: 'investimento', direcao: 'desc' });
  const { conta, familias, semaforoLiberado: liberado } = painel;
  const contagem = contarFamiliasAds(familias, liberado);
  const acima = contagem.acima + contagem.semEspaco;   // mesma regra do filtro `acima`
  const visiveis = ordenarFamiliasAds(
    buscarFamiliasAds(filtrarFamiliasAds(familias, filtro, liberado), busca), ordem.coluna, ordem.direcao);
  const ordenarPor = (coluna: ColunaFamiliasAds) => setOrdem(o => o.coluna === coluna
    ? { coluna, direcao: o.direcao === 'asc' ? 'desc' : 'asc' }
    : { coluna, direcao: coluna === 'nome' ? 'asc' : 'desc' });
  const alternar = (alvo: FiltroFamiliasAds) => setFiltro(atual => (atual === alvo ? 'todas' : alvo));

  // Semáforo desligado: a única mensagem é a de validação, na página.
  const fraseAtencao = !liberado || acima > 0
    ? null
    : contagem.semReferencia > 0
      ? historicoDesde && familias.some(f => f.motivo === 'historico')
        ? `Sem referência: histórico de vendas só desde ${dataBRT(historicoDesde)}. Escolha um período a partir de ${primeiroDiaCoberto(historicoDesde).split('-').reverse().join('/')}.`
        : 'Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.'
      : 'Nenhuma família acima do equilíbrio neste período.';

  const filtros = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <KpiCard size="compact" label="Todas" infoKey="Todas::Ads" value={contagem.total}
          ativo={filtro === 'todas'} onClick={() => setFiltro('todas')} className={CARD_FILTRO} />
        {acima > 0 && (
          <KpiCard size="compact" label="Acima do equilíbrio" infoKey="Acima do equilíbrio::Ads" value={acima} tom="danger"
            ativo={filtro === 'acima'} onClick={() => alternar('acima')} className={CARD_FILTRO} />
        )}
        <KpiCard size="compact" label="Dentro do equilíbrio" infoKey="Dentro do equilíbrio::Ads" value={contagem.dentro}
          tom={liberado ? 'success' : undefined} ativo={filtro === 'dentro'} onClick={() => alternar('dentro')} desabilitado={contagem.dentro === 0} className={CARD_FILTRO} />
        <KpiCard size="compact" label="Sem referência" infoKey="Sem referência::Ads" value={contagem.semReferencia}
          ativo={filtro === 'sem_referencia'} onClick={() => alternar('sem_referencia')} desabilitado={contagem.semReferencia === 0} className={CARD_FILTRO} />
      </div>
      {fraseAtencao && <p className="text-sm text-muted-foreground">{fraseAtencao}</p>}
      <div className="relative sm:max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou código"
          aria-label="Buscar família por nome ou código" className="h-11 pl-8 text-base sm:h-8 sm:text-sm" />
      </div>
    </div>
  );

  const props = (f: FamiliaPainel) => ({ f, liberado, conta, historicoDesde, foco: f.codigoPai === focoCodigoPai });
  const conteudoRanking = visiveis.length === 0 ? (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p>{busca.trim() ? 'Nenhuma família encontrada com esta busca e filtro.' : 'Nenhuma família neste filtro no período.'}</p>
      <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => { setFiltro('todas'); setBusca(''); }}>Ver todas</Button>
    </div>
  ) : (
    <>
      <div className="hidden rounded-lg border border-border xl:block">
        <Table aria-label="Famílias por gasto" className="table-fixed">
          <TableHeader>
            <TableRow>
              <CabecalhoOrdenavel rotulo="Família" coluna="nome" ordem={ordem} onOrdenar={ordenarPor} className="w-[28%]" />
              <CabecalhoOrdenavel rotulo="Investimento" coluna="investimento" ordem={ordem} onOrdenar={ordenarPor} className="w-[13%]" direita />
              <CabecalhoOrdenavel rotulo="ACOS direto" coluna="acos_direto" ordem={ordem} onOrdenar={ordenarPor} className="w-[17%]" direita />
              <CabecalhoOrdenavel rotulo="Equilíbrio observado" coluna="equilibrio" ordem={ordem} onOrdenar={ordenarPor} className="w-[15%]" direita />
              <CabecalhoOrdenavel rotulo="Resultado após Ads" coluna="resultado" ordem={ordem} onOrdenar={ordenarPor} className="w-[21%]" direita />
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
      <Section title="Famílias por gasto" description="ACOS direto de cada família contra o equilíbrio observado no período.">
        {familias.length === 0
          ? <p className="text-sm text-muted-foreground">Nenhum gasto de Ads por família no período.</p>
          : <>{filtros}{conteudoRanking}</>}
      </Section>
    </div>
  );
}
