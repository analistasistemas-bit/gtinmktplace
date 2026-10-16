// ADR-0181 — etapa 3: distribuição das unidades de cada item pelos SKUs do produto.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QK } from '@/lib/queries';
import { fetchSkusEstoqueOrg, fetchVariacoesProduto } from '@/lib/produtos-saldo';
import { filtrarOpcoesSku, montarOpcoesSku } from '@/lib/dialog-entrada-busca';
import { custoAquisicaoUnit, quantidadeEmEstoque } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import {
  definirDistribuicao, semearDistribuicao, type DecisaoItem, type EstadoImportacao, type LinhaEstado,
} from './estado';

type Atualizar = (f: (s: EstadoImportacao) => EstadoImportacao) => void;
interface Rotulo { cor: string | null; tamanho: string | null; estoque: number }

function ItemDistribuicao({ e, atualizar, d, onVariacaoFaltante }: {
  e: EstadoImportacao; atualizar: Atualizar; d: DecisaoItem;
  onVariacaoFaltante?: (nItem: number, codigoPai: string) => void;
}) {
  const item = e.itens.find((i) => i.nItem === d.nItem)!;
  const q = quantidadeEmEstoque(item.qCom, d.fator);
  const custoDef = Math.round(custoAquisicaoUnit(item, d.fator) * 100) / 100;
  const { data: skus, isLoading, isError: erroSkus, error: erroSkusMsg } = useQuery({
    queryKey: QK.variacoesEstoque(d.codigoPai!),
    queryFn: () => fetchVariacoesProduto(d.codigoPai!),
    staleTime: 30_000,
  });
  const [linhas, setLinhas] = useState<LinhaEstado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');
  // Também carrega quando há SKU de outro produto já salvo: é de lá que vêm cor/tamanho/saldo dele.
  const temExtras = d.distribuicao.some((l) => l.codigoPai);
  const { data: skusOrg = [], isError: erroOrg, error: erroOrgMsg } = useQuery({
    queryKey: ['skus-estoque-org'], queryFn: fetchSkusEstoqueOrg, enabled: buscando || temExtras, staleTime: 30_000,
  });

  // Monta o buffer local uma vez, semeado com o que já está salvo (voltar/Corrigir não regrava nada).
  useEffect(() => {
    if (linhas || isLoading || !skus) return;
    setLinhas(semearDistribuicao(skus, d.distribuicao, q.ok ? q.quantidade : 0, custoDef));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, isLoading]);

  // Estado inicial já com as linhas preenchidas (1 SKU) — sem isso o Resumo acusaria pendência sem o operador tocar.
  useEffect(() => {
    if (linhas) atualizar((s) => definirDistribuicao(s, d.nItem, linhas.filter((l) => l.quantidade > 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas]);

  const opcoes = useMemo(
    () => filtrarOpcoesSku(montarOpcoesSku(skusOrg).filter((o) => !linhas?.some((l) => l.codigo === o.codigo)), busca, 8),
    [skusOrg, busca, linhas],
  );

  if (erroSkus) {
    return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      Não foi possível carregar os SKUs do item {item.nItem}: {erroSkusMsg instanceof Error ? erroSkusMsg.message : 'erro desconhecido'}
    </p>;
  }
  if (!linhas) return <p className="text-sm text-muted-foreground">Carregando SKUs…</p>;

  const rotuloDe = (codigo: string): Rotulo | undefined => {
    const doProduto = skus?.find((x) => x.codigo === codigo);
    if (doProduto) return { cor: doProduto.cor, tamanho: doProduto.tamanho, estoque: doProduto.estoque };
    const o = skusOrg.find((x) => x.codigo === codigo);
    return o ? { cor: o.cor, tamanho: o.tamanho, estoque: o.estoque } : undefined;
  };

  const alterar = (codigo: string, parte: Partial<LinhaEstado>) =>
    setLinhas(linhas.map((l) => (l.codigo === codigo ? { ...l, ...parte } : l)));
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const soma = linhas.reduce((s, l) => s + (l.quantidade || 0), 0);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{item.nItem}. {item.xProd}</p>
        <p className={`text-sm ${q.ok && soma === q.quantidade ? 'text-success' : 'text-muted-foreground'}`}>
          {soma} de {q.ok ? q.quantidade : '?'} unidades
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead><TableHead>Cor</TableHead><TableHead>Tamanho</TableHead>
            <TableHead className="text-right">Saldo</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo (R$)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => {
            const r = rotuloDe(l.codigo);
            return (
              <TableRow key={l.codigo}>
                <TableCell>{l.codigo}</TableCell>
                <TableCell>{r?.cor ?? '—'}</TableCell>
                <TableCell>{r?.tamanho ?? '—'}</TableCell>
                <TableCell className="text-right">{r?.estoque ?? '—'}</TableCell>
                <TableCell>
                  <Input
                    type="number" min={0} step={1} className="w-24" aria-label={`Quantidade ${l.codigo}`}
                    value={l.quantidade} disabled={l.travada}
                    onChange={(ev) => alterar(l.codigo, { quantidade: Math.round(num(ev.target.value)) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" min={0} step={0.01} className="w-28" aria-label={`Custo ${l.codigo}`}
                    value={l.custoPrecificacao}
                    onChange={(ev) => alterar(l.codigo, { custoPrecificacao: num(ev.target.value) })}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setBuscando(!buscando)}>+ SKU de outro produto</Button>
        <Button
          size="sm" variant="outline"
          onClick={() => setLinhas(linhas.map((l) => ({ ...l, custoPrecificacao: linhas[0]?.custoPrecificacao ?? custoDef })))}
        >
          Repetir custo em todos
        </Button>
        {/* ponytail: Task 11 implementa o fluxo; aqui só o gancho. */}
        <Button size="sm" variant="link" disabled={!onVariacaoFaltante} onClick={() => onVariacaoFaltante?.(d.nItem, d.codigoPai!)}>
          Falta um tamanho/cor?
        </Button>
      </div>
      {buscando && (
        <div className="space-y-1">
          <Input placeholder="Buscar SKU em qualquer produto" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
          <ul className="max-h-40 overflow-auto rounded-md border text-sm">
            {erroOrg && <li role="alert" className="p-2 text-destructive">
              Não foi possível carregar os SKUs: {erroOrgMsg instanceof Error ? erroOrgMsg.message : 'erro desconhecido'}
            </li>}
            {!erroOrg && opcoes.length === 0 && <li className="p-2 text-muted-foreground">Nenhum SKU encontrado.</li>}
            {opcoes.map((o) => (
              <li key={o.codigo}>
                <button
                  type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => {
                    setLinhas([...linhas, { codigo: o.codigo, quantidade: 0, custoPrecificacao: custoDef, codigoPai: o.codigoPai }]);
                    setBuscando(false); setBusca('');
                  }}
                >
                  {o.rotulo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EtapaDistribuicao({ e, atualizar, onVariacaoFaltante }: {
  e: EstadoImportacao; atualizar: Atualizar;
  /** Task 11 pluga aqui "Falta um tamanho/cor?". */
  onVariacaoFaltante?: (nItem: number, codigoPai: string) => void;
}) {
  return (
    <div className="space-y-3">
      {e.decisoes.map((d) => d.codigoPai ? (
        <ItemDistribuicao
          key={`${d.nItem}-${d.codigoPai}-${d.fator}`} e={e} atualizar={atualizar} d={d} onVariacaoFaltante={onVariacaoFaltante}
        />
      ) : (
        <p key={d.nItem} className="rounded-md border p-3 text-sm text-muted-foreground">
          Item {d.nItem}: escolha o produto na etapa anterior.
        </p>
      ))}
    </div>
  );
}
