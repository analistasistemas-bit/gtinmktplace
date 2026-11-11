// Galeria IA, passo 2 "Escolher imagens" (proposta 3.3; protótipo aprovado). Um cartão por imagem (missão do roteiro),
// com esboço do layout e interruptor; o editor mostra só os campos que a imagem mostra (`CAMPOS_DA_MISSAO`), com
// limites de `regras.ts`. Estado e salvamento automático: `useRascunhoRoteiro` (Fase B). "Continuar" = aprovar (admin).
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CloudOff, Info, Loader2, Pencil, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  aprovarRoteiro, criarRoteiro, ERROS_DE_RECARGA, motivoLupa, type Ficha, type MissaoRoteiro, type Res, type RespostaRoteiro,
} from '@/lib/galeria/api';
import { CAMPOS_DA_MISSAO, CAPACIDADE, LIMITES, lupaPendente, missoesDisponiveis } from '../../../supabase/functions/_shared/galeria/regras';
import { useRascunhoRoteiro } from '@/hooks/useRascunhoRoteiro';
import { definirSpec, editarMissao, removerSpec, specsElegiveis } from '@/lib/galeria/rascunho';
import { errosDaMissao, LIMITE_DO_CAMPO, motivoDesligadaTela, traduzirErro, type ErroTela } from '@/lib/galeria/mensagens-roteiro';
import { IMAGEM_GERAL, nomeImagem, rotuloFato } from '@/lib/galeria/rotulos';
import { cn } from '@/lib/utils';
import { EsbocoMissao } from './esboco-missao';
import { cartao } from './passo-conferir';
import { MioloPasso, Rodape } from './rodape';

type Falha = Extract<Res<unknown>, { ok: false }>;

const descricaoImagem = (missao: number, moda: boolean) => (moda ? 'Sem texto' : IMAGEM_GERAL[missao]?.descricao ?? '');

const palavras = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length);
/** Missão que nunca pode ser criada neste anúncio: o interruptor fica desabilitado. */
const IMPOSSIVEL = /Sem fato confirmado|Sem dado confirmado|Sem etapa de uso/;

function LinhaErro({ id, texto }: { id?: string; texto: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" /><span>{texto}</span>
    </p>
  );
}

function CampoTexto({ id, rotulo, valor, limite, erro, desabilitado, aoMudar }: {
  id: string; rotulo: string; valor: string; limite: number; erro?: string; desabilitado: boolean; aoMudar: (v: string) => void;
}) {
  const n = palavras(valor);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {rotulo}
        <span className={cn('text-xs tabular-nums', n > limite ? 'font-medium text-destructive' : 'font-normal text-muted-foreground')}
          data-excedeu={n > limite}>{n} de {limite} palavras</span>
      </label>
      <Input id={id} className="h-11" value={valor} disabled={desabilitado} aria-invalid={!!erro || undefined}
        aria-describedby={erro ? `${id}-erro` : undefined} onChange={(e) => aoMudar(e.target.value)} />
      {erro && <LinhaErro id={`${id}-erro`} texto={erro} />}
    </div>
  );
}

function IndicadorSalvo({ estado }: { estado: ReturnType<typeof useRascunhoRoteiro>['estado'] }) {
  if (estado === 'erro') return <span className="inline-flex items-center gap-1 text-xs text-destructive"><CloudOff aria-hidden className="size-3.5" />Não salvo</span>;
  if (estado === 'salvando') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 aria-hidden className="size-3.5 animate-spin" />Salvando…</span>;
  if (estado === 'pendente') return <span className="text-xs text-muted-foreground">Alterações não salvas</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-success"><Check aria-hidden className="size-3.5" />Salvo</span>;
}

interface Props {
  mlItemId: string;
  ficha: Ficha;
  isAdmin: boolean;
  /** `ler` respondeu `roteiro: null`: só então "Criar" existe (senão criaria outra versão por cima do vigente). */
  podeCriar: boolean;
  resp: RespostaRoteiro | null;
  aoResposta: (r: RespostaRoteiro) => void;
  aoFalhar: (f: Falha) => void;
  /** Aprovado (ou já estava): a página recarrega e vai ao passo 3. */
  aoContinuar: (aprovouAgora: boolean) => void;
  /** A página guarda o `descarregar` para mandar o pendente ao trocar de passo ou sair. */
  aoRegistrarDescarga: (f: (() => Promise<boolean>) | null) => void;
}

