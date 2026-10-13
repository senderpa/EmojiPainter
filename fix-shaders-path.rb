#!/usr/bin/env ruby
require 'xcodeproj'

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Find the main target
target = project.targets.find { |t| t.name == 'EmojiPainter' }

# Find and remove existing Shaders.metal references
project.files.each do |file|
  if file.path && file.path.include?('Shaders.metal')
    puts "Removing existing reference: #{file.path}"
    file.remove_from_project
  end
end

# Remove from build phase
target.source_build_phase.files.each do |build_file|
  if build_file.file_ref && build_file.file_ref.path && build_file.file_ref.path.include?('Shaders.metal')
    puts "Removing from build phase: #{build_file.file_ref.path}"
    target.source_build_phase.files.delete(build_file)
  end
end

# Find or create the MetalCanvas group
emoji_painter_group = project.main_group.find_subpath('EmojiPainter', false)
unless emoji_painter_group
  puts "Error: EmojiPainter group not found"
  exit 1
end

metal_canvas_group = emoji_painter_group.find_subpath('MetalCanvas', false)
unless metal_canvas_group
  metal_canvas_group = emoji_painter_group.new_group('MetalCanvas')
end

# Add Shaders.metal with correct path (relative to group)
shaders_file_ref = metal_canvas_group.new_file('Shaders.metal')
shaders_file_ref.path = 'Shaders.metal'
shaders_file_ref.source_tree = '<group>'

# Add to compile sources build phase
target.source_build_phase.add_file_reference(shaders_file_ref)

# Save the project
project.save

puts "✅ Successfully fixed Shaders.metal path in Xcode project"
