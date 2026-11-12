// ADR-0200 (Task 15): foto de uma combinação do kit (Criar e Gerenciar). Sempre dá para enviar a foto; com o módulo
// `imagem_ia`, também gerar por IA. A foto gerada fica como candidata e só vira a foto da combinação quando o operador
// clica "Usar esta foto", que só libera depois que a prévia carregou: sem aprovação, nada publica. Cada geração é um
// pedido novo (`requestId`); depois de falha incerta a repetição usa o mesmo, e a edge devolve a imagem já gerada em vez
// de gerar (e cobrar) de novo. Prévia sem URL: "Recarregar prévia" pede a mesma geração, sem gerar outra.
// Adendo 1 do ADR-0200: a edge confere a foto contra a peça original. Reprovada com tentativa sobrando (`proxima`)
// repete sozinho o mesmo pedido; 3 reprovações mostram os motivos e nunca oferecem "Usar esta foto". "Ampliar"
// abre a gerada em tamanho real ao lado das originais e da conferência.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Maximize2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { gerarFotoKitEdge, type RespostaFotoKit } from '@/lib/kit-variacao-edge';
import { type ConferenciaFoto, PreviaAmpliada } from './previa-ampliada';
import { cn } from '@/lib/utils';

/** Falha definitiva: o mesmo pedido falharia de novo; o próximo clique é pedido novo. */
const DEFINITIVAS = new Set(['imagem_inadequada', 'pedido_diferente', 'falha_storage']);

export interface FotoGerada { path: string; url: string | null }
/** Arquivo enviado pelo operador ou foto gerada por IA já aprovada. */
export type FotoKit = File | FotoGerada;

/** Adendo 11/11 do ADR-0200: o diálogo comanda as fotos em lote (fila de 3) e a aprovação pela grade. */
export interface CandidataFoto extends FotoGerada { conferencia: ConferenciaFoto }
export interface ControleFoto {
  /** A mesma geração do botão, sem toast por falha (o lote mostra um resumo). true = candidata nova pronta para revisar. */
  gerar(): Promise<boolean>;
  candidata(): CandidataFoto | null;
  /** Vira a foto da combinação. Só a grade de aprovação chama, depois de mostrar a foto em tamanho real. */
  aprovar(): void;
}
export interface EstadoFoto { gerando: boolean; temCandidata: boolean; pronta: boolean; naoFiel: boolean }

const conferenciaDe = (r: RespostaFotoKit): ConferenciaFoto => ({
  itens: r.verificacao?.itens ?? [], motivos: r.motivos ?? r.verificacao?.motivos ?? [], originais: r.originais ?? [],
});

