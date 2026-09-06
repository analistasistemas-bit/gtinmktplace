// ADR-0154 Decisões 6/7/9/15: preview do Kit Virtual — título/descrição editáveis, desconto,
// preço, rateio e margem. Puramente apresentacional (recebe valores prontos + callbacks); quem
// chama `preview-kit-virtual` e monta os componentes é `DialogCriarKitVirtual`.
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { TITULO_MAX_KIT } from '@/lib/kit';
import {
  DESCONTO_KIT_VIRTUAL_MAX_PCT, pctParaFracaoDesconto, descreverFaltandoMargemKit,
  type PreviewKitVirtualResultado, type ComponenteSelecionadoKitVirtual,
} from '@/lib/kit-virtual';

export function PreviewKitVirtual({
  componentes, titulo, onTituloChange, descricao, onDescricaoChange,
  onGerarDescricao, gerandoDescricao, descricaoGeradaPorIA,
  descontoPct, onDescontoPctChange, precoEstimado, resultado, carregando, avisoKitVinculado,
}: {
  componentes: ComponenteSelecionadoKitVirtual[];
  titulo: string;
  onTituloChange: (v: string) => void;
  descricao: string;
  onDescricaoChange: (v: string) => void;
  onGerarDescricao: () => void;
  gerandoDescricao: boolean;
  descricaoGeradaPorIA: boolean;
  /** 0-99 — já convertido pra escala humana; a borda com a edge fica em `DialogCriarKitVirtual`. */
  descontoPct: number;
  onDescontoPctChange: (v: number) => void;
  precoEstimado: number;
  resultado: PreviewKitVirtualResultado | null;
  carregando: boolean;
  avisoKitVinculado: boolean;
}) {
  const tituloExcedeu = titulo.length > TITULO_MAX_KIT;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="kv-titulo" className="text-sm font-medium text-foreground">
          Título
          <span className={cn('ml-1 font-normal', tituloExcedeu ? 'text-destructive' : 'text-muted-foreground')}>
            ({titulo.length}/{TITULO_MAX_KIT})
          </span>
        </label>
        <Input
          id="kv-titulo" aria-label="Título do kit" className="h-8 text-sm"
          value={titulo} onChange={(e) => onTituloChange(e.target.value)} aria-invalid={tituloExcedeu}
        />
        {tituloExcedeu && <span className="text-xs text-destructive">Título acima de {TITULO_MAX_KIT} caracteres.</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="kv-descricao" className="text-sm font-medium text-foreground">Descrição</label>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onGerarDescricao} disabled={gerandoDescricao}>
            <Sparkles className="mr-1 h-3 w-3" />
            {gerandoDescricao ? 'Gerando…' : descricaoGeradaPorIA ? 'Gerar de novo com IA' : 'Gerar descrição com IA'}
          </Button>
        </div>
        <Textarea
          id="kv-descricao" aria-label="Descrição do kit" className="min-h-32 resize-y text-sm leading-relaxed"
          value={descricao} onChange={(e) => onDescricaoChange(e.target.value)}
          placeholder="Gere com IA ou escreva a descrição do kit."
        />
      </div>

      {avisoKitVinculado && (
        <div role="status" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          Um dos componentes é um kit vinculado (ADR-0151) — a cadeia de estoque tem três níveis
          (produto-base → kit vinculado → este kit virtual) e depende do último push de estoque.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="kv-desconto" className="text-xs text-muted-foreground">Desconto sobre a soma dos componentes (%)</label>
          <Input
            id="kv-desconto" type="number" min={0} max={DESCONTO_KIT_VIRTUAL_MAX_PCT} aria-label="Desconto do kit (%)"
            className="h-8 text-sm" value={descontoPct}
            onChange={(e) => {
              const n = Number(e.target.value);
              onDescontoPctChange(Math.min(DESCONTO_KIT_VIRTUAL_MAX_PCT, Math.max(0, Number.isFinite(n) ? n : 0)));
            }}
          />
          {/* Documenta a conversão de escala pra quem lê o componente — a fração é só o que sobe à edge. */}
          <span className="text-[10px] text-muted-foreground/70">enviado ao Mercado Livre como {pctParaFracaoDesconto(descontoPct).toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Preço do kit</span>
          <span className="text-base font-semibold">{fmtBRL(precoEstimado)}</span>
        </div>
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-xs">
        {carregando ? (
          <div className="flex flex-col gap-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
        ) : !resultado ? (
          <span className="text-muted-foreground">Calculando margem…</span>
        ) : resultado.margem.ok ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            <span>Custo total: <strong>{fmtBRL(resultado.margem.custoTotal)}</strong></span>
            <span>Imposto total: <strong>{fmtBRL(resultado.margem.impostoTotal)}</strong></span>
            <span>Líquido: <strong>{fmtBRL(resultado.margem.liquido)}</strong></span>
            <span>
              Margem: <strong className={resultado.margem.margemPct < 0 ? 'text-destructive' : 'text-success'}>
                {resultado.margem.margemPct.toFixed(1)}%
              </strong>
            </span>
            <span className="col-span-2 text-muted-foreground">estimativa — reconciliada só na 1ª venda real (Decisão 15)</span>
          </div>
        ) : (
          <div role="status" className="text-warning">
            {descreverFaltandoMargemKit(resultado.margem.faltando, componentes)}
          </div>
        )}
      </div>
    </div>
  );
}
