// ADR-0181 Plano 2a/2b — pacote do contador: XMLs de venda (ML) e de compra do mês + relatórios xlsx/pdf, montado no navegador.
// R4: em suporte somente leitura o AppShell desabilita os controles (fieldset) — exportar exige suporte "full".
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchEmpresaFiscal } from '@/lib/queries';
import { useSupportStore, effectiveOrgId } from '@/stores/support-store';
import { baixarNotasMes, ErroOrgMudou, falhaVendas } from '@/lib/pacote-contador/baixar';
import { lerPacote, lerPacoteVazio, lerPacoteIndisponivel } from '@/lib/pacote-contador/ler';
import type { LeituraPacote } from '@/lib/pacote-contador/tipos';
import { listarNotasCompraMes, baixarXmlsCompra } from '@/lib/pacote-contador/compras-fonte';
import { montarCompras } from '@/lib/pacote-contador/compras-ler';
import { gerarRelatorioXlsx } from '@/lib/pacote-contador/relatorio-xlsx';
import { gerarRelatorioPdf } from '@/lib/pacote-contador/relatorio-pdf';
import { gerarRelatorioComprasXlsx } from '@/lib/pacote-contador/relatorio-compras-xlsx';
import { gerarRelatorioComprasPdf } from '@/lib/pacote-contador/relatorio-compras-pdf';
import { montarPacote, comSeloGlobal, nomePacote, salvarArquivo, mesesDisponiveis, mesAnteriorSP } from '@/lib/pacote-contador/montar';

type Etapa = 'ocioso' | 'baixando' | 'compras' | 'lendo' | 'montando';
const ROTULO: Record<Etapa, string> = {
  ocioso: '', baixando: 'Baixando do Mercado Livre…', compras: 'Baixando as notas de compra…', lendo: 'Lendo as notas…', montando: 'Montando o pacote…',
};
const respirar = () => new Promise((r) => setTimeout(r, 0));   // deixa a tela atualizar entre etapas pesadas

export function CardPacoteContador() {
  const agora = useMemo(() => new Date(), []);
  const meses = useMemo(() => mesesDisponiveis(agora), [agora]);
  const [mes, setMes] = useState(() => mesAnteriorSP(agora));
  const [etapa, setEtapa] = useState<Etapa>('ocioso');
  const atual = useRef<AbortController | null>(null);
  const emCurso = useRef(false);   // trava síncrona: o `etapa` só desabilita o botão no próximo render
  const [progresso, setProgresso] = useState('');
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;   // StrictMode: setup → cleanup → setup precisa voltar a true
    return () => { montado.current = false; atual.current?.abort(); };
  }, []);

  async function gerar() {
    if (emCurso.current) return;
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    emCurso.current = true;
    const ctl = new AbortController();
    atual.current = ctl;
    const emSuporte = useSupportStore.getState().context !== null;
    // Depois de cada espera: componente desmontado → para; org trocada (suporte) → recusa.
    const conferir = () => {
      ctl.signal.throwIfAborted();
      if (effectiveOrgId() !== org) throw new ErroOrgMudou();
    };
    try {
      setEtapa('baixando');
      // Vendas em paralelo, sem rejeição solta: o resultado é avaliado depois.
      const pVendas = baixarNotasMes(mes, org, ctl.signal).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));
      const notas = await listarNotasCompraMes(mes, org);
      conferir();
      setEtapa('compras');
      const xmls = await baixarXmlsCompra(notas, ctl.signal, (f, t) => { if (montado.current) setProgresso(`${f} de ${t} XMLs`); });
      conferir();
      const v = await pVendas;
      conferir();
      const indisponivel = (e: unknown): LeituraPacote => {
        const f = falhaVendas(e, emSuporte);
        if (f.tipo === 'fatal') throw e;
        return lerPacoteIndisponivel(mes, f.motivo);
      };
      setEtapa('lendo'); await respirar(); conferir();
      let vendas: LeituraPacote;
      if (!v.ok) vendas = indisponivel(v.e);
      else if (v.r.tipo === 'vazio') vendas = lerPacoteVazio(mes);
      else { try { vendas = lerPacote(v.r.bytes, mes); } catch (e) { vendas = indisponivel(e); } }
      const compras = montarCompras(mes, notas, xmls);
      const emp = await fetchEmpresaFiscal();   // dados da org de AGORA, não do render
      conferir();
      setEtapa('montando'); await respirar(); conferir();
      const motivos = [...vendas.conferencia.motivosParcial, ...compras.conferencia.motivosParcial];
      const vG = comSeloGlobal(vendas, motivos);
      const cG = comSeloGlobal(compras, motivos);
      const cab = { org: emp?.razao_social ?? `Organização ${org}`, cnpj: emp?.cnpj ?? null, contaMl: v.ok ? v.r.contaMl : '', geradoEm: new Date() };
      const pacote = montarPacote({
        vendas: vG, xlsxVendas: gerarRelatorioXlsx(vG, cab), pdfVendas: gerarRelatorioPdf(vG, cab),
        compras: cG, xlsxCompras: gerarRelatorioComprasXlsx(cG, cab), pdfCompras: gerarRelatorioComprasPdf(cG, cab),
      });
      conferir();
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      // Toast pelos estados LOCAIS (não pelos motivos globais) para não chamar falha de compra de "vendas com falha".
      const toastMot: string[] = [];
      if (vendas.conferencia.indisponivel) toastMot.push('vendas indisponíveis');
      else if (vendas.conferencia.parcial) toastMot.push('vendas com falha');
      if (compras.conferencia.comFalha) toastMot.push(`${compras.conferencia.comFalha} compras com falha`);
      if (toastMot.length) toast.error(`Pacote de ${mes} gerado como PARCIAL — ${toastMot.join('; ')}`);
      else toast.success(`Pacote de ${mes} gerado.`);
    } catch (e) {
      const cancelado = ctl.signal.aborted || (e as Error)?.name === 'AbortError';
      if (!ctl.signal.aborted) ctl.abort();   // derruba downloads pendentes
      if (montado.current && !cancelado) toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      emCurso.current = false;
      if (montado.current) { setEtapa('ocioso'); setProgresso(''); }
    }
  }

  const ocupado = etapa !== 'ocioso';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pacote do contador</CardTitle>
        <CardDescription>XMLs de venda (Mercado Livre) e de compra, com os relatórios nota a nota (Excel e PDF) de um mês.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <label htmlFor="pacote-mes" className="text-sm font-medium">Mês</label>
        <select id="pacote-mes" value={mes} disabled={ocupado} onChange={(e) => setMes(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm">
          {meses.map((m) => <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>)}
        </select>
        <Button onClick={gerar} disabled={ocupado}>{ocupado ? 'Gerando…' : 'Baixar pacote'}</Button>
        {ocupado && <span className="text-sm text-muted-foreground" aria-live="polite">{ROTULO[etapa]}{progresso ? ` (${progresso})` : ''}</span>}
      </CardContent>
    </Card>
  );
}
