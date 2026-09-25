// Mensagem do aviso de lead da landing (docs/brand/landing, ADR-0152). Fica fora de _shared de
// propósito: é da Daludi, não de uma org cliente, e mexer em _shared força redeploy de todas as edges.
type Dados = Record<string, unknown>;

const txt = (d: Dados, k: string) => String(d[k] ?? '').trim();

export function leadValido(d: Dados): boolean {
  return ['nome', 'email', 'produto_1_descricao'].every((k) => txt(d, k) !== '');
}

function linkWhatsApp(numero: string): string | null {
  const digitos = numero.replace(/\D/g, '');
  if (!digitos) return null;
  return `https://wa.me/${digitos.startsWith('55') && digitos.length > 11 ? digitos : '55' + digitos}`;
}

function linhaProduto(d: Dados, n: number): string | null {
  const p = (campo: string) => txt(d, `produto_${n}_${campo}`);
  if (!p('descricao')) return null;
  const medidas = [p('altura_cm'), p('largura_cm'), p('comprimento_cm')];
  return `${n}. ` + [
    p('descricao'),
    p('ean') && `EAN ${p('ean')}`,
    p('custo') && `R$ ${p('custo')}`,
    p('peso_gramas') && `${p('peso_gramas')} g`,
    medidas.every(Boolean) && `${medidas.join('×')} cm`,
  ].filter(Boolean).join(' · ');
}

export function montarMensagemLead(d: Dados): string {
  const wa = linkWhatsApp(txt(d, 'whatsapp'));
  const produtos = [1, 2, 3, 4, 5].map((n) => linhaProduto(d, n)).filter(Boolean);
  const descobrir = txt(d, 'o_que_quer_descobrir');
  const contato = [
    '📥 Novo lead na landing PubliAI',
    [txt(d, 'nome'), txt(d, 'empresa')].filter(Boolean).join(' · '),
    `E-mail: ${txt(d, 'email')}`,
    wa && `WhatsApp: ${wa}`,
    txt(d, 'vende') && `Vende em marketplaces: ${txt(d, 'vende')}`,
  ];
  const blocos = [
    contato.filter(Boolean).join('\n'),
    [`Produtos (${produtos.length}):`, ...produtos].join('\n'),
    descobrir && `Quer descobrir: ${descobrir}`,
  ];
  return blocos.filter(Boolean).join('\n\n');
}
