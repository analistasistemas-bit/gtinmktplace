import { ConfigTelegram } from '@/components/config-telegram';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, SettingsGroup } from './settings-row';

export function SecaoNotificacoes() {
  const { podeEditarConfig } = usePermissoesConfig();

  // ConfigTelegram entra SEM card próprio — card dentro de card é o ruído que esta
  // refatoração existe para tirar. E mantém o botão "Salvar configurações" explícito: o
  // token do bot não deve ser gravado a cada blur, e o teste do componente trava isso.
  return (
    <SettingsGroup
      titulo="Alertas no Telegram"
      descricao="Avisos de anúncio moderado, estoque zerado e afins, direto no seu Telegram."
      aviso={!podeEditarConfig && <AvisoLeitura>Só um administrador altera estas opções.</AvisoLeitura>}
    >
      <ConfigTelegram semCard podeEditar={podeEditarConfig} />
    </SettingsGroup>
  );
}
