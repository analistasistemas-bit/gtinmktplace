import { useEffect, useState } from 'react';
import { Tag, Sparkles, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { useDefinirCategoriaLivre } from '@/hooks/useFamiliaMutations';
import { buscarCategoriaML } from '@/lib/queries';
import { CATEGORIAS_MANUAIS } from '@/lib/categoria';
import { EditorAtributosFaltantes } from '@/components/editor-atributos-faltantes';
import type { Familia, TipoAviamento, CategoriaCandidata } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  return CATEGORIAS_MANUAIS.find((c) => c.tipo === tipo)?.rotulo ?? '—';
}

function BuscaCategoria({ familia }: { familia: Familia }) {
  const [query, setQuery] = useState('');
  const [candidatos, setCandidatos] = useState<CategoriaCandidata[]>([]);
  const [sugestao, setSugestao] = useState<CategoriaCandidata | null>(null);
  const [sugestaoCarregada, setSugestaoCarregada] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const definir = useDefinirCategoriaLivre(familia.loteId);

  // Carrega a sugestão do concorrente só quando o operador foca o campo (não no mount): evita 1
  // chamada de rede por card renderizado quando a Revisão lista várias famílias indefinidas de
  // uma vez. Idempotente (só a 1ª vez por card).
  const carregarSugestao = () => {
    if (sugestaoCarregada || !familia.concorrenciaCategoriaId) return;
    setSugestaoCarregada(true);
    buscarCategoriaML(familia.id, '').then((r) => setSugestao(r.sugestaoConcorrente)).catch(() => {});
  };

  const buscar = async () => {
    if (!query.trim()) return;
    setBuscando(true);
    try {
      const r = await buscarCategoriaML(familia.id, query);
      setCandidatos(r.candidatos);
    } catch (e) {
      toast.error('Erro ao buscar categoria', { description: (e as Error).message });
    } finally {
      setBuscando(false);
    }
  };

  const escolher = (c: CategoriaCandidata) =>
    definir.mutate(
      { familiaId: familia.id, categoriaMlId: c.categoriaId, categoriaNome: c.categoriaNome },
      { onError: (e) => toast.error('Erro ao definir categoria', { description: (e as Error).message }) },
    );

  return (
    <div className="flex flex-col gap-1.5">
      {sugestao && (
        <button
          type="button"
          onClick={() => escolher(sugestao)}
          disabled={definir.isPending}
          className="rounded-md border border-info/40 bg-info/5 p-1.5 text-left text-xs hover:bg-info/10"
        >
          <span className="font-medium">Sugestão (concorrente):</span> {sugestao.categoriaNome}
        </button>
      )}
      <div className="flex gap-1">
        <Input
          className="h-8 text-xs"
          placeholder="Buscar categoria (ex.: bainha)"
          value={query}
          onFocus={carregarSugestao}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
        />
        <Button size="sm" className="h-8 px-2" onClick={buscar} disabled={buscando || definir.isPending}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      {candidatos.length > 0 && (
        <div className="flex flex-col gap-1">
          {candidatos.map((c) => (
            <button
              key={c.categoriaId}
              type="button"
              onClick={() => escolher(c)}
              disabled={definir.isPending}
              className="rounded-md border p-1.5 text-left text-xs hover:bg-accent"
            >
              {c.categoriaNome} <span className="text-muted-foreground">({c.categoriaId})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardCategoria({ familia }: { familia: Familia }) {
  const categoriaIndefinida = !familia.categoriaMlId;
  // Genérico (ADR-0058): "Outros" já aplicado como fallback visível — a família não está mais
  // bloqueada, mas o selo de aviso chama atenção pra buscar uma categoria melhor se quiser.
  const categoriaGenerica = familia.tipoOrigem === 'generico';
  // Busca pra trocar categoria: sempre alcançável (não só quando genérica) — qualquer categoria
  // já definida pode estar errada (ex.: o operador escolheu manualmente e quer corrigir depois).
  // Some por padrão pra não poluir o caso feliz; abre sozinha quando genérica (sinal de baixa
  // confiança) ou ao clicar em "Trocar categoria". useEffect (não só o useState inicial) porque
  // o card pode virar genérico num refetch AO VIVO sem remontar (ex.: reprocessar com a tela
  // aberta, mesma key `familia.id`) — sem isso a busca ficava fechada até 1 clique extra.
  const [buscaAberta, setBuscaAberta] = useState(categoriaGenerica);
  useEffect(() => {
    if (categoriaGenerica) setBuscaAberta(true);
  }, [categoriaGenerica]);

  return (
    <div
      className={cn(
        'w-[200px] shrink-0 rounded-md border bg-card p-2 shadow-sm',
        categoriaIndefinida && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" /> Categoria
      </div>
      {categoriaIndefinida ? (
        <>
          <p className="mb-1.5 text-xs font-medium text-destructive">Categoria indefinida — busque antes de publicar</p>
          <BuscaCategoria familia={familia} />
        </>
      ) : (
        <>
          <p className="text-sm font-medium">
            {familia.categoriaNome ?? nomeCategoriaAmigavel(familia.tipoAviamento)}
          </p>
          <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
          {(familia.tipoOrigem === 'preditor' || familia.tipoOrigem === 'ia') && (
            <StatusPill tone="info" className="mt-1.5">
              <Sparkles className="h-3 w-3" /> Sugerida por IA — confira
            </StatusPill>
          )}
          {categoriaGenerica && (
            <StatusPill tone="warning" className="mt-1.5">
              <AlertTriangle className="h-3 w-3" /> Categoria genérica — busque uma melhor se quiser
            </StatusPill>
          )}
          {familia.atributosFaltantes && familia.atributosFaltantes.length > 0 && (
            <>
              <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Faltam: {familia.atributosFaltantes.join(', ')}</span>
              </p>
              <EditorAtributosFaltantes familiaId={familia.id} loteId={familia.loteId} />
            </>
          )}
          {buscaAberta ? (
            <div className="mt-1.5 border-t pt-1.5">
              <BuscaCategoria familia={familia} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBuscaAberta(true)}
              className="mt-1.5 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Trocar categoria
            </button>
          )}
        </>
      )}
    </div>
  );
}
