import { AlertTriangle, CheckCircle2, CircleHelp, Info, Loader2, XCircle } from 'lucide-react';
import { useConfirmacoesMl } from '@/hooks/useConfirmacoesMl';
import { useFamiliasResumo } from '@/hooks/useFamilias';
import { resumirConfirmacoes } from '@/lib/confirmacao-ml';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const numero = (n: number) => n.toLocaleString('pt-BR');

/** ADR-0195: o que o Mercado Livre confirmou depois da escrita. Lote sem conferência não mostra nada. */
export function ResumoConfirmacaoMl({ loteId }: { loteId: string }) {
  const { data: linhas = [] } = useConfirmacoesMl(loteId);
  const { data: familias = [] } = useFamiliasResumo(loteId);
  if (linhas.length === 0) return null;

  const publicadas = familias.filter((f) => f.status === 'publicado').map((f) => f.id);
  const r = resumirConfirmacoes(linhas, publicadas, new Date());
  const divergentes = r.falhas.flatMap((l) => l.divergentes.map((d) => ({ ...d, item: l.item_externo_id })));

  return (
    <section aria-label="Conferência no Mercado Livre" className="mb-4 space-y-3 rounded-lg border px-4 py-3 text-sm">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {r.confirmadas > 0 && (
          <li className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {`${r.confirmadas} ${r.confirmadas === 1 ? 'confirmada' : 'confirmadas'} no Mercado Livre`}
          </li>
        )}
        {r.aguardando > 0 && (
          <li className="flex items-center gap-1.5 text-info">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {`${r.aguardando} aguardando`}
          </li>
        )}
        {r.inconclusivas > 0 && (
          <li className="flex items-center gap-1.5 text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {`${r.inconclusivas} ${r.inconclusivas === 1 ? 'inconclusiva' : 'inconclusivas'}`}
          </li>
        )}
        {r.falhas.length > 0 && (
          <li className="flex items-center gap-1.5 text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {`${new Set(r.falhas.map((l) => l.familia_id)).size} com falha`}
          </li>
        )}
        {r.semConferencia > 0 && (
          <li className="flex items-center gap-1.5 text-muted-foreground">
            <CircleHelp className="h-4 w-4 shrink-0" />
            {`${r.semConferencia} sem conferência`}
          </li>
        )}
      </ul>
      {r.capados > 0 && (
        <p className="flex items-center gap-1.5 text-info">
          <Info className="h-4 w-4 shrink-0" />
          {`${r.capados} cor(es) limitadas pelo teto de 99.999`}
        </p>
      )}
      {divergentes.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Enviado</TableHead>
              <TableHead className="text-right">No ML</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {divergentes.map((d) => (
              <TableRow key={`${d.item}-${d.sku}`}>
                <TableCell>{d.sku}</TableCell>
                <TableCell className="text-right tabular-nums">{numero(d.enviado)}</TableCell>
                <TableCell className="text-right tabular-nums text-destructive">
                  {d.observado == null ? 'sem leitura' : numero(d.observado)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
