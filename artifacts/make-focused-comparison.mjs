import sharp from "/Users/ruslanbakytuly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const sourceHome = await sharp("artifacts/reference-design.png")
  .extract({ left: 45, top: 70, width: 410, height: 900 })
  .resize({ width: 390 })
  .flatten({ background: "white" })
  .jpeg()
  .toBuffer();
const implementation = await sharp("artifacts/home-redesign.png")
  .flatten({ background: "white" })
  .jpeg()
  .toBuffer();

await sharp({ create: { width: 820, height: 900, channels: 4, background: "#e9eceaff" } })
  .composite([
    { input: sourceHome, left: 10, top: 10 },
    { input: implementation, left: 420, top: 10 },
  ])
  .png()
  .toFile("artifacts/home-focused-comparison.png");
