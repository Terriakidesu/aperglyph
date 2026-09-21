import type { DiagramNode, NodeStyle, TextAlign, VerticalAlign } from './types';

export interface NodeTextLayout {
  lines: string[];
  x: number;
  firstBaseline: number;
  lineHeight: number;
  textAnchor: 'start' | 'middle' | 'end';
}

export interface NodeTextLayoutOptions {
  padding?: number;
  align?: TextAlign;
  vertical?: VerticalAlign;
  maxWidth?: number;
}

/**
 * Estimate line breaks without relying on a browser canvas measurement API.
 * Documents can therefore be resized, exported, and rendered in workers with
 * the same predictable layout rules.
 */
export function wrapText(value: string, maxWidth: number, fontSize: number): string[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const charactersPerLine = Math.max(1, Math.floor(maxWidth / Math.max(1, fontSize * 0.58)));
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  paragraphs.forEach((paragraph) => {
    if (paragraph.length === 0) {
      lines.push('');
      return;
    }
    let remaining = paragraph.trim();
    while (remaining.length > charactersPerLine) {
      let breakAt = remaining.lastIndexOf(' ', charactersPerLine);
      if (breakAt <= 0) breakAt = charactersPerLine;
      lines.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    lines.push(remaining);
  });

  return lines.length > 0 ? lines : [''];
}

export function nodeTextLayout(
  value: string,
  style: Pick<NodeStyle, 'fontSize' | 'fontWeight' | 'textAlign' | 'verticalAlign' | 'textWrap'>,
  width: number,
  height: number,
  options: NodeTextLayoutOptions = {},
): NodeTextLayout {
  const fontSize = clamp(style.fontSize, 6, 96);
  const padding = Math.max(4, options.padding ?? Math.min(18, Math.max(8, width * 0.08)));
  const maxWidth = Math.max(fontSize * 2, options.maxWidth ?? width - padding * 2);
  const lines = style.textWrap ? wrapText(value, maxWidth, fontSize) : value.replace(/\r\n?/g, '\n').split('\n').slice(0, 1);
  const lineHeight = fontSize * 1.25;
  const align = options.align ?? style.textAlign;
  const vertical = options.vertical ?? style.verticalAlign;
  const textAnchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? padding : align === 'right' ? width - padding : width / 2;
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = vertical === 'top'
    ? padding + fontSize
    : vertical === 'bottom'
      ? height - padding - (lines.length - 1) * lineHeight
      : (height - blockHeight) / 2 + fontSize;

  return { lines, x, firstBaseline, lineHeight, textAnchor };
}

export function wrappedNodeHeight(node: Pick<DiagramNode, 'size' | 'style' | 'data'>): number {
  if (!node.style.textWrap || !node.style.autoHeight) return node.size.height;
  const label = typeof node.data.label === 'string' ? node.data.label : '';
  const layout = nodeTextLayout(label, node.style, node.size.width, node.size.height);
  return Math.max(32, Math.ceil(layout.lines.length * layout.lineHeight + 24));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
