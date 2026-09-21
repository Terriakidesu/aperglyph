import { validateDfd } from '../core/dfd';
import { entityFieldAnchors } from '../core/anchors';
import type { DiagramDocument } from '../core/types';
import type { DiagramPlugin } from './types';

const straight = { id: 'straight', label: 'Straight connector', routing: 'straight' as const };
const orthogonal = { id: 'orthogonal', label: 'Orthogonal connector', routing: 'orthogonal' as const };

export const generalPlugin: DiagramPlugin = {
  id: 'general', name: 'General', description: 'Flexible primitives for any visual idea.',
  shapes: [
     { id: 'rectangle', type: 'rectangle', label: 'Rectangle', icon: 'square', renderer: 'rectangle' },
     { id: 'rounded-rectangle', type: 'rounded-rectangle', label: 'Rounded rectangle', icon: 'rounded-rectangle', renderer: 'rounded-rectangle' },
     { id: 'circle', type: 'circle', label: 'Circle', icon: 'circle', defaultSize: { width: 112, height: 112 }, renderer: 'ellipse', boundary: 'ellipse' },
     { id: 'diamond', type: 'diamond', label: 'Diamond', icon: 'diamond', defaultSize: { width: 160, height: 110 }, renderer: 'diamond', boundary: 'diamond' },
     { id: 'text', type: 'text', label: 'Text', icon: 'text', defaultSize: { width: 190, height: 56 }, defaultData: { label: 'Text label' }, renderer: 'rectangle' },
     { id: 'line', type: 'line', label: 'Line', icon: 'line', defaultSize: { width: 190, height: 32 }, renderer: 'line' },
  ],
  connectors: [straight, { id: 'curved', label: 'Curved connector', routing: 'curved' }, orthogonal],
  validators: [],
};

