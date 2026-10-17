// ADR-0181 Plano 2a/2b — pacote do contador: XMLs de venda (ML) e de compra do mês + relatórios xlsx/pdf, montado no navegador.
// R4: em suporte somente leitura o AppShell desabilita os controles (fieldset) — exportar exige suporte "full".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buscarFoto, buscarInventarioHoje } from '@/lib/pacote-contador/inventario-fonte';
import { gerarRelatorioInventarioXlsx } from '@/lib/pacote-contador/relatorio-inventario-xlsx';
import { gerarRelatorioInventarioPdf } from '@/lib/pacote-contador/relatorio-inventario-pdf';
import type { LeituraInventario } from '@/lib/pacote-contador/tipos-inventario';
import {
  montarPacote, comSeloGlobal, nomePacote, salvarArquivo, mesesDisponiveis, mesAnteriorSP,
  nomeInventarioHoje, ultimoTrintaEUmDezembro, INVENTARIO_DESDE,
} from '@/lib/pacote-contador/montar';
import { useProfile } from '@/hooks/useProfile';
import { DialogContagemInventario } from './dialog-contagem-inventario';

type Etapa = 'ocioso' | 'baixando' | 'compras' | 'lendo' | 'montando' | 'inventario';
const ROTULO: Record<Etapa, string> = {
  ocioso: '', baixando: 'Baixando do Mercado Livre…', compras: 'Baixando as notas de compra…', lendo: 'Lendo as notas…', montando: 'Montando o pacote…',
  inventario: 'Calculando o inventário…',
};
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const AVISO_SEM_FOTO = 'Foto de 31/12 inexistente — o inventário não vai neste pacote.';
const AVISO_FOTO_FALHOU = 'Foto de 31/12 não gerada (falhou) — o inventário não vai neste pacote.';
const MSG_SEM_FOTO = 'Foto de 31/12 não gerada — acione o suporte.';
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

  // Foto do último 31/12: 'carregando' enquanto busca; 'erro' = não deu para ler (sem aviso, a tela segue usável).
  const { isAdmin } = useProfile();
  const dataFoto = useMemo(() => ultimoTrintaEUmDezembro(agora), [agora]);
  const [foto, setFoto] = useState<LeituraInventario | null | 'carregando' | 'erro'>('carregando');
  const [contando, setContando] = useState(false);
  const carregarFoto = useCallback(async () => {
    const org = effectiveOrgId();
    if (!org) { setFoto('erro'); return; }
    try {
      const f = await buscarFoto(dataFoto, org);
      if (montado.current && effectiveOrgId() === org) setFoto(f);
    } catch { if (montado.current) setFoto('erro'); }
  }, [dataFoto]);
  useEffect(() => { void carregarFoto(); }, [carregarFoto]);

  // Trava única (`emCurso`), AbortController e conferência de org/desmontagem para qualquer geração de arquivo.
  async function rodar(corpo: (ctl: AbortController, org: string, conferir: () => void) => Promise<void>) {
    if (emCurso.current) return;
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    emCurso.current = true;
    const ctl = new AbortController();
    atual.current = ctl;
    // Depois de cada espera: componente desmontado → para; org trocada (suporte) → recusa.
    const conferir = () => {
      ctl.signal.throwIfAborted();
      if (effectiveOrgId() !== org) throw new ErroOrgMudou();
    };
    try {
      await corpo(ctl, org, conferir);
    } catch (e) {
      const cancelado = ctl.signal.aborted || (e as Error)?.name === 'AbortError';
      // Só cancelamento/org trocada derrubam o download de vendas: abortá-lo à toa faz a edge gravar cooldown
      // (60 s) e o clique seguinte cair em 429. Nos demais erros ele termina sozinho e o resultado é ignorado.
      if ((cancelado || e instanceof ErroOrgMudou) && !ctl.signal.aborted) ctl.abort();
      if (montado.current && !cancelado) toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      emCurso.current = false;
      if (montado.current) { setEtapa('ocioso'); setProgresso(''); }
    }
  }

  const inventarioHoje = () => rodar(async (ctl, org, conferir) => {
    setEtapa('inventario');
    const inv = await buscarInventarioHoje(org, ctl.signal);
    conferir();
    const xlsx = gerarRelatorioInventarioXlsx(inv);
    const pdf = gerarRelatorioInventarioPdf(inv);
    conferir();
    const nome = nomeInventarioHoje(new Date());
    salvarArquivo(`${nome}.xlsx`, xlsx, TIPO_XLSX);
    salvarArquivo(`${nome}.pdf`, pdf, 'application/pdf');
    toast.success('Inventário de hoje gerado.');
  });

  const gerar = () => rodar(async (ctl, org, conferir) => {
    const emSuporte = useSupportStore.getState().context !== null;
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
    // Pacote de dezembro: leva a foto de 31/12 (aberta ou confirmada). Erro de leitura aborta (não confundir com inexistente).
    let inventario: { xlsx: Uint8Array; pdf: Uint8Array } | undefined;
    if (mes.endsWith('-12')) {
      const f = await buscarFoto(`${mes.slice(0, 4)}-12-31`, org, ctl.signal);
      conferir();
      if (f && f.cabecalho.status !== 'falhou') inventario = { xlsx: gerarRelatorioInventarioXlsx(f), pdf: gerarRelatorioInventarioPdf(f) };
      else vendas = { ...vendas, conferencia: { ...vendas.conferencia, avisos: [f ? AVISO_FOTO_FALHOU : AVISO_SEM_FOTO] } };
    }
    setEtapa('montando'); await respirar(); conferir();
    const motivos = [...vendas.conferencia.motivosParcial, ...compras.conferencia.motivosParcial];
    const vG = comSeloGlobal(vendas, motivos);
    const cG = comSeloGlobal(compras, motivos);
    const cab = { org: emp?.razao_social ?? `Organização ${org}`, cnpj: emp?.cnpj ?? null, contaMl: v.ok ? v.r.contaMl : '', geradoEm: new Date() };
    const pacote = montarPacote({
      vendas: vG, xlsxVendas: gerarRelatorioXlsx(vG, cab), pdfVendas: gerarRelatorioPdf(vG, cab),
      compras: cG, xlsxCompras: gerarRelatorioComprasXlsx(cG, cab), pdfCompras: gerarRelatorioComprasPdf(cG, cab), inventario,
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
  });

  const ocupado = etapa !== 'ocioso';
  // Ausente ou 'falhou' só é problema quando a data-base já é de uma org com a rotina ligada (>= INVENTARIO_DESDE).
  const semFoto = dataFoto >= INVENTARIO_DESDE && (foto === null || (typeof foto === 'object' && foto.cabecalho.status === 'falhou'));
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
        <Button variant="outline" onClick={inventarioHoje} disabled={ocupado}>Inventário de hoje</Button>
        {ocupado && <span className="text-sm text-muted-foreground" aria-live="polite">{ROTULO[etapa]}{progresso ? ` (${progresso})` : ''}</span>}
      </CardContent>
      {typeof foto === 'object' && foto?.cabecalho.status === 'aberto' && (
        <CardContent className="flex flex-wrap items-center gap-3 border-t pt-4">
          <span className="text-sm">Foto de 31/12 aguardando contagem</span>
          <Button variant="outline" size="sm" onClick={() => setContando(true)}>Conferir contagem</Button>
        </CardContent>
      )}
      {semFoto && <CardContent className="border-t pt-4 text-sm">{MSG_SEM_FOTO}</CardContent>}
      {contando && typeof foto === 'object' && foto && (
        <DialogContagemInventario key={foto.cabecalho.versao} foto={foto} isAdmin={isAdmin}
          onOpenChange={(a) => { if (!a) { setContando(false); void carregarFoto(); } }} onRecarregar={() => void carregarFoto()} />
      )}
    </Card>
  );
}
