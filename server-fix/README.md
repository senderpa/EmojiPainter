# Server Upload Fix

## Problem
The server's `storage.php` was trying to INSERT into a `frame_urls` column that doesn't exist in your live database yet, causing this error:
```
Unknown column 'frame_urls' in 'field list'
```

## Solution
This fixed `storage.php` file removes the `frame_urls` column from the INSERT statement so uploads work with your current database.

## What to do:

1. **Upload the fixed file:**
   - Upload `storage.php` from this folder to your server at:
     `https://emojipainter.com/api/storage.php`
   - This will replace the current file

2. **Test uploads:**
   - Try uploading a painting from the app
   - It should now work without errors

## Future: Enable Animation Support

When you're ready to add animation support later, you'll need to:

1. **Update your database** by running this SQL:
```sql
ALTER TABLE gallery_entries
ADD COLUMN frame_urls TEXT NULL COMMENT 'JSON array of frame image URLs for animation';
```

2. **Replace storage.php** with the original version from `/Users/senderp/Downloads/api/storage.php`

## What was changed:

- Removed `frame_urls` from the INSERT statement (line 148-150)
- Removed the `frame_urls` parameter from the Database::insert() call (line 166)
- Removed frame_urls from the types array (line 167)
- Commented out all frame upload handling code (lines 87-119)
- Added notes explaining how to re-enable it later

## Files in this folder:

- **storage.php** - Fixed version (upload this to your server)
- **README.md** - This file with instructions
