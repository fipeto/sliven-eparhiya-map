// Converts the Sliven-eparchy shapefiles (WGS84 / UTM zone 34N, EPSG:32634)
// into WGS84 lon/lat GeoJSON for a keyless static Leaflet map.
import * as shapefile from "shapefile";
import proj4 from "proj4";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "D:/Projects/2026_HistoryMap/Exported Files/Exported Files";
const OUT = "D:/Projects/2026_HistoryMap/webapp/data";

const UTM34N = "+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const toWgs = (c) => proj4(UTM34N, WGS84, c);

// recursively reproject a GeoJSON coordinate array
function reproj(coords) {
  if (typeof coords[0] === "number") return toWgs(coords);
  return coords.map(reproj);
}
function reprojFeature(f) {
  if (f.geometry && f.geometry.coordinates)
    f.geometry.coordinates = reproj(f.geometry.coordinates);
  return f;
}

async function readShp(name, { filter } = {}) {
  const shp = join(SRC, name + ".shp");
  const dbf = join(SRC, name + ".dbf");
  const features = [];
  const source = await shapefile.open(shp, dbf, { encoding: "utf-8" });
  let r;
  while (!(r = await source.read()).done) {
    const f = r.value;
    if (filter && !filter(f.properties)) continue;
    features.push(reprojFeature(f));
  }
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

const eparhiya = await readShp("Sliven_Eparhiya");
const monasteries = await readShp("manastiri_eparhii", {
  filter: (p) => (p.Eparhiya || "").trim() === "Сливен",
});

writeFileSync(join(OUT, "eparhiya.geojson"), JSON.stringify(eparhiya));
writeFileSync(join(OUT, "monasteries.geojson"), JSON.stringify(monasteries));

console.log("eparhiya  features:", eparhiya.features.length, "bbox:", bbox(eparhiya).map((n) => n.toFixed(4)).join(", "));
console.log("monasteries features:", monasteries.features.length, "bbox:", bbox(monasteries).map((n) => n.toFixed(4)).join(", "));
console.log("monastery names:", monasteries.features.map((f) => f.properties.Name).join(", "));
