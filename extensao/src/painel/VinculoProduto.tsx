// "Este produto é meu SKU…" (ADR-0189 D-8): busca a variação da organização e grava o vínculo
// pelo catálogo (quando o anúncio tem) ou pelo próprio anúncio. Com vínculo manual, "Trocar SKU" remove-o.
import type { FonteCusto } from '../../../supabase/functions/_shared/extensao/vinculo.ts';
import { useState, type FormEvent } from 'react';
import { brl, type Chamar, type EntradaAnuncio } from './formato';

interface ItemSku {
  variacaoId: string;
  codigo: string;
  nome: string;
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
}

interface Props {
  entrada: EntradaAnuncio;
  fonte: FonteCusto;
  chamar: Chamar;
  onVinculado: () => void;
}

export function VinculoProduto({ entrada, fonte, chamar, onVinculado }: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<ItemSku[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    const t = termo.trim();
    if (t.length < 2) return setErro('Digite ao menos 2 caracteres.');
    setErro(null);
    setOcupado(true);
    const r = await chamar<{ itens: ItemSku[] }>({ acao: 'buscar_sku', termo: t });
    setOcupado(false);
    if (r.ok) setItens(r.dados.itens);
    else setErro('Não foi possível buscar os SKUs.');
  }

  async function vincular(item: ItemSku) {
    setOcupado(true);
    const chave = entrada.catalogProductId
      ? { tipo: 'catalogo', valor: entrada.catalogProductId }
      : { tipo: 'item', valor: entrada.mlItemId };
    const r = await chamar({ acao: 'salvar_vinculo', chave, variacaoId: item.variacaoId });
    setOcupado(false);
    if (r.ok) onVinculado();
    else setErro('Não foi possível salvar o vínculo.');
  }

  // O resolvedor tenta catálogo e depois item: remove os dois para o vínculo antigo não voltar.
  async function trocar() {
    setOcupado(true);
    setErro(null);
    const chaves = [
      ...(entrada.catalogProductId ? [{ tipo: 'catalogo', valor: entrada.catalogProductId }] : []),
      { tipo: 'item', valor: entrada.mlItemId },
    ];
    for (const chave of chaves) {
      const r = await chamar({ acao: 'remover_vinculo', chave });
      if (!r.ok) {
        setOcupado(false);
        return setErro('Não foi possível remover o vínculo.');
      }
    }
    setOcupado(false);
    onVinculado();
  }

  if (fonte === 'vinculo_manual') {
    return (
      <div className="bloco">
        <button type="button" className="secundario" disabled={ocupado} onClick={trocar}>Trocar SKU</button>
        {erro && <p className="erro" role="alert">{erro}</p>}
      </div>
    );
  }
  if (!aberto) {
    return (
      <button type="button" className="secundario" aria-expanded={false} onClick={() => setAberto(true)}>
        Este produto é meu SKU…
      </button>
    );
  }
  return (
    <div className="bloco">
      <form className="busca" onSubmit={buscar}>
        <label className="campo">
          Código, nome ou EAN
          <input type="search" value={termo} maxLength={60} onChange={(e) => setTermo(e.target.value)} />
        </label>
        <button type="submit" disabled={ocupado}>Buscar</button>
      </form>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {itens?.length === 0 && <p className="aviso">Nenhum SKU encontrado.</p>}
      {itens && itens.length > 0 && (
        <ul className="resultados">
          {itens.map((i) => (
            <li key={i.variacaoId}>
              <button type="button" disabled={ocupado} onClick={() => vincular(i)}>
                {`${i.codigo} · ${i.nome} · ${i.custo === null ? 'sem custo' : brl(i.custo)}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
