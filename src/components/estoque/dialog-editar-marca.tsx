// ADR-0188: "Editar marca" — admin troca a marca do produto (ou volta para a da org).
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { atualizarMarcaFamilia } from '@/lib/marca-produto';
import { QK } from '@/lib/queries';

export function DialogEditarMarca({ open, onOpenChange, codigoPai, nomePai, marcaAtual, marcaOrg }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codigoPai: string;
  nomePai: string;
  marcaAtual: string | null;
  marcaOrg: string;
}) {
  const qc = useQueryClient();
  const [marca, setMarca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMarca(marcaAtual ?? marcaOrg);
    setErro(null);
  }, [open, marcaAtual, marcaOrg]);

  const mutation = useMutation({
    mutationFn: (nova: string | null) => atualizarMarcaFamilia(codigoPai, nova),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: QK.marcaProduto(codigoPai) });
      toast.success(r?.publicado ? 'Marca salva. Enviando ao Mercado Livre…' : 'Marca salva.');
      onOpenChange(false);
    },
    onError: (e: Error) => setErro(e.message),
  });

  const aparada = marca.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm: obrigatorio: ver nota em dialog-cadastro-produto.tsx. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar marca</DialogTitle>
          <DialogDescription>
            {nomePai} · marca atual: {marcaAtual ?? `${marcaOrg} (da org)`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="editar-marca" className="text-sm font-medium">Marca</label>
            <Input id="editar-marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
          </div>
          <Button
            type="button" variant="outline" size="sm" className="self-start"
            disabled={mutation.isPending}
            onClick={() => { setErro(null); mutation.mutate(null); }}
          >
            Usar a marca da org ({marcaOrg})
          </Button>
          {erro && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!aparada || mutation.isPending}
            onClick={() => { setErro(null); mutation.mutate(aparada); }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
