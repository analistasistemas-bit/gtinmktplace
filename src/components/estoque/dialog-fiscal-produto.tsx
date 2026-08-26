// ADR-0135 D-9 (Task 13) — edição fiscal de família existente, em fila. Reusa EtapaFiscalForm
// (T12) no modo edição: carrega os valores atuais e reaplica o mesmo cuidado do cadastro — a
// sugestão de NCM não pode vazar entre famílias quando "Salvar e próximo" troca `familiaId` com
// o dialog ainda montado (o efeito abaixo usa a mesma flag `ignore` do T12).
//
// Ruling do controller: a edge `atualizar-fiscal-familia` (T9) valida `familias.unidade` contra
// UNIDADES_FISCAIS, mas o payload fiscal nunca editava esse campo — família legada com unidade
// fora do vocabulário (texto livre antigo) travava a fila sem saída. Aqui aparece um select de
// unidade quando a unidade atual é inválida, sem pré-seleção, e o valor escolhido vai no payload.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import { UNIDADES_FISCAIS } from '@/lib/fiscal';
import {
  EtapaFiscalForm, fiscalVazio, fiscalCompleto, type FiscalForm,
} from '@/components/estoque/etapa-fiscal-form';

interface FamiliaFiscalCarregada {
  nomePai: string;
  origem: 'nacional' | 'importado';
  unidade: string | null;
}

function unidadeValida(u: string | null | undefined): boolean {
  return !!u && (UNIDADES_FISCAIS as readonly string[]).includes(u.toUpperCase().trim());
}

