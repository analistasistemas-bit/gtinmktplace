// ADR-0151 D-4: um bloco de preview por tamanho de kit, com todos os campos editáveis. É a
// revisão inteira do kit — não passa por process-familia nem por card na tela Revisão.
import { useEffect, useState, type ComponentProps, type FocusEvent, type ReactNode } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CampoFoto } from '@/components/estoque/campo-foto';
import { AtacadoEditor } from '@/components/atacado-editor';
import { useImageUrl } from '@/hooks/useImageUrl';
import { fmtBRL, parseNumeroPtBr } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { FaixaAtacado } from '@/lib/atacado';
import { precoSugeridoDoKit, TITULO_MAX_KIT, type BaseParaKit } from '@/lib/kit';
import { PISO_MEDIDA_CM } from '@/lib/publicavel';
import { RecebeKit } from '@/components/kit/recebe-kit';

/** ui-ux-pro-max: form-labels + content-jumping — reserva 2 linhas p/ rótulos de grid. */
const LABEL_CAMPO_GRID = 'min-h-10 text-xs leading-snug text-muted-foreground';

const paraTexto = (v: number) => String(v).replace('.', ',');
/** Ao entrar no campo, o que for digitado substitui o valor (pedido do Diego, 13/11). */
const selecionarTudo = (e: FocusEvent<HTMLInputElement>) => e.target.select();

/** Decimal pt-BR digitado como texto. `type="number"` devolvia "" no parcial "38," e o campo zerava (bug 13/11);
 *  mesmo padrão do preço do kit com variação. Vazio/ilegível vale 0 (a validação de cada campo bloqueia). */
function CampoDecimal({ valor, onValor, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  valor: number; onValor: (n: number) => void;
}) {
  const [texto, setTexto] = useState(() => paraTexto(valor));
  // Valor mudado por fora (o desconto recalcula o preço): reflete sem atropelar o que está sendo digitado.
  // Texto ilegível (ex.: "1.234," a caminho de "1.234,56") fica como está: o valor 0 já bloqueia/avisa.
  useEffect(() => {
    setTexto((t) => {
      const lido = parseNumeroPtBr(t) ?? 0;
      return Number.isNaN(lido) && valor === 0 ? t : lido === valor ? t : paraTexto(valor);
    });
  }, [valor]);
  return (
    <Input
      {...props} type="text" inputMode="decimal" value={texto} onFocus={selecionarTudo}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = parseNumeroPtBr(e.target.value);
        onValor(n != null && Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

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
    // ADR-0151 D-4 revisada (Diego, 2026-09-08, bug MLB7585283770): caixa de kit saiu do
    // tamanho de 1 unidade porque o padrão anterior não multiplicava nada e o operador não
    // reparou/editou. Multiplicar as 3 dimensões multiplicaria o VOLUME por N³ (cubagem do ML,
    // `calcularPesoUtilizado`), superestimando o frete — achado na revisão Fable. Só a altura
    // (eixo do empilhamento) escala por N; largura/comprimento seguem a base. Aproximação —
    // segue editável para quando o empacotamento real for diferente.
    alturaCm: Math.round((base.alturaCm ?? 0) * n * 100) / 100,
    larguraCm: base.larguraCm ?? 0,
    comprimentoCm: base.comprimentoCm ?? 0,
    atacado: [],
  };
}

export function PreviewKit({ n, indice, total, base, value, onChange, categoriaMlId, onPodeSeguir, galeria, capaUnidades }: {
  n: number;
  /** Posição na lista quando há vários kits (1-based). Omitir se kit único. */
  indice?: number;
  total?: number;
  base: BaseParaKit;
  value: KitPreviewValue;
  onChange: (patch: Partial<KitPreviewValue>) => void;
  /** Categoria efetiva do kit (a trocada no dialog, se houver): a tarifa segue ela. */
  categoriaMlId: string | null;
  /** Callback único e estável do dialog; o preview informa se a conta deste kit está pronta. */
  onPodeSeguir: (n: number, pode: boolean) => void;
  /** ADR-0204: prévia da galeria da base, abaixo da foto do kit (só com a base publicada no ML). */
  galeria?: ReactNode;
  /** ADR-0205: "Gerar capa com N unidades" (estado no dialog), logo abaixo do campo Foto. */
  capaUnidades?: ReactNode;
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
            {capaUnidades}
          </div>
          {galeria}

          <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
            <div className="flex flex-col gap-1">
              <label htmlFor={id('altura')} className={LABEL_CAMPO_GRID}>Altura (cm)</label>
              <CampoDecimal
                id={id('altura')} aria-label={`Altura do kit ${n} (cm)`}
                className="h-8 text-sm" valor={value.alturaCm}
                onValor={(alturaCm) => onChange({ alturaCm })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('largura')} className={LABEL_CAMPO_GRID}>Largura (cm)</label>
              <CampoDecimal
                id={id('largura')} aria-label={`Largura do kit ${n} (cm)`}
                className="h-8 text-sm" valor={value.larguraCm}
                onValor={(larguraCm) => onChange({ larguraCm })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('comprimento')} className={LABEL_CAMPO_GRID}>Comprimento (cm)</label>
              <CampoDecimal
                id={id('comprimento')} aria-label={`Comprimento do kit ${n} (cm)`}
                className="h-8 text-sm" valor={value.comprimentoCm}
                onValor={(comprimentoCm) => onChange({ comprimentoCm })}
              />
            </div>
          </div>
          {[value.alturaCm, value.larguraCm, value.comprimentoCm].some((x) => !(x >= PISO_MEDIDA_CM)) && (
            <div role="status" className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              Dimensões incompletas — o Mercado Livre vai estimar o frete (pode cotar errado).
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
            <div className="flex flex-col gap-1">
              <label htmlFor={id('preco')} className={LABEL_CAMPO_GRID}>Preço</label>
              <CampoDecimal
                id={id('preco')} aria-label={`Preço do kit ${n}`}
                className="h-8 text-sm" valor={value.preco}
                onValor={(preco) => onChange({ preco })}
                aria-invalid={!(value.preco > 0)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('desconto')} className={LABEL_CAMPO_GRID}>Desconto sobre N× unitário (%)</label>
              <Input
                id={id('desconto')} type="number" min={0} max={99} aria-label={`Desconto do kit ${n} (%)`}
                className="h-8 text-sm" value={value.descontoPct} onFocus={selecionarTudo}
                onChange={(e) => aplicarDesconto(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id('gtin')} className={LABEL_CAMPO_GRID}>GTIN (opcional)</label>
              <Input
                id={id('gtin')} aria-label={`GTIN do kit ${n}`}
                className="h-8 text-sm" value={value.gtin}
                onChange={(e) => onChange({ gtin: e.target.value })}
              />
            </div>
          </div>
          <RecebeKit n={n} base={base} value={value} categoriaMlId={categoriaMlId} onPodeSeguir={onPodeSeguir} />
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
