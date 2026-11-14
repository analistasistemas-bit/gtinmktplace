import { useEffect, useState } from 'react';
import { FileText, Paperclip } from 'lucide-react';
import { baixarAnexoMensagem, baixarAnexoReclamacao, type AnexoMensagem as Anexo } from '@/lib/mensagens';

const TIPOS_IMAGEM = ['image/jpeg', 'image/png'];
const TIPOS_BAIXAVEIS = [...TIPOS_IMAGEM, 'application/pdf'];

const tamanho = (n: number | null) =>
  n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Anexo recebido no balão (conversa por `packId`) ou no histórico da reclamação (`claimId`).
 *  Baixa só imagem/PDF sem ameaça; o resto mostra só o nome. */
export function AnexoMensagem({ packId, claimId, anexo }: { anexo: Anexo } & ({ packId: string; claimId?: never } | { claimId: string; packId?: never })) {
  const nome = anexo.original_filename || 'Anexo';
  const baixavel = !anexo.potential_security_threat && !!anexo.type && TIPOS_BAIXAVEIS.includes(anexo.type);
  const [url, setUrl] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  useEffect(() => {
    if (!baixavel) return;
    let ativo = true;
    let criada: string | null = null;
    (claimId ? baixarAnexoReclamacao(claimId, anexo.filename) : baixarAnexoMensagem(packId!, anexo.filename)).then((blob) => {
      if (!ativo) return;
      criada = URL.createObjectURL(blob);
      setUrl(criada);
    }).catch(() => { if (ativo) setIndisponivel(true); });
    return () => { ativo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [packId, claimId, anexo.filename, baixavel]);

  const base = 'mb-1 flex max-w-full items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/10';
  if (!baixavel) {
    return <div className={base}><Paperclip className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 truncate">{nome}</span></div>;
  }
  if (indisponivel) {
    return <div className={base}><Paperclip className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 truncate">{nome}</span><span className="shrink-0 text-wa-meta">Arquivo indisponível</span></div>;
  }
  if (!url) {
    return <div className={base} aria-busy><Paperclip className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 truncate">{nome}</span></div>;
  }
  if (anexo.type && TIPOS_IMAGEM.includes(anexo.type)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        <img src={url} alt={nome} className="max-h-48 max-w-full rounded-md object-cover" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`${base} hover:underline`}>
      <FileText className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{nome}</span>
      {anexo.size != null && <span className="shrink-0 text-wa-meta">{tamanho(anexo.size)}</span>}
    </a>
  );
}
