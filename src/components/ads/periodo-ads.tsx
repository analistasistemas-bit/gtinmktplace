import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  RETENCAO_ADS_DIAS,
  resolverPeriodoAds,
  type MotivoPeriodoInvalidoAds,
  type PeriodoAds,
} from '@/lib/ads-painel-dados';

export type CompararAds = 'anterior' | 'nenhum';

interface Props {
  valor: PeriodoAds;
  comparar: CompararAds;
  onChange: (v: { periodo: PeriodoAds; comparar: CompararAds }) => void;
  /** Relógio injetável (testes); o default é o instante atual. */
  agora?: Date;
}

const PRESETS: { rotulo: string; periodo: PeriodoAds }[] = [
  { rotulo: 'Mês atual', periodo: { tipo: 'mes_atual' } },
  { rotulo: '7 dias', periodo: { tipo: 'preset', dias: 7 } },
  { rotulo: '30 dias', periodo: { tipo: 'preset', dias: 30 } },
  { rotulo: '90 dias', periodo: { tipo: 'preset', dias: 90 } },
];

const MOTIVOS: Record<MotivoPeriodoInvalidoAds, string> = {
  data_invalida: 'Informe datas válidas nos dois campos.',
  ordem: 'A data de início não pode ser depois do fim.',
  futuro: 'O fim precisa ser até ontem (o Ads só tem dias completos).',
  fora_da_retencao: `O Mercado Ads guarda só os últimos ${RETENCAO_ADS_DIAS} dias; escolha um início mais recente.`,
};

// Alvo de toque 44px e fonte 16px no mobile; compacto no desktop.
const BOTAO = 'min-h-11 px-3 text-base sm:min-h-8 sm:px-2.5 sm:text-sm';
const CAMPO_DATA =
  'min-h-11 rounded-md border bg-background px-2 text-base sm:min-h-8 sm:text-sm dark:[color-scheme:dark]';

const mesmoPreset = (a: PeriodoAds, b: PeriodoAds) =>
  a.tipo === b.tipo && (a.tipo !== 'preset' || a.dias === (b as typeof a).dias);

/**
 * Seletor de período e comparação do /ads (controlado). Sem "Hoje": o Ads só tem dias completos.
 * O personalizado mantém rascunho local — digitar não consulta; só "Aplicar" (validado por
 * `resolverPeriodoAds`) chama `onChange`.
 */
export function PeriodoAdsSeletor({ valor, comparar, onChange, agora }: Props) {
  const [aberto, setAberto] = useState(false);
  const [desde, setDesde] = useState(valor.tipo === 'range' ? valor.desde : '');
  const [ate, setAte] = useState(valor.tipo === 'range' ? valor.ate : '');
  const [erro, setErro] = useState<string | null>(null);

  const aplicar = () => {
    const periodo: PeriodoAds = { tipo: 'range', desde, ate };
    const r = resolverPeriodoAds(periodo, agora ?? new Date(), null);
    if (r.tipo === 'invalido') return setErro(MOTIVOS[r.motivo]);
    setErro(null);
    setAberto(false);
    onChange({ periodo, comparar });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => {
          const ativo = mesmoPreset(valor, p.periodo);
          return (
            <Button
              key={p.rotulo}
              size="sm"
              variant={ativo ? 'default' : 'outline'}
              aria-pressed={ativo}
              className={BOTAO}
              onClick={() => onChange({ periodo: p.periodo, comparar })}
            >
              {p.rotulo}
            </Button>
          );
        })}
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant={valor.tipo === 'range' ? 'default' : 'outline'}
              aria-pressed={valor.tipo === 'range'}
              className={BOTAO}
            >
              <CalendarRange className="mr-1 h-3.5 w-3.5" aria-hidden />
              Personalizado
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                aplicar();
              }}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="ads-periodo-de" className="text-sm text-muted-foreground">De</label>
                <input id="ads-periodo-de" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={CAMPO_DATA} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="ads-periodo-ate" className="text-sm text-muted-foreground">Até</label>
                <input id="ads-periodo-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={CAMPO_DATA} />
              </div>
              {erro && (
                <p role="alert" className="text-sm text-danger">
                  {erro}
                </p>
              )}
              <Button type="submit" size="sm" className={`${BOTAO} w-full`}>
                Aplicar
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <span id="ads-comparar-rotulo" className="text-sm text-muted-foreground">Comparar com</span>
        <Select value={comparar} onValueChange={(c) => onChange({ periodo: valor, comparar: c as CompararAds })}>
          <SelectTrigger aria-labelledby="ads-comparar-rotulo" className="min-h-11 text-base sm:min-h-8 sm:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anterior">Período anterior</SelectItem>
            <SelectItem value="nenhum">Sem comparação</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
