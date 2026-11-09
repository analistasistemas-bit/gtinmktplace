// ADR-0201 (Task 7b): passo "Fatos e referências" do diálogo da Galeria IA. Cada ação grava na edge `galeria-fatos`,
// que devolve a ficha remontada; a tela só troca o estado. Nada aqui escreve no Mercado Livre.
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  confirmarFato, corrigirCadastro, descartarFato, enviarVista, manterCadastro,
  type Caixa, type Fato, type Ficha, type Res,
} from '@/lib/galeria/api';

interface Props {
  mlItemId: string;
  ficha: Ficha;
  /** Moda lida ao vivo pela edge; só `true` oferece o envio de costas/lateral (`null` = desconhecida). */
  moda: boolean | null;
  aoMudar: (r: Res<Ficha>) => void;
}

/** Só `atributo:<ID>` (menos BRAND) pode ser corrigido no cadastro pela etiqueta; ORIGEM nunca é checada (decisão do dono). */
const corrigivel = (campo: string) => campo.startsWith('atributo:') && campo !== 'atributo:BRAND';

type EstadoRecorte = 'carregando' | 'ok' | 'erro';

/**
 * Recorte da leitura da etiqueta: a caixa (frações 0..1) sobre a foto em que o servidor leu. A URL vem pronta da edge;
 * o `<img>` oculto só detecta se a foto carregou (sem recorte visível o operador não pode aceitar a leitura).
 */
