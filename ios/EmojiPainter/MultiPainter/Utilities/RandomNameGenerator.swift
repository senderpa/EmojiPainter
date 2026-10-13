//
//  RandomNameGenerator.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation

struct RandomNameGenerator {
    static let coolNames = [
        // Cosmic & Space
        "CosmicBrush", "StarPainter", "NebulaDreamer", "GalaxyArtist", "MoonStrokes",
        "SolarFlare", "AstroCanvas", "CometTracer", "OrbitArt", "ConstellationX",

        // Nature & Elements
        "ThunderStroke", "LightningDraw", "OceanWaves", "ForestWhisper", "DesertWind",
        "MountainPeak", "RiverFlow", "SunsetGlow", "AuroraLights", "StormChaser",

        // Mythical & Fantasy
        "DragonBrush", "PhoenixRise", "UnicornDreams", "GriffinWings", "MermaidTide",
        "WizardCanvas", "EnchantedArt", "MysticPainter", "FairyDust", "CentaurTrail",

        // Tech & Cyber
        "NeonGlitch", "CyberStroke", "PixelMaster", "DigitalDream", "ByteBrush",
        "VirtualArt", "MatrixPaint", "QuantumDraw", "BinaryCanvas", "CodeArtist",

        // Abstract & Cool
        "VividVisions", "BoldStrokes", "ChromaFlow", "InfiniteHues", "AbstractMind",
        "ColorCascade", "VibrantSoul", "PrismDreams", "KaleidoArt", "SpectrumShift",

        // Action & Energy
        "BlazingBrush", "SwiftStrokes", "RapidDraw", "FlashArtist", "TurboPaint",
        "VelocityArt", "DynamicCanvas", "PowerBrush", "IntenseHues", "BurstMode",

        // Mystical & Spiritual
        "ZenMaster", "KarmaPainter", "NirvanaArt", "SoulCanvas", "SpiritBrush",
        "ChakraFlow", "MeditationArt", "MindfulDraw", "HarmonySeeker", "BalanceBeam",

        // Animals & Creatures
        "WolfPack", "EagleEye", "PantherStroke", "FalconDive", "TigerClaw",
        "DolphinWave", "OwlWisdom", "FoxSpirit", "BearPower", "SharkBite",

        // Music & Rhythm
        "JazzBrush", "RhythmFlow", "BeatCanvas", "MelodyDraw", "SymphonyArt",
        "HarmonyPaint", "TempoStroke", "VibeArtist", "SonicBrush", "EchoDraw",

        // Colors & Gems
        "SapphireGlow", "EmeraldDream", "RubyFlash", "TopazBeam", "AmethystHaze",
        "OpalShimmer", "DiamondCut", "PearlLuster", "JadeVision", "ObsidianEdge",

        // Time & Space
        "TimeLapse", "EpochArt", "EternityFlow", "MomentCatcher", "InstantCanvas",
        "ChronoDraw", "AeonBrush", "TemporalArt", "ForeverStroke", "NowPainter",

        // Weather & Atmosphere
        "MistWeaver", "CloudDancer", "RainMaker", "SnowDrift", "HailStorm",
        "TornadoSpin", "FogRoller", "BreezeFlow", "CycloneArt", "ZephyrBrush",

        // Urban & Street
        "UrbanLegend", "StreetArtist", "MetroBrush", "CityLights", "GraffitiKing",
        "DowntownDraw", "AlleyWay", "SkylineView", "BlockParty", "DistrictArt",

        // Ocean & Water
        "TidalWave", "DeepSeaDiver", "CoralReef", "WhirlpoolArt", "TsunamiForce",
        "ReefPainter", "AbyssalDraw", "MarinaBrush", "SeafoamGreen", "AquaCanvas",

        // Fire & Heat
        "InfernoArt", "FlameStroke", "EmberGlow", "WildfirePaint", "LavaBrush",
        "ScorchMark", "IgniteDraw", "HeatWave", "PyroCanvas", "BlazePath",

        // Ice & Cold
        "FrostBite", "IcicleArt", "GlacierFlow", "SnowPeak", "CrystalCold",
        "FrozenDream", "BlizzardBrush", "ArcticDraw", "PolarCanvas", "ChillStroke",

        // Light & Dark
        "ShadowPlay", "LightBeam", "EclipseArt", "DuskPainter", "DawnBreaker",
        "TwilightZone", "NoirCanvas", "RadiantGlow", "DimmerSwitch", "LuminousPath",

        // Speed & Motion
        "SonicBoom", "HyperSpeed", "WarpDrive", "RushHour", "MachBrush",
        "AccelArt", "NitroStroke", "TurboDraw", "FastTrack", "QuickDraw",

        // Retro & Vintage
        "RetroWave", "VintageVibe", "ClassicArt", "OldSchool", "ThrowbackBrush",
        "NostalgiaArt", "TimelessDraw", "AntiqueCanvas", "HeritageStroke", "LegacyPaint",

        // Food & Flavor (fun!)
        "SushiRoll", "PizzaSlice", "TacoTuesday", "BurgerKing", "RamenBowl",
        "CoffeeBuzz", "DonutHole", "SmoothieBlend", "WaffleStack", "BaconStrips",

        // Random Cool Combos
        "VelvetThunder", "SilkStorm", "IronButterfly", "GoldenPhoenix", "SilverFox",
        "CrimsonTide", "AzureFlame", "VioletStorm", "ScarletWind", "IndigoPulse"
    ]

    static func randomName() -> String {
        coolNames.randomElement() ?? "ArtistX"
    }
}
