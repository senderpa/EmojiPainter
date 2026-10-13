#!/usr/bin/env ruby
require 'xcodeproj'

puts "🚀 Adding Metal modules to Xcode project..."

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Get the main target
target = project.targets.first
puts "📦 Target: #{target.name}"

# Find the EmojiPainter group
main_group = project.main_group.find_subpath('EmojiPainter', true)

unless main_group
  puts "❌ Could not find EmojiPainter group"
  exit 1
end

# Check if MetalCanvas group already exists
metal_group = main_group['MetalCanvas']

if metal_group
  puts "⚠️  MetalCanvas group already exists, removing old references..."
  metal_group.clear
  metal_group.remove_from_project
end

# Create MetalCanvas group
metal_group = main_group.new_group('MetalCanvas', 'EmojiPainter/MetalCanvas')
puts "✅ Created MetalCanvas group"

# Files to add
files = [
  'EmojiAtlas.swift',
  'MetalCanvasModule.swift',
  'MetalCanvasModule.m',
  'StrokeLogModule.swift',
  'StrokeLogModule.m',
  'MP4ExporterModule.swift',
  'MP4ExporterModule.m',
  'NativeSnapshotModule.swift',
  'NativeSnapshotModule.m',
  'NativeAutosaveModule.swift',
  'NativeAutosaveModule.m',
  'NativeProjectModule.swift',
  'NativeProjectModule.m'
]

added_files = []

files.each do |filename|
  file_path = "ios/EmojiPainter/MetalCanvas/#{filename}"

  unless File.exist?(file_path)
    puts "❌ File not found: #{file_path}"
    next
  end

  # Add file reference to group
  file_ref = metal_group.new_file(file_path)

  # Add to build phase (compile sources)
  if filename.end_with?('.swift', '.m')
    target.source_build_phase.add_file_reference(file_ref)
    puts "   ✓ #{filename}"
    added_files << filename
  end
end

# Add Metal frameworks
frameworks = ['Metal.framework', 'MetalKit.framework']
frameworks_group = project.frameworks_group

frameworks.each do |framework_name|
  # Check if already added
  existing = frameworks_group.files.find { |f| f.path == framework_name }
  next if existing

  framework_ref = frameworks_group.new_file('System/Library/Frameworks/' + framework_name)
  framework_ref.source_tree = 'SDKROOT'
  target.frameworks_build_phase.add_file_reference(framework_ref)
  puts "   ✓ #{framework_name}"
end

# Save project
project.save

puts "\n✅ Successfully added #{added_files.count} files to Xcode project!"
puts "\n📋 Added files:"
added_files.each { |f| puts "   - #{f}" }

puts "\n🔗 Added frameworks:"
puts "   - Metal.framework"
puts "   - MetalKit.framework"

puts "\n✅ Done! Now rebuild:"
puts "   1. Clean: Product → Clean Build Folder (⇧⌘K)"
puts "   2. Build: Product → Build (⌘B)"
puts "   3. Run: npx react-native run-ios --device --mode Release"
