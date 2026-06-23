import { RotateCcw, ExternalLink, AlertTriangle } from 'lucide-react';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { labelTipoDevolucao, type Devolucao } from '@/lib/devolucoes';
import { fmtBRL } from '@/lib/formato';
import { fmtDataCurta } from '@/lib/ml-status';
import { StatusPill } from '@/components/ui/status-pill';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

const ACAO_LABEL: Record<string, string> = {
  send_money_back: 'Devolver dinheiro',
  review_return: 'Revisar devolução',
  open_dispute: 'Abrir disputa',
  allow_return: 'Autorizar devolução',
  ship_product: 'Enviar produto',
};
const labelAcao = (a: string) => ACAO_LABEL[a] ?? a.replace(/_/g, ' ');

function Acoes({ d }: { d: Devolucao }) {
  const acoes = d.acoes_pendentes ?? [];
  if (acoes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {acoes.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-xs">
          {a.mandatory && <AlertTriangle className="h-3 w-3 text-warning" />}
          {labelAcao(a.action)}
          {a.due_date && <span className="text-muted-foreground">· até {fmtDataCurta(a.due_date)}</span>}
        </span>
      ))}
    </div>
  );
}

export function AbaDevolucoes() {
  const { data: devolucoes, isFetching } = useDevolucoes();
  const lista = devolucoes ?? [];

  if (!isFetching && lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <RotateCcw className="h-6 w-6" />
        Nenhuma devolução ou reclamação. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
            <TableHead>Aberta</TableHead>
            <TableHead>Pedido</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Ações pendentes</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((d) => {
            const aberto = d.status === 'opened';
            const urlClaim = `https://www.mercadolivre.com.br/reclamacoes/${d.claim_id}`;
            return (
              <TableRow key={d.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{fmtDataCurta(d.aberto_em)}</TableCell>
                <TableCell className="tabular-nums">{d.order_id ?? '—'}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={d.reason_texto ?? ''}>{d.reason_texto ?? '—'}</TableCell>
                <TableCell>{labelTipoDevolucao(d.type)}</TableCell>
                <TableCell><StatusPill tone={aberto ? 'warning' : 'neutral'}>{aberto ? 'Aberta' : 'Fechada'}</StatusPill></TableCell>
                <TableCell className="text-right tabular-nums">{d.valor_em_jogo != null ? fmtBRL(d.valor_em_jogo) : '—'}</TableCell>
                <TableCell><Acoes d={d} /></TableCell>
                <TableCell>
                  <a href={urlClaim} target="_blank" rel="noreferrer" className="text-info hover:underline"><ExternalLink className="h-3.5 w-3.5" /></a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {isFetching && lista.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
    </div>
  );
}
