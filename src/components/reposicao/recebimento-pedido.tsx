// ADR-0207 §16: recebimento do pedido de compra pela entrada manual e pela nota de compra: o campo
// "De qual pedido?", a pré-seleção da nota pelo CNPJ emitente e a pergunta "o restante ainda vem?".
// A baixa em si é do SQL (mesma transação da entrada); aqui só a escolha e o encerramento do saldo.
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useReposicao } from '@/hooks/useReposicao';
import type { PedidoDTO } from '../../../supabase/functions/_shared/reposicao/tipos';

const RECEBEM = new Set(['aprovado', 'enviado', 'parcial']);
const NENHUM = 'nenhum'; // Radix Select não aceita value vazio.
export const AVISO_SEM_CONFERIR = 'A entrada foi registrada, mas não foi possível conferir o saldo do pedido agora. Veja em Reposição › Pedidos.';

/** Pedidos abertos em que algum dos SKUs ainda tem saldo a receber (não encerrado, recebida < quantidade):
 *  mesma regra de `montarPedidosAbertos`. Não filtra por Não repor: pedido já feito continua recebível. */
export function pedidosQueRecebem(pedidos: PedidoDTO[], codigos: string[]): PedidoDTO[] {
  const set = new Set(codigos);
  return pedidos.filter((p) => RECEBEM.has(p.status) && itensComSaldo(p).some((i) => set.has(i.codigo)));
}

/** Nota: fora os pedidos de fornecedor com OUTRO CNPJ (a nota de B nunca baixa o pedido de A). Fornecedor sem
 *  CNPJ fica na lista: escolher o pedido dele pede confirmação antes de gravar o CNPJ do emitente nele. */
export function pedidosDaNota(opcoes: PedidoDTO[], emitenteCnpj: string): PedidoDTO[] {
  const cnpj = emitenteCnpj.replace(/\D/g, '');
  return opcoes.filter((p) => !p.fornecedor.cnpj || p.fornecedor.cnpj === cnpj);
}

/** Nota: o pedido aberto do fornecedor com o CNPJ do emitente, só quando há exatamente um. */
export function preSelecaoNota(opcoes: PedidoDTO[], emitenteCnpj: string): string | null {
  const cnpj = emitenteCnpj.replace(/\D/g, '');
  const doCnpj = opcoes.filter((p) => p.fornecedor.cnpj === cnpj);
  return doCnpj.length === 1 ? doCnpj[0]!.id : null;
}

export function itensComSaldo(p: PedidoDTO) {
  return p.itens.filter((i) => !i.encerrado && i.recebida < i.quantidade);
}

function rotulo(p: PedidoDTO): string {
  const total = p.itens.reduce((a, i) => a + i.quantidade, 0);
  const falta = itensComSaldo(p).reduce((a, i) => a + i.quantidade - i.recebida, 0);
  const prev = p.previstoPara ? ` · previsto ${p.previstoPara.slice(8, 10)}/${p.previstoPara.slice(5, 7)}` : '';
  return `${p.fornecedor.nome} · faltam ${falta} de ${total}${prev}`;
}

export function CampoPedido({ opcoes, valor, onChange }: {
  opcoes: PedidoDTO[]; valor: string | null; onChange: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="campo-pedido-rotulo" className="text-sm font-medium">De qual pedido?</span>
      <Select value={valor ?? NENHUM} onValueChange={(v) => onChange(v === NENHUM ? null : v)}>
        <SelectTrigger aria-labelledby="campo-pedido-rotulo" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NENHUM}>Nenhum</SelectItem>
          {opcoes.map((p) => <SelectItem key={p.id} value={p.id}>{rotulo(p)}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">Só a escolha de um pedido dá baixa nele.</span>
    </div>
  );
}

/** "Chegaram X de Y do pedido <fornecedor>. O restante ainda vem?" → Sim fecha; Não lista e encerra (reversível). */
export function DialogSaldoPedido({ pedido, onFechar, encerrarSaldo }: {
  pedido: PedidoDTO | null; onFechar: () => void;
  encerrarSaldo: (p: { pedidoId: string; codigos: string[] }) => Promise<unknown>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  if (!pedido) return null;
  const chegaram = pedido.itens.reduce((a, i) => a + i.recebida, 0);
  const total = pedido.itens.reduce((a, i) => a + i.quantidade, 0);
  const itens = itensComSaldo(pedido);

  function fechar() { setConfirmando(false); onFechar(); }
  async function encerrar() {
    setEnviando(true);
    try {
      await encerrarSaldo({ pedidoId: pedido!.id, codigos: itens.map((i) => i.codigo) });
      toast.success('Saldo encerrado. Dá para reabrir no pedido.');
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível encerrar o saldo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) fechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirmando ? 'Encerrar saldo' : 'Recebimento parcial'}</DialogTitle>
          <DialogDescription>
            {confirmando
              ? 'Estes itens deixam de ser esperados. Dá para reabrir o saldo depois.'
              : `Chegaram ${chegaram} de ${total} do pedido ${pedido.fornecedor.nome}. O restante ainda vem?`}
          </DialogDescription>
        </DialogHeader>
        {confirmando && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm" aria-label="Itens que serão encerrados">
            {itens.map((i) => (
              <li key={i.codigo} className="flex justify-between gap-3 px-3 py-2">
                <span className="font-mono">{i.codigo}</span>
                <span className="tabular-nums text-muted-foreground">faltam {i.quantidade - i.recebida}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          {confirmando ? (
            <>
              <Button variant="outline" onClick={() => setConfirmando(false)} disabled={enviando}>Voltar</Button>
              <Button onClick={encerrar} disabled={enviando}>{enviando ? 'Encerrando…' : 'Encerrar saldo'}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setConfirmando(true)}>Não</Button>
              <Button onClick={fechar}>Sim, ainda vem</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Peças comuns aos diálogos de entrada. Só busca com o módulo `reposicao` e o diálogo aberto: org sem o módulo
 * vê o diálogo como sempre (sem campo, sem consulta). `aposEntrada` relê o pedido do servidor (a entrada não
 * devolve o estado do pedido) e abre a pergunta se sobrou saldo. O estado da pergunta vive aqui, fora do reset
 * do diálogo que fecha.
 */
export function useRecebimentoPedido(aberto: boolean) {
  const { data: modulos } = useModulosHabilitados();
  const habilitado = modulos?.includes('reposicao') === true;
  const rep = useReposicao({ enabled: aberto && habilitado });
  const [saldo, setSaldo] = useState<PedidoDTO | null>(null);

  // Só pergunta com o pedido relido do servidor: refetch com erro devolve o `data` ANTIGO (cache), e o
  // "Chegaram X de Y" sairia com números de antes da entrada.
  async function aposEntrada(pedidoId: string) {
    let p: PedidoDTO | undefined;
    try {
      const r = await rep.refetch();
      if (r.isError || r.error) throw r.error;
      p = r.data?.pedidos.find((x) => x.id === pedidoId);
    } catch {
      p = undefined;
    }
    if (!p) { toast.warning(AVISO_SEM_CONFERIR); return; }
    if (itensComSaldo(p).length > 0) setSaldo(p);
  }

  return {
    pedidos: habilitado ? rep.data?.pedidos ?? [] : [],
    aposEntrada,
    dialogoSaldo: <DialogSaldoPedido pedido={saldo} onFechar={() => setSaldo(null)} encerrarSaldo={rep.encerrarSaldo} />,
  };
}
