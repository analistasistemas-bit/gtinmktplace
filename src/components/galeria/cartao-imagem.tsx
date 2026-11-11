// ADR-0201 (Task 10): cartão de uma imagem da galeria. Cobrança = exibição: só depois que o <img> carregou e
// `imagemValida` disse sim é que `onExibida` sai; branca/vazia → `onInvalida`; exceção (canvas contaminado) → nada.
// Falha de carga (rede, URL vencida, CORS) nunca é terminal: avisa e o próximo listar traz URL nova.
// Alertas da verificação por visão (R8.5) só avisam; nunca escondem a imagem.
// Aprovar (Task 12): compõe o arquivo final e aprova; recusa (texto que estoura, arquivo, referência) mostra o motivo.
// Estados do protótipo: Gerando, Verificando, Pronta, Confira (alertas), Aprovada. Preço só no botão do passo.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { imagemValida } from '@/lib/galeria/exibicao';
import type { ImagemGaleria } from '@/lib/galeria/api';

const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
/** Teto de gerações por imagem no roteiro aprovado (a regra é do servidor; aqui só o contador do botão). */
const TETO_GERACOES = 3;
const OUTROS: Record<string, string> = { descartada: 'Descartada', desatualizada: 'Desatualizada', falhou: 'Não gerada' };

type Estado = 'gerando' | 'verificando' | 'pronta' | 'confira' | 'aprovada' | 'outro';
function estadoDoCartao(i: ImagemGaleria): Estado {
  if (ABERTOS.has(i.status)) return 'gerando';
  if (i.status === 'aprovada') return 'aprovada';
  if (i.status !== 'gerada') return 'outro';
  if (i.origem === 'gerador' && i.alertas === null) return 'verificando';
  return (i.alertas ?? []).length > 0 ? 'confira' : 'pronta';
}

const SELO: Record<Exclude<Estado, 'outro'>, { rotulo: string; tom: StatusTone }> = {
  gerando: { rotulo: 'Gerando', tom: 'info' }, verificando: { rotulo: 'Verificando', tom: 'info' }, pronta: { rotulo: 'Pronta', tom: 'neutral' },
  confira: { rotulo: 'Confira', tom: 'warning' }, aprovada: { rotulo: 'Aprovada', tom: 'success' },
};

