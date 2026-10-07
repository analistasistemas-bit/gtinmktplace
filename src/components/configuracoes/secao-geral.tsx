import { Switch } from '@/components/ui/switch';
import { useMostrarLucroDashboard, useSalvarMostrarLucroDashboard } from '@/hooks/useConfiguracoes';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoGeral() {
  const { podeEditarConfig } = usePermissoesConfig();
  const { data: mostrarLucro } = useMostrarLucroDashboard();
  const salvarMostrarLucro = useSalvarMostrarLucroDashboard();

  return (
    <div className="space-y-4">
      <SettingsGroup
        titulo="Exibição"
        aviso={!podeEditarConfig && <AvisoLeitura>Só um administrador altera estas opções.</AvisoLeitura>}
      >
        <SettingsRow
          titulo="Mostrar lucro no card do Dashboard"
          descricao='Quando desligado (padrão), o card "Líquido no faturamento" não mostra o valor de lucro do período.'
          estado={<EstadoSalvo estado={estadoDeMutation(salvarMostrarLucro)} />}
        >
          <Switch
            checked={mostrarLucro ?? false}
            disabled={!podeEditarConfig}
            onCheckedChange={(v) => salvarMostrarLucro.mutate(v)}
            aria-label="Mostrar lucro no card do Dashboard"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
