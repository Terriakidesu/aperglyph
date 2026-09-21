import { describe, expect, it } from 'vitest';
import { CommandManager, CreateNodeCommand, MoveNodesCommand } from './commands';
import { createDocument, createNode } from './document';

describe('command history', () => {
  it('supports execute, undo, and redo', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const node = createNode('rectangle', { x: 10, y: 20 });
    const manager = new CommandManager();
    const withNode = manager.execute(new CreateNodeCommand(pageId, node), document);
    expect(withNode.pages[0].nodes).toHaveLength(1);
    expect(manager.canUndo).toBe(true);

    const empty = manager.undo(withNode);
    expect(empty?.pages[0].nodes).toHaveLength(0);
    expect(manager.canRedo).toBe(true);

    const restored = manager.redo(empty!);
    expect(restored?.pages[0].nodes[0].id).toBe(node.id);
  });

  it('records a single move command for a batch of nodes', () => {
    const document = createDocument();
    const pageId = document.pages[0].id;
    const first = createNode('rectangle', { x: 0, y: 0 });
    const second = createNode('rectangle', { x: 100, y: 0 });
    document.pages[0].nodes.push(first, second);
    const manager = new CommandManager();
    const moved = manager.execute(new MoveNodesCommand(pageId, {
      [first.id]: { x: 20, y: 30 },
      [second.id]: { x: 120, y: 30 },
    }), document);
    expect(moved.pages[0].nodes.map((node) => node.position.y)).toEqual([30, 30]);
  });
});
