#!/usr/bin/env python3
"""Swap `Text` destructured from 'react-native' to `AppText as Text` from the emoji module, app-wide.
AppText is a passthrough by default (Apple set), so this is behavior-neutral until the user switches sets.
Run with --apply to write; default is dry-run."""
import os, re, sys

APPLY = "--apply" in sys.argv
ROOT = "src"
TARGET = "src/emoji/AppText"  # module (no extension)

# match the react-native import statement (single or multi line)
RN_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]react-native['\"]\s*;?", re.S)

def relimport(fpath):
    rel = os.path.relpath(TARGET, os.path.dirname(fpath))
    if not rel.startswith("."):
        rel = "./" + rel
    return rel

def process(fpath):
    src = open(fpath).read()
    m = RN_IMPORT.search(src)
    if not m:
        return None
    inner = m.group(1)
    # split the destructured names, find standalone `Text` (not TextInput/TextStyle/TextProps/etc.)
    names = [n.strip() for n in inner.split(",")]
    if "Text" not in [n.split()[0] if n else n for n in names]:
        return None
    # remove the exact `Text` entry (keep TextInput etc.)
    kept = [n for n in names if n and n.split()[0] != "Text"]
    new_inner = ", ".join(kept)
    new_rn = f"import {{ {new_inner} }} from 'react-native';"
    if not kept:
        new_rn = ""  # react-native import had only Text
    addition = f"import {{ AppText as Text }} from '{relimport(fpath)}';"
    # replace the RN import with (cleaned RN import + the AppText import)
    replacement = (new_rn + ("\n" if new_rn else "") + addition)
    out = src[:m.start()] + replacement + src[m.end():]
    return out

def main():
    changed = []
    for dirpath, _dirs, files in os.walk(ROOT):
        if "/emoji" in dirpath:  # don't rewrite our own module
            continue
        for fn in files:
            if not fn.endswith(".tsx"):
                continue
            fp = os.path.join(dirpath, fn)
            res = process(fp)
            if res is not None:
                changed.append(fp)
                if APPLY:
                    open(fp, "w").write(res)
    print(("APPLIED" if APPLY else "DRY-RUN") + f": {len(changed)} files")
    for c in changed[:200]:
        print("  ", c)

if __name__ == "__main__":
    main()
