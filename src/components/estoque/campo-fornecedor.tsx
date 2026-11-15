import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useFornecedoresOrg } from '@/hooks/useFornecedoresOrg';
import { cn } from '@/lib/utils';

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Fornecedores já cadastrados que contêm o termo (sem caixa/acento). Idêntico ao digitado não sugere. */
export function sugerirFornecedores(lista: string[], termo: string): string[] {
  const t = normalizar(termo);
  if (!t) return [];
  return lista.filter((f) => { const n = normalizar(f); return n !== t && n.includes(t); }).slice(0, 8);
}

/** Texto livre com sugestão dos fornecedores já usados na org — evita "Miss Boutique" × "Miss boutique ". */
export function CampoFornecedor({ id, valor, onChange }: {
  id: string; valor: string; onChange: (v: string) => void;
}) {
  const { data: fornecedores = [] } = useFornecedoresOrg();
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const sugestoes = aberto ? sugerirFornecedores(fornecedores, valor) : [];

  function escolher(f: string) { onChange(f); setAberto(false); setAtivo(-1); }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">Fornecedor</label>
      <Input
        id={id} value={valor} autoComplete="off" role="combobox"
        aria-expanded={sugestoes.length > 0} aria-controls={`${id}-sugestoes`} aria-autocomplete="list"
        aria-activedescendant={ativo >= 0 ? `${id}-sug-${ativo}` : undefined}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setAtivo(-1); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={(e) => {
          if (!sugestoes.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => (i + 1) % sugestoes.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => (i <= 0 ? sugestoes.length - 1 : i - 1)); }
          else if (e.key === 'Enter' && ativo >= 0) { e.preventDefault(); escolher(sugestoes[ativo]); }
        }}
      />
      {sugestoes.length > 0 && (
        // mouseDown + preventDefault na lista toda (itens e barra de rolagem): o input não perde o foco.
        <ul id={`${id}-sugestoes`} role="listbox" onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {sugestoes.map((f, i) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- combobox ARIA: setas/Enter ficam no input
            <li key={f} id={`${id}-sug-${i}`} role="option" aria-selected={i === ativo}
              onClick={() => escolher(f)}
              onMouseEnter={() => setAtivo(i)}
              className={cn('cursor-pointer rounded-md px-2 py-1.5 text-sm', i === ativo && 'bg-accent text-accent-foreground')}>
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
