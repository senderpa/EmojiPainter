# Backend Changes for MOV Support in Topic Challenges

## Overview
This document outlines the required backend changes to support MOV (video) uploads for daily topic challenges and display them in the live gallery with autoplay functionality.

## Current State
- Backend currently accepts PNG/JPEG images for topic challenge submissions
- Gallery displays static images only
- No video upload or streaming support

## Required Changes

### 1. File Upload System

#### 1.1 Accept MOV Files
**Endpoint**: `/api/challenges/submit` or similar submission endpoint

**Changes Needed**:
```javascript
// Add MOV to accepted MIME types
const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'video/quicktime',      // .mov files
  'video/mp4'             // Also support mp4 as fallback
];

// Update file size limits (MOV files are larger)
const MAX_FILE_SIZE = {
  image: 10 * 1024 * 1024,    // 10MB for images
  video: 50 * 1024 * 1024     // 50MB for videos
};
```

#### 1.2 File Validation
```javascript
function validateUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  // Check file type
  if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
    throw new Error('Invalid file type');
  }

  // Check file size based on type
  const isVideo = mimeType.startsWith('video/');
  const maxSize = isVideo ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;

  if (file.size > maxSize) {
    throw new Error(`File too large. Max size: ${maxSize / (1024 * 1024)}MB`);
  }

  return { isVideo, isValid: true };
}
```

### 2. Database Schema Updates

#### 2.1 Update Submissions Table
Add fields to track video metadata:

```sql
ALTER TABLE challenge_submissions ADD COLUMN media_type VARCHAR(10) DEFAULT 'image';
ALTER TABLE challenge_submissions ADD COLUMN video_duration INT; -- Duration in milliseconds
ALTER TABLE challenge_submissions ADD COLUMN video_fps INT; -- Frames per second
ALTER TABLE challenge_submissions ADD COLUMN video_frame_count INT; -- Total frames
ALTER TABLE challenge_submissions ADD COLUMN file_format VARCHAR(10); -- 'png', 'jpg', 'mov', 'mp4'

-- Add index for faster queries
CREATE INDEX idx_media_type ON challenge_submissions(media_type);
```

#### 2.2 Schema Example
```typescript
interface ChallengeSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  prompt_id: string;
  file_url: string;
  thumbnail_url?: string;  // For video preview
  media_type: 'image' | 'video';
  file_format: 'png' | 'jpg' | 'mov' | 'mp4';
  video_duration?: number;  // milliseconds
  video_fps?: number;
  video_frame_count?: number;
  file_size: number;
  uploaded_at: Date;
  // ... other fields (votes, etc.)
}
```

### 3. File Storage

#### 3.1 Storage Structure
```
/uploads/
  /challenges/
    /{challenge_id}/
      /{user_id}/
        /submission.mov (or .png)
        /thumbnail.jpg  (generated for videos)
```

#### 3.2 Video Thumbnail Generation
Generate thumbnails for video previews (for gallery grid view):

```javascript
const ffmpeg = require('fluent-ffmpeg');

async function generateVideoThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:00.500'],  // Take frame at 0.5 seconds
        filename: 'thumbnail.jpg',
        folder: path.dirname(outputPath),
        size: '512x512'
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}

// After video upload
if (isVideo) {
  const thumbnailPath = `${uploadDir}/thumbnail.jpg`;
  await generateVideoThumbnail(uploadedFilePath, thumbnailPath);

  // Store thumbnail URL in database
  submission.thumbnail_url = `/uploads/challenges/${challengeId}/${userId}/thumbnail.jpg`;
}
```

### 4. API Endpoints

#### 4.1 Submit Challenge Endpoint
**POST** `/api/challenges/{challengeId}/submit`

