//
//  APIClient.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation

class APIClient {
    static let shared = APIClient()
    private let baseURL = "https://some-sender.gotdns.ch:4850/api"

    private init() {}

    func createProfile(username: String, emoji: String) async throws -> Profile {
        guard let url = URL(string: "\(baseURL)/profile") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["username": username, "emoji": emoji]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return try JSONDecoder().decode(Profile.self, from: data)
    }

    func getLeaderboard() async throws -> LeaderboardResponse {
        guard let url = URL(string: "\(baseURL)/leaderboard") else {
            throw APIError.invalidURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return try JSONDecoder().decode(LeaderboardResponse.self, from: data)
    }

    func fetchTileImage(path: String) async throws -> Data {
        let separator = path.contains("?") ? "&" : "?"
        let cacheBust = Int(Date().timeIntervalSince1970 * 1000)
        let urlString = "https://some-sender.gotdns.ch:4850\(path)\(separator)_quality=full&_r=\(cacheBust)"
        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.addValue("no-cache", forHTTPHeaderField: "Pragma")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return data
    }

    func fetchTimelapseFrames(limit: Int = 100, since: String? = nil) async throws -> TimelapseIOSResponse {
        // Updated to new endpoint: returns newest→oldest, ready for past→present animation
        var urlString = "https://some-sender.gotdns.ch:4850/api/ios/timelapse/frames?limit=\(limit)&order=newest"
        if let since = since {
            urlString += "&since=\(since)"
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return try JSONDecoder().decode(TimelapseIOSResponse.self, from: data)
    }

    func fetchLatestTimelapse() async throws -> Data {
        // The /preview endpoint is intentionally tiny; use the newest full frame
        // so splash/lobby imagery stays sharp on iPad and Retina iPhone screens.
        let response = try await fetchTimelapseFrames(limit: 1)
        guard let path = response.frames.first else {
            throw URLError(.zeroByteResource)
        }
        return try await fetchTileImage(path: path)
    }

    func fetchMultipleTimelapseFrames(startIndex: Int = 0, count: Int = 90) async throws -> [Data] {
        // Fetch the last N frames from the timelapse
        print("📥 Fetching timelapse frames \(startIndex)..<\(startIndex + count)")

        var frames: [Data] = []

        guard count > 0 else { return frames }
        let endIndex = max(startIndex, 0) + count

        for i in max(startIndex, 0)..<endIndex {
            do {
                // Fetch frames from newest (0) outward
                let url = "https://some-sender.gotdns.ch:4850/api/timelapse/frame/\(i)"
                guard let frameURL = URL(string: url) else { continue }

                var request = URLRequest(url: frameURL)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.timeoutInterval = 5.0

                let (data, response) = try await URLSession.shared.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    print("⚠️ Frame \(i) failed to load")
                    continue
                }

                frames.append(data)

                // Progress update every 10 frames
                if (i - startIndex + 1) % 10 == 0 {
                    print("📥 Loaded \(i - startIndex + 1)/\(count) frames...")
                }
            } catch {
                print("⚠️ Error loading frame \(i): \(error)")
                continue
            }
        }

        print("✅ Loaded \(frames.count) timelapse frames (starting at \(startIndex))")
        return frames
    }

    func fetchTimelapseImage(url: String) async throws -> Data {
        // url is a path like "/storage/timelapse/snap_00016604.jpg"
        // Add timestamp to bust cache
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let fullURL = "https://some-sender.gotdns.ch:4850\(url)?t=\(timestamp)"

        guard let imageURL = URL(string: fullURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: imageURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        // Add cache-busting headers
        request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.addValue("no-cache", forHTTPHeaderField: "Pragma")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return data
    }

    // MARK: - Timelapse Video API

    func fetchTimelapseVideos() async throws -> [TimelapseVideoSegment] {
        // Add timestamp to bust cache and get absolute latest
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        guard let url = URL(string: "\(baseURL)/timelapse/videos?_t=\(timestamp)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.addValue("no-cache", forHTTPHeaderField: "Pragma")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            print("❌ API Error: Status code \(String(describing: (response as? HTTPURLResponse)?.statusCode))")
            throw APIError.serverError
        }

        // Log the raw response for debugging
        if let jsonString = String(data: data, encoding: .utf8) {
            print("📡 Timelapse API Response: \(jsonString.prefix(500))")
        }

        // Backend returns: {"segments": ["/path/to/video.mp4", ...]}
        struct SegmentsResponse: Codable {
            let segments: [String]
        }

        do {
            let segmentsResponse = try JSONDecoder().decode(SegmentsResponse.self, from: data)
            print("✅ Decoded \(segmentsResponse.segments.count) video segment paths")

            // Convert string paths to TimelapseVideoSegment objects
            // Keep in NEWEST to OLDEST order (reverse the array since backend gives oldest first)
            let videos = segmentsResponse.segments.reversed().enumerated().map { index, path in
                let filename = (path as NSString).lastPathComponent
                return TimelapseVideoSegment(
                    id: filename,
                    filename: filename,
                    path: path,
                    url: path,
                    createdAt: nil,
                    size: nil,
                    duration: nil
                )
            }

            print("✅ Created \(videos.count) video segment objects (newest to oldest)")
            if let newest = videos.first?.filename {
                print("📺 NEWEST video: \(newest)")
            }
            if let oldest = videos.last?.filename {
                print("📺 OLDEST video: \(oldest)")
            }
            return videos

        } catch {
            print("❌ Failed to decode timelapse response: \(error)")
            throw error
        }
    }

    func fetchTimelapseVideosPage(offset: Int = 0, limit: Int = 10, order: String = "newest") async throws -> (segments: [TimelapseVideoSegment], total: Int, hasMore: Bool) {
        // Add timestamp to bust cache and ensure fresh data
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        guard let url = URL(string: "\(baseURL)/timelapse/videos/page?offset=\(offset)&limit=\(limit)&order=\(order)&_t=\(timestamp)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.addValue("no-cache", forHTTPHeaderField: "Pragma")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        let pageResponse = try JSONDecoder().decode(TimelapseVideosPageResponse.self, from: data)
        let timeInfo = offset == 0 ? "FROM CURRENT TIME" : "offset: \(offset)"
        print("📦 Fetched \(pageResponse.segments.count) segments (\(timeInfo), total: \(pageResponse.total), hasMore: \(pageResponse.hasMore), order: \(order))")

        // Convert URL paths to TimelapseVideoSegment objects
        var videoSegments: [TimelapseVideoSegment] = []
        for segmentPath in pageResponse.segments {
            // Extract filename from path (e.g., "/storage/timelapse_videos/segment_000150.mp4" -> "segment_000150.mp4")
            let filename = (segmentPath as NSString).lastPathComponent

            let segment = TimelapseVideoSegment(
                id: filename,
                filename: filename,
                path: segmentPath,
                url: segmentPath,
                createdAt: nil,
                size: nil,
                duration: nil
            )
            videoSegments.append(segment)
        }

        print("✅ Created \(videoSegments.count) video segment objects (order: \(order))")
        if let first = videoSegments.first?.filename {
            print("📺 FIRST video: \(first)")
        }
        if let last = videoSegments.last?.filename {
            print("📺 LAST video: \(last)")
        }

        return (segments: videoSegments, total: pageResponse.total, hasMore: pageResponse.hasMore)
    }

    func fetchTimelapseManifest() async throws -> TimelapseManifest {
        guard let url = URL(string: "\(baseURL)/timelapse/videos/manifest") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return try JSONDecoder().decode(TimelapseManifest.self, from: data)
    }

    // MARK: - Painting Sessions API (My Moments)

    func startPaintingSession(userId: String, profileId: String?, username: String, emoji: String, tileX: Int, tileY: Int) async throws -> StartPaintingSessionResponse {
        guard let url = URL(string: "\(baseURL)/sessions/painting/start") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = StartPaintingSessionRequest(
            userId: userId,
            profileId: profileId,
            username: username,
            emoji: emoji,
            tileX: tileX,
            tileY: tileY
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            print("❌ Start session API error: Status \(String(describing: (response as? HTTPURLResponse)?.statusCode))")
            throw APIError.serverError
        }

        let sessionResponse = try JSONDecoder().decode(StartPaintingSessionResponse.self, from: data)
        print("✅ Started painting session: \(sessionResponse.sessionId)")
        return sessionResponse
    }

    func stopPaintingSession(sessionId: String, snapshotData: String?) async throws -> StopPaintingSessionResponse {
        guard let url = URL(string: "\(baseURL)/sessions/painting/stop") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = StopPaintingSessionRequest(sessionId: sessionId, snapshotData: snapshotData)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            print("❌ Stop session API error: Status \(String(describing: (response as? HTTPURLResponse)?.statusCode))")
            throw APIError.serverError
        }

        let sessionResponse = try JSONDecoder().decode(StopPaintingSessionResponse.self, from: data)
        print("✅ Stopped painting session: \(sessionResponse.sessionId), duration: \(sessionResponse.durationSeconds)s, videos: \(sessionResponse.videoSegments)")
        return sessionResponse
    }

    func fetchMyMoments(userId: String, limit: Int = 50, offset: Int = 0) async throws -> MyMomentsResponse {
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        guard let url = URL(string: "\(baseURL)/sessions/painting/my-moments?user_id=\(userId)&limit=\(limit)&offset=\(offset)&_t=\(timestamp)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            print("❌ My Moments API error: Status \(String(describing: (response as? HTTPURLResponse)?.statusCode))")
            throw APIError.serverError
        }

        let momentsResponse = try JSONDecoder().decode(MyMomentsResponse.self, from: data)
        print("✅ Fetched \(momentsResponse.moments.count) painting moments (total: \(momentsResponse.total))")
        return momentsResponse
    }

    func fetchMomentDetails(sessionId: String) async throws -> PaintingSession {
        guard let url = URL(string: "\(baseURL)/sessions/painting/moment/\(sessionId)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError
        }

        return try JSONDecoder().decode(PaintingSession.self, from: data)
    }
}

// MARK: - Timelapse Video Models

struct TimelapseVideosResponse: Codable {
    let videos: [TimelapseVideoSegment]
}

struct TimelapseVideosPageResponse: Codable {
    let segments: [String]  // Array of URL paths
    let total: Int
    let offset: Int
    let limit: Int
    let order: String
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case segments
        case total
        case offset
        case limit
        case order
        case hasMore
    }
}

struct TimelapseVideoSegment: Codable, Identifiable {
    let id: String
    let filename: String
    let path: String
    let url: String
    let createdAt: String?
    let size: Int?
    let duration: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case filename
        case path
        case url
        case createdAt = "created_at"
        case size
        case duration
    }