export function DialogFiscalProduto({ familiaId, fila, onFechar, onAvancar, onSalvo }: {
  familiaId: string | null;
  /** ids ordenados dos pendentes — usado só para achar o próximo em "Salvar e próximo". */
  fila: string[];
  onFechar: () => void;
  onAvancar: (proximoId: string) => void;
  onSalvo: () => void;
}) {
  const [familia, setFamilia] = useState<FamiliaFiscalCarregada | null>(null);
  const [fiscal, setFiscal] = useState<FiscalForm>(fiscalVazio());
  const [unidade, setUnidade] = useState('');
  const [sugestaoNcm, setSugestaoNcm] = useState<{ ncm: string; justificativa: string } | null>(null);
  const [carregandoSugestao, setCarregandoSugestao] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [salvando, setSalvando] = useState<'salvar' | 'proximo' | null>(null);

  // Carrega a família + dispara a sugestão de NCM a cada troca de `familiaId` — um efeito só,
  // com uma única flag `ignore`, para não repetir o hazard de ordenação entre dois efeitos que
  // dependem do mesmo id (um limpando o estado do outro).
  useEffect(() => {
    setErros([]);
    setSugestaoNcm(null);
    if (!familiaId) { setFamilia(null); setFiscal(fiscalVazio()); setUnidade(''); return; }
    let ignore = false;

    supabase.from('familias')
      .select('nome_pai, origem, ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms, unidade')
      .eq('id', familiaId).maybeSingle()
      .then(({ data, error }) => {
        if (ignore) return;
        if (error || !data) { toast.error('Não foi possível carregar os dados fiscais.'); return; }
        const f: FiscalForm = {
          ncm: data.ncm ?? '',
          cest: data.cest ?? '',
          origemNfe: data.origem_nfe != null ? String(data.origem_nfe) : '',
          fci: data.fci ?? '',
          exTipi: data.ex_tipi ?? '',
          tributacaoIcms: data.tributacao_icms ?? '',
        };
        setFamilia({ nomePai: data.nome_pai, origem: data.origem as 'nacional' | 'importado', unidade: data.unidade });
        setFiscal(f);
        setUnidade(unidadeValida(data.unidade) ? String(data.unidade).toUpperCase().trim() : '');
      });

    setCarregandoSugestao(true);
    supabase.functions.invoke('sugerir-ncm', { body: { familiaId } })
      .then(({ data, error }) => {
        if (ignore || error) return;
        const r = data as { ncm: string | null; justificativa: string };
        if (r?.ncm) setSugestaoNcm({ ncm: r.ncm, justificativa: r.justificativa });
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setCarregandoSugestao(false); });

    return () => { ignore = true; };
  }, [familiaId]);

  const precisaEscolherUnidade = !!familia && !unidadeValida(familia.unidade);
  const podeSalvar = !!familia
    && fiscalCompleto(fiscal, familia.origem)
    && (!precisaEscolherUnidade || !!unidade)
    && salvando === null;

  /** Devolve `true` só quando a edge confirmou o salvamento — quem chama decide o que fazer a seguir. */
  async function salvar(): Promise<boolean> {
    if (!familiaId) return false;
    setErros([]);
    const { error } = await supabase.functions.invoke('atualizar-fiscal-familia', {
      body: {
        familiaId,
        fiscal: {
          ncm: fiscal.ncm,
          cest: fiscal.cest || null,
          origemNfe: Number(fiscal.origemNfe),
          fci: fiscal.fci || null,
          exTipi: fiscal.exTipi || null,
          tributacaoIcms: fiscal.tributacaoIcms,
          ...(precisaEscolherUnidade ? { unidade } : {}),
        },
      },
    });
    if (error) {
      const detalhe = await corpoDoErroDaEdge(error);
      const lista = detalhe?.corpo.erros as Array<{ mensagem: string }> | undefined;
      setErros(lista?.length ? lista.map((e) => e.mensagem) : [String(detalhe?.corpo.error ?? (error as Error).message)]);
      return false;
    }
    toast.success('✓ Fiscal salvo');
    onSalvo();
    return true;
  }

  async function handleSalvar() {
    setSalvando('salvar');
    const ok = await salvar();
    setSalvando(null);
    if (ok) onFechar();
  }

  async function handleSalvarEProximo() {
    if (!familiaId) return;
    setSalvando('proximo');
    const ok = await salvar();
    setSalvando(null);
    if (!ok) return;
    const proximoId = fila[fila.indexOf(familiaId) + 1];
    // ponytail: se a fila não tem próximo (item era o último), fecha em vez de chamar onAvancar
    // com id indefinido — o botão exige fila.length > 1 mas não a posição do item atual nela.
    if (proximoId) onAvancar(proximoId);
    else onFechar();
  }

  const idxAtual = familiaId ? fila.indexOf(familiaId) : -1;
  const temProximo = idxAtual >= 0 && idxAtual < fila.length - 1;

  return (
    <Dialog open={familiaId != null} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dados fiscais{familia ? ` — ${familia.nomePai}` : ''}</DialogTitle>
          <DialogDescription>
            Preencha os dados fiscais para o Mercado Livre poder emitir a nota deste produto.
          </DialogDescription>
        </DialogHeader>

        {familia && (
          <div className="flex min-w-0 flex-col gap-4">
            <EtapaFiscalForm
              valor={fiscal}
              origem={familia.origem}
              onMudar={(patch) => setFiscal((prev) => ({ ...prev, ...patch }))}
              sugestaoNcm={sugestaoNcm}
              carregandoSugestao={carregandoSugestao}
              onAplicarSugestao={() => sugestaoNcm && setFiscal((prev) => ({ ...prev, ncm: sugestaoNcm.ncm }))}
            />

            {precisaEscolherUnidade && (
              <div className="flex flex-col gap-1.5">
                {/* Select, não Input: mesmo padrão de Origem fiscal/CSOSN em etapa-fiscal-form.tsx
                    — o `aria-label` do <select> já dá o nome acessível, sem <label htmlFor>. */}
                <span className="text-sm font-medium">
                  Unidade<span className="text-destructive"> *</span>
                </span>
                <select
                  id="fiscal-unidade"
                  aria-label="Unidade"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {UNIDADES_FISCAIS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">
                  A unidade cadastrada (&quot;{familia.unidade}&quot;) não é aceita pela NF-e — escolha uma da lista.
                </span>
              </div>
            )}

            {erros.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-7 text-sm text-destructive">
                {erros.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando !== null}>Fechar</Button>
          {temProximo && (
            <Button
              variant="outline"
              onClick={() => void handleSalvarEProximo()}
              disabled={!podeSalvar}
            >
              {salvando === 'proximo' ? 'Salvando…' : 'Salvar e próximo'}
            </Button>
          )}
          <Button onClick={() => void handleSalvar()} disabled={!podeSalvar}>
            {salvando === 'salvar' ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
