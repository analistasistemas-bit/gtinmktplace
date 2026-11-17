import { useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useMostrarLucroDashboard, useSalvarMostrarLucroDashboard } from '@/hooks/useConfiguracoes';
import { useOrgIdentidade } from '@/hooks/useOrgIdentidade';
import { useSalvarLogoOrg, type VarianteLogo } from '@/hooks/useSalvarLogoOrg';
import { TIPOS_LOGO, validarArquivoLogo } from '@/lib/org-logo';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoGeral() {
  const { podeEditarConfig, podeEditarEmpresa } = usePermissoesConfig();
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

      <SettingsGroup
        titulo="Identidade"
        descricao="Logo da empresa no topo do app. Formato horizontal, ideal 560 × 112 px (proporção 5:1; aparece com até 28 px de altura). PNG, JPG ou WEBP até 512 KB, de preferência com fundo transparente."
        aviso={!podeEditarEmpresa && <AvisoLeitura>Só um administrador da organização altera a logo.</AvisoLeitura>}
      >
        <LinhaLogo variante="claro" titulo="Logo para fundo claro" descricao="Usada no tema claro." pode={podeEditarEmpresa} />
        <LinhaLogo variante="escuro" titulo="Logo para fundo escuro" descricao="Usada no tema escuro. Sem ela, o app usa a outra versão." pode={podeEditarEmpresa} />
      </SettingsGroup>
    </div>
  );
}

function LinhaLogo({ variante, titulo, descricao, pode }: { variante: VarianteLogo; titulo: string; descricao: string; pode: boolean }) {
  const { data: ident } = useOrgIdentidade();
  const salvar = useSalvarLogoOrg();
  const input = useRef<HTMLInputElement>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const url = variante === 'claro' ? ident?.logo_claro_url : ident?.logo_escuro_url;
  const minha = salvar.variables?.variante === variante;
  const nome = titulo.toLowerCase();

  function aoEscolher(f: File | undefined) {
    if (input.current) input.current.value = '';
    if (!f) return;
    const erro = validarArquivoLogo(f);
    setErroArquivo(erro);
    if (!erro) salvar.mutate({ variante, arquivo: f });
  }

  return (
    <SettingsRow
      titulo={titulo}
      descricao={descricao}
      erro={erroArquivo ?? (minha && salvar.isError ? 'Não foi possível salvar a logo. Tente de novo.' : null)}
      estado={minha ? <EstadoSalvo estado={estadoDeMutation(salvar)} /> : undefined}
    >
      {url && (
        <span className={`flex h-9 items-center rounded-md border px-2 ${variante === 'escuro' ? 'bg-zinc-900' : 'bg-white'}`}>
          <img src={url} alt="" className="max-h-7 max-w-[140px] object-contain" />
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept={TIPOS_LOGO.join(',')}
        className="sr-only"
        aria-label={`Arquivo da ${nome}`}
        disabled={!pode || salvar.isPending}
        onChange={(e) => aoEscolher(e.target.files?.[0])}
      />
      <Button variant="outline" size="sm" disabled={!pode || salvar.isPending} onClick={() => input.current?.click()}>
        {url ? 'Trocar' : 'Enviar'}
      </Button>
      {url && (
        <Button
          variant="ghost"
          size="sm"
          disabled={!pode || salvar.isPending}
          aria-label={`Remover ${nome}`}
          onClick={() => salvar.mutate({ variante, arquivo: null })}
        >
          Remover
        </Button>
      )}
    </SettingsRow>
  );
}
