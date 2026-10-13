#!/usr/bin/env ruby
require 'xcodeproj'

project_path = 'ios/EmojiPainter.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Find the main target
target = project.targets.find { |t| t.name == 'EmojiPainter' }

# Find or create the MetalCanvas group
metal_canvas_group = project.main_group.find_subpath('EmojiPainter/MetalCanvas', true)

# Add Shaders.metal file
shaders_file_path = 'EmojiPainter/MetalCanvas/Shaders.metal'
shaders_file_ref = metal_canvas_group.new_file(shaders_file_path)

# Add to compile sources build phase
target.source_build_phase.add_file_reference(shaders_file_ref)

# Save the project
project.save

puts "✅ Successfully added Shaders.metal to Xcode project"
