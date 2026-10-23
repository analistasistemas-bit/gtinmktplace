// Ação "Baixar fotos" do cartão de qualidade (ADR-0189 D-10, Task 19): ZIP local montado no painel. O anúncio e as fotos
// são os do clique; fechar o painel ou trocar de anúncio cancela. "Download solicitado", nunca "salvo": o painel não
// acompanha o arquivo depois que o Chrome o recebe.
import { useEffect, useRef, useState } from 'react';
import { MAX_BYTES_TOTAL, montarZipDeFotos, MAX_FOTOS, type ResultadoZip } from './baixar-fotos';

type Estado =
  | { fase: 'parado' }
  | { fase: 'baixando'; feitas: number; total: number }
  | { fase: 'pronto'; url: string; nome: string; r: ResultadoZip }
  | { fase: 'vazio'; r: ResultadoZip };

const lista = (n: number[]) => (n.length === 1 ? `${n[0]}` : `${n.slice(0, -1).join(', ')} e ${n.at(-1)}`);

function salvar(url: string, nome: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
}

export function BaixarFotos({ mlItemId, ids, clips }: { mlItemId: string; ids: string[]; clips: number | null }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });
  const cancelar = useRef<AbortController | null>(null);
  const urlAtual = useRef<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  // Foco no bloco: o controle focado some na troca de estado; o foco segue para o controle principal do estado novo.
  // Saiu do bloco (foco em outro lugar da página) → a conclusão assíncrona não o puxa de volta.
  const focoNoBloco = useRef(false);
  useEffect(() => {
    if (focoNoBloco.current) raiz.current?.querySelector<HTMLElement>('[data-foco]')?.focus();
  }, [estado.fase]);

  // Fechar o painel ou trocar de anúncio (remonta): para o download e solta o blob.
  useEffect(() => () => {
    cancelar.current?.abort();
    if (urlAtual.current) URL.revokeObjectURL(urlAtual.current);
  }, []);

  const baixar = async () => {
    if (cancelar.current) return; // já em andamento
    const controle = new AbortController();
    cancelar.current = controle;
    const item = mlItemId, fotos = [...ids]; // o do clique, mesmo que o painel mude depois
    setEstado({ fase: 'baixando', feitas: 0, total: Math.min(fotos.length, MAX_FOTOS) });
    try {
      const r = await montarZipDeFotos(fotos, { sinal: controle.signal, aoProgresso: (feitas, total) => setEstado({ fase: 'baixando', feitas, total }) });
      if (!r.zip) { setEstado({ fase: 'vazio', r }); return; }
      if (urlAtual.current) URL.revokeObjectURL(urlAtual.current);
      const url = URL.createObjectURL(new Blob([r.zip as BlobPart], { type: 'application/zip' }));
      urlAtual.current = url;
      const nome = `PubliAI-${item}-fotos.zip`;
      setEstado({ fase: 'pronto', url, nome, r });
      salvar(url, nome);
    } catch {
      if (!controle.signal.aborted) setEstado({ fase: 'vazio', r: { zip: null, incluidas: 0, falhas: [], alemDoLimite: 0, alemDoTamanho: 0 } });
      else setEstado({ fase: 'parado' });
    } finally {
      cancelar.current = null;
    }
  };

  return (
    <div
      className="bf" aria-live="polite" ref={raiz}
      onFocus={() => { focoNoBloco.current = true; }}
      onBlur={(e) => { if (e.relatedTarget && !raiz.current?.contains(e.relatedTarget as Node)) focoNoBloco.current = false; }}
    >
      {estado.fase === 'parado' && (
        <button type="button" className="secundario bf-botao" data-foco onClick={() => void baixar()}>
          Baixar fotos (ZIP)<span className="bf-qtd mono">{`${Math.min(ids.length, MAX_FOTOS)} ${ids.length === 1 ? 'foto' : 'fotos'}`}</span>
        </button>
      )}
      {estado.fase === 'baixando' && (
        <div className="bf-progresso" role="status">
          <span>{`Baixando foto ${Math.min(estado.feitas + 1, estado.total)} de ${estado.total}…`}</span>
          <button type="button" className="link" data-foco onClick={() => cancelar.current?.abort()}>Cancelar</button>
          <span className="bf-barra" aria-hidden="true"><span style={{ width: `${(estado.feitas / estado.total) * 100}%` }} /></span>
        </div>
      )}
      {estado.fase === 'pronto' && (
        <div className="bf-resultado">
          <p className="bf-ok">{`Download solicitado: ${estado.r.incluidas} ${estado.r.incluidas === 1 ? 'foto' : 'fotos'} na resolução original.`}</p>
          {estado.r.falhas.length > 0 && <p className="nota">{`${estado.r.falhas.length === 1 ? 'A foto' : 'As fotos'} ${lista(estado.r.falhas)} não ${estado.r.falhas.length === 1 ? 'veio' : 'vieram'}.`}</p>}
          {estado.r.alemDoLimite > 0 && <p className="nota">{`Limite de ${MAX_FOTOS} fotos por ZIP: ${estado.r.alemDoLimite} ficaram de fora.`}</p>}
          {estado.r.alemDoTamanho > 0 && <p className="nota">{`Limite de ${MAX_BYTES_TOTAL / 2 ** 20} MB por ZIP: ${estado.r.alemDoTamanho} ficaram de fora.`}</p>}
          <button type="button" className="link" data-foco onClick={() => salvar(estado.url, estado.nome)}>Salvar o ZIP de novo</button>
        </div>
      )}
      {estado.fase === 'vazio' && (
        <div className="bf-resultado" role="alert">
          <p>Nenhuma foto pôde ser baixada. Confira a conexão e tente de novo.</p>
          <button type="button" className="link" data-foco onClick={() => void baixar()}>Tentar de novo</button>
        </div>
      )}
      <p className="nota bf-aviso">
        {clips ? 'Clips não entram: são vídeos em streaming e podem ser de outro criador. ' : ''}
        Use só imagens que você tem autorização para reutilizar.
      </p>
    </div>
  );
}
