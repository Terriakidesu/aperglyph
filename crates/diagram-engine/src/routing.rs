use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

const EPSILON: f64 = 0.001;
const MIN_SEGMENT_LENGTH: f64 = 12.0;
const ROUTING_LANE_SPACING: f64 = 16.0;

#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Clone, Copy, Debug)]
struct Neighbor {
    point: usize,
    direction: usize,
}

#[derive(Clone, Copy, Debug)]
struct QueueEntry {
    state: usize,
    priority: f64,
    order: u64,
}

impl PartialEq for QueueEntry {
    fn eq(&self, other: &Self) -> bool {
        self.state == other.state && self.priority == other.priority && self.order == other.order
    }
}

impl Eq for QueueEntry {}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .priority
            .total_cmp(&self.priority)
            .then_with(|| other.order.cmp(&self.order))
    }
}

/// Find an obstacle-clear orthogonal path. Rectangles are packed as
/// `[left, top, right, bottom]`; route segments as `[x1, y1, x2, y2]`.
#[allow(clippy::too_many_arguments)]
pub fn route_orthogonal(
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    obstacles: &[f64],
    other_routes: &[f64],
    previous_route: &[f64],
    simple_routing: bool,
    lane_index: i32,
    lane_count: u32,
    lane_spacing: f64,
    soft_constraints: &[f64],
) -> Vec<f64> {
    let start = Point {
        x: start_x,
        y: start_y,
    };
    let end = Point { x: end_x, y: end_y };
    if !finite_point(start) || !finite_point(end) {
        return Vec::new();
    }
    if same_point(start, end) {
        return vec![start.x, start.y];
    }

    let rectangles = obstacles
        .chunks_exact(4)
        .filter_map(|rect| {
            let value = Rect {
                left: rect[0],
                top: rect[1],
                right: rect[2],
                bottom: rect[3],
            };
            (value.left.is_finite()
                && value.top.is_finite()
                && value.right.is_finite()
                && value.bottom.is_finite()
                && value.right >= value.left
                && value.bottom >= value.top)
                .then_some(value)
        })
        .collect::<Vec<_>>();
    let route_segments = unpack_segments(other_routes);
    let previous_segments = unpack_segments(previous_route);
    let constraints = soft_constraints
        .chunks_exact(2)
        .filter_map(|constraint| {
            let axis = constraint[0].round() as i32;
            (constraint[1].is_finite() && (axis == 0 || axis == 1)).then_some((axis, constraint[1]))
        })
        .collect::<Vec<_>>();

    let points = build_points(
        start,
        end,
        &rectangles,
        &route_segments,
        lane_index,
        lane_count,
        lane_spacing,
    );
    let Some(start_index) = points.iter().position(|point| same_point(*point, start)) else {
        return Vec::new();
    };
    let Some(goal_index) = points.iter().position(|point| same_point(*point, end)) else {
        return Vec::new();
    };
    let graph = build_visibility_graph(&points, &rectangles);
    let state_count = points.len().saturating_mul(5);
    let initial_state = start_index * 5 + 4;
    let mut distances = vec![f64::INFINITY; state_count];
    let mut parents = vec![usize::MAX; state_count];
    distances[initial_state] = 0.0;
    let mut open = BinaryHeap::new();
    let mut order = 0u64;
    open.push(QueueEntry {
        state: initial_state,
        priority: manhattan(start, end),
        order,
    });
    order += 1;
    let max_expansions = 2000usize.max(points.len().saturating_mul(4));
    let mut expansions = 0usize;

    while let Some(current) = open.pop() {
        let current_point_index = current.state / 5;
        let current_direction = current.state % 5;
        let current_point = points[current_point_index];
        let score = distances[current.state];
        if current.priority > score + manhattan(current_point, end) + EPSILON {
            continue;
        }
        if current_point_index == goal_index {
            return reconstruct(current.state, &parents, &points);
        }
        expansions += 1;
        if expansions > max_expansions {
            break;
        }

        for neighbor in &graph[current_point_index] {
            let next_point = points[neighbor.point];
            let length = manhattan(current_point, next_point);
            let mut step_cost = length;
            if length > EPSILON && length < MIN_SEGMENT_LENGTH {
                step_cost += 36.0;
            }
            if current_direction < 4 && current_direction != neighbor.direction {
                step_cost += 42.0;
                if opposite(current_direction) == neighbor.direction {
                    step_cost += 28.0;
                }
            }
            step_cost +=
                route_segment_penalty(current_point, next_point, &route_segments, simple_routing);
            step_cost += soft_constraint_penalty(current_point, next_point, &constraints);
            step_cost += route_change_penalty(current_point, next_point, &previous_segments);

            let next_state = neighbor.point * 5 + neighbor.direction;
            let next_score = score + step_cost;
            if next_score >= distances[next_state] {
                continue;
            }
            distances[next_state] = next_score;
            parents[next_state] = current.state;
            open.push(QueueEntry {
                state: next_state,
                priority: next_score + manhattan(next_point, end),
                order,
            });
            order += 1;
        }
    }
    Vec::new()
}

