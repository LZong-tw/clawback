'use strict';

const path = require('node:path');

let _safeExec;
function getSafeExec() {
  if (!_safeExec) {
    const libDir = [
      path.join(__dirname, 'lib'),
      path.join(__dirname, '..', 'lib'),
    ].find(d => { try { require(path.join(d, 'exec.js')); return true; } catch { return false; } });
    _safeExec = libDir ? require(path.join(libDir, 'exec.js')).safeExec : require('node:child_process').execFileSync;
  }
  return _safeExec;
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const safeExec = getSafeExec();

  try {
    if (process.platform === 'darwin') {
      // Hardcoded message — no string interpolation of external data (prevents injection)
      safeExec('osascript', [
        '-e', 'display notification "Needs your attention" with title "Claude Code"',
      ], { stdio: 'pipe', timeout: 5000 });
    } else if (process.platform === 'linux') {
      safeExec('notify-send', ['Claude Code', 'Needs your attention'], {
        stdio: 'pipe', timeout: 5000,
      });
    } else if (process.platform === 'win32') {
      // Console bell — documented as known limitation
      process.stderr.write('\x07');
    }
  } catch {
    // Notification failed — silently ignore
  }

  process.exit(0);
}

main();
