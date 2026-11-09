import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useModeloTexto, useSalvarModeloTexto, useModeloImagem, useSalvarModeloImagem, useModeloGaleria, useSalvarModeloGaleria,
} from '@/hooks/useConfiguracoes';
import { useProfile } from '@/hooks/useProfile';
import { MODELOS_TEXTO, MODELOS_IMAGEM, MODELOS_GALERIA_UI } from '@/lib/ai-modelos';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoIA() {
  const { podeEditarConfig } = usePermissoesConfig();
  const { data: modeloTexto } = useModeloTexto();
  const salvarTexto = useSalvarModeloTexto();
  const { data: modeloImagem } = useModeloImagem();
  const salvarImagem = useSalvarModeloImagem();
  // Galeria da cor: só o admin da plataforma vê e troca (o banco recusa os demais por trigger).
  const { profile } = useProfile();
  const superAdmin = !!profile?.is_super_admin;
  const { data: modeloGaleria } = useModeloGaleria();
  const salvarGaleria = useSalvarModeloGaleria();

  return (
    <SettingsGroup
      titulo="Modelo de IA"
      descricao="Modelos usados para gerar o conteúdo dos anúncios e a foto do kit com variação (via OpenRouter)."
      aviso={!podeEditarConfig && <AvisoLeitura>Só um administrador troca o modelo.</AvisoLeitura>}
    >
      <SettingsRow
        titulo="Texto"
        descricao="Gera o conteúdo do anúncio a partir da planilha."
        estado={<EstadoSalvo estado={estadoDeMutation(salvarTexto)} />}
      >
        <Select
          value={modeloTexto ?? MODELOS_TEXTO[0].slug}
          onValueChange={(v) => salvarTexto.mutate(v)}
          disabled={!podeEditarConfig}
        >
          <SelectTrigger aria-label="Modelo de texto" className="h-8 w-[300px] max-w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELOS_TEXTO.map((m) => (
              <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        titulo="Imagem"
        descricao="Gera a foto de cada combinação do kit com variação, em empresa com a geração de imagem por IA habilitada."
        estado={<EstadoSalvo estado={estadoDeMutation(salvarImagem)} />}
      >
        <Select
          value={modeloImagem ?? MODELOS_IMAGEM[0].slug}
          onValueChange={(v) => salvarImagem.mutate(v)}
          disabled={!podeEditarConfig}
        >
          <SelectTrigger aria-label="Modelo de imagem" className="h-8 w-[300px] max-w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELOS_IMAGEM.map((m) => (
              <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {superAdmin && (
        <SettingsRow
          titulo="Galeria da cor"
          descricao="Gera as fotos da galeria de cada cor do anúncio. Só o admin da plataforma troca."
          estado={<EstadoSalvo estado={estadoDeMutation(salvarGaleria)} />}
        >
          <Select
            value={modeloGaleria ?? MODELOS_GALERIA_UI[0].slug}
            onValueChange={(v) => salvarGaleria.mutate(v)}
            disabled={!podeEditarConfig}
          >
            <SelectTrigger aria-label="Modelo da galeria" className="h-8 w-[300px] max-w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELOS_GALERIA_UI.map((m) => (
                <SelectItem key={m.slug} value={m.slug} disabled={!!m.indisponivel}>
                  {m.label} — {m.indisponivel ?? m.precoLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
