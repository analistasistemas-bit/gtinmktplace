// Logo da organização (spec 2026-11-15-logo-org-topbar-design.md).

export const BUCKET_LOGO_ORG = 'org-logos';
export const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 512 * 1024;

/** Versão do tema ativo; se só uma foi cadastrada, vale para os dois temas. */
export function escolherLogo(tema: 'light' | 'dark', claro: string | null, escuro: string | null): string | null {
  return (tema === 'dark' ? escuro ?? claro : claro ?? escuro) ?? null;
}

export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return partes.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** Quase quadrada = símbolo sem o nome escrito → o nome da org aparece ao lado. */
export function ehSimbolo(largura: number, altura: number): boolean {
  return largura < 1.5 * altura;
}

export function validarArquivoLogo(f: File): string | null {
  if (!TIPOS_LOGO.includes(f.type)) return 'Envie a logo em PNG, JPG ou WEBP.';
  if (f.size > MAX_BYTES) return 'A logo pode ter no máximo 512 KB.';
  return null;
}
