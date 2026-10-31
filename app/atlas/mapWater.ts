import type { Feature, FeatureCollection } from 'geojson';

/** Follow the inventory's pagination; a line ending at a page boundary is not a river ending. */
export async function loadMapWater(bbox: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FeatureCollection> {
  const groups = await Promise.all(['waterway', 'water-body'].map(async category => {
    const features: Feature[] = [];
    let offset = 0;
    while (true) {
      signal.throwIfAborted();
      const response = await fetcher(`/api/water-data?format=geojson&bbox=${bbox}&category=${category}&limit=1000&offset=${offset}`, { signal });
      if (!response.ok) throw new Error('Water overlay unavailable');
      const page = await response.json() as FeatureCollection & { nextOffset: number | null };
      if (!Array.isArray(page.features)) throw new Error('Invalid water overlay');
      features.push(...page.features);
      if (page.nextOffset == null) break;
      if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error('Invalid water pagination');
      offset = page.nextOffset;
    }
    return features;
  }));
  const unique = new Map<string, Feature>();
  for (const feature of groups.flat()) {
    const id = String(feature.properties?.id ?? feature.id ?? JSON.stringify(feature.geometry));
    unique.set(id, feature);
  }
  return { type: 'FeatureCollection', features: [...unique.values()] };
}
