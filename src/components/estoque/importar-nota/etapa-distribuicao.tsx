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
  definirDistribuicao, linhasIniciais, type DecisaoItem, type EstadoImportacao, type LinhaEstado,
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
  const { data: skus, isLoading } = useQuery({
    queryKey: QK.variacoesEstoque(d.codigoPai!),
    queryFn: () => fetchVariacoesProduto(d.codigoPai!),
    staleTime: 30_000,
  });
  const [linhas, setLinhas] = useState<LinhaEstado[] | null>(null);
  const [rotulos, setRotulos] = useState<Record<string, Rotulo>>({});
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');
  const { data: skusOrg = [] } = useQuery({
    queryKey: ['skus-estoque-org'], queryFn: fetchSkusEstoqueOrg, enabled: buscando, staleTime: 30_000,
  });

  // Monta o buffer local uma vez (zeros ficam aqui; o estado só recebe quantidade > 0).
  useEffect(() => {
    if (linhas || isLoading || !skus) return;
    const travadas = d.distribuicao.filter((l) => l.travada);
    const porCod = new Map(travadas.map((l) => [l.codigo, l]));
    const base = linhasIniciais(skus, q.ok ? q.quantidade : 0, custoDef).map((l) => porCod.get(l.codigo) ?? l);
    const doProduto = new Set(skus.map((s) => s.codigo));
    setLinhas([...base, ...travadas.filter((l) => !doProduto.has(l.codigo))]);
    setRotulos(Object.fromEntries(skus.map((s) => [s.codigo, { cor: s.cor, tamanho: s.tamanho, estoque: s.estoque }])));
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

  if (!linhas) return <p className="text-sm text-muted-foreground">Carregando SKUs…</p>;

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
            const r = rotulos[l.codigo];
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
                    onChange={(ev) => alterar(l.codigo, { quantidade: num(ev.target.value) })}
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
            {opcoes.length === 0 && <li className="p-2 text-muted-foreground">Nenhum SKU encontrado.</li>}
            {opcoes.map((o) => (
              <li key={o.codigo}>
                <button
                  type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => {
                    setRotulos({ ...rotulos, [o.codigo]: { cor: null, tamanho: null, estoque: o.estoque } });
                    setLinhas([...linhas, { codigo: o.codigo, quantidade: 0, custoPrecificacao: custoDef }]);
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
