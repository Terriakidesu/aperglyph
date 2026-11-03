import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = process.cwd();
const fixturePath = resolve(root, 'tests/fixtures/erd-layout-generated.wdiag');
const comparisonFixturePath = resolve(root, 'tests/fixtures/erd-layout-generated-comparison.png');
const metricsFixturePath = resolve(root, 'tests/fixtures/erd-layout-generated-metrics.json');
const artifactDirectory = resolve(root, 'target/erd-layout-generated');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { createDocument, createEdge, createNode, parseProject, serializeProject } = await vite.ssrLoadModule('/src/core/document.ts');
  const { entityAutoHeight, entityAutoWidth, entityFieldPortOffset, validateErd } = await vite.ssrLoadModule('/src/core/erd.ts');
  const { optimizeErdLayout } = await vite.ssrLoadModule('/src/core/layout.ts');
  const { edgeRoute, edgeRouting, parallelEdgeOffset, parallelRoutingLane } = await vite.ssrLoadModule('/src/core/routing.ts');
  const { documentToSvg } = await vite.ssrLoadModule('/src/persistence/files.ts');

  const tables = [
    'users', 'roles', 'permissions', 'projects', 'labels', 'environments', 'plans', 'integrations',
    'user_roles', 'role_permissions', 'project_members', 'tasks', 'task_labels', 'task_comments',
    'milestones', 'attachments', 'repositories', 'commits', 'deployments', 'workflows',
    'workflow_runs', 'artifacts', 'notifications', 'audit_logs', 'settings', 'webhooks',
    'invoices', 'subscriptions', 'payments', 'api_keys', 'sessions', 'release_channels',
  ];
  const relationships = [
    ['user_roles', 'users', 'user_id'], ['user_roles', 'roles', 'role_id'],
    ['role_permissions', 'roles', 'role_id'], ['role_permissions', 'permissions', 'permission_id'],
    ['project_members', 'projects', 'project_id'], ['project_members', 'users', 'user_id'],
    ['tasks', 'projects', 'project_id'], ['tasks', 'users', 'assignee_id'], ['tasks', 'users', 'created_by_id'],
    ['task_labels', 'tasks', 'task_id'], ['task_labels', 'labels', 'label_id'],
    ['task_comments', 'tasks', 'task_id'], ['task_comments', 'users', 'author_id'],
    ['milestones', 'projects', 'project_id'], ['attachments', 'tasks', 'task_id'],
    ['repositories', 'projects', 'project_id'], ['commits', 'repositories', 'repository_id'],
    ['deployments', 'repositories', 'repository_id'], ['deployments', 'environments', 'environment_id'],
    ['deployments', 'users', 'deployed_by_id'], ['workflows', 'repositories', 'repository_id'],
    ['workflow_runs', 'workflows', 'workflow_id'], ['workflow_runs', 'users', 'triggered_by_id'],
    ['artifacts', 'workflow_runs', 'run_id'], ['notifications', 'users', 'user_id'],
    ['audit_logs', 'users', 'actor_id'], ['settings', 'projects', 'project_id'],
    ['integrations', 'projects', 'project_id'], ['webhooks', 'integrations', 'integration_id'],
    ['invoices', 'projects', 'project_id'], ['subscriptions', 'plans', 'plan_id'],
    ['subscriptions', 'users', 'user_id'], ['payments', 'invoices', 'invoice_id'],
    ['api_keys', 'users', 'user_id'], ['sessions', 'users', 'user_id'],
    ['release_channels', 'repositories', 'repository_id'],
  ];

  let document;
  if (process.argv.includes('--write-fixture')) {
    document = makeFixture({ createDocument, createNode, createEdge, entityAutoHeight, entityAutoWidth, entityFieldPortOffset }, tables, relationships);
    await mkdir(resolve(root, 'tests/fixtures'), { recursive: true });
    await writeFile(fixturePath, serializeProject(document));
    document = parseProject(await readFile(fixturePath, 'utf8'));
    console.log(`Wrote generated fixture: ${fixturePath}`);
  } else {
    document = parseProject(await readFile(fixturePath, 'utf8'));
  }

  const page = document.pages[0];
  if (page.nodes.filter((node) => node.type === 'entity').length !== 32 || page.edges.length !== 36) {
    throw new Error('The generated reference must contain exactly 32 entity tables and 36 relationships.');
  }
  const diagnostics = validateErd(document);
  if (diagnostics.length > 0) throw new Error(`Generated fixture failed ERD validation: ${JSON.stringify(diagnostics)}`);

  const routingModules = { edgeRoute, edgeRouting, parallelEdgeOffset, parallelRoutingLane };
  const before = collectMetrics(page, routingModules);
  const proposal = optimizeErdLayout(page.nodes, page.edges);
  const optimized = structuredClone(document);
  optimized.name = 'Synthetic ERD layout reference — optimized copy';
  optimized.pages[0].nodes = optimized.pages[0].nodes.map((node) => proposal.positions[node.id]
    ? { ...node, position: { ...proposal.positions[node.id] } }
    : node);
  const after = collectMetrics(optimized.pages[0], routingModules);
  if (after.blockedSegments > 0 || after.invalidSegments > 0 || after.tableCollisions > 0 || after.minimumEndpointLead < 24) {
    throw new Error(`Optimized fixture violates routing or placement safety: ${JSON.stringify(after)}`);
  }
  if (after.routeLength >= before.routeLength || after.turns > before.turns || after.crossings >= before.crossings
    || after.overlapPairs >= before.overlapPairs || after.layoutArea > before.layoutArea) {
    throw new Error(`Optimized fixture did not improve the required layout metrics: ${JSON.stringify({ before, after })}`);
  }

  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(resolve(artifactDirectory, 'optimized.wdiag'), serializeProject(optimized));
  await writeFile(resolve(artifactDirectory, 'metrics.json'), `${JSON.stringify({ fixture: document.name, before, after }, null, 2)}\n`);
  const baselineSvg = renderSvg(page, documentToSvg);
  const optimizedSvg = renderSvg(optimized.pages[0], documentToSvg);
  await writeFile(resolve(artifactDirectory, 'baseline.svg'), baselineSvg);
  await writeFile(resolve(artifactDirectory, 'optimized.svg'), optimizedSvg);
  await renderComparison(baselineSvg, optimizedSvg, before, after, resolve(artifactDirectory, 'comparison.png'));
  await copyFile(resolve(artifactDirectory, 'comparison.png'), comparisonFixturePath);
  const metricsJson = `${JSON.stringify({ fixture: document.name, before, after }, null, 2)}\n`;
  await writeFile(metricsFixturePath, metricsJson);
  await writeFile(resolve(artifactDirectory, 'metrics.json'), metricsJson);

  console.log(`Fixture: ${document.name}`);
  console.log(`Objects: ${page.nodes.length} tables, ${page.edges.length} FK edges; locked: ${page.nodes.filter((node) => node.locked).length}`);
  console.log(`Optimizer: ${proposal.movedIds.length} tables moved; score=${proposal.score.toFixed(2)}`);
  console.table({ before, after });
  console.log(`Comparison artifacts: ${artifactDirectory}`);
} finally {
  await vite.close();
}

