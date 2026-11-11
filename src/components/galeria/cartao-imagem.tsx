// ADR-0203: cartão de UMA imagem possível (cor × posição) da tela única. Estados: vazio, indisponível, gerando
// (aberta ou esperando a conferência do texto), pronta, aprovada, falhou. Mostra sempre a geração mais recente.
// Cobrança = exibição: só depois que o <img> carregou e `imagemValida` disse sim é que `onExibida` sai; branca/vazia →
// `onInvalida`; exceção (canvas contaminado) → nada. Falha de carga nunca é terminal: o próximo listar traz URL nova.
// Alertas da conferência do texto só avisam: nunca bloqueiam o Aprovar.
import { useState } from 'react';
import { Check, ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { emAndamento, imagemValida } from '@/lib/galeria/exibicao';
import { mensagemErro, type AlertaImagem, type ImagemGaleria } from '@/lib/galeria/api';

type EstadoCartao = 'vazio' | 'indisponivel' | 'gerando' | 'pronta' | 'aprovada' | 'falhou';
function estadoDoCartao(i: ImagemGaleria | undefined, indisponivel?: string): EstadoCartao {
  if (!i) return indisponivel ? 'indisponivel' : 'vazio';
  if (emAndamento(i)) return 'gerando';
  if (i.status === 'aprovada') return 'aprovada';
  if (i.status === 'falhou') return 'falhou';
  return 'pronta';
}

function textoAlerta(a: AlertaImagem): string {
  if (a.tipo === 'texto_extra') return `Texto a mais na imagem: ${a.nota}`;
  if (a.tipo === 'texto_faltando') return `Faltou ou saiu errado o texto: ${a.nota}`;
  if (a.tipo === 'verificacao_indisponivel') return 'Não foi possível conferir o texto. Confira antes de aprovar.';
  return a.nota;
}

const MOLDURA = 'aspect-[1200/1540] w-full rounded-lg bg-muted';

export function CartaoImagem({ nome, cor, preco, imagem, indisponivel, antiga = false, temAprovada = false, travado = false,
  onGerar, onAprovar, onExibida, onInvalida, onFalhaCarga }: {
  /** Nome da imagem para o operador ("Capa", "Ficha técnica"). */
  nome: string;
  cor: string;
  /** Preço por imagem já formatado ("R$ 0,50"). */
  preco: string;
  /** Geração mais recente desta cor e posição (ausente = ainda não gerada). */
  imagem?: ImagemGaleria;
  /** Motivo de a posição não poder ser gerada (sem botão). */
  indisponivel?: string;
  /** Imagem de um plano anterior: aparece sem Aprovar. */
  antiga?: boolean;
  /** Existe outra geração aprovada desta posição (a que está à mostra é mais nova). */
  temAprovada?: boolean;
  /** Um pedido está em voo: nenhum botão de gerar vale. */
  travado?: boolean;
  /** "Gerar", "Gerar outra" e "Tentar de novo". */
  onGerar?: () => void;
  /** Compõe o arquivo final e aprova; devolve o motivo da recusa (null = aprovada). */
  onAprovar?: (imagem: ImagemGaleria) => Promise<string | null>;
  onExibida?: (id: string) => void;
  onInvalida?: (id: string) => void;
  /** Não carregou: o pai descarta a URL guardada para o próximo listar trazer outra. */
  onFalhaCarga?: (id: string) => void;
}) {
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const estado = estadoDoCartao(imagem, indisponivel);
  const quebrou = !!imagem?.url && urlQuebrada === imagem.url;
  const alertas = estado === 'pronta' || estado === 'aprovada' ? imagem?.alertas ?? [] : [];

  async function aprovar() {
    setAprovando(true); setMotivo(null);
    try { setMotivo(await onAprovar!(imagem!)); } finally { setAprovando(false); }
  }

  function carregou(img: HTMLImageElement) {
    if (!imagem || imagem.exibida) return;
    let valida: boolean;
    try { valida = imagemValida(img); } catch { return; }
    if (valida) onExibida?.(imagem.id); else onInvalida?.(imagem.id);
  }

  // Imagem de plano anterior sempre pode ser refeita (é o único jeito de ela valer de novo).
  const gerarOutra = !!onGerar && (antiga || !!imagem?.pode_gerar_de_novo);
  return (
    <div data-estado={estado} data-posicao={imagem?.missao}
      className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl bg-card p-2.5 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="truncate font-semibold" title={nome}>{nome}</span>
        {estado === 'aprovada' && <StatusPill tone="success"><Check aria-hidden className="size-3" />Aprovada</StatusPill>}
      </div>

      {estado === 'gerando' ? (
        <div role="status" className={`${MOLDURA} flex flex-col items-center justify-center gap-1.5 text-muted-foreground`}>
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
          <span>Gerando…</span>
        </div>
      ) : (estado === 'pronta' || estado === 'aprovada') && imagem?.url && !quebrou ? (
        <img src={imagem.url} alt={`${nome} · ${cor}`} crossOrigin="anonymous" className={`${MOLDURA} object-cover`}
          onLoad={(e) => carregou(e.currentTarget)} onError={() => { setUrlQuebrada(imagem.url); onFalhaCarga?.(imagem.id); }} />
      ) : estado === 'pronta' || estado === 'aprovada' ? (
        <div className={`${MOLDURA} flex flex-col items-center justify-center gap-1.5 p-2 text-center text-xs text-muted-foreground`}>
          <ImageOff aria-hidden className="size-4" />
          {quebrou ? 'Não foi possível exibir a imagem. Tentando de novo…' : 'Sem imagem.'}
        </div>
      ) : (
        <div className={`${MOLDURA} flex items-center justify-center border border-dashed p-2 text-center text-xs text-muted-foreground`}>
          {estado === 'indisponivel' ? indisponivel
            : estado === 'falhou' ? (imagem?.erro ? mensagemErro(imagem.erro) : 'Não foi possível gerar esta imagem.')
              : 'Ainda não gerada'}
        </div>
      )}

      {antiga && estado === 'pronta' && <p className="text-xs text-warning">Imagem de uma versão anterior. Gere de novo.</p>}
      {temAprovada && estado !== 'aprovada' && <p className="text-xs text-muted-foreground">Existe uma versão aprovada desta imagem.</p>}
      {alertas.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warning/10 p-2 text-xs ring-1 ring-warning/25">
          {alertas.map((a, k) => <li key={k}>{textoAlerta(a)}</li>)}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {estado === 'vazio' && onGerar && (
          <Button className="h-10 w-full px-3" disabled={travado} onClick={onGerar}>Gerar · {preco}</Button>
        )}
        {estado === 'falhou' && onGerar && (
          <Button variant="outline" className="h-10 w-full px-3" disabled={travado} onClick={onGerar}>
            <RefreshCw aria-hidden />Tentar de novo
          </Button>
        )}
        {estado === 'pronta' && !antiga && !!imagem?.url && onAprovar && (
          <Button className="h-10 w-full px-3" disabled={aprovando} onClick={() => void aprovar()}>
            {aprovando ? <><Loader2 aria-hidden className="motion-safe:animate-spin" />Aprovando…</> : <><Check aria-hidden />Aprovar</>}
          </Button>
        )}
        {(estado === 'pronta' || estado === 'aprovada') && gerarOutra && (
          <Button variant="outline" className="h-10 w-full px-3" disabled={travado} onClick={onGerar}>
            <RefreshCw aria-hidden />Gerar outra
          </Button>
        )}
      </div>
      {motivo && <p role="alert" className="text-xs text-destructive">{motivo}</p>}
    </div>
  );
}
