// Consulta de CEP para o cadastro fiscal (emenda ADR-0135, 2026-10-15). ViaCEP: grátis, sem
// chave, CORS aberto — chamado direto do navegador. Falha aqui nunca bloqueia: quem chama
// mostra o erro e o endereço continua editável à mão.

export interface EnderecoCep {
  logradouro: string; bairro: string; municipio: string; uf: string; municipio_ibge: string;
}

/** `cep8` já normalizado (8 dígitos). `null` = CEP inexistente; lança em falha de rede/5xx. */
export async function buscarCep(cep8: string, f: typeof fetch = fetch): Promise<EnderecoCep | null> {
  const r = await f(`https://viacep.com.br/ws/${cep8}/json/`, { signal: AbortSignal.timeout(5000) });
  if (r.status === 400) return null;
  if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  if (d.erro) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    logradouro: s(d.logradouro), bairro: s(d.bairro), municipio: s(d.localidade),
    uf: s(d.uf), municipio_ibge: s(d.ibge),
  };
}
