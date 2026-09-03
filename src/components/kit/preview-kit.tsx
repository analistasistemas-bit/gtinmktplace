// ADR-0151 D-4: um bloco de preview por tamanho de kit, com todos os campos editáveis. É a
// revisão inteira do kit — não passa por process-familia nem por card na tela Revisão.
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { AtacadoEditor } from '@/components/atacado-editor';
import { useImageUrl } from '@/hooks/useImageUrl';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { FaixaAtacado } from '@/lib/atacado';
import { precoSugeridoDoKit, TITULO_MAX_KIT, type BaseParaKit } from '@/lib/kit';
import { PISO_MEDIDA_CM } from '@/lib/publicavel';

export interface KitPreviewValue {
  titulo: string;
  descricao: string;
  preco: number;
  descontoPct: number;
  gtin: string;
  imagemPath: string | null;
  /** Arquivo novo escolhido pelo operador — ainda não subiu pro storage (sobe só na confirmação). */
  fotoFile: File | null;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  atacado: FaixaAtacado[];
}

export function valorInicialPreview(base: BaseParaKit, titulo: string, descricao: string, n: number): KitPreviewValue {
  return {
    titulo,
    descricao,
    preco: precoSugeridoDoKit(base.preco, n),
    descontoPct: 0,
    gtin: '',
    imagemPath: base.fotoPath,
    fotoFile: null,
    // Não multiplica por N — empacotar N unidades não é N× linear (ADR-0018).
    alturaCm: base.alturaCm ?? 0,
    larguraCm: base.larguraCm ?? 0,
    comprimentoCm: base.comprimentoCm ?? 0,
    atacado: [],
  };
}

