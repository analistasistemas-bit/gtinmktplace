// I5 — preview do reajuste de preço em massa (spec 2026-10-04: Telas, D1, D7, D10, C4, C5). A tela mostra
// exatamente o rascunho que o servidor gravou; editar um preço pede um preview novo (novo rascunho) e zera as
// confirmações. Reverter = o mesmo preview com `origem_id` (alvo = preço anterior da origem, sem edição).
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { SEMAFORO_UI } from '@/components/promocoes/contagem-semaforo';
import {
  ErroOperacao, useConfirmarReajuste, usePodeExecutarOperacao, usePreviewReajuste,
  type PedidoPreviewReajuste, type RecusaItem, type RespostaPreviewReajuste,
} from '@/hooks/useOperacoes';
import { fmtBRL, fmtMarkup } from '@/lib/formato';
import { calcularMarkup } from '@/lib/markup';
import { parsePreco, tituloOperacao } from '@/lib/operacoes';
import { MOTIVO_COR } from '@/lib/promocoes';
import { formatarAjuste, maxDuasCasas, type CorAvaliada, type ItemPreview } from '@/lib/reajuste';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';

// Mesma gravidade de `_shared/operacoes/reajuste/avaliacao.ts#resumir`.
const PESO = { vermelho: 3, indisponivel: 2, amarelo: 1, verde: 0 } as const;
/** Pior cor (a do `avaliacao.pior`); empate → menor líquido. */
function piorCor(cores: CorAvaliada[]): CorAvaliada | null {
  return [...cores].sort((a, b) => PESO[b.semaforo] - PESO[a.semaforo] || (a.liquido ?? 0) - (b.liquido ?? 0))[0] ?? null;
}
const formatarInput = (n: number) => n.toFixed(2).replace('.', ',');
const anuncios = (n: number) => `${n} anúncio${n === 1 ? '' : 's'}`;
const nomeItem = (i: ItemPreview) => formatarNomeProduto(i.titulo) || i.ml_item_id;

function LiquidoCor({ c }: { c: CorAvaliada }) {
  if (c.liquido == null || c.custo == null) return <span className="text-muted-foreground">{MOTIVO_COR[c.motivo ?? ''] ?? 'Sem cálculo'}</span>;
  return (
    <span className="tabular-nums">
      Líquido {fmtBRL(c.liquido)} · {fmtMarkup(calcularMarkup(c.liquido, c.custo).markup)}
    </span>
  );
}

function PillsSemaforo({ item }: { item: ItemPreview }) {
  const a = item.avaliacao;
  if (!a) return null;
  // D7: 🔴 e ⚪ aparecem separados — um não esconde o outro.
  const tons = a.tem_vermelho || a.tem_sem_dado
    ? [...(a.tem_vermelho ? ['vermelho' as const] : []), ...(a.tem_sem_dado ? ['indisponivel' as const] : [])]
    : [a.pior];
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {tons.map((s) => {
        const ui = SEMAFORO_UI[s];
        return <StatusPill key={s} tone={ui.tone} title={ui.label}><ui.Icon className="size-3.5" aria-hidden />{ui.label}</StatusPill>;
      })}
    </div>
  );
}

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return agora;
}

