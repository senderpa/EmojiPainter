#!/usr/bin/env ruby
require 'xcodeproj'

puts "🎬 Adding Timelapse Export modules to Xcode project..."

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Get the MetalCanvas group
main_group = project.main_group.find_subpath('EmojiPainter', false)
metal_group = main_group['MetalCanvas']

if !metal_group
  puts "❌ MetalCanvas group not found"
  exit 1
end

# Files to add
files_to_add = [
  'StrokeReplayEngine.swift',
  'TimelapseExporterModule.swift',
  'TimelapseExporterModuleBridge.m'
]

# Add files to group and get file references
file_refs = []
files_to_add.each do |filename|
  file_path = "ios/EmojiPainter/MetalCanvas/#{filename}"

  # Check if file exists on disk
  unless File.exist?(file_path)
    puts "❌ File not found: #{file_path}"
    next
  end

  # Check if already in project
  existing = metal_group.files.find { |f| f.path == filename }
  if existing
    puts "   ⚠️  Already in project: #{filename}"
    file_refs << existing
    next
  end

  # Add file reference
  file_ref = metal_group.new_reference(filename)
  file_ref.source_tree = '<group>'
  file_refs << file_ref
  puts "   ✓ Added: #{filename}"
end

# Add to compile sources build phase (only .swift and .m files)
target = project.targets.find { |t| t.name == 'EmojiPainter' }
if target
  sources_phase = target.source_build_phase

  file_refs.each do |file_ref|
    # Skip if already in build phase
    next if sources_phase.files.any? { |bf| bf.file_ref == file_ref }

    # Only add compilable files
    if file_ref.path.end_with?('.swift', '.m', '.mm', '.cpp', '.c')
      sources_phase.add_file_reference(file_ref)
      puts "   ✓ Added to build phase: #{file_ref.path}"
    end
  end
end

project.save
puts "\n✅ Timelapse modules added successfully!"
puts "Files added: #{files_to_add.join(', ')}"