fn build_points(
    start: Point,
    end: Point,
    obstacles: &[Rect],
    routes: &[(Point, Point)],
    lane_index: i32,
    lane_count: u32,
    lane_spacing: f64,
) -> Vec<Point> {
    let mut points = Vec::new();
    let mut keys = HashSet::new();
    add_point(start, obstacles, &mut points, &mut keys);
    add_point(end, obstacles, &mut points, &mut keys);
    for rect in obstacles {
        add_point(
            Point {
                x: rect.left,
                y: rect.top,
            },
            obstacles,
            &mut points,
            &mut keys,
        );
        add_point(
            Point {
                x: rect.right,
                y: rect.top,
            },
            obstacles,
            &mut points,
            &mut keys,
        );
        add_point(
            Point {
                x: rect.right,
                y: rect.bottom,
            },
            obstacles,
            &mut points,
            &mut keys,
        );
        add_point(
            Point {
                x: rect.left,
                y: rect.bottom,
            },
            obstacles,
            &mut points,
            &mut keys,
        );
    }
    add_parallel_channels(routes, start, end, obstacles, &mut points, &mut keys);

    let passes = if routes.is_empty() { 2 } else { 1 };
    for _ in 0..passes {
        let seeds = points.clone();
        for rect in obstacles {
            for seed in &seeds {
                add_point(
                    Point {
                        x: rect.left,
                        y: seed.y,
                    },
                    obstacles,
                    &mut points,
                    &mut keys,
                );
                add_point(
                    Point {
                        x: rect.right,
                        y: seed.y,
                    },
                    obstacles,
                    &mut points,
                    &mut keys,
                );
                add_point(
                    Point {
                        x: seed.x,
                        y: rect.top,
                    },
                    obstacles,
                    &mut points,
                    &mut keys,
                );
                add_point(
                    Point {
                        x: seed.x,
                        y: rect.bottom,
                    },
                    obstacles,
                    &mut points,
                    &mut keys,
                );
            }
        }
    }

    if lane_count > 1 && lane_index >= 0 {
        let offset = (lane_index as f64 - (lane_count as f64 - 1.0) / 2.0)
            * if lane_spacing > 0.0 {
                lane_spacing
            } else {
                ROUTING_LANE_SPACING
            };
        if same_y(start, end) {
            add_point(
                Point {
                    x: start.x,
                    y: start.y + offset,
                },
                obstacles,
                &mut points,
                &mut keys,
            );
            add_point(
                Point {
                    x: end.x,
                    y: end.y + offset,
                },
                obstacles,
                &mut points,
                &mut keys,
            );
        } else if same_x(start, end) {
            add_point(
                Point {
                    x: start.x + offset,
                    y: start.y,
                },
                obstacles,
                &mut points,
                &mut keys,
            );
            add_point(
                Point {
                    x: end.x + offset,
                    y: end.y,
                },
                obstacles,
                &mut points,
                &mut keys,
            );
        }
    }
    points
}

