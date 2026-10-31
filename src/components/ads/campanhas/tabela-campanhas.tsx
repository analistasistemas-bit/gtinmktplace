import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import {
  compararIndicadorAds, indicadoresAds,
  type SentidoAds, type UnidadeAds,
} from '@/lib/ads-metricas';
import { DeltaAds } from '@/components/ads/delta-ads';
import {
  MOTIVOS_METRICA_ADS as MOTIVOS, SEM_VALOR_ADS as SEM_VALOR, inteiroAds as inteiro, moedaAds as moeda, pctAds as pct, razaoAds as razao,
} from '@/lib/ads-metricas';
import type { CampanhaPeriodoAds, RespostaAdsMetricas, ValorAds } from '../../../../supabase/functions/_shared/ads/metricas';

// Tabela de campanhas por período (plano ads-redesign §3.4/4.4/4.5). Mostra só as linhas recebidas: filtro, busca
// e ordem NUNCA recalculam nem exibem totais da conta (o resumo da conta vem da faixa de KPIs, sobre a conta toda).

type Visao = 'resultado' | 'eficiencia';
type Direcao = 'asc' | 'desc';
type Coluna = 'nome' | string;

interface Def {
  chave: string;
  rotulo: string;
  unidade: UnidadeAds;
  sentido: SentidoAds;
  formato: (n: number) => string;
}

