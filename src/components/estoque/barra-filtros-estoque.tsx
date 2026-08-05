// Toolbar da tela Estoque. Filtro e ordenação eram seis botões idênticos em fila, impossíveis de
// distinguir: agora filtro é um segmented control (excludente, estado visível) e ordenação é um
// select rotulado — dois controles de natureza diferente lidos como controles diferentes.
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
        {/* No mobile a busca ocupa a linha inteira: como `flex-1 min-w-0`, ela encolhia até ~50px
            em vez de empurrar o segmented control para a linha de baixo. */}
        <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome, código, SKU, GTIN, cor ou fornecedor…"
            value={termo}
            onChange={(e) => onTermo(e.target.value)}
          />
        </div>

        {/* Segmented control: o contêiner com borda é o que comunica "escolha uma destas". */}
        <div role="group" aria-label="Filtrar produtos" className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {FILTROS.map((f) => {
            const desabilitado = f.valor === 'nao-publicado' && canaisIndisponivel;
            const ativo = filtro === f.valor;
            return (
              <Button
                key={f.valor}
                type="button"
                size="sm"
                variant={ativo ? 'secondary' : 'ghost'}
                aria-pressed={ativo}
                disabled={desabilitado}
                onClick={() => onFiltro(f.valor)}
                className={cn('h-7', ativo && 'shadow-xs')}
              >
                {f.rotulo}
              </Button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span id="rotulo-ordem" className="text-xs text-muted-foreground">Ordenar por</span>
          <Select value={ordem} onValueChange={(v) => onOrdem(v as OrdemEstoque)}>
            <SelectTrigger aria-labelledby="rotulo-ordem" className="h-8 w-[9.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDENS.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
