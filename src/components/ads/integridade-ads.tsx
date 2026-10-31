import { AlertTriangle } from 'lucide-react';
import { GastosAssociados } from '@/components/ads/gastos-associados';
import { fmtBRL } from '@/lib/formato';
import { pct, textoMotivo } from '@/lib/ads-apresentacao';
import type { ComposicaoConta, PainelAds } from '@/lib/ads-painel';
import { historicoCobre } from '@/lib/sku-ads';
import { asHoraDeBRT } from '@/components/sku-dossie/formato-dossie';

export interface IntegridadeAdsProps {
  painel: PainelAds;
  /** Primeiro dia BRT da janela (YYYY-MM-DD): o aviso de histórico depende dela, não das famílias. */
  janelaDesde: string;
  historicoDesde: string | null;
  /** Última coleta das famílias (sync.ultimo_ok_em). */
  coletadoEm: string | null;
  /** Instante da leitura ao vivo do ML (lidoEm). */
  lidoEm: string | null;
  /** O resumo da conta (com composição) já mostra a divergência; sem ele, o aviso fica aqui (uma vez na tela). */
  divergenciaNoResumo?: boolean;
}

const hora = (iso: string | null) => (iso ? asHoraDeBRT(iso) : 'horário indisponível');

/** Linha de ressalva: ícone semântico + texto foreground sobre o card (nunca texto de status sobre fundo /10). */
function Ressalva({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function ComposicaoColetada({ c, coletadoEm }: { c: ComposicaoConta; coletadoEm: string | null }) {
  const linhas: [string, string][] = [
    ['Investimento', fmtBRL(c.custo)],
    ['Em famílias', fmtBRL(c.emFamilias)],
    ['Compartilhado', fmtBRL(c.compartilhado)],
    ['Não identificado', c.naoIdentificado == null ? 'indisponível' : `${fmtBRL(c.naoIdentificado)} (${pct(c.naoIdentificadoPct)})`],
  ];
  return (
    <div role="group" aria-label={`Composição coletada ${hora(coletadoEm)}`} className="rounded-md border border-border p-3 text-sm">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Composição coletada {hora(coletadoEm)}</p>
      <dl className="space-y-1">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Bloco final do Desempenho: o que limita os números (compartilhado, não identificado, cobertura, histórico,
 *  fiscal, conciliação) e de onde vêm. Tudo em texto visível, sem tooltip. */
export function IntegridadeAds({ painel, janelaDesde, historicoDesde, coletadoEm, lidoEm, divergenciaNoResumo = false }: IntegridadeAdsProps) {
  const { conta, conciliacao } = painel;
  const temNaoId = !!conta && !conta.divergente && conta.naoIdentificado != null;
  const semCobertura = !painel.gruposCobertos || painel.contaMotivo === 'cobertura';
  const semHistorico = !historicoCobre(historicoDesde, janelaDesde);

  return (
    <section aria-label="Integridade dos números" className="space-y-3">
      <GastosAssociados painel={painel} />

      <ul className="space-y-2 rounded-lg border border-border bg-card p-4 empty:hidden">
        {painel.compartilhados.length > 0 && <Ressalva>Gasto compartilhado entre famílias: não foi rateado.</Ressalva>}
        {temNaoId && (
          <Ressalva>Gasto de Ads não identificado: incluído no investimento da conta, sem distribuição entre famílias.</Ressalva>
        )}
        {conta?.divergente && !divergenciaNoResumo && (
          <Ressalva>A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.</Ressalva>
        )}
        {semCobertura && <Ressalva>Cobertura: {textoMotivo('cobertura', null)}.</Ressalva>}
        {painel.contaMotivo === 'serie_incompleta' && (
          <Ressalva>A leitura ao vivo do ML veio sem todos os dias do período: a conta está indisponível.</Ressalva>
        )}
        {semHistorico && <Ressalva>Histórico: {textoMotivo('historico', historicoDesde)}.</Ressalva>}
        {conta?.motivoFiscal === 'origem_nao_resolvida' && (
          <Ressalva>Resultado indisponível: produto vendido sem origem (nacional/importado).</Ressalva>
        )}
        {conta?.motivoFiscal && conta.motivoFiscal !== 'origem_nao_resolvida' && (
          <Ressalva>Resultado indisponível: confirme as alíquotas em Configurações.</Ressalva>
        )}
        {painel.desatualizado && <Ressalva>Coleta desatualizada: última coleta {hora(coletadoEm)}.</Ressalva>}
        {conciliacao?.estado === 'pendente' && (
          <li className="space-y-2 text-sm">
            <p role="status" className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span className="min-w-0">{conciliacao.mensagem}</span>
            </p>
            <p className="text-xs text-muted-foreground">Última coleta das famílias {hora(conciliacao.coletadoEm)}.</p>
            {conciliacao.coletada ? (
              <ComposicaoColetada c={conciliacao.coletada} coletadoEm={conciliacao.coletadoEm} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Composição coletada indisponível{conciliacao.coletadaMotivo === 'cobertura' ? ': coleta incompleta no período' : ''}.
              </p>
            )}
          </li>
        )}
      </ul>

      <section aria-label="Origem dos números" className="space-y-1 text-xs text-muted-foreground">
        <p>Leitura do ML (total da conta): {hora(lidoEm)}.</p>
        <p>Coleta das famílias (grupos de anúncios): {hora(coletadoEm)}.</p>
        {/* Dentro da tolerância (ADR-0179, ajuste 2026-10-31): só uma nota; a composição já usa a base coletada. */}
        {conciliacao?.estado === 'ok' && conciliacao.diferenca > 0 && (
          <p>
            Coleta das famílias {hora(coletadoEm)} difere {fmtBRL(conciliacao.diferenca / 100)} da leitura atual do ML;
            diferença dentro da tolerância.
          </p>
        )}
      </section>
    </section>
  );
}
