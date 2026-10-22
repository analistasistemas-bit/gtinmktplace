import { AlertTriangle, ExternalLink } from 'lucide-react';
import { ROTULO_RISCO, type AnuncioEmRisco } from '@/lib/catalogo-risco';
import { formatarNomeProduto } from '@/lib/texto';

/**
 * Card "Catálogo em risco" (spec 2026-08-12, escopo restrito 2026-08-13): recebe só os anúncios
 * que o ML sinaliza com a tag `catalog_forewarning` — filtro aplicado em Publicados.tsx via
 * filtrarCatalogForewarning, este componente é agnóstico à origem de `itens`. Mesmo padrão
 * visual do banner de moderados. Cada anúncio traz o link "Resolver no ML" (mesma URL que o
 * alerta de Telegram monta). O resolvedor em massa via extensão (Fase 3, ADR-0118) foi retirado.
 */
export function CatalogoEmRisco({ itens }: { itens: AnuncioEmRisco[] }) {
  if (itens.length === 0) return null;
  return (
    <details className="mb-4 rounded-md border border-warning/30 bg-warning/10 text-sm text-warning motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 hover:bg-warning/20">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {itens.length === 1
            ? '1 anúncio com variações sem ficha de catálogo — o ML pode pausá-lo. Clique para ver.'
            : `${itens.length} anúncios com variações sem ficha de catálogo — o ML pode pausá-los. Clique para ver.`}
        </span>
      </summary>
      <ul className="divide-y divide-warning/20 border-t border-warning/20">
        {itens.map((i) => (
          <li key={i.mlItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <span className="font-medium text-foreground">{formatarNomeProduto(i.titulo)}</span>
            <span>{i.qtdSemFicha === 1 ? '1 variação' : `${i.qtdSemFicha} variações`}</span>
            <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs">{ROTULO_RISCO[i.motivoPredominante]}</span>
            <a
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
            >
              Resolver no ML <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
