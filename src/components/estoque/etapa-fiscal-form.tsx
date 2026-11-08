// ADR-0135 D-9 — etapa fiscal do cadastro manual de produto. Sempre condicional (só quando a
// org tem o módulo fiscal): ver dialog-cadastro-produto.tsx. As regras de completude espelham
// `camposFiscaisFaltantes` (supabase/functions/_shared/fiscal/validar.ts) para os campos que
// este form cobre — a edge continua sendo a autoridade final (400 com `erros[]`).
import type { ReactNode } from 'react';
import { AlertTriangle, FileText, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { CSOSN_OPCOES, ORIGENS_NFE_POR_ORIGEM } from '@/lib/fiscal';
import type { NcmStatus } from '@/hooks/useNcmOficial';
import type { CestExisteStatus, CestOficial } from '@/hooks/useCestOficial';
import type { AvisosFiscaisNota } from '@/components/estoque/dialog-cadastro-produto';

export interface FiscalForm {
  ncm: string;
  cest: string;
  origemNfe: string;
  fci: string;
  exTipi: string;
  tributacaoIcms: string;
  /** ADR-0181 D-5: texto da nota de venda do ML. Vazio = usa o nome do produto. */
  descricaoFiscal: string;
}

export function fiscalVazio(): FiscalForm {
  return { ncm: '', cest: '', origemNfe: '', fci: '', exTipi: '', tributacaoIcms: '', descricaoFiscal: '' };
}

/** ADR-0181 D-10: confirmações obrigatórias do operador sobre o que veio da nota. */
export interface ConfirmacoesNota { conferido: boolean; semCestVigente: boolean; interestadualConferido: boolean }
export const CONFIRMACOES_VAZIAS: ConfirmacoesNota = { conferido: false, semCestVigente: false, interestadualConferido: false };

export function confirmacoesNotaOk(f: FiscalForm, avisos: AvisosFiscaisNota | undefined, c: ConfirmacoesNota): boolean {
  // CEST pelo valor ATUAL: apagar o que veio da nota também exige a declaração.
  return c.conferido && (!avisos || !!f.cest || c.semCestVigente) && (!avisos?.interestadual || c.interestadualConferido);
}

/** Matriz de invalidação: mexeu no campo atestado → a confirmação cai. */
export function confirmacoesAposMudanca(c: ConfirmacoesNota, antes: FiscalForm, depois: FiscalForm): ConfirmacoesNota {
  const mudou = (...ks: Array<keyof FiscalForm>) => ks.some((k) => antes[k] !== depois[k]);
  return {
    conferido: mudou('ncm', 'origemNfe', 'tributacaoIcms', 'cest', 'fci') ? false : c.conferido,
    semCestVigente: mudou('ncm', 'cest') ? false : c.semCestVigente,
    interestadualConferido: mudou('tributacaoIcms') ? false : c.interestadualConferido,
  };
}

// Códigos de origem_nfe que exigem FCI (spec §2.3). Usado tanto na validação (fiscalCompleto)
// quanto no onChange do select abaixo — trocar de origem para fora deste conjunto precisa
// LIMPAR o fci, senão um valor de FCI de uma origem anterior sobrevive escondido no payload
// (dado fiscal sujo em silêncio — regra inviolável do projeto).
const ORIGENS_COM_FCI = [3, 5, 8];

/** Mesmas regras de `camposFiscaisFaltantes`, restritas aos campos deste form (unidade fica de
 *  fora — validada pela edge sobre o campo `unidade` da família, fora do escopo deste tipo). */
export function fiscalCompleto(
  f: FiscalForm, origem: 'nacional' | 'importado' | null, ncmStatus: NcmStatus, cestStatus: CestExisteStatus,
): boolean {
  if (!/^\d{8}$/.test(f.ncm)) return false;
  // ADR-0187: NCM precisa existir e vigorar na tabela oficial (carregando/erro também travam).
  if (ncmStatus !== 'ok') return false;
  if (!origem) return false;
  if (!f.origemNfe) return false;
  const origemNfe = Number(f.origemNfe);
  if (!ORIGENS_NFE_POR_ORIGEM[origem].includes(origemNfe)) return false;
  if (ORIGENS_COM_FCI.includes(origemNfe) && !f.fci.trim()) return false;
  if (!f.tributacaoIcms.trim()) return false;
  if (f.cest && !/^\d{7}$/.test(f.cest)) return false;
  // Emenda D-7 do ADR-0197: CEST fora da tabela oficial trava (carregando/erro também, como o NCM).
  if (f.cest && cestStatus !== 'ok') return false;
  return true;
}

// Rótulos oficiais da tabela do Anexo (spec §2.3, ADR-0135 D-5).
const ROTULOS_ORIGEM_NFE: Record<number, string> = {
  0: '0 — Nacional',
  1: '1 — Estrangeira – importação direta',
  2: '2 — Estrangeira – adquirida no mercado interno',
  3: '3 — Nacional >40% importado',
  4: '4 — Nacional – processos básicos',
  5: '5 — Nacional ≤40% importado',
  6: '6 — Estrangeira – importação direta sem similar',
  7: '7 — Estrangeira – mercado interno sem similar',
  8: '8 — Nacional >70% importado',
};

function soDigitos(v: string, max: number): string {
  return v.replace(/\D/g, '').slice(0, max);
}

/** ADR-0181 D-10: selo dos campos que vieram da nota do fornecedor. */
function SeloNota({ texto = 'Veio da nota do fornecedor — confira' }: { texto?: string }) {
  return (
    <StatusPill tone="info" className="w-fit">
      <FileText className="h-3 w-3" /> {texto}
    </StatusPill>
  );
}

const ORIENTACAO_CONTADOR = [
  '102 — tributada pelo Simples, sem crédito, quando não se enquadrar em código específico',
  '103 — isenção por faixa de receita bruta do Simples',
  '300 — operação imune ao ICMS',
  '400 — não tributada pelo ICMS no Simples',
  '500 — ICMS já cobrado por ST ou antecipação',
];

function AvisoNota({ children }: { children: ReactNode }) {
  return (
    <StatusPill tone="warning" className="max-w-full items-start whitespace-normal rounded-md text-left">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{children}</span>
    </StatusPill>
  );
}

function NcmOficialInfo({ ncm, status, descricao }: { ncm: string; status: NcmStatus; descricao: string | null }) {
  if (status === 'ok') {
    return <span className="text-xs text-muted-foreground">{`${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6)} — ${descricao}`}</span>;
  }
  const erro = status === 'inexistente' ? `NCM ${ncm} não existe na tabela oficial`
    : status === 'vencido' ? `NCM ${ncm} não está mais vigente`
    : status === 'erro' ? 'Não foi possível verificar o NCM' : null;
  return erro ? <span className="text-xs text-destructive" role="alert">{erro}</span> : null;
}

export function EtapaFiscalForm({
  valor, origem, onMudar, sugestaoNcm, carregandoSugestao, onAplicarSugestao, csosnPadrao,
  sugestaoDaNota, confirmacoes, onConfirmar, avisosNota, ncmOficial, cestOficial, cestNota, cestExiste,
}: {
  valor: FiscalForm;
  origem: 'nacional' | 'importado' | null;
  onMudar: (patch: Partial<FiscalForm>) => void;
  sugestaoNcm: { ncm: string; justificativa: string } | null;
  carregandoSugestao: boolean;
  onAplicarSugestao: () => void;
  /** ADR-0181 D-10: `empresa_fiscal.csosn_padrao_revenda`. Só SUGERE (botão) — nunca preenche
   *  sozinho: campo fiscal nunca entra por default silencioso. */
  csosnPadrao?: string | null;
  /** ADR-0181 D-10: campos fiscais pré-preenchidos pela nota — selo + "Conferi" obrigatório
   *  (o dialog trava o Cadastrar até `confirmacoesNotaOk`). */
  sugestaoDaNota?: boolean;
  confirmacoes?: ConfirmacoesNota;
  onConfirmar?: (patch: Partial<ConfirmacoesNota>) => void;
  avisosNota?: AvisosFiscaisNota;
  /** ADR-0187: resultado de `useNcmOficial(valor.ncm)`, chamado pelo dialog (que também o passa
   *  a `fiscalCompleto`). */
  ncmOficial?: { status: NcmStatus; descricao: string | null };
  /** ADR-0197: candidatos da tabela oficial, só quando o XML não trouxe CEST. */
  cestOficial?: CestOficial;
  /** CEST que veio do XML: o selo "Veio da nota" só vale para este valor. */
  cestNota?: string;
  /** Emenda D-7 do ADR-0197: `useCestExiste(valor.cest)`, também passado a `fiscalCompleto`. */
  cestExiste?: CestExisteStatus;
}) {
  const codigosOrigem = origem ? ORIGENS_NFE_POR_ORIGEM[origem] : [];
  const candidatoCest = cestOficial?.candidatos.find((c) => c.cest === valor.cest);
  const cestErro = cestExiste === 'inexistente' ? `CEST ${valor.cest} não existe na tabela oficial`
    : cestExiste === 'erro' ? 'Não foi possível verificar o CEST' : null;
  // CEST existe mas não é de nenhum candidato do NCM: só avisa (a tabela sugere, não decide).
  const cestCarregado = cestOficial?.status === 'sem' || cestOficial?.status === 'unico_exato' || cestOficial?.status === 'varios';
  const cestForaDoNcm = cestExiste === 'ok' && cestCarregado && !candidatoCest;
  // Fora do fluxo da nota: candidatos viram atalho sempre que o valor atual não é um deles.
  const mostrarCandidatos = !avisosNota && !!cestOficial?.candidatos.length && !candidatoCest;
  const sugerirCsosn = !valor.tributacaoIcms && !!csosnPadrao
    && CSOSN_OPCOES.some((o) => o.valor === csosnPadrao);
  const fciVisivel = ORIGENS_COM_FCI.includes(Number(valor.origemNfe));
  const excecao = avisosNota?.classe === 'excecao';
  const conf = confirmacoes ?? CONFIRMACOES_VAZIAS;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {/* Asterisco FORA do <label> — mesmo padrão de dialog-cadastro-produto.tsx (o texto do
            <label> vira o nome acessível usado por getByLabelText nos testes). */}
        <span className="flex items-baseline gap-1 text-sm font-medium">
          <label htmlFor="fiscal-ncm">NCM</label>
          <span className="text-destructive" aria-hidden="true">*</span>
        </span>
        <Input
          id="fiscal-ncm"
          value={valor.ncm}
          // Sem maxLength: colar "6203.49.00" truncaria para 8 caracteres ANTES de soDigitos e
          // perderia dígitos; soDigitos já limita a 8.
          onChange={(e) => onMudar({ ncm: soDigitos(e.target.value, 8) })}
        />
        {ncmOficial && <NcmOficialInfo ncm={valor.ncm} {...ncmOficial} />}
        <span className="text-xs text-muted-foreground">
          8 dígitos — a Nomenclatura Comum do Mercosul do produto.
        </span>
        {sugestaoDaNota && <SeloNota />}
        {/* Só afirma proveniência IA enquanto o campo está vazio ou ainda bate com a sugestão —
            uma vez que o operador digita por cima, o valor deixou de ser "da IA". */}
        {sugestaoNcm?.ncm && (!valor.ncm || valor.ncm === sugestaoNcm.ncm) && (
          <StatusPill tone="info" className="w-fit">
            <Sparkles className="h-3 w-3" /> Sugerida por IA — confira
          </StatusPill>
        )}
        {(carregandoSugestao || sugestaoNcm?.ncm) && (
          <button
            type="button"
            onClick={onAplicarSugestao}
            disabled={carregandoSugestao}
            className="w-full rounded-md border border-info/40 bg-info/5 p-1.5 text-left text-xs hover:bg-info/10 disabled:cursor-wait disabled:opacity-60"
          >
            {carregandoSugestao ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando sugestão…</span>
            ) : (
              <><span className="font-medium">Sugestão (IA):</span> {sugestaoNcm!.ncm} — {sugestaoNcm!.justificativa}</>
            )}
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          {/* Sem <label htmlFor>: o `aria-label` do select já dá o nome acessível exato
              ("Origem fiscal (NF-e)") usado por getByLabelText — igual ao rádio de Origem em
              dialog-cadastro-produto.tsx, que também usa <span>, não <label>. */}
          <span className="text-sm font-medium">
            Origem fiscal (NF-e)<span className="text-destructive"> *</span>
          </span>
          <Select
            value={valor.origemNfe}
            onValueChange={(v) => onMudar({ origemNfe: v, ...(ORIGENS_COM_FCI.includes(Number(v)) ? {} : { fci: '' }) })}
          >
            <SelectTrigger id="fiscal-origem-nfe" aria-label="Origem fiscal (NF-e)" className="w-full">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {codigosOrigem.map((c) => (
                <SelectItem key={c} value={String(c)}>{ROTULOS_ORIGEM_NFE[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sugestaoDaNota && <SeloNota />}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            CSOSN<span className="text-destructive"> *</span>
          </span>
          <Select value={valor.tributacaoIcms} onValueChange={(v) => onMudar({ tributacaoIcms: v })}>
            <SelectTrigger id="fiscal-csosn" aria-label="CSOSN" className="w-full">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {CSOSN_OPCOES.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
          {sugestaoDaNota && !!valor.tributacaoIcms && <SeloNota texto="CSOSN de saída da empresa — confira" />}
          {avisosNota?.classe === 'st' && (
            <AvisoNota>Nota do fornecedor com ST ({avisosNota.codigoFornecedor}) — CSOSN 500.</AvisoNota>
          )}
          {excecao && (
            <>
              <AvisoNota>
                O fornecedor usou {avisosNota?.codigoFornecedor ?? 'um código sem regra'} (isenção, imunidade ou caso especial).
                Escolha o CSOSN de saída analisando o motivo — orientação do contador:
              </AvisoNota>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {ORIENTACAO_CONTADOR.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </>
          )}
          {avisosNota?.semPadrao && <AvisoNota>Sem CSOSN padrão de revenda no card Empresa — escolha o CSOSN.</AvisoNota>}
          {avisosNota?.interestadual && (
            <>
              <AvisoNota>Compra de outro estado: pode haver ST por antecipação. Confira o CSOSN com o contador.</AvisoNota>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" checked={conf.interestadualConferido}
                  onChange={(e) => onConfirmar?.({ interestadualConferido: e.target.checked })}
                />
                Conferi o CSOSN com o contador<span className="text-destructive" aria-hidden="true"> *</span>
              </label>
            </>
          )}
          {sugerirCsosn && !excecao && (
            <button
              type="button"
              onClick={() => onMudar({ tributacaoIcms: csosnPadrao! })}
              className="w-fit text-left text-xs text-info underline-offset-2 hover:underline"
            >
              Usar padrão da empresa ({csosnPadrao})
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fiscal-cest" className="text-sm font-medium">CEST</label>
          <Input
            id="fiscal-cest"
            value={valor.cest}
            maxLength={7}
            onChange={(e) => onMudar({ cest: soDigitos(e.target.value, 7) })}
          />
          <span className="text-xs text-muted-foreground">7 dígitos — opcional.</span>
          {cestErro && <span className="text-xs text-destructive" role="alert">{cestErro}</span>}
          {cestForaDoNcm && (
            <AvisoNota>CEST {valor.cest} não consta para o NCM {valor.ncm} na tabela oficial — confira o enquadramento.</AvisoNota>
          )}
          {mostrarCandidatos && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tabela oficial — CEST deste NCM:</span>
              {cestOficial!.candidatos.map((c) => (
                <Button
                  key={c.cest} type="button" variant="outline" size="sm"
                  className="h-auto justify-start whitespace-normal py-1.5 text-left"
                  onClick={() => onMudar({ cest: c.cest })}
                >
                  {c.cest} — {c.descricao}
                </Button>
              ))}
            </div>
          )}
          {sugestaoDaNota && !!valor.cest && valor.cest === cestNota && <SeloNota />}
          {candidatoCest && (
            <>
              <SeloNota texto="Sugerido pela tabela oficial — confira" />
              <span className="text-xs text-muted-foreground">{candidatoCest.descricao}</span>
            </>
          )}
          {avisosNota && !valor.cest && (
            <>
              <AvisoNota>
                {cestOficial?.status === 'sem'
                  ? 'A nota não trouxe CEST e este NCM não consta da tabela oficial. Preencha se o produto tiver CEST.'
                  : 'A nota não trouxe CEST. Preencha se o produto tiver CEST vigente.'}
              </AvisoNota>
              {!!cestOficial?.candidatos.length && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Tabela oficial — escolha pela descrição do produto:</span>
                  {cestOficial.candidatos.map((c) => (
                    <Button
                      key={c.cest} type="button" variant="outline" size="sm"
                      className="h-auto justify-start whitespace-normal py-1.5 text-left"
                      onClick={() => onMudar({ cest: c.cest })}
                    >
                      {c.cest} — {c.descricao}
                    </Button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" checked={conf.semCestVigente}
                  onChange={(e) => onConfirmar?.({ semCestVigente: e.target.checked })}
                />
                Este produto não se enquadra em CEST<span className="text-destructive" aria-hidden="true"> *</span>
              </label>
            </>
          )}
        </div>

        {fciVisivel && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-baseline gap-1 text-sm font-medium">
              <label htmlFor="fiscal-fci">FCI</label>
              <span className="text-destructive" aria-hidden="true">*</span>
            </span>
            <Input id="fiscal-fci" value={valor.fci} onChange={(e) => onMudar({ fci: e.target.value })} />
            <span className="text-xs text-muted-foreground">
              Obrigatório para origem fiscal 3, 5 ou 8.
            </span>
            {sugestaoDaNota && !!valor.fci && <SeloNota />}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fiscal-ex-tipi" className="text-sm font-medium">EX TIPI</label>
        <Input id="fiscal-ex-tipi" value={valor.exTipi} onChange={(e) => onMudar({ exTipi: e.target.value })} />
        <span className="text-xs text-muted-foreground">Opcional.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fiscal-descricao" className="text-sm font-medium">Descrição na nota fiscal</label>
        <Input
          id="fiscal-descricao"
          value={valor.descricaoFiscal}
          maxLength={120}
          onChange={(e) => onMudar({ descricaoFiscal: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">
          É o texto que sai na nota de venda do Mercado Livre. Vazio = usa o nome do produto.
        </span>
      </div>

      {sugestaoDaNota && (
        <label className="flex items-center gap-2 rounded-md border border-info/40 bg-info/5 p-2 text-sm">
          <input type="checkbox" checked={conf.conferido} onChange={(e) => onConfirmar?.({ conferido: e.target.checked })} />
          Conferi os dados fiscais (NCM, origem, CSOSN, CEST)<span className="text-destructive" aria-hidden="true"> *</span>
        </label>
      )}
    </div>
  );
}
