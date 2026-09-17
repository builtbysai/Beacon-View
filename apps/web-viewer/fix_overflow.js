const fs = require('fs');
const p = 'apps/web-viewer/src/OverflowMenu.tsx';
let content = fs.readFileSync(p, 'utf-8');

content = content.replace('...(position || { visibility: \'hidden\', top: 0, left: 0 })',
  '...((position ? { top: position.top ?? \'auto\', bottom: position.bottom ?? \'auto\', right: position.right ?? \'auto\' } : { visibility: \'hidden\', top: 0, left: 0 }))');

fs.writeFileSync(p, content, 'utf-8');
console.log("Fixed OverflowMenu!");
