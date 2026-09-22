import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';
import { URL } from 'node:url';

const journal = JSON.parse(
  readFileSync(
    new URL('../apps/backend/drizzle/meta/_journal.json', import.meta.url),
    'utf8',
  ),
);

for (const [index, entry] of journal.entries.entries()) {
  if (entry.idx !== index) {
    throw new Error(
      `Migration ${entry.tag} has index ${entry.idx}; expected ${index}`,
    );
  }
  if (index > 0 && entry.when <= journal.entries[index - 1].when) {
    throw new Error(`Migration ${entry.tag} is not later than its predecessor`);
  }
}

stdout.write(`Validated ${journal.entries.length} ordered migrations\n`);
