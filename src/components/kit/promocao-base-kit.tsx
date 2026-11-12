// ADR-0151 (adendo 12/11): promoção ativa/futura do produto-base ao lado dos kits. Só informativo: falha do ML
// vira "promoção da base indisponível" e nunca bloqueia a criação. Renderizado uma vez no dialog.
import { useState } from 'react';
import { usePrecoAvulsoKit } from '@/hooks/useKitsVariacao';
import { fmtBRL } from '@/lib/formato';
import { diaMes, PromocoesFuturas } from '@/components/kit-variacao/referencia-avulso';

const INDISPONIVEL = 'promoção da base indisponível';

/** `ativo` = base publicada no ML. Base em Revisão não tem anúncio: nada a ler, nada a mostrar. */
export function PromocaoBaseKit({ familiaBaseId, ativo }: { familiaBaseId: string; ativo: boolean }) {
  // Montado só com o dialog aberto: uma leitura nova do ML por abertura.
  const [abertura] = useState(() => crypto.randomUUID());
  const q = usePrecoAvulsoKit(ativo ? familiaBaseId : null, ativo ? abertura : null);
  if (!ativo) return null;
  if (q.isError) return <p className="text-xs text-muted-foreground">{INDISPONIVEL}</p>;
  const p = q.data ? [...q.data.values()][0] : undefined;
  if (!p) return null;
  if (p.futurasIndisponivel) return <p className="text-xs text-muted-foreground">{INDISPONIVEL}</p>;
  const futuras = p.futuras ?? [];
  if (p.promocao == null && futuras.length === 0) return null;
  return (
    <div className="grid gap-1 text-xs">
      {p.promocao != null && (
        <p className="tabular-nums">
          Base em promoção: {fmtBRL(p.promocao)}{p.fimPromocao ? ` até ${diaMes(p.fimPromocao)}` : ''}
          {p.normal != null && ` (normal ${fmtBRL(p.normal)})`}
        </p>
      )}
      <PromocoesFuturas rotuloTitulo="da base" pecas={[{ rotulo: 'Produto-base', normal: p.normal, futuras, indisponivel: false }]} />
    </div>
  );
}
