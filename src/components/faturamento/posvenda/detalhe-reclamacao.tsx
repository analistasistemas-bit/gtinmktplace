import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Paperclip } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { buscarDetalheReclamacao, type AcaoPosvenda, type DetalheReclamacao } from '@/lib/posvenda';
import { acaoLiberada, travada, type ProdutoPedido } from '@/lib/posvenda-fila';
import { QK_POSVENDA, useProdutosPedidos } from '@/hooks/usePosvenda';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import type { Travas } from './lista-reclamacoes';
import type { Devolucao } from '@/lib/devolucoes';
import { fmtBRL } from '@/lib/formato';
import { urlVendaML } from '@/lib/ml-status';
import { DialogoConfirmarAcao } from './dialogo-confirmar-acao';
import { DialogoRevisarDevolucao, Fotos, montarInfoRevisao, type Anexo } from './dialogo-revisar-devolucao';

export const fmtDataHora = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

const AUTOR: Record<string, string> = { comprador: 'Comprador', vendedor: 'Você', ml: 'Mercado Livre' };
export const MSG_TRAVA = 'Ação enviada ao ML · aguardando confirmação';
const MSG_NAO_LIBERADA = 'Não liberado pelo ML nesta reclamação';

type Dialogo = null | 'responder' | 'reembolsar' | 'disputa' | 'autorizar' | 'revisar';

function Reembolso({ d, claimId, open, onOpenChange, onConcluido, linkML }: {
  d: DetalheReclamacao; claimId: string; open: boolean; onOpenChange: (v: boolean) => void; onConcluido: () => void; linkML?: string;
}) {
  // Cada opção só vale se o ML a libera (`refund` = total; `allow_partial_refund` = parcial com ofertas).
  const totalOk = acaoLiberada('reembolsar', d);
  const parcialOk = acaoLiberada('reembolso_parcial', d);
  const ofertas = d.reembolso_parcial?.ofertas ?? [];
  const [escolha, setEscolha] = useState(totalOk ? 'total' : parcialOk && ofertas[0] ? String(ofertas[0].percentual) : '');
  const parcial = escolha !== 'total';
  return (
    <DialogoConfirmarAcao
      open={open} onOpenChange={onOpenChange} claimId={claimId} onConcluido={onConcluido} linkML={linkML}
      titulo="Reembolsar comprador" rotuloEnviar="Reembolsar"
      corpo={parcial ? { acao: 'reembolso_parcial', percentual: Number(escolha) } : { acao: 'reembolsar' }}
      podeEnviar={escolha !== ''}
      efeito={parcial ? `Isto oferece ao comprador um reembolso de ${escolha}% no Mercado Livre.` : 'Isto devolve o valor total ao comprador no Mercado Livre.'}
    >
      <RadioGroup value={escolha} onValueChange={setEscolha}>
        <label htmlFor="rb-total" className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm has-data-checked:border-primary has-disabled:opacity-50">
          <RadioGroupItem id="rb-total" value="total" disabled={!totalOk} />Reembolso total
        </label>
        {ofertas.map((o) => (
          <label key={o.percentual} htmlFor={`rb-${o.percentual}`} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm has-data-checked:border-primary">
            <RadioGroupItem id={`rb-${o.percentual}`} value={String(o.percentual)} disabled={!parcialOk} />
            Reembolso parcial de {o.percentual}% ({fmtBRL(o.valor)})
          </label>
        ))}
        {!ofertas.length && (
          <label htmlFor="rb-parcial-off" className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm opacity-50">
            <RadioGroupItem id="rb-parcial-off" value="parcial" disabled />Reembolso parcial de {'—'} (não liberado pelo ML)
          </label>
        )}
      </RadioGroup>
    </DialogoConfirmarAcao>
  );
}

