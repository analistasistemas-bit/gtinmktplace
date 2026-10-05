// ADR-0174, emenda 2026-10-05 — aba "Em promoção": tudo que participa, por campanha; DEAL/SMART saem pelo motor.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useParticipacoes, usePromocoes } from '@/hooks/usePromocoes';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';
import {
  URL_PROMOCOES_ML, agruparParticipacoes, descontoPct, rotuloMlb, rotuloTipo, type GrupoParticipacao, type Participacao,
} from '@/lib/promocoes';
import { SEMAFORO_UI } from './contagem-semaforo';
import { PreviewOperacao } from './preview-operacao';

export function ListaParticipando() {
  const promocoes = usePromocoes();
  const participacoes = useParticipacoes();
  const grupos = useMemo(
    () => agruparParticipacoes(participacoes.data ?? [], promocoes.data ?? [], Date.now()),
    [participacoes.data, promocoes.data],
  );

  if (promocoes.isLoading || participacoes.isLoading) {
    return <div className="mt-4 flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;
  }
  if (grupos.length === 0) return <EmptyState icon={BadgePercent} title="Nenhum anúncio em promoção." className="mt-4" />;
  return <div className="mt-4 flex flex-col gap-4">{grupos.map((g) => <BlocoCampanha key={g.promocao.promocao_id} grupo={g} />)}</div>;
}

function BlocoCampanha({ grupo }: { grupo: GrupoParticipacao }) {
  const { promocao: p, itens, operavel } = grupo;
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [saindo, setSaindo] = useState<Participacao[] | null>(null);
  const nome = p.nome ?? rotuloTipo(p.tipo);
  const tituloId = `campanha-${p.promocao_id}`;
  const marcados = itens.filter((i) => selecionados.has(i.ml_item_id));
  const todos = itens.length > 0 && marcados.length === itens.length;

  const alternar = (id: string) => setSelecionados((prev) => {
    const novo = new Set(prev);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  return (
    <section aria-labelledby={tituloId} className="rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-3">
          {operavel && (
            <Checkbox aria-label={`Selecionar todos de ${nome}`} checked={todos}
              onCheckedChange={(v) => setSelecionados(v ? new Set(itens.map((i) => i.ml_item_id)) : new Set())} />
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
          marcados.length > 0 && <Button size="sm" variant="outline" onClick={() => setSaindo(marcados)}>Sair {marcados.length}</Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <a href={URL_PROMOCOES_ML} target="_blank" rel="noreferrer">Gerenciar no Mercado Livre <ExternalLink className="size-4" aria-hidden /></a>
          </Button>
        )}
      </header>
      <ul className="divide-y">
        {itens.map((r) => <LinhaParticipacao key={r.ml_item_id} r={r} operavel={operavel} marcado={selecionados.has(r.ml_item_id)} onToggle={alternar} />)}
      </ul>
      {operavel && (
        <PreviewOperacao
          acao="sair" tipo={p.tipo === 'SMART' ? 'SMART' : 'DEAL'} promocaoId={p.promocao_id} promocaoNome={nome}
          itens={saindo ?? []} aberto={saindo != null} onClose={() => setSaindo(null)} onSucesso={() => setSelecionados(new Set())}
        />
      )}
    </section>
  );
}

function LinhaParticipacao({ r, operavel, marcado, onToggle }: {
  r: Participacao; operavel: boolean; marcado: boolean; onToggle: (id: string) => void;
}) {
  const ui = SEMAFORO_UI[r.pior_semaforo];
  const d = descontoPct(r.preco_original, r.preco_avaliado);
  const mlb = r.anuncio_normal_id ?? r.ml_item_id;
  return (
    <li className="flex items-center gap-3 p-3 sm:px-4">
      {operavel && <Checkbox aria-label={`Selecionar ${mlb}`} checked={marcado} onCheckedChange={() => onToggle(r.ml_item_id)} />}
      {r.thumbnail && <img src={r.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />}
      <div className={cn('min-w-0 flex-1', r.pior_semaforo === 'indisponivel' && 'text-muted-foreground')}>
        <p className="truncate text-sm" title={formatarNomeProduto(r.titulo) || r.ml_item_id}>{formatarNomeProduto(r.titulo) || r.ml_item_id}</p>
        <p className="truncate text-xs text-muted-foreground">{rotuloMlb(r)}{r.status === 'pending' ? ' · começa depois' : ''}</p>
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
