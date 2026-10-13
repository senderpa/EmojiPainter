//
//  UserPreferences.swift
//  MultiPainter
//
//  Created by Claude Code - Persistent user preferences
//

import Foundation

class UserPreferences {
    static let shared = UserPreferences()

    private let defaults = UserDefaults.standard
    private let usernameKey = "saved_username"
    private let speedMultiplierKey = "movement_speed_multiplier"
    private let emojiKey = "saved_emoji"
    private let coinsKey = "saved_coins"
    private let rankKey = "saved_rank"
    private let karmaKey = "saved_karma"
    private let totalKillsKey = "total_kills"
    private let totalDeathsKey = "total_deaths"
    private let totalPlaytimeKey = "total_playtime_seconds"

    private init() {}

    /// Save username to persistent storage
    func saveUsername(_ username: String) {
        defaults.set(username, forKey: usernameKey)
    }

    /// Load saved username (returns nil if never saved)
    func loadUsername() -> String? {
        return defaults.string(forKey: usernameKey)
    }

    /// Check if user has a saved username
    var hasSavedUsername: Bool {
        return defaults.string(forKey: usernameKey) != nil
    }

    /// Clear saved username (for testing/reset)
    func clearUsername() {
        defaults.removeObject(forKey: usernameKey)
        print("🗑️ Cleared saved username")
    }

    // MARK: - Movement Speed

    /// Save movement speed multiplier (0.1 to 4.0)
    func saveSpeedMultiplier(_ multiplier: Double) {
        let clamped = max(0.1, min(4.0, multiplier))
        defaults.set(clamped, forKey: speedMultiplierKey)
        print("💾 Saved speed multiplier: \(clamped)x")
    }

    /// Load movement speed multiplier (default 1.0)
    func loadSpeedMultiplier() -> Double {
        let saved = defaults.double(forKey: speedMultiplierKey)
        // Return default 1.0 if never set (UserDefaults returns 0.0 for missing keys)
        return saved == 0.0 ? 1.0 : saved
    }

    // MARK: - Profile details
    func saveEmoji(_ emoji: String) {
        defaults.set(emoji, forKey: emojiKey)
    }

    func loadEmoji() -> String? {
        defaults.string(forKey: emojiKey)
    }

    func saveCoins(_ coins: Int) {
        defaults.set(coins, forKey: coinsKey)
        updateRank(forCoins: coins)
    }

    func loadCoins() -> Int {
        let saved = defaults.object(forKey: coinsKey) as? Int
        return saved ?? 0
    }

    func saveKarma(_ karma: Int) {
        defaults.set(karma, forKey: karmaKey)
    }

    func loadKarma() -> Int {
        defaults.object(forKey: karmaKey) as? Int ?? 0
    }

    func loadRank() -> String {
        defaults.string(forKey: rankKey) ?? rankTitle(forCoins: loadCoins())
    }

    var hasSavedProfile: Bool {
        return loadUsername() != nil && loadEmoji() != nil
    }

    @discardableResult
    func updateRank(forCoins coins: Int) -> String {
        let rank = rankTitle(forCoins: coins)
        defaults.set(rank, forKey: rankKey)
        return rank
    }

    private func rankTitle(forCoins coins: Int) -> String {
        switch coins {
        case ..<100:
            return "Rookie"
        case 100..<500:
            return "Painter"
        case 500..<1500:
            return "Virtuoso"
        default:
            return "Legend"
        }
    }

    // MARK: - Stats tracking
    func incrementKillCount(by amount: Int = 1) {
        let current = defaults.integer(forKey: totalKillsKey)
        defaults.set(current + amount, forKey: totalKillsKey)
    }

    func incrementDeathCount(by amount: Int = 1) {
        let current = defaults.integer(forKey: totalDeathsKey)
        defaults.set(current + amount, forKey: totalDeathsKey)
    }

    func loadKillCount() -> Int {
        defaults.integer(forKey: totalKillsKey)
    }

    func loadDeathCount() -> Int {
        defaults.integer(forKey: totalDeathsKey)
    }

    func addPlaytime(seconds: TimeInterval) {
        guard seconds > 0 else { return }
        let current = defaults.double(forKey: totalPlaytimeKey)
        defaults.set(current + seconds, forKey: totalPlaytimeKey)
    }

    func loadPlaytime() -> TimeInterval {
        defaults.double(forKey: totalPlaytimeKey)
    }
}
