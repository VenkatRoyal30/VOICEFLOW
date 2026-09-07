const fs = require('fs');
const path = require('path');

function search(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory() && !f.startsWith('.')) {
        search(full);
      } else if (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs')) {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes("input speech hasn't started yet") || content.includes('skipping silence padding')) {
          console.log('FOUND IN:', full);
          const lines = content.split('\n');
          lines.forEach((l, idx) => {
            if (l.includes('silence padding') || l.includes('input speech')) {
              console.log('Line ' + (idx + 1) + ': ' + l.trim());
            }
          });
        }
      }
    } catch (e) {}
  }
}

search('backend/node_modules/@livekit');
