import { useState } from 'react';
import { Download, FileText, FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { exportar, type ExportConfig, type ExportFormato, type ReportData } from '@/lib/export';

interface BotaoExportarProps {
  /** Constrói o relatório a partir do estado atual da tela, respeitando a config.
   *  Pode ser assíncrono (ex.: Publicados faz prefetch das famílias p/ o resumo de viabilidade). */
  montarReport: (config: ExportConfig) => ReportData | Promise<ReportData>;
  /** A tela tem linhas expansíveis (pergunta Expandidas/Recolhidas). */
  temExpansao?: boolean;
  /** A tela tem KPIs (pergunta KPIs+dados / Somente dados). */
  temKpis?: boolean;
  /** PDF visual sempre inclui todos os indicadores. */
  pdfSempreCompleto?: boolean;
  /** Nº de linhas que o export vai conter. Quando alto, o diálogo avisa antes de gerar — um PDF de
   *  centenas de páginas costuma ser engano de filtro, não intenção. */
  totalLinhas?: number;
  /** Tamanho do botão (default 'sm'). */
  size?: 'sm' | 'default';
  className?: string;
}

const ROTULO_FORMATO: Record<ExportFormato, string> = {
  pdf: 'PDF',
  excel: 'Excel',
  csv: 'CSV',
  imprimir: 'impressão',
};

export function BotaoExportar({
  montarReport,
  temExpansao = false,
  temKpis = false,
  pdfSempreCompleto = false,
  totalLinhas,
  size = 'sm',
  className,
}: BotaoExportarProps) {
  const [formato, setFormato] = useState<ExportFormato | null>(null);
  const [expandido, setExpandido] = useState(false);
  const [incluirKpis, setIncluirKpis] = useState(true);
  const [gerando, setGerando] = useState(false);

  const AVISO_VOLUME = 200;
  const volumoso = totalLinhas != null && totalLinhas > AVISO_VOLUME;
  // Com volume alto, abre o diálogo mesmo sem opções a perguntar — o aviso é a razão de abrir.
  const precisaPerguntar = temExpansao || temKpis || volumoso;
  const mostrarOpcaoKpis = temKpis && !(pdfSempreCompleto && formato === 'pdf');

  async function disparar(config: ExportConfig) {
    setGerando(true);
    try {
      const data = await montarReport(config);
      await exportar(data, config.formato);
    } finally {
      setGerando(false);
    }
  }

  function escolher(f: ExportFormato) {
    if (precisaPerguntar) {
      setFormato(f);
    } else {
      void disparar({ formato: f, expandido: false, incluirKpis: false });
    }
  }

  async function confirmar() {
    if (!formato) return;
    const incluirKpisEfetivo = pdfSempreCompleto && formato === 'pdf' ? true : incluirKpis;
    await disparar({ formato, expandido, incluirKpis: incluirKpisEfetivo });
    setFormato(null);
  }

  const volumeAlto = volumoso ? (
    <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
      Este export terá <strong>{totalLinhas!.toLocaleString('pt-BR')} linhas</strong>
      {expandido ? ' (mais o detalhe de cada item)' : ''}. Se não era essa a intenção, feche e
      refine o filtro ou a busca da tela antes de gerar.
    </div>
  ) : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} className={className}>
            <Download data-icon="inline-start" />
            Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => escolher('pdf')}>
            <FileText className="h-4 w-4" /> PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => escolher('excel')}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => escolher('csv')}>
            <FileSpreadsheet className="h-4 w-4" /> CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => escolher('imprimir')}>
            <Printer className="h-4 w-4" /> Imprimir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={formato != null} onOpenChange={(o) => !o && setFormato(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Opções de exportação{formato ? ` · ${ROTULO_FORMATO[formato]}` : ''}</DialogTitle>
            <DialogDescription>Exporta os dados conforme os filtros aplicados na tela.</DialogDescription>
          </DialogHeader>

          {volumeAlto}

          <div className="space-y-5 py-1">
            {temExpansao && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linhas</p>
                <RadioGroup
                  value={expandido ? 'expandido' : 'recolhido'}
                  onValueChange={(v) => setExpandido(v === 'expandido')}
                  className="gap-2"
                >
                  <label htmlFor="exp-recolhido" className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id="exp-recolhido" value="recolhido" /> Recolhidas (só o resumo)
                  </label>
                  <label htmlFor="exp-expandido" className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id="exp-expandido" value="expandido" /> Expandidas (com o detalhe de cada item)
                  </label>
                </RadioGroup>
              </div>
            )}

            {mostrarOpcaoKpis && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Conteúdo</p>
                <RadioGroup
                  value={incluirKpis ? 'kpis' : 'dados'}
                  onValueChange={(v) => setIncluirKpis(v === 'kpis')}
                  className="gap-2"
                >
                  <label htmlFor="cont-kpis" className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id="cont-kpis" value="kpis" /> Indicadores + dados
                  </label>
                  <label htmlFor="cont-dados" className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id="cont-dados" value="dados" /> Somente os dados
                  </label>
                </RadioGroup>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setFormato(null)} disabled={gerando}>
              Cancelar
            </Button>
            <Button size="sm" onClick={confirmar} disabled={gerando}>
              {gerando ? 'Gerando…' : formato === 'imprimir' ? 'Imprimir' : 'Exportar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
