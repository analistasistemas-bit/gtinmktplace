// Spec §3.5: Sheet lateral do pedido de um fornecedor. Rascunho: quantidades e data editáveis, salvar e
// Aprovar pedido (só admin; a edge também recusa). Aprovado/enviado: edição só admin, até o primeiro recebimento
// (a RPC recusa depois, e a recusa aparece aqui), Copiar para WhatsApp marca como enviado.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import type { useReposicao } from '@/hooks/useReposicao';
import { fmtInt } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { PedidoDTO, RespostaReposicao, StatusPedido } from '../../../supabase/functions/_shared/reposicao/tipos';
import { fmtQuando, ValorPedido } from './barra-rascunho';
import { itensOrdenados, textoWhatsApp } from './texto-whatsapp';

type Acoes = Pick<ReturnType<typeof useReposicao>, 'salvarRascunho' | 'aprovar' | 'marcarEnviado' | 'editarPedido'>;

export const ROTULO_STATUS: Record<StatusPedido, string> = {
  rascunho: 'Rascunho', aprovado: 'Aprovado', enviado: 'Enviado', parcial: 'Parcial', recebido: 'Recebido', saldo_encerrado: 'Saldo encerrado',
};
export const TOM_STATUS = {
  rascunho: 'neutral', aprovado: 'info', enviado: 'info', parcial: 'warning', recebido: 'success', saldo_encerrado: 'neutral',
} as const satisfies Record<StatusPedido, string>;

const EDITAVEL = new Set<StatusPedido>(['rascunho', 'aprovado', 'enviado']);
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível salvar agora.');
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const inteiro = (v: string) => (/^\d{1,7}$/.test(v) ? Number(v) : null);
const quantidades = (p: PedidoDTO): Record<string, string> => Object.fromEntries(p.itens.map((i) => [i.codigo, String(i.quantidade)]));
/** Item ausente vale 0 (rascunho tira item zerado): só difere se algum número visível muda. */
const difere = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => (a[k] ?? '0') !== (b[k] ?? '0'));

