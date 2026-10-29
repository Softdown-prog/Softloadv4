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
test('public bundle verification tolerates a slow link without accepting partial or invalid output',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  const check=workflow.split('name: Confirm public React bundle has no disabled provider')[1];
  assert.match(check,/curl --fail --silent --show-error --compressed/);
  assert.match(check,/--connect-timeout 15 --max-time 120 --retry 2 --retry-delay 3 --retry-all-errors/);
  assert.match(check,/process\.exit\(1\)/);
  assert.doesNotMatch(check,/\|\|\s*true/);
});
