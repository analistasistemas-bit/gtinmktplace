// ADR-0113: exclusão de produto do módulo Estoque. Só produto NÃO publicado — a edge recusa o
// resto com 409, porque apagar família com anúncio corta o vínculo de UPDATE (ADR-0019).
// Saldo > 0 não bloqueia (produto de teste nasce com entrada): o freio é digitar o código.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { excluirProduto } from '@/lib/excluir';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

export function DialogExcluirProduto({ produto, aberto, onFechar }: {
  produto: ProdutoEstoqueResumo | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [confirmacao, setConfirmacao] = useState('');

  useEffect(() => { if (aberto) setConfirmacao(''); }, [aberto, produto]);

  const codigo = produto?.codigoPai ?? '';
  const confere = confirmacao.trim().toUpperCase() === codigo.toUpperCase() && codigo !== '';

  const mutation = useMutation({
    mutationFn: () => excluirProduto(codigo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['produtos-estoque-resumo'] });
      qc.invalidateQueries({ queryKey: ['skus-estoque-org'] });
      qc.invalidateQueries({ queryKey: ['canais-por-produto'] });
      toast.success('Produto excluído');
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const skus = produto?.qtdSkus ?? 0;
  const saldo = produto?.saldoTotal ?? 0;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* sm: obrigatorio: ver nota em dialog-cadastro-produto.tsx. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Excluir produto</DialogTitle>
          <DialogDescription>
            {produto?.nomePai}. Apaga o cadastro, as fotos e o histórico de movimentos deste
            produto. Não tem desfazer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Código</span>
              <span className="font-mono">{codigo}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">SKUs</span>
              <span className="tabular-nums">{skus}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Saldo em estoque</span>
              <span className="tabular-nums">{saldo}</span>
            </div>
          </div>

          {saldo > 0 && (
            <p className="text-xs text-destructive">
              Este produto ainda tem {saldo} {saldo === 1 ? 'unidade' : 'unidades'} em estoque.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="excluir-confirmacao" className="text-sm font-medium">
              Digite <span className="font-mono">{codigo}</span> para confirmar
            </label>
            <Input
              id="excluir-confirmacao"
              autoComplete="off"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={mutation.isPending}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={!confere || mutation.isPending}
          >
            {mutation.isPending ? 'Excluindo…' : 'Excluir produto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
