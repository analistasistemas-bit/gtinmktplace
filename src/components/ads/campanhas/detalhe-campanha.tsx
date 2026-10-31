import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, X } from 'lucide-react';
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { TELA_ADS } from '@/components/ads/tela-ads';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Aviso, AVISO } from '@/components/ads/aviso';
import { FaixaKpis } from '@/components/ads/faixa-kpis';
import { SerieDiaria } from '@/components/ads/serie-diaria';
import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { fmtBRL } from '@/lib/formato';
import { inicioAtribuicaoAberta } from '@/lib/sku-ads';
import { cn } from '@/lib/utils';
import {
  compararIndicadorAds, indicadoresAds,
  type SentidoAds, type UnidadeAds,
} from '@/lib/ads-metricas';
import type { CampanhaVista } from '@/lib/ads-campanhas';
import type {
  AnuncioPeriodoAds, MotivoMetricaAds, PedidoAdsMetricas, ValorAds,
} from '../../../../supabase/functions/_shared/ads/metricas';
import { BlocoCampanha } from './bloco-campanha';
import type { AcoesFamilia } from './familia-campanha';
import { fmtPontos, rotuloEstrategia } from './formato-campanha';

// Detalhe de uma campanha (plano ads-redesign §3.5/4.4/4.5, seção 9 item 1). Sheet à direita no desktop e tela
// cheia no mobile. As métricas são do PERÍODO (ML); estado, orçamento e produtos são o ESTADO ATUAL: nunca misturar.

export type PedidoBaseDetalhe = Pick<PedidoAdsMetricas, 'desde' | 'ate' | 'comparar'>;

interface Props {
  campanhaId: number;
  nome: string;
  pedido: PedidoBaseDetalhe;
  /** Configuração atual vinda de ads-campanhas; null = a campanha não está mais entre as ativas/pausadas. */
  campanha: CampanhaVista | null;
  aberto: boolean;
  onFechar: () => void;
  /** Seção Competitividade (Task 32). */
  competitividade?: ReactNode;
  /** "Ver desempenho" das famílias atuais: abre a análise global da família no mesmo período (plano §3.5). */
  acoes?: AcoesFamilia;
  /** Leitura da configuração atual: só 'lida' permite dizer que a campanha saiu das ativas/pausadas. */
  configuracao?: 'lida' | 'carregando' | 'erro';
}

type Direcao = 'asc' | 'desc';
interface Def { chave: string; rotulo: string; unidade: UnidadeAds; sentido: SentidoAds; formato: (n: number) => string }

