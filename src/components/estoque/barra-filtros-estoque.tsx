import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FiltroEstoque, OrdemEstoque } from '@/lib/produtos-saldo-filtro';

const FILTROS: Array<{ valor: FiltroEstoque; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'sem-estoque', rotulo: 'Sem estoque' },
  { valor: 'nao-publicado', rotulo: 'Não publicado' },
];

const ORDENS: Array<{ valor: OrdemEstoque; rotulo: string }> = [
  { valor: 'nome', rotulo: 'Nome (A-Z)' },
  { valor: 'saldo-asc', rotulo: 'Menor saldo' },
  { valor: 'recente', rotulo: 'Mais recente' },
];

export function BarraFiltrosEstoque({
  termo, filtro, ordem, canaisCarregando, canaisErro, onTermo, onFiltro, onOrdem,
}: {
  termo: string;
  filtro: FiltroEstoque;
  ordem: OrdemEstoque;
  /** Carregando é transitório — desabilita a opção, mas sem mensagem de erro. */
  canaisCarregando: boolean;
  /** Erro real — desabilita a opção E mostra o motivo. */
  canaisErro: boolean;
  onTermo: (v: string) => void;
  onFiltro: (v: FiltroEstoque) => void;
  onOrdem: (v: OrdemEstoque) => void;
}) {
  const canaisIndisponivel = canaisCarregando || canaisErro;
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Buscar por nome, código, SKU, GTIN, cor ou fornecedor…"
          value={termo}
          onChange={(e) => onTermo(e.target.value)}
        />
        <div className="flex gap-1">
          {FILTROS.map((f) => {
            const desabilitado = f.valor === 'nao-publicado' && canaisIndisponivel;
            return (
              <Button
                key={f.valor}
                type="button"
                size="sm"
                variant={filtro === f.valor ? 'secondary' : 'ghost'}
                aria-pressed={filtro === f.valor}
                disabled={desabilitado}
                onClick={() => onFiltro(f.valor)}
              >
                {f.rotulo}
              </Button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {ORDENS.map((o) => (
            <Button
              key={o.valor}
              type="button"
              size="sm"
              variant={ordem === o.valor ? 'secondary' : 'ghost'}
              aria-pressed={ordem === o.valor}
              onClick={() => onOrdem(o.valor)}
              className={cn(ordem === o.valor && 'font-medium')}
            >
              {o.rotulo}
            </Button>
          ))}
        </div>
      </div>
      {canaisErro && (
        <p className="text-xs text-muted-foreground">
          Não foi possível carregar os canais — o filtro por publicação está indisponível.
        </p>
      )}
    </div>
  );
}
