// ADR-0188: "Editar marca" — admin troca a marca do produto (ou volta para a da org).
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { atualizarMarcaFamilia } from '@/lib/marca-produto';
import { QK } from '@/lib/queries';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

export function DialogEditarMarca({ open, onOpenChange, codigoPai, nomePai, marcaAtual, marcaOrg, carregando, erroLeitura }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codigoPai: string;
  nomePai: string;
  marcaAtual: string | null;
  marcaOrg: string;
  /** Marca vigente ainda sendo lida: bloqueia salvar. */
  carregando: boolean;
  erroLeitura: string | null;
}) {
  const qc = useQueryClient();
  const orgId = useOrgEfetivaId();
  const [marca, setMarca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  // Inicializa UMA vez por abertura, quando a marca vigente chegou (não sobrescreve o que o usuário digitou).
  const inicializado = useRef(false);
  const pronto = !carregando && !erroLeitura;
  useEffect(() => {
    if (!open) { inicializado.current = false; return; }
    if (!pronto || inicializado.current) return;
    inicializado.current = true;
    setMarca(marcaAtual ?? marcaOrg);
    setErro(null);
  }, [open, pronto, marcaAtual, marcaOrg]);

  const mutation = useMutation({
    mutationFn: (nova: string | null) => atualizarMarcaFamilia(codigoPai, nova),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: QK.marcaProduto(orgId, codigoPai) });
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
            <Input id="editar-marca" value={marca} disabled={!pronto} onChange={(e) => setMarca(e.target.value)} />
            {carregando && <p className="text-xs text-muted-foreground">Carregando a marca atual…</p>}
          </div>
          <Button
            type="button" variant="outline" size="sm" className="self-start"
            disabled={!pronto || mutation.isPending}
            onClick={() => { setErro(null); mutation.mutate(null); }}
          >
            Usar a marca da org ({marcaOrg})
          </Button>
          {(erroLeitura || erro) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {erroLeitura ?? erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!pronto || !aparada || mutation.isPending}
            onClick={() => { setErro(null); mutation.mutate(aparada); }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