```javascript
router.post('/:challengeId/submit',
  upload.single('file'),
  async (req, res) => {
    const { file } = req;
    const { video_duration, video_fps, video_frame_count } = req.body;

    try {
      // Validate file
      const { isVideo } = validateUpload(file);

      // Generate thumbnail for videos
      let thumbnailUrl = null;
      if (isVideo) {
        thumbnailUrl = await generateVideoThumbnail(file.path, ...);
      }

      // Save to database
      const submission = await db.submissions.create({
        user_id: req.user.id,
        challenge_id: req.params.challengeId,
        file_url: file.path,
        thumbnail_url: thumbnailUrl,
        media_type: isVideo ? 'video' : 'image',
        file_format: path.extname(file.originalname).slice(1),
        video_duration: isVideo ? parseInt(video_duration) : null,
        video_fps: isVideo ? parseInt(video_fps) : null,
        video_frame_count: isVideo ? parseInt(video_frame_count) : null,
        file_size: file.size,
        uploaded_at: new Date()
      });

      res.json({ success: true, submission });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);
```

#### 4.2 Gallery Fetch Endpoint
**GET** `/api/challenges/{challengeId}/gallery`

Return media type information so frontend knows how to render:

```javascript
router.get('/:challengeId/gallery', async (req, res) => {
  const submissions = await db.submissions.findAll({
    where: { challenge_id: req.params.challengeId },
    order: [['uploaded_at', 'DESC']],
    limit: 50
  });

  const formatted = submissions.map(sub => ({
    id: sub.id,
    user_id: sub.user_id,
    file_url: sub.file_url,
    thumbnail_url: sub.thumbnail_url,  // Use for grid preview
    media_type: sub.media_type,
    file_format: sub.file_format,
    video_duration: sub.video_duration,
    video_fps: sub.video_fps,
    frame_count: sub.video_frame_count,
    uploaded_at: sub.uploaded_at,
    // ... other fields
  }));

  res.json({ submissions: formatted });
});
```

### 5. Video Streaming (Optional but Recommended)

For better performance, implement video streaming:

```javascript
router.get('/stream/:submissionId', async (req, res) => {
  const submission = await db.submissions.findByPk(req.params.submissionId);

  if (!submission || submission.media_type !== 'video') {
    return res.status(404).json({ error: 'Video not found' });
  }

  const videoPath = submission.file_url;
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Streaming with range support
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });

    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/quicktime',
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    // Full file
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/quicktime',
    };

    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});
```

### 6. CDN/Storage Optimization

For production, use CDN for video delivery:

#### 6.1 AWS S3 + CloudFront Example
```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

async function uploadToS3(file, challengeId, userId) {
  const key = `challenges/${challengeId}/${userId}/${file.originalname}`;

  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype,
    ACL: 'public-read'
  };

  const result = await s3.upload(params).promise();

  // Return CloudFront URL for faster delivery
  return `https://cdn.yourdomain.com/${key}`;
}
```

### 7. Frontend Gallery Updates

The mobile app needs to detect video submissions and render them with autoplay:

```typescript
// React Native gallery component
{submissions.map(submission => (
  <View key={submission.id}>
    {submission.media_type === 'video' ? (
      <Video
        source={{ uri: submission.file_url }}
        style={{ width: 300, height: 300 }}
        shouldPlay={true}
        isLooping={true}
        isMuted={true}
        resizeMode="cover"
      />
    ) : (
      <Image
        source={{ uri: submission.file_url }}
        style={{ width: 300, height: 300 }}
      />
    )}
  </View>
))}
```

### 8. Performance Considerations

#### 8.1 Video Compression
Consider compressing uploaded videos server-side:

```javascript
async function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',           // H.264 codec
        '-crf 28',                 // Quality (23-28 is good)
        '-preset medium',          // Encoding speed
        '-c:a aac',                // Audio codec
        '-b:a 128k',               // Audio bitrate
        '-movflags +faststart'     // Enable fast start for web
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}
```

#### 8.2 Lazy Loading
Implement pagination and lazy loading for gallery:

```javascript
router.get('/:challengeId/gallery', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const { count, rows } = await db.submissions.findAndCountAll({
    where: { challenge_id: req.params.challengeId },
    order: [['uploaded_at', 'DESC']],
    limit,
    offset
  });

  res.json({
    submissions: rows,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit)
    }
  });
});
```

### 9. Security Considerations

#### 9.1 File Type Verification
Don't trust client-provided MIME types:

```javascript
const fileType = require('file-type');

