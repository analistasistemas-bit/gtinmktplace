/**
 * Partes puras do campo de partículas: geração das posições de repouso e o ruído que
 * faz o anel vagar sozinho. Ficam fora do módulo do Three para poderem ser testadas
 * sem WebGL — o resto do efeito só existe na GPU.
 */

/** Lado da grade onde as posições de repouso são sorteadas, antes de normalizar. */
export const LADO_GRADE = 500;

/**
 * Distâncias do Poisson-disk em função da densidade (0–300). O default do efeito é 230,
 * que cai em ~3,9 / ~4,9 — os números que a landing do Antigravity usa em produção.
 */
export function distanciasPorDensidade(densidade: number): { min: number; max: number } {
  const t = Math.min(Math.max(densidade, 0), 300) / 300;
  return { min: 10 + (2 - 10) * t, max: 11 + (3 - 11) * t };
}

/**
 * Poisson-disk sampling (Bridson): pontos com distância mínima garantida entre si, o que
 * dá um campo denso sem os aglomerados e buracos de um sorteio uniforme. Candidatos saem
 * no anel [min, max) ao redor de um ponto ativo; a grade de células de lado `min/√2`
 * garante no máximo um ponto por célula e reduz a checagem à vizinhança 5×5.
 */
export function amostrarPoisson(
  lado: number,
  distMin: number,
  distMax: number,
  rand: () => number = Math.random,
): Array<[number, number]> {
  const celula = distMin / Math.SQRT2;
  const colunas = Math.ceil(lado / celula);
  const grade = new Int32Array(colunas * colunas).fill(-1);
  const pontos: Array<[number, number]> = [];
  const ativos: number[] = [];
  const distMin2 = distMin * distMin;

  function inserir(x: number, y: number) {
    grade[Math.floor(y / celula) * colunas + Math.floor(x / celula)] = pontos.length;
    ativos.push(pontos.length);
    pontos.push([x, y]);
  }

  function livre(x: number, y: number): boolean {
    const cx = Math.floor(x / celula);
    const cy = Math.floor(y / celula);
    for (let j = Math.max(cy - 2, 0); j <= Math.min(cy + 2, colunas - 1); j++) {
      for (let i = Math.max(cx - 2, 0); i <= Math.min(cx + 2, colunas - 1); i++) {
        const idx = grade[j * colunas + i];
        if (idx < 0) continue;
        const dx = pontos[idx][0] - x;
        const dy = pontos[idx][1] - y;
        if (dx * dx + dy * dy < distMin2) return false;
      }
    }
    return true;
  }

  inserir(rand() * lado, rand() * lado);

  while (ativos.length > 0) {
    const k = Math.floor(rand() * ativos.length);
    const [px, py] = pontos[ativos[k]];
    let aceitou = false;

    for (let tentativa = 0; tentativa < 30; tentativa++) {
      const angulo = rand() * Math.PI * 2;
      const raio = distMin + rand() * (distMax - distMin);
      const x = px + Math.cos(angulo) * raio;
      const y = py + Math.sin(angulo) * raio;
      if (x < 0 || y < 0 || x >= lado || y >= lado) continue;
      if (!livre(x, y)) continue;
      inserir(x, y);
      aceitou = true;
      break;
    }

    if (!aceitou) ativos.splice(k, 1);
  }

  return pontos;
}

/** Value noise 1D em [0,1), contínuo e determinístico — usado no passeio do anel. */
export function ruido1d(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const suave = f * f * (3 - 2 * f);
  return hash(i) * (1 - suave) + hash(i + 1) * suave;
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}
