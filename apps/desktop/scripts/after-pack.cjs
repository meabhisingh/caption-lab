const { cp, mkdir, rm } = require("node:fs/promises");
const { join, resolve } = require("node:path");

module.exports = async ({ appOutDir }) => {
  const desktopDirectory = resolve(__dirname, "..");
  const resourcesDirectory = join(appOutDir, "resources");
  await mkdir(resourcesDirectory, { recursive: true });

  for (const name of ["web", "backend"]) {
    const source = join(desktopDirectory, "stage", name);
    const destination = join(resourcesDirectory, name);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }
};
