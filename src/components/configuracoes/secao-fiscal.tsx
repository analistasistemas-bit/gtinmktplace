import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAliquotas, useSalvarAliquotas, useEmpresaFiscal, useSalvarEmpresaFiscal } from '@/hooks/useConfiguracoes';
import { validarCnpj } from '@/lib/fiscal';
import { cn } from '@/lib/utils';
import { usePermissoesConfig } from './permissoes';
import {
  AvisoLeitura, EstadoSalvo, LinhasCarregando, SettingsGroup, SettingsRow,
  useFilaDeSalvamento, type EstadoCampo,
} from './settings-row';

// Obrigatórios por subgrupo, transcritos do ADR-0135 (§ "Campos") — não inferidos do
// formulário. O único marcado como opcional lá é `cfop_fora_uf_contribuinte`, então ele fica
// fora do denominador. `complemento` está na lista de "endereço fiscal completo" do ADR e por
// isso conta: se isso estiver errado, o erro é do ADR e aparece aqui, em vez de sumir.
const OBRIGATORIOS = {
  identidade: ['cnpj', 'razao_social', 'nome_fantasia', 'inscricao_estadual', 'regime_tributario'],
  endereco: ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'municipio_ibge', 'uf'],
  operacao: ['natureza_operacao', 'cfop_dentro_uf', 'cfop_fora_uf_nao_contribuinte', 'cst_pis', 'cst_cofins', 'origin_type'],
  emissao: ['emissao_a_partir_de'],
} as const;

type Empresa = Record<string, unknown>;

function preenchidos(empresa: Empresa | null | undefined, campos: readonly string[]) {
  return campos.filter((c) => (empresa?.[c] ?? '') !== '').length;
}

