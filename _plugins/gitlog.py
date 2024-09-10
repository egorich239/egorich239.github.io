#!python3
# One day I will learn Ruby and make it a Jekyll plugin.

import yaml
import sys
from pathlib import Path
from dataclasses import dataclass
import subprocess
import re
import tempfile
from typing import List


@dataclass
class Config:
    repo: str
    branch: str
    root: str


def name_from_title(title: str):
    title = re.sub(r"[^\w\s']+", "-", title)
    title = re.sub(r"[\"'\s_]+", "-", title)
    title = re.sub(r"--+", "-", title)
    title = re.sub(r"^-|-$", "", title)
    return title.lower()


def linkify(s: str) -> str:
    # extremely crude
    return re.sub(r"(http(s?)://[^\s]+[^.,;!])", "<\\1>", s)


def git_revs(repo: Path, cfg: Config, until: str, *parms) -> List[str]:
    return (
        subprocess.run(
            ["git", "rev-list", *parms, f"{cfg.root}..{until}"],
            cwd=repo,
            capture_output=True,
            check=True,
        )
        .stdout.decode("ascii")
        .splitlines()
    )


def git_rev_date(repo: Path, rev: str) -> str:
    return (
        subprocess.run(
            [
                "git",
                "show",
                "-s",
                "--format=%cd",
                "--date=format:%Y-%m-%d-%H%M%S",
                rev,
            ],
            cwd=repo,
            capture_output=True,
            check=True,
        )
        .stdout.decode("ascii")
        .strip()
    )


def git_rev_message(repo: Path, rev: str) -> List[str]:
    return (
        subprocess.run(
            ["git", "log", "--format=%B", "-n", "1", rev],
            cwd=repo,
            capture_output=True,
            check=True,
        )
        .stdout.decode("utf-8")
        .splitlines()
    )


def main(p: Path):
    di = Path(p).parent
    published = set()
    with open(p) as f:
        cfg = Config(**{k: v for k, v in yaml.safe_load(f).items()})
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        subprocess.run(["git", "clone", cfg.repo, "repo"], cwd=tmp, check=True)
        posts = reversed(
            git_revs(tmp / "repo", cfg, cfg.branch, "--first-parent") + [cfg.root]
        )
        for p in posts:
            published.add(p)
            d = git_rev_date(tmp / "repo", p)
            lines = git_rev_message(tmp / "repo", p)
            title = lines[0]
            subtitle = (
                (lines[2][0].islower() or lines[2][0] in '."') and lines[2] or None
            )
            lines = lines[3:] if subtitle else lines[2:]
            revlog = []
            for a in git_revs(tmp / "repo", cfg, p):
                if a in published:
                    continue
                published.add(a)
                revlog.append((a, git_rev_message(tmp / "repo", a)))

            with open(di / f"{d}-{name_from_title(title)}.md", "w") as fout:
                fout.write(
                    f"""---
layout: gitlog
title: {title}
{subtitle and ('subtitle: ' + subtitle) or ''}
commit: {cfg.repo.replace('.git', '/commit/') + p}
---

"""
                )
                in_footnote = False
                in_code = False
                for l in lines:
                    l = re.sub(r"\[(\d+)\]", "[^\\1]", linkify(l.rstrip()))
                    l = re.sub("anigmatic", "enigmatic", l)
                    if l.startswith("["):
                        in_footnote = True
                        fout.write(f"\n{l.replace(']', ']:')}")
                    elif in_code:
                        if l.startswith("```"):
                            in_code = False
                        fout.write(f"{l}\n")
                    elif in_footnote:
                        if l:
                            fout.write(f" {l}")
                        else:
                            in_footnote = False
                    elif l.startswith("```"):
                        in_code = True
                        fout.write("```scheme\n")
                    else:
                        fout.write(f"{l}\n")

                if revlog:
                    fout.write("\n### verbose branch logs\n")
                for a in reversed(revlog):
                    fout.write(
                        f"\n* [[{a[0][:8]}]({cfg.repo.replace('.git', '/commit/') + a[0]})] {a[1][0]}\n"
                    )
                    fout.write("\n   ".join(a[1][1:]))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
