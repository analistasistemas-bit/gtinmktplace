import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { canaisOperaveis, canaisEmBreve } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import type { CanalAtivo } from '@/lib/canal-ativo';

/**
 * Barra global de canais (D2): "Todos" + canais operáveis + em-breve desabilitados
 * com tooltip. Controlado — as telas ligam em useCanalAtivo().
 */
export function CanalTabs({ canal, onCanal, habilitados, contadores, className }: {
  canal: CanalAtivo;
  onCanal: (c: CanalAtivo) => void;
  habilitados: string[];
  /** Contador opcional por canal (ex.: nº de anúncios) exibido na tab. */
  contadores?: Record<string, number>;
  className?: string;
}) {
  const operaveis = canaisOperaveis(habilitados);
  const emBreve = canaisEmBreve(habilitados);
  return (
    <Tabs value={canal} onValueChange={(v) => onCanal(v as CanalAtivo)} className={className}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="todos">Todos</TabsTrigger>
        {operaveis.map((c) => (
          <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
            <LogoCanal canal={c.id} />
            {c.nome}
            {contadores?.[c.id] != null && (
              <Badge variant="secondary" className="ml-0.5">{contadores[c.id]}</Badge>
            )}
          </TabsTrigger>
        ))}
        <TooltipProvider delayDuration={200}>
          {emBreve.map((c) => (
            <Tooltip key={c.id}>
              <TooltipTrigger asChild>
                {/* span: trigger desabilitado não dispara tooltip sem wrapper */}
                <span className="inline-flex">
                  <TabsTrigger value={c.id} disabled className="gap-1.5 opacity-50 grayscale">
                    <LogoCanal canal={c.id} />
                    {c.nome}
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Em breve no PubliAI</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </TabsList>
    </Tabs>
  );
}