fn add_parallel_channels(
    routes: &[(Point, Point)],
    start: Point,
    end: Point,
    obstacles: &[Rect],
    points: &mut Vec<Point>,
    keys: &mut HashSet<(i64, i64)>,
) {
    for (route_start, route_end) in routes {
        if same_y(*route_start, *route_end) && !same_x(*route_start, *route_end) {
            for offset in [-ROUTING_LANE_SPACING, ROUTING_LANE_SPACING] {
                for point in [
                    Point {
                        x: route_start.x,
                        y: start.y,
                    },
                    Point {
                        x: route_end.x,
                        y: end.y,
                    },
                    Point {
                        x: route_start.x,
                        y: route_start.y + offset,
                    },
                    Point {
                        x: route_end.x,
                        y: route_end.y + offset,
                    },
                    Point {
                        x: route_start.x + offset,
                        y: start.y,
                    },
                    Point {
                        x: route_end.x + offset,
                        y: end.y,
                    },
                ] {
                    add_point(point, obstacles, points, keys);
                }
            }
        } else if same_x(*route_start, *route_end) && !same_y(*route_start, *route_end) {
            for offset in [-ROUTING_LANE_SPACING, ROUTING_LANE_SPACING] {
                for point in [
                    Point {
                        x: start.x,
                        y: route_start.y,
                    },
                    Point {
                        x: end.x,
                        y: route_end.y,
                    },
                    Point {
                        x: route_start.x + offset,
                        y: route_start.y,
                    },
                    Point {
                        x: route_end.x + offset,
                        y: route_end.y,
                    },
                    Point {
                        x: start.x,
                        y: route_start.y + offset,
                    },
                    Point {
                        x: end.x,
                        y: route_end.y + offset,
                    },
                ] {
                    add_point(point, obstacles, points, keys);
                }
            }
        }
    }
}

fn add_point(
    point: Point,
    obstacles: &[Rect],
    points: &mut Vec<Point>,
    keys: &mut HashSet<(i64, i64)>,
) {
    if !finite_point(point) || blocked_point(point, obstacles) {
        return;
    }
    let key = (coordinate_key(point.x), coordinate_key(point.y));
    if keys.insert(key) {
        points.push(point);
    }
}

fn build_visibility_graph(points: &[Point], obstacles: &[Rect]) -> Vec<Vec<Neighbor>> {
    let mut graph = vec![Vec::new(); points.len()];
    let mut horizontal = HashMap::<i64, Vec<usize>>::new();
    let mut vertical = HashMap::<i64, Vec<usize>>::new();
    for (index, point) in points.iter().enumerate() {
        horizontal
            .entry(coordinate_key(point.y))
            .or_default()
            .push(index);
        vertical
            .entry(coordinate_key(point.x))
            .or_default()
            .push(index);
    }
    for line in horizontal.values_mut() {
        line.sort_by(|left, right| {
            points[*left]
                .x
                .total_cmp(&points[*right].x)
                .then(left.cmp(right))
        });
        connect_visible_neighbors(line, points, obstacles, &mut graph, true);
    }
    for line in vertical.values_mut() {
        line.sort_by(|left, right| {
            points[*left]
                .y
                .total_cmp(&points[*right].y)
                .then(left.cmp(right))
        });
        connect_visible_neighbors(line, points, obstacles, &mut graph, false);
    }
    graph
}

fn connect_visible_neighbors(
    line: &[usize],
    points: &[Point],
    obstacles: &[Rect],
    graph: &mut [Vec<Neighbor>],
    horizontal: bool,
) {
    for (index, point_index) in line.iter().copied().enumerate() {
        connect_side(
            line,
            index,
            -1,
            point_index,
            points,
            obstacles,
            graph,
            horizontal,
        );
        connect_side(
            line,
            index,
            1,
            point_index,
            points,
            obstacles,
            graph,
            horizontal,
        );
    }
}