function makeFixture(modules, tables, relationships) {
  const { createDocument, createNode, createEdge, entityAutoHeight, entityAutoWidth, entityFieldPortOffset } = modules;
  const document = createDocument('Synthetic ERD layout reference (32 tables, 36 FKs)', 'erd');
  const page = document.pages[0];
  document.id = 'doc_erd_layout_generated_reference';
  document.createdAt = 1_730_000_000_000;
  document.updatedAt = 1_730_000_000_000;
  page.id = 'page_erd_layout_generated_reference';
  page.name = 'Generated reference';
  page.settings.width = 3400;
  page.settings.height = 1500;
  page.settings.background = '#ffffff';
  page.settings.canvasTheme = 'light';

  const tableId = (name) => `table_${name}`;
  const primaryKeyId = (name) => `field_${name}_id`;
  const fieldsByTable = new Map(tables.map((name) => [name, [
    { id: primaryKeyId(name), name: 'id', type: 'uuid', primaryKey: true, foreignKey: false, unique: true, nullable: false },
    { id: `field_${name}_name`, name: 'name', type: 'varchar', primaryKey: false, foreignKey: false, unique: false, nullable: false },
    { id: `field_${name}_created_at`, name: 'created_at', type: 'timestamp', primaryKey: false, foreignKey: false, unique: false, nullable: false },
  ]]));
  relationships.forEach(([source, target, fieldName], index) => {
    fieldsByTable.get(source).push({
      id: `field_fk_${index + 1}`,
      name: fieldName,
      type: 'uuid',
      primaryKey: false,
      foreignKey: true,
      unique: false,
      nullable: index % 5 === 0,
      reference: { entityId: tableId(target), fieldId: primaryKeyId(target), constraintId: `constraint_fk_${index + 1}`, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
    });
  });

  const nodesByName = new Map();
  tables.forEach((name, index) => {
    const fields = fieldsByTable.get(name);
    const size = {
      width: Math.max(250, entityAutoWidth(fields, 'key-field-type')),
      height: entityAutoHeight(fields, 'key-field-type', true),
    };
    const slot = (index * 13 + 7) % tables.length;
    const position = { x: 80 + (slot % 8) * 400, y: 80 + Math.floor(slot / 8) * 320 };
    const node = createNode('entity', position, {
      library: 'erd',
      size,
      style: { fill: '#ffffff', stroke: '#111111', strokeWidth: 1.25, radius: 8, textColor: '#111111', fontSize: 13, textWrap: false, autoHeight: false },
      data: { label: name, fields, entityVariant: 'key-field-type', columnHeaders: true, striped: false, headerFill: '#ffffff' },
    });
    node.id = tableId(name);
    nodesByName.set(name, node);
    page.nodes.push(node);
  });

  relationships.forEach(([sourceName, targetName, _fieldName], index) => {
    const source = nodesByName.get(sourceName);
    const target = nodesByName.get(targetName);
    const sourceFieldId = `field_fk_${index + 1}`;
    const sourceFields = fieldsByTable.get(sourceName);
    const sourceFieldIndex = sourceFields.findIndex((field) => field.id === sourceFieldId);
    const targetFieldIndex = 0;
    const nullable = sourceFields[sourceFieldIndex].nullable;
    const edge = createEdge(
      { nodeId: source.id, port: 'right', anchorId: `field-${sourceFieldIndex}-right` },
      { nodeId: target.id, port: 'left', anchorId: `field-${targetFieldIndex}-left` },
      {
        type: 'relationship',
        routing: { mode: 'simple' },
        style: { stroke: '#111111', strokeWidth: 1.4, startMarker: nullable ? 'circle-crowfoot' : 'crowfoot', endMarker: 'bar', jumpStyle: 'arc' },
        data: {
          relationship: 'foreign-key',
          constraintId: `constraint_fk_${index + 1}`,
          sourceFieldId,
          targetFieldId: primaryKeyId(targetName),
          sourceFieldIds: [sourceFieldId],
          targetFieldIds: [primaryKeyId(targetName)],
          cardinality: { source: nullable ? '0..N' : 'N', target: '1' },
        },
      },
    );
    edge.id = `edge_fk_${String(index + 1).padStart(2, '0')}`;
    edge.source.offset = entityFieldPortOffset(sourceFields, sourceFieldIndex, true, source.size.height);
    edge.target.offset = entityFieldPortOffset(fieldsByTable.get(targetName), targetFieldIndex, true, target.size.height);
    page.edges.push(edge);
  });
  return document;
}

function collectMetrics(page, { edgeRoute, edgeRouting, parallelEdgeOffset, parallelRoutingLane }) {
  const nodeById = new Map(page.nodes.map((node) => [node.id, node]));
  const routes = [];
  page.edges.forEach((edge) => {
    const offset = parallelEdgeOffset(edge, page.edges);
    const routedEdge = offset === 0 ? edge : { ...edge, data: { ...edge.data, parallelOffset: offset } };
    const points = edgeRoute(routedEdge, nodeById.get(edge.source.nodeId), nodeById.get(edge.target.nodeId), page.nodes, {
      otherRoutes: routes.map((route) => route.points),
      lane: edgeRouting(edge) === 'orthogonal' ? parallelRoutingLane(edge, page.edges) : undefined,
    });
    routes.push({ edge, points });
  });

  const segments = routes.flatMap(({ edge, points }) => points.slice(0, -1).map((start, index) => ({ edge, start, end: points[index + 1] })));
  let totalLength = 0;
  let turns = 0;
  let blockedSegments = 0;
  let invalidSegments = 0;
  let minimumSegment = Number.POSITIVE_INFINITY;
  let minimumEndpointLead = Number.POSITIVE_INFINITY;
  routes.forEach(({ points }) => {
    if (points.length < 2) {
      minimumEndpointLead = 0;
      return;
    }
    const leadLength = (start, end) => Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    minimumEndpointLead = Math.min(minimumEndpointLead, leadLength(points[0], points[1]), leadLength(points.at(-2), points.at(-1)));
  });
  segments.forEach(({ edge, start, end }, index) => {
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const length = dx + dy;
    totalLength += length;
    minimumSegment = Math.min(minimumSegment, length);
    if (dx > 0.01 && dy > 0.01) invalidSegments += 1;
    const isHorizontal = dy <= 0.01;
    const isVertical = dx <= 0.01;
    const previous = index > 0 ? segments[index - 1] : undefined;
    if (previous?.edge.id === edge.id) {
      const previousHorizontal = Math.abs(previous.end.y - previous.start.y) <= 0.01;
      if (previousHorizontal !== isHorizontal) turns += 1;
    }
    if (isHorizontal || isVertical) {
      const sourceId = edge.source.nodeId;
      const targetId = edge.target.nodeId;
      for (const node of page.nodes) {
        if (node.id === sourceId || node.id === targetId) continue;
        const right = node.position.x + node.size.width;
        const bottom = node.position.y + node.size.height;
        const intersects = isHorizontal
          ? start.y > node.position.y + 0.5 && start.y < bottom - 0.5 && Math.max(start.x, end.x) > node.position.x + 0.5 && Math.min(start.x, end.x) < right - 0.5
          : start.x > node.position.x + 0.5 && start.x < right - 0.5 && Math.max(start.y, end.y) > node.position.y + 0.5 && Math.min(start.y, end.y) < bottom - 0.5;
        if (intersects) { blockedSegments += 1; break; }
      }
    }
  });

  let crossings = 0;
  let overlapLength = 0;
  let nearParallelPairs = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.edge.id === b.edge.id) continue;
      const aHorizontal = Math.abs(a.end.y - a.start.y) <= 0.01;
      const bHorizontal = Math.abs(b.end.y - b.start.y) <= 0.01;
      if (aHorizontal !== bHorizontal) {
        const horizontal = aHorizontal ? a : b;
        const vertical = aHorizontal ? b : a;
        const x = vertical.start.x;
        const y = horizontal.start.y;
        const insideHorizontal = x > Math.min(horizontal.start.x, horizontal.end.x) + 1 && x < Math.max(horizontal.start.x, horizontal.end.x) - 1;
        const insideVertical = y > Math.min(vertical.start.y, vertical.end.y) + 1 && y < Math.max(vertical.start.y, vertical.end.y) - 1;
        if (insideHorizontal && insideVertical) crossings += 1;
        continue;
      }
      const sameAxis = aHorizontal ? Math.abs(a.start.y - b.start.y) : Math.abs(a.start.x - b.start.x);
      const overlap = aHorizontal
        ? Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x)) - Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x))
        : Math.min(Math.max(a.start.y, a.end.y), Math.max(b.start.y, b.end.y)) - Math.max(Math.min(a.start.y, a.end.y), Math.min(b.start.y, b.end.y));
      if (sameAxis <= 0.5 && overlap > 1) overlapLength += overlap;
      else if (sameAxis > 0.5 && sameAxis <= 24 && overlap > 12) nearParallelPairs += 1;
    }
  }

  let overlapPairs = 0;
  let tableCollisions = 0;
  for (let left = 0; left < page.nodes.length; left += 1) {
    for (let right = left + 1; right < page.nodes.length; right += 1) {
      const a = page.nodes[left];
      const b = page.nodes[right];
      const gapX = Math.min(a.position.x + a.size.width, b.position.x + b.size.width) - Math.max(a.position.x, b.position.x);
      const gapY = Math.min(a.position.y + a.size.height, b.position.y + b.size.height) - Math.max(a.position.y, b.position.y);
      if (gapX > 0 && gapY > 0) tableCollisions += 1;
    }
  }
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      if (routes[left].edge.source.nodeId === routes[right].edge.source.nodeId || routes[left].edge.source.nodeId === routes[right].edge.target.nodeId
        || routes[left].edge.target.nodeId === routes[right].edge.source.nodeId || routes[left].edge.target.nodeId === routes[right].edge.target.nodeId) continue;
      // Count relationship pairs with coincident path segments, not just their length.
      const leftSegments = routes[left].points.slice(0, -1).map((start, index) => [start, routes[left].points[index + 1]]);
      const rightSegments = routes[right].points.slice(0, -1).map((start, index) => [start, routes[right].points[index + 1]]);
      if (leftSegments.some(([a, b]) => rightSegments.some(([c, d]) => {
        const horizontal = Math.abs(a.y - b.y) < 0.01 && Math.abs(c.y - d.y) < 0.01;
        const vertical = Math.abs(a.x - b.x) < 0.01 && Math.abs(c.x - d.x) < 0.01;
        if (horizontal) return Math.abs(a.y - c.y) < 0.5 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 1;
        if (vertical) return Math.abs(a.x - c.x) < 0.5 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 1;
        return false;
      }))) overlapPairs += 1;
    }
  }

  const minX = Math.min(...page.nodes.map((node) => node.position.x));
  const minY = Math.min(...page.nodes.map((node) => node.position.y));
  const maxX = Math.max(...page.nodes.map((node) => node.position.x + node.size.width));
  const maxY = Math.max(...page.nodes.map((node) => node.position.y + node.size.height));
  return {
    edges: routes.length,
    routeLength: Math.round(totalLength),
    turns,
    blockedSegments,
    invalidSegments,
    crossings,
    overlapPairs,
    overlapLength: Math.round(overlapLength),
    nearParallelPairs,
    tableCollisions,
    minimumSegment: Number.isFinite(minimumSegment) ? Math.round(minimumSegment * 10) / 10 : 0,
    minimumEndpointLead: Number.isFinite(minimumEndpointLead) ? Math.round(minimumEndpointLead * 10) / 10 : 0,
    layoutArea: Math.round((maxX - minX) * (maxY - minY)),
  };
}

