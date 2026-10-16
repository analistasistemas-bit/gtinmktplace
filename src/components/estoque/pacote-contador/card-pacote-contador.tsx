// ADR-0181 Plano 2a — pacote do contador (vendas): XMLs do ML do mês + relatório xlsx/pdf, montado no navegador.
// R4: em suporte somente leitura o AppShell desabilita os controles (fieldset) — exportar exige suporte "full".
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { effectiveOrgId } from '@/stores/support-store';
import { baixarNotasMes, ErroPacote } from '@/lib/pacote-contador/baixar';
import { lerPacote, lerPacoteVazio } from '@/lib/pacote-contador/ler';
import { gerarRelatorioXlsx } from '@/lib/pacote-contador/relatorio-xlsx';
import { gerarRelatorioPdf } from '@/lib/pacote-contador/relatorio-pdf';
import { montarPacote, nomePacote, salvarArquivo, mesesDisponiveis, mesAnteriorSP } from '@/lib/pacote-contador/montar';

type Etapa = 'ocioso' | 'baixando' | 'lendo' | 'montando';
const ROTULO: Record<Etapa, string> = { ocioso: '', baixando: 'Baixando do Mercado Livre…', lendo: 'Lendo as notas…', montando: 'Montando o pacote…' };
const respirar = () => new Promise((r) => setTimeout(r, 0));   // deixa a tela atualizar entre etapas pesadas

export function CardPacoteContador({ razaoSocial, cnpj }: { razaoSocial: string | null; cnpj: string | null }) {
  const agora = useMemo(() => new Date(), []);
  const meses = useMemo(() => mesesDisponiveis(agora), [agora]);
  const [mes, setMes] = useState(() => mesAnteriorSP(agora));
  const [etapa, setEtapa] = useState<Etapa>('ocioso');
  const atual = useRef<AbortController | null>(null);
  useEffect(() => () => atual.current?.abort(), []);

  async function gerar() {
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    const ctl = new AbortController();
    atual.current = ctl;
    // Depois de cada espera: componente desmontado → para; org trocada (suporte) → recusa.
    const conferir = () => {
      ctl.signal.throwIfAborted();
      if (effectiveOrgId() !== org) throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);
    };
    try {
      setEtapa('baixando');
      const r = await baixarNotasMes(mes, org, ctl.signal);
      conferir();
      setEtapa('lendo'); await respirar(); conferir();
      const leitura = r.tipo === 'vazio' ? lerPacoteVazio(mes) : lerPacote(r.bytes, mes);
      setEtapa('montando'); await respirar(); conferir();
      const cab = { org: razaoSocial ?? `Organização ${org}`, cnpj, contaMl: r.contaMl, geradoEm: new Date() };
      const pacote = montarPacote(leitura, gerarRelatorioXlsx(leitura, cab), gerarRelatorioPdf(leitura, cab));
      conferir();
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      if (leitura.conferencia.parcial) toast.error('Pacote gerado como PARCIAL — veja a aba Conferência.');
      else toast.success(leitura.conferencia.vazio ? 'Nenhuma nota no mês — pacote gerado com o relatório vazio.' : `Pacote de ${mes} gerado.`);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      if (!ctl.signal.aborted) setEtapa('ocioso');
    }
  }

  const ocupado = etapa !== 'ocioso';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pacote do contador</CardTitle>
        <CardDescription>XMLs de venda do Mercado Livre e o relatório nota a nota (Excel e PDF) de um mês.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <label htmlFor="pacote-mes" className="text-sm font-medium">Mês</label>
        <select id="pacote-mes" value={mes} disabled={ocupado} onChange={(e) => setMes(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm">
          {meses.map((m) => <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>)}
        </select>
        <Button onClick={gerar} disabled={ocupado}>{ocupado ? 'Gerando…' : 'Baixar pacote'}</Button>
        {ocupado && <span className="text-sm text-muted-foreground" aria-live="polite">{ROTULO[etapa]}</span>}
      </CardContent>
    </Card>
  );
}
