// Simulates a present tool (e.g. tsc) emitting a real error whose text contains
// "Cannot find name" — which must NOT be misread as a missing binary.
process.stdout.write("src/app.ts(1,1): error TS2304: Cannot find name 'foo'\n");
process.exit(2);
