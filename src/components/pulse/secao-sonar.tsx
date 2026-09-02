// Cabeçalho padrão dos blocos do Sonar. Antes eram quatro Cards com quatro cabeçalhos ligeiramente
// diferentes (badge num, subtítulo text-xs noutro, "6." no terceiro), e nenhum colapsado — a tabela
// começava a 2.128px do topo em 1440 (medido).
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// rev-fable: a versão original guardava o estado só por dentro e pedia `key={aberta ? …}` para a DRE
// reabrir pelo "Simular". Isso (a) deixava `onAlternar` sem uso em `SonarDre` → lint reprova; (b) não
// reabre quando o operador fechou a DRE à mão e clica "Simular" de novo (`dreAberta` já era true, a
// key não muda). Controlada opcional custa 3 linhas e resolve os dois.
export function SecaoSonar({
  id, titulo, subtitulo, selo, colapsavelAbertaPorPadrao, aberta: abertaControlada, onAlternar, acoes, children,
}: {
  id?: string;
  titulo: string;
  subtitulo?: ReactNode;
  selo?: ReactNode;
  /** Ausente = não colapsa (a seção é sempre aberta). Presente = colapsa, com este estado inicial. */
  colapsavelAbertaPorPadrao?: boolean;
  /** Modo controlado (a DRE precisa ser ABERTA pelo "Simular" da tabela): quem passa `aberta` também
   *  passa `onAlternar`, e `colapsavelAbertaPorPadrao` vira só o "é colapsável". */
  aberta?: boolean;
  onAlternar?: (aberta: boolean) => void;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const colapsavel = colapsavelAbertaPorPadrao !== undefined;
  const [abertaInterna, setAbertaInterna] = useState(colapsavelAbertaPorPadrao ?? true);
  const aberta = abertaControlada ?? abertaInterna;
  const setAberta = (v: boolean) => { setAbertaInterna(v); onAlternar?.(v); };
  const mostrar = !colapsavel || aberta;

  const cabecalho = (
    <div className="min-w-0 text-left">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {titulo}
        {selo}
      </h3>
      {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
    </div>
  );

  return (
    <Card id={id} className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {colapsavel ? (
          <button
            type="button"
            aria-expanded={aberta}
            onClick={() => setAberta(!aberta)}
            className="flex min-w-0 items-start gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', !aberta && '-rotate-90')}
              aria-hidden
            />
            {cabecalho}
          </button>
        ) : cabecalho}
        {acoes}
      </div>
      {/* Desmontado, não escondido (`hidden`): o conteúdo fechado não deve entrar na árvore de
          acessibilidade nem no `getByText` dos testes. (As cotações da DRE vivem em `SonarDre`, que
          fica montada — e só disparam com os quatro campos do pacote preenchidos.) */}
      {mostrar && <div className="mt-3">{children}</div>}
    </Card>
  );
}
