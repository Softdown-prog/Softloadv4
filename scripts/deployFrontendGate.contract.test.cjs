const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('production image publication depends on the frontend contracts that gate main',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  const verify=workflow.split('\n  verify:')[1].split('\n  plan:')[0];
  for(const command of ['typecheck:frontend','test:frontend-base','test:frontend-layouts']) {
    assert.match(verify,new RegExp('^          npm run '+command+'$','m'));
  }
  assert.doesNotMatch(verify,/continue-on-error:\s*true/);
  const build=workflow.split('\n  build_and_transfer:')[1].split('\n  receive:')[0];
  assert.match(build,/needs:\s*\[verify, plan\]/);
});
