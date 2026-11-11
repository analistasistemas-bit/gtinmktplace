// Galeria IA, passo 1 "Conferir dados" (proposta 3.2; protótipo aprovado). Cada ação grava na edge `galeria-fatos`, que
// devolve a ficha remontada; a tela só troca o estado. Nada aqui escreve no Mercado Livre.
// Blocos: divergências com a etiqueta → "Confirme para usar nas imagens" (só o que pode virar texto de imagem) →
// já confirmados → "Ver todos os dados do cadastro" (descrições, título do ML, embalagem; recolhido, com confirmação
// própria das descrições — Decisão do Diego, 11/11). Confirmar é de mão única: o servidor só descarta sugestão.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StatusPill } from '@/components/ui/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  confirmarFato, corrigirCadastro, enviarVista, manterCadastro, type Caixa, type Fato, type Ficha, type Res,
} from '@/lib/galeria/api';
import { EMBALAGEM, rotuloFato, TEXTOS_LONGOS, usavel } from '@/lib/galeria/rotulos';
import { cn } from '@/lib/utils';
import { MioloPasso, Rodape } from './rodape';

/** Só `atributo:<ID>` (menos BRAND) pode ser corrigido no cadastro pela etiqueta; ORIGEM nunca é checada (decisão do dono). */
const corrigivel = (campo: string) => campo.startsWith('atributo:') && campo !== 'atributo:BRAND';
type EstadoRecorte = 'carregando' | 'ok' | 'erro';

export const cartao = 'rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5';

