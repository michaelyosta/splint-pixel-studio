function toPostgres(sql) {
  let position = 0;
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (inString) {
      result += ch;
      if (ch === stringChar) {
        if (sql[i + 1] === stringChar) {
          result += sql[i + 1];
          i += 1;
        } else {
          inString = false;
          stringChar = null;
        }
      }
    } else if (ch === '\'' || ch === '"') {
      inString = true;
      stringChar = ch;
      result += ch;
    } else if (ch === '?') {
      position += 1;
      result += `$${position}`;
    } else {
      result += ch;
    }

    i += 1;
  }

  return result.replace(/MAX\(0,\s*([^)]+)\)/gi, (_, expr) => `GREATEST(0, ${expr})`);
}

export function isUniqueConstraintError(error, mode) {
  if (!error) return false;
  if (mode === 'postgres') {
    return error.code === '23505';
  }
  return error.message && /UNIQUE\s+constraint/i.test(error.message);
}

export { toPostgres };
