// Pulse (ADR-0119): adicionar manualmente um produto de catálogo ao radar (link /p/MLBxxxx ou
// GTIN). Item avulso de terceiro é impossível de coletar (403 do ML) — a edge já explica.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK } from '@/lib/queries';
import { adicionarPulseManual } from '@/lib/pulse';

export function DialogAdicionar({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const [entrada, setEntrada] = useState('');

  const mutation = useMutation({
    mutationFn: () => adicionarPulseManual(entrada.trim()),
    onSuccess: () => {
      toast.success('✓ Produto adicionado ao radar');
      qc.invalidateQueries({ queryKey: QK.pulseProdutos });
      setEntrada('');
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar produto ao radar</DialogTitle>
          <DialogDescription>
            Cole o link da página de catálogo do Mercado Livre (…/p/MLBxxxx) ou informe o GTIN.
            Anúncio avulso de terceiro não é acessível pela API do ML.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="https://www.mercadolivre.com.br/p/MLB123456 ou GTIN"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && entrada.trim() && !mutation.isPending) mutation.mutate();
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!entrada.trim() || mutation.isPending}>
            {mutation.isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