async function verifyFileType(filePath) {
  const type = await fileType.fromFile(filePath);

  if (!type) {
    throw new Error('Cannot determine file type');
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'video/quicktime', 'video/mp4'];

  if (!allowedTypes.includes(type.mime)) {
    throw new Error(`File type ${type.mime} not allowed`);
  }

  return type;
}
```

#### 9.2 Rate Limiting
Protect upload endpoint:

```javascript
const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 uploads per 15 minutes
  message: 'Too many uploads, please try again later'
});

router.post('/:challengeId/submit', uploadLimiter, ...);
```

#### 9.3 Virus Scanning
For production, scan uploaded files:

```javascript
const ClamScan = require('clamscan');

async function scanFile(filePath) {
  const clamscan = await new ClamScan().init();
  const { isInfected, viruses } = await clamscan.isInfected(filePath);

  if (isInfected) {
    fs.unlinkSync(filePath);
    throw new Error(`File infected: ${viruses.join(', ')}`);
  }

  return true;
}
```

### 10. Testing

#### 10.1 Backend Tests
```javascript
describe('Challenge Submission API', () => {
  it('should accept MOV file upload', async () => {
    const response = await request(app)
      .post('/api/challenges/test-challenge/submit')
      .attach('file', 'test/fixtures/animation.mov')
      .field('video_duration', '3000')
      .field('video_fps', '30')
      .field('video_frame_count', '90');

    expect(response.status).toBe(200);
    expect(response.body.submission.media_type).toBe('video');
  });

  it('should reject files over size limit', async () => {
    // Test with 51MB file
    const response = await request(app)
      .post('/api/challenges/test-challenge/submit')
      .attach('file', 'test/fixtures/large-video.mov');

    expect(response.status).toBe(400);
  });
});
```

### 11. Monitoring & Analytics

Track video-specific metrics:

```javascript
// Add to analytics
{
  event: 'challenge_submission',
  properties: {
    challenge_id: challengeId,
    media_type: 'video',
    duration_ms: videoDuration,
    fps: videoFps,
    file_size_mb: fileSize / (1024 * 1024),
    frame_count: frameCount
  }
}
```

## Implementation Checklist

- [ ] Update file upload middleware to accept MOV files
- [ ] Add database schema changes for video metadata
- [ ] Implement video thumbnail generation
- [ ] Update submission API endpoint
- [ ] Update gallery API to return media type
- [ ] Implement video streaming endpoint (optional)
- [ ] Add video compression (recommended)
- [ ] Implement CDN/S3 storage (production)
- [ ] Add security measures (rate limiting, virus scanning)
- [ ] Update frontend gallery component to autoplay videos
- [ ] Write tests for video upload and retrieval
- [ ] Set up monitoring for video uploads

## Dependencies Required

```json
{
  "dependencies": {
    "multer": "^1.4.5-lts.1",
    "fluent-ffmpeg": "^2.1.2",
    "file-type": "^18.0.0",
    "express-rate-limit": "^6.7.0"
  },
  "devDependencies": {
    "supertest": "^6.3.3"
  }
}
```

Also install ffmpeg system dependency:
```bash
# Ubuntu/Debian
apt-get install ffmpeg

# macOS
brew install ffmpeg

# Or use Docker with ffmpeg pre-installed
```

## Estimated Timeline

1. **Database & API Changes**: 2-3 days
2. **File Upload & Storage**: 2-3 days
3. **Video Processing (thumbnails, compression)**: 2-3 days
4. **Gallery Frontend Updates**: 1-2 days
5. **Testing & QA**: 2-3 days
6. **Production Deployment**: 1 day

**Total**: ~2-3 weeks for full implementation

## Notes

- Start with basic MOV upload/download first
- Add video processing incrementally
- Monitor storage costs as videos are much larger than images
- Consider implementing automatic cleanup of old submissions
- Set up proper CDN caching headers for video files
- Test on various devices and network conditions

