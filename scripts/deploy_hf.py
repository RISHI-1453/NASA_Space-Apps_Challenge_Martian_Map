"""Publish Martian Map to a Hugging Face Space (run from the martian-map folder):

    .venv\\Scripts\\python scripts\\deploy_hf.py <username>/martian-map

Needs `pip install huggingface_hub` and a one-time `hf auth login` with a token that can write. The
Space is created if it doesn't exist; the files git tracks are uploaded (large ones like the tour video
go up as LFS automatically) with the Space's settings at the top of README.md, and the Space then
builds the Dockerfile itself. The app is served at https://<username>-martian-map.hf.space
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = """---
title: Martian Map
emoji: 🪐
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: Plan a walk on Mars with real NASA data
---

"""


def main(repo: str) -> None:
    api = HfApi()
    api.create_repo(repo, repo_type="space", space_sdk="docker", exist_ok=True)
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        for name in filter(None, tracked.split("\0")):
            src = ROOT / name
            if src.is_file():  # skip files deleted but not yet committed
                (out / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, out / name)
        readme = out / "README.md"
        readme.write_text(SETTINGS + readme.read_text(encoding="utf-8"), encoding="utf-8")
        api.upload_folder(folder_path=out, repo_id=repo, repo_type="space", commit_message="Deploy Martian Map")
    user, space = repo.split("/")
    print(f"Uploaded. The Space builds now: https://huggingface.co/spaces/{repo}")
    print(f"App: https://{user.lower()}-{space.lower().replace('_', '-').replace('.', '-')}.hf.space")


if __name__ == "__main__":
    if len(sys.argv) != 2 or "/" not in sys.argv[1]:
        sys.exit(__doc__)
    main(sys.argv[1])
