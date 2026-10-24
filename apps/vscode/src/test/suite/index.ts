import * as fs from 'fs';
import Mocha from 'mocha';
import * as path from 'path';

export async function run(): Promise<void> {
  const mocha = new Mocha({ color: true, timeout: 60000 });
  const testsRoot = __dirname;
  const files = fs.readdirSync(testsRoot).filter((f) => f.endsWith('.test.js'));
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
