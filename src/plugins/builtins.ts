import { validateDfd } from '../core/dfd';
import { entityFieldAnchors } from '../core/anchors';
import { validateErd } from '../core/erd';
import { validateUseCase } from '../core/useCase';
import { validateFlowchart } from '../core/flowchart';
import type { DiagramDocument } from '../core/types';
import type { DiagramPlugin } from './types';

const straight = { id: 'straight', label: 'Straight connector', routing: 'straight' as const };
const orthogonal = { id: 'orthogonal', label: 'Orthogonal connector', routing: 'orthogonal' as const };

const dfdNotationOptions = [
  { value: 'yourdon-demarco', label: 'Yourdon / DeMarco' },
  { value: 'gane-sarson', label: 'Gane / Sarson' },
];

export const generalPlugin: DiagramPlugin = {
  id: 'general', name: 'General', description: 'Flexible primitives for any visual idea.',
  shapes: [
    { id: 'rectangle', type: 'rectangle', label: 'Rectangle', icon: 'square', category: 'Basic', aliases: ['box', 'square'], renderer: 'rectangle' },
    { id: 'rounded-rectangle', type: 'rounded-rectangle', label: 'Rounded rectangle', icon: 'rounded-rectangle', category: 'Basic', aliases: ['rounded box', 'pill'], renderer: 'rounded-rectangle' },
    { id: 'circle', type: 'circle', label: 'Circle', icon: 'circle', category: 'Basic', aliases: ['round'], defaultSize: { width: 112, height: 112 }, renderer: 'ellipse', boundary: 'ellipse' },
    { id: 'ellipse', type: 'ellipse', label: 'Ellipse', icon: 'circle', category: 'Basic', aliases: ['oval', 'round rectangle'], defaultSize: { width: 160, height: 100 }, renderer: 'ellipse', boundary: 'ellipse' },
    { id: 'diamond', type: 'diamond', label: 'Diamond', icon: 'diamond', category: 'Basic', aliases: ['rhombus'], defaultSize: { width: 160, height: 110 }, renderer: 'diamond', boundary: 'diamond' },
    { id: 'triangle', type: 'triangle', label: 'Triangle', icon: 'triangle', category: 'Basic', aliases: ['arrowhead'], defaultSize: { width: 150, height: 120 }, renderer: 'triangle' },
    { id: 'hexagon', type: 'hexagon', label: 'Hexagon', icon: 'hexagon', category: 'Basic', aliases: ['six-sided'], defaultSize: { width: 170, height: 100 }, renderer: 'hexagon' },
    { id: 'parallelogram', type: 'parallelogram', label: 'Parallelogram', icon: 'workflow', category: 'Basic', aliases: ['slanted box', 'data'], defaultSize: { width: 180, height: 88 }, renderer: 'parallelogram' },
    { id: 'trapezoid', type: 'trapezoid', label: 'Trapezoid', icon: 'workflow', category: 'Basic', aliases: ['trapezium'], defaultSize: { width: 180, height: 88 }, renderer: 'trapezoid' },
    { id: 'pentagon', type: 'pentagon', label: 'Pentagon', icon: 'pentagon', category: 'Basic', aliases: ['five-sided'], defaultSize: { width: 160, height: 110 }, renderer: 'pentagon' },
    { id: 'cylinder', type: 'cylinder', label: 'Cylinder', icon: 'database', category: 'Data', semanticRole: 'storage', aliases: ['database', 'data store'], defaultSize: { width: 170, height: 100 }, renderer: 'cylinder' },
    { id: 'cloud', type: 'cloud', label: 'Cloud', icon: 'cloud', category: 'Basic', aliases: ['network', 'internet'], defaultSize: { width: 190, height: 110 }, renderer: 'cloud' },
    { id: 'document', type: 'document', label: 'Document', icon: 'text', category: 'Data', aliases: ['file', 'paper'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Document' }, renderer: 'document' },
    { id: 'image', type: 'image', label: 'Image', icon: 'text', category: 'Media', aliases: ['picture', 'photo'], defaultSize: { width: 220, height: 150 }, defaultData: { label: 'Image' }, renderer: 'image' },
    { id: 'text', type: 'text', label: 'Text', icon: 'text', category: 'Annotations', aliases: ['label', 'title'], defaultSize: { width: 190, height: 56 }, defaultStyle: { fill: 'transparent', stroke: 'transparent', radius: 0, textAlign: 'left', autoHeight: true }, defaultData: { label: 'Text label' }, renderer: 'rectangle' },
    { id: 'line', type: 'line', label: 'Line', icon: 'line', category: 'Connectors', aliases: ['connector', 'edge'], defaultSize: { width: 190, height: 32 }, defaultStyle: { fill: 'transparent' }, renderer: 'line' },
    { id: 'arrow-line', type: 'arrow-line', label: 'Arrow line', icon: 'arrow', category: 'Connectors', aliases: ['arrow', 'directed line'], defaultSize: { width: 190, height: 32 }, defaultStyle: { fill: 'transparent' }, renderer: 'arrow-line' },
    { id: 'frame', type: 'frame', label: 'Frame', icon: 'square', category: 'Containers', aliases: ['boundary', 'container'], defaultSize: { width: 320, height: 220 }, defaultStyle: { fill: 'transparent', stroke: '#7d86a2', radius: 14, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Frame' }, renderer: 'boundary', container: true, tags: ['container', 'section', 'boundary'] },
    { id: 'section', type: 'section', label: 'Section', icon: 'square', category: 'Containers', aliases: ['group', 'header'], defaultSize: { width: 360, height: 180 }, defaultStyle: { fill: 'transparent', stroke: '#5d6f91', radius: 8, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Section' }, renderer: 'boundary', container: true, tags: ['container', 'header'] },
    { id: 'note', type: 'note', label: 'Note', icon: 'text', category: 'Annotations', aliases: ['annotation', 'comment'], defaultSize: { width: 190, height: 110 }, defaultStyle: { fill: '#40385f', stroke: '#b0a2ff', radius: 6, textAlign: 'left', verticalAlign: 'top', textColor: '#f4f5fa' }, defaultData: { label: 'Note' }, renderer: 'rounded-rectangle', tags: ['annotation', 'callout'] },
    { id: 'sticky-note', type: 'sticky-note', label: 'Sticky note', icon: 'text', category: 'Annotations', aliases: ['post-it', 'annotation'], defaultSize: { width: 170, height: 150 }, defaultStyle: { fill: '#5a4a2f', stroke: '#e7ba70', radius: 3, textAlign: 'left', verticalAlign: 'top', textColor: '#fff4d7' }, defaultData: { label: 'Sticky note' }, renderer: 'rectangle', tags: ['annotation', 'note'] },
    { id: 'callout', type: 'callout', label: 'Callout', icon: 'workflow', category: 'Annotations', aliases: ['speech bubble', 'annotation'], defaultSize: { width: 220, height: 110 }, defaultStyle: { fill: '#24354e', stroke: '#78b6ed', radius: 12, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Callout' }, renderer: 'callout', tags: ['annotation', 'note'] },
    { id: 'table', type: 'table', label: 'Table', icon: 'table', category: 'Data', semanticRole: 'table', aliases: ['grid', 'data table'], defaultSize: { width: 260, height: 150 }, defaultStyle: { fill: '#202a3b', stroke: '#7b8ba8', radius: 4 }, defaultData: { label: 'Table' }, renderer: 'rectangle', container: true, tags: ['container', 'data'] },
  ],
  connectors: [straight, { id: 'curved', label: 'Curved connector', routing: 'curved' }, orthogonal],
  validators: [],
};

export const flowchartPlugin: DiagramPlugin = {
  id: 'flowchart', name: 'Flowchart', description: 'Map processes, decisions, and outcomes.',
  shapes: [
    { id: 'start', type: 'start', label: 'Start / end', icon: 'circle', category: 'Basic', semanticRole: 'terminator', aliases: ['terminator', 'start', 'end'], defaultSize: { width: 160, height: 64 }, defaultStyle: { fill: '#15362f', stroke: '#43d6a6', radius: 32 }, renderer: 'start' },
    { id: 'process', type: 'process', label: 'Process', icon: 'square', category: 'Basic', semanticRole: 'process', aliases: ['step', 'operation'], defaultData: { label: 'Process' }, renderer: 'rectangle' },
    { id: 'decision', type: 'decision', label: 'Decision', icon: 'diamond', category: 'Basic', semanticRole: 'decision', aliases: ['branch', 'condition', 'if'], defaultSize: { width: 160, height: 112 }, defaultStyle: { fill: '#302a4c', stroke: '#9c86ff' }, defaultData: { label: 'Decision?' }, renderer: 'diamond', boundary: 'diamond' },
    { id: 'input', type: 'input', label: 'Input / output', icon: 'workflow', category: 'Basic', semanticRole: 'io', aliases: ['input', 'output', 'data', 'parallelogram'], defaultStyle: { fill: '#1f2e43', stroke: '#76b8ff' }, renderer: 'parallelogram' },
    { id: 'document', type: 'document', label: 'Document', icon: 'text', category: 'Data', semanticRole: 'document', aliases: ['file', 'report'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Document' }, renderer: 'document' },
    { id: 'multiple-document', type: 'multiple-document', label: 'Multiple documents', icon: 'text', category: 'Data', semanticRole: 'document', aliases: ['documents', 'stacked documents', 'reports'], defaultSize: { width: 190, height: 90 }, defaultData: { label: 'Documents' }, renderer: 'multiple-document' },
    { id: 'database', type: 'database', label: 'Database', icon: 'database', category: 'Data', semanticRole: 'storage', aliases: ['data', 'cylinder', 'repository'], defaultSize: { width: 170, height: 92 }, defaultData: { label: 'Database' }, renderer: 'database' },
    { id: 'stored-data', type: 'stored-data', label: 'Stored data', icon: 'data', category: 'Data', semanticRole: 'storage', aliases: ['data storage', 'file'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Stored data' }, renderer: 'stored-data' },
    { id: 'internal-storage', type: 'internal-storage', label: 'Internal storage', icon: 'data', category: 'Data', semanticRole: 'storage', aliases: ['memory', 'internal data'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Internal storage' }, renderer: 'internal-storage' },
    { id: 'manual-input', type: 'manual-input', label: 'Manual input', icon: 'workflow', category: 'Operations', semanticRole: 'manual-input', aliases: ['keyboard', 'user input'], defaultSize: { width: 180, height: 82 }, defaultStyle: { fill: '#1f2e43', stroke: '#76b8ff' }, defaultData: { label: 'Manual input' }, renderer: 'manual-input' },
    { id: 'manual-operation', type: 'manual-operation', label: 'Manual operation', icon: 'workflow', category: 'Operations', semanticRole: 'manual-operation', aliases: ['operator', 'manual step'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Manual operation' }, renderer: 'manual-operation' },
    { id: 'preparation', type: 'preparation', label: 'Preparation', icon: 'hexagon', category: 'Operations', semanticRole: 'preparation', aliases: ['setup', 'initialization'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Preparation' }, renderer: 'preparation' },
    { id: 'predefined-process', type: 'predefined-process', label: 'Predefined process', icon: 'square', category: 'Operations', semanticRole: 'subprocess', aliases: ['subprocess', 'subroutine'], defaultSize: { width: 190, height: 78 }, defaultData: { label: 'Subprocess' }, renderer: 'predefined-process' },
    { id: 'delay', type: 'delay', label: 'Delay', icon: 'rounded-rectangle', category: 'Operations', semanticRole: 'delay', aliases: ['wait', 'pause'], defaultSize: { width: 170, height: 72 }, defaultData: { label: 'Delay' }, renderer: 'delay' },
    { id: 'display', type: 'display', label: 'Display', icon: 'square', category: 'Operations', semanticRole: 'display', aliases: ['screen', 'monitor'], defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Display' }, renderer: 'display' },
    { id: 'connector', type: 'connector', label: 'On-page connector', icon: 'circle', category: 'Connectors', semanticRole: 'connector', aliases: ['on page', 'jump connector'], defaultSize: { width: 72, height: 72 }, defaultData: { label: 'A' }, renderer: 'ellipse', boundary: 'ellipse' },
    { id: 'off-page-connector', type: 'off-page-connector', label: 'Off-page connector', icon: 'pentagon', category: 'Connectors', semanticRole: 'connector', aliases: ['off page', 'page link'], defaultSize: { width: 120, height: 90 }, defaultData: { label: 'A' }, renderer: 'off-page-connector' },
    { id: 'merge', type: 'merge', label: 'Merge', icon: 'triangle', category: 'Advanced', semanticRole: 'merge', aliases: ['join'], defaultSize: { width: 130, height: 80 }, defaultData: { label: 'Merge' }, renderer: 'merge' },
    { id: 'extract', type: 'extract', label: 'Extract', icon: 'triangle', category: 'Advanced', semanticRole: 'extract', aliases: ['split out'], defaultSize: { width: 130, height: 80 }, defaultData: { label: 'Extract' }, renderer: 'extract' },
    { id: 'sort', type: 'sort', label: 'Sort', icon: 'diamond', category: 'Advanced', semanticRole: 'sort', aliases: ['order'], defaultSize: { width: 140, height: 90 }, defaultData: { label: 'Sort' }, renderer: 'sort', boundary: 'diamond' },
    { id: 'collate', type: 'collate', label: 'Collate', icon: 'workflow', category: 'Advanced', semanticRole: 'collate', aliases: ['collect', 'combine'], defaultSize: { width: 150, height: 90 }, defaultData: { label: 'Collate' }, renderer: 'collate' },
    { id: 'loop-limit', type: 'loop-limit', label: 'Loop limit', icon: 'hexagon', category: 'Advanced', semanticRole: 'loop-limit', aliases: ['loop', 'iteration'], defaultSize: { width: 150, height: 88 }, defaultData: { label: 'Loop limit' }, renderer: 'loop-limit' },
  ],
  connectors: [orthogonal, straight],
  validators: [{ id: 'flowchart-rules', label: 'Flowchart rules', validate: (document) => validateFlowchart(document as DiagramDocument) }],
};

const entityDefaults = {
  defaultSize: { width: 230, height: 88 },
  defaultStyle: { fill: '#171b28', stroke: '#8f7dff', radius: 2, textColor: '#f4f5fa', textWrap: false, autoHeight: false },
  defaultData: { label: 'table_name', fields: ['id · uuid · PK', 'name · varchar'], entityVariant: 'key-field-type', columnHeaders: false, striped: true, headerFill: '#272147' },
  renderer: 'entity',
  anchors: entityFieldAnchors,
} as const;

export const erdPlugin: DiagramPlugin = {
  id: 'erd', name: 'Entity relationship', description: 'Model tables, attributes, and relationships.',
  shapes: [
    { id: 'entity', type: 'entity', label: 'Entity', icon: 'table', category: 'Tables', semanticRole: 'entity', aliases: ['table', 'database table', 'relation'], ...entityDefaults },
    { id: 'associative-entity', type: 'entity', label: 'Associative entity', icon: 'table', category: 'Tables', semanticRole: 'associative-entity', aliases: ['junction table', 'join table', 'link table'], ...entityDefaults, defaultData: { ...entityDefaults.defaultData, label: 'join_table', associative: true } },
    { id: 'weak-entity', type: 'entity', label: 'Weak entity', icon: 'table', category: 'Tables', semanticRole: 'weak-entity', aliases: ['dependent entity'], ...entityDefaults, defaultData: { ...entityDefaults.defaultData, label: 'dependent_table', weak: true } },
    { id: 'view', type: 'entity', label: 'View', icon: 'table', category: 'Tables', semanticRole: 'view', aliases: ['database view', 'query'], ...entityDefaults, defaultData: { ...entityDefaults.defaultData, label: 'view_name', view: true } },
    { id: 'schema', type: 'schema', label: 'Schema / subject area', icon: 'square', category: 'Containers', semanticRole: 'schema', aliases: ['subject area', 'database schema', 'container'], defaultSize: { width: 360, height: 240 }, defaultStyle: { fill: 'transparent', stroke: '#7d86a2', radius: 0, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Schema' }, renderer: 'system-boundary', container: true },
    { id: 'attribute', type: 'attribute', label: 'Attribute (legacy)', icon: 'database', category: 'Legacy', semanticRole: 'attribute', aliases: ['column', 'field'], defaultSize: { width: 180, height: 64 }, defaultData: { label: 'attribute' }, renderer: 'ellipse', boundary: 'ellipse' },
  ],
  connectors: [
    { id: 'relationship', label: 'Relationship', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot' } },
    { id: 'identifying', label: 'Identifying relationship', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot', dash: 'solid' } },
    { id: 'non-identifying', label: 'Non-identifying relationship', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot', dash: 'dashed' } },
    { id: 'one-to-one', label: 'One to one', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'bar' } },
    { id: 'one-to-many', label: 'One to many', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot' } },
    { id: 'zero-or-one', label: 'Zero or one', routing: 'orthogonal', defaultStyle: { startMarker: 'circle-bar', endMarker: 'bar' } },
    { id: 'zero-or-many', label: 'Zero or many', routing: 'orthogonal', defaultStyle: { startMarker: 'circle-bar', endMarker: 'circle-crowfoot' } },
    { id: 'many-to-many', label: 'Many to many', routing: 'orthogonal', defaultStyle: { startMarker: 'crowfoot', endMarker: 'crowfoot' } },
  ],
  validators: [{ id: 'erd-rules', label: 'ERD integrity', validate: (document) => validateErd(document as DiagramDocument) }],
};

export const dfdPlugin: DiagramPlugin = {
  id: 'dfd', name: 'Data flow diagram', description: 'Trace information between systems and processes.',
  shapes: [
    { id: 'process', type: 'process', label: 'Process', icon: 'circle', category: 'Core', semanticRole: 'process', notation: 'yourdon-demarco', notationOptions: dfdNotationOptions, aliases: ['transform', 'bubble'], defaultSize: { width: 120, height: 120 }, defaultStyle: { fill: '#2c2752', stroke: '#9c86ff', radius: 60 }, defaultData: { label: 'Process', notation: 'yourdon-demarco' }, renderer: 'ellipse', boundary: 'ellipse' },
    { id: 'external', type: 'external', label: 'External entity', icon: 'square', category: 'Core', semanticRole: 'external-entity', notation: 'yourdon-demarco', notationOptions: dfdNotationOptions, aliases: ['source', 'sink', 'actor'], defaultSize: { width: 170, height: 72 }, defaultStyle: { fill: '#1b3035', stroke: '#42c8d4', radius: 2 }, defaultData: { label: 'External entity', notation: 'yourdon-demarco' }, renderer: 'rectangle' },
    { id: 'store', type: 'store', label: 'Data store', icon: 'database', category: 'Core', semanticRole: 'data-store', notation: 'yourdon-demarco', notationOptions: dfdNotationOptions, aliases: ['repository', 'file', 'data storage'], defaultSize: { width: 190, height: 64 }, defaultStyle: { fill: 'none', stroke: '#e0a95b', radius: 0 }, defaultData: { label: 'Data store', notation: 'yourdon-demarco' }, renderer: 'dfd-store' },
  ],
  connectors: [{ id: 'data-flow', label: 'Data flow', routing: 'orthogonal' }],
  validators: [{ id: 'dfd-rules', label: 'DFD flow rules', validate: (document) => validateDfd(document as DiagramDocument) }],
};

export const useCasePlugin: DiagramPlugin = {
  id: 'use-case', name: 'UML use case', description: 'Frame actors, systems, and intent.',
  shapes: [
    { id: 'actor', type: 'actor', label: 'Actor', icon: 'circle', category: 'Core', semanticRole: 'actor', aliases: ['user', 'role'], defaultSize: { width: 120, height: 140 }, defaultStyle: { fill: '#182a32', stroke: '#55bed2' }, defaultData: { label: 'Actor' }, renderer: 'actor' },
    { id: 'use-case', type: 'use-case', label: 'Use case', icon: 'circle', category: 'Core', semanticRole: 'use-case', aliases: ['goal', 'requirement'], defaultSize: { width: 190, height: 72 }, defaultStyle: { fill: '#2a2550', stroke: '#9c86ff', radius: 36 }, defaultData: { label: 'Use case' }, renderer: 'use-case', boundary: 'ellipse' },
    { id: 'boundary', type: 'boundary', label: 'System boundary', icon: 'square', category: 'Containers', semanticRole: 'system-boundary', aliases: ['subject', 'system'], defaultSize: { width: 260, height: 180 }, defaultStyle: { fill: '#151927', stroke: '#747d98', radius: 0, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'System' }, renderer: 'system-boundary', container: true, tags: ['container', 'system'] },
    { id: 'package', type: 'package', label: 'Package', icon: 'package', category: 'Containers', semanticRole: 'package', aliases: ['namespace', 'module'], defaultSize: { width: 260, height: 180 }, defaultStyle: { fill: '#151927', stroke: '#747d98', radius: 0, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Package' }, renderer: 'package', container: true, tags: ['container', 'package'] },
    { id: 'note', type: 'note', label: 'UML note', icon: 'text', category: 'Annotations', semanticRole: 'comment', aliases: ['comment', 'annotation'], defaultSize: { width: 180, height: 100 }, defaultStyle: { fill: '#40385f', stroke: '#b0a2ff', radius: 0, textAlign: 'left', verticalAlign: 'top' }, defaultData: { label: 'Note' }, renderer: 'folded-note', tags: ['annotation'] },
  ],
  connectors: [
    { id: 'association', label: 'Association', routing: 'straight', defaultStyle: { endMarker: 'none' } },
    { id: 'include', label: '«include»', routing: 'straight', defaultStyle: { dash: 'dashed', endMarker: 'arrow' } },
    { id: 'extend', label: '«extend»', routing: 'straight', defaultStyle: { dash: 'dashed', endMarker: 'arrow' } },
    { id: 'generalization', label: 'Generalization', routing: 'straight', defaultStyle: { dash: 'solid', endMarker: 'arrow' } },
    { id: 'comment', label: 'Comment link', routing: 'straight', defaultStyle: { dash: 'dashed', endMarker: 'none' } },
  ],
  validators: [{ id: 'use-case-rules', label: 'Use-case relationship rules', validate: (document) => validateUseCase(document as DiagramDocument) }],
};

export const builtInPlugins: DiagramPlugin[] = [generalPlugin, flowchartPlugin, erdPlugin, dfdPlugin, useCasePlugin];
