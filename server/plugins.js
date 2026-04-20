'use strict';
const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(__dirname, '../plugins');

let loadedPlugins = [];

function loadAll() {
  if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.json'));
  loadedPlugins = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(PLUGINS_DIR, file), 'utf8');
      const plugin = JSON.parse(raw);
      if (plugin.name && plugin.trigger) {
        loadedPlugins.push(plugin);
      }
    } catch (e) {
      console.warn(`[Plugins] Błąd ładowania ${file}:`, e.message);
    }
  }
  console.log(`[Plugins] Załadowano ${loadedPlugins.length} scenariuszy`);
  return loadedPlugins;
}

function save(plugin, day) {
  const filename = `day${day}_${plugin.name.replace(/\s+/g, '_').toLowerCase()}.json`;
  const filepath = path.join(PLUGINS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(plugin, null, 2), 'utf8');
  loadedPlugins.push(plugin);
  console.log(`[Plugins] ✅ Nowy scenariusz zapisany: ${filename}`);
  return filename;
}

function checkTriggers(world) {
  const triggered = [];
  for (const plugin of loadedPlugins) {
    if (plugin._fired && !plugin.repeatable) continue;

    let matches = false;
    const c = plugin.condition || {};

    if (plugin.trigger === 'day' && c.day && world.day === c.day) matches = true;
    if (plugin.trigger === 'population' && c.min && world.population >= c.min) matches = true;
    if (plugin.trigger === 'season_change' && c.season && world.season === c.season && !plugin._fired) matches = true;
    if (plugin.trigger === 'tech_level' && c.level && world.techLevel >= c.level && !plugin._fired) matches = true;
    if (plugin.trigger === 'era' && c.era && world.era === c.era && !plugin._fired) matches = true;
    if (plugin.trigger === 'random' && c.chance && Math.random() < (c.chance / 100)) matches = true;

    if (matches) {
      plugin._fired = true;
      triggered.push(plugin);
    }
  }
  return triggered;
}

function getAll() { return loadedPlugins; }

module.exports = { loadAll, save, checkTriggers, getAll };