export function FotoCombinacao({ rotulo, titulo = rotulo, cores, familiaBaseId, temImagemIA, valor, onChange, controle, onEstado }: {
  rotulo: string;
  titulo?: string;
  cores: string[];
  familiaBaseId: string;
  temImagemIA: boolean;
  valor: FotoKit | undefined;
  onChange: (f: FotoKit) => void;
  controle?: Ref<ControleFoto>;
  onEstado?: (e: EstadoFoto) => void;
}) {
  const [candidata, setCandidata] = useState<(FotoGerada & { requestId: string; conferencia: ConferenciaFoto }) | null>(null);
  /** 3 reprovações: a IA não conseguiu uma foto fiel (só a prévia da última, sem "Usar"). */
  const [naoFiel, setNaoFiel] = useState<(ConferenciaFoto & { previaUrl: string | null }) | null>(null);
  const [tentativa, setTentativa] = useState(1);
  const [ampliar, setAmpliar] = useState(false);
  const [carregada, setCarregada] = useState(false);
  const [erroPrevia, setErroPrevia] = useState(false);
  const requestId = useRef('');
  const gerar = useMutation({
    // `recarregar`: o mesmo pedido da candidata, só para obter a URL de novo (a edge devolve a geração existente).
    // `silencioso`: chamada do lote, que mostra um resumo no lugar de um toast por falha.
    mutationFn: async (p?: { recarregar?: string; silencioso?: boolean }) => {
      const id = p?.recarregar ?? (requestId.current ||= crypto.randomUUID());
      setTentativa(1);
      let r = await gerarFotoKitEdge({ requestId: id, familiaBaseId, cores });
      // Reprovada com tentativa sobrando: o mesmo pedido gera a próxima com os motivos (teto da edge: 3).
      for (let i = 0; i < 3 && r.ok && r.aprovado === false && r.proxima; i++) {
        setTentativa((r.tentativa ?? 1) + 1);
        r = await gerarFotoKitEdge({ requestId: id, familiaBaseId, cores });
      }
      return { id, r };
    },
    onSuccess: ({ id, r }, p) => {
      if (!r.ok) {
        // Só falha definitiva libera pedido novo. Desfecho incerto (rede, 5xx sem motivo, em andamento) repete o mesmo,
        // e a edge devolve a geração já registrada em vez de gerar e cobrar outra.
        if (r.motivo && DEFINITIVAS.has(r.motivo)) requestId.current = '';
        if (!p?.silencioso) toast.error('Não foi possível gerar a foto', { description: r.mensagem });
        return;
      }
      if (r.aprovado === false) {
        // Desfecho definitivo da conferência: o próximo clique é pedido novo.
        if (id === requestId.current) requestId.current = '';
        setCandidata(null);
        setNaoFiel({ ...conferenciaDe(r), previaUrl: r.previa_url ?? null });
        return;
      }
      if (!r.path) {
        if (!p?.silencioso) toast.error('Não foi possível gerar a foto', { description: 'Resposta sem a foto. Tente de novo.' });
        return;
      }
      if (id === requestId.current) requestId.current = '';
      setCarregada(false); setErroPrevia(false); setNaoFiel(null);
      setCandidata({ path: r.path, url: r.url ?? null, requestId: id, conferencia: conferenciaDe(r) });
    },
    onError: (e, p) => { if (!p?.silencioso) toast.error('Não foi possível gerar a foto', { description: (e as Error).message }); },
  });

  useImperativeHandle(controle, () => ({
    async gerar() {
      try {
        const { r } = await gerar.mutateAsync({ silencioso: true });
        return r.ok && r.aprovado !== false && !!r.path;
      } catch { return false; }
    },
    candidata: () => (candidata ? { path: candidata.path, url: candidata.url, conferencia: candidata.conferencia } : null),
    aprovar() {
      if (!candidata) return;
      onChange({ path: candidata.path, url: candidata.url });
      setCandidata(null);
    },
  }), [gerar, candidata, onChange]);
  useEffect(() => {
    onEstado?.({ gerando: gerar.isPending, temCandidata: !!candidata, pronta: !!candidata && carregada, naoFiel: !!naoFiel });
  }, [onEstado, gerar.isPending, candidata, carregada, naoFiel]);

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
                  className="h-24 w-18 shrink-0 rounded bg-background object-contain"
                  onLoad={() => setCarregada(true)} onError={() => { setCarregada(false); setErroPrevia(true); }}
                />
              : <span aria-hidden className="h-24 w-18 shrink-0 rounded bg-muted" />}
            <div className="grid min-w-0 gap-1.5">
              {candidata.conferencia.itens.length > 0 && (
                <StatusPill tone="success">Conferida com a peça original</StatusPill>
              )}
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
                    onClick={() => gerar.mutate({ recarregar: candidata.requestId })}
                  >
                    Recarregar prévia
                  </Button>
                )}
                {candidata.url && (
                  <Button size="sm" variant="outline" aria-label={`Ampliar ${rotulo}`} onClick={() => setAmpliar(true)}>
                    <Maximize2 className="size-3.5" /> Ampliar
                  </Button>
                )}
                <Button size="sm" variant="outline" aria-label={`Gerar outra ${rotulo}`} disabled={gerar.isPending} onClick={() => gerar.mutate(undefined)}>
                  {gerar.isPending && <Loader2 className="size-3.5 animate-spin" />} Gerar outra
                </Button>
              </div>
            </div>
            <PreviaAmpliada
              open={ampliar} onOpenChange={setAmpliar} rotulo={rotulo} url={candidata.url} aprovada
              conferencia={candidata.conferencia} gerando={gerar.isPending} onGerarDeNovo={() => gerar.mutate(undefined)}
              onUsar={() => { onChange({ path: candidata.path, url: candidata.url }); setCandidata(null); }}
            />
          </div>
        ) : naoFiel && !gerar.isPending ? (
          <div role="alert" className="grid gap-2 rounded-md border border-danger/30 bg-danger/5 p-2">
            <span className="font-medium">A IA não conseguiu uma foto fiel</span>
            <ul className="grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
              {naoFiel.motivos.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <span className="text-xs">Envie uma foto própria da combinação no campo acima, ou tente gerar de novo.</span>
            <div className="flex flex-wrap gap-1.5">
              {naoFiel.previaUrl && (
                <Button size="sm" variant="outline" aria-label={`Ampliar ${rotulo}`} onClick={() => setAmpliar(true)}>
                  <Maximize2 className="size-3.5" /> Ampliar
                </Button>
              )}
              <Button size="sm" variant="outline" aria-label={`Gerar de novo ${rotulo}`} onClick={() => gerar.mutate(undefined)}>
                <Sparkles className="size-3.5" /> Gerar de novo
              </Button>
            </div>
            <PreviaAmpliada
              open={ampliar} onOpenChange={setAmpliar} rotulo={rotulo} url={naoFiel.previaUrl} aprovada={false}
              conferencia={naoFiel} gerando={gerar.isPending} onGerarDeNovo={() => gerar.mutate(undefined)}
            />
          </div>
        ) : (
          <Button
            size="sm" variant="outline" className="justify-self-start" aria-label={`Gerar foto ${rotulo}`}
            disabled={gerar.isPending} onClick={() => gerar.mutate(undefined)}
          >
            {gerar.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {gerar.isPending ? (tentativa > 1 ? `Corrigindo (tentativa ${tentativa} de 3)…` : 'Gerando e conferindo…') : 'Gerar foto'}
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
