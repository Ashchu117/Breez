"""Find a short horizontal preview around the published FAA polygons."""

from collections import defaultdict
from functools import cache
from heapq import heapify, heappop, heappush
from itertools import pairwise
from math import ceil, cos, floor, radians

from app.mission_contracts import Coordinates


# Keep the search bounded, including for routes across the state.
SEARCH_MARGIN = 0.35
MAX_CELLS_PER_AXIS = 110
MIN_LATITUDE_STEP = 0.004
# Match the extent used by scripts/update_faa_airspace.py.
SNAPSHOT_EXTENT = (-87.7, 24.3, -79.8, 31.1)
DIRECTIONS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def edge_cells(start, end, width, height):
    """Yield the column spans touched by a segment in each grid row."""
    ax, ay = start
    bx, by = end
    if ay > by:
        ax, ay, bx, by = bx, by, ax, ay
    for y in range(max(0, ceil(ay) - 1), min(height - 1, floor(by)) + 1):
        if ay == by:
            left, right = sorted((ax, bx))
        else:
            first = ax + (bx - ax) * (max(y, ay) - ay) / (by - ay)
            last = ax + (bx - ax) * (min(y + 1, by) - ay) / (by - ay)
            left, right = sorted((first, last))
        yield y, max(0, ceil(left) - 1), min(width - 1, floor(right))


def mark_polygon(rings, blocked, width, height):
    crossings = defaultdict(list)
    for ring in rings:
        for start, end in pairwise(ring):
            for y, left, right in edge_cells(start, end, width, height):
                blocked.update((x, y) for x in range(left, right + 1))
                # Alternate interior and exterior at row centers, including holes.
                ax, ay = start
                bx, by = end
                scan = y + 0.5
                if (ay > scan) != (by > scan):
                    crossings[y].append(ax + (bx - ax) * (scan - ay) / (by - ay))
    for y, row in crossings.items():
        row.sort()
        for left, right in zip(row[::2], row[1::2]):
            blocked.update((x, y) for x in range(max(0, floor(left)), min(width - 1, floor(right)) + 1))


def route_grid_bounds(start, end):
    west, south, east, north = SNAPSHOT_EXTENT
    return (
        max(west, min(start.lon, end.lon) - SEARCH_MARGIN),
        max(south, min(start.lat, end.lat) - SEARCH_MARGIN),
        min(east, max(start.lon, end.lon) + SEARCH_MARGIN),
        min(north, max(start.lat, end.lat) + SEARCH_MARGIN),
    )


def find_detour(start, end, extent, areas, distance, can_connect):
    west, south, east, north = extent
    longitude_scale = cos(radians((south + north) / 2))
    step = max(MIN_LATITUDE_STEP, (north - south) / MAX_CELLS_PER_AXIS,
               (east - west) * longitude_scale / MAX_CELLS_PER_AXIS)
    lon_step = step / longitude_scale
    width = ceil((east - west) / lon_step)
    height = ceil((north - south) / step)

    def project(lon, lat):
        return (lon - west) / lon_step, (lat - south) / step

    @cache
    def center(cell):
        x, y = cell
        return Coordinates(lon=west + (x + 0.5) * lon_step, lat=south + (y + 0.5) * step)

    blocked = set()
    for area in areas:
        for polygon in area.polygons:
            mark_polygon(([project(*point) for point in ring] for ring in polygon), blocked, width, height)

    def is_open(cell):
        x, y = cell
        return 0 <= x < width and 0 <= y < height and cell not in blocked and (
            south < center(cell).lat < north and west < center(cell).lon < east
        )

    def connections(point):
        projected_x, projected_y = project(point.lon, point.lat)
        x, y = floor(projected_x), floor(projected_y)
        cell = (x, y)
        if is_open(cell):
            return {cell: distance(point, center(cell))}
        # An endpoint can be close to an obstacle without being inside it.
        # Validate the short connector exactly when its own cell is blocked.
        candidates = [(x + dx, y + dy) for dx, dy in DIRECTIONS]
        return {cell: distance(point, center(cell)) for cell in candidates
                if is_open(cell) and can_connect(point, center(cell))}

    starts, ends = connections(start), connections(end)
    if not starts or not ends:
        return None
    costs = dict(starts)
    previous = {cell: None for cell in starts}
    queue = [(cost + distance(center(cell), end), cost, cell) for cell, cost in costs.items()]
    heapify(queue)
    best_end = None
    best_cost = float("inf")

    while queue:
        estimate, cost, cell = heappop(queue)
        if estimate >= best_cost:
            break
        if cost != costs[cell]:
            continue
        if cell in ends:
            best_cost, best_end = cost + ends[cell], cell

        x, y = cell
        for dx, dy in DIRECTIONS:
            neighbor = (x + dx, y + dy)
            if not is_open(neighbor) or (dx and dy and (not is_open((x + dx, y)) or not is_open((x, y + dy)))):
                continue
            total = cost + distance(center(cell), center(neighbor))
            if total < costs.get(neighbor, float("inf")):
                costs[neighbor] = total
                previous[neighbor] = cell
                heappush(queue, (total + distance(center(neighbor), end), total, neighbor))

    if best_end is None:
        return None
    points = [end]
    while best_end is not None:
        points.append(center(best_end))
        best_end = previous[best_end]
    points.append(start)
    points.reverse()

    # Straighten the grid path where the shortcut stays in open cells. The
    # caller independently checks the entire resulting line against the FAA data.
    projected = [project(point.lon, point.lat) for point in points]
    simplified = [start]
    index = 0
    while index < len(points) - 1:
        for target in range(len(points) - 1, index, -1):
            if all((x, y) not in blocked
                   for y, left, right in edge_cells(projected[index], projected[target], width, height)
                   for x in range(left, right + 1)):
                break
        simplified.append(points[target])
        index = target
    return simplified
