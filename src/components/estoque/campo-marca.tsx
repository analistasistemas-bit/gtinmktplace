import { Input } from '@/components/ui/input';

// ADR-0188 (emenda 2026-11-07): a marca do cadastro é a que vai ao ML como BRAND e MANUFACTURER.
// Obrigatória na org com marca própria e no cadastro pela nota (o emitente é revendedor, não a marca);
// fora disso, vazia = o envio usa o fornecedor, como sempre.
export function CampoMarca({ id, valor, onChange, obrigatoria }: {
  id: string; valor: string; onChange: (v: string) => void; obrigatoria: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-1 text-sm font-medium">
        <label htmlFor={id}>Marca / Fabricante</label>
        {obrigatoria && <span className="text-destructive" aria-hidden="true">*</span>}
      </span>
      <Input id={id} value={valor} onChange={(e) => onChange(e.target.value)} />
      {obrigatoria && !valor.trim()
        ? <span className="text-xs text-destructive">Informe a marca.</span>
        : <span className="text-xs text-muted-foreground">Vai ao Mercado Livre como marca e fabricante.{!obrigatoria && ' Vazio = usa o fornecedor.'}</span>}
    </div>
  );
}