function Conteudo({ d, item, travas, produto, onFechar }: {
  d: DetalheReclamacao; item: Devolucao; travas: Travas; produto?: ProdutoPedido; onFechar: () => void;
}) {
  const qc = useQueryClient();
  const claimId = String(d.claim_id);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [subindo, setSubindo] = useState(0);
  const linkML = item.order_id ? urlVendaML(item.pack_id ?? item.order_id) : undefined;
  const concluido = () => { void qc.invalidateQueries({ queryKey: QK_POSVENDA }); void qc.invalidateQueries({ queryKey: ['devolucoes'] }); };

  // travas === null: ainda não sabemos o que está em andamento => nada liberado.
  const bloqueada = (a: AcaoPosvenda) => travas === null || travada(travas, a, d.claim_id, d.return_id);
  const motivoOff = (a: AcaoPosvenda | AcaoPosvenda[]): string | undefined => {
    const as = Array.isArray(a) ? a : [a];
    if (travas === null) return 'Conferindo ações em andamento…';
    if (as.some(bloqueada)) return MSG_TRAVA;
    if (!as.some((x) => acaoLiberada(x, d))) return MSG_NAO_LIBERADA;
    return undefined;
  };
  const off = (a: AcaoPosvenda | AcaoPosvenda[]) => motivoOff(a) !== undefined;
  const algumaAtiva = (travas ?? []).some((t) => t.claim_id === d.claim_id);

  const e = d.estado;
  const linhas: Array<[string, string]> = [
    ['Motivo', item.reason_texto ?? item.reason_id ?? '—'],
    ['Comprador quer', d.comprador_quer ?? '—'],
    ['Etapa', d.stage ?? '—'],
    ['Reputação', d.afeta_reputacao ?? '—'],
    ['Custo da devolução', d.custo_devolucao != null ? `${fmtBRL(d.custo_devolucao)} para você` : '—'],
  ];

  return (
    <div className="space-y-4 overflow-y-auto px-4 pb-6">
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <ThumbProduto path={produto?.fotoPath ?? null} titulo={produto?.titulo ?? null} size={48} />
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{produto?.titulo ?? 'Produto do pedido'}</div>
          <div className="text-xs text-muted-foreground">
            Pedido #{item.order_id ?? '—'}{produto && ` · ${produto.quantidade} un · ${fmtBRL(produto.valor)}`}
          </div>
        </div>
      </div>
      {algumaAtiva && (
        <div role="status" className="rounded-lg bg-info/10 p-2.5 text-xs text-info">{MSG_TRAVA}</div>
      )}
      {d.incompleto.length > 0 && (
        <div className="rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
          Algumas informações não carregaram do Mercado Livre ({d.incompleto.join(', ')}). Reabra para tentar de novo.
        </div>
      )}

      <section className="space-y-2 rounded-lg border bg-card p-3">
        <div className="text-sm font-semibold">{e.titulo ?? 'Situação'}</div>
        {e.descricao && <p className="text-xs text-muted-foreground">{e.descricao}</p>}
        {e.problema && <p className="text-xs"><span className="text-muted-foreground">Problema: </span>{e.problema}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {linhas.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold">Histórico</div>
        {d.historico.length === 0 && <p className="text-xs text-muted-foreground">Sem mensagens.</p>}
        {[...d.historico].reverse().map((m, i) => (
          <div key={i} className="rounded-lg border bg-card p-2.5 text-xs">
            <div className="mb-0.5 text-muted-foreground">{fmtDataHora(m.data)} · {AUTOR[m.autor] ?? m.autor}</div>
            <div className="whitespace-pre-wrap">{m.texto}</div>
            {m.anexos.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">{m.anexos.map((a) => (<span key={a.id} className="inline-flex items-center gap-1 text-muted-foreground"><Paperclip className="h-3 w-3" />{a.nome}</span>))}</div>
            )}
            {m.moderacao === 'rejected' && <div className="mt-1 text-destructive">Mensagem rejeitada pela moderação do ML.</div>}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <label htmlFor="pv-resposta" className="text-sm font-semibold">Responder</label>
        <Textarea id="pv-resposta" value={texto} onChange={(ev) => setTexto(ev.target.value)} maxLength={2000} disabled={off('responder')}
          placeholder="Escreva dentro da reclamação… (pode anexar foto ou PDF)" className="min-h-20" />
        <Fotos claimId={claimId} idBase="pv-anexo" destino="mensagem" obrigatoria={false} anexos={anexos} onChange={(fn) => setAnexos(fn)} onSubindo={(dl) => setSubindo((n) => n + dl)} />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button disabled={off('responder') || !texto.trim() || subindo > 0} title={motivoOff('responder')} onClick={() => setDialogo('responder')}>Responder</Button>
        <Button variant="outline" disabled={off(['reembolsar', 'reembolso_parcial'])} title={motivoOff(['reembolsar', 'reembolso_parcial'])} onClick={() => setDialogo('reembolsar')}>Reembolsar…</Button>
        <Button variant="outline" disabled={off(['revisar_ok', 'revisar_falha'])} title={motivoOff(['revisar_ok', 'revisar_falha'])} onClick={() => setDialogo('revisar')}>Revisar devolução</Button>
        <Button variant="outline" disabled={off('autorizar_devolucao')} title={motivoOff('autorizar_devolucao')} onClick={() => setDialogo('autorizar')}>Autorizar devolução</Button>
        <Button variant="outline" disabled={off('abrir_disputa')} title={motivoOff('abrir_disputa')} onClick={() => setDialogo('disputa')}>Pedir mediação do ML</Button>
        <Button variant="ghost" onClick={onFechar}>Fechar</Button>
      </div>
      <p className="text-xs text-muted-foreground">Botões apagados: o ML não libera a ação agora. Nada vai ao ML sem a sua confirmação.</p>

      {dialogo === 'responder' && (
        <DialogoConfirmarAcao open onOpenChange={() => setDialogo(null)} claimId={claimId} linkML={linkML}
          titulo="Enviar mensagem" rotuloEnviar="Enviar mensagem" podeEnviar
          corpo={{ acao: 'responder', texto: texto.trim(), anexos: anexos.map((a) => a.id) }}
          onConcluido={() => { setTexto(''); setAnexos([]); concluido(); }}
          efeito="Esta mensagem será enviada dentro da reclamação no Mercado Livre.">
          <p className="whitespace-pre-wrap rounded-lg bg-muted p-2.5 text-sm">{texto.trim()}</p>
        </DialogoConfirmarAcao>
      )}
      {dialogo === 'reembolsar' && <Reembolso d={d} claimId={claimId} open onOpenChange={() => setDialogo(null)} onConcluido={concluido} linkML={linkML} />}
      {dialogo === 'disputa' && (
        <DialogoConfirmarAcao open onOpenChange={() => setDialogo(null)} claimId={claimId} linkML={linkML} onConcluido={concluido}
          titulo="Pedir mediação do ML" rotuloEnviar="Pedir mediação" podeEnviar corpo={{ acao: 'abrir_disputa' }}
          efeito="Isto abre uma disputa e o Mercado Livre passa a mediar a reclamação." />
      )}
      {dialogo === 'autorizar' && (
        <DialogoConfirmarAcao open onOpenChange={() => setDialogo(null)} claimId={claimId} linkML={linkML} onConcluido={concluido}
          titulo="Autorizar devolução" rotuloEnviar="Autorizar" podeEnviar corpo={{ acao: 'autorizar_devolucao' }}
          efeito="Isto autoriza o comprador a devolver o produto no Mercado Livre." />
      )}
      {dialogo === 'revisar' && (
        <DialogoRevisarDevolucao detalhe={d} open onOpenChange={() => setDialogo(null)} onConcluido={concluido}
          info={montarInfoRevisao(item, d.afeta_reputacao, produto)} />
      )}
    </div>
  );
}

export function PainelReclamacao({ item, travas, onOpenChange }: {
  item: Devolucao | null; travas: Travas; onOpenChange: (v: boolean) => void;
}) {
  const claim = item?.claim_id;
  const produto = useProdutosPedidos([item?.order_id]).get(item?.order_id ?? -1);
  // Sempre relido do ML ao abrir (nunca do cache local).
  const q = useQuery({
    queryKey: [...QK_POSVENDA, 'detalhe', claim], enabled: claim != null, staleTime: 0, gcTime: 0,
    queryFn: () => buscarDetalheReclamacao(String(claim)),
  });
  const e = q.data?.estado;
  return (
    <Sheet open={item != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Reclamação {claim}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {item?.reason_texto ?? 'Detalhe lido agora do Mercado Livre.'}
            {e?.vez_de && <StatusPill tone={e.vez_de === 'vendedor' ? 'warning' : 'neutral'}>Vez {e.vez_de === 'vendedor' ? 'sua' : e.vez_de === 'comprador' ? 'do comprador' : 'do ML'}{e.prazo ? ` · até ${fmtDataHora(e.prazo).slice(0, 5)}` : ''}</StatusPill>}
          </SheetDescription>
        </SheetHeader>
        {q.isPending && <div className="flex items-center gap-2 px-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lendo do Mercado Livre…</div>}
        {q.isError && (
          <div className="space-y-2 px-4 text-sm"><p className="text-destructive">{(q.error as Error).message}</p><Button variant="outline" onClick={() => void q.refetch()}>Tentar de novo</Button></div>
        )}
        {q.data && item && <Conteudo d={q.data} item={item} travas={travas} produto={produto} onFechar={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}