function Corpo({ pedido, data, hoje, acoes }: { pedido: PedidoDTO; data: RespostaReposicao; hoje: string; acoes: Acoes }) {
  const podeAprovar = usePodeExecutarOperacao();
  // Gerada uma vez por abertura do Sheet e reaproveitada em retentativa e duplo clique (idempotência da edge).
  const [ref] = useState(() => crypto.randomUUID());
  const [aprovadoAgora, setAprovadoAgora] = useState(false);
  const [enviadoAgora, setEnviadoAgora] = useState(false);
  const status: StatusPedido = enviadoAgora && pedido.status !== 'parcial' && pedido.status !== 'recebido' ? 'enviado'
    : aprovadoAgora && pedido.status === 'rascunho' ? 'aprovado' : pedido.status;
  const linhas = useMemo(() => itensOrdenados(pedido, data.skus, data.familias), [pedido, data.skus, data.familias]);
  const dataInicial = pedido.previstoPara ?? somarDias(hoje, data.config?.prazo ?? 0);
  const [qtd, setQtd] = useState<Record<string, string>>(() => quantidades(pedido));
  const [previsto, setPrevisto] = useState(dataInicial);
  // Outro membro salvou com o Sheet aberto: recarrega do servidor (senão gravaríamos valores velhos) e avisa
  // quando algum número visível mudou. O nosso próprio salvar chega igual ao que está na tela: sem aviso.
  const versao = `${pedido.salvoEm}|${pedido.alteradoEm}`;
  const [versaoVista, setVersaoVista] = useState(versao);
  const [aviso, setAviso] = useState<string | null>(null);
  if (versao !== versaoVista) {
    setVersaoVista(versao);
    const novas = quantidades(pedido);
    if (difere(novas, qtd) || previsto !== dataInicial) {
      const quem = (pedido.status === 'rascunho' ? pedido.salvoPor : pedido.alteradoPor) ?? 'Outro membro';
      setAviso(`${quem} salvou este pedido agora; as quantidades e a data foram recarregadas.`);
    }
    setQtd(novas);
    setPrevisto(dataInicial);
  }
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | 'salvar' | 'aprovar' | 'copiar' | 'enviar'>(null);
  const [copiado, setCopiado] = useState(false);

  // Pedido aprovado só muda por quem aprova (a edge recusa o membro com 403).
  const editavel = EDITAVEL.has(status) && (status === 'rascunho' || podeAprovar);
  const recebeu = !EDITAVEL.has(status);
  const valido = pedido.itens.every((i) => inteiro(qtd[i.codigo] ?? '') !== null) && /^\d{4}-\d{2}-\d{2}$/.test(previsto);
  const sujo = pedido.itens.some((i) => qtd[i.codigo] !== String(i.quantidade)) || previsto !== dataInicial;
  const total = linhas.reduce((a, l) => {
    const q = inteiro(qtd[l.item.codigo] ?? '') ?? 0;
    return { un: a.un + q, valor: a.valor + q * (l.custo ?? 0), semCusto: a.semCusto + (l.custo === null ? 1 : 0) };
  }, { un: 0, valor: 0, semCusto: 0 });

  async function rodar(qual: NonNullable<typeof ocupado>, f: () => Promise<void>) {
    if (ocupado) return; // duplo clique
    setErro(null); setAviso(null); setOcupado(qual);
    try { await f(); } catch (e) { setErro(msg(e)); } finally { setOcupado(null); }
  }
  const salvarRascunho = () => acoes.salvarRascunho({
    fornecedorNome: pedido.fornecedor.nome, pedidoId: pedido.id,
    itens: linhas.map((l) => ({ codigo: l.item.codigo, codigoPai: l.item.codigoPai, quantidade: inteiro(qtd[l.item.codigo]!)!, sugerida: l.item.sugerida })),
    // Data só quando mexida: senão a aprovação calcula hoje + prazo no dia em que aprovar.
    ...(previsto !== dataInicial ? { previstoPara: previsto } : {}),
  });
  const salvar = () => rodar('salvar', async () => {
    if (status === 'rascunho') await salvarRascunho();
    else await acoes.editarPedido({ pedidoId: pedido.id, previstoPara: previsto, itens: linhas.map((l) => ({ codigo: l.item.codigo, quantidade: inteiro(qtd[l.item.codigo]!)! })) });
    toast.success(status === 'rascunho' ? 'Rascunho salvo.' : 'Pedido alterado.');
  });
  const aprovar = () => rodar('aprovar', async () => {
    if (sujo) await salvarRascunho();
    await acoes.aprovar({ pedidoId: pedido.id, ref });
    setAprovadoAgora(true);
    toast.success('Pedido aprovado. Copie o texto para mandar ao fornecedor.');
  });
  const marcarEnviado = () => acoes.marcarEnviado({ pedidoId: pedido.id }).then(() => setEnviadoAgora(true));
  const texto = textoWhatsApp(pedido, data.skus, data.familias);
  const copiar = () => rodar('copiar', async () => {
    try { await navigator.clipboard.writeText(texto); } catch {
      throw new Error('Não foi possível copiar. Selecione o texto abaixo e copie à mão.');
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
    if (status === 'aprovado') await marcarEnviado();
    toast.success('Texto copiado. Cole no WhatsApp do fornecedor.');
  });

  const meta = [
    pedido.salvoEm && status === 'rascunho' ? `salvo ${fmtQuando(pedido.salvoEm)}${pedido.salvoPor ? ` por ${pedido.salvoPor}` : ''}` : null,
    pedido.aprovadoPor ? `aprovado por ${pedido.aprovadoPor}` : null,
    pedido.alteradoEm ? `alterado${pedido.alteradoPor ? ` por ${pedido.alteradoPor}` : ''} em ${fmtQuando(pedido.alteradoEm).slice(0, 5)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <SheetHeader className="gap-1.5 border-b border-border pr-12">
        <SheetTitle className="text-lg">Pedido para {pedido.fornecedor.nome}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={TOM_STATUS[status]}>{ROTULO_STATUS[status]}</StatusPill>
            {meta && <span className="text-caption">{meta}</span>}
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium text-muted-foreground">
              <th className="py-2 text-left font-medium">Item</th>
              {recebeu && <th className="py-2 text-right font-medium">Recebido</th>}
              <th className="py-2 text-right font-medium">Quantidade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((l) => {
              const v = qtd[l.item.codigo] ?? '';
              const n = inteiro(v);
              const editada = l.item.sugerida !== null && n !== l.item.sugerida;
              return (
                <tr key={l.item.codigo}>
                  <td className="py-2 pr-2">
                    <span className="block font-medium">{l.produto}</span>
                    <span className="text-caption">{[l.cor, l.tamanho].filter(Boolean).join(' · ') || 'Único'}</span>
                  </td>
                  {recebeu && <td className="py-2 text-right tabular-nums text-muted-foreground">{fmtInt(l.item.recebida)}</td>}
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center justify-end gap-2">
                      {editavel && editada && <span className="text-caption whitespace-nowrap tabular-nums">sugerida {l.item.sugerida}</span>}
                      {editavel ? (
                        <Input
                          inputMode="numeric" value={v} aria-label={`Quantidade de ${l.rotulo}`} aria-invalid={n === null || undefined}
                          onChange={(e) => setQtd((q) => ({ ...q, [l.item.codigo]: e.target.value.trim() }))}
                          className={cn('h-11 w-20 text-right tabular-nums md:h-9', editada && 'bg-primary/10 motion-safe:transition-colors motion-safe:duration-[600ms]')}
                        />
                      ) : <span className="tabular-nums">{fmtInt(l.item.quantidade)}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {(status === 'aprovado' || status === 'enviado') && (
          <figure className="flex flex-col gap-2">
            <figcaption className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Texto para o fornecedor</figcaption>
            <pre className="rounded-lg border-l-4 border-l-success bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap">{texto}</pre>
          </figure>
        )}
      </div>

      <SheetFooter className="gap-3 border-t border-border">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label htmlFor="pedido-previsto" className="flex flex-col gap-1 text-sm font-medium">
            Entrega prevista
            <Input id="pedido-previsto" type="date" value={previsto} disabled={!editavel} onChange={(e) => setPrevisto(e.target.value)} className="h-11 w-44 md:h-9" />
          </label>
          <span className="text-right tabular-nums">
            <span className="block text-caption">Total</span>
            <span className="font-medium">{fmtInt(total.un)} un. · <ValorPedido valor={total.valor} semCusto={total.semCusto} /></span>
          </span>
        </div>
        {aviso && <p role="status" className="rounded-md bg-info/10 px-3 py-2 text-sm text-info">{aviso}</p>}
        {erro && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {editavel && (
            <Button variant="outline" className="h-11 md:h-9" disabled={!sujo || !valido || !!ocupado} onClick={salvar}>
              {status === 'rascunho' ? 'Salvar rascunho' : 'Salvar alterações'}
            </Button>
          )}
          {status === 'rascunho' && (
            <div className="flex flex-col gap-1 sm:items-end">
              <Button className="h-11 md:h-9" disabled={!podeAprovar || !valido || !!ocupado} aria-describedby={podeAprovar ? undefined : 'dica-aprovar'} onClick={aprovar}>
                <Check className="h-4 w-4" aria-hidden />Aprovar pedido
              </Button>
              {!podeAprovar && <span id="dica-aprovar" className="text-caption">Só administrador aprova o pedido</span>}
            </div>
          )}
          {!podeAprovar && (status === 'aprovado' || status === 'enviado') && (
            <span className="self-center text-caption">Só administrador altera pedido aprovado</span>
          )}
          {status === 'aprovado' && (
            <Button variant="outline" className="h-11 md:h-9" disabled={!!ocupado} onClick={() => rodar('enviar', marcarEnviado)}>
              <Send className="h-4 w-4" aria-hidden />Marcar como enviado
            </Button>
          )}
          {(status === 'aprovado' || status === 'enviado') && (
            <div className="flex flex-col gap-1 sm:items-end">
              <Button className="h-11 md:h-9" disabled={sujo || !!ocupado} onClick={copiar}>
                {copiado ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}Copiar para WhatsApp
              </Button>
              {sujo && <span className="text-caption">Salve as alterações antes de copiar.</span>}
            </div>
          )}
        </div>
      </SheetFooter>
    </>
  );
}

export function SheetPedido({ pedidoId, data, hoje, acoes, onFechar }: {
  pedidoId: string | null; data: RespostaReposicao; hoje: string; acoes: Acoes; onFechar: () => void;
}) {
  const pedido = pedidoId ? [...data.rascunhos, ...data.pedidos].find((p) => p.id === pedidoId) : undefined;
  return (
    <Sheet open={!!pedido} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        {pedido && <Corpo key={pedido.id} pedido={pedido} data={data} hoje={hoje} acoes={acoes} />}
      </SheetContent>
    </Sheet>
  );
}
