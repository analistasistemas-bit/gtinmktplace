// ADR-0201 (Task 7b): passo "Roteiro". A validação é do servidor (`erros`/`erros_por_missao`); a tela mostra o erro na
// própria missão, que segue ativa até o operador corrigir ou desativar. Contadores de palavras só avisam (limites de regras.ts).
// Task 12 (fix 1): a largura do texto na caixa do layout (`motivosDeTexto`, a mesma regra da composição) é conferida
// aqui, antes de aprovar — estourar só na aprovação da imagem obrigaria a gerar (e pagar) de novo.
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import {
  aprovarRoteiro, criarRoteiro, motivoLupa, salvarRoteiro,
  type Ficha, type MissaoRoteiro, type RespostaRoteiro, type Res, type Roteiro,
} from '@/lib/galeria/api';
import { motivosDeTexto } from '@/lib/galeria/compor';

/** Espelho de `LIMITES` (supabase/functions/_shared/galeria/regras.ts). */
const LIMITES = { headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5 } as const;
const NOMES_GERAL = ['Capa', 'Contexto de uso', 'Quebra de objeção', 'Benefícios', 'Especificações', 'Como usar', 'Detalhes'];
const NOMES_MODA = ['Capa', 'Em uso', 'De costas', 'Lateral', 'Detalhe do tecido', 'Combinação', 'Detalhe de alça, gola ou costura'];

const palavras = (t: string) => (t.trim() === '' ? 0 : t.trim().split(/\s+/).length);

function Contador({ texto, limite }: { texto: string; limite: number }) {
  const n = palavras(texto);
  return (
    <span className={n > limite ? 'text-xs font-semibold text-red-600' : 'text-xs text-muted-foreground'}
      data-excedeu={n > limite} aria-label={`${n} de ${limite} palavras`}>
      {n}/{limite}
    </span>
  );
}

function Campo({ rotulo, valor, limite, aoMudar }: { rotulo: string; valor: string; limite: number; aoMudar: (v: string) => void }) {
  return (
    <div className="block text-sm">
      <span className="mb-1 flex items-center justify-between">{rotulo}<Contador texto={valor} limite={limite} /></span>
      <Input aria-label={rotulo} value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </div>
  );
}

/** Lista de textos, um por linha; o contador mostra a linha mais longa. */
function Lista({ rotulo, itens, limite, aoMudar }: { rotulo: string; itens: string[]; limite: number; aoMudar: (v: string[]) => void }) {
  const maior = itens.reduce((a, b) => (palavras(b) > palavras(a) ? b : a), '');
  return (
    <div className="block text-sm">
      <span className="mb-1 flex items-center justify-between">{rotulo} (um por linha)<Contador texto={maior} limite={limite} /></span>
      <Textarea aria-label={rotulo} rows={3} value={itens.join('\n')} onChange={(e) => aoMudar(e.target.value.split('\n'))} />
    </div>
  );
}

interface Props {
  mlItemId: string;
  ficha: Ficha;
  isAdmin: boolean;
  /** `ler` respondeu `roteiro: null`: só então "Criar roteiro" existe (senão criaria outra versão por cima do vigente). */
  podeCriar: boolean;
  resp: RespostaRoteiro | null;
  aoResposta: (r: RespostaRoteiro) => void;
  /** Resultado de falha de qualquer ação (o diálogo traduz, recarrega e limpa o roteiro conforme o erro). */
  aoFalhar: (r: Extract<Res<unknown>, { ok: false }>) => void;
  aoAprovar: () => void;
}

