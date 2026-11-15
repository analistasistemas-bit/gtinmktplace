// Kit Virtual: "Você recebe vendendo avulso" por componente, para o operador comparar com o líquido do
// kit. Tarifa oficial do tipo do anúncio de cada componente (nada presumido, ADR-0107).
import { useQueries } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { DetalheRecebe } from '@/components/promocoes/detalhe-recebe';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { fmtBRL } from '@/lib/formato';
import { aliquotaDoKit, resumoDaTarifa } from '@/lib/kit-variacao-simulacao';
import { recebeAvulso, somaRecebeAvulso, type EstadoRecebeAvulso } from '@/lib/kit-virtual-recebe';
import type { ComponenteSelecionadoKitVirtual } from '@/lib/kit-virtual';
import { calcularTarifaML } from '@/lib/tarifa';

const medidaOk = (x: number | null | undefined) => x != null && x > 0;
const AVISO: Partial<Record<EstadoRecebeAvulso, string>> = {
  indisponivel: 'indisponível', sem_listing_type: 'tipo do anúncio desconhecido', sem_aliquota: 'alíquota não confirmada',
};

export function RecebeAvulsoKitVirtual({ componentes, liquidoKit }: {
  componentes: ComponenteSelecionadoKitVirtual[];
  /** Líquido do kit no preview atual; null quando a margem do kit não está pronta. */
  liquidoKit: number | null;
}) {
  const aliquotasQ = useAliquotas();
  const linhas = componentes.map(({ candidato: c, quantidade, precoAtualML }) => {
    const aliquotaPct = aliquotaDoKit(c.origem, aliquotasQ.data);
    const dim = c.medidas;
    // Sem medidas válidas o frete não existe: não cota (a tarifa devolveria frete 0 como se fosse real).
    const cotavel = !!c.categoriaMlId && precoAtualML > 0 && dim != null
      && [dim.alturaCm, dim.larguraCm, dim.comprimentoCm, dim.pesoGramas].every(medidaOk);
    const tipoOk = c.listingTypeId === 'gold_special' || c.listingTypeId === 'gold_pro';
    return { c, quantidade, preco: precoAtualML, aliquotaPct, dim, cotavel, tipoOk };
  });

  const qs = useQueries({
    queries: linhas.map(({ c, preco, aliquotaPct, dim, cotavel, tipoOk }) => ({
      queryKey: ['tarifa', c.userProductId, c.categoriaMlId, preco, dim?.alturaCm, dim?.larguraCm, dim?.comprimentoCm, dim?.pesoGramas, aliquotaPct ?? 0],
      queryFn: () => calcularTarifaML(preco, c.categoriaMlId as string, dim, aliquotaPct as number),
      enabled: cotavel && tipoOk && aliquotaPct != null,
      staleTime: 6 * 60 * 60 * 1000,
      retry: false,
    })),
  });

  const itens = linhas.map((l, i) => {
    const q = qs[i];
    const tarifa = !l.cotavel || q.isError ? null : q.isSuccess ? q.data : undefined;
    const r = recebeAvulso({ tarifa, listingTypeId: l.c.listingTypeId, aliquotaPct: l.aliquotaPct, custo: l.c.custo, preco: l.preco });
    const resumo = r.estado === 'ok' && tarifa && l.c.custo != null && l.aliquotaPct != null
      ? resumoDaTarifa(tarifa, l.c.listingTypeId as 'gold_special' | 'gold_pro', l.preco, l.c.custo, '', l.aliquotaPct) : null;
    return { ...l, r, resumo };
  });
  const separado = somaRecebeAvulso(itens.map((i) => ({ recebe: i.r.recebe, quantidade: i.quantidade })));

  return (
    <section aria-label="Você recebe vendendo avulso" className="flex flex-col gap-2 rounded-md border p-2 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="size-3.5" aria-hidden /> Você recebe vendendo avulso
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-medium">Produto</th><th className="font-medium">Preço</th><th className="font-medium">Recebe</th>
            <th className="font-medium">Lucro</th><th className="font-medium">Margem %</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.c.userProductId} className="align-top">
              <td className="pr-2">
                {i.c.title} <span className="text-muted-foreground">× {i.quantidade}</span>
                {i.resumo && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">detalhe</summary>
                    <DetalheRecebe r={i.resumo} preco={i.preco} original={null} listingType={i.c.listingTypeId} variasCores={false} rotuloPreco="preço avulso" />
                  </details>
                )}
              </td>
              <td className="pr-2">{fmtBRL(i.preco)}</td>
              {i.r.estado === 'ok' ? (
                <>
                  <td className="pr-2 font-medium">
                    {fmtBRL(i.r.recebe!)}
                    {i.c.custo == null && <span className="block font-normal text-muted-foreground">custo não cadastrado</span>}
                  </td>
                  <td className="pr-2">{i.r.lucro == null ? '—' : fmtBRL(i.r.lucro)}</td>
                  <td>{i.r.margemPct == null ? '—' : `${i.r.margemPct.toLocaleString('pt-BR')}%`}</td>
                </>
              ) : (
                <td colSpan={3} className="text-muted-foreground">
                  {i.r.estado === 'calculando' ? 'calculando…' : AVISO[i.r.estado]}
                  {i.r.estado === 'indisponivel' && !i.cotavel && ' (frete: faltam medidas ou categoria)'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {separado != null && liquidoKit != null && (
        <p className="text-sm font-semibold">{`Separado (× qtd): ${fmtBRL(separado)} · No kit: ${fmtBRL(liquidoKit)}`}</p>
      )}
      <p className="text-[11px] text-muted-foreground">O frete do kit é estimativa (0): o líquido do kit pode cair no anúncio real.</p>
    </section>
  );
}
