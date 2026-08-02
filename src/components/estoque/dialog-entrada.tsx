// E6b (ADR-0094, D-9): entrada de mercadoria. A escrita vai pela edge `entrada-estoque`
// (service_role) — a tela nunca toca `variacoes.estoque`, que é bloqueado por trigger.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK } from '@/lib/queries';
import { registrarEntrada, type ProdutoComSaldo } from '@/lib/produtos-saldo';

interface OpcaoSku {
  codigo: string;
  rotulo: string;
  codigoPai: string;
  estoque: number;
}

export function DialogEntrada({ produtos, aberto, onFechar, skuInicial, filtroInicial }: {
  produtos: ProdutoComSaldo[];
  aberto: boolean;
  onFechar: () => void;
  skuInicial?: string;
  /** Pré-filtra a lista (usado com o `codigo_pai` quando o produto tem várias variações). */
  filtroInicial?: string;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [codigo, setCodigo] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [custo, setCusto] = useState('');
  const [documento, setDocumento] = useState('');
  // O `ref` nasce ao ABRIR e só troca depois de um sucesso confirmado: duplo clique e retry
  // de rede reusam a mesma referência, e a 2ª aplicação vira no-op na unique do ledger.
  const [ref, setRef] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!aberto) return;
    setRef(crypto.randomUUID());
    setBusca(filtroInicial ?? '');
    setCodigo(skuInicial ?? '');
    setQuantidade('');
    setCusto('');
    setDocumento('');
  }, [aberto, skuInicial, filtroInicial]);

  const opcoes = useMemo<OpcaoSku[]>(() => {
    const todas = produtos.flatMap((p) => p.variacoes.map((v) => ({
      codigo: v.codigo,
      rotulo: `${v.codigo} · ${p.nomePai}${v.cor ? ` (${v.cor})` : v.nome ? ` (${v.nome})` : ''}`,
      codigoPai: p.codigoPai,
      estoque: v.estoque,
    })));
    const termo = busca.trim().toLowerCase();
    if (!termo) return todas.slice(0, 50);
    return todas.filter((o) => o.rotulo.toLowerCase().includes(termo)
      || o.codigoPai.toLowerCase().includes(termo)).slice(0, 50);
  }, [produtos, busca]);

  const selecionada = useMemo(
    () => produtos.flatMap((p) => p.variacoes.map((v) => ({ ...v, codigoPai: p.codigoPai })))
      .find((v) => v.codigo === codigo),
    [produtos, codigo],
  );

  const qtdNum = Number(quantidade);
  const custoNum = custo.trim() === '' ? null : Number(custo.replace(',', '.'));
  const custoInvalido = custoNum !== null && !(custoNum > 0);
  const podeSalvar = !!codigo && Number.isInteger(qtdNum) && qtdNum > 0 && !custoInvalido;

  const mutation = useMutation({
    mutationFn: () => registrarEntrada({
      codigo, quantidade: qtdNum, custo: custoNum,
      documento: documento.trim() || null, ref,
    }),
    onSuccess: (r) => {
      // pushOk=false não é sucesso limpo: o saldo entrou mas os anúncios ficaram defasados,
      // e o operador precisa saber disso antes de achar que já pode vender.
      if (!r.pushOk) {
        toast.warning('Saldo atualizado. A sincronização com os marketplaces falhou e será refeita automaticamente em até 24h.');
      } else if (r.duplicada) {
        toast.info('Esta entrada já havia sido registrada — nada foi somado duas vezes.');
      } else {
        toast.success(`✓ Entrada registrada. Saldo de ${codigo}: ${r.estoque}`);
      }
      qc.invalidateQueries({ queryKey: ['produtos-saldo'] });
      if (selecionada) qc.invalidateQueries({ queryKey: QK.movimentosEstoque(selecionada.codigoPai) });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* sm: obrigatorio: ver nota em dialog-cadastro-produto.tsx. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar entrada de mercadoria</DialogTitle>
          <DialogDescription>
            Soma ao saldo do SKU e propaga o novo estoque para todos os marketplaces em que o
            produto está publicado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="entrada-busca" className="text-sm font-medium">SKU</label>
            <Input
              id="entrada-busca"
              placeholder="Buscar por código ou nome do produto…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="max-h-44 overflow-y-auto rounded-md border">
              {opcoes.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum SKU encontrado.</p>
              ) : opcoes.map((o) => (
                <button
                  key={o.codigo}
                  type="button"
                  onClick={() => setCodigo(o.codigo)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                    o.codigo === codigo ? 'bg-accent font-medium' : ''
                  }`}
                >
                  <span className="truncate">{o.rotulo}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{o.estoque}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entrada-qtd" className="text-sm font-medium">Quantidade</label>
              <Input
                id="entrada-qtd" type="number" min={1} step={1} inputMode="numeric"
                value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entrada-custo" className="text-sm font-medium">Custo unitário (opcional)</label>
              <Input
                id="entrada-custo" inputMode="decimal" placeholder="R$"
                value={custo} onChange={(e) => setCusto(e.target.value)}
              />
              {custoInvalido && (
                <span className="text-xs text-destructive">Custo, quando informado, deve ser maior que zero.</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="entrada-doc" className="text-sm font-medium">Documento (opcional)</label>
            <Input
              id="entrada-doc" placeholder="NF 1234, pedido do fornecedor…"
              value={documento} onChange={(e) => setDocumento(e.target.value)}
            />
          </div>

          {selecionada && (
            <p className="text-sm text-muted-foreground">
              Saldo atual de <span className="font-mono">{selecionada.codigo}</span>:{' '}
              <span className="tabular-nums">{selecionada.estoque}</span>
              {Number.isInteger(qtdNum) && qtdNum > 0 && (
                <> → ficará <span className="font-medium tabular-nums text-foreground">{selecionada.estoque + qtdNum}</span></>
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!podeSalvar || mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar entrada'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
