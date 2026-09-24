import { ConfigTelegram } from '@/components/config-telegram';
import { Switch } from '@/components/ui/switch';
import {
  useAlertasPromocoesAtivo, useMonitorFreteAtivo,
  useSalvarAlertasPromocoesAtivo, useSalvarMonitorFreteAtivo,
} from '@/hooks/useConfiguracoes';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoNotificacoes() {
  const { podeEditarConfig } = usePermissoesConfig();
  const { data: monitorFreteAtivo } = useMonitorFreteAtivo();
  const salvarMonitorFrete = useSalvarMonitorFreteAtivo();
  const { data: alertasPromoAtivo } = useAlertasPromocoesAtivo();
  const salvarAlertasPromo = useSalvarAlertasPromocoesAtivo();
  const aviso = !podeEditarConfig && <AvisoLeitura>Só um administrador altera estas opções.</AvisoLeitura>;

  // ConfigTelegram entra SEM card próprio — card dentro de card é o ruído que esta
  // refatoração existe para tirar. E mantém o botão "Salvar configurações" explícito: o
  // token do bot não deve ser gravado a cada blur, e o teste do componente trava isso.
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        titulo="Alertas no Telegram"
        descricao="Avisos de anúncio moderado, estoque zerado e afins, direto no seu Telegram."
        aviso={aviso}
      >
        <ConfigTelegram semCard podeEditar={podeEditarConfig} />
      </SettingsGroup>

      <SettingsGroup
        titulo="Monitor de frete"
        descricao="Compara o frete pago em cada venda com a venda anterior do mesmo anúncio."
        aviso={aviso}
      >
        <SettingsRow
          titulo="Avisar quando o frete de um anúncio subir"
          descricao="Dispara quando sobe mais de 10% e pelo menos R$ 2, em pedidos de 1 item. O aviso vai para quem recebe a categoria Financeiro (ADR-0169)."
          estado={<EstadoSalvo estado={estadoDeMutation(salvarMonitorFrete)} />}
        >
          <Switch
            checked={monitorFreteAtivo ?? false}
            disabled={!podeEditarConfig}
            onCheckedChange={(v) => salvarMonitorFrete.mutate(v)}
            aria-label="Monitor de frete: avisar quando o frete de um anúncio subir"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup titulo="Promoções" descricao="Avisos da Central de Promoções, conferidos a cada atualização." aviso={aviso}>
        <SettingsRow
          titulo="Avisar sobre promoções"
          descricao="Anúncio participando com líquido abaixo do custo, e campanha com adesão fechando em até 48 h que tem anúncios acima do mínimo. O aviso vai para quem recebe a categoria Financeiro (ADR-0170)."
          estado={<EstadoSalvo estado={estadoDeMutation(salvarAlertasPromo)} />}
        >
          <Switch
            checked={alertasPromoAtivo ?? false}
            disabled={!podeEditarConfig}
            onCheckedChange={(v) => salvarAlertasPromo.mutate(v)}
            aria-label="Promoções: avisar sobre anúncios no prejuízo e prazos de adesão"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