export function CartaoImagem({ imagem, titulo, confirmacao, onGerarDeNovo, onAprovar, bloqueioAprovar, onExibida, onInvalida, onFalhaCarga }: {
  imagem: ImagemGaleria;
  /** Nome da imagem para o operador ("Capa · Branco"); sem ele, só a cor. */
  titulo?: string;
  /** Confirmação de "Gerar outra" junto ao cartão (o pai decide quando existe). */
  confirmacao?: ReactNode;
  /** Sem handler o botão não aparece (roteiro aprovado de outra família: o servidor recusaria). */
  onGerarDeNovo?: (imagem: ImagemGaleria) => void;
  /** Compõe e aprova; devolve o motivo da recusa (null = aprovada). Sem handler o botão não aparece. */
  onAprovar?: (imagem: ImagemGaleria) => Promise<string | null>;
  /** Motivo para manter Aprovar desabilitado (vai no `title` e em texto visível), ex.: "Em breve". */
  bloqueioAprovar?: string;
  onExibida?: (id: string) => void;
  onInvalida?: (id: string) => void;
  /** Não carregou: o pai descarta a URL guardada para o próximo listar trazer outra. */
  onFalhaCarga?: (id: string) => void;
}) {
  const nome = titulo ?? `Imagem · ${imagem.cor}`;
  // URL que não carregou (não é prova de imagem ruim: nem confirma nem reporta); URL nova tenta de novo.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const quebrou = !!imagem.url && urlQuebrada === imagem.url;
  const estado = estadoDoCartao(imagem);
  const cobravel = imagem.origem === 'gerador' && !imagem.exibida;

  async function aprovar() {
    setAprovando(true); setMotivo(null);
    try { setMotivo(await onAprovar!(imagem)); } finally { setAprovando(false); }
  }
  // Gerador só depois da verificação por visão (`alertas` nulo = pendente; o servidor recusaria).
  const aprovavel = imagem.status === 'gerada' && !!imagem.url && (imagem.origem === 'recorte' || imagem.alertas !== null);
  const restantes = Math.max(0, TETO_GERACOES - imagem.geracao);

  function carregou(img: HTMLImageElement) {
    if (!cobravel) return;
    let valida: boolean;
    try { valida = imagemValida(img); } catch { return; }
    if (valida) onExibida?.(imagem.id); else onInvalida?.(imagem.id);
  }

  const selo = estado === 'outro' ? { rotulo: OUTROS[imagem.status] ?? imagem.status, tom: (imagem.status === 'falhou' ? 'danger' : 'neutral') as StatusTone } : SELO[estado];
  return (
    <div className="flex flex-col gap-3 overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5 p-3 text-sm" data-status={imagem.status} data-estado={estado}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{nome}</span>
        <StatusPill tone={selo.tom}>
          {estado === 'gerando' && <Loader2 aria-hidden className="size-3 motion-safe:animate-spin" />}
          {estado === 'verificando' && <ScanSearch aria-hidden className="size-3" />}
          {estado === 'confira' && <AlertTriangle aria-hidden className="size-3" />}
          {estado === 'aprovada' && <Check aria-hidden className="size-3" />}
          {selo.rotulo}
        </StatusPill>
      </div>
      {estado === 'gerando' ? (
        <div className="flex aspect-[1200/1540] flex-col items-center justify-center gap-1 rounded bg-muted text-muted-foreground">
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
          <span>Gerando · cerca de 30 s</span>
        </div>
      ) : imagem.url && imagem.status !== 'falhou' && !quebrou ? (
        <img src={imagem.url} alt={nome} crossOrigin="anonymous" className="w-full rounded object-contain"
          onLoad={(e) => carregou(e.currentTarget)} onError={() => { setUrlQuebrada(imagem.url); onFalhaCarga?.(imagem.id); }} />
      ) : quebrou ? (
        <p className="text-muted-foreground">Não foi possível exibir a imagem. Tentando de novo…</p>
      ) : (
        <p className="text-muted-foreground" title={imagem.erro ?? undefined}>
          {imagem.erro || imagem.status === 'falhou' ? 'Não foi possível gerar esta imagem. Gere de novo.' : 'Sem imagem.'}
        </p>
      )}
      {estado === 'verificando' && <p className="text-xs text-muted-foreground">Verificando texto e produto…</p>}
      {(imagem.alertas ?? []).length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg bg-warning/10 p-2.5 text-xs ring-1 ring-warning/25">
          {imagem.alertas!.map((a, i) => <li key={i}>{a.nota}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {onAprovar && aprovavel && (
          <Button className="h-11 flex-1 px-4" disabled={aprovando || !!bloqueioAprovar} title={bloqueioAprovar} onClick={() => void aprovar()}>
            {aprovando ? <><Loader2 aria-hidden className="mr-1 size-3 motion-safe:animate-spin" />Aprovando…</> : <><Check aria-hidden />Aprovar</>}
          </Button>
        )}
        {onGerarDeNovo && imagem.origem === 'gerador' && imagem.pode_gerar_de_novo && (
          <Button variant="outline" className="h-11 flex-1 px-4" onClick={() => onGerarDeNovo(imagem)}>
            <RefreshCw aria-hidden />Gerar outra{restantes > 0 && ' '}{restantes > 0 && <span className="font-normal text-muted-foreground tabular-nums">({restantes} {restantes === 1 ? 'restante' : 'restantes'})</span>}
          </Button>
        )}
      </div>
      {onAprovar && aprovavel && bloqueioAprovar && <p className="text-xs text-warning">{bloqueioAprovar}</p>}
      {motivo && <p role="alert" className="text-xs text-destructive">{motivo}</p>}
      {confirmacao}
    </div>
  );
}