export function PassoEscolher({ mlItemId, ficha, isAdmin, podeCriar, resp, aoResposta, aoFalhar, aoContinuar, aoRegistrarDescarga }: Props) {
  const fam = ficha.familia_id;
  // Falha comum do salvar aparece no editor ("Não salvo" + "Tentar de novo"); a página só recebe as que mudam o chão.
  const h = useRascunhoRoteiro({
    mlItemId, familiaId: fam, resp, podeEditar: isAdmin, aoResposta,
    aoFalhar: (f) => { if (ERROS_DE_RECARGA.has(f.erro)) aoFalhar(f); },
  });
  const [aberta, setAberta] = useState(2);
  const [ocupado, setOcupado] = useState(false);
  const [avancadoManual, setAvancadoManual] = useState(false);

  const { descarregar } = h;
  useEffect(() => { aoRegistrarDescarga(descarregar); return () => aoRegistrarDescarga(null); }, [descarregar, aoRegistrarDescarga]);

  const elegiveis = useMemo(() => specsElegiveis(ficha.fatos), [ficha.fatos]);

  if (!resp || !h.rascunho) {
    return (
      <>
        <MioloPasso titulo="Escolher imagens" frase="Escolha quais imagens criar e confira os textos de cada uma.">
          <div className={cn(cartao, 'mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-10 text-center')}>
            <Sparkles aria-hidden className="size-6 text-primary" />
            {podeCriar ? (
              <>
                <p className="font-medium">Ainda não há textos para as imagens deste anúncio.</p>
                <p className="text-sm text-muted-foreground">A IA escreve os textos de cada imagem só com os dados confirmados. Você confere e ajusta antes de gerar.</p>
                <Button className="h-11 px-4" disabled={ocupado} onClick={async () => {
                  setOcupado(true);
                  const r = await criarRoteiro(mlItemId, fam);
                  setOcupado(false);
                  if (r.ok) aoResposta(r.dados); else aoFalhar(r);
                }}>
                  {ocupado ? <Loader2 aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}Criar os textos com IA
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Não foi possível ler os textos já criados. Recarregue a página.</p>
            )}
          </div>
        </MioloPasso>
        <Rodape texto="Crie os textos das imagens para continuar" ok={false} rotulo="Continuar" aoClicar={() => undefined} />
      </>
    );
  }

  const r = h.rascunho;
  const { roteiro, erros_por_missao: porMissao } = resp;
  const moda = roteiro.moda;
  const status = roteiro.status;
  const aprovado = status !== 'rascunho';
  const bloqueadaParaTodas = (n: number) => ficha.cores.length > 0 && ficha.cores.every((c) => motivoLupa(ficha, [c], n, moda) !== null);
  const indisponivel = (m: MissaoRoteiro) => lupaPendente(m.missao, moda) || bloqueadaParaTodas(m.missao) || IMPOSSIVEL.test(m.motivoDesligada ?? '');
  const motivoDe = (m: MissaoRoteiro): string | null => {
    if (lupaPendente(m.missao, moda)) return 'Em breve';
    const lupa = motivoLupa(ficha, ficha.cores, m.missao, moda);
    if (lupa) return lupa.charAt(0).toUpperCase() + lupa.slice(1);
    return motivoDesligadaTela(m);
  };
  const errosDe = (m: MissaoRoteiro) => errosDaMissao(m, moda, porMissao[String(m.missao)] ?? []);
  const ordem = [...r.missoes].sort((a, b) => Number(indisponivel(a) && !a.ativa) - Number(indisponivel(b) && !b.ativa) || a.missao - b.missao);
  const ligadas = r.missoes.filter((m) => m.ativa && !lupaPendente(m.missao, moda));
  const comErro = ligadas.find((m) => errosDe(m).length > 0);
  const errosGerais = (porMissao.geral ?? []).map((x) => traduzirErro(x));
  const erroContrato = errosGerais.find((e) => e.campo === 'contrato') ?? (r.contrato.trim() === '' ? { campo: 'contrato', texto: 'Descreva como o produto deve aparecer nas imagens.' } : undefined);
  const outrosGerais = errosGerais.filter((e) => e.campo !== 'contrato' && !/divergente/.test(e.texto));
  const mAberta = r.missoes.find((m) => m.missao === aberta) ?? r.missoes[0];
  const nomesCiencia = resp.ciencia_pendente.map((c) => rotuloFato(ficha.fatos.find((f) => f.campo === c) ?? { campo: c }));

  const rodape = (): { texto: string; ok: boolean } => {
    if (h.estado === 'erro') return { texto: 'Salve as alterações antes de continuar', ok: false };
    if (status === 'aprovado') return { texto: `Textos aprovados: ${ligadas.map((m) => nomeImagem(m.missao, moda)).join(', ')}`, ok: true };
    if (status === 'desatualizado') return { texto: 'Os dados mudaram depois da aprovação: clique em Editar e revise os textos', ok: false };
    if (!isAdmin) return { texto: 'Somente administradores aprovam os textos das imagens', ok: false };
    if (ligadas.length === 0) return { texto: 'Ligue ao menos 1 imagem para continuar', ok: false };
    if (comErro) return { texto: `Ajuste os textos de ${nomeImagem(comErro.missao, moda)} para continuar`, ok: false };
    if (erroContrato) return { texto: 'Preencha as regras de aparência do produto em Ajustes avançados', ok: false };
    if (outrosGerais.length > 0) return { texto: outrosGerais[0].texto, ok: false };
    if (h.faltaCiencia) return { texto: 'Marque "usar mesmo assim" para os dados sem etiqueta', ok: false };
    return { texto: `${ligadas.length} ${ligadas.length === 1 ? 'imagem ligada' : 'imagens ligadas'}: ${ligadas.map((m) => nomeImagem(m.missao, moda)).join(', ')}`, ok: true };
  };

  async function continuar() {
    if (aprovado) { aoContinuar(false); return; }
    setOcupado(true);
    try {
      if (!(await h.descarregar())) return;
      const atual = h.atual();
      if (!atual) return;
      // R1.3: o salvar pode trazer pendência nova de ciência; só vai ao servidor o que o operador marcou.
      if (atual.ciencia_pendente.some((c) => !h.ciente.has(c))) return;
      const a = await aprovarRoteiro(mlItemId, fam, atual.roteiro.id, atual.ciencia_pendente);
      if (!a.ok) { aoFalhar(a); return; }
      toast.success('Textos aprovados');
      aoContinuar(true);
    } finally { setOcupado(false); }
  }

  return (
    <>
      <MioloPasso titulo="Escolher imagens" frase="Escolha quais imagens criar e confira os textos de cada uma.">
        {outrosGerais.map((e) => <div key={e.texto} className="mb-4"><LinhaErro texto={e.texto} /></div>)}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-4">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              {ordem.map((m) => {
                const na = indisponivel(m) && !m.ativa;
                const motivo = !m.ativa ? motivoDe(m) : lupaPendente(m.missao, moda) ? 'Em breve: não será gerada' : null;
                const nome = nomeImagem(m.missao, moda);
                const erro = m.ativa && errosDe(m).length > 0;
                return (
                  <li key={m.missao} data-missao={m.missao}
                    className={cn(cartao, 'flex flex-col transition-shadow hover:shadow-md', aberta === m.missao && 'ring-2 ring-primary')}>
                    <button type="button" aria-label={`${nome}: ver textos`} aria-current={aberta === m.missao || undefined}
                      className="flex flex-col gap-2 rounded-xl p-2.5 pb-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => setAberta(m.missao)}>
                      <EsbocoMissao missao={m.missao} moda={moda} apagado={!m.ativa} />
                      <span className={cn('flex items-center gap-1.5 font-semibold', na && 'text-muted-foreground')}>
                        {nome}
                        {erro && <><span aria-hidden className="size-2 rounded-full bg-destructive" /><span className="sr-only">precisa de ajuste</span></>}
                      </span>
                      <span className="min-h-8 text-xs text-muted-foreground">{motivo ?? descricaoImagem(m.missao, moda)}</span>
                    </button>
                    <div className="flex items-center justify-between px-2.5 pb-1">
                      <span className="text-xs text-muted-foreground">{na ? 'Indisponível' : m.ativa ? 'Será criada' : 'Desligada'}</span>
                      <div className="flex min-h-11 min-w-11 items-center justify-end">
                        <Switch className="after:-inset-y-3.5" checked={m.ativa} aria-label={`Criar a imagem ${nome}`}
                          disabled={!h.editavel || m.missao === 1 || (!m.ativa && indisponivel(m))}
                          onCheckedChange={(v) => h.editar((x) => editarMissao(x, m.missao, { ativa: v }))} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {resp.ciencia_pendente.length > 0 && !aprovado && (
              <div className={cn(cartao, 'flex min-h-11 items-start gap-3 px-4 py-3')}>
                <Checkbox id="ciencia" className="mt-0.5" checked={!h.faltaCiencia} disabled={!isAdmin}
                  aria-label="Usar mesmo assim os dados sem etiqueta" onCheckedChange={(v) => h.marcarCiencia(v === true)} />
                <label htmlFor="ciencia" className="cursor-pointer text-sm">
                  <span className="font-medium">Alguns dados não aparecem na etiqueta: {nomesCiencia.join(' e ')}.</span>
                  <br /><span className="text-muted-foreground">Usar mesmo assim nas imagens.</span>
                </label>
              </div>
            )}
          </div>
          <Editor
            key={mAberta.missao}
            m={mAberta} moda={moda} h={h} isAdmin={isAdmin} status={status} erros={mAberta.ativa ? errosDe(mAberta) : []}
            motivo={!mAberta.ativa ? motivoDe(mAberta) : null} erroContrato={erroContrato?.texto}
            elegiveis={elegiveis} fatos={ficha.fatos}
            avancadoAberto={avancadoManual} aoAlternarAvancado={setAvancadoManual}
          />
        </div>
      </MioloPasso>
      <Rodape {...rodape()} rotulo="Continuar" ocupado={ocupado} aoClicar={() => void continuar()} />
    </>
  );
}

function Editor({ m, moda, h, isAdmin, status, erros, motivo, erroContrato, elegiveis, fatos, avancadoAberto, aoAlternarAvancado }: {
  m: MissaoRoteiro; moda: boolean; h: ReturnType<typeof useRascunhoRoteiro>; isAdmin: boolean; status: string;
  erros: ErroTela[]; motivo: string | null; erroContrato?: string; elegiveis: ReturnType<typeof specsElegiveis>;
  fatos: Ficha['fatos']; avancadoAberto: boolean; aoAlternarAvancado: (v: boolean) => void;
}) {
  const nome = nomeImagem(m.missao, moda);
  const dis = !h.editavel;
  const erroDe = (campo: string) => erros.find((e) => e.campo === campo)?.texto;
  const soltos = erros.filter((e) => e.campo === null);
  const mudar = (parte: Partial<MissaoRoteiro>) => h.editar((x) => editarMissao(x, m.missao, parte));
  const cena = missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).find((d) => d.missao === m.missao)?.usaGerador !== false;
  const erroCena = erroDe('cena');
  // Erro em campo recolhido abre a seção sozinho (Ajuste v2-7).
  const avancado = avancadoAberto || !!erroCena || !!erroContrato;
  const comTexto = !moda && m.missao !== 1;
  const campos = comTexto ? CAMPOS_DA_MISSAO[m.missao] ?? [] : [];
  // Campo preenchido fora do layout aparece para poder ser apagado (nunca some em silêncio).
  const mostra = (k: 'subheadline' | 'beneficios' | 'etapas' | 'legendas' | 'specs') =>
    campos.includes(k) || (comTexto && (Array.isArray(m[k]) ? (m[k] as unknown[]).length > 0 : !!m[k]));

  const lista = (k: 'beneficios' | 'etapas' | 'legendas', rotulo: string) => {
    const cap = CAPACIDADE[m.missao]?.[k] ?? (m[k]?.length ?? 0);
    const itens = Array.from({ length: Math.max(cap, m[k]?.length ?? 0) }, (_, i) => m[k]?.[i] ?? '');
    return itens.map((v, i) => (
      <CampoTexto key={`${k}${i}`} id={`f-${k}-${i}`} rotulo={`${rotulo} ${i + 1}`} valor={v} limite={LIMITE_DO_CAMPO[k]}
        erro={erroDe(`${k}.${i}`) ?? (i === 0 ? erroDe(k) : undefined)} desabilitado={dis}
        aoMudar={(t) => { const n = [...itens]; n[i] = t; mudar({ [k]: n }); }} />
    ));
  };

  return (
    <section aria-labelledby="ed-t" className={cn(cartao, 'xl:sticky xl:top-40')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5">
        <div>
          <h2 id="ed-t" className="text-base font-semibold">{nome}</h2>
          <p className="text-xs text-muted-foreground">{m.ativa ? 'Só os campos que aparecem nesta imagem' : 'Desligada: os textos ficam guardados'}</p>
        </div>
        {h.editavel && <span aria-live="polite"><IndicadorSalvo estado={h.estado} /></span>}
      </div>
      {h.estado === 'erro' && (
        <div className="px-4 pt-3">
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm ring-1 ring-warning/25">
            <AlertTriangle aria-hidden className="size-4 text-warning" />
            <span className="flex-1">Não foi possível salvar a última alteração. Seus textos continuam aqui.</span>
            <Button variant="outline" className="h-11 px-3" onClick={() => void h.tentarDeNovo()}><RefreshCw aria-hidden />Tentar de novo</Button>
          </div>
        </div>
      )}
      {status !== 'rascunho' && (
        <div className="px-4 pt-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-info/10 p-3 text-sm ring-1 ring-info/25">
            <Info aria-hidden className="size-4 text-info" />
            <span className="flex-1">
              {status === 'desatualizado' ? 'Os dados mudaram depois da aprovação. Edite para revisar: isso cria uma nova versão.'
                : 'Textos aprovados. Para mudar, edite: isso cria uma nova versão.'}
            </span>
            {isAdmin && <Button variant="outline" className="h-11 px-3" onClick={() => void h.editarAprovado()}><Pencil aria-hidden />Editar</Button>}
          </div>
        </div>
      )}
      {!isAdmin && status === 'rascunho' && (
        <p className="mx-4 mt-3 flex gap-2 rounded-lg bg-muted p-3 text-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />Somente administradores editam e aprovam os textos. Você está vendo em modo leitura.
        </p>
      )}
      <div className="flex flex-col gap-4 p-4">
        {motivo && <p className="text-sm text-muted-foreground">{motivo}</p>}
        {soltos.map((e) => <LinhaErro key={e.texto} texto={e.texto} />)}
        {m.missao === 1 && !moda && <p className="text-xs text-muted-foreground">A capa usa só a foto do produto, sem texto. Não há o que preencher.</p>}
        {moda && <p className="text-xs text-muted-foreground">Imagens de moda não levam texto: só a cena.</p>}
        {comTexto && (
          <CampoTexto id="f-headline" rotulo="Título" valor={m.headline ?? ''} limite={LIMITES.headline} erro={erroDe('headline')}
            desabilitado={dis} aoMudar={(v) => mudar({ headline: v })} />
        )}
        {mostra('subheadline') && (
          <CampoTexto id="f-subheadline" rotulo="Subtítulo" valor={m.subheadline ?? ''} limite={LIMITES.subheadline}
            erro={erroDe('subheadline')} desabilitado={dis} aoMudar={(v) => mudar({ subheadline: v })} />
        )}
        {mostra('beneficios') && lista('beneficios', 'Benefício')}
        {mostra('etapas') && lista('etapas', 'Passo')}
        {mostra('legendas') && lista('legendas', 'Legenda')}
        {mostra('specs') && (
          <Specs m={m} dis={dis} erro={erroDe('specs')} elegiveis={elegiveis} fatos={fatos} h={h} />
        )}
        <details open={avancado} className="rounded-lg ring-1 ring-border"
          onToggle={(e) => { const aberto = (e.currentTarget as HTMLDetailsElement).open; if (aberto !== avancado) aoAlternarAvancado(aberto); }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className={cn('size-4 text-muted-foreground transition-transform', avancado && 'rotate-90')} />Ajustes avançados
          </summary>
          <div className="flex flex-col gap-4 p-3 pt-1">
            {cena && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="f-cena" className="text-sm font-medium">Descrição da cena</label>
                <Textarea id="f-cena" rows={3} value={m.cena} disabled={dis} aria-invalid={!!erroCena || undefined}
                  aria-describedby={erroCena ? 'f-cena-erro' : undefined} onChange={(e) => mudar({ cena: e.target.value })} />
                {erroCena && <LinhaErro id="f-cena-erro" texto={erroCena} />}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="f-contrato" className="text-sm font-medium">Regras de aparência do produto <span className="font-normal text-muted-foreground">(valem para todas as imagens)</span></label>
              <Textarea id="f-contrato" rows={4} value={h.rascunho?.contrato ?? ''} disabled={dis} aria-invalid={!!erroContrato || undefined}
                aria-describedby={erroContrato ? 'f-contrato-erro' : undefined}
                onChange={(e) => { const v = e.target.value; h.editar((x) => ({ ...x, contrato: v })); }} />
              {erroContrato && <LinhaErro id="f-contrato-erro" texto={erroContrato} />}
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

/** Ficha técnica: até `CAPACIDADE[5].specs` pares escolhidos da lista de dados confirmados (nunca digitados). */
function Specs({ m, dis, erro, elegiveis, fatos, h }: {
  m: MissaoRoteiro; dis: boolean; erro?: string; elegiveis: ReturnType<typeof specsElegiveis>; fatos: Ficha['fatos'];
  h: ReturnType<typeof useRascunhoRoteiro>;
}) {
  const specs = m.specs ?? [];
  const cap = CAPACIDADE[m.missao]?.specs ?? 4;
  const escolher = (i: number, campo: string) => {
    const f = fatos.find((x) => x.campo === campo);
    if (f) h.editar((x) => definirSpec(x, m.missao, i, f));
  };
  const linhas = specs.length < cap && !dis ? [...specs, null] : specs;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={erro ? 'f-specs-erro' : undefined}>
      <legend className="mb-1 text-sm font-medium">Dados da ficha técnica</legend>
      <p className="text-xs text-muted-foreground">Escolha da lista de dados confirmados. O valor entra como está no cadastro.</p>
      {elegiveis.length === 0 && <LinhaErro texto="Nenhum dado confirmado cabe na ficha técnica. Volte ao passo 1 e confirme ao menos um." />}
      {linhas.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
          <Select value={s && elegiveis.some((f) => f.campo === s.campo) ? s.campo : ''} disabled={dis} onValueChange={(v) => escolher(i, v)}>
            <SelectTrigger aria-label={`Dado ${i + 1}`} className="h-11 w-full"><SelectValue placeholder={s?.rotulo ?? 'Escolher dado'} /></SelectTrigger>
            <SelectContent>
              {elegiveis.map((f) => <SelectItem key={f.campo} value={f.campo}>{rotuloFato(f)}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className={cn('truncate text-sm tabular-nums', !s && 'text-muted-foreground')}>{s ? s.valor : 'vazio'}</span>
          {s ? (
            <Button variant="ghost" size="icon" className="size-11" disabled={dis} aria-label={`Remover dado ${i + 1}`}
              onClick={() => h.editar((x) => removerSpec(x, m.missao, i))}><X aria-hidden /></Button>
          ) : <span className="size-11" />}
        </div>
      ))}
      {erro && <LinhaErro id="f-specs-erro" texto={erro} />}
    </fieldset>
  );
}
