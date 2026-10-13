#!/usr/bin/env ruby
require 'xcodeproj'

puts "🔧 Fixing Metal file paths..."

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Get the MetalCanvas group
main_group = project.main_group.find_subpath('EmojiPainter', false)
metal_group = main_group['MetalCanvas'] if main_group

if metal_group
  puts "Found MetalCanvas group, fixing file paths..."

  metal_group.files.each do |file_ref|
    old_path = file_ref.path

    # Fix the path - it should be just the filename
    # The group already has the correct path
    filename = File.basename(old_path)
    file_ref.path = filename
    file_ref.source_tree = '<group>'

    puts "   ✓ Fixed: #{filename}"
  end

  # Make sure the group path is correct
  metal_group.path = 'MetalCanvas'
  metal_group.source_tree = '<group>'

  project.save
  puts "\n✅ Fixed all file paths!"
  puts "Now build again in Xcode"
else
  puts "❌ MetalCanvas group not found"
  exit 1
end