    // Simple initializer for creating from path strings
    init(id: String, filename: String, path: String, url: String, createdAt: String? = nil, size: Int? = nil, duration: Double? = nil) {
        self.id = id
        self.filename = filename
        self.path = path
        self.url = url
        self.createdAt = createdAt
        self.size = size
        self.duration = duration
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Try different possible keys for id
        if let idValue = try? container.decode(String.self, forKey: .id) {
            id = idValue
        } else if let filenameValue = try? container.decode(String.self, forKey: .filename) {
            id = filenameValue
        } else {
            id = UUID().uuidString
        }

        filename = try container.decode(String.self, forKey: .filename)
        path = (try? container.decode(String.self, forKey: .path)) ?? ""
        url = try container.decode(String.self, forKey: .url)
        createdAt = try? container.decode(String.self, forKey: .createdAt)
        size = try? container.decode(Int.self, forKey: .size)
        duration = try? container.decode(Double.self, forKey: .duration)
    }
}

struct TimelapseManifest: Codable {
    let totalSegments: Int
    let lastSegmentCreated: String?
    let totalFramesProcessed: Int
    let status: String

    enum CodingKeys: String, CodingKey {
        case totalSegments = "total_segments"
        case lastSegmentCreated = "last_segment_created"
        case totalFramesProcessed = "total_frames_processed"
        case status
    }
}