/** Recorte da etiqueta: a caixa (frações 0..1) sobre a foto em que o servidor leu; o <img> oculto só detecta a carga. */
function Recorte({ url, caixa, aoEstado }: { url: string; caixa: Caixa; aoEstado: (e: EstadoRecorte) => void }) {
  const { x, y, w, h } = caixa;
  return (
    <div role="img" aria-label="Recorte da etiqueta" className="aspect-video w-44 max-w-full shrink-0 rounded-lg border bg-muted bg-no-repeat"
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w >= 1 ? 0 : (x / (1 - w)) * 100}% ${h >= 1 ? 0 : (y / (1 - h)) * 100}%`,
      }}>
      <img src={url} alt="" className="hidden" onLoad={() => aoEstado('ok')} onError={() => aoEstado('erro')} />
    </div>
  );
}

function Divergencia({ fato, ocupado, aoUsarEtiqueta, aoManter }: {
  fato: Fato; ocupado: boolean; aoUsarEtiqueta: (valor: string) => void; aoManter: () => void;
}) {
  const lido = fato.etiqueta?.valor ?? '';
  const url = fato.etiqueta?.foto?.url;
  const caixa = fato.etiqueta?.caixa;
  const [recorte, setRecorte] = useState<EstadoRecorte>(url && caixa ? 'carregando' : 'erro');
  const corrige = corrigivel(fato.campo) && lido !== '';
  // Só se aceita a leitura da etiqueta vendo o recorte.
  const podeEtiqueta = corrige && recorte === 'ok';
  const rotulo = rotuloFato(fato);
  return (
    <section aria-labelledby={`dv-${fato.campo}`} className={cn(cartao, 'ring-warning/35')}>
      <div className="flex flex-col gap-1 px-4 pt-4">
        <h2 id={`dv-${fato.campo}`} className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle aria-hidden className="size-4 text-warning" />A etiqueta mostra outro valor de {rotulo.toLowerCase()}
        </h2>
        <p className="text-xs text-muted-foreground">Escolha qual valor vale. Só esse vai para as imagens.</p>
      </div>
      <div className="flex flex-wrap items-start gap-4 p-4">
        {url && caixa && <Recorte url={url} caixa={caixa} aoEstado={setRecorte} />}
        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Cadastro</dt><dd className="font-medium tabular-nums">{fato.valor}</dd>
            <dt className="text-muted-foreground">Etiqueta</dt><dd className="font-medium tabular-nums">{lido || 'ilegível'}</dd>
          </dl>
          {corrige && recorte !== 'ok' && (
            <p className="text-xs text-muted-foreground">
              {recorte === 'carregando' ? 'Carregando o recorte da etiqueta…'
                : 'Não foi possível mostrar o recorte da etiqueta, então o valor dela não pode ser usado. Mantenha o cadastro ou confira a etiqueta nas fotos.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 px-4" disabled={ocupado} onClick={aoManter}>Manter cadastro</Button>
            <Button variant="outline" className="h-11 px-4" disabled={ocupado || !podeEtiqueta} onClick={() => aoUsarEtiqueta(lido)}>
              Usar o da etiqueta
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const SemEtiqueta = () => (
  <StatusPill title="Este dado não aparece na foto da etiqueta">sem etiqueta</StatusPill>
);

function Linha({ fato, children }: { fato: Fato; children?: React.ReactNode }) {
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 last:border-b-0">
      <span className="w-full text-xs text-muted-foreground sm:w-40 sm:text-sm">{rotuloFato(fato)}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 font-medium tabular-nums">
        <span className="break-words">{fato.valor}</span>{fato.estado === 'NAO_CONFERIDO' && <SemEtiqueta />}
      </span>
      {children}
    </li>
  );
}

function Dobra({ titulo, contagem, aberta, children }: { titulo: string; contagem: string; aberta?: boolean; children: React.ReactNode }) {
  return (
    <details className={cn(cartao, 'group')} open={aberta}>
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-2 rounded-xl px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        {titulo}<span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{contagem}</span>
      </summary>
      <ul className="border-t">{children}</ul>
    </details>
  );
}

export function PassoConferir({ mlItemId, ficha, moda, aoMudar, aoContinuar }: {
  mlItemId: string;
  ficha: Ficha;
  /** Moda lida ao vivo pela edge; só `true` oferece costas/lateral (`null` = desconhecida). */
  moda: boolean | null;
  aoMudar: (r: Res<Ficha>) => void;
  aoContinuar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const fam = ficha.familia_id;
  const largo = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches, []);

  const divergentes = ficha.fatos.filter((f) => f.estado === 'DIVERGENTE');
  const pendentes = ficha.fatos.filter((f) => f.estado === 'SUGERIDO' && !TEXTOS_LONGOS.has(f.campo));
  const confirmados = ficha.fatos.filter((f) => usavel(f) && !TEXTOS_LONGOS.has(f.campo) && !EMBALAGEM.has(f.campo));
  const cadastro = ficha.fatos.filter((f) => TEXTOS_LONGOS.has(f.campo) || EMBALAGEM.has(f.campo) || f.estado === 'VARIA_POR_TAMANHO');

  async function rodar(p: () => Promise<Res<Ficha>>): Promise<boolean> {
    setOcupado(true);
    try { const r = await p(); aoMudar(r); return r.ok; } finally { setOcupado(false); }
  }
  // Em sequência: cada chamada devolve a ficha inteira; para na primeira falha.
  async function confirmarTodos() {
    for (const f of pendentes) if (!(await rodar(() => confirmarFato(mlItemId, fam, f.campo)))) return;
  }

  const rodape = divergentes.length > 0
    ? { texto: `Escolha o valor de ${rotuloFato(divergentes[0]).toLowerCase()} (cadastro ou etiqueta) para continuar`, ok: false }
    : confirmados.length === 0 ? { texto: 'Confirme ao menos um dado para continuar', ok: false }
      : { texto: `${confirmados.length} ${confirmados.length === 1 ? 'dado confirmado vai' : 'dados confirmados vão'} para as imagens`, ok: true };

  return (
    <>
      <MioloPasso titulo="Conferir dados" frase="A IA só escreve nas imagens o que estiver confirmado aqui. O que você não confirmar não aparece.">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div className="flex min-w-0 flex-col gap-4">
            {ficha.roteiro_desatualizado && (
              <p role="alert" className="flex gap-2 rounded-lg bg-warning/10 p-3 text-sm ring-1 ring-warning/25">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                Os dados mudaram depois que os textos foram aprovados. Confira e aprove os textos de novo no passo 2.
              </p>
            )}
            {divergentes.map((f) => (
              <Divergencia key={f.campo} fato={f} ocupado={ocupado}
                aoUsarEtiqueta={(v) => void rodar(() => corrigirCadastro(mlItemId, fam, f.campo, v))}
                aoManter={() => void rodar(() => manterCadastro(mlItemId, fam, f.campo))} />
            ))}
            {pendentes.length > 0 ? (
              <section aria-labelledby="cf" className={cartao}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                  <div>
                    <h2 id="cf" className="text-base font-semibold">Confirme para usar nas imagens</h2>
                    <p className="text-xs text-muted-foreground tabular-nums">{pendentes.length} {pendentes.length === 1 ? 'dado aguardando' : 'dados aguardando'}</p>
                  </div>
                  <Button variant="outline" className="h-11 px-4" disabled={ocupado} onClick={() => void confirmarTodos()}>
                    {ocupado ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}Confirmar todos
                  </Button>
                </div>
                <ul className="border-t">
                  {pendentes.map((f) => (
                    <Linha key={f.campo} fato={f}>
                      <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                        <Switch className="after:-inset-y-3.5" id={`usar-${f.campo}`} checked={false} disabled={ocupado} aria-label={`Usar ${rotuloFato(f)} nas imagens`}
                          onCheckedChange={(v) => { if (v) void rodar(() => confirmarFato(mlItemId, fam, f.campo)); }} />
                        <label htmlFor={`usar-${f.campo}`} className="cursor-pointer">Usar nas imagens</label>
                      </div>
                    </Linha>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                <Check aria-hidden className="size-4 text-success" />Todos os dados que podem ir para as imagens estão confirmados.
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Dobra titulo="Já confirmados" contagem={String(confirmados.length)} aberta={largo || pendentes.length === 0}>
              {confirmados.map((f) => <Linha key={f.campo} fato={f} />)}
            </Dobra>
            {cadastro.length > 0 && (
              <Dobra titulo="Ver todos os dados do cadastro" contagem="não vão para as imagens">
                {cadastro.map((f) => (
                  <li key={f.campo} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
                    <span className="text-xs text-muted-foreground">{rotuloFato(f)}</span>
                    {f.estado === 'VARIA_POR_TAMANHO'
                      ? <span className="text-sm">Este valor muda de um tamanho para outro, então não entra no texto da imagem.</span>
                      : <span className="line-clamp-4 whitespace-pre-line text-sm">{f.valor}</span>}
                    {f.estado === 'SUGERIDO' && (
                      <Button variant="outline" className="mt-1 h-11 w-fit px-4" disabled={ocupado}
                        aria-label={`Confirmar ${rotuloFato(f)}`} onClick={() => void rodar(() => confirmarFato(mlItemId, fam, f.campo))}>
                        <Check aria-hidden />Confirmar este texto
                      </Button>
                    )}
                  </li>
                ))}
              </Dobra>
            )}
            {moda === true && <Vistas mlItemId={mlItemId} ficha={ficha} rodar={rodar} ocupado={ocupado} />}
          </div>
        </div>
      </MioloPasso>
      <Rodape {...rodape} rotulo="Continuar" aoClicar={aoContinuar} />
    </>
  );
}

/** Moda: fotos de costas e lateral (referência das imagens "De costas" e "Lateral"). */
function Vistas({ mlItemId, ficha, rodar, ocupado }: {
  mlItemId: string; ficha: Ficha; rodar: (p: () => Promise<Res<Ficha>>) => Promise<boolean>; ocupado: boolean;
}) {
  const [cor, setCor] = useState(ficha.cores[0] ?? '');
  const arquivo = useRef<HTMLInputElement>(null);
  const alvo = useRef<'costas' | 'lateral'>('costas');
  const tem = (v: 'costas' | 'lateral') => !!ficha.referencias[cor]?.[v] && !('erro' in (ficha.referencias[cor][v] ?? {}));
  async function ler(f: File | undefined) {
    if (!f) return;
    const b64 = await new Promise<string>((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => falha(r.error);
      r.readAsDataURL(f);
    });
    await rodar(() => enviarVista(mlItemId, ficha.familia_id, cor, alvo.current, b64));
  }
  return (
    <section aria-labelledby="vistas" className={cn(cartao, 'flex flex-col gap-3 p-4')}>
      <div>
        <h2 id="vistas" className="text-base font-semibold">Fotos de costas e lateral</h2>
        <p className="text-xs text-muted-foreground">Servem de referência para as imagens de costas e de lado.</p>
      </div>
      {ficha.cores.length > 1 && (
        <Select value={cor} onValueChange={setCor}>
          <SelectTrigger aria-label="Cor da foto" className="h-11 w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{ficha.cores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(['costas', 'lateral'] as const).map((v) => (
          <Button key={v} variant="outline" className="h-11 px-4" disabled={ocupado}
            onClick={() => { alvo.current = v; arquivo.current?.click(); }}>
            <Upload aria-hidden />{v === 'costas' ? 'Enviar foto de costas' : 'Enviar foto lateral'}
          </Button>
        ))}
        {tem('costas') && <StatusPill tone="success">Costas cadastrada</StatusPill>}
        {tem('lateral') && <StatusPill tone="success">Lateral cadastrada</StatusPill>}
        <input ref={arquivo} type="file" accept="image/jpeg" className="hidden" aria-label="Arquivo da foto"
          onChange={(e) => { void ler(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </section>
  );
}
