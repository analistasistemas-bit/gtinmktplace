// ADR-0200 (adendo 12/11): prévia da galeria com as fotos das peças, abaixo da foto do kit. A foto 1 é a do kit; as outras
// vêm das peças da combinação (proposta do servidor). O operador só remove (restaurável) ou liga "Só a foto do kit".
import { RotateCcw, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { alternarFoto, idsDaGaleria, type EscolhaGaleria, type GaleriaProposta } from '@/lib/kit-galeria';
import { cn } from '@/lib/utils';

interface Props {
  proposta: GaleriaProposta | undefined;
  escolha: EscolhaGaleria | undefined;
  onChange: (e: EscolhaGaleria) => void;
  carregando?: boolean;
  /** Falha de rede ao ler a proposta. */
  erro?: boolean;
  desabilitado?: boolean;
}

const MOLDURA = 'grid gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5 text-xs';

export function GaleriaPecas({ proposta, escolha, onChange, carregando, erro, desabilitado }: Props) {
  if (carregando) {
    return (
      <div className={MOLDURA} aria-busy="true">
        <p className="text-muted-foreground">Lendo as fotos das peças no Mercado Livre…</p>
        <div className="flex gap-1.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-14" />)}</div>
      </div>
    );
  }
  if (erro || !proposta || proposta.indisponivel) {
    return (
      <div className={MOLDURA}>
        <p className="font-medium">Fotos das peças indisponíveis</p>
        {(proposta?.avisos ?? []).map((a) => <p key={a} className="text-muted-foreground">{a}</p>)}
        <p className="text-muted-foreground">O anúncio sai só com a foto do kit.</p>
      </div>
    );
  }
  if (proposta.fotos.length === 0) {
    return (
      <div className={MOLDURA}>
        <p className="font-medium">Fotos das peças</p>
        <p className="text-muted-foreground">Nenhuma foto de peça disponível para esta combinação. O anúncio leva só a foto do kit.</p>
        {proposta.avisos.map((a) => <p key={a} className="text-muted-foreground">{a}</p>)}
      </div>
    );
  }

  const ligada = escolha?.ligada !== false;
  const mantidas = new Set(idsDaGaleria(proposta, escolha));
  const total = mantidas.size;
  let posicao = 1;   // a foto 1 é a do kit
  return (
    <div className={MOLDURA}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Fotos das peças
          {ligada && (
            <span className="font-normal text-muted-foreground tabular-nums">
              {` · no anúncio: ${total} ${total === 1 ? 'foto' : 'fotos'} das peças`}
            </span>
          )}
        </p>
        <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
          <Switch
            size="sm" checked={!ligada} disabled={desabilitado} aria-label="Só a foto do kit"
            onCheckedChange={(c) => onChange({ ligada: !c, removidas: escolha?.removidas ?? [] })}
          />
          Só a foto do kit
        </label>
      </div>
      {ligada ? (
        <ol className="flex flex-wrap gap-1.5" aria-label="Fotos das peças no anúncio">
          {proposta.fotos.map((f) => {
            const fora = !mantidas.has(f.id);
            const numero = fora ? null : ++posicao;
            return (
              <li key={f.id} className={cn('relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-background', fora && 'opacity-45')}>
                {f.url
                  ? <img src={f.url} alt={`Foto da peça ${f.cor}`} loading="lazy" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">sem prévia</div>}
                <span className="absolute left-0 top-0 rounded-br-md bg-background/90 px-1 text-[10px] font-medium tabular-nums">
                  {numero ?? '–'}
                </span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-background/90 px-1 text-[10px] text-muted-foreground">{f.cor}</span>
                <button
                  type="button" disabled={desabilitado}
                  aria-label={fora ? `Restaurar foto de ${f.cor}` : `Remover foto ${numero} (${f.cor})`}
                  onClick={() => onChange(alternarFoto(escolha, f.id))}
                  className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-bl-md bg-background/90 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fora ? <RotateCcw className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground">Galeria desligada: o anúncio leva só a foto do kit.</p>
      )}
      {proposta.avisos.map((a) => <p key={a} className="text-muted-foreground">{a}</p>)}
    </div>
  );
}
