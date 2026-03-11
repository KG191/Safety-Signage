#!/usr/bin/env python3
"""
Organise the ORP-SIG-2024 dataset (ISO 7010 pictograms) into 7 AS 1319 categories.

ORP-SIG-2024 structure:
  ORP-SIG-2024/
    E-SAFE-CONDITION/  Originals/ + Transformed/
    F-FIRE-PROTECTION/ Original/  + Transformed/
    M-MANDATORY/       Original/  + Transformed/
    P-PROHIBITION/     Original/  + Transformed/
    W-WARNING/         Original/  + Transformed/

ISO 7010 category → AS 1319 mapping:
  P-PROHIBITION     → prohibition
  M-MANDATORY       → mandatory
  W-WARNING         → warning
  E-SAFE-CONDITION  → emergency
  F-FIRE-PROTECTION → fire

AS 1319 extras not in ISO 7010:
  - restriction: no direct mapping (rare in practice)
  - danger: DANGER word-only signs — synthesised in train.py

Usage:
    python organise_dataset.py --input ./ORP-SIG-2024/ORP-SIG-2024 --output ./dataset
"""

import argparse
import shutil
from pathlib import Path
from collections import Counter
from tqdm import tqdm


# ORP-SIG-2024 folder name → AS 1319 category
FOLDER_TO_AS1319 = {
    'P-PROHIBITION':     'prohibition',
    'M-MANDATORY':       'mandatory',
    'W-WARNING':         'warning',
    'E-SAFE-CONDITION':  'emergency',
    'F-FIRE-PROTECTION': 'fire',
}

ALL_CATEGORIES = ['prohibition', 'mandatory', 'restriction', 'warning', 'danger', 'emergency', 'fire']


def organise(input_dir: Path, output_dir: Path, copy: bool = True):
    """Copy images from ORP-SIG-2024 structure into flat AS 1319 category folders."""
    for cat in ALL_CATEGORIES:
        (output_dir / cat).mkdir(parents=True, exist_ok=True)

    stats = Counter()

    for folder_name, as1319_cat in FOLDER_TO_AS1319.items():
        folder_path = input_dir / folder_name
        if not folder_path.exists():
            print(f"Warning: {folder_path} not found, skipping.")
            continue

        # Collect images from both Original(s) and Transformed subfolders
        image_files = []
        for subfolder in folder_path.iterdir():
            if subfolder.is_dir():
                image_files.extend(
                    list(subfolder.glob('*.png')) +
                    list(subfolder.glob('*.jpg')) +
                    list(subfolder.glob('*.jpeg')) +
                    list(subfolder.glob('*.bmp'))
                )

        print(f"{folder_name} → {as1319_cat}: {len(image_files)} images")

        for img_path in tqdm(image_files, desc=f"  {as1319_cat}", leave=False):
            dest = output_dir / as1319_cat / img_path.name
            # Handle name collisions by prefixing subfolder name
            if dest.exists():
                dest = output_dir / as1319_cat / f"{img_path.parent.name}_{img_path.name}"
            if copy:
                shutil.copy2(img_path, dest)
            else:
                shutil.move(str(img_path), str(dest))
            stats[as1319_cat] += 1

    # Summary
    print("\n=== Dataset Organisation Summary ===")
    total = 0
    for cat in ALL_CATEGORIES:
        count = stats.get(cat, 0)
        print(f"  {cat:15s}: {count:6d} images")
        total += count
    print(f"  {'TOTAL':15s}: {total:6d} images")

    for cat in ['danger', 'restriction']:
        if stats[cat] == 0:
            print(f"\nNote: '{cat}' has 0 images — will be synthesised during training.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Organise ORP-SIG-2024 into AS 1319 categories')
    parser.add_argument('--input', required=True, help='Path to ORP-SIG-2024 dataset root (containing P-PROHIBITION, M-MANDATORY, etc.)')
    parser.add_argument('--output', required=True, help='Output directory for organised dataset')
    parser.add_argument('--move', action='store_true', help='Move files instead of copying (saves disk)')
    args = parser.parse_args()

    organise(Path(args.input), Path(args.output), copy=not args.move)
