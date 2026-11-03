import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mesPorExtenso, opcoesDeMes, somarMeses } from '@/lib/relatorio-mensal-ui';

/** Seletor de competência da Central: ‹ "Outubro de 2026" ›. Mesmo componente no detalhe e na carteira. */
export function SeletorMes({ month, mesAtual, onChange, rotulo = 'Mês da organização' }: {
  month: string;
  mesAtual: string;
  onChange: (month: string) => void;
  rotulo?: string;
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex items-center gap-1">
      <Button variant="outline" size="icon" aria-label="Mês anterior" className="max-sm:size-11"
        onClick={() => onChange(somarMeses(month, -1))}><ChevronLeft /></Button>
      <Select value={month} onValueChange={onChange}>
        <SelectTrigger aria-label="Escolher mês" className="w-44 justify-between max-sm:h-11">
          <SelectValue>{mesPorExtenso(month)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opcoesDeMes(mesAtual, month).map((m) => <SelectItem key={m} value={m}>{mesPorExtenso(m)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" aria-label="Próximo mês" className="max-sm:size-11"
        disabled={month >= mesAtual} onClick={() => onChange(somarMeses(month, 1))}><ChevronRight /></Button>
    </div>
  );
}