fn connect_side(
    line: &[usize],
    index: usize,
    step: isize,
    point_index: usize,
    points: &[Point],
    obstacles: &[Rect],
    graph: &mut [Vec<Neighbor>],
    horizontal: bool,
) {
    let mut cursor = index as isize + step;
    let mut connected = 0;
    while cursor >= 0 && (cursor as usize) < line.len() && connected < 2 {
        let candidate = line[cursor as usize];
        if clear_segment(points[point_index], points[candidate], obstacles) {
            let direction = match (horizontal, step < 0) {
                (true, true) => 0,
                (true, false) => 1,
                (false, true) => 2,
                (false, false) => 3,
            };
            graph[point_index].push(Neighbor {
                point: candidate,
                direction,
            });
            connected += 1;
        }
        cursor += step;
    }
}

fn route_segment_penalty(from: Point, to: Point, routes: &[(Point, Point)], simple: bool) -> f64 {
    let overlap_base = if simple { 160.0 } else { 900.0 };
    let overlap_scale = if simple { 0.7 } else { 2.0 };
    let crossing_cost = if simple { 16.0 } else { 220.0 };
    let mut penalty = 0.0;
    for (existing_start, existing_end) in routes {
        let overlap = overlapping_length(from, to, *existing_start, *existing_end);
        if overlap > EPSILON {
            penalty += overlap_base + overlap * overlap_scale;
        } else if segments_cross(from, to, *existing_start, *existing_end) {
            penalty += crossing_cost;
        } else if let Some(separation) =
            parallel_segment_separation(from, to, *existing_start, *existing_end)
        {
            if separation < ROUTING_LANE_SPACING + 4.0 {
                penalty += 24.0 + (ROUTING_LANE_SPACING + 4.0 - separation) * 4.0;
            }
        }
    }
    penalty
}

fn soft_constraint_penalty(from: Point, to: Point, constraints: &[(i32, f64)]) -> f64 {
    (constraints.len() as f64 - matched_soft_constraints(from, to, constraints)) * 18.0
}

fn matched_soft_constraints(from: Point, to: Point, constraints: &[(i32, f64)]) -> f64 {
    constraints
        .iter()
        .filter(|(axis, value)| {
            if *axis == 0 {
                (same_x(from, to) && almost_equal(from.x, *value))
                    || (from.x.min(to.x) <= *value && from.x.max(to.x) >= *value)
            } else {
                (same_y(from, to) && almost_equal(from.y, *value))
                    || (from.y.min(to.y) <= *value && from.y.max(to.y) >= *value)
            }
        })
        .count() as f64
}

fn route_change_penalty(from: Point, to: Point, previous: &[(Point, Point)]) -> f64 {
    let matches = previous.iter().any(|(start, end)| {
        segments_overlap(from, to, *start, *end)
            || axis_segment_distance(from, to, *start, *end) <= 2.0
    });
    if matches || previous.is_empty() {
        0.0
    } else {
        12.0
    }
}

fn overlapping_length(a: Point, b: Point, c: Point, d: Point) -> f64 {
    if same_y(a, b) && same_y(c, d) && almost_equal(a.y, c.y) {
        return (a.x.max(b.x).min(c.x.max(d.x)) - a.x.min(b.x).max(c.x.min(d.x))).max(0.0);
    }
    if same_x(a, b) && same_x(c, d) && almost_equal(a.x, c.x) {
        return (a.y.max(b.y).min(c.y.max(d.y)) - a.y.min(b.y).max(c.y.min(d.y))).max(0.0);
    }
    0.0
}

fn segments_overlap(a: Point, b: Point, c: Point, d: Point) -> bool {
    overlapping_length(a, b, c, d) > EPSILON
}

fn segments_cross(a: Point, b: Point, c: Point, d: Point) -> bool {
    let a_horizontal = same_y(a, b);
    let c_horizontal = same_y(c, d);
    if a_horizontal == c_horizontal {
        return false;
    }
    let (horizontal_start, horizontal_end, vertical_start, vertical_end) = if a_horizontal {
        (a, b, c, d)
    } else {
        (c, d, a, b)
    };
    strictly_between(vertical_start.x, horizontal_start.x, horizontal_end.x)
        && strictly_between(horizontal_start.y, vertical_start.y, vertical_end.y)
}