export function PreviewReajuste({ pedido, onFechar, onCriada }: {
  pedido: PedidoPreviewReajuste; onFechar: () => void; onCriada: (operacaoId: string) => void;
}) {
  const preview = usePreviewReajuste();
  const confirmar = useConfirmarReajuste();
  const podeExecutar = usePodeExecutarOperacao();
  const reverter = !!pedido.origem_id;

  const [resp, setResp] = useState<RespostaPreviewReajuste | null>(null);
  const [erroPreview, setErroPreview] = useState<ErroOperacao | null>(null);
  const [precos, setPrecos] = useState<Record<string, number>>({});
  const [incluir, setIncluir] = useState<Record<string, boolean>>({});
  const [confVermelho, setConfVermelho] = useState(false);
  const [confSemDado, setConfSemDado] = useState(false);
  const [recusas, setRecusas] = useState<RecusaItem[]>([]);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  // Só a resposta do pedido mais recente vale: duas edições rápidas não podem ser sobrescritas pela mais lenta.
  const ultimoPedido = useRef(0);
  const respAtual = useRef<RespostaPreviewReajuste | null>(null);
  async function pedir(p: Record<string, number>) {
    const id = ++ultimoPedido.current;
    setErroPreview(null);
    try {
      const r = await preview.mutateAsync({ ...pedido, ...(Object.keys(p).length ? { precos: p } : {}) });
      if (id !== ultimoPedido.current) return;
      // Novo rascunho: confirmações zeradas (C5); mantém só o desmarque manual de item cujo preço não mudou
      // (🔴/⚪ seguem o padrão do rascunho novo: desmarcados).
      const antes = new Map((respAtual.current?.itens ?? []).map((i) => [i.ml_item_id, i.preco]));
      const mesmoPreco = new Set(r.itens.filter((i) => antes.get(i.ml_item_id) === i.preco).map((i) => i.ml_item_id));
      setIncluir((s) => Object.fromEntries(Object.entries(s).filter(([ml, v]) => v === false && mesmoPreco.has(ml))));
      respAtual.current = r;
      setResp(r); setConfVermelho(false); setConfSemDado(false); setRecusas([]);
    } catch (e) {
      if (id !== ultimoPedido.current) return;
      setErroPreview(e instanceof ErroOperacao ? e : new ErroOperacao('Não foi possível calcular o preview.'));
    }
  }
  // ponytail: ref evita 2 rascunhos no StrictMode (o efeito roda 2× em dev).
  const pediu = useRef(false);
  useEffect(() => {
    if (pediu.current) return;
    pediu.current = true;
    void pedir({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itens = resp?.itens ?? [];
  const elegiveis = itens.filter((i) => i.situacao === 'elegivel');
  const fora = itens.filter((i) => i.situacao === 'fora');
  const semAlteracao = itens.filter((i) => i.situacao === 'sem_alteracao');
  const estaIncluido = (i: ItemPreview) => incluir[i.ml_item_id] ?? i.incluido;
  const incluidos = elegiveis.filter(estaIncluido);
  const temVermelho = incluidos.some((i) => i.avaliacao?.tem_vermelho);
  const temSemDado = incluidos.some((i) => i.avaliacao?.tem_sem_dado);
  // Confirmação sem item daquela cor incluído não vale para o próximo que for marcado.
  useEffect(() => { if (!temVermelho) setConfVermelho(false); }, [temVermelho]);
  useEffect(() => { if (!temSemDado) setConfSemDado(false); }, [temSemDado]);

  const expiraEm = resp?.expira_em ? Date.parse(resp.expira_em) : null;
  const agora = useAgora(expiraEm != null);
  const restanteS = expiraEm != null ? Math.max(0, Math.floor((expiraEm - agora) / 1000)) : null;
  const expirado = restanteS === 0;

  const ocupado = preview.isPending || confirmar.isPending;
  const podeConfirmar = !!resp?.operacao_id && incluidos.length > 0 && !expirado && !ocupado
    && (!temVermelho || confVermelho) && (!temSemDado || confSemDado);

  function editarPreco(i: ItemPreview, texto: string) {
    const v = parsePreco(texto);
    if (v == null || !(v > 0) || !maxDuasCasas(v)) {
      toast.error('Preço inválido: use um valor maior que zero, com até 2 casas.');
      return;
    }
    if (v === i.preco) return;
    const novos = { ...precos, [i.ml_item_id]: v };
    setPrecos(novos);
    void pedir(novos);
  }

  async function executar() {
    if (!resp?.operacao_id) return;
    setRecusas([]);
    try {
      const r = await confirmar.mutateAsync({
        operacao_id: resp.operacao_id,
        confirmacoes: elegiveis.map((i) => {
          const inc = estaIncluido(i);
          return {
            ml_item_id: i.ml_item_id, incluir: inc,
            risco: inc && !!i.avaliacao?.tem_vermelho && confVermelho,
            sem_dado: inc && !!i.avaliacao?.tem_sem_dado && confSemDado,
          };
        }),
      });
      onCriada(r.operacao_id);
    } catch (e) {
      if (e instanceof ErroOperacao && e.itens?.length) setRecusas(e.itens);
      toast.error(e instanceof ErroOperacao ? e.message : 'Não foi possível executar o reajuste.');
    }
  }

  const titulo = tituloOperacao({ acao: 'reajustar', promocao_nome: null, promocao_id: null, origem_id: pedido.origem_id ?? null }, incluidos.length);
  const tituloDe = (id: string) => { const i = itens.find((x) => x.ml_item_id === id); return i ? nomeItem(i) : id; };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{titulo}</SheetTitle>
          <SheetDescription>
            {reverter ? 'Volta ao preço de antes do reajuste.' : pedido.ajuste ? `Ajuste ${formatarAjuste(pedido.ajuste)}` : null}
            {restanteS != null && !expirado && (
              <> · Expira em {Math.floor(restanteS / 60)}:{String(restanteS % 60).padStart(2, '0')}</>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          {!resp && preview.isPending && [0, 1, 2].map((k) => <Skeleton key={k} className="h-16 rounded-lg" />)}

          {erroPreview && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm" role="alert">
              <p className="font-medium text-danger">{erroPreview.message}</p>
              {erroPreview.itens?.map((r) => <p key={r.ml_item_id}>{r.ml_item_id}: {r.motivo}</p>)}
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void pedir(precos)}>Tentar de novo</Button>
            </div>
          )}

          {resp && !resp.operacao_id && (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm">Nenhum anúncio muda de preço.</p>
          )}

          {expirado && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              <p>O preview expirou — gere de novo.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void pedir(precos)} disabled={preview.isPending}>Gerar de novo</Button>
            </div>
          )}

          {resp?.operacao_id && !reverter && (
            <p className="text-sm text-muted-foreground">
              O preço novo fica fixado nestas cores: o re-ingest deixa de recalcular o preço delas por custo.
            </p>
          )}

          {recusas.length > 0 && (
            <ul className="space-y-1 rounded border border-danger/40 bg-danger/5 p-2 text-sm" aria-label="Anúncios recusados">
              {recusas.map((r) => <li key={r.ml_item_id}>{tituloDe(r.ml_item_id)} ({r.ml_item_id}): {r.motivo}</li>)}
            </ul>
          )}

          {elegiveis.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg border" aria-label="Anúncios do reajuste">
              {elegiveis.map((i) => {
                const pior = i.avaliacao ? piorCor(i.avaliacao.cores) : null;
                const aberto = abertos.has(i.ml_item_id);
                return (
                  <li key={i.ml_item_id} className="flex flex-col gap-2 p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        aria-label={`Incluir ${i.ml_item_id}`} className="mt-0.5"
                        checked={estaIncluido(i)} disabled={ocupado}
                        onCheckedChange={(v) => setIncluir((s) => ({ ...s, [i.ml_item_id]: v === true }))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{nomeItem(i)}</p>
                        <p className="text-xs text-muted-foreground">{i.ml_item_id}{i.sku ? ` · SKU ${i.sku}` : ''}</p>
                      </div>
                      <PillsSemaforo item={i} />
                    </div>
                    <div className="ml-7 flex flex-wrap items-center gap-2 text-sm">
                      <span className="tabular-nums text-muted-foreground">{fmtBRL(i.preco_anterior)}</span>
                      <span aria-hidden>→</span>
                      {reverter ? (
                        <span className="font-medium tabular-nums">{fmtBRL(i.preco)}</span>
                      ) : (
                        <Input
                          key={`${resp?.operacao_id}-${i.preco}`}
                          defaultValue={formatarInput(i.preco)} inputMode="decimal" disabled={ocupado}
                          aria-label={`Novo preço de ${i.ml_item_id}`} className="h-8 w-28"
                          onBlur={(e) => editarPreco(i, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        />
                      )}
                    </div>
                    {pior && <p className="ml-7 text-xs"><LiquidoCor c={pior} /></p>}
                    {i.aviso && <p className="ml-7 text-xs text-warning">{i.aviso}</p>}
                    {(i.avaliacao?.cores.length ?? 0) > 1 && (
                      <div className="ml-7">
                        <Button
                          type="button" variant="ghost" size="xs" aria-expanded={aberto}
                          onClick={() => setAbertos((s) => { const n = new Set(s); if (aberto) n.delete(i.ml_item_id); else n.add(i.ml_item_id); return n; })}
                        >
                          <ChevronDown className={cn('transition-transform', aberto && 'rotate-180')} aria-hidden />
                          {i.avaliacao!.cores.length} cores
                        </Button>
                        {aberto && (
                          <ul className="mt-1 flex flex-col gap-1 text-xs">
                            {i.avaliacao!.cores.map((c, k) => {
                              const ui = SEMAFORO_UI[c.semaforo];
                              return (
                                <li key={c.variation_id ?? k} className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{c.sku ?? c.variation_id ?? 'Única'}</span>
                                  <span className="flex items-center gap-2"><LiquidoCor c={c} /><ui.Icon className={cn('size-3.5', ui.text)} aria-label={ui.label} /></span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {fora.length > 0 && (
            <section aria-label="Fora do lote">
              <h3 className="text-sm font-medium">Fora do lote ({fora.length})</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {fora.map((i) => (
                  <li key={i.ml_item_id} className="text-muted-foreground">
                    <span className="text-foreground">{nomeItem(i)}</span> ({i.ml_item_id}): {i.motivo}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {semAlteracao.length > 0 && (
            <section aria-label="Sem alteração">
              <h3 className="text-sm font-medium">Sem alteração ({semAlteracao.length})</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
                {semAlteracao.map((i) => <li key={i.ml_item_id}>{nomeItem(i)} ({i.ml_item_id}): continua {fmtBRL(i.preco)}</li>)}
              </ul>
            </section>
          )}
        </div>

        <SheetFooter>
          {temVermelho && (
            <label htmlFor="reajuste-conf-vermelho" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
              <Checkbox id="reajuste-conf-vermelho" checked={confVermelho} onCheckedChange={(v) => setConfVermelho(v === true)} disabled={ocupado} />
              Assumo o prejuízo nos itens 🔴 incluídos
            </label>
          )}
          {temSemDado && (
            <label htmlFor="reajuste-conf-sem-dado" className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Checkbox id="reajuste-conf-sem-dado" checked={confSemDado} onCheckedChange={(v) => setConfSemDado(v === true)} disabled={ocupado} />
              Assumo os itens ⚪ sem cálculo incluídos
            </label>
          )}
          {resp?.operacao_id && (podeExecutar ? (
            <Button onClick={executar} disabled={!podeConfirmar}>
              {reverter ? 'Reverter' : 'Reajustar'} {anuncios(incluidos.length)}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Só administradores executam.</p>
          ))}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
