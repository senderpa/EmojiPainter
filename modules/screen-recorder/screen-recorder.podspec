require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'screen-recorder'
  s.version        = package['version']
  s.summary        = package['description'] || 'Screen Recorder Module'
  s.description    = package['description'] || 'Native screen recording using ReplayKit'
  s.license        = package['license'] || 'MIT'
  s.author         = package['author'] || { 'Your Company' => 'yourcompany@example.com' }
  s.homepage       = package['homepage'] || 'https://example.com'
  s.platforms      = { :ios => '14.0', :tvos => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "ios/**/*.{h,m,mm,swift,hpp,cpp}"
end