export function PassoRoteiro({ mlItemId, ficha, isAdmin, podeCriar, resp, aoResposta, aoFalhar, aoAprovar }: Props) {
  const [rascunho, setRascunho] = useState<Roteiro | null>(resp?.roteiro.conteudo ?? null);
  const [ocupado, setOcupado] = useState(false);
  const [ciente, setCiente] = useState<Set<string>>(new Set());
  useEffect(() => { setRascunho(resp?.roteiro.conteudo ?? null); setCiente(new Set()); }, [resp]);

  const sujo = useMemo(() => !!resp && !!rascunho && JSON.stringify(rascunho) !== JSON.stringify(resp.roteiro.conteudo), [resp, rascunho]);
  const fam = ficha.familia_id;

  async function rodar<T>(p: Promise<Res<T>>, ok: (d: T) => void) {
    setOcupado(true);
    try {
      const r = await p;
      if (r.ok) ok(r.dados); else aoFalhar(r);
    } finally { setOcupado(false); }
  }

  if (!resp || !rascunho) {
    if (!podeCriar) return <p className="text-sm text-muted-foreground">Não foi possível ler o roteiro existente. Feche e abra a galeria de novo.</p>;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O roteiro define o que cada imagem mostra e o texto dela. A IA escreve o rascunho; você revisa, edita e aprova.
        </p>
        <Button disabled={ocupado} onClick={() => rodar(criarRoteiro(mlItemId, fam), aoResposta)}>
          {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar roteiro
        </Button>
      </div>
    );
  }

  const { roteiro, erros, erros_por_missao: porMissao, ciencia_pendente: pendentes } = resp;
  const nomes = roteiro.moda ? NOMES_MODA : NOMES_GERAL;
  const comTexto = (n: number) => (roteiro.moda ? false : n !== 1);
  const aprovado = roteiro.status !== 'rascunho';
  const editar = (n: number, parte: Partial<MissaoRoteiro>) =>
    setRascunho({ ...rascunho, missoes: rascunho.missoes.map((m) => (m.missao === n ? { ...m, ...parte } : m)) });
  // Missão com lupa: o motivo vale para as cores bloqueadas; só ativar fica barrado quando TODAS estão (desativar nunca).
  const motivoDe = (n: number) => motivoLupa(ficha, ficha.cores, n, roteiro.moda);
  const bloqueadaParaTodas = (n: number) => ficha.cores.length > 0 && ficha.cores.every((c) => motivoLupa(ficha, [c], n, roteiro.moda) !== null);
  const faltaCiencia = pendentes.some((c) => !ciente.has(c));
  const largura = Object.fromEntries(rascunho.missoes.filter((m) => m.ativa)
    .map((m) => [m.missao, motivosDeTexto(m.missao, m, roteiro.moda)]).filter(([, ms]) => (ms as string[]).length > 0)) as Record<number, string[]>;
  const primeiraLarga = Object.keys(largura)[0];
  const motivoBloqueio = !isAdmin ? 'Somente administradores podem aprovar o roteiro'
    : sujo ? 'Salve as alterações antes de aprovar'
      : erros.length > 0 ? 'Corrija os erros do roteiro antes de aprovar'
        : primeiraLarga ? `Missão ${primeiraLarga}: ${largura[Number(primeiraLarga)][0]}`
          : faltaCiencia ? 'Marque a ciência dos fatos não conferidos'
            : aprovado ? 'Este roteiro já foi aprovado' : undefined;

  return (
    <div className="space-y-4">
      {(ficha.roteiro_desatualizado || roteiro.status === 'desatualizado') && (
        <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          Roteiro desatualizado: os fatos mudaram depois da aprovação. Salve para gerar uma nova versão e aprove de novo.
        </p>
      )}
      <div className="flex items-center gap-2 text-sm">
        <span>Versão {roteiro.versao}</span>
        <StatusPill tone={aprovado ? 'success' : 'neutral'}>{roteiro.status}</StatusPill>
        {roteiro.moda && <StatusPill tone="neutral">Moda: imagens sem texto</StatusPill>}
      </div>
      {(porMissao.geral ?? []).map((e) => <p key={e} role="alert" className="text-sm text-red-600">{e}</p>)}

      <div className="block text-sm">
        <span className="mb-1 block">Contrato de identidade</span>
        <Textarea aria-label="Contrato de identidade" rows={2} value={rascunho.contrato} onChange={(e) => setRascunho({ ...rascunho, contrato: e.target.value })} />
      </div>

      {rascunho.missoes.map((m) => (
        <section key={m.missao} aria-label={`Missão ${m.missao}`} className="space-y-2 rounded border p-3"
          data-erro={(porMissao[String(m.missao)] ?? []).length > 0}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{m.missao}. {nomes[m.missao - 1] ?? 'Missão'}</h4>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox checked={m.ativa} aria-label={`Missão ${m.missao} ativa`} disabled={!m.ativa && bloqueadaParaTodas(m.missao)}
                onCheckedChange={(v) => editar(m.missao, { ativa: v === true })} />
              Ativa
            </div>
          </div>
          {motivoDe(m.missao) && <p className="text-xs text-amber-700">{motivoDe(m.missao)}</p>}
          {[...(porMissao[String(m.missao)] ?? []), ...(largura[m.missao] ?? [])]
            .map((e) => <p key={e} role="alert" className="text-sm text-red-600">{e}</p>)}
          <div className="block text-sm">
            <span className="mb-1 block">Cena</span>
            <Textarea aria-label={`Cena da missão ${m.missao}`} rows={2} value={m.cena} onChange={(e) => editar(m.missao, { cena: e.target.value })} />
          </div>
          {comTexto(m.missao) && (
            <>
              <Campo rotulo="Título" valor={m.headline ?? ''} limite={LIMITES.headline} aoMudar={(v) => editar(m.missao, { headline: v })} />
              <Campo rotulo="Subtítulo" valor={m.subheadline ?? ''} limite={LIMITES.subheadline} aoMudar={(v) => editar(m.missao, { subheadline: v })} />
              <Lista rotulo="Benefícios" itens={m.beneficios ?? []} limite={LIMITES.beneficio} aoMudar={(v) => editar(m.missao, { beneficios: v })} />
              <Lista rotulo="Etapas" itens={m.etapas ?? []} limite={LIMITES.etapa} aoMudar={(v) => editar(m.missao, { etapas: v })} />
              <Lista rotulo="Legendas" itens={m.legendas ?? []} limite={LIMITES.legenda} aoMudar={(v) => editar(m.missao, { legendas: v })} />
              {(m.specs ?? []).length > 0 && (
                <dl className="text-sm">
                  {m.specs!.map((s) => (
                    <div key={s.campo} className="flex items-center gap-2">
                      <dt className="font-medium">{s.rotulo}:</dt><dd>{s.valor}</dd>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-xs" aria-label={`Remover spec ${s.rotulo}`}
                        onClick={() => editar(m.missao, { specs: m.specs!.filter((x) => x.campo !== s.campo) })}>
                        Remover
                      </Button>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </section>
      ))}

      {pendentes.length > 0 && (
        <fieldset className="rounded border p-3 text-sm">
          <legend className="px-1 font-medium">Ciência: fatos usados no texto e não conferidos na etiqueta</legend>
          {pendentes.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <Checkbox checked={ciente.has(c)} aria-label={`Ciente: ${c}`}
                onCheckedChange={(v) => setCiente((s) => { const n = new Set(s); if (v === true) n.add(c); else n.delete(c); return n; })} />
              Estou ciente de que “{c}” não foi conferido na etiqueta
            </div>
          ))}
        </fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={ocupado || !sujo}
          onClick={() => rodar(salvarRoteiro(mlItemId, fam, roteiro.id, rascunho), aoResposta)}>
          Salvar alterações
        </Button>
        <Button disabled={ocupado || !!motivoBloqueio} title={motivoBloqueio ?? 'Aprovar roteiro'}
          onClick={() => rodar(aprovarRoteiro(mlItemId, fam, roteiro.id, pendentes), aoAprovar)}>
          Aprovar roteiro
        </Button>
      </div>
    </div>
  );
}
