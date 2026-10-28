import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  ehAcaoPendente, executarAcaoPosvenda, verificarAcaoPosvenda,
  type BodyAcaoPosvenda, type EstadoAcaoPosvenda, type ResultadoAcaoPosvenda,
} from '@/lib/posvenda';
import type { ErroEdge } from '@/lib/edge';

export const MSG_RECONECTAR = 'Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita).';
export const URL_ML_RECLAMACOES = 'https://www.mercadolivre.com.br/vendas/lista';
const RELEITURA_MS = 10_000;

type CorpoEnvio = Omit<BodyAcaoPosvenda, 'operacao_id' | 'claim_id'>;

type Fase =
  | { t: 'form' }
  | { t: 'enviando' }
  | { t: 'erro'; msg: string; repetivel: boolean }
  | { t: 'resultado'; estado: EstadoAcaoPosvenda; pendente: boolean; sincronizacao: boolean };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** O que acontece no ML (frase curta); o aviso "não dá para desfazer" é fixo. */
  efeito: string;
  claimId: string;
  /** Tudo que vai ao ML além de operacao_id/claim_id. */
  corpo: CorpoEnvio;
  podeEnviar: boolean;
  rotuloEnviar?: string;
  linkML?: string;
  /** Formulário da ação; fica desabilitado depois do 1º envio (o corpo não pode mudar sob o mesmo operacao_id). */
  children?: ReactNode;
  onConcluido?: () => void;
}

function Corpo({ titulo, efeito, claimId, corpo, podeEnviar, rotuloEnviar, linkML, children, onConcluido, onFechar }: Omit<Props, 'open' | 'onOpenChange'> & { onFechar: () => void }) {
  // Gerado ao ABRIR (este componente só monta com o diálogo aberto) e reusado em qualquer repetição/conferência.
  const [operacaoId] = useState<string>(() => crypto.randomUUID());
  const [fase, setFase] = useState<Fase>({ t: 'form' });
  const [aviso, setAviso] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const ocupado = useRef(false);
  const operacaoVerificar = useRef(operacaoId); // vira a da tentativa em aberto num 409

  const aplicar = (r: ResultadoAcaoPosvenda) => {
    setAviso(null);
    setFase({ t: 'resultado', estado: r.estado, pendente: r.pendenteConfirmacao, sincronizacao: r.sincronizacaoPendente });
    if (r.estado === 'confirmada') onConcluido?.();
  };

  const guardado = async (fn: () => Promise<void>) => {
    if (ocupado.current) return; // duplo clique / reentrada: no máximo uma chamada em voo
    ocupado.current = true;
    try { await fn(); } finally { ocupado.current = false; }
  };

  const enviar = () => guardado(async () => {
    setTentou(true);
    setAviso(null);
    setFase({ t: 'enviando' });
    try {
      aplicar(await executarAcaoPosvenda({ operacao_id: operacaoId, claim_id: claimId, ...corpo }));
    } catch (e) {
      const pend = ehAcaoPendente(e);
      if (pend) {
        operacaoVerificar.current = pend.operacao_id;
        setFase({ t: 'resultado', estado: pend.estado, pendente: true, sincronizacao: false });
        return;
      }
      const codigo = (e as ErroEdge).codigo;
      const msg = codigo === 'reconectar' ? MSG_RECONECTAR : (e as Error).message;
      // Sem `codigo` = falha de rede/servidor: repetir com o MESMO operacao_id é seguro (idempotente).
      setFase({ t: 'erro', msg, repetivel: !codigo });
    }
  });

  const verificar = () => guardado(async () => {
    try {
      aplicar(await verificarAcaoPosvenda(operacaoVerificar.current, claimId));
    } catch (e) {
      setAviso((e as Error).message);
    }
  });

  const estado = fase.t === 'resultado' ? fase.estado : null;
  const emConfirmacao = estado === 'enviada' || estado === 'reservada';
  useEffect(() => {
    if (!emConfirmacao) return;
    const h = setTimeout(() => { void verificar(); }, RELEITURA_MS);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagenda a cada nova leitura (aviso/fase mudam)
  }, [emConfirmacao, fase, aviso]);

  const bloqueado = tentou;
  const podeClicar = podeEnviar && fase.t !== 'enviando';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription className="sr-only">{efeito}</DialogDescription>
      </DialogHeader>

      {children && <fieldset disabled={bloqueado} className="min-w-0 space-y-3 border-0 p-0">{children}</fieldset>}

      {fase.t === 'form' || fase.t === 'enviando' || fase.t === 'erro' ? (
        <div className="flex gap-2 rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{efeito} Não dá para desfazer.</span>
        </div>
      ) : null}

      {fase.t === 'erro' && <p role="alert" className="text-xs text-destructive">{fase.msg}</p>}

      {fase.t === 'resultado' && (
        <Resultado estado={fase.estado} pendente={fase.pendente} sincronizacao={fase.sincronizacao} aviso={aviso} linkML={linkML} />
      )}

      <DialogFooter>
        {fase.t === 'resultado' ? (
          <>
            {(estado === 'desconhecido' || (fase.pendente && estado !== 'confirmada' && estado !== 'recusada')) && (
              <Button variant="outline" onClick={() => void verificar()}>Conferir agora</Button>
            )}
            <Button onClick={onFechar}>Fechar</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onFechar} disabled={fase.t === 'enviando'}>Cancelar</Button>
            {(fase.t !== 'erro' || fase.repetivel) && (
              <Button onClick={() => void enviar()} disabled={!podeClicar}>
                {fase.t === 'enviando' ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</> : fase.t === 'erro' ? 'Tentar de novo' : (rotuloEnviar ?? 'Enviar ao ML')}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
}

function Resultado({ estado, pendente, sincronizacao, aviso, linkML }: {
  estado: EstadoAcaoPosvenda; pendente: boolean; sincronizacao: boolean; aviso: string | null; linkML?: string;
}) {
  const link = (
    <a href={linkML ?? URL_ML_RECLAMACOES} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
      Abrir no Mercado Livre<ExternalLink className="h-3 w-3" />
    </a>
  );
  let corpo: ReactNode;
  if (estado === 'confirmada') {
    corpo = <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" />Confirmado pelo Mercado Livre.{sincronizacao && ' A tela atualiza em instantes.'}</span>;
  } else if (estado === 'enviada' || estado === 'reservada') {
    corpo = <span className="flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" />Enviado; confirmando…</span>;
  } else if (estado === 'desconhecido') {
    corpo = <>Não sabemos se o ML recebeu. Não vamos reenviar; estamos conferindo.</>;
  } else if (estado === 'inconclusiva') {
    corpo = <>Não conseguimos confirmar o efeito. Confira no Mercado Livre. {link}</>;
  } else if (estado === 'recusada') {
    corpo = <span className="text-destructive">O Mercado Livre recusou a ação.</span>;
  } else {
    corpo = <>Ação cancelada; nada foi enviado.</>;
  }
  return (
    <div role="status" className="space-y-1 rounded-lg bg-muted p-3 text-sm">
      <div>{corpo}</div>
      {pendente && estado !== 'confirmada' && estado !== 'inconclusiva' && estado !== 'recusada' && (
        <div className="text-xs text-muted-foreground">Ainda aguardando confirmação do ML. {link}</div>
      )}
      {aviso && <div className="text-xs text-destructive">{aviso}</div>}
    </div>
  );
}

export function DialogoConfirmarAcao({ open, onOpenChange, ...resto }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        {open && <Corpo {...resto} onFechar={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
