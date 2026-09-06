// ADR-0154 Decisão 12: lista de candidatos a componente de Kit Virtual. Puramente apresentacional
// — quem busca no ML e guarda a seleção é `DialogCriarKitVirtual`. Os inelegíveis aparecem com o
// motivo (na Avil isso é 68 anúncios recusados com COMPONENT_NOT_MIGRATED_TO_UP — esconder
// produziria "cadê meu produto?" sem resposta) e nunca são selecionáveis.
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Search, PackageX, Plus, X, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComponenteCandidatoKitVirtual, ComponenteSelecionadoKitVirtual } from '@/lib/kit-virtual';

const CHAVE = (c: ComponenteCandidatoKitVirtual) => c.userProductId;

export function ListaComponentesKitVirtual({
  searchText, onSearchTextChange, onBuscar, carregando, erro,
  elegiveis, inelegiveis, selecionados, onAdicionar, onRemover, onAlterarQuantidade, onAlterarPreco, onTornarPrincipal,
}: {
  searchText: string;
  onSearchTextChange: (v: string) => void;
  onBuscar: () => void;
  carregando: boolean;
  erro: string | null;
  elegiveis: ComponenteCandidatoKitVirtual[];
  inelegiveis: ComponenteCandidatoKitVirtual[];
  selecionados: ComponenteSelecionadoKitVirtual[];
  onAdicionar: (c: ComponenteCandidatoKitVirtual) => void;
  onRemover: (userProductId: string) => void;
  onAlterarQuantidade: (userProductId: string, quantidade: number) => void;
  onAlterarPreco: (userProductId: string, preco: number) => void;
  onTornarPrincipal: (userProductId: string) => void;
}) {
  const selecionadosIds = new Set(selecionados.map((s) => CHAVE(s.candidato)));

  return (
    <div className="flex flex-col gap-4">
      {selecionados.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <h3 className="text-sm font-semibold">
            Composição ({selecionados.length}/6)
          </h3>
          <ul className="flex flex-col gap-1.5" aria-label="Componentes selecionados">
            {selecionados.map((s, i) => {
              const principal = i === 0;
              return (
                <li
                  key={CHAVE(s.candidato)}
                  className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"
                >
                  {principal ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary" title="Principal — define a categoria do kit">
                      <Crown className="h-3.5 w-3.5" /> Principal
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => onTornarPrincipal(CHAVE(s.candidato))}
                    >
                      Tornar principal
                    </button>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={s.candidato.title}>{s.candidato.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    Preço atual (R$)
                    <Input
                      type="number" min={0} step="0.01"
                      aria-label={`Preço atual de ${s.candidato.title}`}
                      className="h-7 w-20 text-xs"
                      value={s.precoAtualML || ''}
                      onChange={(e) => onAlterarPreco(CHAVE(s.candidato), Number(e.target.value))}
                      aria-invalid={!(s.precoAtualML > 0)}
                    />
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    Qtd.
                    <Input
                      type="number" min={1} max={10}
                      aria-label={`Quantidade de ${s.candidato.title}`}
                      className="h-7 w-14 text-xs"
                      value={s.quantidade}
                      onChange={(e) => onAlterarQuantidade(CHAVE(s.candidato), Number(e.target.value))}
                    />
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover ${s.candidato.title}`}
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => onRemover(CHAVE(s.candidato))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar componente"
            placeholder="Buscar por título…"
            className="h-8 pl-7 text-sm"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onBuscar(); }}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBuscar} disabled={carregando}>
          {carregando ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {erro && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : elegiveis.length === 0 && inelegiveis.length === 0 ? (
        <EmptyState icon={PackageX} title="Nenhum componente encontrado" description="Ajuste a busca ou confira se há produtos publicados sem variação de cor." />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5" aria-label="Componentes elegíveis">
            {elegiveis.map((c) => {
              const jaSelecionado = selecionadosIds.has(CHAVE(c));
              const limiteAtingido = !jaSelecionado && selecionados.length >= 6;
              return (
                <li key={CHAVE(c)} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-9 w-9 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={c.title}>{c.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.categoryName ?? 'Categoria não informada'}
                      {c.estoque != null && ` · estoque ${c.estoque}`}
                      {c.kitMultiplicador != null && ' · kit vinculado'}
                    </p>
                  </div>
                  <Button
                    type="button" variant={jaSelecionado ? 'secondary' : 'outline'} size="sm" className="h-7 shrink-0 px-2"
                    disabled={jaSelecionado || limiteAtingido}
                    onClick={() => onAdicionar(c)}
                  >
                    {jaSelecionado ? 'Selecionado' : <><Plus className="mr-1 h-3 w-3" />Adicionar</>}
                  </Button>
                </li>
              );
            })}
          </ul>

          {inelegiveis.length > 0 && (
            <details className="rounded-md border">
              <summary className="cursor-pointer select-none p-2 text-xs font-medium text-muted-foreground">
                {inelegiveis.length} produto{inelegiveis.length > 1 ? 's' : ''} não pode{inelegiveis.length > 1 ? 'm' : ''} entrar no kit
              </summary>
              <ul className="flex flex-col gap-1.5 p-2 pt-0" aria-label="Componentes inelegíveis">
                {inelegiveis.map((c) => (
                  <li key={CHAVE(c)} className={cn('flex items-start gap-2 rounded-md border border-dashed p-2 text-sm opacity-80')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={c.title}>{c.title}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {c.reasons.length > 0 ? c.reasons.map((r) => (
                          <Badge key={r.id} variant="outline" className="text-[10px] text-muted-foreground">{r.message}</Badge>
                        )) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Motivo não informado</Badge>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
