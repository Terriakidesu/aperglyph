import type { Point, RouteConstraint } from './types';

type WasmOrthogonalRoute = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacles: Float64Array,
  otherRoutes: Float64Array,
  previousRoute: Float64Array,
  simpleRouting: boolean,
  laneIndex: number,
  laneCount: number,
  laneSpacing: number,
  softConstraints: Float64Array,
  markerObstacles: Float64Array,
) => Float64Array;

interface WasmRoutingModule {
  default: () => Promise<unknown>;
  route_orthogonal: WasmOrthogonalRoute;
}

interface RoutingOptions {
  otherRoutes?: ReadonlyArray<Point[]>;
  previousRoute?: Point[];
  lane?: { index: number; count: number; spacing?: number };
  constraints?: RouteConstraint[];
  simpleRouting?: boolean;
  markerObstacles?: ReadonlyArray<{ edgeId: string; bounds: { left: number; top: number; right: number; bottom: number } }>;
}

let wasmRoute: WasmOrthogonalRoute | null = null;
let initialization: Promise<void> | null = null;

/** Load the routing accelerator before the canvas performs its first render. */
export function initializeRoutingWasm(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (typeof window === 'undefined') return;
    try {
      const moduleUrl = new URL(`${import.meta.env.BASE_URL}wasm/aperglyph_diagram_engine.js`, window.location.href).href;
      const module = await import(/* @vite-ignore */ moduleUrl) as unknown as WasmRoutingModule;
      await module.default();
      wasmRoute = typeof module.route_orthogonal === 'function' ? module.route_orthogonal : null;
    } catch {
      // Preserve the TypeScript search as the compatibility path if WebAssembly
      // is unavailable, disabled, or blocked by the host environment.
      wasmRoute = null;
    }
  })();
  return initialization;
}

export function routeOrthogonalWithWasm(
  start: Point,
  end: Point,
  obstacles: ReadonlyArray<{ left: number; top: number; right: number; bottom: number }>,
  options: RoutingOptions,
): Point[] | null {
  if (!wasmRoute) return null;
  const packedObstacles = new Float64Array(obstacles.length * 4);
  obstacles.forEach((rect, index) => {
    const offset = index * 4;
    packedObstacles[offset] = rect.left;
    packedObstacles[offset + 1] = rect.top;
    packedObstacles[offset + 2] = rect.right;
    packedObstacles[offset + 3] = rect.bottom;
  });
  const packedRoutes = packRouteSegments(options.otherRoutes ?? []);
  const packedPrevious = packRouteSegments(options.previousRoute ? [options.previousRoute] : []);
  const softConstraints = (options.constraints ?? []).filter((constraint) => constraint.strength === 'soft');
  const packedConstraints = new Float64Array(softConstraints.length * 2);
  softConstraints.forEach((constraint, index) => {
    packedConstraints[index * 2] = constraint.axis === 'x' ? 0 : 1;
    packedConstraints[index * 2 + 1] = constraint.value;
  });
  const packedMarkerObstacles = new Float64Array((options.markerObstacles ?? []).length * 4);
  (options.markerObstacles ?? []).forEach((marker, index) => {
    const offset = index * 4;
    packedMarkerObstacles[offset] = marker.bounds.left;
    packedMarkerObstacles[offset + 1] = marker.bounds.top;
    packedMarkerObstacles[offset + 2] = marker.bounds.right;
    packedMarkerObstacles[offset + 3] = marker.bounds.bottom;
  });
  const lane = options.lane;
  let packed: Float64Array;
  try {
    packed = wasmRoute(
      start.x,
      start.y,
      end.x,
      end.y,
      packedObstacles,
      packedRoutes,
      packedPrevious,
      options.simpleRouting === true,
      lane?.index ?? -1,
      lane?.count ?? 0,
      lane?.spacing ?? 16,
      packedConstraints,
      packedMarkerObstacles,
    );
  } catch {
    return null;
  }
  if (packed.length < 4 || packed.length % 2 !== 0) return null;
  const points: Point[] = [];
  for (let index = 0; index < packed.length; index += 2) {
    points.push({ x: packed[index], y: packed[index + 1] });
  }
  return points;
}

function packRouteSegments(routes: ReadonlyArray<Point[]>): Float64Array {
  const segments: number[] = [];
  routes.forEach((route) => {
    for (let index = 0; index < route.length - 1; index += 1) {
      segments.push(route[index].x, route[index].y, route[index + 1].x, route[index + 1].y);
    }
  });
  return new Float64Array(segments);
}
