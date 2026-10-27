"""Attach HTTP probes to an existing single-container app without replacing its configuration."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def probes(port, live, ready):
    return [
        {
            "type": kind,
            "httpGet": {"path": path, "port": port, "scheme": "HTTP"},
            "periodSeconds": period,
            "timeoutSeconds": timeout,
            "failureThreshold": threshold,
        }
        for kind, path, period, timeout, threshold in [
            ("Startup", live, 5, 2, 60),
            ("Liveness", live, 10, 2, 3),
            ("Readiness", ready, 10, 5, 3),
        ]
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--app", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--live", required=True)
    parser.add_argument("--ready", required=True)
    args = parser.parse_args()
    app = json.loads(subprocess.check_output([
        "az", "containerapp", "show", "-g", args.resource_group,
        "-n", args.app, "-o", "json",
    ], text=True))
    template = app["properties"]["template"]
    containers = template["containers"]
    if len(containers) != 1:
        raise RuntimeError("Expected one container; refusing to guess which container needs probes")
    containers[0]["probes"] = probes(args.port, args.live, args.ready)
    # Azure chooses a fresh revision suffix for the updated template.
    template.pop("revisionSuffix", None)
    with tempfile.TemporaryDirectory(prefix="octocat-probes-") as directory:
        body = Path(directory) / "patch.json"
        body.write_text(json.dumps({"properties": {"template": template}}), encoding="utf-8")
        subprocess.run([
            "az", "rest", "--method", "patch",
            "--url", f"https://management.azure.com{app['id']}?api-version=2024-03-01",
            "--body", f"@{body}", "--output", "none",
        ], check=True)
    print(f"Configured startup, liveness and readiness probes for {args.app}")


if __name__ == "__main__":
    main()
