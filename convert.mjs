// Converts the Sliven-eparchy shapefiles (WGS84 / UTM zone 34N, EPSG:32634)
// into WGS84 lon/lat GeoJSON for a keyless static Leaflet map.
import * as shapefile from "shapefile";
import proj4 from "proj4";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "D:/Projects/2026_HistoryMap/Exported Files/Exported Files";
const OUT = "D:/Projects/2026_HistoryMap/webapp/data";

const UTM34N = "+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs";
const WEBMERC = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs"; // EPSG:3857
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

const isFinitePair = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);

// ---- point-in-polygon (ray casting), handи MultiPolygon + holes ----
function inRing(pt, ring) {
  const [x, y] = pt; let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInGeom(pt, geom) {
  const parts = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  for (const poly of parts) {
    if (inRing(pt, poly[0])) {
      let inHole = false;
      for (let k = 1; k < poly.length; k++) if (inRing(pt, poly[k])) { inHole = true; break; }
      if (!inHole) return true;
    }
  }
  return false;
}

// recursively reproject a GeoJSON coordinate array with the given source CRS
function reproj(coords, from) {
  if (typeof coords[0] === "number") return proj4(from, WGS84, coords);
  return coords.map((c) => reproj(c, from));
}
function reprojFeature(f, from) {
  if (f.geometry && f.geometry.coordinates)
    f.geometry.coordinates = reproj(f.geometry.coordinates, from);
  return f;
}

async function readShp(name, { filter, from = UTM34N } = {}) {
  const shp = join(SRC, name + ".shp");
  const dbf = join(SRC, name + ".dbf");
  const features = [];
  let skipped = 0;
  const source = await shapefile.open(shp, dbf, { encoding: "utf-8" });
  let r;
  while (!(r = await source.read()).done) {
    const f = r.value;
    if (filter && !filter(f.properties)) continue;
    if (!f.geometry || !f.geometry.coordinates) { skipped++; continue; }
    const g = f.geometry;
    // drop point features with missing/invalid coords (null geometry in source)
    if (g.type === "Point" && !isFinitePair(g.coordinates)) { skipped++; continue; }
    const out = reprojFeature(f, from);
    if (out.geometry.type === "Point" && !isFinitePair(out.geometry.coordinates)) { skipped++; continue; }
    features.push(out);
  }
  if (skipped) console.log(`  [${name}] skipped ${skipped} feature(s) with invalid geometry`);
  return { type: "FeatureCollection", features };
}

function bbox(fc) {
  let xmin = 180, ymin = 90, xmax = -180, ymax = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      xmin = Math.min(xmin, c[0]); xmax = Math.max(xmax, c[0]);
      ymin = Math.min(ymin, c[1]); ymax = Math.max(ymax, c[1]);
    } else c.forEach(walk);
  };
  fc.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  return [xmin, ymin, xmax, ymax];
}

// Територия, клипната по държавната граница на България (следва брега/границата)
const eparhiya = await readShp("Sliven_Eparhiya_boundaries");
const monasteries = await readShp("manastiri_eparhii", {
  filter: (p) => (p.Eparhiya || "").trim() === "Сливен",
});

// Църкви: BG_Eparhii_Settlements, филтър по епархия; чисти имена на полета за попъп
const churchesRaw = await readShp("BG_Eparhii_Settlements", {
  from: WEBMERC,
  filter: (p) => (p.FIELD_NAME || "").trim() === "Сливенска епархия",
});
// отхвърли точки извън разумния обхват на България (null/невалидна геометрия в източника)
const inBG = (f) => {
  const [x, y] = f.geometry.coordinates;
  return x >= 22 && x <= 29 && y >= 41 && y <= 44.5;
};
const epGeom = eparhiya.features[0].geometry;
const validChurch = churchesRaw.features
  .filter(inBG)
  .filter((f) => pointInGeom(f.geometry.coordinates, epGeom)); // клип по границата на епархията (маха напр. гр. Твърдица)
console.log(`  [churches] kept ${validChurch.length}/${churchesRaw.features.length} inside eparchy boundary`);

const churches = {
  type: "FeatureCollection",
  features: validChurch.map((f) => {
    const p = f.properties;
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        selo: (p.FIELD_NA_2 || "").trim(),        // населено място
        namestnichestvo: (p.FIELD_NA_1 || "").trim(), // наместничество
        obshtina: (p.FIELD_NA_4 || "").trim(),    // община
        oblast: (p.FIELD_NA_3 || "").trim(),      // област
        adres: (p.FIELD_NA_5 || "").trim(),       // пълен адрес
        tip: (p.FIELD_NA_6 || "").trim(),         // село/град/център
      },
    };
  }),
};

writeFileSync(join(OUT, "eparhiya.geojson"), JSON.stringify(eparhiya));
writeFileSync(join(OUT, "monasteries.geojson"), JSON.stringify(monasteries));
writeFileSync(join(OUT, "churches.geojson"), JSON.stringify(churches));

// data.js — вгражда се в index.html чрез <script src> (работи и при двоен клик, за разлика от fetch)
const dataJs =
  "window.EPARHIYA=" + JSON.stringify(eparhiya) + ";\n" +
  "window.MONASTERIES=" + JSON.stringify(monasteries) + ";\n" +
  "window.CHURCHES=" + JSON.stringify(churches) + ";\n";
writeFileSync("D:/Projects/2026_HistoryMap/webapp/data.js", dataJs);

console.log("eparhiya  features:", eparhiya.features.length, "bbox:", bbox(eparhiya).map((n) => n.toFixed(4)).join(", "));
console.log("monasteries features:", monasteries.features.length, "bbox:", bbox(monasteries).map((n) => n.toFixed(4)).join(", "));
console.log("churches  features:", churches.features.length, "bbox:", bbox(churches).map((n) => n.toFixed(4)).join(", "));
console.log("church sample:", JSON.stringify(churches.features.slice(0,3).map(f=>f.properties), null, 0));
