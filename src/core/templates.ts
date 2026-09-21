import { createDocument, createEdge, createNode } from './document';
import type { DiagramDocument, DiagramType } from './types';

export function createTemplateDocument(
  name: string,
  type: DiagramType,
): DiagramDocument {
  const document = createDocument(name, type);
  const page = document.pages[0];

  if (type === 'flowchart') {
    const start = createNode('start', { x: -360, y: -170 }, {
      library: 'flowchart', size: { width: 150, height: 64 },
      style: { fill: '#15362f', stroke: '#43d6a6', radius: 32 }, data: { label: 'Start' },
    });
    const intake = createNode('process', { x: -95, y: -170 }, {
      library: 'flowchart', data: { label: 'Collect requirements' },
    });
    const decision = createNode('decision', { x: 190, y: -170 }, {
      library: 'flowchart', size: { width: 170, height: 120 },
      style: { fill: '#302a4c', stroke: '#9c86ff' }, data: { label: 'Ready to ship?' },
    });
    const build = createNode('process', { x: 140, y: 70 }, {
      library: 'flowchart', data: { label: 'Build & test' },
    });
    const launch = createNode('start', { x: 420, y: -170 }, {
      library: 'flowchart', size: { width: 150, height: 64 },
      style: { fill: '#15362f', stroke: '#43d6a6', radius: 32 }, data: { label: 'Launch' },
    });
    page.nodes.push(start, intake, decision, build, launch);
    page.edges.push(
      createEdge({ nodeId: start.id }, { nodeId: intake.id }),
      createEdge({ nodeId: intake.id }, { nodeId: decision.id }),
      createEdge({ nodeId: decision.id }, { nodeId: launch.id }, { data: { label: 'Yes' } }),
      createEdge({ nodeId: decision.id }, { nodeId: build.id }, { data: { label: 'No' } }),
      createEdge({ nodeId: build.id }, { nodeId: intake.id }, { data: { label: 'Iterate' } }),
    );
  } else if (type === 'erd') {
    const users = createNode('entity', { x: -330, y: -80 }, {
      library: 'erd', size: { width: 230, height: 190 },
      style: { fill: '#f2f3f7', stroke: '#68707f', textColor: '#202532', radius: 4 },
      data: { label: 'users', striped: true, fields: ['id · uuid · PK', 'email · varchar', 'created_at · timestamp'] },
    });
    const projects = createNode('entity', { x: 80, y: -80 }, {
      library: 'erd', size: { width: 230, height: 190 },
      style: { fill: '#f2f3f7', stroke: '#68707f', textColor: '#202532', radius: 4 },
      data: { label: 'projects', striped: true, fields: ['id · uuid · PK', 'owner_id · uuid · FK', 'name · varchar'] },
    });
    const diagrams = createNode('entity', { x: 490, y: -80 }, {
      library: 'erd', size: { width: 230, height: 190 },
      style: { fill: '#f2f3f7', stroke: '#68707f', textColor: '#202532', radius: 4 },
      data: { label: 'diagrams', striped: true, fields: ['id · uuid · PK', 'project_id · uuid · FK', 'content · jsonb'] },
    });
    page.nodes.push(users, projects, diagrams);
    page.edges.push(
      createEdge({ nodeId: users.id, port: 'right' }, { nodeId: projects.id, port: 'left' }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
      createEdge({ nodeId: projects.id, port: 'right' }, { nodeId: diagrams.id, port: 'left' }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
    );
  } else if (type === 'dfd') {
    const source = createNode('external', { x: -370, y: -40 }, {
      library: 'dfd', size: { width: 180, height: 92 },
      style: { fill: '#1b3035', stroke: '#42c8d4' }, data: { label: 'Customer' },
    });
    const process = createNode('process', { x: -55, y: -40 }, {
      library: 'dfd', size: { width: 210, height: 92 },
      style: { fill: '#302a4c', stroke: '#9c86ff' }, data: { label: 'Manage order' },
    });
    const store = createNode('store', { x: 305, y: -40 }, {
      library: 'dfd', size: { width: 210, height: 92 },
      style: { fill: '#302b24', stroke: '#e0a95b' }, data: { label: 'Orders' },
    });
    page.nodes.push(source, process, store);
    page.edges.push(
      createEdge({ nodeId: source.id }, { nodeId: process.id }, { data: { label: 'Order details' } }),
      createEdge({ nodeId: process.id }, { nodeId: store.id }, { data: { label: 'Persist order' } }),
    );
  } else if (type === 'use-case') {
    const actor = createNode('actor', { x: -360, y: -65 }, {
      library: 'use-case', size: { width: 120, height: 150 },
      style: { fill: '#182a32', stroke: '#55bed2' }, data: { label: 'Operator' },
    });
    const boundary = createNode('boundary', { x: -80, y: -170 }, {
      library: 'use-case', size: { width: 500, height: 300 },
      style: { fill: '#151927', stroke: '#747d98', radius: 18 }, data: { label: 'AperGlyph' },
    });
    const open = createNode('use-case', { x: 0, y: -75 }, {
      library: 'use-case', size: { width: 170, height: 68 },
      style: { fill: '#2a2550', stroke: '#9c86ff', radius: 34 }, data: { label: 'Open diagram' },
    });
    const exportNode = createNode('use-case', { x: 215, y: 40 }, {
      library: 'use-case', size: { width: 170, height: 68 },
      style: { fill: '#2a2550', stroke: '#9c86ff', radius: 34 }, data: { label: 'Export file' },
    });
    page.nodes.push(boundary, actor, open, exportNode);
    page.edges.push(
      createEdge({ nodeId: actor.id }, { nodeId: open.id }, { type: 'dashed', data: { label: 'uses' }, style: { dash: 'dashed', endMarker: 'none' } }),
      createEdge({ nodeId: actor.id }, { nodeId: exportNode.id }, { type: 'dashed', style: { dash: 'dashed', endMarker: 'none' } }),
    );
  } else {
    const idea = createNode('rounded-rectangle', { x: -300, y: -60 }, {
      data: { label: 'A clear idea' }, style: { fill: '#2c2752', stroke: '#927cff' },
    });
    const shape = createNode('diamond', { x: 50, y: -60 }, {
      size: { width: 180, height: 120 }, data: { label: 'Shape it' },
      style: { fill: '#202c44', stroke: '#76b8ff' },
    });
    const result = createNode('rounded-rectangle', { x: 370, y: -60 }, {
      data: { label: 'Share the story' }, style: { fill: '#17362e', stroke: '#43d6a6' },
    });
    page.nodes.push(idea, shape, result);
    page.edges.push(createEdge({ nodeId: idea.id }, { nodeId: shape.id }), createEdge({ nodeId: shape.id }, { nodeId: result.id }));
  }

  document.updatedAt = Date.now();
  return document;
}
