import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const valido = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;

/** Spec §2: prazo e cobertura, com o exemplo vivo. Também serve ao "Ajustar" do cabeçalho (`compacto`). */
export function ConfigInicial({ inicial, onSalvar, salvando, compacto, somenteLeitura }: {
  inicial?: { prazo: number; cobertura: number } | null;
  onSalvar: (c: { prazo: number; cobertura: number }) => Promise<unknown> | void;
  salvando?: boolean;
  compacto?: boolean;
  /** Membro não admin: vê os números, não muda (vale para a org inteira; a edge recusa com 403). */
  somenteLeitura?: boolean;
}) {
  const id = useId();
  const [prazo, setPrazo] = useState(String(inicial?.prazo ?? 15));
  const [cobertura, setCobertura] = useState(String(inicial?.cobertura ?? 30));
  const p = Number(prazo);
  const c = Number(cobertura);
  const erroPrazo = !valido(p, 180) ? 'Entre 1 e 180 dias.' : null;
  const erroCob = !valido(c, 365) ? 'Entre 1 e 365 dias.' : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (erroPrazo || erroCob) return;
    void onSalvar({ prazo: p, cobertura: c });
  };

  const campo = (rotulo: string, valor: string, set: (v: string) => void, erro: string | null, sufixo: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${sufixo}`} className="text-sm font-medium">{rotulo}</label>
      <Input
        id={`${id}-${sufixo}`} type="number" inputMode="numeric" min={1} value={valor}
        onChange={(e) => set(e.target.value)} disabled={somenteLeitura} aria-invalid={!!erro} aria-describedby={erro ? `${id}-${sufixo}-erro` : undefined}
        className="h-11 w-32 tabular-nums sm:h-9"
      />
      {erro && <p id={`${id}-${sufixo}-erro`} className="text-xs text-danger">{erro}</p>}
    </div>
  );

  return (
    <form onSubmit={enviar} className={cn('flex flex-col gap-4', !compacto && 'max-w-xl rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/5')}>
      {!compacto && (
        <div className="space-y-1">
          <h2 className="text-h3">Antes da primeira sugestão</h2>
          <p className="text-sm text-muted-foreground">Quanto tempo o fornecedor leva para entregar e por quanto tempo a compra deve durar.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        {campo('Prazo de reposição (dias)', prazo, setPrazo, erroPrazo, 'prazo')}
        {campo('Cobertura desejada (dias)', cobertura, setCobertura, erroCob, 'cobertura')}
      </div>
      {!erroPrazo && !erroCob && (
        <p className="text-sm text-muted-foreground">
          Com {p} e {c}: um produto que vende 1 por dia pede para durar {c} dias depois que a compra chega, mais uma folga.
        </p>
      )}
      {somenteLeitura ? (
        <p className="text-caption">Só administrador altera o prazo e a cobertura.</p>
      ) : (
        <div>
          <Button type="submit" disabled={salvando || !!erroPrazo || !!erroCob} className="h-11 sm:h-9">Salvar</Button>
        </div>
      )}
    </form>
  );
}
