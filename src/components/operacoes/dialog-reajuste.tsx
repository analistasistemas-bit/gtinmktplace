// I5 — diálogo do reajuste de preço em massa (Publicados): Aumentar/Diminuir × %/R$ + valor → preview no servidor.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ChipFiltro } from '@/components/promocoes/contagem-semaforo';
import { parsePreco } from '@/lib/operacoes';
import { maxDuasCasas, type Ajuste, type TipoAjuste } from '@/lib/reajuste';

export function DialogReajuste({ quantidade, onFechar, onVerPreview }: {
  quantidade: number; onFechar: () => void; onVerPreview: (ajuste: Ajuste) => void;
}) {
  const [sentido, setSentido] = useState<'+' | '-'>('+');
  const [tipo, setTipo] = useState<TipoAjuste>('pct');
  const [texto, setTexto] = useState('');

  const valor = parsePreco(texto);
  const erro = !texto.trim() ? null
    : valor == null || !(valor > 0) ? 'Informe um valor maior que zero.'
      : !maxDuasCasas(valor) ? 'Use no máximo 2 casas decimais.'
        : tipo === 'pct' && sentido === '-' && valor >= 100 ? 'Diminuir 100% ou mais zera o preço.'
          : null;
  const valido = valor != null && !erro;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reajustar preço</DialogTitle>
          <DialogDescription>
            {quantidade} anúncio{quantidade === 1 ? '' : 's'} selecionado{quantidade === 1 ? '' : 's'}. Você confere cada preço no preview antes de executar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); if (valido) onVerPreview({ tipo, sentido, valor: valor! }); }}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sentido">
            <ChipFiltro ativo={sentido === '+'} onClick={() => setSentido('+')}>Aumentar</ChipFiltro>
            <ChipFiltro ativo={sentido === '-'} onClick={() => setSentido('-')}>Diminuir</ChipFiltro>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2" role="group" aria-label="Tipo">
              <ChipFiltro ativo={tipo === 'pct'} onClick={() => setTipo('pct')}>%</ChipFiltro>
              <ChipFiltro ativo={tipo === 'reais'} onClick={() => setTipo('reais')}>R$</ChipFiltro>
            </div>
            <Input
              value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal"
              aria-label="Valor do ajuste" placeholder={tipo === 'pct' ? '10' : '5,00'} aria-invalid={!!erro}
              className="h-11 w-32"
            />
          </div>
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={!valido}>Ver preview</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
