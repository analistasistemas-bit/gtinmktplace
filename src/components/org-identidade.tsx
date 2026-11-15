import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useOrgIdentidade } from '@/hooks/useOrgIdentidade';
import { ehSimbolo, escolherLogo, iniciais } from '@/lib/org-logo';

/** Marca da org do usuário: logo do tema ativo, ou iniciais + nome quando não há logo. */
export function OrgIdentidade({ className }: { className?: string }) {
  const { data } = useOrgIdentidade();
  const { theme } = useTheme();
  const [quebrada, setQuebrada] = useState<string | null>(null);
  const [simbolo, setSimbolo] = useState(false);
  if (!data) return null;

  const url = escolherLogo(theme, data.logo_claro_url, data.logo_escuro_url);
  const comLogo = !!url && quebrada !== url;
  const mostrarNome = !comLogo || simbolo;

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {comLogo ? (
        <img
          key={url}
          src={url}
          alt={data.nome}
          className="max-h-7 max-w-[140px] object-contain object-left"
          onLoad={(e) => setSimbolo(ehSimbolo(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
          onError={() => setQuebrada(url)}
        />
      ) : (
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
        >
          {iniciais(data.nome)}
        </span>
      )}
      {mostrarNome && <span className="truncate text-sm font-medium">{data.nome}</span>}
    </div>
  );
}
