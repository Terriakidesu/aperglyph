import { ERD_COLUMN_HEADER_HEIGHT, ERD_HEADER_HEIGHT, entityColumns, entityFieldValue, entityLayoutMetrics, normalizeEntityFields } from '../core/erd';
import { nodeFlipTransform } from '../core/geometry';
import { notationRenderer, shapeSilhouette } from '../core/silhouettes';
import { nodeTextLayout } from '../core/text';
import type { DiagramNode } from '../core/types';
import { pluginManager } from '../plugins';

/**
 * The shared shape graphic used by placed nodes and drag/drop previews.
 * Keeping the silhouette, table rows, labels, and style handling here means a
 * preview cannot drift into a generic rectangle while the final node uses a
 * plugin-specific renderer.
 */
export function NodeGraphic({ node, diagramType, showLabel = true, preview = false }: { node: DiagramNode; diagramType?: string; showLabel?: boolean; preview?: boolean }) {
  const width = node.size.width;
  const height = node.size.height;
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const renderer = shapeRenderer(node, diagramType);
  const commonProps = { fill: node.style.fill, stroke: node.style.stroke, strokeWidth: node.style.strokeWidth, opacity: node.style.opacity };
  const shape = (() => {
    if (renderer === 'image') {
      const source = typeof node.data.src === 'string' && node.data.src.startsWith('data:image/') ? node.data.src : '';
      return <g><rect width={width} height={height} fill={node.style.fill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} opacity={node.style.opacity} />{source && <image href={source} width={width} height={height} preserveAspectRatio="xMidYMid meet" />}{showLabel && <NodeLabel node={node} label={label} width={width} height={height} vertical="bottom" />}</g>;
    }
    const notationShape = notationRenderer(renderer, node, diagramType);
    const silhouette = shapeSilhouette(notationShape, width, height, node.style.radius);
    if (silhouette) {
      return <g>{renderSilhouette(silhouette, commonProps, notationShape === 'arrow-line' ? 'url(#arrow-end)' : undefined)}{notationShape === 'gane-process' && typeof node.data.number === 'string' && <text x={width / 2} y="17" textAnchor="middle" style={{ fill: node.style.textColor, fontSize: 9, fontWeight: 600 }}>{node.data.number}</text>}</g>;
    }
    if (renderer === 'entity') {
      if (preview) return <CompactEntityPreview node={node} />;
      const fields = normalizeEntityFields(node.data.fields);
      const columns = entityColumns(node.data.entityVariant, width);
      const striped = node.data.striped !== false;
      const isWeak = node.data.weak === true;
      const isView = node.data.view === true;
      const showColumnHeaders = node.data.columnHeaders === true;
      const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
      const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
      const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
      const textColor = node.style.textColor;
      const { fieldTop, rowHeight } = entityLayoutMetrics(fields, height, showColumnHeaders);
      return <g opacity={node.style.opacity}>
         <rect width={width} height={height} rx={node.style.radius} fill={rowFill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray={node.data.associative || isView ? '5 3' : undefined} />
         {isWeak && <rect x="4" y="4" width={Math.max(0, width - 8)} height={Math.max(0, height - 8)} rx={Math.max(0, node.style.radius - 2)} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} />}
        <rect width={width} height={ERD_HEADER_HEIGHT} rx={node.style.radius} fill={headerFill} />
        <line x1="0" y1={ERD_HEADER_HEIGHT} x2={width} y2={ERD_HEADER_HEIGHT} stroke={node.style.stroke} strokeWidth="1" />
        {showColumnHeaders && <g className="entity-column-headers"><rect y={ERD_HEADER_HEIGHT} width={width} height={ERD_COLUMN_HEADER_HEIGHT} fill={headerFill} opacity="0.42" /><line x1="0" y1={fieldTop} x2={width} y2={fieldTop} stroke={node.style.stroke} strokeOpacity="0.55" />{columns.map((column) => <text key={column.id} className="node-field-column-header" x={column.id === 'key' ? column.x + column.width / 2 : column.x + 7} y={ERD_HEADER_HEIGHT + 15} textAnchor={column.id === 'key' ? 'middle' : undefined}>{column.label}</text>)}</g>}
        {fields.map((field, index) => { const y = fieldTop + index * rowHeight; const baseline = y + rowHeight / 2 + 4; return <g key={field.id}><rect x="0" y={y} width={width} height={rowHeight} fill={striped && index % 2 === 1 ? stripeFill : rowFill} /><line x1="0" y1={y + rowHeight} x2={width} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.34" />{columns.slice(0, -1).map((column) => <line key={`divider-${column.id}`} x1={column.x + column.width} y1={y} x2={column.x + column.width} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.45" />)}{columns.map((column) => { const value = entityFieldValue(field, column.id); if (!value) return null; const isKey = column.id === 'key'; return <text key={column.id} className={isKey ? 'node-field-key' : column.id === 'field' ? 'node-field-name' : 'node-field-type'} style={{ fill: textColor, textDecoration: column.id === 'field' && field.primaryKey ? 'underline' : undefined, fontStyle: column.id === 'field' && field.foreignKey ? 'italic' : undefined }} x={isKey ? column.x + column.width / 2 : column.x + 7} y={baseline} textAnchor={isKey ? 'middle' : undefined}>{value}</text>; })}</g>; })}
         {showLabel && <text className="node-entity-title" style={{ fill: node.style.textColor === '#f4f5fa' ? '#ffffff' : textColor, fontSize: node.style.fontSize, fontWeight: node.style.fontWeight }} x={width / 2} y="23" textAnchor="middle">{label}</text>}
      </g>;
    }
    if (renderer === 'boundary') return <g><rect width={width} height={height} rx={node.style.radius} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray="7 5" opacity={node.style.opacity} />{showLabel && <NodeLabel node={node} label={label} width={width} height={height} className="boundary-label" align="left" vertical="top" padding={18} fontFamily="var(--mono)" />}</g>;
    const radius = renderer === 'rounded-rectangle' || renderer === 'start' || renderer === 'use-case' ? Math.min(node.style.radius || 22, height / 2) : node.style.radius;
    return <rect width={width} height={height} rx={radius} {...commonProps} />;
  })();
  const labelNode = showLabel && !['entity', 'actor', 'boundary', 'line', 'arrow-line'].includes(renderer)
    ? <NodeLabel node={node} label={label} width={width} height={height} align={['package', 'folded-note', 'system-boundary'].includes(renderer) ? 'left' : undefined} vertical={['package', 'folded-note', 'system-boundary'].includes(renderer) ? 'top' : undefined} padding={['package', 'folded-note', 'system-boundary'].includes(renderer) ? 14 : undefined} className={`node-label ${renderer === 'start' || renderer === 'use-case' ? 'node-label-strong' : ''}`} />
    : showLabel && renderer === 'actor' ? <NodeLabel node={node} label={label} width={width} height={height} vertical="bottom" /> : null;
  const flipTransform = nodeFlipTransform(node);
  const content = <>{shape}{labelNode}</>;
  return flipTransform ? <g transform={flipTransform}>{content}</g> : content;
}

