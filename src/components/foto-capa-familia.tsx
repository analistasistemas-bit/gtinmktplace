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
  const [baixar, setBaixar] = useState(false);
  // Uma renovação por montagem: sem isso, URL que falha sempre viraria laço.
  const renovou = useRef(false);

  // URL nova (troca de foto ou renovação) merece nova chance de carregar.
  useEffect(() => { setFalhou(false); setBlobUrl(null); setBaixar(false); }, [capaUrl]);

  // Fallback por fetch. O blob nasce e é revogado dentro do mesmo efeito, e `vivo` descarta a resposta
  // que chega depois de desmontar ou de a URL mudar (nem vaza blob nem pisa no estado novo).
  // Limite conhecido: se a renovação falhar ou devolver a mesma URL, este efeito não roda e fica o placeholder.
  useEffect(() => {
    if (!baixar || !capaUrl) return;
    let vivo = true;
    let criada: string | null = null;
    fetch(capaUrl)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((b) => { if (!vivo) return; criada = URL.createObjectURL(b); setBlobUrl(criada); setFalhou(false); })
      .catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [baixar, capaUrl]);

  const aoFalhar = () => {
    if (renovar && !renovou.current) {
      renovou.current = true;
      setFalhou(true); // placeholder até a URL nova chegar
      renovar();
      return;
    }
    if (renovar && !baixar) { setBaixar(true); return; }
    setFalhou(true);
  };

  if (!capaUrl || falhou || (baixar && !blobUrl)) {
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
