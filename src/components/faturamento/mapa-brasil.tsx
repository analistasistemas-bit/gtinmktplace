import { useMemo } from 'react';
import { BRASIL_UF_GEOJSON, type UfFeature } from '@/lib/geo/brasil-uf';
import { cn } from '@/lib/utils';

export interface MapaBrasilProps {
  /** uf (ex.: "SP") → valor de intensidade (ex.: nº de pedidos). UFs ausentes = 0. */
  valores: Record<string, number>;
  /** rótulo do valor no tooltip. default "pedidos". */
  unidade?: string;
  /** uf selecionada (destaca); opcional. */
  selecionada?: string | null;
  /** callback ao clicar numa UF (opcional). */
  onSelecionar?: (uf: string) => void;
}

interface Projected {
  uf: string;
  d: string;
  valor: number;
}

function buildPath(
  coords: number[][][][],
  project: (lng: number, lat: number) => [number, number],
): string {
  const parts: string[] = [];
  for (const polygon of coords) {
    for (const ring of polygon) {
      if (ring.length === 0) continue;
      const [x0, y0] = project(ring[0][0], ring[0][1]);
      let segment = `M ${x0} ${y0}`;
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1]);
        segment += ` L ${x} ${y}`;
      }
      segment += ' Z';
      parts.push(segment);
    }
  }
  return parts.join(' ');
}

export function MapaBrasil({
  valores,
  unidade = 'pedidos',
  selecionada,
  onSelecionar,
}: MapaBrasilProps) {
  const { viewBox, paths, max } = useMemo(() => {
    const features = BRASIL_UF_GEOJSON.features as UfFeature[];

    // 1. Bounding box de todas as coords
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const f of features) {
      for (const polygon of f.geometry.coordinates) {
        for (const ring of polygon) {
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
    }

    // 2. Correção de aspecto (projeção equiretangular)
    const midLat = (minLat + maxLat) / 2;
    const k = Math.cos((midLat * Math.PI) / 180);

    const project = (lng: number, lat: number): [number, number] => [
      (lng - minLng) * k,
      maxLat - lat,
    ];

    const vbW = (maxLng - minLng) * k;
    const vbH = maxLat - minLat;

    // 3. Calcular paths para cada UF
    const maxVal = Math.max(1, ...Object.values(valores));

    const projPaths: Projected[] = features.map((f) => ({
      uf: f.properties.sigla,
      d: buildPath(f.geometry.coordinates, project),
      valor: valores[f.properties.sigla] ?? 0,
    }));

    return {
      viewBox: `0 0 ${vbW} ${vbH}`,
      paths: projPaths,
      max: maxVal,
    };
  }, [valores]);

  return (
    <div className="flex flex-col gap-2">
      <div className="mx-auto w-full max-w-[560px]">
        <svg
          viewBox={viewBox}
          className="h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Mapa do Brasil por UF"
        >
          {paths.map(({ uf, d, valor }) => {
            const t = valor / max;
            const isSelected = uf === selecionada;
            const hasSale = valor > 0;

            const fillOpacity = hasSale ? 0.12 + 0.78 * t : 0.5;
            const fill = hasSale ? 'var(--primary)' : 'var(--muted)';
            const stroke = isSelected ? 'var(--primary)' : 'var(--border)';
            const strokeWidth = isSelected ? 0.35 : 0.15;

            return (
              <path
                key={uf}
                d={d}
                data-uf={uf}
                fill={fill}
                fillOpacity={fillOpacity}
                fillRule="evenodd"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                className={cn(onSelecionar && 'cursor-pointer')}
                onClick={() => onSelecionar?.(uf)}
              >
                <title>
                  {uf} — {valor} {unidade}
                </title>
              </path>
            );
          })}
        </svg>
      </div>

      {/* Legenda de gradiente */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span>menos</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{
            background:
              'linear-gradient(to right, color-mix(in srgb, var(--primary) 12%, transparent), color-mix(in srgb, var(--primary) 90%, transparent))',
          }}
        />
        <span>mais</span>
      </div>
    </div>
  );
}