function renderSvg(page, documentToSvg) {
  const padding = 60;
  const minX = Math.min(...page.nodes.map((node) => node.position.x)) - padding;
  const minY = Math.min(...page.nodes.map((node) => node.position.y)) - padding;
  const maxX = Math.max(...page.nodes.map((node) => node.position.x + node.size.width)) + padding;
  const maxY = Math.max(...page.nodes.map((node) => node.position.y + node.size.height)) + padding;
  const viewBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return documentToSvg(page.nodes, page.edges, page.settings.background, viewBox.width, viewBox.height, { viewBox });
}

async function renderComparison(baselineSvg, optimizedSvg, before, after, outputPath) {
  const svgImage = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const metricRows = (metrics) => `<p>Route length ${metrics.routeLength.toLocaleString()} · ${metrics.turns} bends · ${metrics.crossings} crossings · ${metrics.overlapPairs} shared paths · min endpoint lead ${metrics.minimumEndpointLead} · area ${metrics.layoutArea.toLocaleString()}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#e9edf4;color:#202637;font:14px/1.4 Segoe UI,Arial,sans-serif}
    main{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1800px;margin:auto}
    section{min-width:0;padding:18px;background:#fff;border:1px solid #d5dbe5;border-radius:12px}
    h1{margin:0 0 4px;font-size:20px}p{margin:0;color:#566176;font-size:13px}
    img{display:block;width:100%;height:760px;margin-top:14px;object-fit:contain;background:#fff;border:1px solid #e1e5ec}
  </style></head><body><main>
    <section><h1>Before · generated baseline</h1>${metricRows(before)}<img src="${svgImage(baselineSvg)}"></section>
    <section><h1>After · optimized proposal</h1>${metricRows(after)}<img src="${svgImage(optimizedSvg)}"></section>
  </main></body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 920 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await browser.close();
  }
}
