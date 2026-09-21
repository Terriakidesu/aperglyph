import type { ShapeDefinition } from '../plugins/types';
import type { NodeStyle, ShapeBoundary, Size } from './types';

export const SHAPE_DRAG_MIME = 'application/x-aperglyph-shape';

export interface ShapeDropPayload {
  libraryId: string;
  type: string;
  label: string;
  defaultSize?: Size;
  defaultStyle?: Partial<NodeStyle>;
  defaultData?: Record<string, unknown>;
  boundary?: ShapeBoundary;
  container?: boolean;
}

export function serializeShapeDrop(libraryId: string, shape: ShapeDefinition): string {
  const payload: ShapeDropPayload = {
    libraryId,
    type: shape.type,
    label: shape.label,
    defaultSize: shape.defaultSize,
    defaultStyle: shape.defaultStyle,
    defaultData: shape.defaultData,
    boundary: shape.boundary,
    container: shape.container,
  };
  return JSON.stringify(payload);
}

export function parseShapeDrop(dataTransfer: Pick<DataTransfer, 'getData'>): ShapeDropPayload | null {
  const raw = dataTransfer.getData(SHAPE_DRAG_MIME) || dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ShapeDropPayload>;
    if (!isRecord(value) || typeof value.libraryId !== 'string' || typeof value.type !== 'string' || typeof value.label !== 'string') return null;
    return {
      libraryId: value.libraryId.slice(0, 128),
      type: value.type.slice(0, 128),
      label: value.label.slice(0, 256),
      defaultSize: isSize(value.defaultSize) ? value.defaultSize : undefined,
      defaultStyle: isRecord(value.defaultStyle) ? value.defaultStyle as Partial<NodeStyle> : undefined,
      defaultData: isRecord(value.defaultData) ? value.defaultData : undefined,
      boundary: isBoundary(value.boundary) ? value.boundary : undefined,
      container: value.container === true,
    };
  } catch {
    return null;
  }
}

function isBoundary(value: unknown): value is ShapeBoundary {
  return value === 'rectangle' || value === 'ellipse' || value === 'diamond';
}

function isSize(value: unknown): value is Size {
  return isRecord(value)
    && typeof value.width === 'number'
    && Number.isFinite(value.width)
    && value.width > 0
    && typeof value.height === 'number'
    && Number.isFinite(value.height)
    && value.height > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
