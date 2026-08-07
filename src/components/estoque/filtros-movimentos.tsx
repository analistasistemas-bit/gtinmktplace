// Barra de filtros do ledger. Fica fora de `movimentos-estoque.tsx` porque aquele componente já
// carrega estado de paginação + lista; juntar os três num arquivo só o tornaria difícil de ler.
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { cn } from '@/lib/utils';
import { GRUPOS_MOTIVO, ROTULO_GRUPO, type GrupoMotivo } from '@/lib/movimentos-estoque';
import type { Periodo } from '@/lib/metricas';

export interface VariacaoFiltro {
  codigo: string;
  cor: string | null;
}

interface Props {
  grupos: GrupoMotivo[];
  onGrupos: (g: GrupoMotivo[]) => void;
  /** null = todo o período. É o default: pré-aplicar data esconderia a entrada inicial de um
   *  produto parado, que foi exatamente o defeito que originou esta tela. */
  periodo: Periodo | null;
  onPeriodo: (p: Periodo | null) => void;
  codigo: string | null;
  onCodigo: (c: string | null) => void;
  variacoes: VariacaoFiltro[];
}

const TODAS = '__todas__';

function Chip({
  ativo, onClick, children,
}: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant={ativo ? 'default' : 'outline'}
      size="sm"
      className="h-7 px-2.5 text-xs"
      aria-pressed={ativo}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function FiltrosMovimentos({
  grupos, onGrupos, periodo, onPeriodo, codigo, onCodigo, variacoes,
}: Props) {
  // Um grupo por vez: os recortes que o operador pede são excludentes ("quero ver as entradas"),
  // e multi-seleção só criaria estados como "entradas + vendas" que equivalem a Todos.
  const alternar = (g: GrupoMotivo) => onGrupos(grupos[0] === g ? [] : [g]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <Chip ativo={grupos.length === 0} onClick={() => onGrupos([])}>Todos</Chip>
        {GRUPOS_MOTIVO.map((g) => (
          <Chip key={g} ativo={grupos[0] === g} onClick={() => alternar(g)}>
            {ROTULO_GRUPO[g]}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Chip ativo={periodo === null} onClick={() => onPeriodo(null)}>Todo o período</Chip>
        <div className={cn(periodo === null && 'opacity-60')}>
          <SeletorPeriodo
            periodo={periodo ?? { tipo: 'preset', dias: 30 }}
            onPeriodo={onPeriodo}
            rotulo="Movimentos nos últimos"
            semSelecao={periodo === null}
          />
        </div>
      </div>

      {variacoes.length > 1 && (
        <Select
          value={codigo ?? TODAS}
          onValueChange={(v) => onCodigo(v === TODAS ? null : v)}
        >
          <SelectTrigger className="h-7 w-[168px] text-xs" aria-label="Variação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as variações</SelectItem>
            {variacoes.map((v) => (
              <SelectItem key={v.codigo} value={v.codigo}>
                {v.cor ? `${v.codigo} · ${v.cor}` : v.codigo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
