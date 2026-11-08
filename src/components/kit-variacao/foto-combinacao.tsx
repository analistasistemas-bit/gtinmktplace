// ADR-0197 (Task 15): foto de uma combinação do kit (Criar e Gerenciar). Sempre dá para enviar a foto; com o módulo
// `imagem_ia`, também gerar por IA. A foto gerada fica como candidata e só vira a foto da combinação quando o operador
// clica "Usar esta foto", que só libera depois que a prévia carregou: sem aprovação, nada publica. Cada geração é um
// pedido novo (`requestId`); depois de falha incerta a repetição usa o mesmo, e a edge devolve a imagem já gerada em vez
// de gerar (e cobrar) de novo. Prévia sem URL: "Recarregar prévia" pede a mesma geração, sem gerar outra.
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { gerarFotoKitEdge } from '@/lib/kit-variacao-edge';
import { cn } from '@/lib/utils';

/** Falha definitiva: o mesmo pedido falharia de novo; o próximo clique é pedido novo. */
const DEFINITIVAS = new Set(['imagem_inadequada', 'pedido_diferente', 'falha_storage']);

export interface FotoGerada { path: string; url: string | null }
/** Arquivo enviado pelo operador ou foto gerada por IA já aprovada. */
export type FotoKit = File | FotoGerada;

export function FotoCombinacao({ rotulo, titulo = rotulo, cores, familiaBaseId, temImagemIA, valor, onChange }: {
  rotulo: string;
  titulo?: string;
  cores: string[];
  familiaBaseId: string;
  temImagemIA: boolean;
  valor: FotoKit | undefined;
  onChange: (f: FotoKit) => void;
}) {
  const [candidata, setCandidata] = useState<(FotoGerada & { requestId: string }) | null>(null);
  const [carregada, setCarregada] = useState(false);
  const [erroPrevia, setErroPrevia] = useState(false);
  const requestId = useRef('');
  const gerar = useMutation({
    // `recarregar`: o mesmo pedido da candidata, só para obter a URL de novo (a edge devolve a geração existente).
    mutationFn: async (recarregar?: string) => {
      const id = recarregar ?? (requestId.current ||= crypto.randomUUID());
      return { id, r: await gerarFotoKitEdge({ requestId: id, familiaBaseId, cores }) };
    },
    onSuccess: ({ id, r }) => {
      if (!r.ok) {
        // Só falha definitiva libera pedido novo. Desfecho incerto (rede, 5xx sem motivo, em andamento) repete o mesmo,
        // e a edge devolve a geração já registrada em vez de gerar e cobrar outra.
        if (r.motivo && DEFINITIVAS.has(r.motivo)) requestId.current = '';
        toast.error('Não foi possível gerar a foto', { description: r.mensagem });
        return;
      }
      if (id === requestId.current) requestId.current = '';
      setCarregada(false); setErroPrevia(false);
      setCandidata({ path: r.path, url: r.url, requestId: id });
    },
    onError: (e) => toast.error('Não foi possível gerar a foto', { description: (e as Error).message }),
  });

  return (
    <div className={cn('grid gap-2 rounded-md border p-2 text-sm', !valor && 'border-dashed')}>
      <label className="flex items-center gap-3">
        <FotoMiniatura valor={valor} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{titulo}</span>
          <span className="block text-xs text-muted-foreground">
            {valor instanceof File ? valor.name : valor ? 'Foto gerada por IA' : 'Escolher arquivo'}
          </span>
        </span>
        <input
          type="file" accept="image/*" className="sr-only" aria-label={`Foto ${rotulo}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange(file);
          }}
        />
      </label>
      {temImagemIA && (
        candidata ? (
          <div className="flex items-center gap-3 rounded-md bg-muted/40 p-2">
            {candidata.url && !erroPrevia
              ? <img
                  key={candidata.url} src={candidata.url} alt={`Foto gerada ${rotulo}`}
                  className="h-24 w-18 shrink-0 rounded object-cover"
                  onLoad={() => setCarregada(true)} onError={() => { setCarregada(false); setErroPrevia(true); }}
                />
              : <span aria-hidden className="h-24 w-18 shrink-0 rounded bg-muted" />}
            <div className="grid min-w-0 gap-1.5">
              <span className="text-xs text-muted-foreground">
                {carregada ? 'Confira se a peça não mudou antes de usar.' : 'A prévia precisa aparecer antes de usar a foto.'}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm" aria-label={`Usar foto gerada ${rotulo}`} disabled={!carregada}
                  onClick={() => { onChange({ path: candidata.path, url: candidata.url }); setCandidata(null); }}
                >
                  Usar esta foto
                </Button>
                {(!candidata.url || erroPrevia) && (
                  <Button
                    size="sm" variant="outline" aria-label={`Recarregar prévia ${rotulo}`} disabled={gerar.isPending}
                    onClick={() => gerar.mutate(candidata.requestId)}
                  >
                    Recarregar prévia
                  </Button>
                )}
                <Button size="sm" variant="outline" aria-label={`Gerar outra ${rotulo}`} disabled={gerar.isPending} onClick={() => gerar.mutate(undefined)}>
                  {gerar.isPending && <Loader2 className="size-3.5 animate-spin" />} Gerar outra
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            size="sm" variant="outline" className="justify-self-start" aria-label={`Gerar foto ${rotulo}`}
            disabled={gerar.isPending} onClick={() => gerar.mutate(undefined)}
          >
            {gerar.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {gerar.isPending ? 'Gerando…' : 'Gerar foto'}
          </Button>
        )
      )}
    </div>
  );
}

function FotoMiniatura({ valor }: { valor?: FotoKit }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!valor) { setUrl(null); return; }
    if (!(valor instanceof File)) { setUrl(valor.url); return; }
    if (typeof URL.createObjectURL !== 'function') { setUrl(null); return; }
    const u = URL.createObjectURL(valor);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [valor]);
  return url
    ? <img src={url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
    : <span aria-hidden className="h-12 w-12 shrink-0 rounded bg-muted" />;
}
