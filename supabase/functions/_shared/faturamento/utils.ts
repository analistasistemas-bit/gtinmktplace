export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [];
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}
