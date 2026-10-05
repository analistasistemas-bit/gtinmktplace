import { fmtBRL, fmtBRLSinal, fmtMarkup } from '@/lib/formato';
import type { ContaPainel, FamiliaPainel } from '@/lib/ads-painel';
import { NADA, pct, razao } from '@/lib/ads-apresentacao';

export interface DetalheFamiliaProps {
  familia: FamiliaPainel;
  conta: ContaPainel | null;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  );
}

/** Métricas secundárias de uma família (ADR-0179 §3.5). As ressalvas obrigatórias ficam na linha fechada. */
export function DetalheFamilia({ familia: f, conta }: DetalheFamiliaProps) {
  const naoIdPct = conta && !conta.divergente ? conta.naoIdentificadoPct : null;

  return (
    <div className="space-y-3 text-sm">
      {f.nome && <p className="font-medium break-words">{f.nome}</p>}
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 2xl:grid-cols-4">
        <dl className="space-y-1.5">
          <Linha rotulo="Vendas atribuídas (total / direta)" valor={`${fmtBRL(f.vendasTotais)} / ${fmtBRL(f.vendasDiretas)}`} />
        </dl>
        <dl className="space-y-1.5">
          <Linha rotulo="ROAS (total / direto)" valor={`${razao(f.roas)} / ${razao(f.roasDireto)}`} />
          <Linha rotulo="ACOS (total / direto)" valor={`${pct(f.acos)} / ${pct(f.acosDireto)}`} />
        </dl>
        <dl className="space-y-1.5">
          <Linha rotulo="Lucro antes de Ads" valor={f.lucroAntes == null ? NADA : fmtBRLSinal(f.lucroAntes)} />
          <Linha rotulo="Markup antes de Ads" valor={fmtMarkup(f.markup)} />
          <Linha rotulo="Margem consumida" valor={pct(f.margemConsumida)} />
        </dl>
        <dl className="space-y-1.5">
          <Linha rotulo="Grupos exclusivos" valor={String(f.grupos)} />
          <Linha rotulo="Gasto compartilhado associado" valor={fmtBRL(f.custoCompartilhado)} />
        </dl>
      </div>
      {f.custoCompartilhado > 0 && (
        <p className="text-xs text-muted-foreground">O gasto compartilhado não entra no gasto da família.</p>
      )}
      {naoIdPct != null && naoIdPct > 0 && (
        <p className="text-xs text-muted-foreground">
          {`${pct(naoIdPct)} do gasto da conta não tem família identificada e não foi rateado entre famílias.`}
        </p>
      )}
    </div>
  );
}
