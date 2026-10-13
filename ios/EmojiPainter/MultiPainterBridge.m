#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MultiPainterBridge, NSObject)
RCT_EXTERN_METHOD(openMultiPainter:(NSString *)username emoji:(NSString *)emoji)
@end
