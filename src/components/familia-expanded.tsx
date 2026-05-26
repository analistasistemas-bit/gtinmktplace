import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { VariacaoCard } from '@/components/variacao-card';
import type { Familia } from '@/lib/mocks/types';

export function FamiliaExpanded({ familia }: { familia: Familia }) {
  const [titulo, setTitulo] = useState(familia.titulo);
  const [descricao, setDescricao] = useState(familia.descricao);
  const [variacoes, setVariacoes] = useState(familia.variacoes);

  function mudarPreco(codigo: string, novoPreco: number) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, preco: novoPreco } : v)));
  }

  function mudarCor(codigo: string, novaCor: string) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, cor: novaCor } : v)));
  }

  return (
    <div className="border-b bg-muted/30 p-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">TÍTULO</label>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />

          <label className="mb-1 mt-3 block text-xs font-semibold text-muted-foreground">DESCRIÇÃO</label>
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={5}
          />

          <div className="mt-4 flex items-center gap-2">
            <Badge variant={familia.estrategiaPreco === 'PROPRIO' ? 'outline' : 'secondary'}>
              {familia.estrategiaPreco}
            </Badge>
            <span className="text-xs text-muted-foreground">{familia.estrategiaMotivo}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Concorrência: <span className="font-medium">{familia.concorrencia}</span>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">
            VARIAÇÕES ({variacoes.length})
          </label>
          <div className="flex flex-col gap-2">
            {variacoes.map((v) => (
              <VariacaoCard
                key={v.codigo}
                variacao={v}
                onMudarPreco={mudarPreco}
                onMudarCor={mudarCor}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
