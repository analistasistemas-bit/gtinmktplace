// ADR-0201 (Task 10): cartão de uma imagem da galeria. Cobrança = exibição: só depois que o <img> carregou e
// `imagemValida` disse sim é que `onExibida` sai; branca/vazia → `onInvalida`; exceção (canvas contaminado) → nada.
// Falha de carga (rede, URL vencida, CORS) nunca é terminal: avisa e o próximo listar traz URL nova.
// Alertas da verificação por visão (R8.5) só avisam; nunca escondem a imagem.
// Aprovar (Task 12): compõe o arquivo final e aprova; recusa (texto que estoura, arquivo, referência) mostra o motivo.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { imagemValida } from '@/lib/galeria/exibicao';
import { fmtBRL } from '@/lib/formato';
import type { ImagemGaleria } from '@/lib/galeria/api';

const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
const ROTULO: Record<string, string> = {
  gerada: 'Gerada', aprovada: 'Aprovada', descartada: 'Descartada', desatualizada: 'Desatualizada', falhou: 'Falhou',
};

export function CartaoImagem({ imagem, onGerarDeNovo, onAprovar, bloqueioAprovar, onExibida, onInvalida, onFalhaCarga }: {
  imagem: ImagemGaleria;
  /** Sem handler o botão não aparece (roteiro aprovado de outra família: o servidor recusaria). */
  onGerarDeNovo?: (imagem: ImagemGaleria) => void;
  /** Compõe e aprova; devolve o motivo da recusa (null = aprovada). Sem handler o botão não aparece. */
  onAprovar?: (imagem: ImagemGaleria) => Promise<string | null>;
  /** Motivo para manter Aprovar desabilitado (vai no `title` e em texto visível), ex.: "lupa em ajuste". */
  bloqueioAprovar?: string;
  onExibida?: (id: string) => void;
  onInvalida?: (id: string) => void;
  /** Não carregou: o pai descarta a URL guardada para o próximo listar trazer outra. */
  onFalhaCarga?: (id: string) => void;
}) {
  const nome = `${imagem.cor} · missão ${imagem.missao}`;
  // URL que não carregou (não é prova de imagem ruim — nem confirma nem reporta); URL nova tenta de novo.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const quebrou = !!imagem.url && urlQuebrada === imagem.url;
  const aberta = ABERTOS.has(imagem.status);
  const cobravel = imagem.origem === 'gerador' && !imagem.exibida;

  async function aprovar() {
    setAprovando(true); setMotivo(null);
    try { setMotivo(await onAprovar!(imagem)); } finally { setAprovando(false); }
  }
  // Gerador só depois da verificação por visão (`alertas` nulo = pendente; o servidor recusaria).
  const aprovavel = imagem.status === 'gerada' && !!imagem.url && (imagem.origem === 'recorte' || imagem.alertas !== null);

  function carregou(img: HTMLImageElement) {
    if (!cobravel) return;
    let valida: boolean;
    try { valida = imagemValida(img); } catch { return; }
    if (valida) onExibida?.(imagem.id); else onInvalida?.(imagem.id);
  }

  return (
    <div className="space-y-2 rounded border p-2 text-sm" data-status={imagem.status}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{nome}</span>
        <span className="flex items-center gap-1">
          {imagem.origem === 'recorte' && <StatusPill tone="neutral">Recorte grátis</StatusPill>}
          {!aberta && <StatusPill tone={imagem.status === 'falhou' ? 'danger' : 'neutral'}>{ROTULO[imagem.status] ?? imagem.status}</StatusPill>}
        </span>
      </div>
      {aberta ? (
        <div className="flex aspect-[1200/1540] items-center justify-center rounded bg-muted text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando…
        </div>
      ) : imagem.url && imagem.status !== 'falhou' && !quebrou ? (
        <img src={imagem.url} alt={nome} crossOrigin="anonymous" className="w-full rounded object-contain"
          onLoad={(e) => carregou(e.currentTarget)} onError={() => { setUrlQuebrada(imagem.url); onFalhaCarga?.(imagem.id); }} />
      ) : quebrou ? (
        <p className="text-muted-foreground">Não foi possível exibir a imagem. Tentando de novo…</p>
      ) : (
        <p className="text-muted-foreground">{imagem.erro ? `Sem imagem (${imagem.erro})` : 'Sem imagem'}</p>
      )}
      {imagem.origem === 'gerador' && imagem.unit_cents !== null && !aberta && imagem.status !== 'falhou' && (
        <p className="text-xs text-muted-foreground">
          {imagem.exibida ? `Cobrada · ${fmtBRL(imagem.unit_cents / 100)}` : `${fmtBRL(imagem.unit_cents / 100)} ao exibir (preço do pedido)`}
        </p>
      )}
      {imagem.status === 'gerada' && imagem.origem === 'gerador' && imagem.alertas === null && (
        <p className="text-xs text-muted-foreground">Verificando a imagem…</p>
      )}
      {(imagem.alertas ?? []).length > 0 && (
        <ul role="alert" className="space-y-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          {imagem.alertas!.map((a, i) => <li key={i}>{a.nota}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {onGerarDeNovo && imagem.origem === 'gerador' && imagem.pode_gerar_de_novo && (
          <Button size="sm" variant="outline" onClick={() => onGerarDeNovo(imagem)}>Gerar de novo</Button>
        )}
        {onAprovar && aprovavel && (
          <Button size="sm" disabled={aprovando || !!bloqueioAprovar} title={bloqueioAprovar} onClick={() => void aprovar()}>
            {aprovando ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Aprovando…</> : 'Aprovar'}
          </Button>
        )}
      </div>
      {onAprovar && aprovavel && bloqueioAprovar && <p className="text-xs text-amber-700">{bloqueioAprovar}</p>}
      {motivo && <p role="alert" className="text-xs text-red-600">{motivo}</p>}
    </div>
  );
}
