// ADR-0181 — lista recolhível de notas de compra em /estoque: XML, desfazer, cancelar, reenviar estoque.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useProfile } from '@/hooks/useProfile';
import { QK } from '@/lib/queries';
import {
  desfazerNotaCompra, listarNotasCompra, reenviarEstoqueNota, urlXmlNota, type NotaCompraResumo,
} from '@/lib/notas-compra';

export const podeDesfazer = (n: NotaCompraResumo, isAdmin: boolean): boolean => isAdmin && n.status === 'importada';

const STATUS: Record<NotaCompraResumo['status'], { rotulo: string; tom: StatusTone }> = {
  importada: { rotulo: 'Importada', tom: 'success' },
  desfeita: { rotulo: 'Desfeita', tom: 'neutral' },
  cancelada: { rotulo: 'Cancelada', tom: 'danger' },
};
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const AVISO_PUSH = 'Saldo atualizado, mas o envio do estoque aos canais falhou. Use "Reenviar estoque".';

export function SecaoNotasCompra({ destacarChave }: { destacarChave?: string | null }) {
  const qc = useQueryClient();
  const { isAdmin } = useProfile();
  const [aberta, setAberta] = useState(false);
  const [alvo, setAlvo] = useState<{ nota: NotaCompraResumo; status: 'desfeita' | 'cancelada' } | null>(null);
  const destaqueRef = useRef<HTMLTableRowElement>(null);
  // A página só monta esta seção com o módulo estoque habilitado (senão redireciona).
  const { data: notas = [], isError } = useQuery({ queryKey: QK.notasCompra, queryFn: listarNotasCompra });

  // "Ver nota" do assistente: expande a seção e rola até a linha destacada.
  useEffect(() => { if (destacarChave) setAberta(true); }, [destacarChave]);
  useEffect(() => { if (aberta && destacarChave) destaqueRef.current?.scrollIntoView?.({ block: 'center' }); }, [aberta, destacarChave, notas]);

  const desfazer = useMutation({
    mutationFn: ({ nota, status }: { nota: NotaCompraResumo; status: 'desfeita' | 'cancelada' }) => desfazerNotaCompra(nota.id, status),
    onSuccess: (r) => {
      // Prefixo, não por código: o desfazer mexe em poucos produtos e as listas são baratas de refazer.
      void qc.invalidateQueries({ queryKey: QK.notasCompra });
      void qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      void qc.invalidateQueries({ queryKey: ['variacoes-estoque'] });
      if (r.pushOk) toast.success(r.jaEstava ? 'Nota já estava desfeita.' : 'Nota desfeita e saldo ajustado.');
      else toast.warning(AVISO_PUSH);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setAlvo(null),
  });

  const reenviar = useMutation({
    mutationFn: (n: NotaCompraResumo) => reenviarEstoqueNota(n.chave),
    onSuccess: (r) => (r.pushOk ? toast.success('Estoque reenviado aos canais.') : toast.warning('O envio ainda falhou. Tente novamente em instantes.')),
    onError: (e: Error) => toast.error(e.message),
  });

  async function baixarXml(n: NotaCompraResumo) {
    try { window.open(await urlXmlNota(n.xmlPath), '_blank', 'noopener'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível baixar o XML.'); }
  }

  if (!isError && notas.length === 0) return null;
  const Seta = aberta ? ChevronDown : ChevronRight;

  return (
    <section className="mt-6">
      <button type="button" className="flex items-center gap-1 text-sm font-medium" aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
        <Seta className="h-4 w-4" />Notas de compra ({notas.length})
      </button>
      {aberta && (isError ? (
        <p className="mt-2 text-sm text-muted-foreground">Não foi possível carregar as notas.</p>
      ) : (
        <Table className="mt-2">
          <TableHeader>
            <TableRow>
              <TableHead>Emissão</TableHead><TableHead>Fornecedor</TableHead><TableHead>Nº</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {notas.map((n) => (
              <TableRow key={n.id} ref={n.chave === destacarChave ? destaqueRef : undefined}
                className={n.chave === destacarChave ? 'bg-warning/10' : undefined}>
                <TableCell>{data(n.emitidaEm)}</TableCell>
                <TableCell>{n.emitenteNome}</TableCell>
                <TableCell>{n.numero}</TableCell>
                <TableCell className="text-right">{brl(n.valorTotal)}</TableCell>
                <TableCell className="space-x-1">
                  <StatusPill tone={STATUS[n.status].tom}>{STATUS[n.status].rotulo}</StatusPill>
                  {!n.assinada && <StatusPill tone="warning" title="XML sem assinatura digital">sem assinatura</StatusPill>}
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="sm" variant="outline" onClick={() => void baixarXml(n)}>Baixar XML</Button>
                  <Button size="sm" variant="outline" disabled={reenviar.isPending} onClick={() => reenviar.mutate(n)}>Reenviar estoque</Button>
                  {podeDesfazer(n, isAdmin) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setAlvo({ nota: n, status: 'desfeita' })}>Desfazer</Button>
                      <Button size="sm" variant="outline" onClick={() => setAlvo({ nota: n, status: 'cancelada' })}>Marcar como cancelada</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ))}

      <AlertDialog open={!!alvo} onOpenChange={(o) => { if (!o && !desfazer.isPending) setAlvo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alvo?.status === 'cancelada' ? 'Marcar nota como cancelada?' : 'Desfazer nota de compra?'}</AlertDialogTitle>
            <AlertDialogDescription>
              O saldo de estoque lançado pela nota {alvo?.nota.numero} será reduzido na mesma quantidade da entrada.
              Se algum SKU não tiver saldo suficiente, a operação é recusada e a mensagem lista os SKUs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desfazer.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={desfazer.isPending} onClick={(ev) => { ev.preventDefault(); if (alvo) desfazer.mutate(alvo); }}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