export const flowchartPlugin: DiagramPlugin = {
  id: 'flowchart', name: 'Flowchart', description: 'Map processes, decisions, and outcomes.',
  shapes: [
     { id: 'start', type: 'start', label: 'Start / end', icon: 'circle', defaultSize: { width: 160, height: 64 }, defaultStyle: { fill: '#15362f', stroke: '#43d6a6', radius: 32 }, renderer: 'start' },
     { id: 'process', type: 'process', label: 'Process', icon: 'square', defaultData: { label: 'Process' }, renderer: 'rectangle' },
     { id: 'decision', type: 'decision', label: 'Decision', icon: 'diamond', defaultSize: { width: 160, height: 112 }, defaultStyle: { fill: '#302a4c', stroke: '#9c86ff' }, defaultData: { label: 'Decision?' }, renderer: 'diamond', boundary: 'diamond' },
    { id: 'input', type: 'input', label: 'Input / output', icon: 'rounded-rectangle', defaultStyle: { fill: '#1f2e43', stroke: '#76b8ff' } },
     { id: 'document', type: 'document', label: 'Document', icon: 'text', defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Document' }, renderer: 'document' },
     { id: 'multiple-document', type: 'multiple-document', label: 'Multiple documents', icon: 'text', defaultSize: { width: 190, height: 90 }, defaultData: { label: 'Documents' }, renderer: 'document' },
     { id: 'database', type: 'database', label: 'Database', icon: 'database', defaultSize: { width: 170, height: 92 }, defaultData: { label: 'Database' }, renderer: 'database' },
     { id: 'stored-data', type: 'stored-data', label: 'Stored data', icon: 'database', defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Stored data' }, renderer: 'stored-data' },
     { id: 'manual-input', type: 'manual-input', label: 'Manual input', icon: 'rounded-rectangle', defaultStyle: { fill: '#1f2e43', stroke: '#76b8ff' }, defaultData: { label: 'Manual input' }, renderer: 'manual-input' },
     { id: 'preparation', type: 'preparation', label: 'Preparation', icon: 'diamond', defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Preparation' }, renderer: 'preparation' },
     { id: 'predefined-process', type: 'predefined-process', label: 'Predefined process', icon: 'square', defaultSize: { width: 190, height: 78 }, defaultData: { label: 'Subprocess' }, renderer: 'predefined-process' },
     { id: 'delay', type: 'delay', label: 'Delay', icon: 'rounded-rectangle', defaultSize: { width: 170, height: 72 }, defaultData: { label: 'Delay' }, renderer: 'delay' },
     { id: 'display', type: 'display', label: 'Display', icon: 'square', defaultSize: { width: 180, height: 82 }, defaultData: { label: 'Display' }, renderer: 'display' },
     { id: 'connector', type: 'connector', label: 'Connector', icon: 'circle', defaultSize: { width: 72, height: 72 }, defaultData: { label: 'A' }, renderer: 'ellipse', boundary: 'ellipse' },
     { id: 'off-page-connector', type: 'off-page-connector', label: 'Off-page connector', icon: 'diamond', defaultSize: { width: 120, height: 90 }, defaultData: { label: 'A' }, renderer: 'off-page-connector' },
  ],
  connectors: [orthogonal, straight],
  validators: [],
};

export const erdPlugin: DiagramPlugin = {
  id: 'erd', name: 'Entity relationship', description: 'Model tables, attributes, and relationships.',
  shapes: [
    { id: 'entity', type: 'entity', label: 'Entity', icon: 'table', defaultSize: { width: 230, height: 88 }, defaultStyle: { fill: '#171b28', stroke: '#8f7dff', radius: 2, textColor: '#f4f5fa' }, defaultData: { label: 'table_name', fields: ['id · uuid · PK', 'name · varchar'], entityVariant: 'key-field-type', columnHeaders: false, striped: true, headerFill: '#272147' }, renderer: 'entity', anchors: entityFieldAnchors },
    { id: 'attribute', type: 'attribute', label: 'Attribute', icon: 'database', defaultSize: { width: 180, height: 64 }, defaultData: { label: 'attribute' }, renderer: 'rectangle' },
  ],
  connectors: [
    { id: 'relationship', label: 'Relationship', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot' } },
    { id: 'identifying', label: 'Identifying relationship', routing: 'orthogonal', defaultStyle: { startMarker: 'bar', endMarker: 'crowfoot', dash: 'dashed' } },
  ],
  validators: [],
};

export const dfdPlugin: DiagramPlugin = {
  id: 'dfd', name: 'Data flow diagram', description: 'Trace information between systems and processes.',
  shapes: [
    { id: 'process', type: 'process', label: 'Process', icon: 'circle', defaultSize: { width: 120, height: 120 }, defaultStyle: { fill: '#2c2752', stroke: '#9c86ff', radius: 60 }, defaultData: { label: 'Process' }, renderer: 'ellipse', boundary: 'ellipse' },
    { id: 'external', type: 'external', label: 'External entity', icon: 'square', defaultSize: { width: 170, height: 72 }, defaultStyle: { fill: '#1b3035', stroke: '#42c8d4', radius: 2 }, defaultData: { label: 'External entity' }, renderer: 'rectangle' },
    { id: 'store', type: 'store', label: 'Data store', icon: 'database', defaultSize: { width: 190, height: 64 }, defaultStyle: { fill: 'none', stroke: '#e0a95b', radius: 0 }, defaultData: { label: 'Data store' }, renderer: 'dfd-store' },
  ],
  connectors: [{ id: 'data-flow', label: 'Data flow', routing: 'orthogonal' }],
  validators: [{ id: 'dfd-rules', label: 'DFD flow rules', validate: (document) => validateDfd(document as DiagramDocument).map((diagnostic) => diagnostic.message) }],
};

export const useCasePlugin: DiagramPlugin = {
  id: 'use-case', name: 'UML use case', description: 'Frame actors, systems, and intent.',
  shapes: [
    { id: 'actor', type: 'actor', label: 'Actor', icon: 'circle', defaultSize: { width: 120, height: 140 }, defaultStyle: { fill: '#182a32', stroke: '#55bed2' }, defaultData: { label: 'Actor' }, renderer: 'actor' },
    { id: 'use-case', type: 'use-case', label: 'Use case', icon: 'circle', defaultSize: { width: 190, height: 72 }, defaultStyle: { fill: '#2a2550', stroke: '#9c86ff', radius: 36 }, defaultData: { label: 'Use case' }, renderer: 'use-case', boundary: 'ellipse' },
    { id: 'boundary', type: 'boundary', label: 'System boundary', icon: 'square', defaultSize: { width: 260, height: 180 }, defaultStyle: { fill: '#151927', stroke: '#747d98', radius: 18 }, defaultData: { label: 'System' }, renderer: 'boundary' },
  ],
  connectors: [
    { id: 'association', label: 'Association', routing: 'straight', defaultStyle: { endMarker: 'none' } },
    { id: 'include', label: '«include»', routing: 'straight', defaultStyle: { dash: 'dashed' } },
    { id: 'extend', label: '«extend»', routing: 'straight', defaultStyle: { dash: 'dashed' } },
  ],
  validators: [],
};

export const builtInPlugins: DiagramPlugin[] = [generalPlugin, flowchartPlugin, erdPlugin, dfdPlugin, useCasePlugin];
