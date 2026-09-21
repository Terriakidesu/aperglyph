import { createDocument, createEdge, createNode } from './document';
import { entityFieldPortOffset } from './erd';
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
    const users = createNode('entity', { x: -430, y: -180 }, {
      library: 'erd', size: { width: 230, height: 142 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'Users', striped: true, headerFill: '#272147', fields: ['UserID · uuid · PK', 'CoachID · uuid · FK', 'Name · varchar', 'HabitNum · integer'] },
    });
    const coach = createNode('entity', { x: -430, y: 70 }, {
      library: 'erd', size: { width: 230, height: 88 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'Coach', striped: true, headerFill: '#272147', fields: ['CoachID · uuid · PK', 'Name · varchar'] },
    });
    const userHabits = createNode('entity', { x: -110, y: -45 }, {
      library: 'erd', size: { width: 230, height: 115 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'UserHabits', striped: true, headerFill: '#272147', associative: true, fields: ['UserHabitID · uuid · PK', 'UserID · uuid · FK', 'HabitID · uuid · FK'] },
    });
    const habits = createNode('entity', { x: 190, y: -180 }, {
      library: 'erd', size: { width: 220, height: 88 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'Habits', striped: true, headerFill: '#272147', fields: ['HabitID · uuid · PK', 'HabitName · varchar'] },
    });
    const checkins = createNode('entity', { x: 520, y: -180 }, {
      library: 'erd', size: { width: 230, height: 142 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'Checkins', striped: true, headerFill: '#272147', fields: ['HabitCheckinID · uuid · PK', 'HabitID · uuid · FK', 'UserID · uuid · FK', 'CheckinDate · date'] },
    });
    const comments = createNode('entity', { x: 520, y: 70 }, {
      library: 'erd', size: { width: 230, height: 196 },
      style: { fill: '#171b28', stroke: '#8f7dff', textColor: '#f4f5fa', radius: 2 },
      data: { label: 'Comments', striped: true, headerFill: '#272147', fields: ['CommentID · uuid · PK', 'HabitCheckinID · uuid · FK', 'UserID · uuid · FK', 'CoachID · uuid · FK', 'CommentDate · date', 'CommentText · text'] },
    });
    page.nodes.push(users, coach, userHabits, habits, checkins, comments);
    page.edges.push(
      createEdge({ nodeId: users.id, port: 'bottom' }, { nodeId: coach.id, port: 'top' }, { type: 'orthogonal', style: { startMarker: 'crowfoot', endMarker: 'bar' }, data: { label: 'N : 1' } }),
       createEdge({ nodeId: users.id, port: 'right', offset: entityFieldPortOffset(users.data.fields, 0) }, { nodeId: userHabits.id, port: 'left', offset: entityFieldPortOffset(userHabits.data.fields, 1) }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
       createEdge({ nodeId: habits.id, port: 'left', offset: entityFieldPortOffset(habits.data.fields, 0) }, { nodeId: userHabits.id, port: 'right', offset: entityFieldPortOffset(userHabits.data.fields, 2) }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
       createEdge({ nodeId: habits.id, port: 'right', offset: entityFieldPortOffset(habits.data.fields, 0) }, { nodeId: checkins.id, port: 'left', offset: entityFieldPortOffset(checkins.data.fields, 1) }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
      createEdge({ nodeId: checkins.id, port: 'bottom' }, { nodeId: comments.id, port: 'top' }, { type: 'orthogonal', style: { startMarker: 'bar', endMarker: 'crowfoot' }, data: { label: '1 : N' } }),
    );
  } else if (type === 'dfd') {
    const source = createNode('external', { x: -370, y: -40 }, {
      library: 'dfd', size: { width: 170, height: 72 },
      style: { fill: '#1b3035', stroke: '#42c8d4', radius: 2 }, data: { label: 'Customer' },
    });
    const process = createNode('process', { x: -50, y: -64 }, {
      library: 'dfd', size: { width: 120, height: 120 },
      style: { fill: '#2c2752', stroke: '#9c86ff', radius: 60 }, data: { label: 'Manage order' },
    });
    const store = createNode('store', { x: 255, y: -35 }, {
      library: 'dfd', size: { width: 190, height: 64 },
      style: { fill: 'none', stroke: '#e0a95b', radius: 0 }, data: { label: 'Orders' },
    });
    page.nodes.push(source, process, store);
    page.edges.push(
      createEdge({ nodeId: source.id, port: 'right' }, { nodeId: process.id, port: 'left' }, { type: 'orthogonal', data: { label: 'Order details' } }),
      createEdge({ nodeId: process.id, port: 'right' }, { nodeId: store.id, port: 'left' }, { type: 'orthogonal', data: { label: 'Persist order' } }),
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
  } else if (type === 'general') {
    // A general diagram is intentionally empty: "Blank canvas" and "New
    // diagram" should not hide starter content that the user did not create.
  }

  document.updatedAt = Date.now();
  return document;
}
