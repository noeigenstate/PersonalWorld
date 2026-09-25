"""Make the small, attributed OSM snapshot used by the Shanghai scene.

Usage: python scripts/extract_shanghai_scene.py [local.osm]
Requires shapely. Without an argument, downloads the bounding box from the OSM API.
The output keeps WGS84 coordinates; the browser converts them to AMap's GCJ02.
"""

from __future__ import annotations

import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely.geometry import LineString, Polygon, box
from shapely.ops import polygonize, unary_union


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/map/data/shanghai-pearl.json"
BBOX = (121.486, 31.234, 121.505, 31.251)
CLIP = box(*BBOX)
API = "https://www.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, BBOX))


def parts(geometry, wanted):
    if geometry.is_empty:
        return
    if geometry.geom_type == wanted:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from parts(child, wanted)


def points(coords):
    return [[round(x, 6), round(y, 6)] for x, y in coords]


def main():
    if len(sys.argv) > 1:
        source = Path(sys.argv[1]).read_bytes()
    else:
        request = urllib.request.Request(API, headers={"Accept-Encoding": "identity", "User-Agent": "PersonalWorldScenePrototype/0.1"})
        source = urllib.request.urlopen(request, timeout=40).read()
    root = ET.fromstring(source)
    nodes = {node.get("id"): (float(node.get("lon")), float(node.get("lat"))) for node in root.findall("node")}
    result = {"source": "OpenStreetMap contributors", "license": "ODbL-1.0", "bbox": list(BBOX), "buildings": [], "roads": [], "water": [], "green": [], "landuse": [], "plazas": [], "treeRows": []}
    way_paths = {
        way.get("id"): [nodes[ref] for nd in way.findall("nd") if (ref := nd.get("ref")) in nodes]
        for way in root.findall("way")
    }

    for way in root.findall("way"):
        tags = {tag.get("k"): tag.get("v") for tag in way.findall("tag")}
        ident = way.get("id")
        path = way_paths[ident]
        if len(path) < 2:
            continue
        closed = len(path) >= 4 and path[0] == path[-1]
        if closed and ("building" in tags or tags.get("natural") == "water" or tags.get("landuse") in {"grass", "forest", "meadow", "recreation_ground"} or tags.get("leisure") in {"park", "garden"}):
            polygon = Polygon(path)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            kind = "buildings" if "building" in tags else "water" if tags.get("natural") == "water" else "green"
            for piece in parts(polygon.intersection(CLIP), "Polygon"):
                if piece.area < (0.000004 if kind == "buildings" else 0.000015) ** 2:
                    continue
                piece = piece.simplify(0.000009, preserve_topology=True)
                entry = {"id": ident, "rings": [points(piece.exterior.coords)] + [points(hole.coords) for hole in piece.interiors]}
                if kind == "buildings":
                    entry["height"] = tags.get("height")
                    entry["levels"] = tags.get("building:levels")
                result[kind].append(entry)
        if closed and tags.get("landuse") in {"commercial", "retail", "residential", "brownfield"}:
            polygon = Polygon(path)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            for piece in parts(polygon.intersection(CLIP), "Polygon"):
                if piece.area < 0.000015 ** 2:
                    continue
                piece = piece.simplify(0.000009, preserve_topology=True)
                result["landuse"].append({"id": ident, "kind": tags["landuse"], "rings": [points(piece.exterior.coords)] + [points(hole.coords) for hole in piece.interiors]})
        if closed and tags.get("highway") == "pedestrian" and tags.get("area") == "yes":
            polygon = Polygon(path)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            for piece in parts(polygon.intersection(CLIP), "Polygon"):
                if piece.area < 0.000015 ** 2:
                    continue
                piece = piece.simplify(0.000009, preserve_topology=True)
                result["plazas"].append({"id": ident, "rings": [points(piece.exterior.coords)] + [points(hole.coords) for hole in piece.interiors]})
        if "highway" in tags and tags["highway"] not in {"steps", "construction", "proposed", "platform", "corridor"}:
            line = LineString(path).intersection(CLIP)
            for piece in parts(line, "LineString"):
                piece = piece.simplify(0.000012, preserve_topology=True)
                if piece.length >= 0.000035:
                    result["roads"].append({"id": ident, "class": tags["highway"], "path": points(piece.coords)})
        if tags.get("natural") == "tree_row":
            line = LineString(path).intersection(CLIP)
            for piece in parts(line, "LineString"):
                if piece.length >= 0.000035:
                    result["treeRows"].append({"id": ident, "path": points(piece.simplify(0.000006, preserve_topology=True).coords)})

    # The map API includes multipolygon relations, but their park outlines are often
    # split across several ways. Only use relations whose complete boundaries are present.
    for relation in root.findall("relation"):
        tags = {tag.get("k"): tag.get("v") for tag in relation.findall("tag")}
        if tags.get("type") != "multipolygon" or tags.get("leisure") not in {"park", "garden"}:
            continue
        members = [member for member in relation.findall("member") if member.get("type") == "way"]
        if not members or any(len(way_paths.get(member.get("ref"), [])) < 2 for member in members):
            continue
        outlines = [LineString(way_paths[member.get("ref")]) for member in members if member.get("role") == "outer"]
        cutouts = [LineString(way_paths[member.get("ref")]) for member in members if member.get("role") == "inner"]
        if not outlines:
            continue
        outer_polygons = list(polygonize(unary_union(outlines)))
        inner_polygons = list(polygonize(unary_union(cutouts))) if cutouts else []
        for outer in outer_polygons:
            holes = [hole.exterior.coords for hole in inner_polygons if outer.contains(hole.representative_point())]
            polygon = Polygon(outer.exterior.coords, holes)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            for piece in parts(polygon.intersection(CLIP), "Polygon"):
                if piece.area < 0.000015 ** 2:
                    continue
                piece = piece.simplify(0.000009, preserve_topology=True)
                result["green"].append({"id": "r" + relation.get("id"), "rings": [points(piece.exterior.coords)] + [points(hole.coords) for hole in piece.interiors]})

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print({key: len(result[key]) for key in ("buildings", "roads", "water", "green", "landuse", "plazas", "treeRows")})
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
