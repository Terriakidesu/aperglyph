import { ERD_COLUMN_HEADER_HEIGHT, ERD_HEADER_HEIGHT, entityColumns, entityFieldValue, entityLayoutMetrics, normalizeEntityFields } from '../core/erd';
import { nodeTextLayout } from '../core/text';
import type { DiagramNode } from '../core/types';
import { pluginManager } from '../plugins';

/**
 * The shared shape graphic used by placed nodes and drag/drop previews.
 * Keeping the silhouette, table rows, labels, and style handling here means a
 * preview cannot drift into a generic rectangle while the final node uses a
 * plugin-specific renderer.
 */
export function NodeGraphic({ node, diagramType }: { node: DiagramNode; diagramType?: string }) {
  const width = node.size.width;
  const height = node.size.height;
  const label = typeof node.data.label === 'string' ? node.data.label : node.type;
  const renderer = shapeRenderer(node, diagramType);
  const commonProps = { fill: node.style.fill, stroke: node.style.stroke, strokeWidth: node.style.strokeWidth, opacity: node.style.opacity };
  const shape = (() => {
    if (renderer === 'image') {
      const source = typeof node.data.src === 'string' && node.data.src.startsWith('data:image/') ? node.data.src : '';
      return <g><rect width={width} height={height} fill={node.style.fill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} opacity={node.style.opacity} />{source && <image href={source} width={width} height={height} preserveAspectRatio="xMidYMid meet" />}<NodeLabel node={node} label={label} width={width} height={height} vertical="bottom" /></g>;
    }
    if (renderer === 'diamond' || renderer === 'decision') {
      const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
      return <polygon points={points} {...commonProps} />;
    }
    if (renderer === 'ellipse' || renderer === 'circle' || renderer === 'use-case') return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...commonProps} />;
    if (renderer === 'line') return <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} opacity={node.style.opacity} markerEnd="url(#arrow-end)" />;
    if (renderer === 'actor') return <g><circle cx={width / 2} cy={28} r={16} {...commonProps} /><path d={`M${width / 2} 44 L${width / 2} 91 M${width / 2 - 25} 60 L${width / 2 + 25} 60 M${width / 2} 91 L${width / 2 - 21} 124 M${width / 2} 91 L${width / 2 + 21} 124`} fill="none" stroke={node.style.stroke} strokeWidth="3" strokeLinecap="round" /></g>;
    if (renderer === 'database') return <path d={`M 0 ${height * .18} C 0 0 ${width} 0 ${width} ${height * .18} L ${width} ${height * .8} C ${width} ${height + height * .02} 0 ${height + height * .02} 0 ${height * .8} Z M 0 ${height * .18} C 0 ${height * .36} ${width} ${height * .36} ${width} ${height * .18}`} {...commonProps} />;
    if (renderer === 'stored-data') return <path d={`M 12 0 H ${width - 12} Q ${width} 0 ${width} 12 V ${height - 12} Q ${width} ${height} ${width - 12} ${height} H 12 Q 0 ${height} 0 ${height - 12} V 12 Q 0 0 12 0 Z`} {...commonProps} />;
    if (renderer === 'document') return <path d={`M 0 0 H ${width} V ${height - 16} Q ${width * .75} ${height} ${width * .5} ${height - 16} Q ${width * .25} ${height - 32} 0 ${height - 16} Z`} {...commonProps} />;
    if (renderer === 'manual-input') return <polygon points={`18,0 ${width},0 ${width - 18},${height} 0,${height}`} {...commonProps} />;
    if (renderer === 'preparation') return <polygon points={`24,0 ${width - 24},0 ${width},${height / 2} ${width - 24},${height} 24,${height} 0,${height / 2}`} {...commonProps} />;
    if (renderer === 'predefined-process') return <g><rect width={width} height={height} {...commonProps} /><line x1="16" y1="0" x2="16" y2={height} stroke={node.style.stroke} /><line x1={width - 16} y1="0" x2={width - 16} y2={height} stroke={node.style.stroke} /></g>;
    if (renderer === 'delay') return <path d={`M 0 0 H ${width - 28} A 28 ${height / 2} 0 0 1 ${width - 28} ${height} H 0 Z`} {...commonProps} />;
    if (renderer === 'display') return <path d={`M 0 0 H ${width - 28} Q ${width} ${height / 2} ${width - 28} ${height} H 0 Q 28 ${height / 2} 0 0 Z`} {...commonProps} />;
    if (renderer === 'off-page-connector') return <polygon points={`0,0 ${width},0 ${width},${height * .68} ${width / 2},${height} 0,${height * .68}`} {...commonProps} />;
    if (renderer === 'entity') {
      const fields = normalizeEntityFields(node.data.fields);
      const columns = entityColumns(node.data.entityVariant, width);
      const striped = node.data.striped !== false;
      const showColumnHeaders = node.data.columnHeaders === true;
      const rowFill = typeof node.data.rowFill === 'string' ? node.data.rowFill : node.style.fill;
      const stripeFill = typeof node.data.stripeFill === 'string' ? node.data.stripeFill : rowFill === '#f2f3f7' ? '#e3e5e9' : '#252c3c';
      const headerFill = typeof node.data.headerFill === 'string' ? node.data.headerFill : node.style.stroke;
      const textColor = node.style.textColor;
      const { fieldTop, rowHeight } = entityLayoutMetrics(fields, height, showColumnHeaders);
      return <g opacity={node.style.opacity}>
        <rect width={width} height={height} rx={node.style.radius} fill={rowFill} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray={node.data.associative ? '5 3' : undefined} />
        <rect width={width} height={ERD_HEADER_HEIGHT} rx={node.style.radius} fill={headerFill} />
        <line x1="0" y1={ERD_HEADER_HEIGHT} x2={width} y2={ERD_HEADER_HEIGHT} stroke={node.style.stroke} strokeWidth="1" />
        {showColumnHeaders && <g className="entity-column-headers"><rect y={ERD_HEADER_HEIGHT} width={width} height={ERD_COLUMN_HEADER_HEIGHT} fill={headerFill} opacity="0.42" /><line x1="0" y1={fieldTop} x2={width} y2={fieldTop} stroke={node.style.stroke} strokeOpacity="0.55" />{columns.map((column) => <text key={column.id} className="node-field-column-header" x={column.id === 'key' ? column.x + column.width / 2 : column.x + 7} y={ERD_HEADER_HEIGHT + 15} textAnchor={column.id === 'key' ? 'middle' : undefined}>{column.label}</text>)}</g>}
        {fields.map((field, index) => { const y = fieldTop + index * rowHeight; const baseline = y + rowHeight / 2 + 4; return <g key={field.id}><rect x="0" y={y} width={width} height={rowHeight} fill={striped && index % 2 === 1 ? stripeFill : rowFill} /><line x1="0" y1={y + rowHeight} x2={width} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.34" />{columns.slice(0, -1).map((column) => <line key={`divider-${column.id}`} x1={column.x + column.width} y1={y} x2={column.x + column.width} y2={y + rowHeight} stroke={node.style.stroke} strokeOpacity="0.45" />)}{columns.map((column) => { const value = entityFieldValue(field, column.id); if (!value) return null; const isKey = column.id === 'key'; return <text key={column.id} className={isKey ? 'node-field-key' : column.id === 'field' ? 'node-field-name' : 'node-field-type'} style={{ fill: textColor, textDecoration: column.id === 'field' && field.primaryKey ? 'underline' : undefined, fontStyle: column.id === 'field' && field.foreignKey ? 'italic' : undefined }} x={isKey ? column.x + column.width / 2 : column.x + 7} y={baseline} textAnchor={isKey ? 'middle' : undefined}>{value}</text>; })}</g>; })}
        <text className="node-entity-title" style={{ fill: node.style.textColor === '#f4f5fa' ? '#ffffff' : textColor, fontSize: node.style.fontSize, fontWeight: node.style.fontWeight }} x={width / 2} y="23" textAnchor="middle">{label}</text>
      </g>;
    }
    if (renderer === 'dfd-store' || (diagramType === 'dfd' && renderer === 'store')) return <g><line x1="0" y1="10" x2={width} y2="10" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} opacity={node.style.opacity} /><line x1="0" y1={height - 10} x2={width} y2={height - 10} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} opacity={node.style.opacity} /><NodeLabel node={node} label={label} width={width} height={height} /></g>;
    if (renderer === 'store') return <g><rect width={width} height={height} rx="4" {...commonProps} /><line x1="0" y1="12" x2={width} y2="12" stroke={node.style.stroke} opacity="0.5" /><NodeLabel node={node} label={label} width={width} height={height} /></g>;
    if (renderer === 'boundary') return <g><rect width={width} height={height} rx={node.style.radius} fill="none" stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} strokeDasharray="7 5" opacity={node.style.opacity} /><NodeLabel node={node} label={label} width={width} height={height} className="boundary-label" align="left" vertical="top" padding={18} fontFamily="var(--mono)" /></g>;
    const radius = renderer === 'rounded-rectangle' || renderer === 'start' || renderer === 'use-case' ? Math.min(node.style.radius || 22, height / 2) : node.style.radius;
    return <rect width={width} height={height} rx={radius} {...commonProps} />;
  })();
  const labelNode = !['entity', 'actor', 'store', 'dfd-store', 'boundary', 'line'].includes(renderer)
    ? <NodeLabel node={node} label={label} width={width} height={height} className={`node-label ${renderer === 'start' || renderer === 'use-case' ? 'node-label-strong' : ''}`} />
    : renderer === 'actor' ? <NodeLabel node={node} label={label} width={width} height={height} vertical="bottom" /> : null;
  return <>{shape}{labelNode}</>;
}

export function NodeLabel({ node, label, width, height, className = 'node-label', align, vertical, padding, fontFamily }: { node: DiagramNode; label: string; width: number; height: number; className?: string; align?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; padding?: number; fontFamily?: string }) {
  const layout = nodeTextLayout(label, node.style, width, height, { align, vertical, padding });
  return <text className={className} x={layout.x} y={layout.firstBaseline} textAnchor={layout.textAnchor} style={{ fill: node.style.textColor, fontSize: node.style.fontSize, fontWeight: node.style.fontWeight, fontFamily, opacity: node.style.opacity }} pointerEvents="none">{layout.lines.length === 1 ? layout.lines[0] : layout.lines.map((line, index) => <tspan key={`${line}-${index}`} x={layout.x} dy={index === 0 ? 0 : layout.lineHeight}>{line}</tspan>)}</text>;
}

function shapeRenderer(node: DiagramNode, diagramType?: string): string {
  return pluginManager.getShape(node.library, node.type)?.renderer
    ?? (diagramType === 'dfd' && node.type === 'process' ? 'ellipse' : node.type);
}