const INVESTIMENTO: Def = { chave: 'investimento', rotulo: 'Investimento', unidade: 'moeda', sentido: 'neutro', formato: moeda };
const COLUNAS: Record<Visao, Def[]> = {
  resultado: [
    INVESTIMENTO,
    { chave: 'vendas', rotulo: 'Vendas Ads', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
    { chave: 'receita', rotulo: 'Receita Ads', unidade: 'moeda', sentido: 'neutro', formato: moeda },
    { chave: 'roas', rotulo: 'ROAS', unidade: 'razao', sentido: 'maior_melhor', formato: razao },
    { chave: 'acos', rotulo: 'ACOS', unidade: 'percentual', sentido: 'menor_melhor', formato: pct },
  ],
  eficiencia: [
    { chave: 'impressoes', rotulo: 'Impressões', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
    { chave: 'cliques', rotulo: 'Cliques', unidade: 'quantidade', sentido: 'neutro', formato: inteiro },
    { chave: 'ctr', rotulo: 'CTR', unidade: 'percentual', sentido: 'maior_melhor', formato: pct },
    { chave: 'cpc', rotulo: 'CPC', unidade: 'moeda', sentido: 'neutro', formato: moeda },
    { chave: 'conversao', rotulo: 'Conversão', unidade: 'percentual', sentido: 'maior_melhor', formato: pct },
  ],
};
const VISOES: { chave: Visao; rotulo: string }[] = [
  { chave: 'resultado', rotulo: 'Resultado' },
  { chave: 'eficiencia', rotulo: 'Eficiência' },
];


const STATUS: Record<string, { txt: string; tom: StatusTone }> = {
  active: { txt: 'Ativa', tom: 'success' },
  paused: { txt: 'Pausada', tom: 'warning' },
  deleted: { txt: 'Removida', tom: 'neutral' },
  error: { txt: 'Com erro', tom: 'danger' },
};
const statusDe = (s: string) => STATUS[s] ?? { txt: s, tom: 'neutral' as StatusTone };

const CELULA = 'px-3 py-3 align-top whitespace-normal';
const NUM = `${CELULA} text-right tabular-nums`;

type Indicadores = Record<string, ValorAds>;
interface Linha { c: CampanhaPeriodoAds; atual: Indicadores; anterior: Indicadores | null }

/** Valor da métrica + variação vs período comparado; indisponível mostra travessão e o motivo (nunca zero). */
function Celula({ def, linha, comparar, provisoria }: { def: Def; linha: Linha; comparar: boolean; provisoria: boolean }) {
  const valor = linha.atual[def.chave] ?? SEM_VALOR;
  if (valor.valor === null) {
    return (
      <div className="space-y-0.5">
        <span className="block text-muted-foreground">—</span>
        <span className="block text-xs font-normal leading-snug text-muted-foreground">{MOTIVOS[valor.motivo ?? 'nao_retornada']}</span>
      </div>
    );
  }
  const cmp = comparar && linha.anterior
    ? compararIndicadorAds(valor, linha.anterior[def.chave] ?? SEM_VALOR, def.unidade, provisoria, def.sentido)
    : null;
  return (
    <div className="space-y-0.5">
      <span className="block font-medium">{def.formato(valor.valor)}</span>
      {cmp && (
        <span className="flex flex-wrap items-center justify-end gap-x-1.5">
          <DeltaAds {...cmp} />
          {provisoria && cmp.texto !== 'Sem comparação' && (
            <span className="rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">Provisória</span>
          )}
        </span>
      )}
    </div>
  );
}

function Nome({ c }: { c: CampanhaPeriodoAds }) {
  const s = statusDe(c.statusAtual);
  return (
    <div className="min-w-0 space-y-1">
      <span className="line-clamp-2 break-words font-medium" title={c.nome}>{c.nome}</span>
      <StatusPill tone={s.tom}>{s.txt}</StatusPill>
    </div>
  );
}

function BotaoVer({ c, onAbrir, compacto }: { c: CampanhaPeriodoAds; onAbrir: (id: number) => void; compacto?: boolean }) {
  return (
    <Button type="button" variant={compacto ? 'ghost' : 'outline'} size="sm" className="h-8 max-sm:h-11 pointer-coarse:h-11"
      aria-label={`Ver campanha ${c.nome}`} onClick={() => onAbrir(c.id)}>
      {compacto ? null : 'Ver campanha'}
      <ChevronRight aria-hidden className="h-4 w-4" />
    </Button>
  );
}

function Cabecalho({ rotulo, coluna, ordem, onOrdenar, className, direita }: {
  rotulo: string; coluna: Coluna; ordem: { coluna: Coluna; direcao: Direcao };
  onOrdenar: (c: Coluna) => void; className?: string; direita?: boolean;
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
function ordenar(linhas: Linha[], coluna: Coluna, direcao: Direcao): Linha[] {
  const f = direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((a, b) => {
    if (coluna === 'nome') return f * a.c.nome.localeCompare(b.c.nome, 'pt-BR');
    const va = a.atual[coluna]?.valor ?? null;
    const vb = b.atual[coluna]?.valor ?? null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return f * (va - vb);
  });
}

export function TabelaCampanhas({ campanhas, comparacao, onAbrir }: {
  campanhas: CampanhaPeriodoAds[];
  comparacao: RespostaAdsMetricas['comparacao'];
  onAbrir: (campanhaId: number) => void;
}) {
  const [visao, setVisao] = useState<Visao>('resultado');
  const [status, setStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<{ coluna: Coluna; direcao: Direcao }>({ coluna: 'investimento', direcao: 'desc' });

  const provisoria = comparacao.estado === 'provisoria';
  const comparar = comparacao.estado === 'disponivel' || provisoria;
  const colunas = COLUNAS[visao];

  const linhas = useMemo<Linha[]>(() => campanhas.map(c => ({
    c,
    atual: indicadoresAds(c.atual.resumo, null),
    anterior: c.anterior ? indicadoresAds(c.anterior.resumo, null) : null,
  })), [campanhas]);
  const statusPresentes = useMemo(() => [...new Set(campanhas.map(c => c.statusAtual))], [campanhas]);

  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const visiveis = ordenar(
    linhas.filter(l => (status === 'todos' || l.c.statusAtual === status)
      && (!termo || l.c.nome.toLocaleLowerCase('pt-BR').includes(termo) || String(l.c.id).includes(termo))),
    ordem.coluna, ordem.direcao);

  const trocarVisao = (v: Visao) => {
    setVisao(v);
    // A ordem que não existe na nova visão volta ao primeiro indicador dela.
    setOrdem(o => o.coluna === 'nome' || COLUNAS[v].some(d => d.chave === o.coluna) ? o : { coluna: COLUNAS[v][0].chave, direcao: 'desc' });
  };
  const ordenarPor = (coluna: Coluna) => setOrdem(o => o.coluna === coluna
    ? { coluna, direcao: o.direcao === 'asc' ? 'desc' : 'asc' }
    : { coluna, direcao: coluna === 'nome' ? 'asc' : 'desc' });

  const controles = (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-72">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou código"
          aria-label="Buscar campanha por nome ou código" className="h-8 pl-8 text-sm max-sm:h-11 max-sm:text-base pointer-coarse:h-11" />
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger aria-label="Status" className="h-8 w-full data-[size=default]:max-sm:h-11 data-[size=default]:pointer-coarse:h-11 sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos os status</SelectItem>
          {statusPresentes.map(s => <SelectItem key={s} value={s}>{statusDe(s).txt}</SelectItem>)}
        </SelectContent>
      </Select>
      <div role="group" aria-label="Visão" className="inline-flex rounded-md border border-border p-0.5 sm:ml-auto">
        {VISOES.map(v => (
          <button key={v.chave} type="button" aria-pressed={visao === v.chave} onClick={() => trocarVisao(v.chave)}
            className={cn('h-7 flex-1 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-11 pointer-coarse:h-11 sm:flex-none',
              visao === v.chave ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {v.rotulo}
          </button>
        ))}
      </div>
    </div>
  );

  const corpo = campanhas.length === 0 ? (
    <p className="text-sm text-muted-foreground">Nenhuma campanha com dados de Ads no período.</p>
  ) : visiveis.length === 0 ? (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p>Nenhuma campanha encontrada com esta busca e status.</p>
      <Button type="button" variant="outline" size="sm" className="h-8 max-sm:h-11 pointer-coarse:h-11" onClick={() => { setStatus('todos'); setBusca(''); }}>Ver todas</Button>
    </div>
  ) : (
    <>
      <div className="hidden rounded-lg border border-border xl:block">
        <Table aria-label="Campanhas no período" className="table-fixed">
          <TableHeader>
            <TableRow>
              <Cabecalho rotulo="Campanha" coluna="nome" ordem={ordem} onOrdenar={ordenarPor} className="w-[29%]" />
              {colunas.map(d => (
                <Cabecalho key={d.chave} rotulo={d.rotulo} coluna={d.chave} ordem={ordem} onOrdenar={ordenarPor} className="w-[13%]" direita />
              ))}
              <TableHead scope="col" className="w-[6%] px-3 text-right align-bottom"><span className="sr-only">Abrir</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map(l => (
              <TableRow key={l.c.id}>
                <TableCell className={CELULA}><Nome c={l.c} /></TableCell>
                {colunas.map(d => (
                  <TableCell key={d.chave} className={NUM}>
                    <Celula def={d} linha={l} comparar={comparar} provisoria={provisoria} />
                  </TableCell>
                ))}
                <TableCell className={`${CELULA} text-right`}><BotaoVer c={l.c} onAbrir={onAbrir} compacto /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Campanhas no período em cartões" className="grid gap-3 md:grid-cols-2 xl:hidden">
        {visiveis.map(l => (
          <li key={l.c.id} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
            <Nome c={l.c} />
            <dl className="space-y-2 text-sm">
              {colunas.map(d => (
                <div key={d.chave} className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">{d.rotulo}</dt>
                  <dd className="text-right tabular-nums"><Celula def={d} linha={l} comparar={comparar} provisoria={provisoria} /></dd>
                </div>
              ))}
            </dl>
            <BotaoVer c={l.c} onAbrir={onAbrir} />
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div role="region" aria-label="Campanhas" className="space-y-3">
      {controles}
      {comparacao.estado === 'indisponivel' && (
        <p className="text-sm text-muted-foreground">Comparação indisponível{comparacao.motivo ? `: ${comparacao.motivo}` : '.'}</p>
      )}
      {corpo}
    </div>
  );
}
