// E6b (ADR-0094, D-9): entrada de mercadoria. A escrita vai pela edge `entrada-estoque`
// (service_role) — a tela nunca toca `variacoes.estoque`, que é bloqueado por trigger.
//
// Dois modos, pela porta de entrada e não pela contagem de SKUs:
//  · aberto pelo card do produto (`codigoPaiInicial`) → lista as cores DAQUELE produto, uma
//    quantidade por cor, tudo numa submissão. Espelha o diálogo de Ajuste.
//  · aberto pelo botão do topo da página → busca por SKU na org, uma cor por vez.
// Relato do Diego (03/09/2026): o modo lista existe porque o picker vinha pré-filtrado pelo
// código PAI e devolvia "Nenhum SKU encontrado" — `skus_estoque_org` é truncada em ~1000 linhas
// pelo PostgREST e a org tem 8.491 SKUs, então o produto simplesmente não estava na lista.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { QK } from '@/lib/queries';
import {
  fetchSkusEstoqueOrg, fetchVariacoesProduto, registrarEntrada, registrarEntradaLote,
} from '@/lib/produtos-saldo';
import { parseNumeroPtBr } from '@/lib/formato';
import type { MarcadorSyncMl } from '@/lib/estoque-sync-ml';

interface OpcaoSku {
  codigo: string;
  rotulo: string;
  codigoPai: string;
  estoque: number;
}

function rotuloVariacao(v: { codigo: string; cor: string | null; nome: string | null }): string {
  const complemento = v.cor ?? v.nome;
  return complemento ? `${v.codigo} · ${complemento}` : v.codigo;
}