enum APIError: Error {
    case invalidURL
    case serverError
    case decodingError
}

// MARK: - Painting Session Models (My Moments)

struct PaintingSession: Codable, Identifiable {
    let id: String
    let userId: String
    let profileId: String?
    let username: String
    let emoji: String

    let startedAt: String
    let stoppedAt: String?
    let durationSeconds: Int?

    let captureStartTime: String?
    let captureEndTime: String?
    let videoSegments: [TimelapseVideoSegment]?

    let previewSnapshotUrl: String?
    let previewSnapshotPath: String?

    let tileX: Int?
    let tileY: Int?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case profileId = "profile_id"
        case username
        case emoji
        case startedAt = "started_at"
        case stoppedAt = "stopped_at"
        case durationSeconds = "duration_seconds"
        case captureStartTime = "capture_start_time"
        case captureEndTime = "capture_end_time"
        case videoSegments = "video_segments"
        case previewSnapshotUrl = "preview_snapshot_url"
        case previewSnapshotPath = "preview_snapshot_path"
        case tileX = "tile_x"
        case tileY = "tile_y"
        case createdAt = "created_at"
    }
}

struct MyMomentsResponse: Codable {
    let moments: [PaintingSession]
    let total: Int
    let offset: Int
    let limit: Int
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case moments
        case total
        case offset
        case limit
        case hasMore = "has_more"
    }
}

struct StartPaintingSessionRequest: Codable {
    let userId: String
    let profileId: String?
    let username: String
    let emoji: String
    let tileX: Int
    let tileY: Int

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case profileId = "profile_id"
        case username
        case emoji
        case tileX = "tile_x"
        case tileY = "tile_y"
    }
}

struct StartPaintingSessionResponse: Codable {
    let sessionId: String
    let startedAt: String
    let message: String

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case startedAt = "started_at"
        case message
    }
}

struct StopPaintingSessionRequest: Codable {
    let sessionId: String
    let snapshotData: String?  // Base64 encoded image

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case snapshotData = "snapshot_data"
    }
}

struct StopPaintingSessionResponse: Codable {
    let sessionId: String
    let startedAt: String
    let stoppedAt: String
    let durationSeconds: Int
    let captureEndTime: String
    let videoSegments: Int
    let previewSnapshotUrl: String?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case startedAt = "started_at"
        case stoppedAt = "stopped_at"
        case durationSeconds = "duration_seconds"
        case captureEndTime = "capture_end_time"
        case videoSegments = "video_segments"
        case previewSnapshotUrl = "preview_snapshot_url"
    }
}
