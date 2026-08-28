import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  useDescontoPct, useSalvarDescontoPct,
  useDescontoConcorrenciaPct, useSalvarDescontoConcorrenciaPct,
  useReancoraLiderAtiva, useSalvarReancoraLiderAtiva,
} from '@/hooks/useConfiguracoes';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

/** Percentual inteiro de 0 a 99. Fora disso não grava — vazio nunca vira 0. */
function pctValido(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}

export function SecaoPrecos() {
  const { podeEditarConfig } = usePermissoesConfig();

  const { data: descontoPct } = useDescontoPct();
  const salvarDesconto = useSalvarDescontoPct();
  const [pctInput, setPctInput] = useState('15');
  useEffect(() => { if (descontoPct != null) setPctInput(String(descontoPct)); }, [descontoPct]);

  const { data: descontoConcorrenciaPct } = useDescontoConcorrenciaPct();
  const salvarDescontoConcorrencia = useSalvarDescontoConcorrenciaPct();
  const [concInput, setConcInput] = useState('5');
  useEffect(() => {
    if (descontoConcorrenciaPct != null) setConcInput(String(descontoConcorrenciaPct));
  }, [descontoConcorrenciaPct]);

  const { data: reancoraLiderAtiva } = useReancoraLiderAtiva();
  const salvarReancora = useSalvarReancoraLiderAtiva();

  return (
    <SettingsGroup
      titulo="Preços"
      descricao="Como o PubliAI chega ao preço sugerido de venda."
      aviso={!podeEditarConfig && <AvisoLeitura>Só um administrador altera estas opções.</AvisoLeitura>}
    >
      <SettingsRow
        titulo="Desconto de marketing"
        descricao='Preço cheio riscado, com selo "% OFF". Sugestão 15%. O liga/desliga é por produto, na Revisão.'
        htmlFor="desconto-marketing"
        estado={<EstadoSalvo estado={estadoDeMutation(salvarDesconto)} />}
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="desconto-marketing"
            type="number" min={0} max={99} step={1}
            className="h-8 w-20 text-sm"
            value={pctInput}
            disabled={!podeEditarConfig}
            onChange={(e) => setPctInput(e.target.value)}
            onBlur={() => {
              const n = pctValido(pctInput);
              if (n === null) { setPctInput(String(descontoPct ?? 15)); return; }
              if (n !== descontoPct) salvarDesconto.mutate(n);
            }}
          />
          <span className="pt-1.5 text-sm">%</span>
        </div>
      </SettingsRow>

      <SettingsRow
        titulo="Desconto sobre concorrência"
        descricao="Havendo concorrente, o preço sugerido fica esse percentual abaixo do menor preço encontrado (ADR-0059). Padrão 5%."
        htmlFor="desconto-concorrencia"
        estado={<EstadoSalvo estado={estadoDeMutation(salvarDescontoConcorrencia)} />}
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="desconto-concorrencia"
            type="number" min={0} max={99} step={1}
            className="h-8 w-20 text-sm"
            value={concInput}
            disabled={!podeEditarConfig}
            onChange={(e) => setConcInput(e.target.value)}
            onBlur={() => {
              const n = pctValido(concInput);
              if (n === null) { setConcInput(String(descontoConcorrenciaPct ?? 5)); return; }
              if (n !== descontoConcorrenciaPct) salvarDescontoConcorrencia.mutate(n);
            }}
          />
          <span className="pt-1.5 text-sm">%</span>
        </div>
      </SettingsRow>

      <SettingsRow
        titulo="Ancorar no piso dos MercadoLíderes quando der prejuízo"
        descricao="Quando um produto dá prejuízo no import, usa o menor preço entre os concorrentes MercadoLíder em vez do menor preço global (ADR-0065)."
        estado={<EstadoSalvo estado={estadoDeMutation(salvarReancora)} />}
      >
        <Switch
          checked={reancoraLiderAtiva ?? false}
          disabled={!podeEditarConfig}
          onCheckedChange={(v) => salvarReancora.mutate(v)}
          aria-label="Ancorar preço no piso dos MercadoLíderes quando der prejuízo"
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
