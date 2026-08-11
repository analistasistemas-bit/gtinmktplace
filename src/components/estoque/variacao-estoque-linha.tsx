// Linha de variação (SKU) do painel expandido da tela Estoque. Mesma regra da linha de produto:
// nenhuma <table> e nenhuma largura dirigida por conteúdo — tracks fixos de CSS Grid, todo texto
// com `truncate` dentro de `min-w-0`. GTIN e dimensões são exatamente os campos que estouravam.
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { StatusPill } from '@/components/ui/status-pill';
import { useImageUrl } from '@/hooks/useImageUrl';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { urlFotoMl, type VariacaoComSaldo } from '@/lib/produtos-saldo';

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

/**
 * Ordem no DOM: foto · SKU/cor · GTIN · dimensões · custo · preço · saldo.
 * Abaixo de `lg` as quatro células do meio ficam `hidden` (sobram 3 itens para 3 tracks) e
 * custo/preço reaparecem como linha secundária dentro da célula de identidade.
 */
const GRID_LINHA_VARIACAO =
  'grid items-center gap-x-3 grid-cols-[2.5rem_minmax(0,1fr)_4rem] lg:grid-cols-[2.5rem_minmax(0,1fr)_8.5rem_9rem_5.5rem_5.5rem_4rem]';

const CELULA_LG = 'hidden lg:block';

export function CabecalhoVariacoes() {
  return (
    <div
      className={cn(
        GRID_LINHA_VARIACAO,
        'border-b bg-muted/50 px-3 py-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground',
      )}
    >
      {/* Célula vazia da coluna da foto. NÃO usar `sr-only` aqui: ele é `position:absolute`, o
          que tira o item do fluxo do grid e desloca TODOS os rótulos uma coluna à esquerda. */}
      <span aria-hidden />
      <span>SKU</span>
      <span className={CELULA_LG}>GTIN</span>
      <span className={CELULA_LG}>Peso e dimensões</span>
      <span className={cn(CELULA_LG, 'text-right')}>Custo</span>
      <span className={cn(CELULA_LG, 'text-right')}>Preço</span>
      <span className="text-right">Saldo</span>
    </div>
  );
}

export function VariacaoEstoqueLinha({ variacao: v }: { variacao: VariacaoComSaldo }) {
  const { data: url } = useImageUrl(v.imagemPath);
  // Mesma cadeia do card do produto: Storage primeiro, foto do anúncio no ML depois.
  const foto = url ?? urlFotoMl(v.mlPictureId);
  const custo = v.custo != null ? fmtBRL(Number(v.custo)) : '—';
  const preco = fmtBRL(Number(v.preco));

  return (
    <div className={cn(GRID_LINHA_VARIACAO, 'border-b px-3 py-2 last:border-b-0 hover:bg-muted/40')}>
      <FotoCapaFamilia capaUrl={foto} tamanho="small" />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium">{v.codigo}</span>
          <PillSaldo saldo={v.estoque} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{v.cor ?? v.nome ?? '—'}</div>
        {/* Abaixo de lg as colunas somem: custo/preço voltam aqui para não sumir do mobile. */}
        <div className="truncate text-xs tabular-nums text-muted-foreground lg:hidden">
          custo {custo} · preço {preco}
        </div>
      </div>

      <div className={cn(CELULA_LG, 'truncate font-mono text-xs tabular-nums text-muted-foreground')}>
        {v.gtin ?? '—'}
      </div>
      <div className={cn(CELULA_LG, 'truncate text-xs tabular-nums text-muted-foreground')}>
        {rotuloDimensoes(v)}
      </div>
      <div className={cn(CELULA_LG, 'truncate text-right text-xs tabular-nums text-muted-foreground')}>
        {custo}
      </div>
      <div className={cn(CELULA_LG, 'truncate text-right text-xs font-medium tabular-nums')}>
        {preco}
      </div>

      <div className="text-right text-sm font-semibold tabular-nums tracking-tight">{v.estoque}</div>
    </div>
  );
}
