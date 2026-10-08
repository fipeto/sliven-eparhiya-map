import * as shapefile from "shapefile";
const SRC = "D:/Projects/2026_HistoryMap/Exported Files/Exported Files";

const src = await shapefile.open(SRC + "/BG_Eparhii_Settlements.shp", SRC + "/BG_Eparhii_Settlements.dbf", { encoding: "utf-8" });
const fields = ["FIELD_NAME","FIELD_NA_1","FIELD_NA_2","FIELD_NA_3","FIELD_NA_4","FIELD_NA_5","FIELD_NA_6"];
const distinct = Object.fromEntries(fields.map(f => [f, new Map()]));
const samples = [];
let n = 0, geomType = null;
let r;
while (!(r = await src.read()).done) {
  const f = r.value; n++;
  geomType = f.geometry && f.geometry.type;
  for (const fl of fields) {
    const v = (f.properties[fl] ?? "").toString().trim();
    distinct[fl].set(v, (distinct[fl].get(v) || 0) + 1);
  }
  if (n <= 6) samples.push(f.properties);
}
console.log("records:", n, "geomType:", geomType);
for (const fl of fields) {
  const m = distinct[fl];
  const sampleVals = [...m.entries()].slice(0, 8).map(([k,c]) => `${JSON.stringify(k)}×${c}`);
  console.log(`\n${fl}: ${m.size} distinct`);
  console.log("   ", sampleVals.join("  |  "));
}
// which field likely = eparchy? one with ~10-15 distinct
console.log("\n=== candidate eparchy fields (<=20 distinct) ===");
for (const fl of fields) {
  if (distinct[fl].size <= 20) {
    console.log(fl, "->", [...distinct[fl].keys()].filter(Boolean).join(", "));
  }
}
console.log("\n=== first 6 full records ===");
samples.forEach((p,i)=>console.log(i, JSON.stringify(p)));
