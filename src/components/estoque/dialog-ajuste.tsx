// E6b (ADR-0110): ajuste/zeragem de saldo. Como a entrada, a escrita vai pela edge
// (`ajustar-estoque`) — a tela nunca toca `variacoes.estoque`, bloqueado por trigger.
// Só REDUZ: aumentar continua sendo Entrada, que exige custo (ADR-0055).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK } from '@/lib/queries';
import { ajustarEstoque, type ProdutoComSaldo } from '@/lib/produtos-saldo';

function rotuloVariacao(v: { codigo: string; cor: string | null; nome: string | null }): string {
  const complemento = v.cor ?? v.nome;
  return complemento ? `${v.codigo} · ${complemento}` : v.codigo;
}

export function DialogAjuste({ produto, aberto, onFechar }: {
  produto: ProdutoComSaldo | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [observacao, setObservacao] = useState('');
  // O `ref` nasce ao ABRIR e só troca no próximo open: duplo clique e retry de rede reusam a
  // mesma referência, e a 2ª aplicação vira no-op na unique do ledger.
  const ref = useRef<string>('');

  useEffect(() => {
    if (!aberto || !produto) return;
    ref.current = crypto.randomUUID();
    setValores(Object.fromEntries(produto.variacoes.map((v) => [v.codigo, String(v.estoque)])));
    setObservacao('');
  }, [aberto, produto]);

  const variacoes = produto?.variacoes ?? [];

  const linhas = useMemo(() => variacoes.map((v) => {
    const bruto = valores[v.codigo] ?? String(v.estoque);
    const novo = bruto.trim() === '' ? null : Number(bruto);
    const invalido = novo === null || !Number.isInteger(novo) || novo < 0;
    // Aumento é caminho da Entrada. Barrar aqui evita uma ida à edge só para tomar 400.
    const aumenta = !invalido && novo > v.estoque;
    return { v, bruto, novo, invalido, aumenta, mudou: !invalido && !aumenta && novo !== v.estoque };
  }), [variacoes, valores]);

  const comAumento = linhas.some((l) => l.aumenta);
  const comInvalido = linhas.some((l) => l.invalido);
  const mudadas = linhas.filter((l) => l.mudou);
  const totalRetirado = mudadas.reduce((s, l) => s + (l.v.estoque - (l.novo as number)), 0);
  const podeSalvar = mudadas.length > 0 && !comAumento && !comInvalido;

  const mutation = useMutation({
    mutationFn: () => ajustarEstoque({
      ajustes: mudadas.map((l) => ({ codigo: l.v.codigo, novoSaldo: l.novo as number })),
      observacao: observacao.trim() || null,
      ref: ref.current,
    }),
    onSuccess: (r) => {
      const falhos = r.resultados.filter((i) => i.erro);
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      if (produto) {
        qc.invalidateQueries({ queryKey: QK.variacoesEstoque(produto.codigoPai) });
        qc.invalidateQueries({ queryKey: QK.movimentosEstoque(produto.codigoPai) });
      }
      // Item com erro mantém o diálogo aberto: o operador precisa ver o que NÃO entrou antes
      // de assumir que o produto está zerado.
      if (falhos.length > 0) {
        toast.error(`Não foi possível ajustar: ${falhos.map((i) => `${i.codigo} (${i.erro})`).join('; ')}`);
        return;
      }
      // pushOk=false não é sucesso limpo: o saldo caiu aqui mas o anúncio segue vendendo lá.
      if (!r.pushOk) {
        toast.warning('Saldo ajustado. A sincronização com os marketplaces falhou e será refeita automaticamente em até 24h.');
      } else {
        toast.success('✓ Salvo');
      }
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function zerarTudo() {
    setValores(Object.fromEntries(variacoes.map((v) => [v.codigo, '0'])));
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* sm: obrigatorio: ver nota em dialog-cadastro-produto.tsx. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar estoque</DialogTitle>
          <DialogDescription>
            {produto?.nomePai}. Reduz ou zera o saldo e propaga para todos os marketplaces em que
            o produto está publicado. Para aumentar, use Entrada de mercadoria.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {variacoes.length > 1 && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={zerarTudo}>Zerar tudo</Button>
            </div>
          )}

          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {linhas.map(({ v, bruto, invalido, aumenta }) => (
              <div key={v.codigo} className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{rotuloVariacao(v)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">saldo {v.estoque}</span>
                </div>
                <Input
                  aria-label={`Novo saldo de ${v.codigo}`}
                  type="number" min={0} max={v.estoque} step={1} inputMode="numeric"
                  className="w-24 shrink-0"
                  value={bruto}
                  onChange={(e) => setValores((s) => ({ ...s, [v.codigo]: e.target.value }))}
                />
                <Button
                  type="button" variant="ghost" size="sm" className="shrink-0"
                  onClick={() => setValores((s) => ({ ...s, [v.codigo]: '0' }))}
                >
                  Zerar
                </Button>
                {(invalido || aumenta) && (
                  <span className="sr-only">valor inválido</span>
                )}
              </div>
            ))}
          </div>

          {comAumento && (
            <p className="text-xs text-destructive">
              O ajuste só reduz saldo. Para aumentar, use Entrada de mercadoria.
            </p>
          )}
          {comInvalido && !comAumento && (
            <p className="text-xs text-destructive">Informe um número inteiro maior ou igual a zero.</p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ajuste-obs" className="text-sm font-medium">Observação (opcional)</label>
            <Input
              id="ajuste-obs" placeholder="Venda no balcão, perda, acerto de inventário…"
              value={observacao} onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          {totalRetirado > 0 && (
            <p className="text-sm text-muted-foreground">
              Sai do saldo: <span className="font-medium tabular-nums text-foreground">−{totalRetirado}</span>
              {' '}em {mudadas.length} {mudadas.length === 1 ? 'variação' : 'variações'}.
            </p>
          )}

          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Um pedido cancelado depois disso repõe o saldo e a cor pode voltar a vender no canal.
            Para tirar de venda de vez, use Pausar.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!podeSalvar || mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Confirmar ajuste'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
