import { Skeleton } from '@/components/ui/skeleton';
import { fmtBRL } from '@/lib/formato';
import { useTabelaFreteML, isTabelaFrete } from '@/hooks/useTabelaFreteML';

function fmtCelula(valor: number): string {
  if (valor <= 0) return '—';
  return fmtBRL(valor);
}

interface Props {
  categoriaMlId: string;
  categoriasMistas?: boolean;
  analiseConcluida: boolean;
}

export function TabelaFreteViabilidade({ categoriaMlId, categoriasMistas, analiseConcluida }: Props) {
  const { data, isLoading, isError } = useTabelaFreteML(categoriaMlId, analiseConcluida);

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-4 shadow-sm">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-32 w-full" />
        <p className="text-xs text-muted-foreground">Consultando frete na API do ML (até 28 combinações)…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Não foi possível carregar a tabela de frete desta categoria.
      </div>
    );
  }

  if (data && 'indisponivel' in data && data.indisponivel) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        <p className="font-medium">Tabela de frete indisponível</p>
        <p>Sua conta do Mercado Livre ainda não aderiu ao Mercado Envios — ative e refaça a análise.</p>
      </div>
    );
  }

  if (data && 'erro' in data && data.erro) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Não foi possível consultar a tabela de frete no Mercado Livre. Tente novamente em instantes.
      </div>
    );
  }

  if (!data || !isTabelaFrete(data)) return null;

  const { faixasPreco, faixasPeso, celulas } = data;

  return (
    <div className="rounded-lg border border-border shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-foreground">Frete que o vendedor absorve (Mercado Envios)</p>
        <p className="text-xs text-muted-foreground">
          Estimativa por faixa de preço e peso — valores desta conta ML
        </p>
      </div>
      {categoriasMistas && (
        <p className="border-b border-border px-4 py-2 text-xs text-warning">
          Os produtos analisados têm categorias ML diferentes — tabela exibida para {categoriaMlId}.
        </p>
      )}
      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[480px] border-collapse text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Peso</th>
              {faixasPreco.map((f) => (
                <th key={f.label} className="px-2 py-1.5 font-medium text-center">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {faixasPeso.map((peso, i) => (
              <tr key={peso.label} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-1.5 font-medium text-foreground">{peso.label}</td>
                {celulas[i]?.map((valor, j) => (
                  <td key={faixasPreco[j]?.label ?? j} className="px-2 py-1.5 text-center tabular-nums">
                    {fmtCelula(valor)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Valores desta conta ML · categoria {categoriaMlId} · estimativa nacional.
        {' '}— = frete pago pelo comprador nesta faixa.
      </p>
    </div>
  );
}
