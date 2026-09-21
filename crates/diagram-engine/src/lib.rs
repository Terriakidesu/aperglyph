//! Computational primitives for AperGlyph.
//!
//! The browser worker is the integration boundary.  Keeping these operations in a
//! small, dependency-light crate makes it possible to compile the same geometry
//! for native benchmarks and for wasm-bindgen in production.

use std::cmp::Ordering;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn right(self) -> f64 {
        self.x + self.width
    }
    fn bottom(self) -> f64 {
        self.y + self.height
    }
}

/// Returns whether two axis-aligned rectangles overlap.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn rects_intersect(
    ax: f64,
    ay: f64,
    aw: f64,
    ah: f64,
    bx: f64,
    by: f64,
    bw: f64,
    bh: f64,
) -> bool {
    let a = Rect {
        x: ax,
        y: ay,
        width: aw,
        height: ah,
    };
    let b = Rect {
        x: bx,
        y: by,
        width: bw,
        height: bh,
    };
    a.x < b.right() && a.right() > b.x && a.y < b.bottom() && a.bottom() > b.y
}

/// Snap a coordinate to the nearest grid line. A non-positive grid is a no-op.
#[wasm_bindgen]
pub fn snap_coordinate(value: f64, grid: f64) -> f64 {
    if grid <= 0.0 {
        value
    } else {
        (value / grid).round() * grid
    }
}

/// Euclidean distance between two points.
#[wasm_bindgen]
pub fn distance(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = bx - ax;
    let dy = by - ay;
    (dx * dx + dy * dy).sqrt()
}

