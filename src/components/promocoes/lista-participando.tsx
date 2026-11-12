// ADR-0174, emenda 2026-10-05 — aba "Em promoção": tudo que participa, por campanha; DEAL/SMART saem pelo motor.
import { ehTipoOperavel } from '@/lib/operacoes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, ExternalLink, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { usePaginacao } from '@/hooks/usePaginacao';
import { filtrarPorBusca } from '@/lib/promocao-simulacao';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { useParticipacoes, usePromocoes } from '@/hooks/usePromocoes';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';
import {
  URL_PROMOCOES_ML, agruparParticipacoes, aguardandoMl, descontoPct, mlbExibido, rotuloMlb, rotuloTipo, type GrupoParticipacao, type Participacao, type Promocao,
} from '@/lib/promocoes';
import { SEMAFORO_UI } from './contagem-semaforo';
import { PreviewOperacao } from './preview-operacao';

export function ListaParticipando() {
  const promocoes = usePromocoes();
  const participacoes = useParticipacoes();
  const [busca, setBusca] = useState('');
  const grupos = useMemo(
    () => agruparParticipacoes(participacoes.data ?? [], promocoes.data ?? [], Date.now()),
    [participacoes.data, promocoes.data],
  );
  // Busca (título/MLB/SKU) em todas as campanhas: bloco sem resultado some. Achado Codex P2: a seleção mora aqui (por
  // campanha) — buscar não apaga marcações e as ações valem para tudo que está marcado na campanha.
  const [selecao, setSelecao] = useState<Record<string, Set<string>>>({});
  const visiveis = useMemo(
    () => grupos.map((g) => ({ grupo: g, itens: filtrarPorBusca(g.itens, busca) as Participacao[] })).filter((x) => x.itens.length > 0),
    [grupos, busca],
  );

  if (promocoes.isLoading || participacoes.isLoading) {
    return <CarregandoMarca className="mt-4" rotulo="Carregando" mensagem="Lendo os anúncios em promoção…" />;
  }
  if (promocoes.isError || participacoes.isError) {
    return <EmptyState icon={BadgePercent} title="Não foi possível carregar os anúncios em promoção." description="Tente atualizar a página." className="mt-4" />;
  }
  if (grupos.length === 0) return <EmptyState icon={BadgePercent} title="Nenhum anúncio em promoção." className="mt-4" />;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto, MLB ou SKU"
          aria-label="Buscar anúncios em promoção" className="pl-9 pr-9" />
        {busca && (
          <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
            className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {visiveis.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum anúncio em promoção com essa busca.</p>
        : visiveis.map(({ grupo: g, itens }) => (
          <BlocoCampanha key={g.promocao.promocao_id} grupo={g} visiveis={itens} busca={busca}
            selecionados={selecao[g.promocao.promocao_id] ?? VAZIO}
            onSelecao={(s) => setSelecao((prev) => ({ ...prev, [g.promocao.promocao_id]: s }))} />
        ))}
    </div>
  );
}

const VAZIO: Set<string> = new Set();
const TAMANHOS = [20, 50, 100];

function BlocoCampanha({ grupo, visiveis, busca, selecionados, onSelecao }: {
  grupo: GrupoParticipacao; visiveis: Participacao[]; busca: string; selecionados: Set<string>; onSelecao: (s: Set<string>) => void;
}) {
  const { promocao: p, itens, operavel } = grupo;
  const [preview, setPreview] = useState<{ acao: 'sair' | 'alterar_preco'; itens: Participacao[] } | null>(null);
  // Alterar o preço da oferta só existe em campanha tradicional (PUT do deal_price — spike 03/11).
  const podeAlterar = operavel && p.tipo === 'DEAL';
  const nome = p.nome ?? rotuloTipo(p.tipo);
  const tituloId = `campanha-${p.promocao_id}`;
  // Ações: tudo que está marcado na campanha (inclusive fora da busca atual); "Selecionar todos": só os visíveis.
  const marcados = itens.filter((i) => selecionados.has(i.ml_item_id));
  const todos = visiveis.length > 0 && visiveis.every((i) => selecionados.has(i.ml_item_id));
  const setSelecionados = (f: (prev: Set<string>) => Set<string>) => onSelecao(f(selecionados));
  // Paginação só da exibição (03/11): seleção e "Selecionar todos" continuam valendo para todas as páginas.
  const pag = usePaginacao(visiveis, { tamanhoInicial: 20 });
  const { reset } = pag;
  useEffect(() => reset(), [busca, reset]);
  const topo = useRef<HTMLElement>(null);
  const irPara = (n: number) => {
    pag.irPara(n);
    topo.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const alternar = (id: string) => setSelecionados((prev) => {
    const novo = new Set(prev);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });
  const alternarVisiveis = (marcar: boolean) => setSelecionados((prev) => {
    const novo = new Set(prev);
    for (const i of visiveis) { if (marcar) novo.add(i.ml_item_id); else novo.delete(i.ml_item_id); }
    return novo;
  });

  return (
    <section ref={topo} aria-labelledby={tituloId} className="scroll-mt-6 rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-3">
          {operavel && (
            <Checkbox aria-label={`Selecionar todos de ${nome}`} checked={todos}
              onCheckedChange={(v) => alternarVisiveis(!!v)} />
          )}
          <div className="min-w-0">
            <h3 id={tituloId} className="truncate font-semibold">
              <Link to={`/promocoes/${encodeURIComponent(p.promocao_id)}`} className="hover:underline">{nome}</Link>
            </h3>
            <p className="text-xs text-muted-foreground">
              {rotuloTipo(p.tipo)} · {itens.length} anúncio{itens.length > 1 ? 's' : ''}
              {p.fim ? ` · até ${new Date(p.fim).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
            </p>
          </div>
        </div>
        {operavel ? (
          marcados.length > 0 && (
            <div className="flex items-center gap-2">
              {podeAlterar && (
                <Button size="sm" onClick={() => setPreview({ acao: 'alterar_preco', itens: marcados })}>Alterar preço {marcados.length}</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setPreview({ acao: 'sair', itens: marcados })}>Sair {marcados.length}</Button>
            </div>
          )
        ) : (
          <Button asChild size="sm" variant="ghost">
            <a href={URL_PROMOCOES_ML} target="_blank" rel="noreferrer">Gerenciar no Mercado Livre <ExternalLink className="size-4" aria-hidden /></a>
          </Button>
        )}
      </header>
      <ul className="divide-y">
        {pag.itensPagina.map((r) => <LinhaParticipacao key={r.ml_item_id} r={r} campanha={p} operavel={operavel} marcado={selecionados.has(r.ml_item_id)} onToggle={alternar} />)}
      </ul>
      {pag.total > TAMANHOS[0] && (
        <Pagination className="border-t px-4" rotuloItem="anúncio" tamanhos={TAMANHOS} paginaAtual={pag.paginaAtual}
          totalPaginas={pag.totalPaginas} inicio={pag.inicio} fim={pag.fim} total={pag.total} tamanho={pag.tamanho}
          onIrPara={irPara} onTamanho={pag.setTamanho} />
      )}
      {operavel && (
        <PreviewOperacao
          acao={preview?.acao ?? 'sair'} tipo={ehTipoOperavel(p.tipo) ? p.tipo : 'DEAL'} promocaoId={p.promocao_id} promocaoNome={nome}
          itens={preview?.itens ?? []} aberto={preview != null} onClose={() => setPreview(null)} onSucesso={() => onSelecao(new Set())}
        />
      )}
    </section>
  );
}

function LinhaParticipacao({ r, campanha, operavel, marcado, onToggle }: {
  r: Participacao; campanha: Pick<Promocao, 'status' | 'tipo'>; operavel: boolean; marcado: boolean; onToggle: (id: string) => void;
}) {
  const ui = SEMAFORO_UI[r.pior_semaforo];
  const d = descontoPct(r.preco_original, r.preco_avaliado);
  const mlb = mlbExibido(r);
  return (
    <li className="flex items-center gap-3 p-3 sm:px-4">
      {operavel && <Checkbox aria-label={`Selecionar ${mlb}`} checked={marcado} onCheckedChange={() => onToggle(r.ml_item_id)} />}
      {r.thumbnail && <img src={r.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />}
      <div className={cn('min-w-0 flex-1', r.pior_semaforo === 'indisponivel' && 'text-muted-foreground')}>
        <p className="truncate text-sm" title={formatarNomeProduto(r.titulo) || r.ml_item_id}>{formatarNomeProduto(r.titulo) || r.ml_item_id}</p>
        <p className="truncate text-xs text-muted-foreground">{rotuloMlb(r)}{r.status !== 'pending' ? '' : aguardandoMl(r, campanha) ? ' · aguardando o ML' : ' · começa depois'}</p>
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums leading-tight">
        <span className="block font-medium">{r.preco_avaliado != null ? fmtBRL(r.preco_avaliado) : '—'}</span>
        {r.preco_original != null && (
          <span className="block text-xs text-muted-foreground"><s>{fmtBRL(r.preco_original)}</s>{d != null && ` · −${d}%`}</span>
        )}
      </div>
      <span title={ui.label} className="inline-flex shrink-0">
        <ui.Icon className={cn('size-4', ui.text)} aria-hidden />
        <span className="sr-only">{ui.label}</span>
      </span>
    </li>
  );
}
