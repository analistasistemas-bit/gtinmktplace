// ADR-0154 Decisões 6/7/9/15 + ADR-0206: etapa 2 ("Anúncio") do Kit Virtual em seções — Capa
// (slot montado pelo diálogo), Texto (título/descrição gerados por IA, "Regerar") e Preço
// (desconto, preço e margem). Puramente apresentacional: quem chama `preview-kit-virtual`, guarda
// a assinatura da composição e decide o que sobrescrever é `DialogCriarKitVirtual`.
import { useState, type ReactNode } from 'react';
import { BadgePercent, ImageIcon, Info, Loader2, RefreshCw, Type } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { TITULO_MAX_KIT } from '@/lib/kit';
import {
  DESCONTO_KIT_VIRTUAL_MAX_PCT, pctParaFracaoDesconto, descreverFaltandoMargemKit,
  type PreviewKitVirtualResultado, type ComponenteSelecionadoKitVirtual,
} from '@/lib/kit-virtual';

/** Card de seção da etapa 2 — mesmo cartão do `preview-kit.tsx` (kit vinculado), ícone na cor de marca. */
function Secao({ titulo, icone, acao, children, className }: {
  titulo: string; icone: ReactNode; acao?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section aria-label={titulo} className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold leading-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">{icone}</span>
          {titulo}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function PreviewKitVirtual({
  capa, componentes, titulo, onTituloChange, descricao, onDescricaoChange,
  onRegerar, regerando, textoEditado, tituloPadrao,
  descontoPct, onDescontoPctChange, precoEstimado, resultado, carregando, margemIndisponivel = false, avisoKitVinculado,
}: {
  /** Conteúdo da seção Capa (capa por IA + upload manual), montado pelo diálogo. */
  capa: ReactNode;
  componentes: ComponenteSelecionadoKitVirtual[];
  titulo: string;
  onTituloChange: (v: string) => void;
  descricao: string;
  onDescricaoChange: (v: string) => void;
  /** Regera título + descrição. Com `textoEditado`, só depois da confirmação do operador. */
  onRegerar: () => void;
  regerando: boolean;
  textoEditado: boolean;
  /** A IA não devolveu título válido e veio o template. */
  tituloPadrao: boolean;
  /** 0-99 — já convertido pra escala humana; a borda com a edge fica em `DialogCriarKitVirtual`. */
  descontoPct: number;
  onDescontoPctChange: (v: number) => void;
  precoEstimado: number;
  resultado: PreviewKitVirtualResultado | null;
  carregando: boolean;
  /** O último recálculo falhou (sem resultado): "Margem indisponível" em vez de "Calculando margem…". */
  margemIndisponivel?: boolean;
  avisoKitVinculado: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const tituloExcedeu = titulo.length > TITULO_MAX_KIT;

  function regerar() {
    if (textoEditado) setConfirmando(true);
    else onRegerar();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Capa" icone={<ImageIcon className="size-3.5" />}>{capa}</Secao>

        <Secao
          titulo="Texto"
          icone={<Type className="size-3.5" />}
          acao={(
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={regerar} disabled={regerando || confirmando}>
              {regerando ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              {regerando ? 'Gerando…' : 'Regerar'}
            </Button>
          )}
        >
          {confirmando && (
            <div role="alertdialog" aria-label="Confirmar regerar texto" className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
              <span className="text-foreground">Regerar substitui o título e a descrição que você editou.</span>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => { setConfirmando(false); onRegerar(); }}>
                  Substituir
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmando(false)}>
                  Manter meu texto
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="kv-titulo" className="text-sm font-medium text-foreground">
              Título
              <span className={cn('ml-1 font-normal tabular-nums', tituloExcedeu ? 'text-destructive' : 'text-muted-foreground')}>
                ({titulo.length}/{TITULO_MAX_KIT})
              </span>
            </label>
            <Input
              id="kv-titulo" aria-label="Título do kit" className="h-8 text-sm"
              value={titulo} onChange={(e) => onTituloChange(e.target.value)} aria-invalid={tituloExcedeu}
              placeholder={regerando ? 'Gerando com IA…' : undefined}
            />
            {tituloExcedeu && <span className="text-xs text-destructive">Título acima de {TITULO_MAX_KIT} caracteres.</span>}
            {tituloPadrao && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Info aria-hidden className="size-3 shrink-0" />Título padrão: a IA não gerou um título válido
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="kv-descricao" className="text-sm font-medium text-foreground">Descrição</label>
            <Textarea
              id="kv-descricao" aria-label="Descrição do kit" className="min-h-40 resize-y text-sm leading-relaxed"
              value={descricao} onChange={(e) => onDescricaoChange(e.target.value)}
              placeholder={regerando ? 'Gerando com IA…' : 'Escreva a descrição do kit ou use Regerar.'}
            />
          </div>
        </Secao>
      </div>

      {avisoKitVinculado && (
        <div role="status" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          Um dos componentes é um kit vinculado (ADR-0151) — a cadeia de estoque tem três níveis
          (produto-base → kit vinculado → este kit virtual) e depende do último push de estoque.
        </div>
      )}

      <Secao titulo="Preço" icone={<BadgePercent className="size-3.5" />}>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
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
          <div className="flex flex-col gap-0.5 rounded-md bg-primary/5 px-3 py-2 ring-1 ring-primary/15">
            <span className="text-xs text-muted-foreground">Preço do kit</span>
            <span className="text-lg font-semibold tabular-nums text-primary">{fmtBRL(precoEstimado)}</span>
          </div>
        </div>

        <div className="rounded-md bg-muted/30 p-3 text-xs">
          {carregando ? (
            <div className="flex flex-col gap-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
          ) : !resultado ? (
            <span className="text-muted-foreground">{margemIndisponivel ? 'Margem indisponível' : 'Calculando margem…'}</span>
          ) : resultado.margem.ok ? (
            <div className="grid gap-1.5 tabular-nums sm:grid-cols-2">
              <span>Custo total: <strong>{fmtBRL(resultado.margem.custoTotal)}</strong></span>
              <span>Imposto total: <strong>{fmtBRL(resultado.margem.impostoTotal)}</strong></span>
              <span>Líquido: <strong>{fmtBRL(resultado.margem.liquido)}</strong></span>
              <span>
                Margem: <strong className={resultado.margem.margemPct < 0 ? 'text-destructive' : 'text-success'}>
                  {resultado.margem.margemPct.toFixed(1)}%
                </strong>
              </span>
              <span className="text-muted-foreground sm:col-span-2">estimativa — reconciliada só na 1ª venda real (Decisão 15)</span>
            </div>
          ) : (
            <div role="status" className="text-warning">
              {descreverFaltandoMargemKit(resultado.margem.faltando, componentes)}
            </div>
          )}
        </div>
      </Secao>
    </div>
  );
}
