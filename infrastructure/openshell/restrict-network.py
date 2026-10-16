#!/usr/bin/env python3
"""Preserve generated runtime rules and retain only managed inference egress.

Input: `openshell policy get <sandbox> --base -o json`. Output: JSON, also
valid YAML for policy set. Run only before managed MCP registration.
"""
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    policy = json.load(source)["policy"]
entries = policy["network_policies"]
if any(name.startswith("mcp_") for name in entries):
    raise SystemExit("Refusing to replace an existing managed MCP policy.")
inference = {
    name: entry for name, entry in entries.items()
    if entry.get("endpoints") and all(
        endpoint.get("host") == "inference.local"
        and endpoint.get("port") == 443
        and endpoint.get("enforcement") == "enforce"
        for endpoint in entry["endpoints"]
    )
}
if len(inference) != 1 or not next(iter(inference.values())).get("binaries"):
    raise SystemExit("Expected one binary-scoped managed inference policy; inspect the installed runtime.")
policy["network_policies"] = inference
print(json.dumps(policy, indent=2))
