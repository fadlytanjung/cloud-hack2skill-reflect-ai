#!/usr/bin/env python3
"""
Normalize a Cloud Run service spec that was first created by Google AI Studio.

AI Studio deploys from source and leaves metadata behind that a later
image-based deploy cannot reconcile. Running `gcloud run deploy --image` on such
a service fails with:

    spec.template.metadata.annotations[run.googleapis.com/sources]:
    Source annotation has sources that are not referenced by a container.

This script reads an exported service YAML on stdin and writes a normalized one
to stdout, reporting each change on stderr. It is idempotent: a service that is
already clean passes through unchanged and exits 3 so the caller can skip the
`services replace` round trip.

Usage:
    gcloud run services describe SVC --region R --format=export \\
      | python3 scripts/normalize-cloud-run-service.py --image IMAGE > clean.yaml
"""

from __future__ import annotations

import argparse
import json
import sys

try:
    import yaml
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

# Annotations that only make sense for a source-based deploy. The first two name
# a container built from source; once we supply our own image they point at
# nothing and the API rejects the revision.
STALE_TEMPLATE_ANNOTATIONS = (
    "run.googleapis.com/sources",
    "run.googleapis.com/base-images",
    "generativelanguage.googleapis.com/nonce",
)

STALE_TEMPLATE_LABELS = (
    "client.knative.dev/nonce",
    "managed-by",
)

# Names that must never sit in a service spec as literal values: the spec is
# readable by anyone with run.services.get. They arrive from the mounted
# Secret Manager file instead.
SECRET_ENV_NAMES = (
    "GEMINI_API_KEY",
    "MAPS_API_KEY",
    "WEBHOOK_URL",
    "DISCORD_WEBHOOK_URL",
    "FIREBASE_API_KEY",
    "VITE_FIREBASE_API_KEY",
)


def normalize(doc: dict, image: str, secret_mount_dir: str) -> list[str]:
    """Mutates `doc` in place. Returns a list of human-readable changes."""
    changes: list[str] = []

    # Service-level label, separate from the revision template's copy. Left in
    # place it claims AI Studio still manages a service we now deploy ourselves.
    # `dev-tutorial` (the challenge label) and system labels are untouched.
    service_labels = doc.setdefault("metadata", {}).setdefault("labels", {})
    if service_labels.get("managed-by") == "google-ai-studio":
        del service_labels["managed-by"]
        changes.append("removed service label managed-by=google-ai-studio")

    template = doc.get("spec", {}).get("template", {})
    meta = template.setdefault("metadata", {})
    annotations = meta.setdefault("annotations", {})
    labels = meta.setdefault("labels", {})

    for key in STALE_TEMPLATE_ANNOTATIONS:
        if annotations.pop(key, None) is not None:
            changes.append(f"removed annotation {key}")

    for key in STALE_TEMPLATE_LABELS:
        if labels.pop(key, None) is not None:
            changes.append(f"removed label {key}")

    spec = template.setdefault("spec", {})

    # Tied to automatic base-image updates, which only apply to source deploys.
    if spec.pop("runtimeClassName", None) is not None:
        changes.append("removed runtimeClassName")

    containers = spec.get("containers") or []
    if not containers:
        raise SystemExit("error: service spec has no containers")
    container = containers[0]

    if container.get("image") != image:
        changes.append(f"image: {container.get('image')} -> {image}")
        container["image"] = image

    # AI Studio sets an entrypoint of
    #   /bin/sh -c 'if [ -f server.js ]; then node server.js; else npm start; fi'
    # which overrides the Dockerfile CMD. Neither branch exists in our image.
    for key in ("command", "args"):
        if container.pop(key, None) is not None:
            changes.append(f"removed container {key} override (was overriding the image CMD)")

    env = container.get("env") or []
    kept, dropped = [], []
    for item in env:
        name = item.get("name")
        if name in SECRET_ENV_NAMES:
            dropped.append(name)
        else:
            kept.append(item)
    if dropped:
        changes.append("removed plaintext secret env vars: " + ", ".join(sorted(dropped)))

    # The app reads its env file from ENV_FILE, so the secret can live outside
    # the working directory.
    env_file = f"{secret_mount_dir}/.env"
    required = {"NODE_ENV": "production", "ENV_FILE": env_file}
    by_name = {item.get("name"): item for item in kept}
    for name, value in required.items():
        if by_name.get(name, {}).get("value") != value:
            changes.append(f"set env {name}={value}")
        by_name[name] = {"name": name, "value": value}
    container["env"] = list(by_name.values())

    # A secret mounted at /app shadows the whole application directory, hiding
    # dist/ and node_modules/ and leaving the container with nothing to run.
    for mount in container.get("volumeMounts") or []:
        if mount.get("mountPath") in ("/app", "/app/"):
            mount["mountPath"] = secret_mount_dir
            changes.append(
                f"secret mountPath: /app -> {secret_mount_dir} "
                "(mounting at /app shadows the application directory)"
            )

    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="container image to pin")
    parser.add_argument(
        "--secret-mount-dir",
        default="/secrets",
        help="directory to mount the env secret into (default: /secrets)",
    )
    args = parser.parse_args()

    raw_input = sys.stdin.read()
    doc = None
    input_is_json = False

    try:
        doc = json.loads(raw_input)
        input_is_json = True
    except Exception:
        if HAVE_YAML:
            doc = yaml.safe_load(raw_input)
        else:
            sys.exit(
                "error: stdin is not JSON and PyYAML is not installed. "
                "Export service as JSON (--format=json) or install pyyaml (pip3 install pyyaml)."
            )

    if not isinstance(doc, dict):
        raise SystemExit("error: stdin is not a valid Cloud Run service specification")

    changes = normalize(doc, args.image, args.secret_mount_dir)

    if not changes:
        print("Service spec is already normalized.", file=sys.stderr)
        return 3

    for change in changes:
        print(f"  - {change}", file=sys.stderr)

    if input_is_json or not HAVE_YAML:
        json.dump(doc, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        yaml.safe_dump(doc, sys.stdout, sort_keys=False, default_flow_style=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
