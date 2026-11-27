import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
const path = "public/neverheld/neverheld.min.js";
const source = readFileSync(path);
const compressed = gzipSync(source, { level: 9 }).length;
console.log(`Standalone kit: ${statSync(path).size} bytes; gzip: ${compressed} bytes`);
if (compressed >= 15 * 1024) throw new Error("Standalone kit exceeds the 15 KB compressed target.");
