#!/usr/bin/env ruby
require 'xcodeproj'

puts "🔧 Fixing Metal file paths (final fix)..."

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Get the main group
main_group = project.main_group.find_subpath('EmojiPainter', false)
metal_group = main_group['MetalCanvas'] if main_group

if metal_group
  puts "Found MetalCanvas group, fixing paths..."

  # Set the correct source tree and path for the group
  metal_group.source_tree = '<group>'
  metal_group.path = 'EmojiPainter/MetalCanvas'

  # Fix each file reference
  metal_group.files.each do |file_ref|
    filename = File.basename(file_ref.path)
    file_ref.path = filename
    file_ref.source_tree = '<group>'
    puts "   ✓ Fixed: #{filename}"
  end

  project.save
  puts "\n✅ Fixed all paths!"
  puts "Group path: EmojiPainter/MetalCanvas"
  puts "Files use relative paths within group"
else
  puts "❌ MetalCanvas group not found"
  exit 1
end
