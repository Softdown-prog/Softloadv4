const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('production image publication depends on Blogger editor, XML compilation and its contracts',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  const verify=workflow.split('\n  verify:')[1].split('\n  plan:')[0];
  for (const contract of ['src/routes/publicBlogger.contract.test.cjs', 'src/routes/dashboard_routes/compiler.procedural.test.js', 'src/routes/dashboard_routes/compiler.procedural.integration.test.js']) {
    assert.ok(verify.includes(contract), 'Obrigatório no deploy: '+contract);
  }
  assert.doesNotMatch(verify, /typecheck:frontend|test:frontend-base|test:frontend-layouts/);
  assert.doesNotMatch(verify,/continue-on-error:\s*true/);
  const build=workflow.split('\n  build_and_transfer:')[1].split('\n  receive:')[0];
  assert.match(build,/needs:\s*\[verify, plan\]/);
});
test('public EJS Blogger verification rejects removed React and broken guest editor',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  const check=workflow.split('name: Confirm public Blogger landing and guest editor are live')[1];
  assert.ok(check, 'Missing production Blogger smoke');
  assert.match(check, /curl --fail --silent --show-error --compressed/);
  assert.match(check, /--connect-timeout 15 --max-time 120 --retry 2 --retry-delay 3 --retry-all-errors/);
  assert.match(check, /\/criar/);
  assert.match(check, /generator-form/);
  assert.match(check, /guestToken/);
  assert.match(check, /process\.exit\(1\)/);
  assert.doesNotMatch(check, /\|\|\s*true/);
  assert.doesNotMatch(check, /main\.js\?v=|React bundle has no disabled provider/);
});
