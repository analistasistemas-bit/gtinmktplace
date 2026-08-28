/**
 * GLSL do campo de partículas. Três blocos: o simplex noise 3D compartilhado, o shader de
 * simulação (escreve o estado de cada partícula numa textura float) e o par vertex/fragment
 * que desenha os `gl_Points`.
 *
 * O estado de uma partícula cabe num texel RGBA: `xy` = deslocamento acumulado em relação à
 * posição de repouso, `z` = escala, `w` = velocidade. A posição de repouso vive numa segunda
 * textura, imutável. O ruído contínuo (`deslocamento()`) não entra no estado: é função pura
 * de (posição de repouso, tempo), então simulação e render recalculam em vez de armazenar.
 */

/** Simplex noise 3D — Ashima Arts / Stefan Gustavson (MIT). */
const RUIDO = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float sn(vec2 p, float t) { return snoise(vec3(p, t)); }

#define PISO_TAMANHO 0.8
/** A escala chega a ~3 dentro do anel; sem teto a partícula lá fica 10× a de repouso. */
#define TETO_TAMANHO 1.0
#define PISO_PRESENCA 0.25
`;

/**
 * Deslocamento contínuo, independente do cursor: ruído simplex em duas escalas (4× lenta,
 * 20× fina) mais uma onda senoidal que só aparece longe do anel. Precisa ser idêntico na
 * simulação e no vertex shader — daí viver num bloco compartilhado.
 */
const DESLOCAMENTO = /* glsl */ `
vec2 deslocamento(vec2 p, float tempo, float dist) {
  vec2 d = vec2(sn(p * 4.0 + 11.3, tempo * 0.35), sn(p * 4.0 + 71.7, tempo * 0.35)) * 0.03
         + vec2(sn(p * 20.0 + 31.1, tempo * 0.5), sn(p * 20.0 + 97.5, tempo * 0.5)) * 0.005;
  float longe = clamp(dist, 0.0, 1.0);
  d.x += sin(p.x * 20.0 + tempo * 4.0) * 0.02 * longe;
  d.y += cos(p.y * 20.0 + tempo * 3.0) * 0.02 * longe;
  return d;
}
`;

export const VERTEX_SIMULACAO = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FRAGMENT_SIMULACAO = /* glsl */ `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uPosRefs;
uniform vec2 uRingPos;
uniform float uRingRadius;
uniform float uRingWidth;
uniform float uRingWidth2;
uniform float uRingDisplacement;
uniform float uTime;

varying vec2 vUv;

${RUIDO}
${DESLOCAMENTO}

/** Máscara em anel: sobe até o raio e desce logo depois — o efeito nasce na casca, não no centro. */
float anel(float dist, float raio, float largura) {
  return smoothstep(raio - 2.0 * largura, raio, dist) - smoothstep(raio, raio + largura, dist);
}

void main() {
  vec4 estado = texture2D(uPosition, vUv);
  vec2 posRef = texture2D(uPosRefs, vUv).xy;

  // O offset volta sozinho ao repouso: nada puxa a partícula de volta além deste atrito.
  vec2 offset = estado.xy * 0.8;
  float escala = estado.z;
  float velocidade = estado.w;

  float dist = distance(posRef, uRingPos);

  float t = anel(dist, uRingRadius, uRingWidth);
  float t2 = anel(dist, uRingRadius, uRingWidth2);
  t = t * t;
  t2 = t2 * t2 * t2;
  t += t2 * 3.0;

  float t3 = 1.0 - smoothstep(0.0, uRingRadius, dist);
  t += t3 * 0.4;
  t += sn(posRef * 30.0, uTime * 0.5) * t3 * 0.5;

  // Cintilação de base, para o campo nunca ficar completamente morto longe do cursor.
  t += pow((sn(posRef * 2.0, uTime * 0.5) + 1.5) * 0.5, 2.0) * 0.6;

  vec2 disp = deslocamento(posRef, uTime, dist);
  offset -= (uRingPos - (posRef + disp)) * pow(t2, 0.75) * uRingDisplacement;

  escala += (t - escala) * 0.2;
  velocidade = velocidade * 0.5 + escala * 0.25;

  gl_FragColor = vec4(offset, escala, velocidade);
}
`;

export const VERTEX_PARTICULAS = /* glsl */ `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uPosRefs;
uniform vec2 uRingPos;
uniform float uTime;
uniform float uPointScale;
uniform float uEscalaCampo;

attribute vec2 aRef;
attribute vec4 aSeeds;

varying float vVelocidade;
varying vec4 vSeeds;
varying vec2 vLocal;

${RUIDO}
${DESLOCAMENTO}

void main() {
  vec4 estado = texture2D(uPosition, aRef);
  vec2 posRef = texture2D(uPosRefs, aRef).xy;

  float dist = distance(posRef, uRingPos);
  vec2 pos = posRef + deslocamento(posRef, uTime, dist) + estado.xy * 0.25;

  vVelocidade = estado.w;
  vSeeds = aSeeds;
  vLocal = posRef;

  // A simulação toda vive em [-1,1]; uEscalaCampo é só o zoom que faz o campo cobrir a
  // viewport, sem mexer nos números do anel.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos * uEscalaCampo, 0.0, 1.0);
  // PISO_TAMANHO dá corpo à partícula em repouso: só com a escala da simulação o ponto sai
  // com menos de 1px e some numa tela retina.
  gl_PointSize = (PISO_TAMANHO + clamp(estado.z, 0.0, TETO_TAMANHO)) * uPointScale;
}
`;

export const FRAGMENT_PARTICULAS = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uCorA;
uniform vec3 uCorB;
uniform vec3 uCorC;
uniform float uOpacidade;

varying float vVelocidade;
varying vec4 vSeeds;
varying vec2 vLocal;

${RUIDO}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // Cada partícula é um retângulo arredondado girado por ruído: lidos juntos, viram traços
  // inclinados que se alinham por região em vez de pontinhos soltos.
  vec2 p = gl_PointCoord - vec2(0.48, 0.40);
  float angulo = sn(vLocal * 10.0, uTime * 0.85) * 3.14159265 + vSeeds.x * 0.6;
  float c = cos(angulo);
  float s = sin(angulo);
  p = mat2(c, -s, s, c) * p;

  float d = sdRoundBox(p, vec2(0.34, 0.11), 0.2 * 0.11);
  float forma = 1.0 - smoothstep(-0.02, 0.04, d);
  if (forma <= 0.001) discard;

  // A cor sai da semente da partícula, não de ruído espacial: com ruído, vizinhas caem na
  // mesma faixa e a tela vira manchas de um tom só em vez de elementos que se alternam.
  // O branco fica em minoria — sobre o fundo preto ele domina se vier em peso igual.
  float sorteio = vSeeds.y;
  vec3 cor = sorteio < 0.45 ? uCorA : (sorteio < 0.80 ? uCorB : uCorC);

  // Mesma ideia do piso de tamanho: a velocidade em repouso fica em ~0.2 e sozinha deixaria
  // o campo inteiro transparente demais para ser percebido.
  float presenca = clamp(PISO_PRESENCA + vVelocidade, 0.0, 1.0);
  gl_FragColor = vec4(cor, forma * presenca * uOpacidade);
}
`;
