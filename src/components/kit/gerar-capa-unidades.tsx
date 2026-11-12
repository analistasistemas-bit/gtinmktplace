// ADR-0205: botão "Gerar capa com N unidades" no preview do kit vinculado. O estado de cada tamanho e o `request_id`
// vivem no DIALOG (hook `useCapasUnidades`): o PreviewKit desmonta em "Voltar" e uma geração em voo não pode se perder.
// A candidata nunca grava a foto do kit sozinha; só "Usar esta foto" (aprovada + prévia carregada) entrega o path.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { gerarCapaUnidadesEdge } from '@/lib/capa-unidades-edge';
import { PreviaCapaUnidades } from './previa-capa-unidades';

export type EstadoCapa =
  | { fase: 'idle' }
  | { fase: 'gerando'; tentativa: number }
  | { fase: 'candidata'; path: string; url: string | null }
  /** 3 reprovações (ou desfecho definitivo reprovado): só os motivos e "Gerar de novo". */
  | { fase: 'reprovada'; motivos: string[]; url: string | null; falhaTecnica?: boolean }
  | { fase: 'erro'; motivo?: string; mensagem: string };

const IDLE: EstadoCapa = { fase: 'idle' };
/** Falha definitiva: o mesmo pedido falharia de novo (mesmo critério de `foto-combinacao.tsx`). */
const DEFINITIVAS = new Set(['imagem_inadequada', 'pedido_diferente', 'falha_storage']);
const MSG_TETO = 'Limite diário de gerações atingido: envie a foto manualmente.';

/** Estado por tamanho `n`, no dialog. `open` novo zera tudo; resultado de geração de uma sessão antiga é descartado. */
export function useCapasUnidades(familiaBaseId: string, open: boolean) {
  const [estados, setEstados] = useState<Record<number, EstadoCapa>>({});
  const ids = useRef<Record<number, string>>({});
  /** Cadeado por n: guarda a geração vigente (token). Geração abandonada não solta o cadeado da nova. */
  const emVoo = useRef(new Map<number, number>());
  const seq = useRef(0);
  const epoca = useRef(0);
  /** Sobe quando o operador descarta (arquivo manual): o resultado em voo é ignorado. */
  const descartes = useRef<Record<number, number>>({});

  useEffect(() => {
    epoca.current++; // fechar também invalida a geração em voo: ela não chama a edge de novo (teto diário)
    if (!open) return;
    ids.current = {};
    descartes.current = {};
    emVoo.current.clear();
    setEstados({});
  }, [open]);

  const gerar = useCallback(async (n: number) => {
    if (emVoo.current.has(n)) return;
    const token = ++seq.current;
    emVoo.current.set(n, token);
    const e = epoca.current;
    const d = descartes.current[n] ?? 0;
    /** Geração abandonada (fechou, reabriu, descartou ou outra assumiu o n) não toca request_id, estado nem cadeado. */
    const vivo = () => e === epoca.current && (descartes.current[n] ?? 0) === d && emVoo.current.get(n) === token;
    const set = (s: EstadoCapa) => { if (vivo()) setEstados((p) => ({ ...p, [n]: s })); };
    const id = (ids.current[n] ||= crypto.randomUUID());
    const definitivo = () => { if (vivo()) delete ids.current[n]; };
    set({ fase: 'gerando', tentativa: 1 });
    try {
      let r = await gerarCapaUnidadesEdge({ requestId: id, familiaBaseId, n });
      // Reprovada com tentativa sobrando: o mesmo pedido gera a próxima com os motivos (teto da edge: 3).
      // Abandonada (arquivo manual, dialog reaberto): não chama a edge de novo (gastaria o teto).
      for (let i = 0; i < 3 && vivo() && r.ok && r.aprovado === false && r.proxima; i++) {
        set({ fase: 'gerando', tentativa: (r.tentativa ?? 1) + 1 });
        r = await gerarCapaUnidadesEdge({ requestId: id, familiaBaseId, n });
      }
      if (!r.ok) {
        // Falha definitiva: a edge repetiria o mesmo desfecho para este request_id; o próximo clique é pedido novo.
        if (r.motivo && DEFINITIVAS.has(r.motivo)) definitivo();
        set({ fase: 'erro', motivo: r.motivo, mensagem: r.motivo === 'teto_diario' ? MSG_TETO : r.mensagem });
      } else if (r.aprovado === false) {
        definitivo();
        set({
          fase: 'reprovada', motivos: r.motivos ?? r.verificacao?.motivos ?? [], url: r.previa_url ?? null,
          falhaTecnica: r.falha_tecnica === true,
        });
      } else if (!r.path) {
        set({ fase: 'erro', mensagem: 'Resposta sem a foto. Tente de novo.' });
      } else {
        definitivo();
        set({ fase: 'candidata', path: r.path, url: r.url ?? null });
      }
    } catch (err) {
      set({ fase: 'erro', mensagem: (err as Error).message });
    } finally {
      if (emVoo.current.get(n) === token) emVoo.current.delete(n);
    }
  }, [familiaBaseId]);

  /** Foto usada ou descartada: pedido novo na próxima geração. */
  const descartar = useCallback((n: number) => {
    descartes.current[n] = (descartes.current[n] ?? 0) + 1;
    delete ids.current[n];
    emVoo.current.delete(n); // a geração abandonada não segura mais o botão
    setEstados((p) => (p[n] && p[n].fase !== 'idle' ? { ...p, [n]: IDLE } : p));
  }, []);

  return { estados, gerar, descartar };
}

