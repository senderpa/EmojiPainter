#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MP4ExporterModule, NSObject)

RCT_EXTERN_METHOD(exportMP4:(NSArray *)frames
                  outputPath:(NSString *)outputPath
                  width:(NSNumber *)width
                  height:(NSNumber *)height
                  fps:(NSNumber *)fps
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportMp4FromFrames:(NSArray *)framePaths
                  destinationPath:(NSString *)destinationPath
                  width:(NSNumber *)width
                  height:(NSNumber *)height
                  fps:(NSNumber *)fps
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportGifFromFrames:(NSArray *)framePaths
                  delays:(NSArray *)delays
                  destinationPath:(NSString *)destinationPath
                  width:(NSNumber *)width
                  height:(NSNumber *)height
                  loopCount:(NSNumber *)loopCount
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

@end
