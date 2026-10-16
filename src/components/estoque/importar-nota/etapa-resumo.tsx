// ADR-0181 — etapa 4: pendências (cada uma leva à etapa certa) ou o total por produto.
import { Button } from '@/components/ui/button';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';
import { quantidadeEmEstoque } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import { pendencias, type EstadoImportacao } from './estado';

export function EtapaResumo({ e, produtos, irPara }: {
  e: EstadoImportacao; produtos: ProdutoEstoqueResumo[]; irPara: (etapa: number) => void;
}) {
  const pend = pendencias(e);
  if (pend.length > 0) {
    return (
      <ul className="space-y-2" aria-label="Pendências">
        {pend.map((p) => {
          const d = e.decisoes.find((x) => x.nItem === p.nItem);
          const item = e.itens.find((i) => i.nItem === p.nItem);
          const etapa = !d ? 0 : (!d.codigoPai || !item || !quantidadeEmEstoque(item.qCom, d.fator).ok) ? 1 : 2;
          return (
            <li key={`${p.nItem}-${p.erro}`} className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span>{p.nItem > 0 && `Item ${p.nItem}: `}{p.erro}</span>
              <Button size="sm" variant="outline" onClick={() => irPara(etapa)}>Corrigir</Button>
            </li>
          );
        })}
      </ul>
    );
  }

  const porProduto = new Map<string, { unidades: number; valor: number }>();
  for (const d of e.decisoes) {
    const acc = porProduto.get(d.codigoPai!) ?? { unidades: 0, valor: 0 };
    for (const l of d.distribuicao) { acc.unidades += l.quantidade; acc.valor += l.quantidade * l.custoPrecificacao; }
    porProduto.set(d.codigoPai!, acc);
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border text-sm">
        {[...porProduto].map(([cp, t]) => (
          <li key={cp} className="flex justify-between gap-3 p-2">
            <span>{formatarNomeProduto(produtos.find((p) => p.codigoPai === cp)?.nomePai) || cp}</span>
            <span>{t.unidades} un · {fmtBRL(t.valor)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        A entrada é registrada de uma vez. A nota fica guardada e pode ser desfeita por um administrador enquanto houver saldo.
      </p>
    </div>
  );
}
