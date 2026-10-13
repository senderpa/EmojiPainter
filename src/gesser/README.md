# GESSER FEATURE - Mobile App Module

React Native/TypeScript implementation of the Gesser feature.

## Module Structure

```
src/gesser/
├── api/
│   └── gesserClient.ts        # API network client
├── components/                 # Reusable UI components (M3)
│   ├── SuggestTopicOverlay.tsx
│   ├── TopicReviewCard.tsx
│   └── GuessOverlay.tsx
├── screens/                    # Full-screen views (M4, M7)
│   ├── GuessGameScreen.tsx
│   ├── UserDiscoveryScreen.tsx
│   └── FriendsListScreen.tsx
├── utils/                      # Utilities
│   ├── masking.ts             # Topic masking logic
│   └── storage.ts             # AsyncStorage helpers
├── types.ts                   # TypeScript interfaces
├── config.ts                  # Feature flags & config
├── index.ts                   # Module exports
└── README.md                  # This file
```

## Features

### 1. Topic Suggestions (M3)
- User submits 2-word topic
- Must review pending topic first
- +10 coins on submit, +20 if approved

### 2. Guess Game (M4)
- View mystery paintings with masked topics
- ONE guess attempt per user per image
- +50 coins for correct guess

### 3. Mystery Paint (M5, M6)
- 4th daily paint option
- Topic hidden in gallery until solved
- +15 coins on upload

### 4. Social Features (M7)
- User discovery (world list)
- Add/remove friends
- View friends' galleries

## Usage

### Import Module
```typescript
import { GesserApi, maskTopic, isGesserEnabled } from './gesser';
```

### Check Feature Flag
```typescript
if (isGesserEnabled()) {
  // Show Gesser features
}
```

### Submit Topic
```typescript
const result = await GesserApi.submitTopicSuggestion(deviceId, "Space Whale");
console.log(result.coinsAwarded); // 10
```

### Get Mystery Topic
```typescript
const topic = await GesserApi.getRandomMysteryTopic(deviceId);
console.log(topic.topic); // "Crystal Forest"
```

### List Mystery Images
```typescript
const images = await GesserApi.listMysteryImages(deviceId, 'unsolved', 20);
console.log(images.items); // Array of mystery paintings
```

### Submit Guess
```typescript
const result = await GesserApi.submitGuess(deviceId, mysteryId, "Space Whale");
if (result.correct) {
  console.log(`Correct! +${result.coinsAwarded} coins`);
}
```

### Masking Logic
```typescript
import { maskTopic } from './gesser';

const { masked, revealedPositions } = maskTopic("Space Whale", 123);
console.log(masked); // "__ __ a c e   w __ __ l e"
```

## Feature Flags

Edit `config.ts` to enable/disable features:

```typescript
export const GESSER_FEATURE_FLAGS = {
  enabled: true,              // Master switch
  topicSuggestions: true,     // Topic submission
  mysteryPaint: true,         // 4th mystery option
  guessGame: true,            // Guess game
  socialFeatures: true        // Friends/discovery
};
```

## Local Storage

State persisted in AsyncStorage:
- Last mystery paint date
- Guessed mystery IDs
- Pending topic reviews
- Cached mystery images

## Integration Points

### 1. Info Overlay (PaintScreen.tsx)
Add Gesser section with:
- "Suggest a Topic" button
- "Guess a Topic" button
- "Discover Users" button
- "My Friends" button

### 2. Daily Topics Selection (PaintScreen.tsx)
Add 4th tile: "Mystery Topic 🎲"

### 3. Gallery (PaintScreen.tsx)
For mystery paintings:
- Hide topic text
- Show "Guess This!" button
- Show solver name if solved

### 4. Upload Flow (dailyPaintUpload.ts)
Add `is_mystery_paint` flag to upload payload.

## API Endpoints

See `/Downloads/api/gesser/API_DOCUMENTATION.md` for full API docs.

**Base URL:** `https://emojipainter.com/api/gesser/`

**Key Endpoints:**
- `POST /suggest-topic.php`
- `GET /get-pending-topic.php`
- `POST /approve-topic.php`
- `POST /get-random-mystery-topic.php`
- `GET /list-mystery-images.php`
- `POST /submit-guess.php`
- `POST /friends-add.php`
- `GET /friends-list.php`
- `GET /users-discover.php`

## Error Handling

All API functions throw errors on failure:

```typescript
try {
  const result = await GesserApi.submitGuess(deviceId, mysteryId, guess);
} catch (error) {
  console.error('Guess failed:', error.message);
  Alert.alert('Error', error.message);
}
```

## Testing

### Unit Tests (Future)
```bash
npm run test src/gesser/
```

### Manual Testing
1. Submit topic → Review another topic → Approve
2. Get mystery topic → Paint → Upload
3. List mystery images → Submit guess
4. Discover users → Add friend → View friends

## Next Steps

✅ M1: Backend DB + API (Complete)
✅ M2: Module skeleton (Complete)
⏳ M3: Topic Suggestion UI
⏳ M4: Guess Game Screen
⏳ M5: 4th Mystery Option
⏳ M6: Gallery Integration
⏳ M7: Social Features
⏳ M8: Polish & Testing

## Dependencies

- `@react-native-async-storage/async-storage` - Local storage
- `react-native` - Core framework
- Native networking (fetch API)

No additional dependencies required!

## Support

For issues:
1. Check feature flags in `config.ts`
2. Check network logs for API errors
3. Check AsyncStorage state
4. Review backend PHP logs
