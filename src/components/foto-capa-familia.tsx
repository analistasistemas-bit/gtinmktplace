import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface Props {
  capaUrl: string | null;
  tamanho: 'small' | 'medium' | 'large';
  /** Opt-in de autocura. Na 1ª falha chama `renovar` (quem usa descarta a URL guardada e gera outra) e
   *  espera a URL nova; se ela também falhar, baixa a imagem por `fetch` (bloqueadores de extensão costumam
   *  barrar só o tipo "imagem"); se isso falhar, placeholder. Sem `renovar`, vai direto ao placeholder. */
  renovar?: () => void;
}

const CLASSE_FOTO = { small: 'h-10 w-10', medium: 'h-20 w-20', large: 'h-48 w-48' } as const;
const CLASSE_ICONE = { small: 'h-4 w-4', medium: 'h-6 w-6', large: 'h-8 w-8' } as const;

export function FotoCapaFamilia({ capaUrl, tamanho, renovar }: Props) {
  const classe = CLASSE_FOTO[tamanho];
  const [falhou, setFalhou] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Uma renovação e um fetch por montagem: sem isso, URL que falha sempre viraria laço.
  const renovou = useRef(false);
  const tentouFetch = useRef(false);

  // URL nova (troca de foto ou renovação) merece nova chance de carregar.
  useEffect(() => { setFalhou(false); setBlobUrl(null); }, [capaUrl]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const aoFalhar = () => {
    if (renovar && !renovou.current) {
      renovou.current = true;
      setFalhou(true); // placeholder até a URL nova chegar
      renovar();
      return;
    }
    if (renovar && capaUrl && !tentouFetch.current) {
      tentouFetch.current = true;
      fetch(capaUrl)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then((b) => { setBlobUrl(URL.createObjectURL(b)); setFalhou(false); })
        .catch(() => setFalhou(true));
      return;
    }
    setFalhou(true);
  };

  if (!capaUrl || falhou) {
    return (
      <div
        data-testid="capa-placeholder"
        className={`${classe} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border`}
      >
        <ImageIcon className={CLASSE_ICONE[tamanho]} />
      </div>
    );
  }
  return (
    <img
      src={blobUrl ?? capaUrl}
      alt="Capa da família"
      onError={aoFalhar}
      className={`${classe} shrink-0 rounded-md object-cover`}
    />
  );
}
