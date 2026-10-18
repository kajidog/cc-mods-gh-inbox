import { readdir, readFile, writeFile } from "node:fs/promises"

// Each folder of plugins/ is one mod: its package.json carries the version changesets sets, its plugin.json the one Claude Code reads.
const root = new URL("../", import.meta.url)
const readJson = async url => JSON.parse(await readFile(url, "utf8"))
const lock = await readJson(new URL("package-lock.json", root))
const names = (await readdir(new URL("plugins/", root), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
const isCheck = process.argv.includes("--check")

for (const name of names) {
  const dir = new URL(`plugins/${name}/`, root)
  const pkg = await readJson(new URL("package.json", dir))
  const pluginPath = new URL(".claude-plugin/plugin.json", dir)
  const plugin = await readJson(pluginPath)
  if (isCheck) {
    if (plugin.version !== pkg.version || lock.packages[`plugins/${name}`]?.version !== pkg.version) {
      console.error(`Version mismatch in plugins/${name}: package.json, package-lock.json, and .claude-plugin/plugin.json must agree. Run npm run release:version when preparing a release.`)
      process.exitCode = 1
    }
  } else if (plugin.version !== pkg.version) {
    plugin.version = pkg.version
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`)
  }
}
