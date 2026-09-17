from pathlib import Path

p=Path('tsconfig.pure.json')
s=p.read_text()
anchor='    "src/billing/order.ts",\n'
assert anchor in s
s=s.replace(anchor, anchor+'    "src/billing/foundingPolicy.ts",\n    "src/worker/regions.ts",\n', 1)
p.write_text(s)