/// Return the indexes of rectangles that overlap a viewport.
///
/// `rects` is a packed array of `[x, y, width, height]` values. The flat
/// representation keeps the WASM boundary suitable for batched worker calls.
#[wasm_bindgen]
pub fn query_viewport(rects: &[f64], min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Vec<u32> {
    rects
        .chunks_exact(4)
        .enumerate()
        .filter_map(|(index, rect)| {
            let [x, y, width, height] = [rect[0], rect[1], rect[2], rect[3]];
            let overlaps = x <= max_x && x + width >= min_x && y <= max_y && y + height >= min_y;
            overlaps.then_some(index as u32)
        })
        .collect()
}

/// Rank packed rectangles by their closest distance to a point.
///
/// The worker still uses RBush to find the broad-phase candidates. This batch
/// operation moves the expensive candidate scoring used by snapping out of
/// JavaScript without replacing the spatial index.
#[wasm_bindgen]
pub fn rank_nearby(rects: &[f64], x: f64, y: f64, radius: f64, max_results: u32) -> Vec<u32> {
    let radius_squared = radius.max(0.0).powi(2);
    let mut ranked = rects
        .chunks_exact(4)
        .enumerate()
        .filter_map(|(index, rect)| {
            let [left, top, width, height] = [rect[0], rect[1], rect[2], rect[3]];
            let right = left + width.max(0.0);
            let bottom = top + height.max(0.0);
            let nearest_x = x.max(left).min(right);
            let nearest_y = y.max(top).min(bottom);
            let dx = x - nearest_x;
            let dy = y - nearest_y;
            let distance_squared = dx * dx + dy * dy;
            (distance_squared <= radius_squared).then_some((index, distance_squared))
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then(left.0.cmp(&right.0))
    });
    ranked
        .into_iter()
        .take(max_results as usize)
        .map(|(index, _)| index as u32)
        .collect()
}

/// Layout a graph using deterministic rank-and-sweep placement.
///
/// `sizes` is packed as `[width, height]` per node and `edges` as
/// `[source_index, target_index]` pairs. The returned array is packed as
/// `[x, y]` per node in the original input order. Horizontal mode places
/// ranks left-to-right; vertical mode places them top-to-bottom.
#[wasm_bindgen]
pub fn layout_hierarchy(
    sizes: &[f64],
    edges: &[u32],
    horizontal: bool,
    gap_x: f64,
    gap_y: f64,
) -> Vec<f64> {
    let node_count = sizes.len() / 2;
    if node_count == 0 {
        return Vec::new();
    }

    let mut outgoing = vec![Vec::<usize>::new(); node_count];
    let mut indegree = vec![0usize; node_count];
    for pair in edges.chunks_exact(2) {
        let source = pair[0] as usize;
        let target = pair[1] as usize;
        if source >= node_count || target >= node_count || source == target {
            continue;
        }
        outgoing[source].push(target);
        indegree[target] += 1;
    }

    let mut ranks = vec![usize::MAX; node_count];
    let mut queue = std::collections::VecDeque::new();
    for index in 0..node_count {
        if indegree[index] == 0 {
            ranks[index] = 0;
            queue.push_back(index);
        }
    }
    if queue.is_empty() {
        ranks[0] = 0;
        queue.push_back(0);
    }

    while let Some(source) = queue.pop_front() {
        let next_rank = ranks[source].saturating_add(1);
        for &target in &outgoing[source] {
            ranks[target] = if ranks[target] == usize::MAX {
                next_rank
            } else {
                ranks[target].max(next_rank)
            };
            indegree[target] = indegree[target].saturating_sub(1);
            if indegree[target] == 0 {
                queue.push_back(target);
            }
        }
    }

    let max_rank = ranks
        .iter()
        .filter(|rank| **rank != usize::MAX)
        .copied()
        .max()
        .unwrap_or(0);
    for rank in &mut ranks {
        if *rank == usize::MAX {
            *rank = max_rank.saturating_add(1);
        }
    }

    let max_width = (0..node_count)
        .map(|index| sizes[index * 2].max(0.0))
        .fold(0.0, f64::max);
    let max_height = (0..node_count)
        .map(|index| sizes[index * 2 + 1].max(0.0))
        .fold(0.0, f64::max);
    let step_x = max_width + gap_x.max(0.0);
    let step_y = max_height + gap_y.max(0.0);
    let mut offsets = vec![0usize; max_rank.saturating_add(1)];
    let mut positions = vec![0.0; node_count * 2];
    for index in 0..node_count {
        let rank = ranks[index];
        let offset = offsets[rank];
        offsets[rank] += 1;
        if horizontal {
            positions[index * 2] = rank as f64 * step_x;
            positions[index * 2 + 1] = offset as f64 * step_y;
        } else {
            positions[index * 2] = offset as f64 * step_x;
            positions[index * 2 + 1] = rank as f64 * step_y;
        }
    }
    positions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_intersections() {
        assert!(rects_intersect(0.0, 0.0, 10.0, 10.0, 5.0, 5.0, 10.0, 10.0));
        assert!(!rects_intersect(
            0.0, 0.0, 10.0, 10.0, 10.0, 0.0, 10.0, 10.0
        ));
    }

    #[test]
    fn snaps_to_grid() {
        assert_eq!(snap_coordinate(27.0, 16.0), 32.0);
        assert_eq!(snap_coordinate(27.0, 0.0), 27.0);
    }

    #[test]
    fn queries_packed_viewport_rectangles() {
        let rectangles = [0.0, 0.0, 10.0, 10.0, 40.0, 40.0, 10.0, 10.0];
        assert_eq!(query_viewport(&rectangles, 5.0, 5.0, 20.0, 20.0), vec![0]);
    }

    #[test]
    fn ranks_nearby_rectangles_by_distance() {
        let rectangles = [
            100.0, 100.0, 10.0, 10.0, 0.0, 0.0, 10.0, 10.0, 20.0, 0.0, 10.0, 10.0,
        ];
        assert_eq!(rank_nearby(&rectangles, 5.0, 5.0, 200.0, 2), vec![1, 2]);
    }

    #[test]
    fn lays_out_a_graph_by_rank() {
        let sizes = [100.0, 50.0, 100.0, 50.0, 100.0, 50.0];
        let edges = [0, 1, 1, 2];
        let positions = layout_hierarchy(&sizes, &edges, true, 20.0, 20.0);
        assert_eq!(positions, vec![0.0, 0.0, 120.0, 0.0, 240.0, 0.0]);
    }
}