const num = (n: number, casas: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const moeda = (n: number) => `R$ ${num(n, 2)}`;
const inteiro = (n: number) => num(n, 0);
const pct = (n: number) => `${num(n * 100, 1)}%`;

const COLUNAS: Def[] = [
  { chave: 'investimento', rotulo: 'Investimento', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'impressoes', rotulo: 'Impressões', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'cliques', rotulo: 'Cliques', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'cpc', rotulo: 'CPC', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'vendas', rotulo: 'Vendas atribuídas', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
  { chave: 'receita', rotulo: 'Receita', unidade: 'moeda', sentido: 'neutro', formato: moeda },
  { chave: 'acos', rotulo: 'ACOS', unidade: 'percentual', sentido: 'menor_melhor', formato: pct },
];

const MOTIVOS: Record<MotivoMetricaAds, string> = {
  nao_retornada: 'O ML não retornou esta métrica.',
  fora_da_retencao: 'Período fora da retenção do ML.',
  sem_denominador: 'Sem denominador no período.',
  resposta_invalida: 'Resposta inválida do ML.',
  sem_permissao: 'Sem permissão para ler esta métrica.',
  limite_de_leitura: 'Limite de leitura atingido.',
  sem_historico: 'O histórico de vendas no PubliAI não cobre todo o período (ou ainda não foi carregado).',
};
const SEM_VALOR: ValorAds = { valor: null, motivo: 'nao_retornada' };

const CELULA = 'px-3 py-3 align-top whitespace-normal';
const NUM = `${CELULA} text-right tabular-nums`;

type Indicadores = Record<string, ValorAds>;
interface Linha { a: AnuncioPeriodoAds; atual: Indicadores; anterior: Indicadores | null }

function Delta({ texto, direcao, tom }: { texto: string; direcao: 'up' | 'down' | 'neutral'; tom: 'success' | 'danger' | 'neutral' }) {
  const Seta = direcao === 'up' ? ArrowUp : direcao === 'down' ? ArrowDown : null;
  return (
    <span data-delta data-direcao={direcao} data-tom={tom}
      className={cn('inline-flex items-center gap-0.5 text-xs font-medium',
        tom === 'success' ? 'text-success' : tom === 'danger' ? 'text-destructive' : 'text-muted-foreground')}>
      {Seta && <Seta className="h-3 w-3" aria-hidden />}
      {texto}
    </span>
  );
}

function Valor({ def, linha, comparar, provisoria }: { def: Def; linha: Linha; comparar: boolean; provisoria: boolean }) {
  const valor = linha.atual[def.chave] ?? SEM_VALOR;
  if (valor.valor === null) {
    return (
      <div className="space-y-0.5">
        <span className="block text-muted-foreground">—</span>
        <span className="block text-xs font-normal leading-snug text-muted-foreground">{MOTIVOS[valor.motivo ?? 'nao_retornada']}</span>
      </div>
    );
  }
  const ant = comparar && linha.anterior ? linha.anterior[def.chave] ?? SEM_VALOR : null;
  // Anterior sem valor: o motivo específico, não um genérico "Sem comparação".
  const cmp = ant && ant.valor !== null ? compararIndicadorAds(valor, ant, def.unidade, provisoria, def.sentido) : null;
  return (
    <div className="space-y-0.5">
      <span className="block font-medium">{def.formato(valor.valor)}</span>
      {ant && ant.valor === null && (
        <span className="block text-xs font-normal leading-snug text-muted-foreground">
          Variação indisponível: {MOTIVOS[ant.motivo ?? 'nao_retornada']}
        </span>
      )}
      {cmp && (
        <span className="flex flex-wrap items-center justify-end gap-x-1.5">
          <Delta {...cmp} />
          {provisoria && cmp.texto !== 'Sem comparação' && (
            <span className="rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">Provisória</span>
          )}
        </span>
      )}
    </div>
  );
}

function Identificacao({ l, comparar, motivo }: { l: Linha; comparar: boolean; motivo: MotivoMetricaAds | null }) {
  const { itemId, titulo } = l.a;
  return (
    <div className="min-w-0 space-y-0.5">
      <span className="line-clamp-2 break-words font-medium" title={titulo ?? itemId}>{titulo ?? itemId}</span>
      {titulo && <span className="block text-xs text-muted-foreground tabular-nums">{itemId}</span>}
      {comparar && !l.anterior && (
        <span className="block text-xs text-muted-foreground">
          Variação indisponível: {motivo ? MOTIVOS[motivo] : 'Sem dados no período anterior.'}
        </span>
      )}
    </div>
  );
}

function Cabecalho({ rotulo, coluna, ordem, onOrdenar, className, direita }: {
  rotulo: string; coluna: string; ordem: { coluna: string; direcao: Direcao };
  onOrdenar: (c: string) => void; className?: string; direita?: boolean;
}) {
  const ativa = ordem.coluna === coluna;
  const Icone = !ativa ? ChevronsUpDown : ordem.direcao === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead scope="col" className={cn('px-3 align-bottom whitespace-normal', direita && 'text-right', className)}
      aria-sort={ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onOrdenar(coluna)}
        className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          ativa && 'text-foreground')}>
        {rotulo}
        <Icone aria-hidden className={cn('h-3 w-3 shrink-0', ativa ? 'opacity-100' : 'opacity-50')} />
      </button>
    </TableHead>
  );
}

/** Ordenação estável; métrica indisponível (null) vai sempre para o fim, em qualquer direção. */
function ordenar(linhas: Linha[], coluna: string, direcao: Direcao): Linha[] {
  const f = direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((x, y) => {
    if (coluna === 'anuncio') return f * (x.a.titulo ?? x.a.itemId).localeCompare(y.a.titulo ?? y.a.itemId, 'pt-BR');
    const vx = x.atual[coluna]?.valor ?? null;
    const vy = y.atual[coluna]?.valor ?? null;
    if (vx === null || vy === null) return vx === vy ? 0 : vx === null ? 1 : -1;
    return f * (vx - vy);
  });
}

