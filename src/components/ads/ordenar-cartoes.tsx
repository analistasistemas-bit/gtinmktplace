import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Direcao = 'asc' | 'desc';

/**
 * Ordenação dos cartões (mobile/tablet), onde não há cabeçalho de tabela: coluna + direção, como no detalhe da
 * campanha. Trocar de coluna mantém a direção se for a mesma; senão `colunaAsc` começa crescente, as demais
 * decrescente (mesma regra do cabeçalho). Alvos de 44 px em toque (max-sm/pointer-coarse, padrão TELA_ADS).
 */
export function OrdenarCartoes<C extends string>({ rotulo, opcoes, ordem, onOrdem, colunaAsc, className }: {
  rotulo: string;
  opcoes: { valor: C; rotulo: string }[];
  ordem: { coluna: C; direcao: Direcao };
  onOrdem: (o: { coluna: C; direcao: Direcao }) => void;
  colunaAsc: C;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <Select value={ordem.coluna} onValueChange={(c) => onOrdem({
        coluna: c as C, direcao: c === ordem.coluna ? ordem.direcao : c === colunaAsc ? 'asc' : 'desc' })}>
        <SelectTrigger aria-label={rotulo} className="h-8 flex-1 data-[size=default]:max-sm:h-11 data-[size=default]:pointer-coarse:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" className="h-8 shrink-0 max-sm:h-11 pointer-coarse:h-11"
        aria-label={ordem.direcao === 'desc' ? 'Ordem decrescente: alternar para crescente' : 'Ordem crescente: alternar para decrescente'}
        onClick={() => onOrdem({ ...ordem, direcao: ordem.direcao === 'asc' ? 'desc' : 'asc' })}>
        {ordem.direcao === 'desc' ? <ArrowDown aria-hidden className="h-4 w-4" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
        {ordem.direcao === 'desc' ? 'Decrescente' : 'Crescente'}
      </Button>
    </div>
  );
}
