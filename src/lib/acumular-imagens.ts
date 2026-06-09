const EXTENSOES_IMAGEM = ['.jpg', '.jpeg', '.png'];

// Mantém só arquivos de imagem aceitos pelo lote — a seleção de pasta inteira
// (webkitdirectory) traz lixo como .DS_Store/Thumbs.db sem filtro de accept.
export function filtrarImagens(files: File[]): File[] {
  return files.filter((f) => EXTENSOES_IMAGEM.some((ext) => f.name.toLowerCase().endsWith(ext)));
}

// Acumula imagens de múltiplos drops (uma pasta por vez) num único conjunto,
// deduplicando por nome de arquivo: o último drop do mesmo nome substitui o anterior.
// As fotos do lote são nomeadas por código (00CODIGO.jpeg), então o nome é a chave natural.
export function acumularImagens(atuais: File[], novas: File[]): File[] {
  const mapa = new Map<string, File>();
  for (const f of atuais) mapa.set(f.name, f);
  for (const f of novas) mapa.set(f.name, f);
  return Array.from(mapa.values());
}
