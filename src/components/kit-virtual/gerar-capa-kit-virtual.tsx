// Capa do kit virtual por IA (espelha `gerar-capa-unidades.tsx`, mas um único pedido por composição). O estado e o
// `request_id` vivem no dialog (hook `useCapaKitVirtual`). A candidata nunca vira a foto do kit sozinha: só "Usar esta foto".
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { gerarCapaKitVirtualEdge, type ComponenteCapaKitVirtual } from '@/lib/capa-kit-virtual-edge';
import type { EstadoCapa } from '@/components/kit/gerar-capa-unidades';
import { PreviaCapaKitVirtual } from './previa-capa-kit-virtual';
import {
  modoCapa, quantidadesNaCapa, MAX_UNIDADES_CAPA, type ItemComposicao,
} from '../../../supabase/functions/_shared/ai/foto-kit-virtual-modo.ts';

const IDLE: EstadoCapa = { fase: 'idle' };
/** Falha definitiva: o mesmo pedido falharia de novo. */
const DEFINITIVAS = new Set(['imagem_inadequada', 'pedido_diferente', 'item_divergente', 'item_inelegivel', 'falha_storage']);
const MSG_TETO = 'Limite diário de gerações atingido: envie a foto manualmente.';

/** Muda a composição (produto ou quantidade) → zera estado e request_id e ignora a geração em voo. */
export function useCapaKitVirtual(componentes: ComponenteCapaKitVirtual[], open: boolean) {
  const [estado, setEstado] = useState<EstadoCapa>(IDLE);
  const id = useRef<string | undefined>(undefined);
  const emVoo = useRef<number | null>(null);
  const seq = useRef(0);
  const epoca = useRef(0);
  const descartes = useRef(0);
  const ref = useRef(componentes);
  ref.current = componentes;
  const assinatura = componentes.map((c) => `${c.userProductId}:${c.quantidade}`).sort().join('|');

  useEffect(() => {
    epoca.current++;
    id.current = undefined;
    emVoo.current = null;
    setEstado(IDLE);
  }, [open, assinatura]);

  const gerar = useCallback(async () => {
    if (emVoo.current !== null) return;
    const token = ++seq.current;
    emVoo.current = token;
    const e = epoca.current;
    const d = descartes.current;
    const vivo = () => e === epoca.current && descartes.current === d && emVoo.current === token;
    const set = (s: EstadoCapa) => { if (vivo()) setEstado(s); };
    const rid = (id.current ||= crypto.randomUUID());
    const definitivo = () => { if (vivo()) id.current = undefined; };
    const pedido = ref.current;
    set({ fase: 'gerando', tentativa: 1 });
    try {
      let r = await gerarCapaKitVirtualEdge({ requestId: rid, componentes: pedido });
      for (let i = 0; i < 3 && vivo() && r.ok && r.aprovado === false && r.proxima; i++) {
        set({ fase: 'gerando', tentativa: (r.tentativa ?? 1) + 1 });
        r = await gerarCapaKitVirtualEdge({ requestId: rid, componentes: pedido });
      }
      if (!r.ok) {
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
      if (emVoo.current === token) emVoo.current = null;
    }
  }, []);

  /** Foto usada ou descartada: pedido novo na próxima geração. */
  const descartar = useCallback(() => {
    descartes.current++;
    id.current = undefined;
    emVoo.current = null;
    setEstado(IDLE);
  }, []);

  return { estado, gerar: () => void gerar(), descartar };
}

export function GerarCapaKitVirtual({ estado = IDLE, itens, onGerar, onUsar, onDescartar, habilitado }: {
  estado?: EstadoCapa;
  itens: ItemComposicao[];
  onGerar: () => void;
  /** Aprovação humana: entrega o path da candidata. */
  onUsar: (path: string) => void;
  onDescartar: () => void;
  /** false quando algum componente não tem `itemId`. */
  habilitado: boolean;
}) {
  const { data: modulos } = useModulosHabilitados();
  if (!habilitado || !modulos?.includes('imagem_ia')) return null;

  const gerando = estado.fase === 'gerando';
  const qtds = quantidadesNaCapa(itens);
  const legenda = itens.map((i, k) => `${qtds[k]}× ${i.rotulo}`).join(' · ');
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  const modo = modoCapa(itens) === 'todas'
    ? `Mostra todas as ${total} unidades`
    : `Mais de ${MAX_UNIDADES_CAPA} unidades: uma de cada produto`;

  if (estado.fase === 'candidata') {
    return (
      <PreviaCapaKitVirtual
        url={estado.url} aprovada motivos={[]} legenda={legenda} gerando={false}
        onUsar={() => { onUsar(estado.path); onDescartar(); }} onGerarDeNovo={onGerar}
      />
    );
  }
  return (
    <div className="grid gap-2">
      {estado.fase === 'reprovada' ? (
        <div role="alert" className="grid gap-2 rounded-md border border-danger/30 bg-danger/5 p-2 text-xs">
          <span className="font-medium">
            {estado.falhaTecnica
              ? 'Falha técnica na geração, tente de novo (ou envie a foto manualmente).'
              : 'A IA não conseguiu uma capa fiel do kit. Envie a foto manualmente ou tente de novo.'}
          </span>
          <PreviaCapaKitVirtual url={estado.url} aprovada={false} motivos={estado.motivos} legenda={legenda} gerando={false} onGerarDeNovo={onGerar} />
        </div>
      ) : (
        <>
          <Button
            type="button" size="sm" variant="outline" className="justify-self-start"
            aria-label="Gerar capa do kit" disabled={gerando} onClick={onGerar}
          >
            {gerando ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {gerando
              ? (estado.tentativa > 1 ? `Corrigindo (tentativa ${estado.tentativa} de 3)…` : 'Gerando e conferindo…')
              : 'Gerar capa do kit'}
          </Button>
          <span className="text-xs text-muted-foreground">{modo}</span>
          {estado.fase === 'erro' && (
            <p role="alert" className="text-xs text-destructive">{estado.mensagem}</p>
          )}
        </>
      )}
    </div>
  );
}
