// ADR-0196 emenda 2026-11-15 — "Atacado (N)" em Publicados: define as faixas e segue para o preview do reajuste
// (só atacado, sem ajuste). O servidor expande cada produto em todos os anúncios dele e avalia a margem.
import { useState } from 'react';
import { AtacadoEditor } from '@/components/atacado-editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { maxDuasCasas } from '@/lib/reajuste';
import type { PlanoAtacado } from '@/lib/atacado-publicados';
import { formatarNomeProduto } from '@/lib/texto';

export function DialogAtacado({ plano, precoBase, onFechar, onVerPreview }: {
  plano: PlanoAtacado;
  /** Preço do anúncio quando há um produto só: mostra o valor estimado de cada faixa. */
  precoBase: number | null;
  onFechar: () => void;
  onVerPreview: (faixas: FaixaAtacado[]) => void;
}) {
  const [faixas, setFaixas] = useState<FaixaAtacado[]>(plano.faixasIniciais);
  const n = plano.produtos.length;
  const ordenadas = [...faixas].sort((a, b) => a.min_unidades - b.min_unidades);
  // O servidor aceita até 2 casas no %.
  const valido = n > 0 && faixas.length > 0 && !validarFaixas(faixas) && faixas.every((f) => maxDuasCasas(f.desconto_pct));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atacado</DialogTitle>
          <DialogDescription>
            {n === 0 ? 'Nenhum produto selecionado aceita atacado por aqui.'
              : `${n} produto${n === 1 ? '' : 's'}. Vale para todos os anúncios de cada produto e o preço base não muda. Você confere cada faixa no preview antes de executar.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4" noValidate
          onSubmit={(e) => { e.preventDefault(); if (valido) onVerPreview(ordenadas); }}
        >
          {n > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Faixas de desconto</p>
              <AtacadoEditor faixas={faixas} precoBase={precoBase ?? 0} onChange={setFaixas} />
              {plano.produtos.some((p) => p.ehKit) && (
                <p className="text-xs text-muted-foreground">Em kit, a quantidade conta kits: 3+ = a partir de 3 kits.</p>
              )}
            </div>
          )}
          {plano.fora.length > 0 && (
            <section aria-label="Fora do atacado" className="rounded-lg border bg-muted/40 p-3 text-sm">
              <h3 className="font-medium">Fora ({plano.fora.length})</h3>
              <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                {plano.fora.map((f) => (
                  <li key={f.codigoPai}><span className="text-foreground">{formatarNomeProduto(f.titulo)}</span>: {f.motivo}</li>
                ))}
              </ul>
            </section>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            {n > 0 && <Button type="submit" disabled={!valido}>Ver preview</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
