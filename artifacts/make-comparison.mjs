import sharp from "/Users/ruslanbakytuly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const reference = await sharp("artifacts/reference-design.png").resize({ width: 720 }).flatten({ background: "white" }).jpeg().toBuffer();
const home = await sharp("artifacts/home-redesign.png").resize({ width: 250 }).flatten({ background: "white" }).jpeg().toBuffer();
const orders = await sharp("artifacts/orders-redesign.png").resize({ width: 250 }).flatten({ background: "white" }).jpeg().toBuffer();
const profile = await sharp("artifacts/profile-redesign.png").resize({ width: 250 }).flatten({ background: "white" }).jpeg().toBuffer();

await sharp({
  create: { width: 1540, height: 610, channels: 4, background: "#e9eceaff" },
})
  .composite([
    { input: reference, left: 20, top: 35 },
    { input: home, left: 760, top: 20 },
    { input: orders, left: 1020, top: 20 },
    { input: profile, left: 1280, top: 20 },
  ])
  .png()
  .toFile("artifacts/design-comparison.png");
