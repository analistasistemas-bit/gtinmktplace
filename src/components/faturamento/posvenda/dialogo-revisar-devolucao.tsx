import { useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { enviarAnexoPosvenda, type BodyAcaoPosvenda, type DetalheReclamacao } from '@/lib/posvenda';
import { labelDinheiro, labelRetorno, type ProdutoPedido } from '@/lib/posvenda-fila';
import type { Devolucao } from '@/lib/devolucoes';
import { urlVendaML } from '@/lib/ml-status';
import { fmtBRL } from '@/lib/formato';
import { rotuloReputacao } from '@/lib/posvenda-rotulos';
import { DialogoConfirmarAcao } from './dialogo-confirmar-acao';

export type Anexo = { id: string; nome: string };
type Entrada = { motivo: string; texto: string; anexos: Anexo[] };
const VAZIA: Entrada = { motivo: '', texto: '', anexos: [] };
const MAX_BYTES = 5 * 1024 * 1024;

export interface InfoRevisao {
  titulo: string;
  linhas: Array<[string, string]>;
  linkML?: string;
}

/** Tudo que o vendedor precisa ver antes de decidir (spec): produto, pedido, motivo, situação do
 *  retorno, status do reembolso, rastreio e reputação. A API não traz uma data de chegada separada:
 *  a situação do retorno ("Entregue") é o que existe. */
export function montarInfoRevisao(item: Devolucao, afetaReputacao: string | null, produto?: ProdutoPedido): InfoRevisao {
  return {
    titulo: produto ? `${produto.titulo} · ${produto.quantidade} un · ${fmtBRL(produto.valor)}` : `Pedido #${item.order_id ?? '—'}`,
    linkML: item.order_id ? urlVendaML(item.pack_id ?? item.order_id) : undefined,
    linhas: [
      ['Pedido', `#${item.order_id ?? '—'}`],
      ['Motivo', item.reason_texto ?? '—'],
      ['Situação do retorno', labelRetorno(item.return_status)],
      ['Reembolso', labelDinheiro(item.return_status_money)],
      ['Rastreio', item.rastreio ?? '—'],
      ['Reputação', rotuloReputacao(afetaReputacao ?? item.afeta_reputacao)],
    ],
  };
}

type Motivo = DetalheReclamacao['motivos_falha_revisao'][number];

/** Anexos da ação: revisão → JPG/PNG; mensagem → JPG/PNG/PDF; até 5 MB cada. */
export function Fotos({ claimId, anexos, onChange, onSubindo, obrigatoria, idBase, destino = 'revisao' }: {
  claimId: string; anexos: Anexo[];
  /** Atualização funcional: o upload termina depois, e não pode sobrescrever o que foi digitado nesse meio-tempo. */
  onChange: (fn: (atual: Anexo[]) => Anexo[]) => void;
  /** +1 ao começar e -1 ao terminar cada upload (o pai bloqueia o envio enquanto houver upload). */
  onSubindo: (delta: 1 | -1) => void;
  obrigatoria: boolean; idBase: string;
  destino?: 'revisao' | 'mensagem';
}) {
  const tipos = destino === 'mensagem' ? ['image/jpeg', 'image/png', 'application/pdf'] : ['image/jpeg', 'image/png'];
  const [subindo, setSubindo] = useState(0);
  const escolher = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!tipos.includes(f.type)) { toast.error(destino === 'mensagem' ? 'Use JPG, PNG ou PDF.' : 'Use fotos JPG ou PNG.'); continue; }
      if (f.size > MAX_BYTES) { toast.error('Cada foto pode ter até 5 MB.'); continue; }
      setSubindo((n) => n + 1);
      onSubindo(1);
      try {
        const id = await enviarAnexoPosvenda(claimId, destino, f);
        onChange((atual) => [...atual, { id, nome: f.name }]);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSubindo((n) => n - 1);
        onSubindo(-1);
      }
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{destino === 'mensagem' ? 'Anexos' : 'Fotos'} {obrigatoria ? '(obrigatório para este motivo)' : '(opcional)'}</div>
      <div className="flex flex-wrap items-center gap-2">
        {anexos.map((a) => (
          <span key={a.id} className="inline-flex max-w-40 items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
            <span className="truncate">{a.nome}</span>
            <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => onChange((atual) => atual.filter((x) => x.id !== a.id))}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <Button asChild variant="outline" size="sm">
          <label htmlFor={idBase} className="cursor-pointer">
            {subindo > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {destino === 'mensagem' ? 'Anexar' : 'Adicionar foto'}
          </label>
        </Button>
        <input id={idBase} type="file" accept={tipos.join(',')} multiple className="sr-only"
          onChange={(e) => { void escolher(e.target.files); e.target.value = ''; }} />
      </div>
      {subindo > 0 && <div className="text-xs text-muted-foreground">Enviando foto…</div>}
    </div>
  );
}

function BlocoFalha({ claimId, motivos, valor, onPatch, onSubindo, idBase }: {
  claimId: string; motivos: Motivo[]; valor: Entrada; onPatch: (fn: (e: Entrada) => Entrada) => void;
  onSubindo: (d: 1 | -1) => void; idBase: string;
}) {
  const m = motivos.find((x) => x.id === valor.motivo);
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Qual o problema?</div>
      <RadioGroup value={valor.motivo} onValueChange={(v) => onPatch((e) => ({ ...e, motivo: v }))}>
        {motivos.map((mo) => (
          <label key={mo.id} htmlFor={`${idBase}-${mo.id}`}
            className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm has-data-checked:border-primary">
            <RadioGroupItem id={`${idBase}-${mo.id}`} value={mo.id} />
            {mo.texto}
          </label>
        ))}
      </RadioGroup>
      <Fotos claimId={claimId} idBase={`${idBase}-foto`} obrigatoria={!!m?.exige_foto}
        anexos={valor.anexos} onSubindo={onSubindo} onChange={(fn) => onPatch((e) => ({ ...e, anexos: fn(e.anexos) }))} />
      <div className="space-y-1">
        <label htmlFor={`${idBase}-texto`} className="text-sm font-medium">Descreva o problema (obrigatório)</label>
        <Textarea id={`${idBase}-texto`} value={valor.texto} onChange={(ev) => { const texto = ev.target.value; onPatch((e) => ({ ...e, texto })); }} className="min-h-16" />
      </div>
    </div>
  );
}

export function DialogoRevisarDevolucao({ detalhe, info, open, onOpenChange, onConcluido, onEstado }: {
  detalhe: DetalheReclamacao; info: InfoRevisao; open: boolean; onOpenChange: (v: boolean) => void; onConcluido?: () => void; onEstado?: () => void;
}) {
  const claimId = String(detalhe.claim_id);
  const carrinho = detalhe.pedidos_devolucao.length > 1;
  const pendentes = detalhe.revisoes.filter((r) => r.seller_status === 'pending').map((r) => r.order_id);
  const pedidos = detalhe.pedidos_devolucao.filter((o) => !pendentes.length || pendentes.includes(o));

  const [caminho, setCaminho] = useState<'ok' | 'problema'>('ok');
  const [modo, setModo] = useState<'pacote' | 'pedido'>('pacote');
  const [entradas, setEntradas] = useState<Record<string, Entrada>>({});
  const entrada = (k: string) => entradas[k] ?? VAZIA;
  const patch = (k: string) => (fn: (e: Entrada) => Entrada) => setEntradas((s) => ({ ...s, [k]: fn(s[k] ?? VAZIA) }));
  const [subindo, setSubindo] = useState(0);
  const onSubindo = (d: 1 | -1) => setSubindo((n) => n + d);

  // Motivos por escopo (`aplica`): pacote inteiro × pedido; sem carrinho, o motivo de pedido vale pelo pacote.
  const motivosPacote = detalhe.motivos_falha_revisao.filter((m) => m.aplica.includes('package') || (!carrinho && m.aplica.includes('order')));
  const motivosPedido = detalhe.motivos_falha_revisao.filter((m) => m.aplica.includes('order'));
  const blocos: Array<{ chave: string; order_id?: number; titulo?: string; motivos: Motivo[] }> =
    carrinho && modo === 'pedido'
      ? pedidos.map((o) => ({ chave: String(o), order_id: o, titulo: `Pedido #${o}`, motivos: motivosPedido }))
      : [{ chave: 'pacote', motivos: motivosPacote }];

  const completo = blocos.every((b) => {
    const e = entrada(b.chave);
    const m = b.motivos.find((x) => x.id === e.motivo);
    return !!m && e.texto.trim().length > 0 && (!m.exige_foto || e.anexos.length > 0);
  });

  const corpo: Omit<BodyAcaoPosvenda, 'operacao_id' | 'claim_id'> = caminho === 'ok'
    ? { acao: 'revisar_ok' }
    : {
      acao: 'revisar_falha',
      revisoes: blocos.map((b) => {
        const e = entrada(b.chave);
        return { ...(b.order_id != null ? { order_id: b.order_id } : {}), motivo_id: e.motivo, texto: e.texto.trim(), anexos: e.anexos.map((a) => a.id) };
      }),
    };

  return (
    <DialogoConfirmarAcao
      open={open} onOpenChange={onOpenChange} claimId={claimId} corpo={corpo} onConcluido={onConcluido} onEstado={onEstado}
      titulo="Revisar devolução" linkML={info.linkML}
      podeEnviar={caminho === 'ok' || (completo && subindo === 0)}
      rotuloEnviar={caminho === 'ok' ? 'Confirmar no ML' : 'Enviar ao ML'}
      efeito={caminho === 'ok'
        ? 'Isto confirma no Mercado Livre que o produto voltou em ordem.'
        : 'Isto envia sua revisão com falha ao Mercado Livre, que analisa e decide.'}
    >
      <div className="text-sm font-semibold">{info.titulo}</div>
      <dl className="space-y-1 rounded-lg bg-muted p-2.5 text-xs">
        {info.linhas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
        ))}
      </dl>

      <div className="text-sm font-medium">Como o produto chegou?</div>
      <RadioGroup value={caminho} onValueChange={(v) => setCaminho(v as 'ok' | 'problema')}>
        <label htmlFor="rv-ok" className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm has-data-checked:border-primary">
          <RadioGroupItem id="rv-ok" value="ok" />Chegou como eu enviei
        </label>
        <label htmlFor="rv-problema" className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm has-data-checked:border-primary">
          <RadioGroupItem id="rv-problema" value="problema" />Tem problema…
        </label>
      </RadioGroup>

      {caminho === 'problema' && (
        <>
          {carrinho && (
            <RadioGroup value={modo} onValueChange={(v) => setModo(v as 'pacote' | 'pedido')}>
              <label htmlFor="rv-modo-pacote" className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem id="rv-modo-pacote" value="pacote" />Revisar o pacote inteiro</label>
              <label htmlFor="rv-modo-pedido" className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem id="rv-modo-pedido" value="pedido" />Revisar pedido a pedido</label>
            </RadioGroup>
          )}
          {blocos.map((b) => (
            <div key={b.chave} className="space-y-2 rounded-lg border p-3">
              {b.titulo && <div className="text-sm font-semibold">{b.titulo}</div>}
              <BlocoFalha claimId={claimId} motivos={b.motivos} valor={entrada(b.chave)} onPatch={patch(b.chave)} onSubindo={onSubindo} idBase={`rv-${b.chave}`} />
            </div>
          ))}
        </>
      )}
    </DialogoConfirmarAcao>
  );
}
