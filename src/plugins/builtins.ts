import type { DiagramPlugin } from './types';

const straight = { id: 'straight', label: 'Straight connector', routing: 'straight' as const };
const orthogonal = { id: 'orthogonal', label: 'Orthogonal connector', routing: 'orthogonal' as const };

export const generalPlugin: DiagramPlugin = {
  id: 'general', name: 'General', description: 'Flexible primitives for any visual idea.',
  shapes: [
    { id: 'rectangle', type: 'rectangle', label: 'Rectangle', icon: 'square' },
    { id: 'rounded-rectangle', type: 'rounded-rectangle', label: 'Rounded rectangle', icon: 'rounded-rectangle' },
    { id: 'circle', type: 'circle', label: 'Circle', icon: 'circle', defaultSize: { width: 112, height: 112 } },
    { id: 'diamond', type: 'diamond', label: 'Diamond', icon: 'diamond', defaultSize: { width: 160, height: 110 } },
    { id: 'text', type: 'text', label: 'Text', icon: 'text', defaultSize: { width: 190, height: 56 }, defaultData: { label: 'Text label' } },
    { id: 'line', type: 'line', label: 'Line', icon: 'line', defaultSize: { width: 190, height: 32 } },
  ],
  connectors: [straight, { id: 'curved', label: 'Curved connector', routing: 'curved' }, orthogonal],
  validators: [],
};

export const flowchartPlugin: DiagramPlugin = {
  id: 'flowchart', name: 'Flowchart', description: 'Map processes, decisions, and outcomes.',
  shapes: [
    { id: 'start', type: 'start', label: 'Start / end', icon: 'circle', defaultSize: { width: 160, height: 64 }, defaultStyle: { fill: '#15362f', stroke: '#43d6a6', radius: 32 } },
    { id: 'process', type: 'process', label: 'Process', icon: 'square', defaultData: { label: 'Process' } },
    { id: 'decision', type: 'decision', label: 'Decision', icon: 'diamond', defaultSize: { width: 160, height: 112 }, defaultStyle: { fill: '#302a4c', stroke: '#9c86ff' }, defaultData: { label: 'Decision?' } },
    { id: 'input', type: 'input', label: 'Input / output', icon: 'rounded-rectangle', defaultStyle: { fill: '#1f2e43', stroke: '#76b8ff' } },
  ],
  connectors: [orthogonal, straight],
  validators: [],
};

export const erdPlugin: DiagramPlugin = {
  id: 'erd', name: 'Entity relationship', description: 'Model tables, attributes, and relationships.',
  shapes: [
    { id: 'entity', type: 'entity', label: 'Entity', icon: 'table', defaultSize: { width: 220, height: 150 }, defaultStyle: { fill: '#1d2334', stroke: '#8496ff' }, defaultData: { label: 'table_name', fields: ['id · uuid · PK', 'name · varchar'] } },
    { id: 'attribute', type: 'attribute', label: 'Attribute', icon: 'database', defaultSize: { width: 180, height: 64 }, defaultData: { label: 'attribute' } },
  ],
  connectors: [
    { id: 'relationship', label: 'Relationship', routing: 'orthogonal' },
    { id: 'identifying', label: 'Identifying relationship', routing: 'orthogonal', defaultStyle: { dash: 'dashed' } },
  ],
  validators: [],
};

export const dfdPlugin: DiagramPlugin = {
  id: 'dfd', name: 'Data flow diagram', description: 'Trace information between systems and processes.',
  shapes: [
    { id: 'process', type: 'process', label: 'Process', icon: 'workflow', defaultStyle: { fill: '#302a4c', stroke: '#9c86ff' } },
    { id: 'external', type: 'external', label: 'External entity', icon: 'square', defaultStyle: { fill: '#1b3035', stroke: '#42c8d4' } },
    { id: 'store', type: 'store', label: 'Data store', icon: 'database', defaultStyle: { fill: '#302b24', stroke: '#e0a95b' } },
  ],
  connectors: [{ id: 'data-flow', label: 'Data flow', routing: 'orthogonal' }],
  validators: [],
};

export const useCasePlugin: DiagramPlugin = {
  id: 'use-case', name: 'UML use case', description: 'Frame actors, systems, and intent.',
  shapes: [
    { id: 'actor', type: 'actor', label: 'Actor', icon: 'circle', defaultSize: { width: 120, height: 140 }, defaultStyle: { fill: '#182a32', stroke: '#55bed2' }, defaultData: { label: 'Actor' } },
    { id: 'use-case', type: 'use-case', label: 'Use case', icon: 'circle', defaultSize: { width: 190, height: 72 }, defaultStyle: { fill: '#2a2550', stroke: '#9c86ff', radius: 36 }, defaultData: { label: 'Use case' } },
    { id: 'boundary', type: 'boundary', label: 'System boundary', icon: 'square', defaultSize: { width: 260, height: 180 }, defaultStyle: { fill: '#151927', stroke: '#747d98', radius: 18 }, defaultData: { label: 'System' } },
  ],
  connectors: [
    { id: 'association', label: 'Association', routing: 'straight', defaultStyle: { endMarker: 'none' } },
    { id: 'include', label: '«include»', routing: 'straight', defaultStyle: { dash: 'dashed' } },
    { id: 'extend', label: '«extend»', routing: 'straight', defaultStyle: { dash: 'dashed' } },
  ],
  validators: [],
};

export const builtInPlugins: DiagramPlugin[] = [generalPlugin, flowchartPlugin, erdPlugin, dfdPlugin, useCasePlugin];