export function PreviewKit({ n, indice, total, base, value, onChange }: {
  n: number;
  /** Posição na lista quando há vários kits (1-based). Omitir se kit único. */
  indice?: number;
  total?: number;
  base: BaseParaKit;
  value: KitPreviewValue;
  onChange: (patch: Partial<KitPreviewValue>) => void;
}) {
  const { data: fotoAtualUrl } = useImageUrl(value.fotoFile ? null : value.imagemPath);
  const tituloExcedeu = value.titulo.length > TITULO_MAX_KIT;
  const custoDerivado = base.custo != null ? base.custo * n : null;
  const pesoDerivado = base.pesoGramas != null ? base.pesoGramas * n : null;
  const saldoVirtual = base.estoque != null ? Math.floor(base.estoque / n) : null;

  function aplicarDesconto(pct: number) {
    onChange({ descontoPct: pct, preco: precoSugeridoDoKit(base.preco, n, pct) });
  }

  const id = (campo: string) => `kit-${n}-${campo}`;

  const multiplos = (total ?? 1) > 1;

  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm',
        multiplos && 'ring-1 ring-border/60',
      )}
      role="listitem"
      aria-label={`Kit de ${n} unidades${multiplos ? ` (${indice} de ${total})` : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2 border-b pb-2">
        <h3 className="text-base font-semibold leading-tight">Kit de {n} unidades</h3>
        {multiplos && indice != null && total != null && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {indice} de {total}
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={id('titulo')} className="text-sm font-medium text-foreground">
              Título
              <span className={cn('ml-1 font-normal', tituloExcedeu ? 'text-destructive' : 'text-muted-foreground')}>
                ({value.titulo.length}/{TITULO_MAX_KIT})
              </span>
            </label>
            <Input
              id={id('titulo')}
              aria-label={`Título do kit ${n}`}
              className="h-8 text-sm"
              value={value.titulo}
              onChange={(e) => onChange({ titulo: e.target.value })}
              aria-invalid={tituloExcedeu}
            />
            {tituloExcedeu && (
              <span className="text-xs text-destructive">Título acima de {TITULO_MAX_KIT} caracteres.</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5 md:flex-1">
            <label htmlFor={id('descricao')} className="text-sm font-medium text-foreground">Descrição</label>
            <Textarea
              id={id('descricao')}
              aria-label={`Descrição do kit ${n}`}
              className="min-h-48 resize-y text-sm leading-relaxed md:min-h-[12rem]"
              value={value.descricao}
              onChange={(e) => onChange({ descricao: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Foto<span className="text-destructive"> *</span></span>
            <div className="flex items-center gap-2">
              {!value.fotoFile && fotoAtualUrl && (
                <img src={fotoAtualUrl} alt={`Foto atual do kit ${n}`} className="h-14 w-14 shrink-0 rounded-md object-cover" />
              )}
              <div className="flex-1">
                <CampoFoto
                  id={id('foto')}
                  ariaLabel={`Foto do kit ${n}`}
                  arquivo={value.fotoFile}
                  opcional={!!value.imagemPath}
                  onEscolher={(f) => onChange({ fotoFile: f })}
                />
              </div>
            </div>
            {!value.fotoFile && !value.imagemPath && (
              <span className="text-xs text-destructive">
                O produto-base não tem foto salva — escolha uma foto para o kit.
              </span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={id('altura')} className="text-xs text-muted-foreground">Altura (cm)</label>
              <Input
                id={id('altura')} type="number" aria-label={`Altura do kit ${n} (cm)`}
                className="h-8 text-sm" value={value.alturaCm}
                onChange={(e) => onChange({ alturaCm: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('largura')} className="text-xs text-muted-foreground">Largura (cm)</label>
              <Input
                id={id('largura')} type="number" aria-label={`Largura do kit ${n} (cm)`}
                className="h-8 text-sm" value={value.larguraCm}
                onChange={(e) => onChange({ larguraCm: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('comprimento')} className="text-xs text-muted-foreground">Comprimento (cm)</label>
              <Input
                id={id('comprimento')} type="number" aria-label={`Comprimento do kit ${n} (cm)`}
                className="h-8 text-sm" value={value.comprimentoCm}
                onChange={(e) => onChange({ comprimentoCm: Number(e.target.value) })}
              />
            </div>
          </div>
          {[value.alturaCm, value.larguraCm, value.comprimentoCm].some((x) => !(x >= PISO_MEDIDA_CM)) && (
            <div role="status" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              Dimensões incompletas — o Mercado Livre vai estimar o frete (pode cotar errado).
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={id('preco')} className="text-xs text-muted-foreground">Preço</label>
              <Input
                id={id('preco')} type="number" step="0.01" aria-label={`Preço do kit ${n}`}
                className="h-8 text-sm" value={value.preco}
                onChange={(e) => onChange({ preco: Number(e.target.value) })}
                aria-invalid={!(value.preco > 0)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('desconto')} className="text-xs text-muted-foreground">Desconto sobre N× unitário (%)</label>
              <Input
                id={id('desconto')} type="number" min={0} max={99} aria-label={`Desconto do kit ${n} (%)`}
                className="h-8 text-sm" value={value.descontoPct}
                onChange={(e) => aplicarDesconto(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('gtin')} className="text-xs text-muted-foreground">GTIN (opcional)</label>
              <Input
                id={id('gtin')} aria-label={`GTIN do kit ${n}`}
                className="h-8 text-sm" value={value.gtin}
                onChange={(e) => onChange({ gtin: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
        <span>Custo: <strong>{custoDerivado != null ? fmtBRL(custoDerivado) : '—'}</strong></span>
        <span>Peso: <strong>{pesoDerivado != null ? `${pesoDerivado} g` : '—'}</strong></span>
        <span>
          Saldo virtual: <strong>{saldoVirtual ?? '—'}</strong>
          <span className="block text-muted-foreground">
            calculado a partir do produto-base — o kit não tem estoque próprio
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Atacado (opcional — não herda as faixas da base)</span>
        <AtacadoEditor faixas={value.atacado} precoBase={value.preco} onChange={(faixas) => onChange({ atacado: faixas })} />
      </div>
    </section>
  );
}
