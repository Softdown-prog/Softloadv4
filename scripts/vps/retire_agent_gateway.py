"""Bounded transformation for the installed project wake gateway, not the Panel.

No I/O or Docker operations. Callers must validate, stage and install atomically
under the existing project deploy lock. Refuse an unexpected source instead of
blindly rewriting a live gateway. The default preserves the legacy topology.
"""


def retire_agent_gateway(source: str) -> str:
    replacements = [
        ("  agent: 'softload-vps-agent-1'",
         "  ...(process.env.SOFTLOAD_AGENT_RETIRED === '1' ? {} : {agent: 'softload-vps-agent-1'})"),
        ("  if (!(await inspect(names.agent)).Running) await command(names.agent, 'start');\n"
         "  await waitReady(names.agent);\n"
         "  if (!(await inspect(names.app)).Running) await command(names.app, 'start');\n"
         "  await waitReady(names.app);",
         "  for (const name of Object.values(names).reverse()) {\n"
         "    if (!(await inspect(name)).Running) await command(name, 'start');\n"
         "    await waitReady(name);\n"
         "  }"),
        ("  for (const name of [names.app, names.agent]) {",
         "  for (const name of Object.values(names)) {"),
    ]
    if all(new in source and old not in source for old, new in replacements):
        return source
    for old, new in replacements:
        if source.count(old) != 1:
            raise ValueError('Unexpected gateway source; inspect before migrating')
        source = source.replace(old, new, 1)
    return source
