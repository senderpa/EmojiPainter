#!/usr/bin/env python3
"""
Rename remaining UUID video files with spaces to clean logo_video_XXX.mp4 format
"""
import os
import re
from pathlib import Path

LOGOSVIDEO_DIR = Path(__file__).parent.parent / 'assets' / 'logosvideo'

def main():
    print('🎬 Renaming remaining UUID video files with spaces...\n')

    # Get all files with UUID pattern and spaces
    all_files = sorted(LOGOSVIDEO_DIR.glob('*.MP4'))
    uuid_files = [f for f in all_files if '_users_' in f.name and ' ' in f.name]

    # Get existing logo_video_X.mp4 files to determine next number
    existing_logo_files = sorted(LOGOSVIDEO_DIR.glob('logo_video_*.mp4'))
    if existing_logo_files:
        # Extract numbers from existing files
        numbers = []
        for f in existing_logo_files:
            match = re.search(r'logo_video_(\d+)\.mp4', f.name)
            if match:
                numbers.append(int(match.group(1)))
        next_number = max(numbers) + 1 if numbers else 1
    else:
        next_number = 1

    print(f'Found {len(uuid_files)} UUID files to rename')
    print(f'Starting numbering from: logo_video_{next_number}.mp4\n')

    renamed_count = 0
    for old_file in uuid_files:
        new_name = f'logo_video_{next_number}.mp4'
        new_path = LOGOSVIDEO_DIR / new_name

        try:
            old_file.rename(new_path)
            print(f'✓ Renamed: {old_file.name[:50]}... → {new_name}')
            next_number += 1
            renamed_count += 1
        except Exception as e:
            print(f'✗ Failed to rename {old_file.name}: {e}')

    print(f'\n✅ Successfully renamed {renamed_count}/{len(uuid_files)} files')

if __name__ == '__main__':
    main()
