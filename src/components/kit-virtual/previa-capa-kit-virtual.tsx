// Prévia da capa do kit virtual gerada por IA: produtos distintos (legenda "2× Shampoo · 1× Máscara"). Aprovada:
// "Usar esta foto" só libera com a imagem carregada. Reprovada: só os motivos e "Gerar de novo".
import { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';

export function PreviaCapaKitVirtual({ url, aprovada, motivos, legenda, gerando, onUsar, onGerarDeNovo }: {
  url: string | null;
  aprovada: boolean;
  motivos: string[];
  /** Ex.: "2× Shampoo · 1× Máscara". */
  legenda: string;
  gerando: boolean;
  onUsar?: () => void;
  onGerarDeNovo: () => void;
}) {
  const [carregada, setCarregada] = useState(false);
  const [erroImagem, setErroImagem] = useState(false);
  const exibir = url && !erroImagem;
  return (
    <div id="kit-virtual-capa-ia" className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[10rem_minmax(0,1fr)]" aria-label="Capa do kit gerada por IA">
      {exibir
        ? <img
            key={url} src={url} alt="Capa do kit gerada por IA"
            className="aspect-square w-40 max-w-full rounded-md bg-background object-contain ring-1 ring-border"
            onLoad={() => setCarregada(true)} onError={() => { setCarregada(false); setErroImagem(true); }}
          />
        : <span aria-hidden className="grid aspect-square w-40 max-w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">
            {aprovada ? 'Prévia indisponível' : ''}
          </span>}
      <div className="grid min-w-0 content-start gap-2">
        {aprovada
          ? <StatusPill tone="success">Aprovada na conferência</StatusPill>
          : <StatusPill tone="danger">Reprovada</StatusPill>}
        <span className="text-xs text-muted-foreground">{legenda}</span>
        {aprovada ? (
          <ul className="grid gap-1 text-xs" aria-label="Conferência da capa do kit">
            {['Produtos e quantidades conferidos', 'Texto: nenhum texto novo ou alterado', 'Fundo: neutro'].map((t) => (
              <li key={t} className="flex gap-1.5"><Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />{t}</li>
            ))}
          </ul>
        ) : (
          <ul className="grid gap-1 text-xs" aria-label="Motivos da reprovação da capa do kit">
            {motivos.map((m) => (
              <li key={m} className="flex gap-1.5"><X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />{m}</li>
            ))}
          </ul>
        )}
        {aprovada && (
          <span className="text-xs text-muted-foreground">
            {carregada ? 'Confira os produtos e as quantidades antes de usar.' : 'A prévia precisa aparecer antes de usar a foto.'}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {aprovada && onUsar && (
            <Button size="sm" aria-label="Usar capa gerada do kit" disabled={!carregada || gerando} onClick={onUsar}>
              Usar esta foto
            </Button>
          )}
          <Button size="sm" variant="outline" aria-label="Gerar de novo a capa do kit" disabled={gerando} onClick={onGerarDeNovo}>
            {gerando ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Gerar de novo
          </Button>
        </div>
      </div>
    </div>
  );
}
