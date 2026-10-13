import Foundation
import ReplayKit
import AVFoundation
import React

@objc(ScreenRecorderModule)
class ScreenRecorderModule: NSObject {
  // MARK: - Properties
  private var screenRecorder: RPScreenRecorder?
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var sessionStartTime: Date?
  private var outputURL: URL?
  private var isRecordingActive = false
  private var sessionStarted = false
  private var firstVideoTimestamp: CMTime?
  private var includeMicrophone = false
  // ReplayKit invokes the capture handler on its own internal queue. Stop is
  // requested from the JS bridge queue. Without serializing access to the
  // writer/inputs, stopRecording can call markAsFinished() while a capture
  // handler invocation is still appending a sample buffer for this session —
  // AVAssetWriterInput throws an uncatchable NSException in that case. All
  // reads/writes of the mutable recorder state below go through this queue.
  private let stateQueue = DispatchQueue(label: "com.emojipaint.screenrecorder.state")
  private var isFinishing = false
  private var stopInProgress = false
  private var recordingGeneration: UInt64 = 0

  // MARK: - Lifecycle
  override init() {
    super.init()
  }

  // Check if screen recording is available
  @objc
  func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(RPScreenRecorder.shared().isAvailable)
  }

  // Check if currently recording
  @objc
  func isRecording(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(stateQueue.sync { self.isRecordingActive || self.stopInProgress })
  }

  // Start screen recording
  @objc
  func startRecording(_ includeMicrophone: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let generation: UInt64? = stateQueue.sync {
      guard !self.isRecordingActive, !self.stopInProgress else { return nil }
      self.recordingGeneration &+= 1
      self.isFinishing = false
      return self.recordingGeneration
    }
    guard let generation = generation else {
      resolve([
        "ok": false,
        "error": "Recording already in progress"
      ])
      return
    }

    let recorder = RPScreenRecorder.shared()

    guard recorder.isAvailable else {
      resolve([
        "ok": false,
        "error": "Screen recording not available"
      ])
      return
    }

    // Create output file URL
    let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let fileName = "screen_recording_\(UUID().uuidString).mov"
    let outputURL = documentsPath.appendingPathComponent(fileName)

    // Remove existing file if it exists
    try? FileManager.default.removeItem(at: outputURL)

    // Configure asset writer
    do {
      let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
      // Fragmented MOV keeps the file index maintainable during very long
      // captures and makes finalization independent of a giant in-memory atom.
      writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600)

      // Note: We'll configure video input dimensions from first video buffer
      // This ensures dimensions match the actual capture size

      // Vector and the other visual captures pass `false` here. Do not add an
      // empty AAC input in that case: ReplayKit may still deliver app-audio
      // buffers, and asking AVAssetWriter to finalize a video-only capture with
      // an unused/mismatched audio input is a common source of finish-time
      // failures. Microphone captures retain a real audio track.
      var audioInput: AVAssetWriterInput?
      if includeMicrophone {
        let audioSettings: [String: Any] = [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVNumberOfChannelsKey: 2,
          AVSampleRateKey: 44100.0,
          AVEncoderBitRateKey: 128_000
        ]
        let candidate = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        candidate.expectsMediaDataInRealTime = true
        if writer.canAdd(candidate) {
          writer.add(candidate)
          audioInput = candidate
        }
      }

      stateQueue.sync {
        self.outputURL = outputURL
        self.sessionStartTime = Date()
        self.assetWriter = writer
        self.videoInput = nil
        self.audioInput = audioInput
        self.sessionStarted = false
        self.firstVideoTimestamp = nil
        self.includeMicrophone = includeMicrophone
        self.stopInProgress = false
      }

    } catch {
      stateQueue.sync { self.stopInProgress = false }
      resolve([
        "ok": false,
        "error": "Failed to setup recording: \(error.localizedDescription)"
      ])
      return
    }

    // Configure microphone capture
    recorder.isMicrophoneEnabled = includeMicrophone
    print("[ScreenRecorder] Starting recording - Microphone: \(includeMicrophone)")
    print("[ScreenRecorder] Recording available: \(recorder.isAvailable)")
    print("[ScreenRecorder] Current screen recording state: \(recorder.isRecording)")

    // Start capture handler
    var frameCount = 0
    var blackFrameCount = 0
    recorder.startCapture(handler: { [weak self] (sampleBuffer, bufferType, error) in
      guard let self = self else { return }
      self.stateQueue.sync {
      guard self.recordingGeneration == generation else { return }
      if let error = error {
        print("[ScreenRecorder] Capture error: \(error.localizedDescription)")
        return
      }

      guard CMSampleBufferDataIsReady(sampleBuffer) else {
        return
      }

      // Stop has already begun finalizing this session on the same queue —
      // never touch the writer/inputs once markAsFinished() has been called.
      guard !self.isFinishing else {
        return
      }

      // AVAssetWriter inputs must all be attached BEFORE startWriting(). The old
      // implementation started the writer above and attempted to add this video
      // input on the first ReplayKit frame. On real devices that leaves a writer
      // with audio only (or no samples), so finishWriting returns no playable URL.
      if self.videoInput == nil, bufferType == .video {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
          print("[ScreenRecorder] ERROR: Could not get format description from first video buffer")
          return
        }

        let dimensions = CMVideoFormatDescriptionGetDimensions(formatDescription)
        print("[ScreenRecorder] Creating video input with dimensions: \(dimensions.width)x\(dimensions.height)")

        let videoSettings: [String: Any] = [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: Int(dimensions.width),
          AVVideoHeightKey: Int(dimensions.height),
          AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 10_000_000,
            AVVideoMaxKeyFrameIntervalKey: 60,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
          ]
        ]

        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true

        if let assetWriter = self.assetWriter, assetWriter.canAdd(videoInput) {
          assetWriter.add(videoInput)
          self.videoInput = videoInput
          print("[ScreenRecorder] Video input configured and added to asset writer")
        } else {
          print("[ScreenRecorder] ERROR: Could not add video input to asset writer")
          return
        }
      }

      // Start only after the first video format is known and the video input has
      // been attached. Keep ReplayKit's native monotonic timestamps; starting the
      // writer session at the first video PTS avoids malformed negative samples.
      if !self.sessionStarted, bufferType == .video {
        guard let assetWriter = self.assetWriter, self.videoInput != nil else {
          print("[ScreenRecorder] ERROR: Writer or video input missing at first frame")
          return
        }
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        self.firstVideoTimestamp = timestamp
        guard assetWriter.startWriting() else {
          print("[ScreenRecorder] ERROR: Failed to start writer: \(assetWriter.error?.localizedDescription ?? "unknown")")
          return
        }
        assetWriter.startSession(atSourceTime: timestamp)
        self.sessionStarted = true
        print("[ScreenRecorder] Session started at source time \(CMTimeGetSeconds(timestamp))s")
      }

      // Only append buffers after session has started
      guard self.sessionStarted else {
        return
      }

      guard let assetWriter = self.assetWriter, assetWriter.status == .writing else {
        return
      }

      let originalTimestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      guard let firstVideoTimestamp = self.firstVideoTimestamp,
            CMTimeCompare(originalTimestamp, firstVideoTimestamp) >= 0 else {
        // ReplayKit may deliver an audio sample captured just before the first
        // video frame. It cannot be appended to a session that begins later.
        return
      }

      switch bufferType {
      case .video:
        if let videoInput = self.videoInput,
           videoInput.isReadyForMoreMediaData,
           assetWriter.status == .writing {
          frameCount += 1

          // Debug: Check if frame is black (first few frames)
          if frameCount <= 10 {
            if let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
              CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
              let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer)
              let bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer)
              let height = CVPixelBufferGetHeight(imageBuffer)

              // Sample center pixel
              if let pixels = baseAddress?.assumingMemoryBound(to: UInt8.self) {
                let centerY = height / 2
                let centerPixelOffset = centerY * bytesPerRow + (bytesPerRow / 2)
                let centerPixel = pixels[centerPixelOffset]
                print("[ScreenRecorder] Frame \(frameCount) - center pixel value: \(centerPixel), buffer size: \(bytesPerRow)x\(height), time: \(CMTimeGetSeconds(originalTimestamp))s")

                if centerPixel == 0 {
                  blackFrameCount += 1
                }
              }
              CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly)
            }
          }

          // Keep diagnostics bounded for hour-long recordings. The first ten
          // frames still get the detailed black-frame probe above.
          if frameCount % 300 == 0 {
            print("[ScreenRecorder] Captured \(frameCount) video frames at \(CMTimeGetSeconds(originalTimestamp))s (black frames in first 10: \(blackFrameCount))")
          }
          if !videoInput.append(sampleBuffer) {
            print("[ScreenRecorder] Video append failed: \(self.assetWriter?.error?.localizedDescription ?? "unknown")")
          }
        } else if self.videoInput == nil {
          print("[ScreenRecorder] WARNING: Video input still nil, skipping frame")
        }

      case .audioApp, .audioMic:
        // App audio is the default. When microphone recording is requested,
        // accept microphone buffers instead so two independent streams are
        // never appended to one AVAssetWriterInput with overlapping timestamps.
        let shouldAppend = self.includeMicrophone ? bufferType == .audioMic : bufferType == .audioApp
        if shouldAppend,
           let audioInput = self.audioInput,
           audioInput.isReadyForMoreMediaData,
           assetWriter.status == .writing {
          _ = audioInput.append(sampleBuffer)
        }

      @unknown default:
        break
      }
      } // end stateQueue.sync
    }) { error in
      if let error = error {
        print("[ScreenRecorder] Start capture error: \(error.localizedDescription)")
        self.stateQueue.sync {
          guard self.recordingGeneration == generation else { return }
          self.cleanupRecordingLocked(removeOutput: true)
        }
        resolve([
          "ok": false,
          "error": error.localizedDescription
        ])
      } else {
        let accepted = self.stateQueue.sync { () -> Bool in
          guard self.recordingGeneration == generation else { return false }
          self.isRecordingActive = true
          self.screenRecorder = recorder
          return true
        }
        guard accepted else {
          resolve([
            "ok": false,
            "error": "Recording session was superseded"
          ])
          return
        }
        resolve([
          "ok": true,
          "url": outputURL.path
        ])
      }
    }
  }

  // Stop screen recording
  @objc
  func stopRecording(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let session: (recorder: RPScreenRecorder, generation: UInt64)? = stateQueue.sync {
      guard self.isRecordingActive, !self.stopInProgress, let recorder = self.screenRecorder else { return nil }
      self.stopInProgress = true
      return (recorder, self.recordingGeneration)
    }
    guard let session = session else {
      resolve([
        "ok": false,
        "error": "No active recording"
      ])
      return
    }

    session.recorder.stopCapture { [weak self] error in
      guard let self = self else { return }

      if let error = error {
        print("[ScreenRecorder] Stop capture error: \(error.localizedDescription)")
        self.stateQueue.sync {
          guard self.recordingGeneration == session.generation else { return }
          self.cleanupRecordingLocked(removeOutput: true)
        }
        resolve([
          "ok": false,
          "error": error.localizedDescription
        ])
        return
      }

      print("[ScreenRecorder] Stopping recording, finalizing video...")

      // Synchronize with the capture-handler queue: setting isFinishing and
      // calling markAsFinished() here happens-before any append() the handler
      // might otherwise have made, since both run on stateQueue.
      let writerToFinish: AVAssetWriter? = self.stateQueue.sync {
        guard self.recordingGeneration == session.generation else { return nil }
        self.isRecordingActive = false
        self.screenRecorder = nil
        guard self.sessionStarted, let writer = self.assetWriter else { return nil }
        self.isFinishing = true
        self.videoInput?.markAsFinished()
        self.audioInput?.markAsFinished()
        return writer
      }

      guard let writer = writerToFinish else {
        self.stateQueue.sync {
          guard self.recordingGeneration == session.generation else { return }
          self.cleanupRecordingLocked(removeOutput: true)
        }
        resolve([
          "ok": false,
          "error": "iOS did not deliver a video frame for this recording"
        ])
        return
      }

      writer.finishWriting { [weak self] in
        guard let self = self else { return }

        let writerError = writer.error
        let outputURL = self.stateQueue.sync { self.outputURL }
        if writer.status != .completed || writerError != nil {
          let detail = writerError?.localizedDescription ?? "writer status \(writer.status.rawValue)"
          print("[ScreenRecorder] Finalize error: \(detail)")
          self.stateQueue.sync {
            guard self.recordingGeneration == session.generation else { return }
            self.cleanupRecordingLocked(removeOutput: true)
          }
          resolve([
            "ok": false,
            "error": "Failed to finalize recording: \(detail)"
          ])
        } else if let outputURL = outputURL, self.isPlayableMovie(at: outputURL) {
          let attrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path)
          let fileSize = attrs?[.size] as? UInt64 ?? 0
          print("[ScreenRecorder] Recording saved: \(outputURL.path)")
          print("[ScreenRecorder] File size: \(fileSize) bytes (\(fileSize / 1024 / 1024) MB)")
          self.stateQueue.sync {
            guard self.recordingGeneration == session.generation else { return }
            self.cleanupRecordingLocked(removeOutput: false)
          }
          resolve([
            "ok": true,
            "url": outputURL.path
          ])
        } else {
          print("[ScreenRecorder] Finalized file is missing a playable video track")
          self.stateQueue.sync {
            guard self.recordingGeneration == session.generation else { return }
            self.cleanupRecordingLocked(removeOutput: true)
          }
          resolve([
            "ok": false,
            "error": "The finalized recording did not contain a playable video track"
          ])
        }
      }
    }
  }

  private func isPlayableMovie(at url: URL) -> Bool {
    guard FileManager.default.fileExists(atPath: url.path),
          let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
          (attrs[.size] as? UInt64 ?? 0) > 0 else {
      return false
    }
    let asset = AVURLAsset(url: url)
    let duration = CMTimeGetSeconds(asset.duration)
    return duration.isFinite && duration > 0 && !asset.tracks(withMediaType: .video).isEmpty
  }

  private func cleanupRecordingLocked(removeOutput: Bool) {
    let staleURL = self.outputURL
    let staleWriter = self.assetWriter
    if removeOutput, let staleWriter,
       staleWriter.status == .unknown || staleWriter.status == .writing {
      staleWriter.cancelWriting()
    }
    self.isRecordingActive = false
    self.screenRecorder = nil
    self.assetWriter = nil
    self.videoInput = nil
    self.audioInput = nil
    self.outputURL = nil
    self.sessionStarted = false
    self.firstVideoTimestamp = nil
    self.includeMicrophone = false
    self.isFinishing = false
    self.stopInProgress = false
    if removeOutput, let staleURL = staleURL {
      try? FileManager.default.removeItem(at: staleURL)
    }
  }

  // Rotate video file
  @objc
  func rotateVideo(_ sourceUrl: String, rotation: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let sourceURL: URL
    if sourceUrl.hasPrefix("file://") {
      sourceURL = URL(string: sourceUrl)!
    } else {
      sourceURL = URL(fileURLWithPath: sourceUrl)
    }

    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
      resolve([
        "ok": false,
        "error": "Source file does not exist"
      ])
      return
    }

    let asset = AVURLAsset(url: sourceURL)
    guard let videoTrack = asset.tracks(withMediaType: .video).first else {
      resolve([
        "ok": false,
        "error": "No video track found"
      ])
      return
    }

    // Determine rotation transform
    let rotationAngle: CGFloat
    switch rotation {
    case "clockwise", "90":
      rotationAngle = .pi / 2
    case "counterclockwise", "-90":
      rotationAngle = -.pi / 2
    default:
      resolve([
        "ok": false,
        "error": "Invalid rotation value"
      ])
      return
    }

    // Create output file
    let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let timestamp = Int(Date().timeIntervalSince1970)
    let fileName = "rotated_\(timestamp).mov"
    let outputURL = documentsPath.appendingPathComponent(fileName)
    try? FileManager.default.removeItem(at: outputURL)

    // Create export session
    guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      resolve([
        "ok": false,
        "error": "Failed to create export session"
      ])
      return
    }

    // Apply rotation transform
    let composition = AVMutableComposition()
    let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)

    do {
      try compositionVideoTrack?.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: videoTrack, at: .zero)
    } catch {
      resolve([
        "ok": false,
        "error": "Failed to insert time range: \(error.localizedDescription)"
      ])
      return
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

    let naturalSize = videoTrack.naturalSize
    let transform = videoTrack.preferredTransform.concatenating(CGAffineTransform(rotationAngle: rotationAngle))

    // Calculate new render size after rotation
    let rotatedWidth = abs(naturalSize.height)
    let rotatedHeight = abs(naturalSize.width)
    videoComposition.renderSize = CGSize(width: rotatedWidth, height: rotatedHeight)

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)

    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack!)
    layerInstruction.setTransform(transform, at: .zero)

    instruction.layerInstructions = [layerInstruction]
    videoComposition.instructions = [instruction]

    // Export
    exportSession.outputURL = outputURL
    exportSession.outputFileType = .mov
    exportSession.videoComposition = videoComposition

    exportSession.exportAsynchronously {
      switch exportSession.status {
      case .completed:
        resolve([
          "ok": true,
          "url": outputURL.path
        ])
      case .failed:
        resolve([
          "ok": false,
          "error": exportSession.error?.localizedDescription ?? "Export failed"
        ])
      case .cancelled:
        resolve([
          "ok": false,
          "error": "Export cancelled"
        ])
      default:
        resolve([
          "ok": false,
          "error": "Unknown export status"
        ])
      }
    }
  }
}