export function DialogEntrada({ aberto, onFechar, skuInicial, codigoPaiInicial }: {
  aberto: boolean;
  onFechar: () => void;
  skuInicial?: string;
  /** Produto do qual dar entrada. Presente = modo lista (as cores dele, várias de uma vez). */
  codigoPaiInicial?: string;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [codigo, setCodigo] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [custo, setCusto] = useState('');
  const [documento, setDocumento] = useState('');
  const [ref, setRef] = useState(() => crypto.randomUUID());

  const modoLista = !!codigoPaiInicial;

  const { data: skus = [] } = useQuery({
    queryKey: ['skus-estoque-org'],
    queryFn: fetchSkusEstoqueOrg,
    enabled: aberto && !modoLista,
    staleTime: 30_000,
  });

  // RPC por produto: não sofre o truncamento da lista da org inteira.
  const { data: variacoes = [], isLoading: variacoesLoading } = useQuery({
    queryKey: QK.variacoesEstoque(codigoPaiInicial ?? ''),
    queryFn: () => fetchVariacoesProduto(codigoPaiInicial!),
    enabled: aberto && modoLista,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!aberto) return;
    setRef(crypto.randomUUID());
    setBusca('');
    setCodigo(skuInicial ?? '');
    setQuantidade('');
    setQuantidades({});
    setCusto('');
    setDocumento('');
  }, [aberto, skuInicial, codigoPaiInicial]);

  const opcoes = useMemo<OpcaoSku[]>(() => {
    const todas = skus.map((s) => ({
      codigo: s.codigo,
      rotulo: `${s.codigo} · ${s.nome}${s.cor ? ` (${s.cor})` : ''}`,
      codigoPai: s.codigoPai,
      estoque: s.estoque,
    }));
    const termo = busca.trim().toLowerCase();
    if (!termo) return todas.slice(0, 50);
    return todas.filter((o) => o.rotulo.toLowerCase().includes(termo)
      || o.codigoPai.toLowerCase().includes(termo)).slice(0, 50);
  }, [skus, busca]);

  const selecionada = useMemo(
    () => skus.find((s) => s.codigo === codigo),
    [skus, codigo],
  );

  const custoNum = parseNumeroPtBr(custo);
  const custoInvalido = custoNum !== null && !(custoNum > 0);

  // Modo lista: só as linhas preenchidas entram. Vazio = "não mexi nesta cor", não zero.
  const linhas = useMemo(() => variacoes.map((v) => {
    const bruto = quantidades[v.codigo] ?? '';
    const preenchida = bruto.trim() !== '';
    const qtd = preenchida ? Number(bruto) : null;
    const invalido = preenchida && (!Number.isInteger(qtd) || (qtd as number) <= 0);
    return { v, bruto, qtd, preenchida, invalido };
  }), [variacoes, quantidades]);
  const aLancar = linhas.filter((l) => l.preenchida && !l.invalido);
  const algumInvalido = linhas.some((l) => l.invalido);

  const qtdNum = Number(quantidade);
  const podeSalvar = custoInvalido ? false : modoLista
    ? aLancar.length > 0 && !algumInvalido
    : !!codigo && Number.isInteger(qtdNum) && qtdNum > 0;

  function invalidarProduto(codigoPai: string) {
    qc.invalidateQueries({ queryKey: QK.variacoesEstoque(codigoPai) });
    qc.invalidateQueries({ queryKey: QK.movimentosEstoque(codigoPai) });
  }

  /** Marca as cores que acabaram de receber entrada: o card mostra "atualizando no ML…" nelas até
   *  o canal devolver o mesmo saldo. Sem isso o operador dá entrada e não tem como saber se o
   *  push chegou — o que levou o Diego a conferir no ML e achar que não tinha funcionado. */
  function marcarAguardandoMl(codigoPai: string, skus: string[]) {
    if (skus.length === 0) return;
    const marcador: MarcadorSyncMl = {
      porSku: Object.fromEntries(skus.map((sku) => [sku, 'aguardando' as const])),
      desde: new Date().toISOString(),
    };
    qc.setQueryData(QK.skusAguardandoMl(codigoPai), marcador);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (modoLista) {
        return {
          lote: await registrarEntradaLote({
            itens: aLancar.map((l) => ({ codigo: l.v.codigo, quantidade: l.qtd as number, custo: custoNum })),
            documento: documento.trim() || null,
            ref,
          }),
        };
      }
      return {
        unico: await registrarEntrada({
          codigo, quantidade: qtdNum, custo: custoNum,
          documento: documento.trim() || null, ref,
        }),
      };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: QK.produtosEstoqueResumo });
      qc.invalidateQueries({ queryKey: ['skus-estoque-org'] });

      if (r.lote) {
        const falhos = r.lote.resultados.filter((i) => i.erro);
        if (codigoPaiInicial) {
          invalidarProduto(codigoPaiInicial);
          marcarAguardandoMl(codigoPaiInicial, r.lote.resultados.filter((i) => !i.erro).map((i) => i.codigo));
        }
        // Item com erro mantém o diálogo aberto: o operador precisa ver o que NÃO entrou antes
        // de assumir que o produto está reposto.
        if (falhos.length > 0) {
          toast.error(`Não foi possível dar entrada: ${falhos.map((i) => `${i.codigo} (${i.erro})`).join('; ')}`);
          return;
        }
        if (!r.lote.pushOk) {
          toast.warning('Saldo atualizado. A sincronização com os marketplaces falhou e será refeita automaticamente em até 24h.');
        } else {
          toast.success(`✓ Entrada registrada em ${r.lote.resultados.length} cor(es).`);
        }
        onFechar();
        return;
      }

      const u = r.unico!;
      if (!u.pushOk) {
        toast.warning('Saldo atualizado. A sincronização com os marketplaces falhou e será refeita automaticamente em até 24h.');
      } else if (u.duplicada) {
        toast.info('Esta entrada já havia sido registrada — nada foi somado duas vezes.');
      } else {
        toast.success(`✓ Entrada registrada. Saldo de ${codigo}: ${u.estoque}`);
      }
      if (selecionada) {
        invalidarProduto(selecionada.codigoPai);
        marcarAguardandoMl(selecionada.codigoPai, [codigo]);
      }
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar entrada de mercadoria</DialogTitle>
          <DialogDescription>
            {modoLista
              ? 'Preencha a quantidade das cores que chegaram. As cores em branco ficam como estão. O novo saldo é propagado para todos os marketplaces em que o produto está publicado.'
              : 'Soma ao saldo do SKU e propaga o novo estoque para todos os marketplaces em que o produto está publicado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {modoLista ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Cores</span>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                {variacoesLoading ? (
                  <p className="p-3 text-sm text-muted-foreground">Carregando cores…</p>
                ) : linhas.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Este produto não tem variações.</p>
                ) : linhas.map((l) => (
                  <div
                    key={l.v.codigo}
                    className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{rotuloVariacao(l.v)}</div>
                      <div className="text-xs text-muted-foreground">
                        saldo <span className="tabular-nums">{l.v.estoque}</span>
                        {l.preenchida && !l.invalido && (
                          <> → <span className="font-medium tabular-nums text-foreground">{l.v.estoque + (l.qtd as number)}</span></>
                        )}
                      </div>
                    </div>
                    <Input
                      aria-label={`Quantidade para ${rotuloVariacao(l.v)}`}
                      type="number" min={1} step={1} inputMode="numeric" placeholder="0"
                      className={`h-8 w-24 shrink-0 text-right ${l.invalido ? 'border-destructive' : ''}`}
                      value={l.bruto}
                      onChange={(e) => setQuantidades((q) => ({ ...q, [l.v.codigo]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              {algumInvalido && (
                <span className="text-xs text-destructive">Quantidade deve ser um inteiro maior que zero.</span>
              )}
            </div>
          ) : (
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
          )}

          <div className="grid grid-cols-2 gap-3">
            {!modoLista && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="entrada-qtd" className="text-sm font-medium">Quantidade</label>
                <Input
                  id="entrada-qtd" type="number" min={1} step={1} inputMode="numeric"
                  value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entrada-custo" className="text-sm font-medium">Custo unitário (opcional)</label>
              <Input
                id="entrada-custo" inputMode="decimal" placeholder="R$"
                value={custo} onChange={(e) => setCusto(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                {modoLista
                  ? 'Aplicado a todas as cores preenchidas. Em branco mantém o custo atual de cada uma.'
                  : 'Em branco mantém o custo atual do SKU.'}
              </span>
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

          {!modoLista && selecionada && (
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
            {mutation.isPending
              ? 'Registrando…'
              : modoLista && aLancar.length > 0
                ? `Registrar entrada (${aLancar.length})`
                : 'Registrar entrada'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