export function GerarCapaUnidades({ n, temCapa, estado = IDLE, onGerar, onUsar }: {
  n: number;
  /** A base tem capa (`base.fotoPath`): é dela que a edge parte. */
  temCapa: boolean;
  estado?: EstadoCapa;
  onGerar: () => void;
  /** Aprovação humana: entrega o path da candidata. */
  onUsar: (path: string) => void;
}) {
  const { data: modulos } = useModulosHabilitados();
  if (!temCapa || !modulos?.includes('imagem_ia')) return null;

  const gerando = estado.fase === 'gerando';
  if (estado.fase === 'candidata') {
    return (
      <PreviaCapaUnidades
        n={n} url={estado.url} aprovada motivos={[]} gerando={false}
        onUsar={() => onUsar(estado.path)} onGerarDeNovo={onGerar}
      />
    );
  }
  return (
    <div id={`kit-${n}-capa-unidades-acao`} className="grid gap-2">
      {estado.fase === 'reprovada' ? (
        <div role="alert" className="grid gap-2 rounded-md border border-danger/30 bg-danger/5 p-2 text-xs">
          <span className="font-medium">
            {estado.falhaTecnica
              ? 'Falha técnica na geração, tente de novo (ou envie a foto manualmente).'
              : `A IA não conseguiu uma capa fiel com ${n} unidades. Envie a foto manualmente ou tente de novo.`}
          </span>
          <PreviaCapaUnidades n={n} url={estado.url} aprovada={false} motivos={estado.motivos} gerando={false} onGerarDeNovo={onGerar} />
        </div>
      ) : (
        <>
          <Button
            type="button" size="sm" variant="outline" className="justify-self-start"
            aria-label={`Gerar capa com ${n} unidades`} disabled={gerando} onClick={onGerar}
          >
            {gerando ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {gerando
              ? (estado.tentativa > 1 ? `Corrigindo (tentativa ${estado.tentativa} de 3)…` : 'Gerando e conferindo…')
              : `Gerar capa com ${n} unidades`}
          </Button>
          {estado.fase === 'erro' && (
            <p role="alert" className="text-xs text-destructive">{estado.mensagem}</p>
          )}
        </>
      )}
    </div>
  );
}