fn parallel_segment_separation(a: Point, b: Point, c: Point, d: Point) -> Option<f64> {
    if same_y(a, b) && same_y(c, d) {
        let overlap = a.x.max(b.x).min(c.x.max(d.x)) - a.x.min(b.x).max(c.x.min(d.x));
        return (overlap > EPSILON).then_some((a.y - c.y).abs());
    }
    if same_x(a, b) && same_x(c, d) {
        let overlap = a.y.max(b.y).min(c.y.max(d.y)) - a.y.min(b.y).max(c.y.min(d.y));
        return (overlap > EPSILON).then_some((a.x - c.x).abs());
    }
    None
}

fn axis_segment_distance(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let a_horizontal = same_y(a, b);
    let a_vertical = same_x(a, b);
    let c_horizontal = same_y(c, d);
    let c_vertical = same_x(c, d);
    if (!a_horizontal && !a_vertical) || (!c_horizontal && !c_vertical) {
        return distance(a, c)
            .min(distance(a, d))
            .min(distance(b, c))
            .min(distance(b, d));
    }
    if a_horizontal && c_horizontal {
        if a.x.max(b.x).min(c.x.max(d.x)) >= a.x.min(b.x).max(c.x.min(d.x)) {
            return (a.y - c.y).abs();
        }
        return (a.x - d.x).abs().min((c.x - b.x).abs());
    }
    if a_vertical && c_vertical {
        if a.y.max(b.y).min(c.y.max(d.y)) >= a.y.min(b.y).max(c.y.min(d.y)) {
            return (a.x - c.x).abs();
        }
        return (a.y - d.y).abs().min((c.y - b.y).abs());
    }
    let (horizontal_start, horizontal_end, vertical_start, vertical_end) = if a_horizontal {
        (a, b, c, d)
    } else {
        (c, d, a, b)
    };
    let x_min = horizontal_start.x.min(horizontal_end.x);
    let x_max = horizontal_start.x.max(horizontal_end.x);
    let y_min = vertical_start.y.min(vertical_end.y);
    let y_max = vertical_start.y.max(vertical_end.y);
    let dx = if vertical_start.x < x_min {
        x_min - vertical_start.x
    } else if vertical_start.x > x_max {
        vertical_start.x - x_max
    } else {
        0.0
    };
    let dy = if horizontal_start.y < y_min {
        y_min - horizontal_start.y
    } else if horizontal_start.y > y_max {
        horizontal_start.y - y_max
    } else {
        0.0
    };
    (dx * dx + dy * dy).sqrt()
}

fn clear_segment(a: Point, b: Point, obstacles: &[Rect]) -> bool {
    if !same_x(a, b) && !same_y(a, b) {
        return false;
    }
    !obstacles.iter().any(|rect| {
        if same_y(a, b) {
            a.y > rect.top + EPSILON
                && a.y < rect.bottom - EPSILON
                && a.x.max(b.x) > rect.left + EPSILON
                && a.x.min(b.x) < rect.right - EPSILON
        } else {
            a.x > rect.left + EPSILON
                && a.x < rect.right - EPSILON
                && a.y.max(b.y) > rect.top + EPSILON
                && a.y.min(b.y) < rect.bottom - EPSILON
        }
    })
}

fn blocked_point(point: Point, obstacles: &[Rect]) -> bool {
    obstacles.iter().any(|rect| {
        point.x > rect.left + EPSILON
            && point.x < rect.right - EPSILON
            && point.y > rect.top + EPSILON
            && point.y < rect.bottom - EPSILON
    })
}

fn reconstruct(goal_state: usize, parents: &[usize], points: &[Point]) -> Vec<f64> {
    let mut route = Vec::new();
    let mut state = goal_state;
    loop {
        let point = points[state / 5];
        route.push(point);
        let parent = parents[state];
        if parent == usize::MAX {
            break;
        }
        state = parent;
    }
    route.reverse();
    let mut packed = Vec::with_capacity(route.len() * 2);
    for point in route {
        packed.push(point.x);
        packed.push(point.y);
    }
    packed
}

