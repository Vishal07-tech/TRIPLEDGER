export type MapPinInput = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  isSelf: boolean;
};

export type MapPin = MapPinInput & {
  left: number;
  top: number;
};

export type MapTile = {
  key: string;
  url: string;
  left: number;
  top: number;
};

export type MapViewport = {
  zoom: number;
  width: number;
  height: number;
  tiles: MapTile[];
  pins: MapPin[];
};

export const MAP_TILE_SIZE = 256;
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 17;
const SINGLE_POINT_ZOOM = 15;
const EDGE_PADDING = 44;
/** Latitude beyond this cannot be projected by the usual web-mercator maths. */
const MAX_MERCATOR_LATITUDE = 85.05112878;

/**
 * Web-mercator projection into world pixels for a given zoom. One world is
 * 256 * 2^zoom pixels wide.
 */
export function projectPoint(
  point: { latitude: number; longitude: number },
  zoom: number,
): { x: number; y: number } {
  const worldSize = MAP_TILE_SIZE * 2 ** zoom;
  const latitude = Math.min(MAX_MERCATOR_LATITUDE, Math.max(-MAX_MERCATOR_LATITUDE, point.latitude));
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);

  return {
    x: ((point.longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize,
  };
}

export function mapTileUrl(zoom: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

function boundsAt(points: MapPinInput[], zoom: number) {
  const projected = points.map((point) => projectPoint(point, zoom));
  return {
    minX: Math.min(...projected.map((point) => point.x)),
    maxX: Math.max(...projected.map((point) => point.x)),
    minY: Math.min(...projected.map((point) => point.y)),
    maxY: Math.max(...projected.map((point) => point.y)),
  };
}

/** Largest zoom at which the whole group still fits inside the viewport. */
function chooseZoom(points: MapPinInput[], width: number, height: number): number {
  for (let zoom = MAP_MAX_ZOOM; zoom >= MAP_MIN_ZOOM; zoom -= 1) {
    const bounds = boundsAt(points, zoom);
    const fitsWidth = bounds.maxX - bounds.minX + EDGE_PADDING * 2 <= width;
    const fitsHeight = bounds.maxY - bounds.minY + EDGE_PADDING * 2 <= height;
    if (fitsWidth && fitsHeight) return zoom;
  }

  return MAP_MIN_ZOOM;
}

/**
 * Pins for members standing in the same spot would stack exactly on top of each
 * other, hiding everyone but the last one. Fan them out on a short spiral.
 */
function separateOverlaps(pins: MapPin[], width: number, height: number): MapPin[] {
  const placed: MapPin[] = [];

  for (const pin of pins) {
    let left = pin.left;
    let top = pin.top;
    let attempt = 0;

    while (placed.some((other) => Math.abs(other.left - left) < 14 && Math.abs(other.top - top) < 20)) {
      attempt += 1;
      if (attempt > 12) break;
      const angle = (attempt * 137.5 * Math.PI) / 180;
      const radius = 18 + Math.floor(attempt / 6) * 10;
      left = pin.left + Math.cos(angle) * radius;
      top = pin.top + Math.sin(angle) * radius;
    }

    placed.push({
      ...pin,
      left: Math.min(width - 10, Math.max(10, Math.round(left * 10) / 10)),
      top: Math.min(height - 30, Math.max(30, Math.round(top * 10) / 10)),
    });
  }

  return placed;
}

/**
 * Turns shared positions into everything a static map needs: the zoom level,
 * the raster tiles to fetch and where each member's pin belongs.
 */
export function buildMapViewport(
  points: MapPinInput[],
  options: { width: number; height: number },
): MapViewport {
  const { width, height } = options;
  const usable = points.filter(
    (point) =>
      Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && Math.abs(point.latitude) <= 90
      && Math.abs(point.longitude) <= 180,
  );

  if (usable.length === 0 || width <= 0 || height <= 0) {
    return { zoom: MAP_MIN_ZOOM, width: Math.max(0, width), height: Math.max(0, height), tiles: [], pins: [] };
  }

  const zoom = usable.length === 1 ? SINGLE_POINT_ZOOM : chooseZoom(usable, width, height);
  const bounds = boundsAt(usable, zoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const viewLeft = centerX - width / 2;
  const viewTop = centerY - height / 2;

  const tileCount = 2 ** zoom;
  const firstColumn = Math.floor(viewLeft / MAP_TILE_SIZE);
  const lastColumn = Math.floor((viewLeft + width - 1) / MAP_TILE_SIZE);
  const firstRow = Math.floor(viewTop / MAP_TILE_SIZE);
  const lastRow = Math.floor((viewTop + height - 1) / MAP_TILE_SIZE);

  const tiles: MapTile[] = [];

  for (let row = Math.max(0, firstRow); row <= Math.min(tileCount - 1, lastRow); row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      // Columns wrap around the antimeridian; rows do not.
      const tileX = ((column % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${column}/${row}`,
        url: mapTileUrl(zoom, tileX, row),
        left: Math.round(column * MAP_TILE_SIZE - viewLeft),
        top: Math.round(row * MAP_TILE_SIZE - viewTop),
      });
    }
  }

  const pins = separateOverlaps(
    usable.map((point) => {
      const projected = projectPoint(point, zoom);
      return {
        ...point,
        left: Math.round((projected.x - viewLeft) * 10) / 10,
        top: Math.round((projected.y - viewTop) * 10) / 10,
      };
    }),
    width,
    height,
  );

  return { zoom, width, height, tiles, pins };
}
