import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModeloTexto, useSalvarModeloTexto, useModeloImagem, useSalvarModeloImagem } from '@/hooks/useConfiguracoes';
import { MODELOS_TEXTO, MODELOS_IMAGEM } from '@/lib/ai-modelos';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoIA() {
  const { podeEditarConfig } = usePermissoesConfig();
  const { data: modeloTexto } = useModeloTexto();
  const salvarTexto = useSalvarModeloTexto();
  const { data: modeloImagem } = useModeloImagem();
  const salvarImagem = useSalvarModeloImagem();

  return (
    <SettingsGroup
      titulo="Modelo de IA"
      descricao="Modelo usado para gerar título, descrição, categoria e atributos dos anúncios (via OpenRouter)."
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
        descricao="Ainda não é usado por nenhuma feature — fica reservado para quando a geração de imagem existir."
        estado={<EstadoSalvo estado={estadoDeMutation(salvarImagem)} />}
      >
        <Select
          value={modeloImagem ?? undefined}
          onValueChange={(v) => salvarImagem.mutate(v)}
          disabled={!podeEditarConfig}
        >
          <SelectTrigger aria-label="Modelo de imagem" className="h-8 w-[300px] max-w-full text-sm">
            <SelectValue placeholder="Selecione um modelo" />
          </SelectTrigger>
          <SelectContent>
            {MODELOS_IMAGEM.map((m) => (
              <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsGroup>
  );
}
