// ADR-0181 Plano 2b-2 — contagem física da foto de 31/12: rascunho (salvar) e confirmação (só admin).
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { confirmarInventario, salvarContagem } from '@/lib/pacote-contador/inventario-fonte';
import type { ContagemItem, LeituraInventario } from '@/lib/pacote-contador/tipos-inventario';

interface Props {
  foto: LeituraInventario;
  isAdmin: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Recarrega a foto (versão obsoleta ou depois de confirmar). */
  onRecarregar: () => void;
}

const inteiroValido = (t: string) => /^\d+$/.test(t.trim());

export function DialogContagemInventario({ foto, isAdmin, onOpenChange, onRecarregar }: Props) {
  const { cabecalho: cab, itens } = foto;
  const [contada, setContada] = useState<Record<string, string>>(
    () => Object.fromEntries(itens.map((i) => [i.codigo, i.quantidade_contada == null ? '' : String(i.quantidade_contada)])));
  const [just, setJust] = useState<Record<string, string>>(() => Object.fromEntries(itens.map((i) => [i.codigo, i.justificativa ?? ''])));
  const [versao, setVersao] = useState(cab.versao ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const [resumo, setResumo] = useState(false);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const dm = `${cab.data_base.slice(8, 10)}/${cab.data_base.slice(5, 7)}`;
  // '' = igual ao sistema
  const diverge = (cod: string, sis: number) => contada[cod] !== '' && inteiroValido(contada[cod]) && Number(contada[cod]) !== sis;
  const invalido = itens.some((i) => contada[i.codigo] !== '' && !inteiroValido(contada[i.codigo]));
  const semJustificativa = itens.some((i) => diverge(i.codigo, i.quantidade_sistema) && !just[i.codigo].trim());
  const bloqueado = invalido || semJustificativa || ocupado;

  let faltas = 0, sobras = 0, itensFalta = 0, itensSobra = 0;
  for (const i of itens) {
    if (!diverge(i.codigo, i.quantidade_sistema)) continue;
    const d = Number(contada[i.codigo]) - i.quantidade_sistema;
    if (d < 0) { faltas -= d; itensFalta++; } else { sobras += d; itensSobra++; }
  }

  const corpo = (): ContagemItem[] => itens.map((i) => {
    const c = contada[i.codigo];
    return { codigo: i.codigo, quantidade_contada: c === '' ? null : Number(c), justificativa: just[i.codigo].trim() || null };
  });

  async function executar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await fn(); } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setOcupado(false); }
  }

  const salvar = () => executar(async () => {
    setVersao(await salvarContagem(cab.id!, versao, corpo()));
    toast.success('Contagem salva.');
  });

  async function confirmarETentar(v: number) {
    const push = await confirmarInventario(cab.id!, v);
    if (push === 'pendente') { setPendente(true); return; }
    toast.success('Inventário confirmado.');
    onRecarregar();
    onOpenChange(false);
  }
  const confirmar = () => executar(async () => {
    const v = await salvarContagem(cab.id!, versao, corpo());   // confirma exatamente o que está na tela
    setVersao(v);
    await confirmarETentar(v);
  });
  const tentarDeNovo = () => executar(() => confirmarETentar(versao));

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Contagem do inventário de {dm}</DialogTitle>
            <DialogDescription>
              Foto de {dm} — aguardando contagem. Deixe a contada em branco quando for igual ao sistema; informe a justificativa de cada diferença.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left">
                <tr><th className="p-1">Código</th><th className="p-1">Descrição</th><th className="p-1">Cor / tamanho</th>
                  <th className="p-1 text-right">Sistema</th><th className="p-1">Contada</th><th className="p-1">Justificativa</th></tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.codigo} className="border-t">
                    <td className="p-1 font-mono">{i.codigo}</td>
                    <td className="p-1">{i.descricao ?? ''}</td>
                    <td className="p-1">{[i.cor, i.tamanho].filter(Boolean).join(' / ')}</td>
                    <td className="p-1 text-right">{i.quantidade_sistema}</td>
                    <td className="p-1">
                      <Input aria-label={`Contada ${i.codigo}`} inputMode="numeric" className="h-8 w-24" disabled={!isAdmin}
                        value={contada[i.codigo]} placeholder={String(i.quantidade_sistema)}
                        onChange={(e) => setContada((c) => ({ ...c, [i.codigo]: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <Input aria-label={`Justificativa ${i.codigo}`} className="h-8" disabled={!isAdmin} value={just[i.codigo]}
                        onChange={(e) => setJust((c) => ({ ...c, [i.codigo]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invalido && <p className="text-sm text-destructive">Contada deve ser um número inteiro, zero ou maior.</p>}
          {semJustificativa && <p className="text-sm text-destructive">Justificativa obrigatória quando a contada difere do sistema.</p>}
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}{' '}
              {erro === 'A contagem mudou em outra aba; recarregue.' && <Button variant="outline" size="sm" onClick={onRecarregar}>Recarregar</Button>}
            </p>
          )}
          {pendente && <p className="text-sm">Inventário confirmado, mas a atualização do estoque nos anúncios ficou pendente.</p>}
          {isAdmin && (
            <DialogFooter>
              {pendente
                ? <Button onClick={tentarDeNovo} disabled={ocupado}>Tentar de novo</Button>
                : <>
                  <Button variant="outline" onClick={salvar} disabled={bloqueado}>Salvar rascunho</Button>
                  <Button onClick={() => setResumo(true)} disabled={bloqueado}>Confirmar contagem</Button>
                </>}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={resumo} onOpenChange={setResumo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar o inventário de {dm}?</AlertDialogTitle>
            <AlertDialogDescription>
              Faltas: {itensFalta} {itensFalta === 1 ? 'item' : 'itens'} ({faltas} un.). Sobras: {itensSobra} {itensSobra === 1 ? 'item' : 'itens'} ({sobras} un.).
              {' '}Ao confirmar, o estoque e os anúncios serão atualizados. A contagem não poderá mais ser alterada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Confirmar e atualizar estoque</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
