// Card de variação da tela Estoque. Substitui a linha de 7 colunas: nada aqui pode ter largura
// dirigida por conteúdo, senão volta o estouro de largura que motivou o redesenho.
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { StatusPill } from '@/components/ui/status-pill';
import { useImageUrl } from '@/hooks/useImageUrl';
import { fmtBRL } from '@/lib/formato';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

/** "200g · 10×20×30cm", só as partes informadas. "—" se nada foi preenchido. */
function rotuloDimensoes(v: VariacaoComSaldo): string {
  const partes: string[] = [];
  if (v.pesoGramas != null) partes.push(`${v.pesoGramas}g`);
  const { alturaCm: a, larguraCm: l, comprimentoCm: c } = v;
  if (a != null || l != null || c != null) partes.push(`${a ?? '—'}×${l ?? '—'}×${c ?? '—'}cm`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

export function PillSaldo({ saldo }: { saldo: number }) {
  if (saldo > 0) return null;
  return saldo < 0
    ? <StatusPill tone="danger">saldo inconsistente</StatusPill>
    : <StatusPill tone="warning">sem estoque</StatusPill>;
}

export function VariacaoEstoqueCard({ variacao: v }: { variacao: VariacaoComSaldo }) {
  const { data: url } = useImageUrl(v.imagemPath);

  return (
    <div className="flex min-w-0 gap-3 rounded-lg border bg-background p-3">
      <FotoCapaFamilia capaUrl={url ?? null} tamanho="small" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono font-medium">{v.codigo}</span>
          <span className="shrink-0 tabular-nums font-medium">{v.estoque}</span>
        </div>
        <span className="truncate text-muted-foreground">{v.cor ?? v.nome ?? '—'}</span>
        <span className="truncate text-muted-foreground">GTIN {v.gtin ?? '—'}</span>
        <span className="truncate text-muted-foreground">{rotuloDimensoes(v)}</span>
        <span className="truncate text-muted-foreground">
          custo {v.custo != null ? fmtBRL(Number(v.custo)) : '—'} · preço {fmtBRL(Number(v.preco))}
        </span>
        <PillSaldo saldo={v.estoque} />
      </div>
    </div>
  );
}
