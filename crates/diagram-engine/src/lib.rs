//! Computational primitives for AperGlyph.
//!
//! The browser worker is the integration boundary.  Keeping these operations in a
//! small, dependency-light crate makes it possible to compile the same geometry
//! for native benchmarks and for wasm-bindgen in production.

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
}