function AnunciosPatrocinados({ anuncios, motivo, comparacaoEstado }: {
  anuncios: AnuncioPeriodoAds[] | null | undefined;
  motivo: MotivoMetricaAds | null | undefined;
  comparacaoEstado: 'disponivel' | 'provisoria' | 'indisponivel' | 'desligada';
}) {
  const [ordem, setOrdem] = useState<{ coluna: string; direcao: Direcao }>({ coluna: 'investimento', direcao: 'desc' });
  const provisoria = comparacaoEstado === 'provisoria';
  const comparar = comparacaoEstado === 'disponivel' || provisoria;

  const linhas = useMemo<Linha[]>(() => (anuncios ?? []).map(a => ({
    a,
    atual: indicadoresAds(a.atual.resumo, null),
    anterior: a.anterior ? indicadoresAds(a.anterior.resumo, null) : null,
  })), [anuncios]);
  const visiveis = ordenar(linhas, ordem.coluna, ordem.direcao);

  const ordenarPor = (coluna: string) => setOrdem(o => o.coluna === coluna
    ? { coluna, direcao: o.direcao === 'asc' ? 'desc' : 'asc' }
    : { coluna, direcao: coluna === 'anuncio' ? 'asc' : 'desc' });

  if (!anuncios) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Lista de anúncios indisponível: {motivo ? MOTIVOS[motivo] : 'o ML não devolveu as métricas por anúncio.'}
      </p>
    );
  }
  if (anuncios.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum anúncio patrocinado com dados no período.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="hidden rounded-lg border border-border lg:block">
        <Table aria-label="Anúncios patrocinados no período" className="table-fixed">
          <TableHeader>
            <TableRow>
              <Cabecalho rotulo="Anúncio" coluna="anuncio" ordem={ordem} onOrdenar={ordenarPor} className="w-[24%]" />
              {COLUNAS.map(d => (
                <Cabecalho key={d.chave} rotulo={d.rotulo} coluna={d.chave} ordem={ordem} onOrdenar={ordenarPor} className="w-[11%]" direita />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map(l => (
              <TableRow key={l.a.itemId}>
                <TableCell className={CELULA}><Identificacao l={l} comparar={comparar} motivo={motivo ?? null} /></TableCell>
                {COLUNAS.map(d => (
                  <TableCell key={d.chave} className={NUM}>
                    <Valor def={d} linha={l} comparar={comparar} provisoria={provisoria} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 lg:hidden">
        <div className="flex gap-2">
          <Select value={ordem.coluna} onValueChange={c => setOrdem(o => ({ coluna: c, direcao: c === o.coluna ? o.direcao : c === 'anuncio' ? 'asc' : 'desc' }))}>
            <SelectTrigger aria-label="Ordenar anúncios por" className="h-8 flex-1 data-[size=default]:max-sm:h-11 data-[size=default]:pointer-coarse:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anuncio">Anúncio</SelectItem>
              {COLUNAS.map(d => <SelectItem key={d.chave} value={d.chave}>{d.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="h-8 shrink-0 max-sm:h-11 pointer-coarse:h-11"
            aria-label={ordem.direcao === 'desc' ? 'Ordem decrescente: alternar para crescente' : 'Ordem crescente: alternar para decrescente'}
            onClick={() => setOrdem(o => ({ ...o, direcao: o.direcao === 'asc' ? 'desc' : 'asc' }))}>
            {ordem.direcao === 'desc' ? <ArrowDown aria-hidden className="h-4 w-4" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
            {ordem.direcao === 'desc' ? 'Decrescente' : 'Crescente'}
          </Button>
        </div>
        <ul aria-label="Anúncios patrocinados em cartões" className="grid gap-3 sm:grid-cols-2">
          {visiveis.map(l => (
            <li key={l.a.itemId} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
              <Identificacao l={l} comparar={comparar} motivo={motivo ?? null} />
              <dl className="space-y-2 text-sm">
                {COLUNAS.map(d => (
                  <div key={d.chave} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{d.rotulo}</dt>
                    <dd className="text-right tabular-nums"><Valor def={d} linha={l} comparar={comparar} provisoria={provisoria} /></dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-h3">{titulo}</h3>
      {children}
    </section>
  );
}

function Configuracao({ c }: { c: CampanhaVista }) {
  const ativa = c.status === 'active';
  const estrategia = rotuloEstrategia(c.estrategia);
  const itens: [string, ReactNode][] = [
    ['Estado', <StatusPill key="e" tone={ativa ? 'success' : 'neutral'}>{ativa ? 'Ativa' : 'Pausada'}</StatusPill>],
    ['Estratégia', estrategia ?? '—'],
    ['Orçamento diário', c.orcamentoDiario != null ? fmtBRL(c.orcamentoDiario) : '—'],
    ['ROAS objetivo', c.roasObjetivo != null ? `${Number(c.roasObjetivo.toFixed(1)).toLocaleString('pt-BR')}x` : '—'],
  ];
  if (c.acosObjetivo != null) itens.push(['ACOS-alvo', fmtPontos(c.acosObjetivo)]);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
      {itens.map(([k, v]) => (
        <div key={k} className="space-y-1">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetalheCampanha({ campanhaId, nome, pedido, campanha, aberto, onFechar, competitividade, acoes, configuracao = 'lida' }: Props) {
  const consulta = useMemo<PedidoAdsMetricas>(
    () => ({ desde: pedido.desde, ate: pedido.ate, comparar: pedido.comparar, escopo: 'campanha', campanhaId }),
    [pedido.desde, pedido.ate, pedido.comparar, campanhaId],
  );
  const { data, isLoading, isError, refetch } = useAdsMetricas(consulta, aberto);
  const atual = useMemo(() => (data?.atual ? indicadoresAds(data.atual.resumo, null) : null), [data]);
  const anterior = useMemo(() => (data?.anterior ? indicadoresAds(data.anterior.resumo, null) : null), [data]);

  let metricas: ReactNode;
  if (isError) {
    metricas = (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <p>Não foi possível ler as métricas da campanha no Mercado Livre.</p>
        <Button variant="outline" size="sm" className="mt-3 h-8 max-sm:h-11 pointer-coarse:h-11" onClick={() => void refetch()}>Tentar de novo</Button>
      </div>
    );
  } else if (isLoading || !data) {
    metricas = (
      <div role="status" aria-label="Carregando métricas da campanha" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        Lendo as métricas no Mercado Livre…
      </div>
    );
  } else if (!atual || !data.atual || (data.estado !== 'ok' && data.estado !== 'parcial')) {
    metricas = <Aviso texto={AVISO[data.estado] ?? 'Não foi possível ler as métricas deste período.'} />;
  } else {
    metricas = (
      <div className="space-y-4">
        {data.comparacao.estado === 'indisponivel' && (
          <p className="text-sm text-muted-foreground">Comparação indisponível{data.comparacao.motivo ? `: ${data.comparacao.motivo}` : '.'}</p>
        )}
        <FaixaKpis atual={atual} anterior={anterior} comparacao={data.comparacao.estado} ocultar={['tacos']} />
        <SerieDiaria serie={data.atual.serie} janela={data.atual.janela} completo={data.atual.completo}
          provisorioDesde={inicioAtribuicaoAberta(data.atual.janela, data.atual.lidoEm)} />
      </div>
    );
  }

  const comparacaoEstado = data?.comparacao.estado ?? 'desligada';

  return (
    <Sheet open={aberto} onOpenChange={o => { if (!o) onFechar(); }}>
      <SheetContent showCloseButton={false} className={`w-full gap-0 overflow-y-auto sm:max-w-4xl ${TELA_ADS}`}>
        {/* Fechar próprio: o do Sheet global tem 28 px; aqui chega a 44 px em toque. */}
        <SheetClose asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10 max-sm:size-11 pointer-coarse:size-11">
            <X aria-hidden />
            <span className="sr-only">Close</span>
          </Button>
        </SheetClose>
        <SheetHeader className="border-b border-border pr-14">
          <SheetTitle className="break-words text-h3">{nome}</SheetTitle>
          <SheetDescription>
            {pedido.desde.split('-').reverse().join('/')} a {pedido.ate.split('-').reverse().join('/')}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-8 p-4">
          <Secao titulo="Métricas do período">{metricas}</Secao>
          {competitividade && <Secao titulo="Competitividade">{competitividade}</Secao>}
          {aberto && data && (
            <Secao titulo="Anúncios patrocinados">
              <AnunciosPatrocinados anuncios={data.anuncios} motivo={data.anunciosMotivo} comparacaoEstado={comparacaoEstado} />
            </Secao>
          )}
          <Secao titulo="Configuração atual">
            {campanha ? <Configuracao c={campanha} /> : configuracao === 'carregando' ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                Lendo a configuração atual…
              </p>
            ) : configuracao === 'erro' ? (
              <p className="text-sm text-muted-foreground">
                Configuração atual indisponível agora; as métricas do período continuam valendo.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Esta campanha não está mais entre as campanhas ativas ou pausadas no Mercado Livre. As métricas do período
                continuam valendo; estado, orçamento e produtos atuais não estão disponíveis.
              </p>
            )}
          </Secao>
          {campanha && (
            <Secao titulo="Produtos patrocinados atualmente">
              <p className="text-sm text-muted-foreground">
                Produtos patrocinados atualmente. A composição pode ter mudado durante o período.
              </p>
              <BlocoCampanha c={campanha} filtrando={false} {...acoes} />
            </Secao>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