function pctValido(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

type SnapshotAliquotas = {
  nacional: number; importado: number; ufEmpresa: string | null; internaPct: number | null;
};

function CampoEmpresa({ id, rotulo, valor, onSalvar, disabled, placeholder, erro, estado, largura = 'w-full' }: {
  id: string; rotulo: string; valor: string; disabled: boolean;
  onSalvar: (v: string) => void; placeholder?: string; erro?: string | null;
  estado?: EstadoCampo; largura?: string;
}) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">{rotulo}</label>
        <EstadoSalvo estado={estado} />
      </div>
      <Input
        id={id}
        className={cn('h-8 text-sm', largura)}
        value={v}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== valor) onSalvar(v); }}
      />
      {erro && <p id={`${id}-erro`} className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

function Subgrupo({ titulo, campos, empresa, children }: {
  titulo: string; campos: readonly string[]; empresa: Empresa | null | undefined; children: React.ReactNode;
}) {
  const feitos = preenchidos(empresa, campos);
  const completo = feitos === campos.length;
  return (
    <div className="px-4 py-3.5">
      <div className="mb-3 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
        <span className={cn('text-xs tabular-nums', completo ? 'text-success' : 'text-muted-foreground')}>
          {completo ? '✓ completo' : `${feitos} de ${campos.length}`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function SecaoFiscal() {
  const { podeEditarConfig, podeEditarEmpresa } = usePermissoesConfig();

  const { data: aliquotas, isLoading: aliquotasCarregando } = useAliquotas();
  const salvarAliquotas = useSalvarAliquotas();
  const { data: empresa, isLoading: empresaCarregando } = useEmpresaFiscal();
  const salvarEmpresa = useSalvarEmpresaFiscal();

  // Uma fila por tabela. Independentes entre si: uma gravação de cada pode estar em voo ao
  // mesmo tempo; o que não pode é duas da mesma tabela (ver useFilaDeSalvamento).
  //
  // "carregado e vazio" (`null`, org que ainda não cadastrou nada) NÃO é "carregando": quem
  // separa é o `isLoading`. Tratar os dois como a mesma coisa deixava o bloco Empresa em
  // skeleton para sempre numa org sem cadastro — o formulário nunca aparecia.
  const filaAliquotas = useFilaDeSalvamento<SnapshotAliquotas>(
    aliquotasCarregando
      ? undefined
      : {
          nacional: aliquotas?.nacional ?? 8,
          importado: aliquotas?.importado ?? 16,
          ufEmpresa: aliquotas?.ufEmpresa ?? null,
          internaPct: aliquotas?.internaPct ?? null,
        },
  );
  const filaEmpresa = useFilaDeSalvamento<Empresa>(
    empresaCarregando ? undefined : ((empresa as Empresa | null) ?? {}),
  );

  const empresaVazia = !empresaCarregando && (empresa == null
    || Object.values(OBRIGATORIOS).every((campos) => preenchidos(empresa as Empresa, campos) === 0));

  const [nacionalInput, setNacionalInput] = useState('8');
  const [importadoInput, setImportadoInput] = useState('16');
  const [ufEmpresaInput, setUfEmpresaInput] = useState('');
  const [internaInput, setInternaInput] = useState('');
  const [erroInterna, setErroInterna] = useState<string | null>(null);

  useEffect(() => {
    if (aliquotas == null) return;
    setNacionalInput(String(aliquotas.nacional));
    setImportadoInput(String(aliquotas.importado));
    setUfEmpresaInput(aliquotas.ufEmpresa ?? '');
    setInternaInput(aliquotas.internaPct != null ? String(aliquotas.internaPct) : '');
  }, [aliquotas]);

  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [erroIbge, setErroIbge] = useState<string | null>(null);
  const [erroUf, setErroUf] = useState<string | null>(null);
  const [emissaoInput, setEmissaoInput] = useState('');
  useEffect(() => { setEmissaoInput(empresa?.emissao_a_partir_de ?? ''); }, [empresa?.emissao_a_partir_de]);

  const gravarAliquota = (campo: keyof SnapshotAliquotas, patch: Partial<SnapshotAliquotas>) =>
    filaAliquotas.salvar(campo, patch, (s) => salvarAliquotas.mutateAsync(s));

  // ADR-0112: UF e percentual andam juntos. Meia-configuração não grava e diz o motivo —
  // salvar só um dos dois aplicaria imposto parcial em silêncio.
  const salvarInterna = (uf: string, pctRaw: string) => {
    const u = uf.trim().toUpperCase();
    const p = pctRaw.trim() === '' ? null : pctValido(pctRaw);
    if (u === '' && p === null) {
      setErroInterna(null);
    } else if (u === '' || p === null) {
      setErroInterna('Preencha a UF e o percentual — ou deixe os dois em branco.');
      return;
    } else if (!/^[A-Z]{2}$/.test(u)) {
      setErroInterna('UF inválida (use a sigla de 2 letras, ex.: PE).');
      return;
    } else {
      setErroInterna(null);
    }
    gravarAliquota('ufEmpresa', { ufEmpresa: u === '' ? null : u, internaPct: u === '' ? null : p });
  };

  type PatchEmpresa = Parameters<typeof salvarEmpresa.mutateAsync>[0];
  const gravarEmpresa = (campo: string, valor: string | null) =>
    filaEmpresa.salvar(campo, { [campo]: valor }, (s) =>
      salvarEmpresa.mutateAsync({ [campo]: s[campo] } as PatchEmpresa));

  const salvarCampoEmpresa = (campo: string) => (v: string) =>
    gravarEmpresa(campo, v.trim() === '' ? null : v.trim());

  const salvarCnpj = (v: string) => {
    const digitos = v.replace(/\D/g, '');
    if (digitos === '') { setErroCnpj(null); gravarEmpresa('cnpj', null); return; }
    if (!validarCnpj(digitos)) { setErroCnpj('CNPJ inválido (dígito verificador não confere).'); return; }
    setErroCnpj(null);
    gravarEmpresa('cnpj', digitos);
  };

  const salvarIbge = (v: string) => {
    const t = v.trim();
    if (t === '') { setErroIbge(null); gravarEmpresa('municipio_ibge', null); return; }
    if (!/^\d{7}$/.test(t)) { setErroIbge('Código IBGE inválido (7 dígitos).'); return; }
    setErroIbge(null);
    gravarEmpresa('municipio_ibge', t);
  };

  const salvarUf = (v: string) => {
    const u = v.trim().toUpperCase();
    if (u === '') { setErroUf(null); gravarEmpresa('uf', null); return; }
    if (!/^[A-Z]{2}$/.test(u)) { setErroUf('UF inválida (2 letras, ex.: PE).'); return; }
    setErroUf(null);
    gravarEmpresa('uf', u);
  };

  const campo = (id: string, rotulo: string, extras: Partial<Parameters<typeof CampoEmpresa>[0]> = {}) => (
    <CampoEmpresa
      id={id}
      rotulo={rotulo}
      valor={((empresa as Empresa | null)?.[id] as string | null | undefined) ?? ''}
      disabled={!podeEditarEmpresa || !filaEmpresa.pronto}
      estado={filaEmpresa.estados[id]}
      erro={filaEmpresa.erros[id] ?? null}
      onSalvar={salvarCampoEmpresa(id)}
      {...extras}
    />
  );

  return (
    <div className="space-y-4">
      <SettingsGroup
        titulo="Imposto por origem"
        descricao="Alíquota aplicada conforme a origem do produto (nacional ou importado)."
        aviso={
          <>
            {aliquotas && !aliquotas.confirmada && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-xs font-medium text-warning">Alíquotas não confirmadas</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Confirme as alíquotas antes de publicar — enquanto não confirmar, a publicação
                  falha (o sistema não aplica 8%/16% em silêncio, ADR-0086).
                </p>
                {podeEditarConfig ? (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={!filaAliquotas.pronto}
                    onClick={() => gravarAliquota('nacional', {})}
                  >
                    Confirmar alíquotas
                  </Button>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Só um administrador pode confirmar as alíquotas.
                  </p>
                )}
              </div>
            )}
            {!podeEditarConfig && <AvisoLeitura>Só um administrador altera as alíquotas.</AvisoLeitura>}
          </>
        }
      >
        {aliquotasCarregando ? (
          <LinhasCarregando linhas={2} />
        ) : (
          <>
            <SettingsRow
              titulo="Produto nacional"
              descricao="Alíquota aplicada a produtos com ORIGEM = NACIONAL na planilha."
              htmlFor="aliquota-nacional"
              estado={<EstadoSalvo estado={filaAliquotas.estados.nacional} />}
              erro={filaAliquotas.erros.nacional ?? null}
            >
              <div className="flex items-center gap-1.5">
                <Input
                  id="aliquota-nacional"
                  type="number" min={0} max={100} step={0.5}
                  className="h-8 w-20 text-sm"
                  value={nacionalInput}
                  disabled={!podeEditarConfig}
                  aria-invalid={filaAliquotas.erros.nacional ? true : undefined}
                  aria-describedby={filaAliquotas.erros.nacional ? 'aliquota-nacional-erro' : undefined}
                  onChange={(e) => setNacionalInput(e.target.value)}
                  onBlur={() => {
                    const n = pctValido(nacionalInput);
                    if (n === null) { setNacionalInput(String(aliquotas?.nacional ?? 8)); return; }
                    gravarAliquota('nacional', { nacional: n });
                  }}
                />
                <span className="pt-1.5 text-sm">%</span>
              </div>
            </SettingsRow>

            <SettingsRow
              titulo="Produto importado"
              descricao="Alíquota aplicada a produtos com ORIGEM = IMPORTADO na planilha."
              htmlFor="aliquota-importado"
              estado={<EstadoSalvo estado={filaAliquotas.estados.importado} />}
              erro={filaAliquotas.erros.importado ?? null}
            >
              <div className="flex items-center gap-1.5">
                <Input
                  id="aliquota-importado"
                  type="number" min={0} max={100} step={0.5}
                  className="h-8 w-20 text-sm"
                  value={importadoInput}
                  disabled={!podeEditarConfig}
                  aria-invalid={filaAliquotas.erros.importado ? true : undefined}
                  aria-describedby={filaAliquotas.erros.importado ? 'aliquota-importado-erro' : undefined}
                  onChange={(e) => setImportadoInput(e.target.value)}
                  onBlur={() => {
                    const n = pctValido(importadoInput);
                    if (n === null) { setImportadoInput(String(aliquotas?.importado ?? 16)); return; }
                    gravarAliquota('importado', { importado: n });
                  }}
                />
                <span className="pt-1.5 text-sm">%</span>
              </div>
            </SettingsRow>

            <SettingsRow
              titulo="Venda dentro do estado"
              descricao="Pedidos entregues nesta UF usam esta alíquota, no lugar de nacional/importado. Em branco, vale sempre a alíquota por origem (ADR-0112)."
              estado={<EstadoSalvo estado={filaAliquotas.estados.ufEmpresa} />}
              erro={erroInterna ?? filaAliquotas.erros.ufEmpresa ?? null}
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label="UF da empresa"
                  className="h-8 w-16 text-sm uppercase"
                  maxLength={2}
                  placeholder="PE"
                  value={ufEmpresaInput}
                  disabled={!podeEditarConfig}
                  onChange={(e) => setUfEmpresaInput(e.target.value.toUpperCase())}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
                <Input
                  aria-label="Alíquota dentro do estado"
                  type="number" min={0} max={100} step={0.5}
                  className="h-8 w-20 text-sm"
                  value={internaInput}
                  disabled={!podeEditarConfig}
                  onChange={(e) => setInternaInput(e.target.value)}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
                <span className="pt-1.5 text-sm">%</span>
              </div>
            </SettingsRow>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        titulo="Empresa"
        descricao="Dados usados na emissão fiscal. Emissão exige organização PJ — quem marca é o administrador da plataforma."
        aviso={!podeEditarEmpresa && <AvisoLeitura>Só um administrador da organização altera o cadastro da empresa.</AvisoLeitura>}
      >
        {empresaCarregando ? (
          <LinhasCarregando linhas={3} />
        ) : (
          <>
            {empresaVazia && (
              <div className="px-4 py-3.5">
                <p className="text-xs text-muted-foreground">
                  Esta organização ainda não tem cadastro fiscal. Comece pelo CNPJ — os
                  contadores de cada bloco mostram o que falta para o cadastro ficar completo.
                </p>
              </div>
            )}
            <Subgrupo titulo="Identidade" campos={OBRIGATORIOS.identidade} empresa={empresa as Empresa}>
              {campo('cnpj', 'CNPJ', { placeholder: '00.000.000/0000-00', erro: erroCnpj, onSalvar: salvarCnpj })}
              {campo('razao_social', 'Razão social')}
              {campo('nome_fantasia', 'Nome fantasia')}
              {campo('inscricao_estadual', 'Inscrição estadual')}
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="regime_tributario" className="text-xs font-medium">Regime tributário</label>
                  <EstadoSalvo estado={filaEmpresa.estados.regime_tributario} />
                </div>
                <Select
                  value={empresa?.regime_tributario ?? undefined}
                  disabled={!podeEditarEmpresa || !filaEmpresa.pronto}
                  onValueChange={(v) => gravarEmpresa('regime_tributario', v)}
                >
                  <SelectTrigger id="regime_tributario" aria-label="Regime tributário" className="h-8 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simples">Simples Nacional</SelectItem>
                    <SelectItem value="normal">Regime Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Subgrupo>

            <Subgrupo titulo="Endereço" campos={OBRIGATORIOS.endereco} empresa={empresa as Empresa}>
              {campo('cep', 'CEP')}
              {campo('logradouro', 'Logradouro')}
              {campo('numero', 'Número')}
              {campo('complemento', 'Complemento')}
              {campo('bairro', 'Bairro')}
              {campo('municipio', 'Município')}
              {campo('municipio_ibge', 'Código IBGE do município', { placeholder: '2611606', erro: erroIbge, onSalvar: salvarIbge })}
              {campo('uf', 'UF', { placeholder: 'PE', largura: 'w-20', erro: erroUf, onSalvar: salvarUf })}
            </Subgrupo>

            <Subgrupo titulo="Operação fiscal" campos={OBRIGATORIOS.operacao} empresa={empresa as Empresa}>
              {campo('natureza_operacao', 'Natureza da operação')}
              {campo('cfop_dentro_uf', 'CFOP dentro da UF')}
              {campo('cfop_fora_uf_nao_contribuinte', 'CFOP fora da UF (não contribuinte)')}
              {campo('cfop_fora_uf_contribuinte', 'CFOP fora da UF (contribuinte, opcional)')}
              {campo('cst_pis', 'CST de PIS')}
              {campo('cst_cofins', 'CST de COFINS')}
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="origin_type" className="text-xs font-medium">Papel da empresa</label>
                  <EstadoSalvo estado={filaEmpresa.estados.origin_type} />
                </div>
                <Select
                  value={empresa?.origin_type ?? undefined}
                  disabled={!podeEditarEmpresa || !filaEmpresa.pronto}
                  onValueChange={(v) => gravarEmpresa('origin_type', v)}
                >
                  <SelectTrigger id="origin_type" aria-label="Papel da empresa" className="h-8 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manufacturer">Fabricante</SelectItem>
                    <SelectItem value="reseller">Revendedor</SelectItem>
                    <SelectItem value="imported">Importador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Subgrupo>

            <Subgrupo titulo="Emissão" campos={OBRIGATORIOS.emissao} empresa={empresa as Empresa}>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="emissao_a_partir_de" className="text-xs font-medium">Emitir a partir de</label>
                  <EstadoSalvo estado={filaEmpresa.estados.emissao_a_partir_de} />
                </div>
                <Input
                  id="emissao_a_partir_de"
                  type="date"
                  className="h-8 w-40 text-sm"
                  value={emissaoInput}
                  disabled={!podeEditarEmpresa || !filaEmpresa.pronto}
                  onChange={(e) => setEmissaoInput(e.target.value)}
                  onBlur={() => {
                    if (emissaoInput === (empresa?.emissao_a_partir_de ?? '')) return;
                    gravarEmpresa('emissao_a_partir_de', emissaoInput === '' ? null : emissaoInput);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Vendas anteriores a esta data nunca entram no fluxo fiscal.
                </p>
              </div>
            </Subgrupo>

            <div className="px-4 py-3.5">
              <p className="text-xs text-muted-foreground">
                No painel do Mercado Livre (Preferências de venda → Emissor de NF-e): ativar o
                Faturador, enviar o certificado A1 e configurar a série. O PubliAI verifica a
                prontidão pelo próprio ML (semáforo nos Publicados).
              </p>
            </div>
          </>
        )}
      </SettingsGroup>
    </div>
  );
}
