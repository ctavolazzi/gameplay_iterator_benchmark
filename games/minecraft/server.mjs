import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The local Minecraft server a run is played on. One seed, this machine only. Offline mode
// lets a bot join without a Microsoft account; binding to 127.0.0.1 keeps everyone else out.

export const MC_VERSION = '26.1';

export function serverPaths(root) {
  const dir = join(root, 'runtime', `minecraft-server-${MC_VERSION}`);
  return {
    dir,
    jar: join(dir, 'server.jar'),
    java: join(root, 'runtime', 'jre-25', 'Contents', 'Home', 'bin', 'java'),
    eula: join(dir, 'eula.txt'),
    properties: join(dir, 'server.properties'),
    world: join(dir, 'world'),
  };
}

function setProperties(file, wanted) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  for (const [key, value] of Object.entries(wanted)) {
    const at = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(file, lines.join('\n'));
}

// Start the server and wait until it accepts players. freshWorld deletes the world folder
// first, so the world is made again from the seed and every run starts from the same land.
export async function startServer({ root, seed, freshWorld = true, port = 25565, memory = '1536M', log = () => {} }) {
  const paths = serverPaths(root);
  for (const file of [paths.jar, paths.java]) {
    if (!existsSync(file)) throw new Error(`missing ${file}; tools/fetch_runtime.sh fetches it`);
  }
  const eula = existsSync(paths.eula) ? readFileSync(paths.eula, 'utf8') : '';
  if (!/^eula=true/m.test(eula)) throw new Error(`Mojang's EULA is not accepted; the owner sets eula=true in ${paths.eula}`);
  if (freshWorld) rmSync(paths.world, { recursive: true, force: true });
  setProperties(paths.properties, {
    'level-seed': seed,
    'online-mode': 'false',
    'server-ip': '127.0.0.1',
    'server-port': port,
    'max-players': 4,
    'view-distance': 6,
    'simulation-distance': 6,
    'spawn-protection': 0,
    difficulty: 'normal',
    gamemode: 'survival',
    'enforce-secure-profile': 'false',
    motd: 'gameplay_iterator_benchmark',
  });

  const child = spawn(paths.java, [`-Xmx${memory}`, '-jar', 'server.jar', '--nogui'], {
    cwd: paths.dir, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let exited = null;
  child.on('exit', (code) => { exited = code ?? 'killed'; });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server was not ready within 6 minutes')), 360000);
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trimEnd();
        buffer = buffer.slice(end + 1);
        log(line);
        if (/\bDone \(/.test(line)) { clearTimeout(timer); resolve(); }
        if (/FAILED TO BIND|Failed to start the minecraft server/.test(line)) { clearTimeout(timer); reject(new Error(line)); }
      }
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped while starting (exit ${code})`)); });
  });
  try {
    await ready;
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  const command = (text) => { if (exited === null) child.stdin.write(`${text}\n`); };
  return {
    port,
    command,
    running: () => exited === null,
    async stop() {
      if (exited !== null) return;
      command('stop');
      const deadline = Date.now() + 45000;
      while (exited === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      if (exited === null) child.kill('SIGKILL');
    },
  };
}
