// ADR-0135 D-9 — etapa fiscal do cadastro manual de produto. Sempre condicional (só quando a
// org tem o módulo fiscal): ver dialog-cadastro-produto.tsx. As regras de completude espelham
// `camposFiscaisFaltantes` (supabase/functions/_shared/fiscal/validar.ts) para os campos que
// este form cobre — a edge continua sendo a autoridade final (400 com `erros[]`).
import { Loader2, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { ORIGENS_NFE_POR_ORIGEM } from '@/lib/fiscal';

export interface FiscalForm {
  ncm: string;
  cest: string;
  origemNfe: string;
  fci: string;
  exTipi: string;
  tributacaoIcms: string;
}

export function fiscalVazio(): FiscalForm {
  return { ncm: '', cest: '', origemNfe: '', fci: '', exTipi: '', tributacaoIcms: '' };
}

// Códigos de origem_nfe que exigem FCI (spec §2.3). Usado tanto na validação (fiscalCompleto)
// quanto no onChange do select abaixo — trocar de origem para fora deste conjunto precisa
// LIMPAR o fci, senão um valor de FCI de uma origem anterior sobrevive escondido no payload
// (dado fiscal sujo em silêncio — regra inviolável do projeto).
const ORIGENS_COM_FCI = [3, 5, 8];

/** Mesmas regras de `camposFiscaisFaltantes`, restritas aos campos deste form (unidade fica de
 *  fora — validada pela edge sobre o campo `unidade` da família, fora do escopo deste tipo). */
export function fiscalCompleto(f: FiscalForm, origem: 'nacional' | 'importado' | null): boolean {
  if (!/^\d{8}$/.test(f.ncm)) return false;
  if (!origem) return false;
  if (!f.origemNfe) return false;
  const origemNfe = Number(f.origemNfe);
  if (!ORIGENS_NFE_POR_ORIGEM[origem].includes(origemNfe)) return false;
  if (ORIGENS_COM_FCI.includes(origemNfe) && !f.fci.trim()) return false;
  if (!f.tributacaoIcms.trim()) return false;
  if (f.cest && !/^\d{7}$/.test(f.cest)) return false;
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

// Whitelist copiada de supabase/functions/ingest-lote/verificar-fiscal.ts (CSOSN_VALIDOS) —
// cópia deliberada, runtimes diferentes (Deno x Vite), sem módulo compartilhado.
// ponytail: só CSOSN (regime Simples) — org em regime "normal" precisa de CST, não coberto
// nesta entrega (escopo do brief da T12). `camposFiscaisFaltantes` valida por regime da org, mas
// não impede um CSOSN de passar como se fosse CST; ver task-12-report.md.
const CSOSN_OPCOES: Array<{ valor: string; rotulo: string }> = [
  { valor: '101', rotulo: '101 — Simples, com crédito' },
  { valor: '102', rotulo: '102 — Simples, sem crédito' },
  { valor: '103', rotulo: '103 — Simples, isenção (faixa)' },
  { valor: '201', rotulo: '201 — Simples, com crédito + ST' },
  { valor: '202', rotulo: '202 — Simples, sem crédito + ST' },
  { valor: '203', rotulo: '203 — Simples, isenção (faixa) + ST' },
  { valor: '300', rotulo: '300 — Imune' },
  { valor: '400', rotulo: '400 — Não tributada' },
  { valor: '500', rotulo: '500 — ICMS cobrado por ST/antecipação' },
  { valor: '900', rotulo: '900 — Outros' },
];

function soDigitos(v: string, max: number): string {
  return v.replace(/\D/g, '').slice(0, max);
}

export function EtapaFiscalForm({ valor, origem, onMudar, sugestaoNcm, carregandoSugestao, onAplicarSugestao }: {
  valor: FiscalForm;
  origem: 'nacional' | 'importado' | null;
  onMudar: (patch: Partial<FiscalForm>) => void;
  sugestaoNcm: { ncm: string; justificativa: string } | null;
  carregandoSugestao: boolean;
  onAplicarSugestao: () => void;
}) {
  const codigosOrigem = origem ? ORIGENS_NFE_POR_ORIGEM[origem] : [];
  const fciVisivel = ORIGENS_COM_FCI.includes(Number(valor.origemNfe));

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
          maxLength={8}
          onChange={(e) => onMudar({ ncm: soDigitos(e.target.value, 8) })}
        />
        <span className="text-xs text-muted-foreground">
          8 dígitos — a Nomenclatura Comum do Mercosul do produto.
        </span>
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
          {/* Sem <label htmlFor>: o `aria-label` do <select> já dá o nome acessível exato
              ("Origem fiscal (NF-e)") usado por getByLabelText — igual ao rádio de Origem em
              dialog-cadastro-produto.tsx, que também usa <span>, não <label>. */}
          <span className="text-sm font-medium">
            Origem fiscal (NF-e)<span className="text-destructive"> *</span>
          </span>
          <select
            id="fiscal-origem-nfe"
            aria-label="Origem fiscal (NF-e)"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={valor.origemNfe}
            onChange={(e) => {
              const v = e.target.value;
              onMudar({ origemNfe: v, ...(ORIGENS_COM_FCI.includes(Number(v)) ? {} : { fci: '' }) });
            }}
          >
            <option value="">Selecione…</option>
            {codigosOrigem.map((c) => (
              <option key={c} value={String(c)}>{ROTULOS_ORIGEM_NFE[c]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            CSOSN<span className="text-destructive"> *</span>
          </span>
          <select
            id="fiscal-csosn"
            aria-label="CSOSN"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={valor.tributacaoIcms}
            onChange={(e) => onMudar({ tributacaoIcms: e.target.value })}
          >
            <option value="">Selecione…</option>
            {CSOSN_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
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
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fiscal-ex-tipi" className="text-sm font-medium">EX TIPI</label>
        <Input id="fiscal-ex-tipi" value={valor.exTipi} onChange={(e) => onMudar({ exTipi: e.target.value })} />
        <span className="text-xs text-muted-foreground">Opcional.</span>
      </div>
    </div>
  );
}
