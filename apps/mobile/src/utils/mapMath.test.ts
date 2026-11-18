import {
  MAP_MIN_ZOOM,
  buildMapViewport,
  mapTileUrl,
  projectPoint,
  type MapPinInput,
} from './mapMath';

const TRICHY = { latitude: 10.7905, longitude: 78.7047 };
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };

function pin(overrides: Partial<MapPinInput> & Pick<MapPinInput, 'id'>): MapPinInput {
  return {
    latitude: TRICHY.latitude,
    longitude: TRICHY.longitude,
    label: 'A',
    isSelf: false,
    ...overrides,
  };
}

describe('projectPoint', () => {
  it('maps the origin to the middle of the world at zoom 1', () => {
    expect(projectPoint({ latitude: 0, longitude: 0 }, 1)).toEqual({ x: 256, y: 256 });
  });

  it('grows with the zoom level', () => {
    const near = projectPoint(TRICHY, 5);
    const far = projectPoint(TRICHY, 10);
    expect(far.x).toBeGreaterThan(near.x);
    expect(far.y).toBeGreaterThan(near.y);
  });
});

describe('mapTileUrl', () => {
  it('points at the OpenStreetMap tile server', () => {
    expect(mapTileUrl(12, 2916, 1873)).toBe('https://tile.openstreetmap.org/12/2916/1873.png');
  });
});

describe('buildMapViewport', () => {
  it('returns nothing for an empty member list', () => {
    const viewport = buildMapViewport([], { width: 320, height: 240 });
    expect(viewport.tiles).toEqual([]);
    expect(viewport.pins).toEqual([]);
  });

  it('centres a single member at street zoom', () => {
    const viewport = buildMapViewport([pin({ id: 'me', isSelf: true })], { width: 320, height: 240 });
    const [me] = viewport.pins;

    expect(viewport.zoom).toBe(15);
    expect(Math.abs(me.left - 160)).toBeLessThan(1);
    expect(Math.abs(me.top - 120)).toBeLessThan(1);
    expect(viewport.tiles.length).toBeGreaterThan(0);
  });

  it('keeps two distant members on screen', () => {
    const viewport = buildMapViewport(
      [pin({ id: 'a' }), pin({ id: 'b', latitude: CHENNAI.latitude, longitude: CHENNAI.longitude })],
      { width: 320, height: 240 },
    );

    expect(viewport.zoom).toBeLessThan(17);
    for (const member of viewport.pins) {
      expect(member.left).toBeGreaterThanOrEqual(0);
      expect(member.left).toBeLessThanOrEqual(320);
      expect(member.top).toBeGreaterThanOrEqual(0);
      expect(member.top).toBeLessThanOrEqual(240);
    }
  });

  it('fans out members standing on the same spot', () => {
    const viewport = buildMapViewport(
      [pin({ id: 'a' }), pin({ id: 'b' }), pin({ id: 'c' })],
      { width: 320, height: 240 },
    );

    const positions = new Set(viewport.pins.map((member) => `${member.left}:${member.top}`));
    expect(positions.size).toBe(3);
  });

  it('loads only tiles that touch the viewport', () => {
    const viewport = buildMapViewport([pin({ id: 'a' })], { width: 320, height: 240 });

    // A 320x240 window can never need more than 3x3 tiles.
    expect(viewport.tiles.length).toBeLessThanOrEqual(9);
    for (const tile of viewport.tiles) {
      expect(tile.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
      expect(tile.left).toBeGreaterThan(-256);
      expect(tile.left).toBeLessThan(320);
      expect(tile.top).toBeGreaterThan(-256);
      expect(tile.top).toBeLessThan(240);
    }
  });

  it('stays at the minimum zoom when members are spread worldwide', () => {
    const viewport = buildMapViewport(
      [
        pin({ id: 'a' }),
        pin({ id: 'b', latitude: 51.5072, longitude: -0.1276 }),
        pin({ id: 'c', latitude: -33.8688, longitude: 151.2093 }),
      ],
      { width: 320, height: 240 },
    );

    expect(viewport.zoom).toBe(MAP_MIN_ZOOM);
  });

  it('ignores coordinates that are not usable', () => {
    const viewport = buildMapViewport(
      [pin({ id: 'a' }), pin({ id: 'bad', latitude: Number.NaN, longitude: 12 })],
      { width: 320, height: 240 },
    );

    expect(viewport.pins.map((member) => member.id)).toEqual(['a']);
  });
});