fn unpack_segments(packed: &[f64]) -> Vec<(Point, Point)> {
    packed
        .chunks_exact(4)
        .filter_map(|segment| {
            let start = Point {
                x: segment[0],
                y: segment[1],
            };
            let end = Point {
                x: segment[2],
                y: segment[3],
            };
            (finite_point(start) && finite_point(end)).then_some((start, end))
        })
        .collect()
}

fn opposite(direction: usize) -> usize {
    match direction {
        0 => 1,
        1 => 0,
        2 => 3,
        _ => 2,
    }
}

fn strictly_between(value: f64, first: f64, second: f64) -> bool {
    value > first.min(second) && value < first.max(second)
}

fn coordinate_key(value: f64) -> i64 {
    (value * 1000.0).round() as i64
}

fn same_point(a: Point, b: Point) -> bool {
    almost_equal(a.x, b.x) && almost_equal(a.y, b.y)
}

fn same_x(a: Point, b: Point) -> bool {
    almost_equal(a.x, b.x)
}

fn same_y(a: Point, b: Point) -> bool {
    almost_equal(a.y, b.y)
}

fn almost_equal(a: f64, b: f64) -> bool {
    (a - b).abs() < EPSILON
}

fn finite_point(point: Point) -> bool {
    point.x.is_finite() && point.y.is_finite()
}

fn manhattan(a: Point, b: Point) -> f64 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

fn distance(a: Point, b: Point) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(points: &[f64]) -> Vec<Point> {
        points
            .chunks_exact(2)
            .map(|point| Point {
                x: point[0],
                y: point[1],
            })
            .collect()
    }

    #[test]
    fn selects_the_shorter_clear_corridor() {
        let result = route_orthogonal(
            0.0,
            70.0,
            100.0,
            70.0,
            &[24.0, 14.0, 76.0, 106.0],
            &[],
            &[],
            true,
            -1,
            0,
            16.0,
            &[],
        );
        let points = route(&result);
        assert_eq!(
            points.first().map(|point| (point.x, point.y)),
            Some((0.0, 70.0))
        );
        assert_eq!(
            points.last().map(|point| (point.x, point.y)),
            Some((100.0, 70.0))
        );
        assert!(points.iter().any(|point| point.y > 100.0));
        assert!(
            points
                .iter()
                .all(|point| point.y >= 106.0 || point.y <= 14.0 || point.y == 70.0)
        );
    }

    #[test]
    fn routes_around_a_blocked_two_bend_corridor() {
        let obstacles = [
            134.0, 64.0, 266.0, 136.0, -21.0, -16.0, 21.0, 96.0, -21.0, 104.0, 21.0, 216.0, 379.0,
            -16.0, 421.0, 96.0, 379.0, 104.0, 421.0, 216.0,
        ];
        let result = route_orthogonal(
            0.0,
            100.0,
            400.0,
            100.0,
            &obstacles,
            &[],
            &[],
            true,
            -1,
            0,
            16.0,
            &[],
        );
        let points = route(&result);
        assert!(points.len() > 4, "{points:?}");
        assert!(points.windows(2).all(|segment| clear_segment(
            segment[0],
            segment[1],
            &obstacles_rects(&obstacles)
        )));
    }

    #[test]
    fn avoids_an_occupied_path_when_a_short_parallel_route_is_available() {
        let occupied = [0.0, 50.0, 100.0, 50.0];
        let result = route_orthogonal(
            0.0,
            50.0,
            100.0,
            150.0,
            &[],
            &occupied,
            &[],
            true,
            -1,
            0,
            16.0,
            &[],
        );
        let points = route(&result);
        assert!(points.windows(2).all(|segment| {
            !same_y(segment[0], segment[1]) || !almost_equal(segment[0].y, 50.0)
        }));
        assert!(points.len() >= 3);
    }

    fn obstacles_rects(values: &[f64]) -> Vec<Rect> {
        values
            .chunks_exact(4)
            .map(|rect| Rect {
                left: rect[0],
                top: rect[1],
                right: rect[2],
                bottom: rect[3],
            })
            .collect()
    }
}
