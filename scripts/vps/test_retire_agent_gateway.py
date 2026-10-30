import json
import os
from pathlib import Path
import subprocess
import unittest

from retire_agent_gateway import retire_agent_gateway

LEGACY = """const names = Object.freeze({
  app: 'softload-vps-app-1',
  agent: 'softload-vps-agent-1'
});
async function startGroup() {
  if (!(await inspect(names.agent)).Running) await command(names.agent, 'start');
  await waitReady(names.agent);
  if (!(await inspect(names.app)).Running) await command(names.app, 'start');
  await waitReady(names.app);
}
async function stopGroup() {
  for (const name of [names.app, names.agent]) {
    if ((await inspect(name)).Running) await command(name, 'stop');
  }
}
"""


class RetireGatewayTests(unittest.TestCase):
    def calls(self, retired, action):
        source = retire_agent_gateway(LEGACY)
        harness = """
const events = [];
const states = new Map(Object.values(names).map(n => [n, ACTION === 'stop']));
async function inspect(n) { events.push('inspect:' + n); return {Running: states.get(n)}; }
async function command(n, action) { events.push(action + ':' + n); states.set(n, action === 'start'); }
async function waitReady(n) { events.push('healthy:' + n); }
await (ACTION === 'start' ? startGroup() : stopGroup());
console.log(JSON.stringify(events));
""".replace('ACTION', json.dumps(action))
        result = subprocess.run(['node', '-e', '(async()=>{' + source + harness + '})().catch(e=>{console.error(e);process.exitCode=1})'],
                                env=dict(os.environ, SOFTLOAD_AGENT_RETIRED='1' if retired else '0'),
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_retired_start_and_stop_never_touch_missing_agent(self):
        for action in ['start', 'stop']:
            with self.subTest(action=action):
                events = self.calls(True, action)
                self.assertTrue(events)
                self.assertTrue(all('agent' not in e for e in events), events)
                self.assertIn(action + ':softload-vps-app-1', events)

    def test_default_legacy_order_remains_compatible(self):
        events = self.calls(False, 'start')
        self.assertLess(events.index('start:softload-vps-agent-1'), events.index('start:softload-vps-app-1'))
        events = self.calls(False, 'stop')
        self.assertLess(events.index('stop:softload-vps-app-1'), events.index('stop:softload-vps-agent-1'))

    def test_transformation_is_idempotent(self):
        patched = retire_agent_gateway(LEGACY)
        self.assertEqual(retire_agent_gateway(patched), patched)

    def test_unexpected_source_is_not_rewritten(self):
        with self.assertRaises(ValueError):
            retire_agent_gateway(LEGACY.replace('await waitReady(names.agent);', 'await changed();'))


if __name__ == '__main__':
    unittest.main()