/**
 * A table still needs to read as a table at stencil scale, but its real field
 * labels cannot fit in a 24px palette slot. The outer frame and header use the
 * same entity geometry and colors as the full renderer; only the field content
 * is reduced to a couple of structural rules.
 */
function CompactEntityPreview({ node }: { node: DiagramNode }) {
  const width = node.size.width;
  const height = node.size.height;
  const headerHeight = Math.max(5, Math.min(height * .36, ERD_HEADER_HEIGHT));
  const bodyTop = headerHeight;
  const bodyHeight = Math.max(0, height - bodyTop);
  const keyDivider = Math.min(width * .2, 8);
  const rowDivider = bodyTop + bodyHeight / 2;
  const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
  const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
  const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
  const isView = node.data.view === true;
  const isAssociative = node.data.associative === true;
  const isWeak = node.data.weak === true;
  const strokeDasharray = isAssociative || isView ? '5 3' : undefined;
  return <g opacity={node.style.opacity}>
    <rect width={width} height={height} rx={node.style.radius} fill={rowFill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray={strokeDasharray} />
    {isWeak && <rect x={Math.min(2, width / 8)} y={Math.min(2, height / 8)} width={Math.max(0, width - Math.min(4, width / 4))} height={Math.max(0, height - Math.min(4, height / 4))} rx={Math.max(0, node.style.radius - 1)} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} />}
    <rect width={width} height={headerHeight} rx={node.style.radius} fill={headerFill} />
    <line x1="0" y1={headerHeight} x2={width} y2={headerHeight} stroke={node.style.stroke} strokeWidth="1" />
    {bodyHeight > 0 && <>
      <rect x="0" y={rowDivider} width={width} height={Math.max(0, height - rowDivider)} fill={stripeFill} opacity="0.72" />
      <line x1="0" y1={rowDivider} x2={width} y2={rowDivider} stroke={node.style.stroke} strokeOpacity="0.45" />
      {keyDivider > 0 && <line x1={keyDivider} y1={bodyTop} x2={keyDivider} y2={height} stroke={node.style.stroke} strokeOpacity="0.45" />}
    </>}
  </g>;
}

function renderSilhouette(silhouette: ReturnType<typeof shapeSilhouette>, commonProps: { fill: string; stroke: string; strokeWidth: number; opacity: number }, markerEnd?: string) {
  if (!silhouette) return null;
  return silhouette.parts.map((part, index) => {
    if (part.kind === 'rect') return <rect key={index} x={part.x} y={part.y} width={part.width} height={part.height} rx={part.radius ?? 0} {...commonProps} />;
    if (part.kind === 'ellipse') return <ellipse key={index} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} {...commonProps} />;
    if (part.kind === 'polygon') return <polygon key={index} points={part.points.map((point) => `${point.x},${point.y}`).join(' ')} {...commonProps} />;
    if (part.kind === 'line') return <line key={index} x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} fill="none" stroke={commonProps.stroke} strokeWidth={commonProps.strokeWidth} opacity={commonProps.opacity} markerEnd={markerEnd} />;
    return <path key={index} d={part.d} fillRule={part.fillRule} {...commonProps} />;
  });
}

export function NodeLabel({ node, label, width, height, className = 'node-label', align, vertical, padding, fontFamily }: { node: DiagramNode; label: string; width: number; height: number; className?: string; align?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; padding?: number; fontFamily?: string }) {
  const layout = nodeTextLayout(label, node.style, width, height, { align, vertical, padding });
  return <text className={className} x={layout.x} y={layout.firstBaseline} textAnchor={layout.textAnchor} style={{ fill: node.style.textColor, fontSize: node.style.fontSize, fontWeight: node.style.fontWeight, fontFamily, opacity: node.style.opacity }} pointerEvents="none">{layout.lines.length === 1 ? layout.lines[0] : layout.lines.map((line, index) => <tspan key={`${line}-${index}`} x={layout.x} dy={index === 0 ? 0 : layout.lineHeight}>{line}</tspan>)}</text>;
}

function shapeRenderer(node: DiagramNode, diagramType?: string): string {
  const renderer = pluginManager.getShape(node.library, node.type)?.renderer
    ?? (diagramType === 'dfd' && node.type === 'process' ? 'ellipse' : node.type);
  return notationRenderer(renderer, node, diagramType);
}
