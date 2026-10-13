#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TimelapseExporterModule, NSObject)

RCT_EXTERN_METHOD(generatePreviewFrames:(NSArray *)strokes
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  frameCount:(nonnull NSNumber *)frameCount
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportTimelapse:(NSArray *)strokes
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  fps:(nonnull NSNumber *)fps
                  durationSeconds:(nonnull NSNumber *)durationSeconds
                  animationSeconds:(nullable NSNumber *)animationSeconds
                  outputPath:(nonnull NSString *)outputPath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportGif:(NSArray *)strokes
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  fps:(nonnull NSNumber *)fps
                  durationSeconds:(nonnull NSNumber *)durationSeconds
                  animationSeconds:(nullable NSNumber *)animationSeconds
                  outputPath:(nonnull NSString *)outputPath
                  quality:(nonnull NSNumber *)quality
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportWebM:(NSArray *)strokes
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  fps:(nonnull NSNumber *)fps
                  durationSeconds:(nonnull NSNumber *)durationSeconds
                  animationSeconds:(nullable NSNumber *)animationSeconds
                  outputPath:(nonnull NSString *)outputPath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Frame-by-frame Animator export (one distinct stroke set per frame → MP4/GIF, GPU)
RCT_EXTERN_METHOD(exportAnimationFrames:(NSArray *)frames
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  fps:(nonnull NSNumber *)fps
                  format:(nonnull NSString *)format
                  outputPath:(nonnull NSString *)outputPath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Deterministic Vector Mode fly-through: the native module receives the
// document once plus compact camera samples and renders directly to AVAssetWriter.
RCT_EXTERN_METHOD(exportVectorFlythrough:(NSArray *)strokes
                  cameras:(NSArray *)cameras
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  fps:(nonnull NSNumber *)fps
                  outputPath:(nonnull NSString *)outputPath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