function Recorte({ url, caixa, aoEstado }: { url: string; caixa: Caixa; aoEstado: (e: EstadoRecorte) => void }) {
  const { x, y, w, h } = caixa;
  return (
    <div
      role="img"
      aria-label="Recorte da etiqueta"
      className="h-20 w-40 shrink-0 rounded border bg-no-repeat"
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w >= 1 ? 0 : (x / (1 - w)) * 100}% ${h >= 1 ? 0 : (y / (1 - h)) * 100}%`,
      }}
    >
      <img src={url} alt="" className="hidden" onLoad={() => aoEstado('ok')} onError={() => aoEstado('erro')} />
    </div>
  );
}

function Divergente({ fato, ocupado, onUsarEtiqueta, onManter }: {
  fato: Fato; ocupado: boolean; onUsarEtiqueta: (valor: string) => void; onManter: () => void;
}) {
  const lido = fato.etiqueta?.valor ?? '';
  const url = fato.etiqueta?.foto?.url;
  const caixa = fato.etiqueta?.caixa;
  const [recorte, setRecorte] = useState<EstadoRecorte>(url && caixa ? 'carregando' : 'erro');
  const corrige = corrigivel(fato.campo) && lido !== '';
  // Só se aceita a leitura da etiqueta vendo o recorte: sem imagem carregada nada vem pré-selecionado.
  const podeCorrigir = corrige && recorte === 'ok';
  // Campo que a etiqueta não corrige (ORIGEM, planilha…) tem só uma opção segura: o cadastro vem marcado.
  const [escolha, setEscolha] = useState<'etiqueta' | 'cadastro' | null>(corrige ? null : 'cadastro');
  useEffect(() => { if (podeCorrigir) setEscolha((e) => e ?? 'etiqueta'); }, [podeCorrigir]);
  useEffect(() => { if (corrige && recorte === 'erro') setEscolha((e) => (e === 'etiqueta' ? null : e)); }, [corrige, recorte]);
  const nome = `div-${fato.campo}`;
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {url && caixa && <Recorte url={url} caixa={caixa} aoEstado={setRecorte} />}
      <div className="flex flex-col gap-1 text-sm">
        {corrige && recorte !== 'ok' && (
          <p className="text-muted-foreground">
            {recorte === 'carregando'
              ? 'Carregando o recorte da etiqueta…'
              : 'Não foi possível mostrar o recorte da etiqueta, então a leitura dela não pode ser aplicada. Mantenha o cadastro ou confira a etiqueta nas fotos.'}
          </p>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name={nome} checked={escolha === 'etiqueta'} disabled={!podeCorrigir}
            onChange={() => setEscolha('etiqueta')} />
          Usar o da etiqueta{lido && <>: <strong>{lido}</strong></>}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={nome} checked={escolha === 'cadastro'} onChange={() => setEscolha('cadastro')} />
          Manter o do cadastro: <strong>{fato.valor}</strong>
        </label>
        <Button size="sm" className="mt-1 w-fit" disabled={ocupado || escolha === null}
          onClick={() => (escolha === 'etiqueta' ? onUsarEtiqueta(lido) : onManter())}>
          Aplicar
        </Button>
      </div>
    </div>
  );
}

const ROTULO_ESTADO: Record<Fato['estado'], { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  CONFIRMADO: { rotulo: 'Confirmado', tom: 'success' },
  SUGERIDO: { rotulo: 'Sugerido pela IA', tom: 'warning' },
  DIVERGENTE: { rotulo: 'Diverge da etiqueta', tom: 'danger' },
  NAO_CONFERIDO: { rotulo: 'Não conferido na etiqueta', tom: 'neutral' },
  VARIA_POR_TAMANHO: { rotulo: 'Varia por tamanho', tom: 'neutral' },
};

export function PassoFatos({ mlItemId, ficha, moda, aoMudar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [cor, setCor] = useState(ficha.cores[0] ?? '');
  const arquivo = useRef<HTMLInputElement>(null);
  const vistaAlvo = useRef<'costas' | 'lateral'>('costas');
  const fam = ficha.familia_id;

  async function rodar(p: Promise<Res<Ficha>>) {
    setOcupado(true);
    try { aoMudar(await p); } finally { setOcupado(false); }
  }

  function escolherFoto(vista: 'costas' | 'lateral') {
    vistaAlvo.current = vista;
    arquivo.current?.click();
  }

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    const b64 = await new Promise<string>((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => falha(r.error);
      r.readAsDataURL(f);
    });
    await rodar(enviarVista(mlItemId, fam, cor, vistaAlvo.current, b64));
  }

  const temVista = (v: 'costas' | 'lateral') => !!ficha.referencias[cor]?.[v] && !('erro' in (ficha.referencias[cor][v] ?? {}));
  const ofereceVistas = moda === true;

  return (
    <div className="space-y-4">
      {ficha.roteiro_desatualizado && (
        <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          Os fatos mudaram depois da aprovação: o roteiro está <strong>desatualizado</strong>. Crie ou edite um roteiro e aprove de novo.
        </p>
      )}

      <section aria-label="Ficha verdade" className="space-y-2">
        <h3 className="text-sm font-semibold">Ficha verdade</h3>
        <ul className="space-y-2">
          {ficha.fatos.map((f) => {
            const e = ROTULO_ESTADO[f.estado];
            return (
              <li key={f.campo} className="rounded border p-2 text-sm" data-estado={f.estado}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.campo}</span>
                  <span>{f.valor}</span>
                  <StatusPill tone={e.tom}>{e.rotulo}</StatusPill>
                </div>
                {f.estado === 'SUGERIDO' && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={ocupado} onClick={() => rodar(confirmarFato(mlItemId, fam, f.campo))}>Confirmar</Button>
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => rodar(descartarFato(mlItemId, fam, f.campo))}>Descartar</Button>
                  </div>
                )}
                {f.estado === 'DIVERGENTE' && (
                  <Divergente fato={f} ocupado={ocupado}
                    onUsarEtiqueta={(v) => rodar(corrigirCadastro(mlItemId, fam, f.campo, v))}
                    onManter={() => rodar(manterCadastro(mlItemId, fam, f.campo))} />
                )}
                {f.estado === 'VARIA_POR_TAMANHO' && (
                  <p className="mt-1 text-muted-foreground">
                    Este valor muda de um tamanho para outro, então não entra no texto da imagem.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Referências" className="space-y-2">
        <h3 className="text-sm font-semibold">Fotos de referência</h3>
        {ficha.cores.length > 1 && (
          <Select value={cor} onValueChange={setCor}>
            <SelectTrigger aria-label="Cor da foto" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{ficha.cores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {ofereceVistas && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => escolherFoto('costas')}>
              Enviar foto de costas
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => escolherFoto('lateral')}>
              Enviar foto lateral
            </Button>
            {temVista('costas') && <StatusPill tone="success">Costas cadastrada</StatusPill>}
            {temVista('lateral') && <StatusPill tone="success">Lateral cadastrada</StatusPill>}
            {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-label="Enviando" />}
            <input ref={arquivo} type="file" accept="image/jpeg" className="hidden" aria-label="Arquivo da foto"
              onChange={(e) => { void lerArquivo(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}
      </section>
    </div>
  );
}
